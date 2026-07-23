/**
 * managed-agents - Entry Point
 *
 * Managed Agents runtime.
 * CLI commands: start (default), init, list, reload
 */

import { serve } from '@hono/node-server';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

import { Database } from './core/db/database.js';
import { SessionManager } from './core/session/session-manager.js';
import { DefaultSessionExecutor } from './core/session/executor.js';
import { loadAgents } from './core/agent/loader.js';
import { importAgentSeeds, loadActiveAgentsFromDb, loadAgentDefinitionById, refreshAgentsFromDb } from './core/agent/store.js';
import { loadSkills } from './core/skills/loader.js';
import { BUILTIN_SKILLS } from './core/skills/catalog.js';
import { importSkillSeeds, loadCustomSkillsFromDb } from './core/skills/store.js';
import { listModelProviders, seedModelProviders } from './core/model/providers.js';
import { ModelRegistry } from './model/registry.js';
import { LocalSandboxProvider } from './sandbox/local-provider.js';
import { DockerSandboxProvider, isDockerAvailable } from './sandbox/docker-provider.js';
import { SandboxProviderRegistry } from './sandbox/registry.js';
import { SelfHostedSandboxProvider, WorkQueue } from './sandbox/self-hosted-provider.js';
import { DefaultStrategy } from './strategy/default-strategy.js';
import { ContextCompactor } from './core/session/context-compactor.js';
import { SnapshotManager } from './core/session/snapshot-manager.js';
import { resolveApiKeys } from './api/auth.js';
import { countActiveManagedApiKeys, validateManagedApiKey } from './core/auth/api-keys.js';
import { createLogger, InMemoryLogStore } from './core/observability/logger.js';
import { Metrics } from './core/observability/metrics.js';
import type { AgentDefinition } from './types/agent.js';
import type { EnvironmentConfig } from './types/sandbox.js';
import { createCliProgram, type StartCommandOptions } from './cli/program.js';
import {
  sessionCreateCommand,
  sessionInspectCommand,
  sessionLogsCommand,
  sessionMessageCommand,
  sessionTailCommand,
} from './cli/session-commands.js';
import {
  environmentArchiveCommand,
  environmentCreateCommand,
  environmentInspectCommand,
  environmentsListCommand,
  environmentUpdateCommand,
  environmentWorkerKeysCommand,
  settingsGetCommand,
  settingsSetModelCommand,
  settingsValidateCommand,
} from './cli/runtime-management-commands.js';
import {
  workspaceCreateCommand,
  workspaceListCommand,
  workspaceOpenCommand,
  workspaceRemoveCommand,
  workspaceResolveCommand,
} from './cli/workspace-commands.js';
import { workerPollCommand } from './cli/worker-commands.js';
import { loadRuntimeConfig, openRuntimeDatabase, resolveRuntimePaths } from './core/runtime/bootstrap.js';
import { normalizeRuntimeEnvironment } from './core/runtime/environment.js';
import { createRuntimeLifecycle } from './core/runtime/lifecycle.js';
import { createRuntimeServerApp } from './core/runtime/server-assembly.js';

const VERSION = '0.1.0';

// ============================================================
// CLI
// ============================================================

createCliProgram(VERSION, {
  startServer,
  initProject,
  listAgents,
  reloadAgents,
  chatCommand,
  sessionCreate: sessionCreateCommand,
  sessionMessage: sessionMessageCommand,
  sessionTail: sessionTailCommand,
  sessionInspect: sessionInspectCommand,
  sessionLogs: sessionLogsCommand,
  settingsGet: settingsGetCommand,
  settingsSetModel: settingsSetModelCommand,
  settingsValidate: settingsValidateCommand,
  environmentsList: environmentsListCommand,
  environmentInspect: environmentInspectCommand,
  environmentCreate: environmentCreateCommand,
  environmentUpdate: environmentUpdateCommand,
  environmentArchive: environmentArchiveCommand,
  environmentWorkerKeys: environmentWorkerKeysCommand,
  workspaceList: workspaceListCommand,
  workspaceCreate: workspaceCreateCommand,
  workspaceOpen: workspaceOpenCommand,
  workspaceResolve: workspaceResolveCommand,
  workspaceRemove: workspaceRemoveCommand,
  workerPoll: workerPollCommand,
}).parse();

// ============================================================
// Start Server
// ============================================================

async function startServer(opts: StartCommandOptions) {
  const port = parseInt(opts.port, 10);
  const host = opts.host;
  const {
    workspaceRoot,
    dataDir,
    agentsDir,
    skillsDir,
    configPath,
    target,
  } = resolveRuntimePaths(opts);
  const db = openRuntimeDatabase(dataDir);
  const modelRegistry = new ModelRegistry();
  const { apiKeys: configApiKeys, models: configModels, memory } = loadRuntimeConfig(configPath, target, db);

// Dashboard-managed model providers are stored in SQLite and are the runtime
// source of truth. Config models can optionally bootstrap a new local project.
  seedModelProviders(db, configModels);
  for (const model of listModelProviders(db)) {
    modelRegistry.register(model);
  }
  const defaultModel = listModelProviders(db).find((model) => model.is_default);
  if (defaultModel) {
    modelRegistry.setDefault(defaultModel.name);
  }

  // Load agents
  const loadResult = loadAgents(agentsDir);
  if (loadResult.errors.length > 0) {
    for (const err of loadResult.errors) {
      console.error(`[AGENT_LOAD] ${err.file} - ${err.reason}${err.field ? ` (field: ${err.field})` : ''}`);
    }
  }

  // Seed portable YAML agents into SQLite. Runtime state is SQLite-backed.
  const seedErrors = importAgentSeeds(db, loadResult.agents);
  for (const err of seedErrors) {
    console.error(`[AGENT_SEED] ${err.file} - ${err.reason}${err.field ? ` (field: ${err.field})` : ''}`);
  }
  const agents: AgentDefinition[] = loadActiveAgentsFromDb(db);

  // Load skill directories (skills/*/SKILL.md); warn on agents referencing unknown skills
  const skillResult = loadSkills(skillsDir);
  for (const err of skillResult.errors) {
    console.error(`[SKILL_LOAD] ${err.file} - ${err.reason}`);
  }
  importSkillSeeds(db, skillResult.skills);
  const skills = loadCustomSkillsFromDb(db);
  const knownSkills = [...skills, ...BUILTIN_SKILLS];
  const skillNames = new Set(knownSkills.map((s) => s.name));
  for (const agent of agents) {
    for (const ref of agent.skills ?? []) {
      if (!skillNames.has(ref.skill_id) && !knownSkills.some((skill) => skill.id === ref.skill_id)) {
        console.error(`[SKILL_REF] agent "${agent.name}" references unknown skill "${ref.skill_id}" (ignored)`);
      }
    }
  }

  // Create core components
  const sessionManager = new SessionManager(db);
  const eventLogger = sessionManager.getEventLogger();
  const sandboxProvider = new LocalSandboxProvider(dataDir);
  const strategy = new DefaultStrategy();

  // Sandbox provider registry: local always; docker if the CLI is present
  const sandboxRegistry = new SandboxProviderRegistry();
  sandboxRegistry.register(sandboxProvider);
  const dockerAvailable = isDockerAvailable();
  if (dockerAvailable) {
    sandboxRegistry.register(new DockerSandboxProvider());
  }
  // self_hosted: tool calls are dispatched to a user-run Worker via the queue
  const workQueue = new WorkQueue(db);
  sandboxRegistry.register(new SelfHostedSandboxProvider(workQueue));

  const resolveEnvironmentConfig = (environmentId: string): EnvironmentConfig | undefined => {
    const row = db.prepare('SELECT id, name, config FROM environments WHERE id = ? AND archived_at IS NULL').get(environmentId) as
      | { id: string; name: string; config: string } | undefined;
    if (!row) return undefined;
    return normalizeRuntimeEnvironment(row);
  };

  const snapshots = new SnapshotManager(db, join(dataDir, 'snapshots'));

  // Wire executor (with context compaction + skills enabled)
  const executor = new DefaultSessionExecutor({
    agents,
    modelRegistry,
    sandboxProvider,
    sandboxRegistry,
    resolveEnvironmentConfig,
    resolveAgent: (agentId) => loadAgentDefinitionById(db, agentId),
    strategy,
    eventLogger,
    compactor: new ContextCompactor(),
    skills,
    memory,
    snapshots,
  });
  sessionManager.setExecutor(executor);

  // Crash recovery: reconcile any sessions left 'running' by a previous crash
  const reconciled = sessionManager.reconcileOrphans();
  if (reconciled > 0) {
    console.log(`  Recovery:  reconciled ${reconciled} interrupted session(s)`);
  }

  // Resolve API keys (config + MANAGED_AGENTS_API_KEY env). Empty = open.
  const apiKeys = resolveApiKeys(configApiKeys);
  const hasRuntimeApiKeys = () => apiKeys.length > 0 || countActiveManagedApiKeys(db) > 0;
  const validateRuntimeApiKey = (key: string) => apiKeys.includes(key) || validateManagedApiKey(db, key);

  // Observability
  const logStore = new InMemoryLogStore();
  const logger = createLogger({ logStore });
  const metrics = new Metrics();
  let server: ReturnType<typeof serve> | undefined;
  const lifecycle = createRuntimeLifecycle({
    db,
    sessionManager,
    logger,
    getServer: () => server,
  });

  const app = createRuntimeServerApp({
    db,
    sessionManager,
    agents,
    apiKeys,
    hasRuntimeApiKeys,
    validateRuntimeApiKey,
    logger,
    logStore,
    metrics,
    restart: () => lifecycle.stop('restart'),
    workQueue,
    workspace: {
      root: workspaceRoot,
      dataDir,
      agentsDir,
      skillsDir,
      configPath,
      target,
    },
    modelRegistry,
    sandboxRegistry,
    memoryName: memory ? memory.name : 'disabled',
    skills,
    executor,
  });

  // Start the server
  server = serve({
    fetch: app.fetch,
    port,
    hostname: host,
  }, (info) => {
    console.log(`\n  managed-agents v${VERSION}\n`);
    console.log(`  API:       http://${host}:${info.port}/v1`);
    console.log(`  Dashboard: http://${host}:${info.port}/dashboard`);
    console.log(`  Health:    http://${host}:${info.port}/v1/x/health`);
    console.log(`  Agents:    ${agents.length} loaded`);
    console.log(`  Skills:    ${skills.length} loaded`);
    console.log(`  Sandbox:   ${sandboxRegistry.listTypes().join(', ')}`);
    console.log(`  Memory:    ${memory ? memory.name : 'disabled'}`);
    console.log(`  Target:    ${target}`);
    console.log(`  Data:      ${dataDir}`);
    console.log(`  Auth:      ${hasRuntimeApiKeys() ? 'enabled (Bearer token required)' : 'DISABLED (open - localhost only)'}`);
    if (loadResult.errors.length > 0) {
      console.log(`  Warnings:  ${loadResult.errors.length} agent load errors`);
    }
    console.log('');
  });

  // Port-in-use / bind errors: print a clear message and exit (R1.5) rather
  // than crashing with an unhandled 'error' event stack trace.
  server.on('error', (err: NodeJS.ErrnoException) => {
    if (err.code === 'EADDRINUSE') {
      console.error(`Error: [PORT_IN_USE] Port ${port} is already in use.`);
      console.error(`  -> Stop the process using it, or start with --port <other>`);
    } else {
      console.error(`Error: [SERVER] ${err.message}`);
    }
    db.close();
    process.exit(1);
  });

  // Graceful shutdown: stop accepting requests, drain turns + sandboxes, close DB
  process.on('SIGINT', () => void lifecycle.stop('shutdown'));
  process.on('SIGTERM', () => void lifecycle.stop('shutdown'));
}

// ============================================================
// Init Command
// ============================================================

function initProject() {
  const cwd = process.cwd();

  if (existsSync(join(cwd, 'agents'))) {
    console.error('Error: [INIT] agents/ directory already exists. Use a clean directory.');
    process.exit(1);
  }

  // Create directories
  mkdirSync(join(cwd, 'agents'), { recursive: true });
  mkdirSync(join(cwd, 'skills'), { recursive: true });

  // Create example agent
  writeFileSync(
    join(cwd, 'agents', 'assistant.yaml'),
    `name: assistant
model: default
system: |
  You are a helpful assistant. Answer questions clearly and concisely.
skills:
  - type: custom
    skill_id: skill_example-skill
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
    configs:
      - name: read
        enabled: true
      - name: write
        enabled: true
      - name: bash
        enabled: true
        permission_policy:
          type: always_ask
max_turns: 25
temperature: 0.7
`,
  );

  // Create example skill
  mkdirSync(join(cwd, 'skills', 'example-skill'), { recursive: true });
  writeFileSync(
    join(cwd, 'skills', 'example-skill', 'SKILL.md'),
    `---
name: example-skill
description: An example skill showing the SKILL.md format
---

# Example Skill

Replace this with real instructions. Skills are injected into the agent's
system instructions so the model knows the capability up-front.
`,
  );

  // Create config file
  writeFileSync(
    join(cwd, 'managed-agents.config.yaml'),
    `# managed-agents configuration
models:
  - name: default
    provider: openai
    model: gpt-4o
    api_key: \${OPENAI_API_KEY}

environments:
  local:
    sandbox_provider: local
    timeout: 300
`,
  );

  console.log('Initialized managed-agents project:');
  console.log('  agents/assistant.yaml');
  console.log('  skills/');
  console.log('  managed-agents.config.yaml');
  console.log('\nNext: start the runtime, then configure the active model provider boundary in Settings > Models:');
  console.log('  managed-agents start');
  if (process.argv[1]) {
    console.log(`  # source checkout: node ${process.argv[1]} start`);
  }
}

// ============================================================
// Chat Command
// ============================================================

async function chatCommand(
  agentArg: string | undefined,
  opts: { port: string; message?: string; apiKey?: string },
) {
  const { ManagedAgentsClient } = await import('./sdk/client.js');
  const client = new ManagedAgentsClient({
    baseUrl: `http://localhost:${opts.port}`,
    apiKey: opts.apiKey,
  });

  // Resolve the agent (default: first loaded)
  let agent = agentArg;
  try {
    if (!agent) {
      const { data } = await client.agents.list();
      if (data.length === 0) {
        console.error('Error: [CHAT] No agents loaded on the server.');
        process.exit(1);
      }
      agent = data[0].id;
    }
  } catch {
    console.error(`Error: [CHAT] Cannot connect to server on port ${opts.port}`);
    console.error(`  -> Start it with: managed-agents start --port ${opts.port}`);
    process.exit(1);
  }

  const session = await client.sessions.create({ agent: agent! });
  console.log(`Chatting with "${agent}" (session ${session.id}). Ctrl+C to exit.\n`);

  const streamReply = async (text: string) => {
    for await (const ev of client.sessions.chat(session.id, text)) {
      if (ev.type === 'agent.message_chunk') process.stdout.write(ev.delta ?? '');
      else if (ev.type === 'agent.tool_use' || ev.type === 'agent.mcp_tool_use') {
        const b = (ev.content ?? [])[0] as any;
        process.stdout.write(`\n  -> tool: ${b?.name ?? '?'}\n`);
      }
    }
    process.stdout.write('\n');
  };

  // Non-interactive one-shot
  if (opts.message) {
    await streamReply(opts.message);
    return;
  }

  // Interactive REPL
  const readline = await import('node:readline');
  const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
  const ask = () =>
    rl.question('you> ', async (line) => {
      const text = line.trim();
      if (!text) return ask();
      process.stdout.write('agent> ');
      try {
        await streamReply(text);
      } catch (err: any) {
        console.error(`\nError: [CHAT] ${err.message}`);
      }
      ask();
    });
  ask();
}

// ============================================================
// List Command
// ============================================================

async function listAgents(opts: { port: string }) {
  try {
    const res = await fetch(`http://localhost:${opts.port}/v1/agents`);
    if (!res.ok) {
      console.error(`Error: [LIST] Server returned ${res.status}`);
      process.exit(1);
    }
    const body = await res.json() as any;
    if (body.data.length === 0) {
      console.log('No agents loaded.');
      return;
    }
    console.log('Loaded agents:\n');
    for (const agent of body.data) {
      console.log(`  ${agent.id}  ${agent.name}  (model: ${agent.model}, status: ${agent.status})`);
    }
  } catch (err: any) {
    console.error(`Error: [LIST] Cannot connect to server on port ${opts.port}`);
    console.error(`  -> Is the server running? Start with: managed-agents start --port ${opts.port}`);
    process.exit(1);
  }
}

// ============================================================
// Reload Command
// ============================================================

async function reloadAgents(opts: { port: string }) {
  try {
    const res = await fetch(`http://localhost:${opts.port}/v1/x/reload`, { method: 'POST' });
    if (!res.ok) {
      console.error(`Error: [RELOAD] Server returned ${res.status}`);
      process.exit(1);
    }
    const body = await res.json() as any;
    console.log(`Reloaded: ${body.agents_loaded} agents loaded.`);
    if (body.errors?.length > 0) {
      console.log('Errors:');
      for (const err of body.errors) {
        console.log(`  ${err.file}: ${err.reason}`);
      }
    }
  } catch (err: any) {
    console.error(`Error: [RELOAD] Cannot connect to server on port ${opts.port}`);
    console.error(`  -> Is the server running? Start with: managed-agents start --port ${opts.port}`);
    process.exit(1);
  }
}
