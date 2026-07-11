/**
 * Agent Orchestrator (Requirement 3)
 *
 * Declarative multi-agent delegation: an agent declares in `delegations` which
 * other agents it may call, and the model decides at runtime whether/when to
 * delegate. This is NOT a visual DAG workflow — no predefined branching or
 * loops (see the product boundary in requirements.md).
 *
 * This module holds the pure delegation-safety helpers (cycle detection, depth
 * limiting). The actual sub-agent execution is wired in the executor, which
 * owns model/sandbox/strategy.
 */

export const DEFAULT_MAX_DELEGATION_DEPTH = 5;

export class DelegationError extends Error {
  constructor(
    public readonly code: 'cycle' | 'max_depth' | 'not_found' | 'not_allowed',
    message: string,
  ) {
    super(message);
    this.name = 'DelegationError';
  }
}

/**
 * Returns true if adding `target` to `chain` would form a cycle (i.e. the
 * target already appears somewhere in the current delegation chain).
 */
export function detectCycle(chain: string[], target: string): boolean {
  return chain.includes(target);
}

/**
 * Validate a delegation before executing it. Throws DelegationError on any
 * violation (cycle, depth exceeded, target not in roster, target not loaded).
 */
export function validateDelegation(params: {
  fromAgent: string;
  toAgent: string;
  chain: string[];
  depth: number;
  maxDepth: number;
  allowedTargets: string[];
  loadedAgentNames: string[];
}): void {
  const { fromAgent, toAgent, chain, depth, maxDepth, allowedTargets, loadedAgentNames } = params;

  if (depth >= maxDepth) {
    throw new DelegationError(
      'max_depth',
      `Delegation depth limit (${maxDepth}) reached; cannot delegate from "${fromAgent}" to "${toAgent}"`,
    );
  }

  if (!allowedTargets.includes(toAgent)) {
    throw new DelegationError(
      'not_allowed',
      `Agent "${fromAgent}" is not allowed to delegate to "${toAgent}" (not in its delegations roster)`,
    );
  }

  if (!loadedAgentNames.includes(toAgent)) {
    throw new DelegationError('not_found', `Delegation target agent "${toAgent}" is not loaded`);
  }

  if (detectCycle(chain, toAgent)) {
    throw new DelegationError(
      'cycle',
      `Delegation cycle detected: "${toAgent}" is already in the chain [${chain.join(' → ')}]`,
    );
  }
}

/**
 * Delegation context threaded through a (possibly nested) run so sub-agents
 * know their position in the chain and can enforce limits.
 */
export interface DelegationContext {
  /** Ordered list of agent names from root to current. */
  chain: string[];
  /** Current depth (0 = top-level, root agent). */
  depth: number;
  /** Max allowed depth. */
  maxDepth: number;
}

export function rootDelegationContext(
  rootAgent: string,
  maxDepth = DEFAULT_MAX_DELEGATION_DEPTH,
): DelegationContext {
  return { chain: [rootAgent], depth: 0, maxDepth };
}

export function childDelegationContext(
  parent: DelegationContext,
  child: string,
): DelegationContext {
  return {
    chain: [...parent.chain, child],
    depth: parent.depth + 1,
    maxDepth: parent.maxDepth,
  };
}
