import { existsSync } from 'node:fs';
import { mkdtemp } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawn, spawnSync } from 'node:child_process';
import { createServer } from 'node:net';

const root = resolve(import.meta.dirname, '..');
const cli = join(root, 'dist', 'index.js');

if (!existsSync(cli)) {
  fail('dist/index.js is missing. Run `npm run build` before the release smoke test.');
}

await smokeInit();
await smokeExampleProject();

console.log('release smoke: ok');

async function smokeInit() {
  const workspace = await mkdtemp(join(tmpdir(), 'managed-agents-init-'));
  const result = spawnSync(process.execPath, [cli, 'init'], {
    cwd: workspace,
    encoding: 'utf8',
  });

  if (result.status !== 0) {
    fail(`managed-agents init failed\n${result.stdout}\n${result.stderr}`);
  }

  for (const relativePath of [
    'managed-agents.config.yaml',
    'agents/assistant.yaml',
    'skills/example-skill/SKILL.md',
  ]) {
    if (!existsSync(join(workspace, relativePath))) {
      fail(`managed-agents init did not create ${relativePath}`);
    }
  }
}

async function smokeExampleProject() {
  const dataDir = await mkdtemp(join(tmpdir(), 'managed-agents-example-data-'));
  const port = await findFreePort();
  const child = spawn(process.execPath, [
    cli,
    'start',
    '--host',
    '127.0.0.1',
    '--port',
    String(port),
    '--data-dir',
    dataDir,
    '--config',
    'managed-agents.config.yaml',
    '--agents-dir',
    'agents',
    '--skills-dir',
    'skills',
  ], {
    cwd: join(root, 'examples', 'basic'),
    env: {
      ...process.env,
      OPENAI_BASE_URL: process.env.OPENAI_BASE_URL ?? 'http://127.0.0.1:9/v1',
      OPENAI_API_KEY: process.env.OPENAI_API_KEY ?? 'smoke-test-key',
    },
    stdio: ['ignore', 'pipe', 'pipe'],
  });

  let output = '';
  child.stdout.on('data', (chunk) => {
    output += chunk.toString();
  });
  child.stderr.on('data', (chunk) => {
    output += chunk.toString();
  });

  try {
    await waitFor(async () => {
      const response = await fetch(`http://127.0.0.1:${port}/v1/x/health`);
      if (!response.ok) throw new Error(`health returned ${response.status}`);
      const agents = await fetch(`http://127.0.0.1:${port}/v1/agents`);
      if (!agents.ok) throw new Error(`agents returned ${agents.status}`);
      const body = await agents.json();
      if (!Array.isArray(body.data) || body.data.length < 1) {
        throw new Error('example project loaded no agents');
      }
    }, 10_000);
  } catch (error) {
    fail(`examples/basic smoke failed: ${error.message}\n${output}`);
  } finally {
    child.kill('SIGTERM');
    await new Promise((resolveChild) => {
      const timeout = setTimeout(resolveChild, 1_000);
      child.once('exit', () => {
        clearTimeout(timeout);
        resolveChild();
      });
    });
  }
}

async function waitFor(fn, timeoutMs) {
  const start = Date.now();
  let lastError;
  while (Date.now() - start < timeoutMs) {
    try {
      await fn();
      return;
    } catch (error) {
      lastError = error;
      await new Promise((resolveTimeout) => setTimeout(resolveTimeout, 200));
    }
  }
  throw lastError ?? new Error('timed out');
}

async function findFreePort() {
  const server = createServer();
  await new Promise((resolveListen, rejectListen) => {
    server.once('error', rejectListen);
    server.listen(0, '127.0.0.1', resolveListen);
  });
  const address = server.address();
  const port = typeof address === 'object' && address ? address.port : undefined;
  await new Promise((resolveClose) => server.close(resolveClose));
  if (!port) fail('could not allocate a free localhost port');
  return port;
}

function fail(message) {
  console.error(message);
  process.exit(1);
}
