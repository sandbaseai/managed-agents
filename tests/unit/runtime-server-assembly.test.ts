import { mkdtempSync, rmSync } from 'node:fs';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { afterEach, describe, expect, it } from 'vitest';
import { Database } from '@/core/db/database.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { InMemoryLogStore } from '@/core/observability/logger.js';
import { Metrics } from '@/core/observability/metrics.js';
import { ModelRegistry } from '@/model/registry.js';
import { SandboxProviderRegistry } from '@/sandbox/registry.js';
import { LocalSandboxProvider } from '@/sandbox/local-provider.js';
import { WorkQueue } from '@/sandbox/self-hosted-provider.js';
import { createRuntimeServerApp } from '@/core/runtime/server-assembly.js';

describe('runtime server assembly', () => {
  let tmpDir: string | undefined;
  let db: Database | undefined;

  afterEach(() => {
    db?.close();
    db = undefined;
    if (tmpDir) rmSync(tmpDir, { recursive: true, force: true });
    tmpDir = undefined;
  });

  it('wires workspace, runtime, model registry, metrics, and auth state into the API app', async () => {
    tmpDir = mkdtempSync(join(tmpdir(), 'ma-server-assembly-'));
    db = new Database(join(tmpDir, 'data.db'));
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{}')`);
    const sessionManager = new SessionManager(db);
    const modelRegistry = new ModelRegistry();
    modelRegistry.register({ name: 'default', provider: 'openai', model: 'gpt-test', is_default: true });
    const sandboxRegistry = new SandboxProviderRegistry();
    sandboxRegistry.register(new LocalSandboxProvider(tmpDir));
    const logStore = new InMemoryLogStore();

    const app = createRuntimeServerApp({
      db,
      sessionManager,
      agents: [],
      apiKeys: ['ma_static'],
      hasRuntimeApiKeys: () => true,
      validateRuntimeApiKey: (key) => key === 'ma_static',
      logger: { info: () => undefined, warn: () => undefined, error: () => undefined, debug: () => undefined },
      logStore,
      metrics: new Metrics(),
      restart: () => undefined,
      workQueue: new WorkQueue(db),
      workspace: {
        root: tmpDir,
        dataDir: join(tmpDir, 'data'),
        agentsDir: join(tmpDir, 'agents'),
        skillsDir: join(tmpDir, 'skills'),
        configPath: join(tmpDir, 'managed-agents.config.yaml'),
        target: 'local',
      },
      modelRegistry,
      sandboxRegistry,
      memoryName: 'sqlite',
      skills: [],
      executor: { getMcpStatus: () => [] } as any,
    });

    const runtimeRes = await app.request('/v1/x/runtime', {
      headers: { Authorization: 'Bearer ma_static' },
    });
    expect(runtimeRes.status).toBe(200);
    const runtime = await runtimeRes.json();
    expect(runtime).toMatchObject({
      type: 'runtime',
      memory: 'sqlite',
      auth_enabled: true,
    });
    expect(runtime.models[0]).toMatchObject({ name: 'default', model: 'gpt-test' });

    const workspaceRes = await app.request('/v1/x/workspace', {
      headers: { Authorization: 'Bearer ma_static' },
    });
    expect(workspaceRes.status).toBe(200);
    const workspace = await workspaceRes.json();
    expect(workspace.directories.root).toBe(tmpDir);
  });
});
