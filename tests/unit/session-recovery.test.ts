import { describe, expect, it } from 'vitest';
import { findOrphanedToolUses } from '@/core/session/session-recovery.js';
import type { SessionEvent } from '@/types/session.js';

function event(type: SessionEvent['type'], content: NonNullable<SessionEvent['content']>): SessionEvent {
  return {
    id: `evt_${type}`,
    sessionId: 'sess_test',
    seq: 1,
    type,
    content,
    createdAt: new Date('2026-01-01T00:00:00Z'),
  };
}

describe('session recovery helpers', () => {
  it('finds unresolved built-in tool uses', () => {
    const orphaned = findOrphanedToolUses([
      event('agent.tool_use', [{ type: 'tool_use', id: 'call_1', name: 'bash', input: {} }]),
    ]);

    expect(orphaned).toEqual([{ id: 'call_1', resultType: 'agent.tool_result' }]);
  });

  it('finds unresolved MCP tool uses with MCP result type', () => {
    const orphaned = findOrphanedToolUses([
      event('agent.mcp_tool_use', [{ type: 'tool_use', id: 'call_mcp', name: 'github.search', input: {} }]),
    ]);

    expect(orphaned).toEqual([{ id: 'call_mcp', resultType: 'agent.mcp_tool_result' }]);
  });

  it('does not report tool uses that already have results', () => {
    const orphaned = findOrphanedToolUses([
      event('agent.tool_use', [{ type: 'tool_use', id: 'call_ok', name: 'bash', input: {} }]),
      event('agent.tool_result', [{ type: 'tool_result', tool_use_id: 'call_ok', content: 'done' }]),
    ]);

    expect(orphaned).toEqual([]);
  });
});
