import { describe, expect, it } from 'vitest';
import { bootstrapRuntimeLoopEngine } from '@/core/runtime/loop-engine-bootstrap.js';

const settings = {
  schema_version: 1,
  model: { vendor: 'openai', api_key: '${OPENAI_API_KEY}', options: {} },
  loop_engine: { provider: 'builtin', options: { default_max_steps: 42 } },
  storage: {
    metadata: { provider: 'sqlite', options: {} },
    artifacts: { provider: 'local', options: { base_path: 'files' } },
  },
  memory: { enabled: true, provider: 'sqlite', options: {} },
  sandbox: { provider: 'local', options: { timeout_seconds: 300 } },
} as const;

describe('runtime loop engine bootstrap', () => {
  it('creates the built-in strategy and exposes configured max steps', () => {
    const engine = bootstrapRuntimeLoopEngine(settings);

    expect(engine.defaultMaxSteps).toBe(42);
    expect(engine.strategy.execute).toBeTypeOf('function');
  });

  it('rejects unavailable loop engines', () => {
    expect(() => bootstrapRuntimeLoopEngine({
      ...settings,
      loop_engine: { provider: 'codex', options: { default_max_steps: 25 } },
    })).toThrow(/not available/);
  });
});
