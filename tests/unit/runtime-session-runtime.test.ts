import { afterEach, describe, expect, it } from 'vitest';
import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { importAgentSeeds } from '@/core/agent/store.js';
import { ensureDefaultEnvironment } from '@/core/runtime/config-bootstrap.js';
import { bootstrapRuntimeSandboxes } from '@/core/runtime/sandbox-bootstrap.js';
import { createRuntimeSessionServices } from '@/core/runtime/session-runtime.js';
import { LocalArtifactStore } from '@/core/storage/artifact-store.js';
import { ModelRegistry } from '@/model/registry.js';
import { DefaultStrategy } from '@/strategy/default-strategy.js';

describe('runtime session services', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeRuntime() {
    const directory = mkdtempSync(join(tmpdir(), 'ma-session-runtime-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    ensureDefaultEnvironment(db);
    const agents = [{
      name: 'assistant',
      model: 'default',
      system: 'You are helpful.',
    }];
    importAgentSeeds(db, agents);
    const sandboxes = bootstrapRuntimeSandboxes({
      db,
      dataDir: directory,
      dockerAvailable: () => false,
    });
    const modelRegistry = new ModelRegistry();
    modelRegistry.register({
      name: 'default',
      provider: 'openai',
      model: 'gpt-4o',
      is_default: true,
    });
    return { db, directory, agents, sandboxes, modelRegistry };
  }

  it('wires the session manager, executor, snapshots, and crash recovery', () => {
    const { db, directory, agents, sandboxes, modelRegistry } = makeRuntime();
    db.prepare(`
      INSERT INTO sessions (id, agent_id, agent_name, environment_id, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('sess_running', 'agent_assistant', 'assistant', 'env_default', 'running', '{}');

    const services = createRuntimeSessionServices({
      db,
      agents,
      modelRegistry,
      sandboxProvider: sandboxes.sandboxProvider,
      sandboxRegistry: sandboxes.sandboxRegistry,
      runtimeComposition: {
        resolveEnvironmentConfig: () => ({
          name: 'local',
          sandbox_provider: 'local',
          timeout: 300,
        }),
      },
      strategy: new DefaultStrategy(),
      skills: [],
      artifactStore: new LocalArtifactStore(join(directory, 'artifacts')),
      defaultMaxSteps: 25,
    });

    expect(services.reconciled).toBe(1);
    expect(services.executor).toBeDefined();
    expect(services.snapshots).toBeDefined();
    expect(services.sessionManager.get('sess_running')?.status).toBe('paused');
    db.close();
  });
});
