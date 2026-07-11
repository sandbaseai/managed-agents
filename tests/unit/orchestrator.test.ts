/**
 * Unit tests for the Agent Orchestrator delegation helpers (R3, Properties 4 & 5).
 */

import { describe, it, expect } from 'vitest';
import {
  detectCycle,
  validateDelegation,
  DelegationError,
  rootDelegationContext,
  childDelegationContext,
  DEFAULT_MAX_DELEGATION_DEPTH,
} from '@/core/orchestrator/agent-orchestrator.js';

describe('Agent Orchestrator', () => {
  describe('detectCycle (Property 4)', () => {
    it('detects a target already in the chain', () => {
      expect(detectCycle(['a', 'b', 'c'], 'a')).toBe(true);
      expect(detectCycle(['a', 'b'], 'b')).toBe(true);
    });

    it('allows a fresh target', () => {
      expect(detectCycle(['a', 'b'], 'c')).toBe(false);
    });
  });

  describe('validateDelegation', () => {
    const base = {
      fromAgent: 'a',
      toAgent: 'b',
      chain: ['a'],
      depth: 0,
      maxDepth: 5,
      allowedTargets: ['b'],
      loadedAgentNames: ['a', 'b'],
    };

    it('passes a valid delegation', () => {
      expect(() => validateDelegation(base)).not.toThrow();
    });

    it('rejects when depth limit reached (Property 5)', () => {
      expect(() => validateDelegation({ ...base, depth: 5, maxDepth: 5 })).toThrow(DelegationError);
      try {
        validateDelegation({ ...base, depth: 5, maxDepth: 5 });
      } catch (e) {
        expect((e as DelegationError).code).toBe('max_depth');
      }
    });

    it('rejects target not in the allowed roster', () => {
      try {
        validateDelegation({ ...base, allowedTargets: ['c'] });
        expect.fail('should throw');
      } catch (e) {
        expect((e as DelegationError).code).toBe('not_allowed');
      }
    });

    it('rejects target that is not loaded', () => {
      try {
        validateDelegation({ ...base, loadedAgentNames: ['a'] });
        expect.fail('should throw');
      } catch (e) {
        expect((e as DelegationError).code).toBe('not_found');
      }
    });

    it('rejects a cycle (Property 4)', () => {
      try {
        validateDelegation({ ...base, toAgent: 'a', allowedTargets: ['a'], chain: ['a'] });
        expect.fail('should throw');
      } catch (e) {
        expect((e as DelegationError).code).toBe('cycle');
      }
    });
  });

  describe('delegation context', () => {
    it('root starts at depth 0 with the root in the chain', () => {
      const ctx = rootDelegationContext('root');
      expect(ctx.depth).toBe(0);
      expect(ctx.chain).toEqual(['root']);
      expect(ctx.maxDepth).toBe(DEFAULT_MAX_DELEGATION_DEPTH);
    });

    it('child increments depth and extends the chain', () => {
      const root = rootDelegationContext('root');
      const child = childDelegationContext(root, 'worker');
      expect(child.depth).toBe(1);
      expect(child.chain).toEqual(['root', 'worker']);

      const grandchild = childDelegationContext(child, 'helper');
      expect(grandchild.depth).toBe(2);
      expect(grandchild.chain).toEqual(['root', 'worker', 'helper']);
    });

    it('enforces depth limit across nested contexts', () => {
      let ctx = rootDelegationContext('a', 3);
      ctx = childDelegationContext(ctx, 'b'); // depth 1
      ctx = childDelegationContext(ctx, 'c'); // depth 2
      // depth is now 2; next delegation at depth 2 < 3 is allowed, at 3 blocked
      expect(() =>
        validateDelegation({
          fromAgent: 'c', toAgent: 'd', chain: ctx.chain, depth: ctx.depth,
          maxDepth: ctx.maxDepth, allowedTargets: ['d'], loadedAgentNames: ['a', 'b', 'c', 'd'],
        }),
      ).not.toThrow();
      ctx = childDelegationContext(ctx, 'd'); // depth 3
      expect(() =>
        validateDelegation({
          fromAgent: 'd', toAgent: 'e', chain: ctx.chain, depth: ctx.depth,
          maxDepth: ctx.maxDepth, allowedTargets: ['e'], loadedAgentNames: ['a', 'b', 'c', 'd', 'e'],
        }),
      ).toThrow(DelegationError);
    });
  });
});
