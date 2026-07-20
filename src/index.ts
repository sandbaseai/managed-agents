/**
 * managed-agents - Entry Point
 *
 * Managed Agents runtime.
 * CLI commands: start (default), init, list, reload
 */

import { serve } from '@hono/node-server';
import { appendFileSync, mkdirSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from './core/db/database.js';
import { createServer } from './api/server.js';
import { logDirForFile, resolveConfigPath, resolveDataDir, resolveLogFile, resolveUserPath, resolveWorkspaceRoot } from './core/config/paths.js';
import { composeRuntimeFromSettings } from './core/runtime/composition.js';
import { ensureDefaultEnvironment, loadRuntimeConfigBootstrap } from './core/runtime/config-bootstrap.js';
import { createRuntimeStopper } from './core/runtime/lifecycle.js';
import { loadRuntimeAgentSkillState, reloadRuntimeAgents } from './core/runtime/agent-skill-bootstrap.js';
import { bootstrapRuntimeModelRegistry } from './core/runtime/model-bootstrap.js';
import { bootstrapRuntimeSandboxes } from './core/runtime/sandbox-bootstrap.js';
import { bootstrapRuntimeLoopEngine } from './core/runtime/loop-engine-bootstrap.js';
import { resolveRuntimeApiAuth } from './core/runtime/api-auth.js';
import { createRuntimeSessionServices } from './core/runtime/session-runtime.js';
import { attachRuntimeServerErrorHandler, parseCsv, runtimeStartupBannerLines } from './core/runtime/http-server.js';
import { createLogger, InMemoryLogStore } from './core/observability/logger.js';
import { Metrics } from './core/observability/metrics.js';
import { runCli, type StartServerOptions } from './cli/program.js';

const VERSION = '0.1.0';

// ============================================================
// Start Server
// ============================================================

async function startServer(opts: StartServerOptions) {
  const port = parseInt(opts.port, 10);
  const host = opts.host;
  const workspaceRoot = resolveWorkspaceRoot(opts.workspace);
  const dataDir = resolveDataDir(opts.dataDir, workspaceRoot);
  const agentsDir = resolveUserPath(opts.agentsDir, workspaceRoot);
  const skillsDir = resolveUserPath(opts.skillsDir, workspaceRoot);
  const configPath = resolveConfigPath(opts.config, workspaceRoot);
  const logFile = resolveLogFile(opts.logFile, workspaceRoot);
  const target = opts.target ?? 'local';

  // Initialize workspace state directories
  mkdirSync(dataDir, { recursive: true });
  mkdirSync(logDirForFile(logFile), { recursive: true });

  // Initialize database (migrations are embedded and bundle-safe)
  const dbPath = join(dataDir, 'data.db');
  const db = new Database(dbPath);
  db.runMigrations();

  ensureDefaultEnvironment(db);

  const configBootstrap = loadRuntimeConfigBootstrap({ db, configPath, target });
  const { modelRegistry } = bootstrapRuntimeModelRegistry({ db, configModels: configBootstrap.models });

  const agentSkillState = loadRuntimeAgentSkillState({ db, agentsDir, skillsDir });
  const agents = agentSkillState.agents;
  const skills = agentSkillState.skills;
  const { sandboxProvider, sandboxRegistry, workQueue } = bootstrapRuntimeSandboxes({ db, dataDir });

  // Settings V2 is seeded after legacy config/import data exists, then becomes
  // the runtime source for settings that have a shipped adapter.
  const runtimeComposition = composeRuntimeFromSettings({
    db,
    dataDir,
    modelRegistry,
    settingsSeed: configBootstrap.settingsSeed,
    sandboxProviders: sandboxRegistry.listTypes(),
  });
  const effectiveSettings = runtimeComposition.settings.effective_config;
  const memory = runtimeComposition.memory;

  const loopEngine = bootstrapRuntimeLoopEngine(effectiveSettings);
  const artifactStore = runtimeComposition.artifactStore;
  const {
    sessionManager,
    executor,
    reconciled,
  } = createRuntimeSessionServices({
    db,
    agents,
    modelRegistry,
    sandboxProvider,
    sandboxRegistry,
    runtimeComposition,
    strategy: loopEngine.strategy,
    skills,
    memory,
    artifactStore,
    defaultMaxSteps: loopEngine.defaultMaxSteps,
  });
  if (reconciled > 0) {
    console.log(`  Recovery:  reconciled ${reconciled} interrupted session(s)`);
  }

  const runtimeApiAuth = resolveRuntimeApiAuth({ db });

  // Observability
  const logStore = new InMemoryLogStore();
  const logger = createLogger({
    logStore,
    write: (line) => {
      process.stderr.write(line + '\n');
      appendFileSync(logFile, line + '\n', 'utf8');
    },
  });
  const metrics = new Metrics();
  let server: ReturnType<typeof serve> | undefined;
  const stopRuntime = createRuntimeStopper({
    getServer: () => server,
    sessionManager,
    db,
    logger,
  });

  // Create HTTP server
  const app = createServer({
    db,
    sessionManager,
    agents,
    apiKeys: runtimeApiAuth.apiKeys,
    hasApiKeys: runtimeApiAuth.hasApiKeys,
    validateApiKey: runtimeApiAuth.validateApiKey,
    logger,
    logStore,
    metrics,
    restart: () => stopRuntime('restart'),
    workQueue,
    corsOrigins: parseCsv(process.env.MANAGED_AGENTS_CORS_ORIGINS),
    workspace: {
      root: workspaceRoot,
      dataDir,
      databasePath: dbPath,
      agentsDir,
      skillsDir,
      configPath,
      logFile,
      logsDir: logDirForFile(logFile),
      target,
    },
    artifactStorageDir: () => artifactStore.rootPath(),
    artifactStore: () => artifactStore,
    runtime: {
      models: modelRegistry.listRuntimeInfo(),
      sandboxProviders: sandboxRegistry.listTypes(),
      memory: memory ? memory.name : 'disabled',
      authEnabled: runtimeApiAuth.hasApiKeys(),
    },
    listRuntimeModels: () => modelRegistry.listRuntimeInfo(),
    registerModelProvider: (config) => modelRegistry.register(config),
    setDefaultRuntimeModel: (name) => modelRegistry.setDefault(name),
    skills,
    getMcpStatus: (sessionId) => executor.getMcpStatus(sessionId),
    reloadAgents: () => {
      return reloadRuntimeAgents({ db, agentsDir, agents });
    },
  });

  // Start the server
  server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    for (const line of runtimeStartupBannerLines({
      version: VERSION,
      host,
      port: info.port,
      agentsCount: agents.length,
      skillsCount: skills.length,
      sandboxProviders: sandboxRegistry.listTypes(),
      memory: memory ? memory.name : 'disabled',
      target,
      dataDir,
      authEnabled: runtimeApiAuth.hasApiKeys(),
      agentLoadErrorCount: agentSkillState.agentLoadErrors.length,
    })) {
      console.log(line);
    }
  });

  // Port-in-use / bind errors: print a clear message and exit (R1.5) rather
  // than crashing with an unhandled 'error' event stack trace.
  attachRuntimeServerErrorHandler({ server, port, db });

  // Graceful shutdown: stop accepting requests, drain turns + sandboxes, close DB
  process.on('SIGINT', () => void stopRuntime('shutdown'));
  process.on('SIGTERM', () => void stopRuntime('shutdown'));
}

runCli({ version: VERSION, startServer });
