import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxInstance } from '@/types/sandbox.js';
import type { Session, SessionEvent } from '@/types/session.js';
import type { UserEvent } from '@/types/cma-protocol.js';
import { McpManager, type McpServerStatus } from '@/core/mcp/mcp-manager.js';
import { rootDelegationContext, DEFAULT_MAX_DELEGATION_DEPTH } from '@/core/orchestrator/agent-orchestrator.js';
import type { EventLogger } from './event-logger.js';
import type { DelegationService } from './delegation-service.js';

export interface ToolResolverDeps {
  delegationService: DelegationService;
}

export class ToolResolver {
  private readonly mcpManagers = new Map<string, McpManager>();
  private readonly mcpToolCache = new Map<string, Record<string, unknown>>();

  constructor(private readonly deps: ToolResolverDeps) {}

  async resolveTools(
    session: Session,
    agent: AgentDefinition,
    sandbox: SandboxInstance,
  ): Promise<Record<string, any>> {
    const delegationCtx = rootDelegationContext(agent.name, DEFAULT_MAX_DELEGATION_DEPTH);
    const tools = this.buildSandboxTools(agent, sandbox);
    Object.assign(tools, await this.getOrConnectMcp(session.id, agent));
    Object.assign(tools, this.deps.delegationService.buildDelegationTools(agent, delegationCtx));

    for (const name of agent.confirm_tools ?? []) {
      if (tools[name]) {
        tools[name] = { ...tools[name], execute: undefined };
      }
    }

    return tools;
  }

  async handleToolConfirmation(
    session: Session,
    agent: AgentDefinition,
    sandbox: SandboxInstance,
    event: Extract<UserEvent, { type: 'user.tool_confirmation' }>,
    eventLogger: EventLogger,
    broadcast: (event: SessionEvent) => void,
  ): Promise<void> {
    const events = eventLogger.getEvents(session.id);

    const resolved = new Set<string>();
    let pendingUse: { id: string; name: string; input: Record<string, unknown> } | undefined;
    for (const loggedEvent of events) {
      if (loggedEvent.type === 'agent.tool_use' || loggedEvent.type === 'agent.mcp_tool_use') {
        const block = loggedEvent.content?.find((item) => item.type === 'tool_use') as
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> } | undefined;
        if (block && block.id === event.tool_use_id) pendingUse = block;
      } else if (loggedEvent.type === 'agent.tool_result' || loggedEvent.type === 'agent.mcp_tool_result') {
        const block = loggedEvent.content?.find((item) => item.type === 'tool_result') as
          | { type: 'tool_result'; tool_use_id: string } | undefined;
        if (block) resolved.add(block.tool_use_id);
      }
    }

    if (!pendingUse || resolved.has(event.tool_use_id)) return;

    let resultText: string;
    let isError = false;
    if (event.result === 'allow') {
      const executableTools = this.buildSandboxTools(agent, sandbox);
      Object.assign(executableTools, this.mcpToolCache.get(session.id) ?? {});
      Object.assign(
        executableTools,
        this.deps.delegationService.buildDelegationTools(
          agent,
          rootDelegationContext(agent.name, DEFAULT_MAX_DELEGATION_DEPTH),
        ),
      );
      const tool = executableTools[pendingUse.name];
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

  async cleanupSession(sessionId: string): Promise<void> {
    const mcp = this.mcpManagers.get(sessionId);
    if (!mcp) return;

    this.mcpManagers.delete(sessionId);
    this.mcpToolCache.delete(sessionId);
    try {
      await mcp.close();
    } catch {
      // best-effort cleanup
    }
  }

  getMcpStatus(sessionId: string): McpServerStatus[] {
    return this.mcpManagers.get(sessionId)?.getStatuses() ?? [];
  }

  buildSandboxTools(agent: AgentDefinition, sandbox: SandboxInstance): Record<string, any> {
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
          const matched = files.filter((file) => file.includes(pattern));
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
              lines.forEach((line, index) => {
                if (line.includes(query)) hits.push(`${file}:${index + 1}: ${line.trim()}`);
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

  private async getOrConnectMcp(
    sessionId: string,
    agent: AgentDefinition,
  ): Promise<Record<string, unknown>> {
    if (!agent.mcp_servers || agent.mcp_servers.length === 0) {
      return {};
    }

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
}
