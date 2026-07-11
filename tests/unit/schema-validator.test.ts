/**
 * Unit tests for Agent definition schema validation.
 * Validates: Property 1 — Agent definition schema validation completeness.
 */

import { describe, it, expect } from 'vitest';
import { validateAgentDefinition } from '@/core/agent/schema.js';

describe('Agent Definition Schema Validation', () => {
  const validMinimal = {
    name: 'test-agent',
    model: 'gpt-4o',
    system_prompt: 'You are a helpful assistant.',
  };

  describe('valid definitions', () => {
    it('accepts minimal valid definition', () => {
      const result = validateAgentDefinition(validMinimal);
      expect(result.valid).toBe(true);
      expect(result.data).toMatchObject(validMinimal);
    });

    it('accepts full definition with all optional fields', () => {
      const full = {
        ...validMinimal,
        description: 'A test agent',
        skills: ['code-review', 'web-search'],
        mcp_servers: [
          { name: 'filesystem', transport: 'stdio', command: 'npx', args: ['-y', 'server'] },
          { name: 'github', transport: 'http', url: 'http://localhost:3001/mcp' },
        ],
        tools: ['bash', 'read_file'],
        max_turns: 50,
        temperature: 0.7,
        delegations: ['research-analyst'],
        enable_general_subagent: true,
        strategy: 'default',
        environment: 'dev',
      };
      const result = validateAgentDefinition(full);
      expect(result.valid).toBe(true);
    });

    it('accepts agent names with hyphens and underscores', () => {
      const result = validateAgentDefinition({ ...validMinimal, name: 'my_agent-v2' });
      expect(result.valid).toBe(true);
    });
  });

  describe('invalid definitions', () => {
    it('rejects missing name', () => {
      const result = validateAgentDefinition({ model: 'gpt-4o', system_prompt: 'hi' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ path: 'name' }));
    });

    it('rejects missing model', () => {
      const result = validateAgentDefinition({ name: 'test', system_prompt: 'hi' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ path: 'model' }));
    });

    it('rejects missing system_prompt', () => {
      const result = validateAgentDefinition({ name: 'test', model: 'gpt-4o' });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ path: 'system_prompt' }));
    });

    it('rejects empty name', () => {
      const result = validateAgentDefinition({ ...validMinimal, name: '' });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid name characters', () => {
      const result = validateAgentDefinition({ ...validMinimal, name: 'my agent!' });
      expect(result.valid).toBe(false);
    });

    it('rejects invalid temperature (> 2)', () => {
      const result = validateAgentDefinition({ ...validMinimal, temperature: 3.0 });
      expect(result.valid).toBe(false);
      expect(result.errors).toContainEqual(expect.objectContaining({ path: 'temperature' }));
    });

    it('rejects invalid max_turns (negative)', () => {
      const result = validateAgentDefinition({ ...validMinimal, max_turns: -1 });
      expect(result.valid).toBe(false);
    });

    it('rejects stdio mcp_server without command', () => {
      const result = validateAgentDefinition({
        ...validMinimal,
        mcp_servers: [{ name: 'test', transport: 'stdio' }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects http mcp_server without url', () => {
      const result = validateAgentDefinition({
        ...validMinimal,
        mcp_servers: [{ name: 'test', transport: 'http' }],
      });
      expect(result.valid).toBe(false);
    });

    it('rejects completely empty object', () => {
      const result = validateAgentDefinition({});
      expect(result.valid).toBe(false);
      expect(result.errors!.length).toBeGreaterThanOrEqual(3);
    });

    it('rejects null input', () => {
      const result = validateAgentDefinition(null);
      expect(result.valid).toBe(false);
    });
  });

  describe('error structure', () => {
    it('provides field path in errors', () => {
      const result = validateAgentDefinition({ name: 123, model: 'x', system_prompt: 'y' });
      expect(result.valid).toBe(false);
      expect(result.errors![0].path).toBe('name');
      expect(result.errors![0].message).toBeTruthy();
    });
  });
});
