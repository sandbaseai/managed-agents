/**
 * Session Executor
 *
 * Wires together the full execution pipeline:
 * SessionManager.sendEvent → load agent → create model → provision sandbox →
 * build messages (eventsToMessages) → execute Strategy → broadcast events
 *
 * Sandbox lifecycle: one Sandbox instance is provisioned per Session on the
 * first turn and REUSED across subsequent turns (1:1 Session↔Sandbox binding,
 * R9.3). It is only destroyed via cleanupSession() when the Session reaches a
 * terminal state (stop/delete/failed).
 */

import type { SessionExecutor, ExecuteOptions } from './session-manager.js';
import type { Session, SessionEvent } from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxProvider, EnvironmentConfig } from '@/types/sandbox.js';
import type { SandboxProviderRegistry } from '@/sandbox/registry.js';
import type { AgentStrategy, StrategyContext } from '@/types/strategy.js';
import { ModelRegistry } from '@/model/registry.js';
import type { McpServerStatus } from '@/core/mcp/mcp-manager.js';
import { EventLogger } from './event-logger.js';
import { ContextCompactor } from './context-compactor.js';
import type { Skill } from '@/core/skills/loader.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import type { SnapshotManager } from './snapshot-manager.js';
import { SandboxLifecycle } from './sandbox-lifecycle.js';
import { ContextBuilder } from './context-builder.js';
import { DelegationService } from './delegation-service.js';
import { ToolResolver } from './tool-resolver.js';
import { getToolsRequiringConfirmation } from '@/core/agent/standard.js';

export interface ExecutorDeps {
  agents: AgentDefinition[];
  modelRegistry: ModelRegistry;
  /** Default sandbox provider (used when no registry/env resolution applies). */
  sandboxProvider: SandboxProvider;
  /** Optional registry to select a provider by Environment sandbox_provider. */
  sandboxRegistry?: SandboxProviderRegistry;
  /** Resolve a session environment id to its runtime configuration. */
  resolveEnvironmentConfig?: (environmentId: string) => EnvironmentConfig | undefined;
  /** Resolve an agent id from durable storage. */
  resolveAgent?: (agentId: string) => AgentDefinition | undefined;
  strategy: AgentStrategy;
  eventLogger: EventLogger;
  /** Optional context compactor. If provided, long histories are summarized. */
  compactor?: ContextCompactor;
  /** Loaded skills, injected into agent system prompts by name (R4). */
  skills?: Skill[];
  /** Optional long-term memory provider, scoped by context_id (R9.16–18). */
  memory?: MemoryProvider;
  /** Optional workspace snapshot manager (R9.11). */
  snapshots?: SnapshotManager;
  /** Workspace fallback when an agent does not set max_turns. */
  defaultMaxSteps?: number;
}

export class DefaultSessionExecutor implements SessionExecutor {
  private readonly sandboxLifecycle: SandboxLifecycle;
  private readonly contextBuilder: ContextBuilder;
  private readonly delegationService: DelegationService;
  private readonly toolResolver: ToolResolver;

  constructor(private readonly deps: ExecutorDeps) {
    this.sandboxLifecycle = new SandboxLifecycle(deps);
    this.contextBuilder = new ContextBuilder({
      eventLogger: deps.eventLogger,
      compactor: deps.compactor,
      skills: deps.skills,
      memory: deps.memory,
    });
    this.delegationService = new DelegationService({
      agents: deps.agents,
      modelRegistry: deps.modelRegistry,
      strategy: deps.strategy,
      sandboxProvider: deps.sandboxProvider,
      composeSystemPrompt: (agent) => this.contextBuilder.composeSystemPrompt(agent),
      buildSandboxTools: (agent, sandbox) => this.toolResolver.buildSandboxTools(agent, sandbox),
    });
    this.toolResolver = new ToolResolver({ delegationService: this.delegationService });
  }

  async *execute(
    session: Session,
    event: UserEvent,
    options?: ExecuteOptions,
  ): AsyncIterable<SessionEvent> {
    const { agents, modelRegistry, strategy, eventLogger } = this.deps;

    // 1. Load agent definition
    const agent = session.agentDefinition
      ?? this.deps.resolveAgent?.(session.agentId)
      ?? agents.find((a) => a.name === session.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${session.agentId}`);
    }

    // 2. Create model
    const model = modelRegistry.createModel(agent.model);

    // 3. Provision sandbox (or reuse the one bound to this session)
    const sandbox = await this.sandboxLifecycle.getOrProvision(session);

    // 3a. Handle a tool confirmation (A5): run or deny the pending tool, append
    // its result so the model turn below continues with a paired sequence.
    if (event.type === 'user.tool_confirmation') {
      await this.toolResolver.handleToolConfirmation(
        session,
        agent,
        sandbox,
        event,
        eventLogger,
        options?.broadcast ?? (() => {}),
      );
    }

    const broadcast = options?.broadcast ?? (() => {});

    // 4. Build context: compaction, Event_Log projection, skills, and memory.
    const { systemPrompt, messages } = await this.contextBuilder.build(
      session,
      agent,
      event,
      model,
      broadcast,
    );

    // 5. Build tools: built-in sandbox tools, MCP tools, delegation tools, and
    // confirm-required stripping.
    const tools = await this.toolResolver.resolveTools(session, agent, sandbox);
    const confirmTools = getToolsRequiringConfirmation(agent);

    // 6. Execute strategy
    const context: StrategyContext = {
      session,
      systemPrompt,
      messages: messages as any,
      model,
      tools,
      sandbox,
      eventLog: eventLogger,
      broadcast, // real SSE broadcast wired from SessionManager
      config: {
        maxSteps: agent.max_turns ?? this.deps.defaultMaxSteps ?? 25,
        temperature: agent.temperature ?? 0.7,
        confirmTools,
        onRequiresAction: options?.onRequiresAction,
      },
      abortSignal: options?.abortSignal,
    };

    for await (const evt of strategy.execute(context)) {
      yield evt;
    }

    // 7. Extract key facts into long-term memory (R9.18), scoped by context_id.
    await this.contextBuilder.extractMemory(session, event).catch(() => {});

    // 8. Snapshot the workspace after the turn if enabled (R9.11).
    this.sandboxLifecycle.snapshotAfterTurn(session, sandbox);
    // NOTE: no sandbox/MCP cleanup here — they persist for the session
    // lifetime and are destroyed via cleanupSession() on terminal states.
  }

  /**
   * Destroy the sandbox + MCP connections bound to a session. Called by
   * SessionManager when the session reaches a terminal state.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    await this.sandboxLifecycle.cleanup(sessionId);
    await this.toolResolver.cleanupSession(sessionId);
  }

  /** MCP connection status for a session (for /v1/x/mcp/status). */
  getMcpStatus(sessionId: string): McpServerStatus[] {
    return this.toolResolver.getMcpStatus(sessionId);
  }
}
