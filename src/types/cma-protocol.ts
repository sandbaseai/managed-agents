/**
 * CMA Protocol Event Types
 *
 * Complete type definitions for the Claude Managed Agents protocol events.
 * Source of truth: Anthropic CMA event specification.
 *
 * Event types use dot notation, grouped by namespace:
 * - user.*      — Events sent by the client to the session
 * - agent.*     — Events emitted by the agent during execution
 * - session.*   — Session lifecycle status events
 * - span.*      — Observability spans (model request timing)
 */

// ============================================================
// Event Type Enum
// ============================================================

/**
 * All possible CMA event types.
 * 4 user + 8 agent + 6 session + 2 span + 1 terminal = 21 total
 */
export type CMAEventType =
  // User events (4)
  | 'user.message'
  | 'user.interrupt'
  | 'user.tool_confirmation'
  | 'user.custom_tool_result'
  // Agent events (8)
  | 'agent.message'
  | 'agent.thinking'
  | 'agent.tool_use'
  | 'agent.tool_result'
  | 'agent.mcp_tool_use'
  | 'agent.mcp_tool_result'
  | 'agent.custom_tool_use'
  | 'agent.thread_context_compacted'
  // Streaming events (transient — broadcast over SSE only, never persisted)
  | 'agent.message_stream_start'
  | 'agent.message_chunk'
  | 'agent.message_stream_end'
  // Session events (6)
  | 'session.status_idle'
  | 'session.status_running'
  | 'session.status_rescheduled'
  | 'session.status_terminated'
  | 'session.error'
  | 'session.deleted'
  // Span events (2)
  | 'span.model_request_start'
  | 'span.model_request_end'
  // Terminal event (1)
  | 'turn_complete';

// ============================================================
// Content Blocks
// ============================================================

export interface TextBlock {
  type: 'text';
  text: string;
}

export interface ImageSource {
  type: 'base64' | 'url' | 'file';
  media_type?: string;
  data?: string;
  url?: string;
  file_id?: string;
}

export interface ImageBlock {
  type: 'image';
  source: ImageSource;
}

export interface DocumentSource {
  type: 'base64' | 'url' | 'file' | 'text';
  media_type?: string;
  data?: string;
  url?: string;
  file_id?: string;
}

export interface DocumentBlock {
  type: 'document';
  source: DocumentSource;
  title?: string;
  context?: string;
  citations?: { enabled: boolean };
}

export interface ToolUseBlock {
  type: 'tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface ToolResultBlock {
  type: 'tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export type ContentBlock =
  | TextBlock
  | ImageBlock
  | DocumentBlock
  | ToolUseBlock
  | ToolResultBlock;

// ============================================================
// Event Base
// ============================================================

export interface EventBase {
  /** Event ID, prefixed with `sevt_` */
  id?: string;
  /** ISO 8601 timestamp when the event was processed by the agent */
  processed_at?: string;
  /** Causal predecessor event ID */
  parent_event_id?: string;
  /** Free-form metadata extension point */
  metadata?: Record<string, unknown>;
}

// ============================================================
// User Events (sent to session)
// ============================================================

export interface UserMessageEvent extends EventBase {
  type: 'user.message';
  content: ContentBlock[];
}

export interface UserInterruptEvent extends EventBase {
  type: 'user.interrupt';
}

export interface UserToolConfirmationEvent extends EventBase {
  type: 'user.tool_confirmation';
  tool_use_id: string;
  result: 'allow' | 'deny';
  deny_message?: string;
}

export interface UserCustomToolResultEvent extends EventBase {
  type: 'user.custom_tool_result';
  custom_tool_use_id: string;
  content: ContentBlock[];
  is_error?: boolean;
}

export type UserEvent =
  | UserMessageEvent
  | UserInterruptEvent
  | UserToolConfirmationEvent
  | UserCustomToolResultEvent;

// ============================================================
// Agent Events (emitted during execution)
// ============================================================

export interface AgentMessageEvent extends EventBase {
  type: 'agent.message';
  content: ContentBlock[];
  message_id?: string;
}

export interface AgentThinkingEvent extends EventBase {
  type: 'agent.thinking';
  text?: string;
  thinking_id?: string;
  providerOptions?: Record<string, unknown>;
}

export interface AgentToolUseEvent extends EventBase {
  type: 'agent.tool_use';
  /** Tool use ID for pairing with tool_result */
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentToolResultEvent extends EventBase {
  type: 'agent.tool_result';
  tool_use_id: string;
  content: string | ContentBlock[];
  is_error?: boolean;
}

export interface AgentMcpToolUseEvent extends EventBase {
  type: 'agent.mcp_tool_use';
  id: string;
  mcp_server_name: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentMcpToolResultEvent extends EventBase {
  type: 'agent.mcp_tool_result';
  mcp_tool_use_id: string;
  content: string;
  is_error?: boolean;
}

export interface AgentCustomToolUseEvent extends EventBase {
  type: 'agent.custom_tool_use';
  id: string;
  name: string;
  input: Record<string, unknown>;
}

export interface AgentThreadContextCompactedEvent extends EventBase {
  type: 'agent.thread_context_compacted';
}

export type AgentEvent =
  | AgentMessageEvent
  | AgentThinkingEvent
  | AgentToolUseEvent
  | AgentToolResultEvent
  | AgentMcpToolUseEvent
  | AgentMcpToolResultEvent
  | AgentCustomToolUseEvent
  | AgentThreadContextCompactedEvent;

// ============================================================
// Session Events (lifecycle status changes)
// ============================================================

export interface SessionStatusIdleEvent extends EventBase {
  type: 'session.status_idle';
  stop_reason?: {
    type: 'end_turn' | 'requires_action';
    event_ids?: string[];
    action_type?: 'tool_confirmation' | 'custom_tool_result';
  };
}

export interface SessionStatusRunningEvent extends EventBase {
  type: 'session.status_running';
}

export interface SessionStatusRescheduledEvent extends EventBase {
  type: 'session.status_rescheduled';
}

export interface SessionStatusTerminatedEvent extends EventBase {
  type: 'session.status_terminated';
  reason?: string;
}

export interface SessionErrorEvent extends EventBase {
  type: 'session.error';
  error: {
    type: string;
    message: string;
  };
}

export interface SessionDeletedEvent extends EventBase {
  type: 'session.deleted';
}

export type SessionLifecycleEvent =
  | SessionStatusIdleEvent
  | SessionStatusRunningEvent
  | SessionStatusRescheduledEvent
  | SessionStatusTerminatedEvent
  | SessionErrorEvent
  | SessionDeletedEvent;

// ============================================================
// Span Events (observability)
// ============================================================

export interface SpanModelRequestStartEvent extends EventBase {
  type: 'span.model_request_start';
  model?: string;
}

export interface SpanModelRequestEndEvent extends EventBase {
  type: 'span.model_request_end';
  model_request_start_id?: string;
  is_error?: boolean;
  model_usage?: {
    input_tokens: number;
    output_tokens: number;
    cache_read_input_tokens?: number;
    cache_creation_input_tokens?: number;
  };
}

export type SpanEvent = SpanModelRequestStartEvent | SpanModelRequestEndEvent;

// ============================================================
// Terminal Event
// ============================================================

export interface TurnCompleteEvent extends EventBase {
  type: 'turn_complete';
}

// ============================================================
// Union of all CMA events
// ============================================================

export type CMAEvent =
  | UserEvent
  | AgentEvent
  | SessionLifecycleEvent
  | SpanEvent
  | TurnCompleteEvent;
