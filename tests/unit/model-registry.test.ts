import { describe, expect, it } from 'vitest';
import { ModelRegistry } from '@/model/registry.js';

describe('ModelRegistry runtime introspection', () => {
  it('returns safe model metadata without secrets', () => {
    const registry = new ModelRegistry();
    registry.register({
      name: 'configured',
      provider: 'openai',
      model: 'gpt-4o',
      api_key: 'secret-value',
      base_url: '${MISSING_BASE_URL}',
    });

    const models = registry.listRuntimeInfo();

    expect(models).toEqual([{
      name: 'configured',
      provider: 'openai',
      model: 'gpt-4o',
      api_key_state: 'configured',
      base_url_state: 'missing_env',
      is_default: true,
    }]);
    expect(JSON.stringify(models)).not.toContain('secret-value');
    expect(JSON.stringify(models)).not.toContain('MISSING_BASE_URL');
  });
});
