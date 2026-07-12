import { eventsToMessages } from './events-to-messages.js';
import type { EventLogger } from './event-logger.js';
import type { ContextCompactor } from './context-compactor.js';
import type { AgentDefinition } from '@/types/agent.js';
import type { UserEvent } from '@/types/cma-protocol.js';
import type { Session, SessionEvent } from '@/types/session.js';
import { composeSystemPrompt, type Skill } from '@/core/skills/loader.js';
import type { MemoryProvider } from '@/core/memory/memory-provider.js';
import { getAgentSkillIds } from '@/core/agent/standard.js';

export interface ContextBuilderDeps {
  eventLogger: EventLogger;
  compactor?: ContextCompactor;
  skills?: Skill[];
  memory?: MemoryProvider;
}

export interface BuiltContext {
  systemPrompt: string;
  messages: ReturnType<typeof eventsToMessages>;
}

export class ContextBuilder {
  constructor(private readonly deps: ContextBuilderDeps) {}

  async build(
    session: Session,
    agent: AgentDefinition,
    event: UserEvent,
    model: unknown,
    broadcast: (event: SessionEvent) => void,
  ): Promise<BuiltContext> {
    await this.compactIfNeeded(session, model, broadcast);

    const events = this.deps.eventLogger.getEvents(session.id);
    const messages = eventsToMessages(events);

    let systemPrompt = composeSystemPrompt(
      agent.system,
      getAgentSkillIds(agent),
      this.deps.skills ?? [],
    );
    if (this.deps.memory && session.contextId) {
      systemPrompt = await this.injectMemory(systemPrompt, session.contextId, event);
    }

    return { systemPrompt, messages };
  }

  async extractMemory(session: Session, event: UserEvent): Promise<void> {
    if (!this.deps.memory || !session.contextId) return;
    if (event.type !== 'user.message') return;
    const text = (event.content ?? [])
      .filter((block) => block.type === 'text')
      .map((block: any) => block.text)
      .join(' ')
      .trim();

    if (text) {
      await this.deps.memory.add(session.contextId, text, { source: 'user.message' });
    }
  }

  composeSystemPrompt(agent: AgentDefinition): string {
    return composeSystemPrompt(
      agent.system,
      getAgentSkillIds(agent),
      this.deps.skills ?? [],
    );
  }

  private async compactIfNeeded(
    session: Session,
    model: unknown,
    broadcast: (event: SessionEvent) => void,
  ): Promise<void> {
    if (!this.deps.compactor) return;

    const projected = eventsToMessages(this.deps.eventLogger.getEvents(session.id));
    if (!this.deps.compactor.shouldCompact(projected)) return;

    try {
      const result = await this.deps.compactor.compact(projected, model as any);
      if (result) {
        const boundary = this.deps.eventLogger.append(session.id, {
          type: 'agent.thread_context_compacted',
          content: [{ type: 'text', text: result.summary }],
        });
        broadcast(boundary);
      }
    } catch {
      // Compaction is best-effort — a summarize failure must not fail the turn.
    }
  }

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
      const block = memories.map((memory) => `- ${memory.content}`).join('\n');
      return `${systemPrompt}\n\n# Relevant Memory\n\nFrom earlier related sessions:\n${block}`;
    } catch {
      return systemPrompt;
    }
  }
}
