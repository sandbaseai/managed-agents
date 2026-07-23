import { describe, expect, it } from 'vitest';
import { normalizeRuntimeEnvironment } from '@/core/runtime/environment.js';

describe('runtime environment normalization', () => {
  it('defaults to local sandbox with a stable timeout', () => {
    expect(normalizeRuntimeEnvironment({
      id: 'env_default',
      name: 'local',
      config: '{}',
    })).toMatchObject({
      name: 'local',
      sandbox_provider: 'local',
      timeout: 300,
    });
  });

  it('maps self-hosted hosting type to self_hosted sandbox provider', () => {
    expect(normalizeRuntimeEnvironment({
      id: 'env_worker',
      name: 'worker',
      config: '{"hosting_type":"self_hosted","timeout":120}',
    })).toMatchObject({
      name: 'worker',
      sandbox_provider: 'self_hosted',
      timeout: 120,
    });
  });

  it('preserves explicit valid sandbox provider and config name', () => {
    expect(normalizeRuntimeEnvironment({
      id: 'env_docker',
      name: 'fallback',
      config: '{"name":"docker dev","sandbox_provider":"docker","network":{"type":"limited"}}',
    })).toMatchObject({
      name: 'docker dev',
      sandbox_provider: 'docker',
      network: { type: 'limited' },
    });
  });
});
