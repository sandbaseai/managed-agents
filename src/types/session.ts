/**
 * Session Types
 *
 * Core session state machine types and event log types.
 */

import type { CMAEventType, ContentBlock } from './cma-protocol.js';

// ============================================================
// Session Status (state machine)
// ============================================================

export type SessionStatus =
  | 'queued'
  | 'running'
  | 'paused'
  | 'requires_action'
  | 'completed'
  | 'failed';

/**
 * Valid state transitions for the Session state machine.
 * Key: current state, Value: set of valid next states.
 *
 * Every non-terminal state can transition to completed/failed, because a
 * session can be stopped (completed) or hit an unrecoverable error (failed)
 * at any point in its life — including while queued or idle (paused).
 */
export const SESSION_TRANSITIONS: Record<SessionStatus, SessionStatus[]> = {
  queued: ['running', 'completed', 'failed'],
  running: ['paused', 'requires_action', 'completed', 'failed'],
  paused: ['running', 'completed', 'failed'],
  requires_action: ['running', 'completed', 'failed'],
  completed: [],
  failed: [],
};

// ============================================================
// Session
// ============================================================

export interface Session {
  id: string; // sess_xxx
  agentId: string;
  agentName: string;
  environmentId: string;
  status: SessionStatus;
  title?: string;
  contextId?: string;
  metadata?: Record<string, unknown>;
  sandboxType?: string;
  sandboxState?: Record<string, unknown>;
  usage?: {
    tokensIn: number;
    tokensOut: number;
  };
  createdAt: Date;
  updatedAt: Date;
  completedAt?: Date;
}

// ============================================================
// Session Event (persisted to Event_Log)
// ============================================================

export interface SessionEvent {
  id: string; // sevt_xxx
  sessionId: string;
  seq: number;
  type: CMAEventType;
  content?: ContentBlock[];
  modelUsed?: string;
  tokensIn?: number;
  tokensOut?: number;
  stopReason?: string;
  durationMs?: number;
  parentEventId?: string;
  delegationDepth?: number;
  createdAt: Date;
  processedAt?: Date;
}

// ============================================================
// Session API Params
// ============================================================

export interface CreateSessionParams {
  agent: string; // agent name or ID
  environmentId?: string;
  contextId?: string;
  title?: string;
  metadata?: Record<string, unknown>;
}

export interface ListSessionsParams {
  page?: number;
  pageSize?: number;
  status?: SessionStatus;
  agentId?: string;
}

export interface PaginatedResult<T> {
  data: T[];
  total: number;
  page: number;
  pageSize: number;
  hasMore: boolean;
}
