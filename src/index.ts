/**
 * managed-agents - Entry Point
 *
 * Managed Agents runtime.
 * CLI commands: start (default), init, list, reload
 */

import { Command } from 'commander';
import { serve } from '@hono/node-server';
import { spawn } from 'node:child_process';
import { existsSync, readFileSync, mkdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { nanoid } from 'nanoid';
import { parse as parseYaml } from 'yaml';

import { Database } from './core/db/database.js';
import { SessionManager } from './core/session/session-manager.js';
import { DefaultSessionExecutor } from './core/session/executor.js';
import { loadAgents } from './core/agent/loader.js';
import { importAgentSeeds, loadActiveAgentsFromDb, loadAgentDefinitionById, refreshAgentsFromDb } from './core/agent/store.js';
import { loadSkills } from './core/skills/loader.js';
import { BUILTIN_SKILLS } from './core/skills/catalog.js';
import { importSkillSeeds, loadCustomSkillsFromDb } from './core/skills/store.js';
import { listModelProviders, seedModelProviders } from './core/model/providers.js';
import { installTemplate, createTemplate, listTemplates, resolveTemplateSource } from './core/templates/templates.js';
import { ModelRegistry } from './model/registry.js';
import { LocalSandboxProvider } from './sandbox/local-provider.js';
import { DockerSandboxProvider, isDockerAvailable } from './sandbox/docker-provider.js';
import { SandboxProviderRegistry } from './sandbox/registry.js';
import { SelfHostedSandboxProvider, WorkQueue } from './sandbox/self-hosted-provider.js';
import { DefaultStrategy } from './strategy/default-strategy.js';
import { ContextCompactor } from './core/session/context-compactor.js';
import { SqliteMemoryProvider } from './core/memory/sqlite-memory-provider.js';
import type { MemoryProvider } from './core/memory/memory-provider.js';
import { SnapshotManager } from './core/session/snapshot-manager.js';
import { createServer } from './api/server.js';
import { resolveEnvVars } from './core/config/env-resolver.js';
import { defaultTemplateCacheDir, resolveDataDir, resolveUserPath } from './core/config/paths.js';
import { resolveApiKeys } from './api/auth.js';
import { countActiveManagedApiKeys, validateManagedApiKey } from './core/auth/api-keys.js';
import { createLogger, InMemoryLogStore } from './core/observability/logger.js';
import { Metrics } from './core/observability/metrics.js';
import type { AgentDefinition } from './types/agent.js';
import type { ModelConfig } from './types/model.js';
import type { EnvironmentConfig, SandboxProviderType } from './types/sandbox.js';

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

  // Ensure default environment exists
  const envCheck = db.prepare('SELECT id FROM environments WHERE id = ?').get('env_default');
  if (!envCheck) {
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{"sandbox_provider":"local","timeout":300}')`);
  }

  // Load config file
  const modelRegistry = new ModelRegistry();
  let configApiKeys: string[] = [];
  let configModels: ModelConfig[] = [];
  let memory: MemoryProvider | undefined;
  if (existsSync(configPath)) {
    const configContent = readFileSync(configPath, 'utf-8');
    const config = parseYaml(configContent) as any;

    // API keys (auth): resolve ${ENV_VAR} refs in configured keys
    if (Array.isArray(config.api_keys)) {
      configApiKeys = config.api_keys
        .map((k: string) => (typeof k === 'string' ? resolveEnvVars(k, false) : ''))
        .filter(Boolean);
    }

    // Memory provider (optional). Built-in `sqlite` provider; adapters (mem0/
    // memU) can be plugged in later. Disabled unless memory.provider is set.
    if (config.memory?.provider === 'sqlite') {
      memory = new SqliteMemoryProvider(db);
    }

    // Register base models, then apply target overrides (R13.3/13.4). The same
    // config runs locally or in the cloud; `overrides.<target>.models` layers
    // target-specific model settings (e.g. different base_url/api_key) on top,
    // matched by model `name`. Selected via `--target local|cloud`.
    const baseModels: any[] = Array.isArray(config.models) ? config.models : [];
    const overrideModels: any[] = config.overrides?.[target]?.models ?? [];
    const merged = new Map<string, any>();
    for (const m of baseModels) merged.set(m.name, m);
    for (const m of overrideModels) merged.set(m.name, { ...merged.get(m.name), ...m });
    configModels = [...merged.values()].map((m) => ({
        name: m.name,
        provider: m.provider,
        model: m.model,
        base_url: m.base_url,
        api_key: m.api_key,
        is_default: Boolean(m.is_default),
      }) as ModelConfig);

    // Load environments
    if (config.environments && typeof config.environments === 'object') {
      for (const [name, envConfig] of Object.entries(config.environments as Record<string, any>)) {
        const envId = `env_${nanoid(18)}`;
        const existing = db.prepare('SELECT id FROM environments WHERE name = ?').get(name);
        if (!existing) {
          db.prepare('INSERT INTO environments (id, name, config) VALUES (?, ?, ?)').run(
            envId,
            name,
            JSON.stringify(envConfig),
          );
        }
      }
    }
  }

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
  let shuttingDown = false;

  const stopRuntime = async (mode: 'shutdown' | 'restart') => {
    if (shuttingDown) return;
    shuttingDown = true;
    const restarting = mode === 'restart';
    logger.warn(restarting ? 'runtime_restart_requested' : 'runtime_shutdown_requested', {
      source: 'runtime',
    });
    console.log(restarting ? '\nRestarting runtime...' : '\nShutting down...');
    if (server) {
      await new Promise<void>((resolveClose) => {
        server?.close((err?: Error) => {
          if (err) {
            logger.warn('http_server_close_failed', {
              error: err.message,
            });
          }
          resolveClose();
        });
      });
    }
    try {
      await sessionManager.shutdown();
    } catch (err: any) {
      logger.error('session_manager_shutdown_failed', {
        error: err?.message ?? String(err),
      });
    }
    db.close();

    if (restarting) {
      try {
        const child = spawn(process.execPath, process.argv.slice(1), {
          cwd: process.cwd(),
          env: process.env,
          stdio: 'ignore',
          detached: true,
        });
        child.unref();
      } catch (err: any) {
        logger.error('runtime_restart_spawn_failed', {
          error: err?.message ?? String(err),
        });
        process.exit(1);
      }
    }

    process.exit(0);
  };

  // Create HTTP server
  const app = createServer({
    db,
    sessionManager,
    agents,
    apiKeys,
    hasApiKeys: hasRuntimeApiKeys,
    validateApiKey: validateRuntimeApiKey,
    logger,
    logStore,
    metrics,
    restart: () => stopRuntime('restart'),
    workQueue,
    workspace: {
      root: workspaceRoot,
      dataDir,
      agentsDir,
      skillsDir,
      configPath,
      target,
    },
    runtime: {
      models: modelRegistry.listRuntimeInfo(),
      sandboxProviders: sandboxRegistry.listTypes(),
      memory: memory ? memory.name : 'disabled',
      authEnabled: apiKeys.length > 0,
    },
    listRuntimeModels: () => modelRegistry.listRuntimeInfo(),
    registerModelProvider: (config) => modelRegistry.register(config),
    setDefaultRuntimeModel: (name) => modelRegistry.setDefault(name),
    skills,
    getMcpStatus: (sessionId) => executor.getMcpStatus(sessionId),
    reloadAgents: () => {
      const result = loadAgents(agentsDir);
      importAgentSeeds(db, result.agents);
      const activeAgents = refreshAgentsFromDb(db, agents);
      return { agents: activeAgents, errors: result.errors };
    },
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
  process.on('SIGINT', () => void stopRuntime('shutdown'));
  process.on('SIGTERM', () => void stopRuntime('shutdown'));
}

function normalizeRuntimeEnvironment(row: { id: string; name: string; config: string }): EnvironmentConfig {
  const parsed = parseJsonObject(row.config);
  const sandboxProvider = parseSandboxProvider(parsed.sandbox_provider)
    ?? (parsed.hosting_type === 'self_hosted' ? 'self_hosted' : 'local');

  return {
    ...parsed,
    name: typeof parsed.name === 'string' && parsed.name.trim() ? parsed.name.trim() : row.name || row.id,
    sandbox_provider: sandboxProvider,
    timeout: typeof parsed.timeout === 'number' ? parsed.timeout : 300,
  };
}

function parseSandboxProvider(value: unknown): SandboxProviderType | undefined {
  return value === 'local'
    || value === 'docker'
    || value === 'e2b'
    || value === 'daytona'
    || value === 'self_hosted'
    ? value
    : undefined;
}

function parseJsonObject(value: string): Record<string, any> {
  try {
    const parsed = JSON.parse(value);
    return parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed : {};
  } catch {
    return {};
  }
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
