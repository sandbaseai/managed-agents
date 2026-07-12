import { nanoid } from 'nanoid';
import type { AgentDefinition } from '@/types/agent.js';
import type { SandboxInstance, SandboxProvider } from '@/types/sandbox.js';
import type { AgentStrategy, StrategyContext } from '@/types/strategy.js';
import { ModelRegistry } from '@/model/registry.js';
import { InMemoryEventLog } from './in-memory-event-log.js';
import {
  validateDelegation,
  childDelegationContext,
  DelegationError,
  type DelegationContext,
} from '@/core/orchestrator/agent-orchestrator.js';

export interface DelegationServiceDeps {
  agents: AgentDefinition[];
  modelRegistry: ModelRegistry;
  strategy: AgentStrategy;
  sandboxProvider: SandboxProvider;
  composeSystemPrompt: (agent: AgentDefinition) => string;
  buildSandboxTools: (agent: AgentDefinition, sandbox: SandboxInstance) => Record<string, any>;
}

export class DelegationService {
  constructor(private readonly deps: DelegationServiceDeps) {}

  buildDelegationTools(
    agent: AgentDefinition,
    ctx: DelegationContext,
  ): Record<string, any> {
    const tools: Record<string, any> = {};
    const loadedNames = this.deps.agents.map((loaded) => loaded.name);
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

  private async runSubAgent(
    targetName: string,
    task: string,
    ctx: DelegationContext,
  ): Promise<string> {
    const target = this.deps.agents.find((agent) => agent.name === targetName);
    if (!target) return `Delegation error: agent "${targetName}" not found`;
    return this.runSubAgentWithDefinition(target, task, ctx);
  }

  private async runSubAgentWithDefinition(
    target: AgentDefinition,
    task: string,
    ctx: DelegationContext,
  ): Promise<string> {
    const model = this.deps.modelRegistry.createModel(target.model);
    const subSessionId = `subsess_${ctx.chain.join('.')}_${nanoid(8)}`;
    const sandbox = await this.deps.sandboxProvider.provision(subSessionId, {
      name: target.environment ?? 'local',
      sandbox_provider: 'local',
      timeout: 300,
    });

    try {
      const tools = this.deps.buildSandboxTools(target, sandbox);
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
        systemPrompt: this.deps.composeSystemPrompt(target),
        messages: [{ role: 'user', content: [{ type: 'text', text: task }] }] as any,
        model,
        tools,
        sandbox,
        eventLog: memLog,
        broadcast: (event) => {
          if (event.type === 'agent.message' && event.content) {
            const text = event.content
              .filter((block: any) => block.type === 'text')
              .map((block: any) => block.text)
              .join('\n');
            if (text) collected.push(text);
          }
        },
        config: {
          maxSteps: target.max_turns ?? 25,
          temperature: target.temperature ?? 0.7,
        },
      };

      for await (const _evt of this.deps.strategy.execute(subContext)) {
        // sub-agent events are ephemeral
      }

      return collected.join('\n') || '(sub-agent produced no output)';
    } finally {
      await sandbox.cleanup().catch(() => {});
    }
  }
}
