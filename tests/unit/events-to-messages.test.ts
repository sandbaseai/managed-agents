/**
 * Unit tests for eventsToMessages — the Event_Log → CoreMessage[] projection.
 * This is the bijection core (ref OMA history.ts). Validates Requirements
 * 9.5, 9.6 and the message-pairing rules.
 */

import { describe, it, expect } from 'vitest';
import { eventsToMessages } from '@/core/session/events-to-messages.js';
import type { SessionEvent } from '@/types/session.js';
import type { CMAEventType, ContentBlock } from '@/types/cma-protocol.js';

let seq = 0;
function ev(type: CMAEventType, content?: ContentBlock[], extra?: Partial<SessionEvent>): SessionEvent {
  return {
    id: `sevt_${++seq}`,
    sessionId: 'sess_1',
    seq,
    type,
    content,
    createdAt: new Date(),
    ...extra,
  };
}

describe('eventsToMessages', () => {
  it('projects a simple user/agent exchange', () => {
    const events = [
      ev('user.message', [{ type: 'text', text: 'hello' }]),
      ev('agent.message', [{ type: 'text', text: 'hi there' }]),
    ];
    const msgs = eventsToMessages(events);
    expect(msgs).toHaveLength(2);
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
  });

  it('skips session.* and span.* events', () => {
    const events = [
      ev('session.status_running'),
      ev('user.message', [{ type: 'text', text: 'q' }]),
      ev('span.model_request_start'),
      ev('agent.message', [{ type: 'text', text: 'a' }]),
      ev('session.status_idle'),
    ];
    const msgs = eventsToMessages(events);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });

  it('pairs tool_use with tool_result in adjacent assistant/tool messages', () => {
    const events = [
      ev('user.message', [{ type: 'text', text: 'run ls' }]),
      ev('agent.tool_use', [{ type: 'tool_use', id: 'c1', name: 'bash', input: { cmd: 'ls' } }]),
      ev('agent.tool_result', [{ type: 'tool_result', tool_use_id: 'c1', content: 'file.txt' }]),
      ev('agent.message', [{ type: 'text', text: 'done' }]),
    ];
    const msgs = eventsToMessages(events);
    // user, assistant(tool-call), tool(result), assistant(text)
    expect(msgs[0].role).toBe('user');
    expect(msgs[1].role).toBe('assistant');
    expect((msgs[1] as any).content[0].type).toBe('tool-call');
    expect((msgs[1] as any).content[0].toolCallId).toBe('c1');
    expect(msgs[2].role).toBe('tool');
    expect((msgs[2] as any).content[0].toolCallId).toBe('c1');
    expect((msgs[2] as any).content[0].toolName).toBe('bash'); // resolved via pre-pass
  });

  it('pairs MCP tool_use/tool_result the same way', () => {
    const events = [
      ev('agent.mcp_tool_use', [{ type: 'tool_use', id: 'm1', name: 'mcp_mock_echo', input: { text: 'hi' } }]),
      ev('agent.mcp_tool_result', [{ type: 'tool_result', tool_use_id: 'm1', content: 'echo: hi' }]),
    ];
    const msgs = eventsToMessages(events);
    const toolMsg = msgs.find((m) => m.role === 'tool');
    expect(toolMsg).toBeDefined();
    expect((toolMsg as any).content[0].toolCallId).toBe('m1');
    expect((toolMsg as any).content[0].toolName).toBe('mcp_mock_echo');
  });

  it('projects agent.thinking as a reasoning part', () => {
    const events = [
      ev('user.message', [{ type: 'text', text: 'q' }]),
      ev('agent.thinking', [{ type: 'text', text: 'let me think' }]),
      ev('agent.message', [{ type: 'text', text: 'answer' }]),
    ];
    const msgs = eventsToMessages(events);
    const assistant = msgs.find((m) => m.role === 'assistant') as any;
    const reasoning = assistant.content.find((p: any) => p.type === 'reasoning');
    expect(reasoning).toBeDefined();
    expect(reasoning.text).toBe('let me think');
  });

  it('honors the compaction boundary — only events after it, plus summary', () => {
    const events = [
      ev('user.message', [{ type: 'text', text: 'old message' }]),
      ev('agent.message', [{ type: 'text', text: 'old reply' }]),
      ev('agent.thread_context_compacted'),
      ev('user.message', [{ type: 'text', text: 'new message' }]),
    ];
    const msgs = eventsToMessages(events, 'summary of earlier chat');

    // Should contain the summary + the post-boundary user message only
    const texts = msgs.flatMap((m) =>
      typeof (m as any).content === 'string'
        ? [(m as any).content]
        : (m as any).content.map((p: any) => p.text ?? ''),
    );
    const joined = texts.join(' ');
    expect(joined).toContain('summary of earlier chat');
    expect(joined).toContain('new message');
    expect(joined).not.toContain('old message');
    expect(joined).not.toContain('old reply');
  });

  it('returns empty for an empty event log', () => {
    expect(eventsToMessages([])).toHaveLength(0);
  });

  it('skips user.interrupt (not part of model context)', () => {
    const events = [
      ev('user.message', [{ type: 'text', text: 'go' }]),
      ev('user.interrupt'),
      ev('agent.message', [{ type: 'text', text: 'stopped' }]),
    ];
    const msgs = eventsToMessages(events);
    expect(msgs).toHaveLength(2);
    expect(msgs.map((m) => m.role)).toEqual(['user', 'assistant']);
  });
});
