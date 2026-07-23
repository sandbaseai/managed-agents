import { Command } from 'commander';
import { join, resolve } from 'node:path';
import { createTemplate, installTemplate, listTemplates, resolveTemplateSource } from '@/core/templates/templates.js';
import { defaultTemplateCacheDir } from '@/core/config/paths.js';

export type StartCommandOptions = {
  port: string;
  host: string;
  dataDir?: string;
  agentsDir: string;
  skillsDir: string;
  config: string;
  target?: string;
};

export type CliHandlers = {
  startServer: (opts: StartCommandOptions) => Promise<void>;
  initProject: () => void;
  listAgents: (opts: { port: string }) => Promise<void>;
  reloadAgents: (opts: { port: string }) => Promise<void>;
  chatCommand: (agent: string | undefined, opts: { port: string; message?: string; apiKey?: string }) => Promise<void>;
  sessionCreate: (opts: { port: string; apiKey?: string; agent?: string; environment?: string; title?: string }) => Promise<void>;
  sessionMessage: (sessionId: string, opts: { port: string; apiKey?: string; message: string; stream?: boolean }) => Promise<void>;
  sessionTail: (sessionId: string, opts: { port: string; apiKey?: string; lastEventId?: string }) => Promise<void>;
  sessionInspect: (sessionId: string, opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  sessionLogs: (sessionId: string, opts: { port: string; apiKey?: string }) => Promise<void>;
  settingsGet: (opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  settingsSetModel: (opts: { port: string; apiKey?: string; json?: boolean; vendor: string; baseUrl?: string; apiKeyEnv?: string }) => Promise<void>;
  settingsValidate: (opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  environmentsList: (opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  environmentInspect: (id: string, opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  environmentCreate: (opts: {
    port: string;
    apiKey?: string;
    json?: boolean;
    name: string;
    description?: string;
    hostingType?: 'cloud' | 'local' | 'self_hosted';
    sandboxProvider?: string;
    configJson?: string;
  }) => Promise<void>;
  environmentUpdate: (id: string, opts: {
    port: string;
    apiKey?: string;
    json?: boolean;
    name?: string;
    description?: string;
    hostingType?: 'cloud' | 'local' | 'self_hosted';
    sandboxProvider?: string;
    configJson?: string;
  }) => Promise<void>;
  environmentArchive: (id: string, opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  environmentWorkerKeys: (id: string, opts: { port: string; apiKey?: string; json?: boolean }) => Promise<void>;
  workspaceList: (opts: { json?: boolean }) => void;
  workspaceCreate: (root: string, opts: { name?: string; dataDir?: string; json?: boolean }) => void;
  workspaceOpen: (root: string, opts: { name?: string; dataDir?: string; json?: boolean }) => void;
  workspaceResolve: (idOrNameOrRoot: string, opts: { json?: boolean }) => void;
  workspaceRemove: (idOrNameOrRoot: string) => void;
  workerPoll: (opts: {
    port: string;
    apiKey?: string;
    environmentId?: string;
    environmentKey?: string;
    workerId?: string;
    workdir: string;
    once?: boolean;
    intervalMs?: string;
  }) => Promise<void>;
};

export function createCliProgram(version: string, handlers: CliHandlers): Command {
  const program = new Command();
  program
    .name('managed-agents')
    .description('Managed Agents runtime - run multi-agent systems locally with any model')
    .version(version);

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
      await handlers.startServer(opts);
    });

  program
    .command('init')
    .description('Initialize a new managed-agents project')
    .action(() => {
      handlers.initProject();
    });

  program
    .command('list')
    .description('List loaded agents')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .action(async (opts) => {
      await handlers.listAgents(opts);
    });

  program
    .command('reload')
    .description('Hot-reload agent definitions')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .action(async (opts) => {
      await handlers.reloadAgents(opts);
    });

  program
    .command('chat [agent]')
    .description('Interactively chat with an agent (streams the reply)')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-m, --message <text>', 'Send a single message and exit (non-interactive)')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .action(async (agent, opts) => {
      await handlers.chatCommand(agent, opts);
    });

  const session = program.command('session').description('Create, inspect, message, and tail sessions');

  session
    .command('create')
    .description('Create a session and print its id')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('-a, --agent <agentId>', 'Agent id (defaults to first loaded agent)')
    .option('-e, --environment <environmentId>', 'Environment id', 'env_default')
    .option('-t, --title <title>', 'Session title')
    .action(async (opts) => {
      await handlers.sessionCreate(opts);
    });

  session
    .command('message <sessionId>')
    .description('Send a message to an existing session')
    .requiredOption('-m, --message <text>', 'Message text')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--no-stream', 'Send without streaming events')
    .action(async (sessionId, opts) => {
      await handlers.sessionMessage(sessionId, opts);
    });

  session
    .command('tail <sessionId>')
    .description('Tail the live session event stream')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--last-event-id <eventId>', 'Resume after an event id')
    .action(async (sessionId, opts) => {
      await handlers.sessionTail(sessionId, opts);
    });

  session
    .command('inspect <sessionId>')
    .description('Inspect session metadata and event count')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (sessionId, opts) => {
      await handlers.sessionInspect(sessionId, opts);
    });

  session
    .command('logs <sessionId>')
    .description('Print persisted session events')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .action(async (sessionId, opts) => {
      await handlers.sessionLogs(sessionId, opts);
    });

  const settings = program.command('settings').description('Read, update, and validate canonical runtime settings');

  settings
    .command('get')
    .description('Show canonical runtime settings')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (opts) => {
      await handlers.settingsGet(opts);
    });

  settings
    .command('set-model')
    .description('Configure the one active model provider boundary')
    .requiredOption('--vendor <vendor>', 'Model vendor, for example anthropic, openai, or openai-compatible')
    .option('--base-url <url>', 'Provider base URL')
    .option('--api-key-env <name>', 'Environment variable name for the provider API key')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (opts) => {
      await handlers.settingsSetModel(opts);
    });

  settings
    .command('validate')
    .description('Validate canonical runtime settings')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (opts) => {
      await handlers.settingsValidate(opts);
    });

  const environments = program.command('environments').alias('envs').description('Manage sandbox environment templates');

  environments
    .command('list')
    .description('List environments')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (opts) => {
      await handlers.environmentsList(opts);
    });

  environments
    .command('inspect <id>')
    .description('Inspect an environment')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (id, opts) => {
      await handlers.environmentInspect(id, opts);
    });

  environments
    .command('create')
    .description('Create an environment template')
    .requiredOption('--name <name>', 'Environment name')
    .option('-d, --description <text>', 'Environment description')
    .option('--hosting-type <type>', 'Hosting type: local, self_hosted, or cloud')
    .option('--sandbox-provider <provider>', 'Sandbox provider, for example local, docker, self_hosted')
    .option('--config-json <json>', 'Additional environment config as a JSON object')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (opts) => {
      await handlers.environmentCreate(opts);
    });

  environments
    .command('update <id>')
    .description('Update an environment template')
    .option('--name <name>', 'Environment name')
    .option('-d, --description <text>', 'Environment description')
    .option('--hosting-type <type>', 'Hosting type: local, self_hosted, or cloud')
    .option('--sandbox-provider <provider>', 'Sandbox provider, for example local, docker, self_hosted')
    .option('--config-json <json>', 'Additional environment config as a JSON object')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (id, opts) => {
      await handlers.environmentUpdate(id, opts);
    });

  environments
    .command('archive <id>')
    .description('Archive an environment')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (id, opts) => {
      await handlers.environmentArchive(id, opts);
    });

  environments
    .command('worker-keys <id>')
    .description('List worker keys for a self-hosted environment')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('--json', 'Print raw JSON', false)
    .action(async (id, opts) => {
      await handlers.environmentWorkerKeys(id, opts);
    });

  const workspace = program.command('workspace').description('Manage local workspace registry entries');

  workspace
    .command('list')
    .description('List registered workspaces')
    .option('--json', 'Print raw JSON', false)
    .action((opts) => {
      handlers.workspaceList(opts);
    });

  workspace
    .command('create <path>')
    .description('Create a workspace folder and register it')
    .option('--name <name>', 'Workspace display name')
    .option('--data-dir <dir>', 'Explicit runtime data directory')
    .option('--json', 'Print raw JSON', false)
    .action((root, opts) => {
      handlers.workspaceCreate(root, opts);
    });

  workspace
    .command('open <path>')
    .description('Register an existing workspace folder')
    .option('--name <name>', 'Workspace display name')
    .option('--data-dir <dir>', 'Explicit runtime data directory')
    .option('--json', 'Print raw JSON', false)
    .action((root, opts) => {
      handlers.workspaceOpen(root, opts);
    });

  workspace
    .command('resolve <idOrNameOrPath>')
    .description('Resolve a workspace registry entry and mark it recently opened')
    .option('--json', 'Print raw JSON', false)
    .action((idOrNameOrRoot, opts) => {
      handlers.workspaceResolve(idOrNameOrRoot, opts);
    });

  workspace
    .command('remove <idOrNameOrPath>')
    .description('Remove a workspace registry entry')
    .action((idOrNameOrRoot) => {
      handlers.workspaceRemove(idOrNameOrRoot);
    });

  const worker = program.command('worker').description('Run self-hosted sandbox workers');

  worker
    .command('poll')
    .description('Poll for self-hosted environment work and execute it locally')
    .option('-p, --port <port>', 'Server port to connect to', '3000')
    .option('-k, --api-key <key>', 'API key if the server has auth enabled')
    .option('-e, --environment-id <environmentId>', 'Environment id to scope polling')
    .option('--environment-key <key>', 'Environment worker key (defaults to MANAGED_AGENTS_ENVIRONMENT_KEY)')
    .option('--worker-id <id>', 'Stable worker id for queue claims')
    .option('--workdir <dir>', 'Worker root directory for read/write/list/exec', '.')
    .option('--once', 'Claim at most one work item and exit', false)
    .option('--interval-ms <ms>', 'Polling interval when no work is available', '1000')
    .action(async (opts) => {
      await handlers.workerPoll(opts);
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

  return program;
}
