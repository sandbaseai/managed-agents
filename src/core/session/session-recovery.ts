import type { SessionEvent } from '@/types/session.js';

export interface OrphanedToolUse {
  id: string;
  resultType: 'agent.tool_result' | 'agent.mcp_tool_result';
}

export function findOrphanedToolUses(events: SessionEvent[]): OrphanedToolUse[] {
  const toolUses = new Map<string, OrphanedToolUse>();
  const resolved = new Set<string>();

  for (const event of events) {
    if (event.type === 'agent.tool_use' || event.type === 'agent.mcp_tool_use') {
      const block = event.content?.find((item) => item.type === 'tool_use') as
        | { type: 'tool_use'; id: string }
        | undefined;
      if (block) {
        toolUses.set(block.id, {
          id: block.id,
          resultType: event.type === 'agent.mcp_tool_use'
            ? 'agent.mcp_tool_result'
            : 'agent.tool_result',
        });
      }
    } else if (event.type === 'agent.tool_result' || event.type === 'agent.mcp_tool_result') {
      const block = event.content?.find((item) => item.type === 'tool_result') as
        | { type: 'tool_result'; tool_use_id: string }
        | undefined;
      if (block) resolved.add(block.tool_use_id);
    }
  }

  return Array.from(toolUses.values()).filter((toolUse) => !resolved.has(toolUse.id));
}
