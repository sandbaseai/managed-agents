import { afterEach, describe, expect, it } from 'vitest';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Database } from '@/core/db/database.js';
import { importAgentSeeds } from '@/core/agent/store.js';
import { ensureDefaultEnvironment } from '@/core/runtime/config-bootstrap.js';
import { composeRuntimeFromSettings } from '@/core/runtime/composition.js';
import { bootstrapRuntimeSandboxes } from '@/core/runtime/sandbox-bootstrap.js';
import { createRuntimeSessionServices } from '@/core/runtime/session-runtime.js';
import { getOrSeedRuntimeSettings, saveRuntimeSettings } from '@/core/settings/store.js';
import { LocalArtifactStore } from '@/core/storage/artifact-store.js';
import { ModelRegistry } from '@/model/registry.js';
import { DefaultStrategy } from '@/strategy/default-strategy.js';
import type { AgentStrategy, StrategyContext } from '@/types/strategy.js';
import type { Session } from '@/types/session.js';

describe('runtime session services', () => {
  const directories: string[] = [];

  afterEach(() => {
    for (const directory of directories.splice(0)) rmSync(directory, { recursive: true, force: true });
  });

  function makeRuntime(agentOverrides: Record<string, unknown> = {}) {
    const directory = mkdtempSync(join(tmpdir(), 'ma-session-runtime-'));
    directories.push(directory);
    const db = new Database(join(directory, 'data.db'));
    db.runMigrations();
    ensureDefaultEnvironment(db);
    const agents = [{
      name: 'assistant',
      model: 'default',
      system: 'You are helpful.',
      ...agentOverrides,
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

  it('stores snapshots underneath the configured artifact store', () => {
    const { db, directory, agents, sandboxes, modelRegistry } = makeRuntime();
    const artifactRoot = join(directory, 'configured-artifacts');
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
      artifactStore: new LocalArtifactStore(artifactRoot),
      defaultMaxSteps: 25,
    });
    db.prepare(`
      INSERT INTO sessions (id, agent_id, agent_name, environment_id, status, metadata)
      VALUES (?, ?, ?, ?, ?, ?)
    `).run('sess_snapshot_root', 'agent_assistant', 'assistant', 'env_default', 'running', '{}');
    const workDir = join(directory, 'workdir');
    mkdirSync(workDir, { recursive: true });
    writeFileSync(join(workDir, 'hello.txt'), 'hello snapshot');

    const snapshot = services.snapshots.create('sess_snapshot_root', workDir);

    expect(snapshot.path.startsWith(join(artifactRoot, 'snapshots'))).toBe(true);
    expect(existsSync(snapshot.path)).toBe(true);
    db.close();
  });

  it('passes agent max_turns before workspace default max steps', async () => {
    const captured: number[] = [];
    const { db, directory, agents, sandboxes, modelRegistry } = makeRuntime({ max_turns: 7 });
    const strategy: AgentStrategy = {
      name: 'capture',
      async *execute(context: StrategyContext) {
        captured.push(context.config.maxSteps ?? 0);
      },
    };
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
      strategy,
      skills: [],
      artifactStore: new LocalArtifactStore(join(directory, 'artifacts')),
      defaultMaxSteps: 42,
    });
    const session: Session = {
      id: 'sess_max_turns',
      agentId: 'agent_assistant',
      agentName: 'assistant',
      environmentId: 'env_default',
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    for await (const _event of services.executor.execute(session, {
      type: 'user.message',
      content: [{ type: 'text', text: 'hello' }],
    })) {
      // no-op
    }

    expect(captured).toEqual([7]);
    db.close();
  });

  it('uses workspace default max steps when agent max_turns is absent', async () => {
    const captured: number[] = [];
    const { db, directory, agents, sandboxes, modelRegistry } = makeRuntime();
    const strategy: AgentStrategy = {
      name: 'capture',
      async *execute(context: StrategyContext) {
        captured.push(context.config.maxSteps ?? 0);
      },
    };
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
      strategy,
      skills: [],
      artifactStore: new LocalArtifactStore(join(directory, 'artifacts')),
      defaultMaxSteps: 42,
    });
    const session: Session = {
      id: 'sess_default_steps',
      agentId: 'agent_assistant',
      agentName: 'assistant',
      environmentId: 'env_default',
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    for await (const _event of services.executor.execute(session, {
      type: 'user.message',
      content: [{ type: 'text', text: 'hello' }],
    })) {
      // no-op
    }

    expect(captured).toEqual([42]);
    db.close();
  });

  it('injects Settings V2 sqlite memory through runtime session services', async () => {
    const capturedPrompts: string[] = [];
    const { db, directory, agents, sandboxes } = makeRuntime();
    const initial = getOrSeedRuntimeSettings(db, {}, directory);
    const saved = saveRuntimeSettings(db, {
      ...initial.saved_config,
      model: { ...initial.saved_config.model, api_key: 'model-secret' },
      memory: { enabled: true, provider: 'sqlite', options: {} },
    }, initial.revision, directory);
    expect(saved.ok).toBe(true);
    const modelRegistry = new ModelRegistry();
    const runtime = composeRuntimeFromSettings({
      db,
      dataDir: directory,
      modelRegistry,
      memorySeedEnabled: false,
    });
    expect(runtime.memory?.name).toBe('sqlite');
    await runtime.memory!.add('ctx_settings_memory', 'I prefer Rust for systems work', { source: 'test' });
    const strategy: AgentStrategy = {
      name: 'capture-memory',
      async *execute(context: StrategyContext) {
        capturedPrompts.push(context.systemPrompt);
      },
    };
    const services = createRuntimeSessionServices({
      db,
      agents,
      modelRegistry,
      sandboxProvider: sandboxes.sandboxProvider,
      sandboxRegistry: sandboxes.sandboxRegistry,
      runtimeComposition: runtime,
      strategy,
      skills: [],
      memory: runtime.memory,
      artifactStore: runtime.artifactStore,
      defaultMaxSteps: 25,
    });
    const session: Session = {
      id: 'sess_settings_memory',
      agentId: 'agent_assistant',
      agentName: 'assistant',
      environmentId: 'env_default',
      contextId: 'ctx_settings_memory',
      status: 'running',
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    for await (const _event of services.executor.execute(session, {
      type: 'user.message',
      content: [{ type: 'text', text: 'What should I use for Rust systems work?' }],
    })) {
      // no-op
    }

    expect(capturedPrompts.at(-1)).toContain('Relevant Memory');
    expect(capturedPrompts.at(-1)).toContain('prefer Rust');
    db.close();
  });
});
