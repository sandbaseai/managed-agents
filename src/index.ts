/**
 * managed-agents - Entry Point
 *
 * Managed Agents runtime.
 * CLI commands: start (default), init, list, reload
 */

import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { Database } from './core/db/database.js';
import { installTemplate, createTemplate, listTemplates, resolveTemplateSource } from './core/templates/templates.js';
import { DefaultStrategy } from './strategy/default-strategy.js';
import { createServer } from './api/server.js';
import { defaultTemplateCacheDir, resolveDataDir, resolveUserPath } from './core/config/paths.js';
import { composeRuntimeFromSettings } from './core/runtime/composition.js';
import { ensureDefaultEnvironment, loadRuntimeConfigBootstrap } from './core/runtime/config-bootstrap.js';
import { createRuntimeStopper } from './core/runtime/lifecycle.js';
import { loadRuntimeAgentSkillState, reloadRuntimeAgents } from './core/runtime/agent-skill-bootstrap.js';
import { bootstrapRuntimeModelRegistry } from './core/runtime/model-bootstrap.js';
import { bootstrapRuntimeSandboxes } from './core/runtime/sandbox-bootstrap.js';
import { resolveRuntimeApiAuth } from './core/runtime/api-auth.js';
import { createRuntimeSessionServices } from './core/runtime/session-runtime.js';
import { attachRuntimeServerErrorHandler, parseCsv, runtimeStartupBannerLines } from './core/runtime/http-server.js';
import { createLogger, InMemoryLogStore } from './core/observability/logger.js';
import { Metrics } from './core/observability/metrics.js';

const VERSION = '0.1.0';

// ============================================================
// CLI
// ============================================================

const program = new Command();
program
  .name('managed-agents')
  .description('Managed Agents runtime - run multi-agent systems locally with any model')
  .version(VERSION);

// Default command: start
program
  .command('start', { isDefault: true })
  .description('Start the managed-agents server')
  .option('-p, --port <port>', 'Server port', '3000')
  .option('--host <host>', 'Server host', '127.0.0.1')
  .option('-d, --data-dir <dir>', 'Data directory (default: ~/.managed-agents/<workspace>)')
  .option('--agents-dir <dir>', 'Agents directory', 'agents')
  .option('--skills-dir <dir>', 'Skills directory', 'skills')
  .option('-c, --config <file>', 'Config file path', 'managed-agents.config.yaml')
  .option('--target <target>', 'Deployment target for config overrides (local|cloud)', 'local')
  .action(async (opts) => {
    await startServer(opts);
  });

program
  .command('init')
  .description('Initialize a new managed-agents project')
  .action(() => {
    initProject();
  });

program
  .command('list')
  .description('List loaded agents')
  .option('-p, --port <port>', 'Server port to connect to', '3000')
  .action(async (opts) => {
    await listAgents(opts);
  });

program
  .command('reload')
  .description('Hot-reload agent definitions')
  .option('-p, --port <port>', 'Server port to connect to', '3000')
  .action(async (opts) => {
    await reloadAgents(opts);
  });

program
  .command('chat [agent]')
  .description('Interactively chat with an agent (streams the reply)')
  .option('-p, --port <port>', 'Server port to connect to', '3000')
  .option('-m, --message <text>', 'Send a single message and exit (non-interactive)')
  .option('-k, --api-key <key>', 'API key if the server has auth enabled')
  .action(async (agent, opts) => {
    await chatCommand(agent, opts);
  });

program
  .command('deploy')
  .description('Show cloud deployment guidance (v1 placeholder)')
  .action(() => {
    console.log('managed-agents deploy\n');
    console.log('Agent definitions are portable - the same agents/ and skills/');
    console.log('run locally and in the cloud with no changes (Requirement 13).\n');
    console.log('v1 does not push to a hosted service yet. To deploy today:');
    console.log('  1. Build:   npm run build');
    console.log('  2. Package: ship dist/ + agents/ + skills/ + managed-agents.config.yaml');
    console.log('  3. Run:     node dist/index.js start --port $PORT');
    console.log('  4. Add model providers in Dashboard Settings > Models, or seed a new');
    console.log('     workspace from managed-agents.config.yaml.');
    console.log('  5. Or containerize with any Node 22+ base image.\n');
    console.log('Runtime provider settings are stored in SQLite under the data directory.');
  });

const template = program.command('template').description('Manage solution templates');

template
  .command('list')
  .description('List available templates in a local templates directory')
  .option('--repo <dir>', 'Templates directory', 'templates')
  .action((opts) => {
    const items = listTemplates(resolve(opts.repo));
    if (items.length === 0) {
      console.log('No templates found.');
      return;
    }
    for (const t of items) {
      console.log(`  ${t.name}  - ${t.description ?? ''}`);
    }
  });

template
  .command('install <templateNameOrPath>')
  .description('Install a template into the current project (local path or remote name)')
  .option('--force', 'Overwrite existing files', false)
  .option('--repo <repo>', 'GitHub repo for remote templates (owner/name)')
  .action(async (nameOrPath: string, opts) => {
    try {
      // Local path if it exists; otherwise fetch from the (default/official) repo
      const source = await resolveTemplateSource(nameOrPath, {
        repo: opts.repo,
        cacheDir: defaultTemplateCacheDir(),
      });
      const result = installTemplate(source, process.cwd(), { force: opts.force });
      console.log(`Installed ${result.installed.length} file(s).`);
      for (const f of result.installed) console.log(`  + ${f}`);
      if (result.skipped.length > 0) {
        console.log(`Skipped ${result.skipped.length} existing file(s) (use --force to overwrite):`);
        for (const f of result.skipped) console.log(`  - ${f}`);
      }
    } catch (err: any) {
      console.error(`Error: [TEMPLATE_INSTALL] ${err.message}`);
      process.exit(1);
    }
  });

template
  .command('create <name>')
  .description('Export the current project (agents/skills) as a template')
  .option('-o, --out <dir>', 'Output template directory')
  .option('-d, --description <text>', 'Template description', '')
  .action((name: string, opts) => {
    try {
      const out = resolve(opts.out ?? join('templates', name));
      const result = createTemplate(process.cwd(), out, { name, description: opts.description });
      console.log(`Created template "${name}" at ${out} (${result.files.length} files).`);
    } catch (err: any) {
      console.error(`Error: [TEMPLATE_CREATE] ${err.message}`);
      process.exit(1);
    }
  });

program.parse();

// ============================================================
// Start Server
// ============================================================

async function startServer(opts: { port: string; host: string; dataDir?: string; agentsDir: string; skillsDir: string; config: string; target?: string }) {
  const port = parseInt(opts.port, 10);
  const host = opts.host;
  const workspaceRoot = process.cwd();
  const dataDir = resolveDataDir(opts.dataDir, workspaceRoot);
  const agentsDir = resolveUserPath(opts.agentsDir, workspaceRoot);
  const skillsDir = resolveUserPath(opts.skillsDir, workspaceRoot);
  const configPath = resolveUserPath(opts.config, workspaceRoot);
  const target = opts.target ?? 'local';

  // Initialize data directory
  mkdirSync(dataDir, { recursive: true });

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

  // Settings V2 is seeded after legacy config/import data exists, then becomes
  // the runtime source for settings that have a shipped adapter.
  const runtimeComposition = composeRuntimeFromSettings({
    db,
    dataDir,
    modelRegistry,
    memorySeedEnabled: Boolean(configBootstrap.memory),
  });
  const effectiveSettings = runtimeComposition.settings.effective_config;
  const memory = runtimeComposition.memory;

  const strategy = new DefaultStrategy();
  const { sandboxProvider, sandboxRegistry, workQueue } = bootstrapRuntimeSandboxes({ db, dataDir });
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
    strategy,
    skills,
    memory,
    artifactStore,
    defaultMaxSteps: effectiveSettings.loop_engine.options.default_max_steps,
  });
  if (reconciled > 0) {
    console.log(`  Recovery:  reconciled ${reconciled} interrupted session(s)`);
  }

  const runtimeApiAuth = resolveRuntimeApiAuth({ db, configKeys: configBootstrap.apiKeys });

  // Observability
  const logStore = new InMemoryLogStore();
  const logger = createLogger({ logStore });
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
      agentsDir,
      skillsDir,
      configPath,
      target,
    },
    artifactStorageDir: () => artifactStore.rootPath(),
    artifactStore: () => artifactStore,
    runtime: {
      models: modelRegistry.listRuntimeInfo(),
      sandboxProviders: sandboxRegistry.listTypes(),
      memory: memory ? memory.name : 'disabled',
      authEnabled: runtimeApiAuth.apiKeys.length > 0,
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
  console.log('\nNext: start the runtime, then add a model provider in Dashboard Settings > Models:');
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
