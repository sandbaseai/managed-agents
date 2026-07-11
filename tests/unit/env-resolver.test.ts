/**
 * Unit tests for environment variable resolver.
 * Validates: Property 13 — Environment variable reference resolution.
 */

import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  resolveEnvVars,
  resolveEnvVarsDeep,
  EnvVarNotFoundError,
} from '@/core/config/env-resolver.js';

describe('Environment Variable Resolver', () => {
  const originalEnv = process.env;

  beforeEach(() => {
    process.env = { ...originalEnv };
    process.env['TEST_KEY'] = 'test-value';
    process.env['API_KEY'] = 'sk-123456';
    process.env['BASE_URL'] = 'http://localhost:11434';
  });

  afterEach(() => {
    process.env = originalEnv;
  });

  describe('resolveEnvVars', () => {
    it('resolves single variable', () => {
      expect(resolveEnvVars('${TEST_KEY}')).toBe('test-value');
    });

    it('resolves multiple variables in one string', () => {
      expect(resolveEnvVars('${BASE_URL}/v1/${TEST_KEY}')).toBe(
        'http://localhost:11434/v1/test-value',
      );
    });

    it('leaves strings without placeholders unchanged', () => {
      expect(resolveEnvVars('no-variables-here')).toBe('no-variables-here');
    });

    it('throws EnvVarNotFoundError for missing required variable', () => {
      expect(() => resolveEnvVars('${MISSING_VAR}', true)).toThrow(EnvVarNotFoundError);
    });

    it('leaves placeholder unchanged when not required', () => {
      expect(resolveEnvVars('${MISSING_VAR}', false)).toBe('${MISSING_VAR}');
    });

    it('handles empty string', () => {
      expect(resolveEnvVars('')).toBe('');
    });

    it('handles adjacent variables', () => {
      expect(resolveEnvVars('${TEST_KEY}${API_KEY}')).toBe('test-valuesk-123456');
    });
  });

  describe('resolveEnvVarsDeep', () => {
    it('resolves variables in nested objects', () => {
      const input = {
        url: '${BASE_URL}',
        auth: { key: '${API_KEY}' },
      };
      const result = resolveEnvVarsDeep(input);
      expect(result).toEqual({
        url: 'http://localhost:11434',
        auth: { key: 'sk-123456' },
      });
    });

    it('resolves variables in arrays', () => {
      const input = ['${TEST_KEY}', '${API_KEY}'];
      const result = resolveEnvVarsDeep(input);
      expect(result).toEqual(['test-value', 'sk-123456']);
    });

    it('leaves non-string values unchanged', () => {
      const input = { port: 3000, enabled: true, tags: null };
      const result = resolveEnvVarsDeep(input, false);
      expect(result).toEqual(input);
    });

    it('handles deeply nested structures', () => {
      const input = {
        servers: [{ env: { TOKEN: '${API_KEY}' } }],
      };
      const result = resolveEnvVarsDeep(input);
      expect(result.servers[0].env.TOKEN).toBe('sk-123456');
    });
  });
});
