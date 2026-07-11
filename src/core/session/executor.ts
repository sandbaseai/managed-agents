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

import { nanoid } from 'nanoid';
import type { SessionExecutor, ExecuteOptions } from './session-manager.js';
import type { Session, SessionEvent } from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxProvider, SandboxInstance, SandboxProviderType } from '@/types/sandbox.js';
import type { SandboxProviderRegistry } from '@/sandbox/registry.js';
import type { AgentStrategy, StrategyContext } from '@/types/strategy.js';
import { ModelRegistry } from '@/model/registry.js';
import { McpManager, type McpServerStatus } from '@/core/mcp/mcp-manager.js';
import { EventLogger } from './event-logger.js';
import { eventsToMessages } from './events-to-messages.js';
import { ContextCompactor } from './context-compactor.js';
import { composeSystemPrompt, type Skill } from '@/core/skills/loader.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import type { SnapshotManager } from './snapshot-manager.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import {
  validateDelegation,
  rootDelegationContext,
  childDelegationContext,
  DelegationError,
  DEFAULT_MAX_DELEGATION_DEPTH,
  type DelegationContext,
} from '@/core/orchestrator/agent-orchestrator.js';

export interface ExecutorDeps {
  agents: AgentDefinition[];
  modelRegistry: ModelRegistry;
  /** Default sandbox provider (used when no registry/env resolution applies). */
  sandboxProvider: SandboxProvider;
  /** Optional registry to select a provider by Environment sandbox_provider. */
  sandboxRegistry?: SandboxProviderRegistry;
  /** Resolve an environment name → its sandbox_provider type. */
  resolveEnvProviderType?: (envName: string) => SandboxProviderType | undefined;
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
  /** Resolve an environment name → whether workspace snapshots are enabled. */
  resolveEnvSnapshot?: (envName: string) => boolean;
}

export class DefaultSessionExecutor implements SessionExecutor {
  /** Cache of provisioned sandboxes, keyed by session id (1:1 binding). */
  private sandboxes = new Map<string, SandboxInstance>();
  /** MCP manager per session (holds connected client subprocesses/sockets). */
  private mcpManagers = new Map<string, McpManager>();
  /** Cached MCP tool map per session (reused across turns). */
  private mcpToolCache = new Map<string, Record<string, unknown>>();

  constructor(private readonly deps: ExecutorDeps) {}

  async *execute(
    session: Session,
    event: UserEvent,
    options?: ExecuteOptions,
  ): AsyncIterable<SessionEvent> {
    const { agents, modelRegistry, strategy, eventLogger } = this.deps;

    // 1. Load agent definition
    const agent = agents.find((a) => a.name === session.agentName);
    if (!agent) {
      throw new Error(`Agent not found: ${session.agentName}`);
    }

    // 2. Create model
    const model = modelRegistry.createModel(agent.model);

    // 3. Provision sandbox (or reuse the one bound to this session)
    const sandbox = await this.getOrProvisionSandbox(session, agent);

    // 3a. Handle a tool confirmation (A5): run or deny the pending tool, append
    // its result so the model turn below continues with a paired sequence.
    if (event.type === 'user.tool_confirmation') {
      await this.handleToolConfirmation(session, agent, sandbox, event, eventLogger, options?.broadcast ?? (() => {}));
    }

    const broadcast = options?.broadcast ?? (() => {});

    // 4. Context compaction: if the projected history is too large, summarize
    // older messages and write a boundary event. The rebuild below then honors
    // it, so both this turn and future turns use the compacted view.
    if (this.deps.compactor) {
      const projected = eventsToMessages(eventLogger.getEvents(session.id));
      if (this.deps.compactor.shouldCompact(projected)) {
        try {
          const result = await this.deps.compactor.compact(projected, model);
          if (result) {
            const boundary = eventLogger.append(session.id, {
              type: 'agent.thread_context_compacted',
              content: [{ type: 'text', text: result.summary }],
            });
            broadcast(boundary);
          }
        } catch {
          // Compaction is best-effort — a summarize failure must not fail the turn.
        }
      }
    }

    // 5. Build messages from Event_Log (honors any compaction boundary)
    const events = eventLogger.getEvents(session.id);
    const messages = eventsToMessages(events);

    // 6. Build tools: built-in (sandbox) + MCP + delegation tools
    const delegationCtx = rootDelegationContext(agent.name, DEFAULT_MAX_DELEGATION_DEPTH);
    const tools = this.buildTools(agent, sandbox);
    const mcpTools = await this.getOrConnectMcp(session.id, agent);
    Object.assign(tools, mcpTools);
    Object.assign(tools, this.buildDelegationTools(agent, delegationCtx));

    // 6a. Confirm-required tools (A5): strip execute so the SDK stops on them
    // and the turn suspends for user confirmation instead of auto-running.
    const confirmTools = agent.confirm_tools ?? [];
    for (const name of confirmTools) {
      if (tools[name]) {
        tools[name] = { ...tools[name], execute: undefined };
      }
    }

    // 7. Compose system prompt: agent base + assigned skills (R4) + memory (R9.18)
    let systemPrompt = composeSystemPrompt(
      agent.system_prompt,
      agent.skills,
      this.deps.skills ?? [],
    );
    if (this.deps.memory && session.contextId) {
      systemPrompt = await this.injectMemory(systemPrompt, session.contextId, event);
    }

    // 8. Execute strategy
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
        maxSteps: agent.max_turns ?? 25,
        temperature: agent.temperature ?? 0.7,
        confirmTools,
        onRequiresAction: options?.onRequiresAction,
      },
      abortSignal: options?.abortSignal,
    };

    for await (const evt of strategy.execute(context)) {
      yield evt;
    }

    // 9. Extract key facts into long-term memory (R9.18), scoped by context_id.
    if (this.deps.memory && session.contextId) {
      await this.extractMemory(session.contextId, event).catch(() => {});
    }

    // 10. Snapshot the workspace after the turn if enabled (R9.11).
    if (this.snapshotsEnabled(agent) && this.deps.snapshots && sandbox.hostWorkDir) {
      try {
        this.deps.snapshots.create(session.id, sandbox.hostWorkDir);
      } catch {
        // best-effort snapshot
      }
    }
    // NOTE: no sandbox/MCP cleanup here — they persist for the session
    // lifetime and are destroyed via cleanupSession() on terminal states.
  }

  /** Inject relevant long-term memories into the system prompt (R9.18). */
  private async injectMemory(
    systemPrompt: string,
    contextId: string,
    event: UserEvent,
  ): Promise<string> {
    if (!this.deps.memory) return systemPrompt;
    const query = event.type === 'user.message'
      ? (event.content ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join(' ')
      : '';
    try {
      const memories = await this.deps.memory.search(contextId, query, 5);
      if (memories.length === 0) return systemPrompt;
      const block = memories.map((m) => `- ${m.content}`).join('\n');
      return `${systemPrompt}\n\n# Relevant Memory\n\nFrom earlier related sessions:\n${block}`;
    } catch {
      return systemPrompt; // memory failures never block the turn
    }
  }

  /** Persist a key fact from the user's message into memory (R9.18). */
  private async extractMemory(contextId: string, event: UserEvent): Promise<void> {
    if (!this.deps.memory) return;
    if (event.type !== 'user.message') return;
    const text = (event.content ?? []).filter((b) => b.type === 'text').map((b: any) => b.text).join(' ').trim();
    // MVP heuristic: store the user's message verbatim as a memory. Adapters
    // (mem0/memU) do smarter extraction; this keeps the default dependency-free.
    if (text) {
      await this.deps.memory.add(contextId, text, { source: 'user.message' });
    }
  }

  /**
   * Destroy the sandbox + MCP connections bound to a session. Called by
   * SessionManager when the session reaches a terminal state.
   */
  async cleanupSession(sessionId: string): Promise<void> {
    const sandbox = this.sandboxes.get(sessionId);
    if (sandbox) {
      this.sandboxes.delete(sessionId);
      try {
        await sandbox.cleanup();
      } catch {
        // Best-effort cleanup
      }
    }
    const mcp = this.mcpManagers.get(sessionId);
    if (mcp) {
      this.mcpManagers.delete(sessionId);
      this.mcpToolCache.delete(sessionId);
      try {
        await mcp.close();
      } catch {
        // Best-effort cleanup
      }
    }
  }

  /** MCP connection status for a session (for /v1/x/mcp/status). */
  getMcpStatus(sessionId: string): McpServerStatus[] {
    return this.mcpManagers.get(sessionId)?.getStatuses() ?? [];
  }

  // ============================================================
  // Internal
  // ============================================================

  /**
   * Connect to the agent's MCP servers once per session and cache the manager.
   * Returns the merged MCP tool set (namespaced `mcp_<server>_<tool>`).
   */
  private async getOrConnectMcp(
    sessionId: string,
    agent: AgentDefinition,
  ): Promise<Record<string, unknown>> {
    if (!agent.mcp_servers || agent.mcp_servers.length === 0) {
      return {};
    }
    // Reuse existing connections for subsequent turns. The cached tools are
    // stable wrappers that delegate to the manager's live clients, so they
    // remain valid across mid-session reconnects (the wrapper auto-reconnects
    // on a connection-drop error and retries).
    const existing = this.mcpManagers.get(sessionId);
    if (existing) {
      return this.mcpToolCache.get(sessionId) ?? {};
    }
    const manager = new McpManager();
    const tools = await manager.connectAll(agent.mcp_servers);
    this.mcpManagers.set(sessionId, manager);
    this.mcpToolCache.set(sessionId, tools);
    return tools;
  }

  private async getOrProvisionSandbox(
    session: Session,
    agent: AgentDefinition,
  ): Promise<SandboxInstance> {
    const existing = this.sandboxes.get(session.id);
    if (existing) return existing;

    const providerType = this.resolveProviderType(agent);
    const provider = this.resolveProvider(providerType);
    const sandbox = await provider.provision(session.id, {
      name: agent.environment ?? 'local',
      sandbox_provider: providerType,
      timeout: 300,
    });

    // Restore the latest workspace snapshot on (re)provision, if enabled (R9.11).
    if (this.snapshotsEnabled(agent) && this.deps.snapshots && sandbox.hostWorkDir) {
      try {
        this.deps.snapshots.restoreLatest(session.id, sandbox.hostWorkDir);
      } catch {
        // best-effort restore
      }
    }

    this.sandboxes.set(session.id, sandbox);
    return sandbox;
  }

  private snapshotsEnabled(agent: AgentDefinition): boolean {
    return !!(this.deps.resolveEnvSnapshot && agent.environment && this.deps.resolveEnvSnapshot(agent.environment));
  }

  /** Resolve the sandbox provider type for an agent from its environment. */
  private resolveProviderType(agent: AgentDefinition): SandboxProviderType {
    if (this.deps.resolveEnvProviderType && agent.environment) {
      const t = this.deps.resolveEnvProviderType(agent.environment);
      if (t) return t;
    }
    return 'local';
  }

  /** Resolve the provider instance, falling back to the default provider. */
  private resolveProvider(type: SandboxProviderType): SandboxProvider {
    if (this.deps.sandboxRegistry?.has(type)) {
      return this.deps.sandboxRegistry.get(type);
    }
    return this.deps.sandboxProvider;
  }

  private buildTools(agent: AgentDefinition, sandbox: SandboxInstance): Record<string, any> {
    const tools: Record<string, any> = {};

    if (agent.tools?.includes('bash')) {
      tools['bash'] = {
        description: 'Execute a shell command in the sandbox',
        parameters: {
          type: 'object',
          properties: {
            command: { type: 'string', description: 'Shell command to execute' },
          },
          required: ['command'],
        },
        execute: async ({ command }: { command: string }) => {
          const result = await sandbox.execute(command);
          return result.exitCode === 0
            ? result.stdout
            : `Error (exit ${result.exitCode}): ${result.stderr}`;
        },
      };
    }

    if (agent.tools?.includes('read_file')) {
      tools['read_file'] = {
        description: 'Read a file from the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
          },
          required: ['path'],
        },
        execute: async ({ path }: { path: string }) => {
          try {
            return await sandbox.readFile(path);
          } catch (err: any) {
            return `Error: ${err.message}`;
          }
        },
      };
    }

    if (agent.tools?.includes('write_file')) {
      tools['write_file'] = {
        description: 'Write content to a file in the workspace',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
            content: { type: 'string', description: 'File content to write' },
          },
          required: ['path', 'content'],
        },
        execute: async ({ path, content }: { path: string; content: string }) => {
          await sandbox.writeFile(path, content);
          return `Written ${content.length} bytes to ${path}`;
        },
      };
    }

    if (agent.tools?.includes('edit')) {
      tools['edit'] = {
        description: 'Replace an exact string in a file with new content',
        parameters: {
          type: 'object',
          properties: {
            path: { type: 'string', description: 'File path relative to workspace' },
            old_string: { type: 'string', description: 'Exact text to find and replace' },
            new_string: { type: 'string', description: 'Replacement text' },
          },
          required: ['path', 'old_string', 'new_string'],
        },
        execute: async ({ path, old_string, new_string }: { path: string; old_string: string; new_string: string }) => {
          try {
            const current = await sandbox.readFile(path);
            const count = current.split(old_string).length - 1;
            if (count === 0) return `Error: old_string not found in ${path}`;
            if (count > 1) return `Error: old_string matches ${count} times in ${path}; provide a more specific string`;
            await sandbox.writeFile(path, current.replace(old_string, new_string));
            return `Edited ${path}`;
          } catch (err: any) {
            return `Error: ${err.message}`;
          }
        },
      };
    }

    if (agent.tools?.includes('glob')) {
      tools['glob'] = {
        description: 'List files in the workspace matching a substring or extension',
        parameters: {
          type: 'object',
          properties: {
            pattern: { type: 'string', description: 'Substring or extension (e.g. ".ts") to match in file paths' },
          },
          required: ['pattern'],
        },
        execute: async ({ pattern }: { pattern: string }) => {
          const files = await sandbox.listFiles('.');
          const matched = files.filter((f) => f.includes(pattern));
          return matched.length > 0 ? matched.join('\n') : `No files matching "${pattern}"`;
        },
      };
    }

    if (agent.tools?.includes('grep')) {
      tools['grep'] = {
        description: 'Search file contents in the workspace for a substring',
        parameters: {
          type: 'object',
          properties: {
            query: { type: 'string', description: 'Substring to search for' },
            path: { type: 'string', description: 'Optional directory to limit search (default: whole workspace)' },
          },
          required: ['query'],
        },
        execute: async ({ query, path }: { query: string; path?: string }) => {
          const files = await sandbox.listFiles(path ?? '.');
          const hits: string[] = [];
          for (const file of files) {
            try {
              const content = await sandbox.readFile(file);
              const lines = content.split('\n');
              lines.forEach((line, i) => {
                if (line.includes(query)) hits.push(`${file}:${i + 1}: ${line.trim()}`);
              });
            } catch {
              // skip unreadable files
            }
          }
          return hits.length > 0 ? hits.slice(0, 200).join('\n') : `No matches for "${query}"`;
        },
      };
    }

    return tools;
  }

  /**
   * Handle a user.tool_confirmation event (A5): find the most recent pending
   * confirm-required tool_use, then either execute it (allow) or inject a
   * denial result (deny), appending a paired tool_result so the subsequent
   * model turn continues with a valid message sequence.
   */
  private async handleToolConfirmation(
    session: Session,
    agent: AgentDefinition,
    sandbox: SandboxInstance,
    event: Extract<UserEvent, { type: 'user.tool_confirmation' }>,
    eventLogger: EventLogger,
    broadcast: (e: SessionEvent) => void,
  ): Promise<void> {
    const events = eventLogger.getEvents(session.id);

    // Find the referenced tool_use, and check it isn't already resolved
    const resolved = new Set<string>();
    let pendingUse: { id: string; name: string; input: Record<string, unknown> } | undefined;
    for (const e of events) {
      if (e.type === 'agent.tool_use' || e.type === 'agent.mcp_tool_use') {
        const b = e.content?.find((x) => x.type === 'tool_use') as
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | undefined;
        if (b && b.id === event.tool_use_id) pendingUse = b;
      } else if (e.type === 'agent.tool_result' || e.type === 'agent.mcp_tool_result') {
        const b = e.content?.find((x) => x.type === 'tool_result') as
          | { type: 'tool_result'; tool_use_id: string } | undefined;
        if (b) resolved.add(b.tool_use_id);
      }
    }

    if (!pendingUse || resolved.has(event.tool_use_id)) {
      return; // nothing to confirm (already resolved or unknown id)
    }

    let resultText: string;
    let isError = false;
    if (event.result === 'allow') {
      // Execute the real tool. Build the FULL executable tool set — built-in +
      // MCP + delegation — so a confirm-required MCP/delegation tool can run (M1).
      const fullTools = this.buildTools(agent, sandbox);
      Object.assign(fullTools, this.mcpToolCache.get(session.id) ?? {});
      Object.assign(fullTools, this.buildDelegationTools(agent, rootDelegationContext(agent.name, DEFAULT_MAX_DELEGATION_DEPTH)));
      const tool = fullTools[pendingUse.name];
      if (tool?.execute) {
        try {
          const out = await tool.execute(pendingUse.input);
          resultText = typeof out === 'string' ? out : JSON.stringify(out);
        } catch (err) {
          resultText = `Tool error: ${err instanceof Error ? err.message : String(err)}`;
          isError = true;
        }
      } else {
        resultText = `Tool "${pendingUse.name}" is not executable`;
        isError = true;
      }
    } else {
      resultText = event.deny_message
        ? `Tool call denied by user: ${event.deny_message}`
        : 'Tool call denied by user';
      isError = true;
    }

    const resultEvent = eventLogger.append(session.id, {
      type: 'agent.tool_result',
      content: [{ type: 'tool_result', tool_use_id: event.tool_use_id, content: resultText, is_error: isError }],
    });
    broadcast(resultEvent);
  }

  /**
   * Build delegation tools (R3). For each agent in `delegations`, expose a
   * `delegate_to_<name>` tool. If `enable_general_subagent`, expose a generic
   * `general_subagent` tool. Each tool runs the target agent as an ephemeral
   * sub-agent and returns its final answer.
   */
  private buildDelegationTools(
    agent: AgentDefinition,
    ctx: DelegationContext,
  ): Record<string, any> {
    const tools: Record<string, any> = {};
    const loadedNames = this.deps.agents.map((a) => a.name);
    const allowed = agent.delegations ?? [];

    for (const target of allowed) {
      tools[`delegate_to_${target}`] = {
        description: `Delegate a self-contained task to the "${target}" agent and get its result.`,
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: `Task/question for the ${target} agent` },
          },
          required: ['task'],
        },
        execute: async ({ task }: { task: string }) => {
          try {
            validateDelegation({
              fromAgent: agent.name,
              toAgent: target,
              chain: ctx.chain,
              depth: ctx.depth,
              maxDepth: ctx.maxDepth,
              allowedTargets: allowed,
              loadedAgentNames: loadedNames,
            });
            return await this.runSubAgent(target, task, childDelegationContext(ctx, target));
          } catch (err) {
            if (err instanceof DelegationError) return `Delegation error: ${err.message}`;
            return `Delegation failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      };
    }

    // CMA general_subagent: spin up a temporary sub-task inheriting this
    // agent's model/config. The sub-agent cannot delegate further.
    if (agent.enable_general_subagent) {
      tools['general_subagent'] = {
        description: 'Spawn a temporary sub-agent to handle a self-contained sub-task and return its result. The sub-agent cannot delegate further.',
        parameters: {
          type: 'object',
          properties: {
            task: { type: 'string', description: 'The sub-task to perform' },
          },
          required: ['task'],
        },
        execute: async ({ task }: { task: string }) => {
          if (ctx.depth >= ctx.maxDepth) {
            return `Delegation error: max depth (${ctx.maxDepth}) reached`;
          }
          try {
            // General subagent inherits the current agent's definition but is
            // barred from further delegation (empty roster, no general subagent).
            const childAgent: AgentDefinition = {
              ...agent,
              delegations: [],
              enable_general_subagent: false,
            };
            return await this.runSubAgentWithDefinition(
              childAgent,
              task,
              childDelegationContext(ctx, `${agent.name}#sub`),
            );
          } catch (err) {
            return `Sub-agent failed: ${err instanceof Error ? err.message : String(err)}`;
          }
        },
      };
    }

    return tools;
  }

  /** Run a named target agent as an ephemeral sub-agent; return its answer. */
  private async runSubAgent(
    targetName: string,
    task: string,
    ctx: DelegationContext,
  ): Promise<string> {
    const target = this.deps.agents.find((a) => a.name === targetName);
    if (!target) return `Delegation error: agent "${targetName}" not found`;
    return this.runSubAgentWithDefinition(target, task, ctx);
  }

  private async runSubAgentWithDefinition(
    target: AgentDefinition,
    task: string,
    ctx: DelegationContext,
  ): Promise<string> {
    const { modelRegistry, strategy, sandboxProvider } = this.deps;
    const model = modelRegistry.createModel(target.model);
    // Unique per invocation so parallel delegations to the same target don't
    // share (and prematurely destroy) each other's sandbox (M2).
    const subSessionId = `subsess_${ctx.chain.join('.')}_${nanoid(8)}`;
    const sandbox = await sandboxProvider.provision(subSessionId, {
      name: target.environment ?? 'local',
      sandbox_provider: 'local',
      timeout: 300,
    });

    try {
      const systemPrompt = composeSystemPrompt(
        target.system_prompt,
        target.skills,
        this.deps.skills ?? [],
      );
      const tools = this.buildTools(target, sandbox);
      // Nested delegation allowed up to the depth limit
      Object.assign(tools, this.buildDelegationTools(target, ctx));

      const memLog = new InMemoryEventLog();
      const collected: string[] = [];

      const subContext: StrategyContext = {
        session: {
          id: subSessionId,
          agentId: target.name,
          agentName: target.name,
          environmentId: 'env_default',
          status: 'running',
          createdAt: new Date(),
          updatedAt: new Date(),
        },
        systemPrompt,
        messages: [{ role: 'user', content: [{ type: 'text', text: task }] }] as any,
        model,
        tools,
        sandbox,
        eventLog: memLog,
        broadcast: (e) => {
          if (e.type === 'agent.message' && e.content) {
            const text = e.content
              .filter((b: any) => b.type === 'text')
              .map((b: any) => b.text)
              .join('\n');
            if (text) collected.push(text);
          }
        },
        config: {
          maxSteps: target.max_turns ?? 25,
          temperature: target.temperature ?? 0.7,
        },
      };

      for await (const _evt of strategy.execute(subContext)) {
        // sub-agent events are ephemeral
      }

      return collected.join('\n') || '(sub-agent produced no output)';
    } finally {
      await sandbox.cleanup().catch(() => {});
    }
  }
}
