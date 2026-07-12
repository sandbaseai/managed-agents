# Technical Design

## Overview

`managed-agents` is a single-process TypeScript runtime for local-first agents.
It combines an HTTP API, CLI, SDK, persistent session store, sandbox providers,
model providers, tool loading, and a dependency-free dashboard.

The runtime is intentionally small at the core. The control plane owns agents,
sessions, events, and lifecycle state. Execution work is delegated to stable
extension contracts: model providers, sandbox providers, tool sources, and
agent strategies.

## Design Goals

- Local-first by default.
- Git-friendly configuration.
- Explicit session lifecycle and append-only event history.
- Pluggable model and sandbox backends.
- Minimal public API surface with clear extension points.
- Built-in dashboard for inspection and local operation.
- Safe defaults for local file access and optional API authentication.

## Non-Goals

- No visual workflow canvas.
- No graph-based workflow DSL.
- No hidden remote control plane.
- No public documentation that depends on non-project source material.

## Runtime Structure

```text
src/
  api/        HTTP server, auth, routes, and dashboard
  core/       agents, sessions, events, memory, MCP, skills, templates
  model/      model provider registry
  sandbox/    local, docker, and self-hosted sandbox providers
  sdk/        TypeScript client
  strategy/   session execution strategies
  types/      public runtime and protocol types
```

## Core Concepts

### Agent

An agent is a durable YAML or JSON definition. It declares the model, system
prompt, tools, skills, MCP servers, delegations, strategy, and environment used
by sessions.

### Environment

An environment describes how a session should provision its sandbox. It is a
configuration template, not a running resource.

### Session

A session is the control-plane resource for one conversation or task. It owns
the event log, status, metadata, context id, and sandbox lifecycle.

### Sandbox

A sandbox is an execution-plane resource. It runs commands and file operations
for one session. A sandbox is never shared across sessions.

## Data Model

The default store is SQLite. The logical tables are:

- `agents` - loaded agent metadata and definition snapshots
- `sessions` - session metadata, status, agent, context id, and timestamps
- `events` - append-only event log ordered by session sequence
- `models` - model registry entries
- `snapshots` - optional workspace snapshot metadata
- `_migrations` - applied database migrations

The event log is the source of truth for reconstructing model context and user
visible history.

## Event Model

Events are structured objects with:

- `id`
- `session_id`
- `seq`
- `type`
- `content`
- metadata such as model usage, duration, parent event, and timestamps

Persisted events include user messages, agent messages, tool calls, tool
results, status changes, errors, and compaction boundaries.

Transient stream chunks may be broadcast to SSE subscribers with `seq = 0`.
They are useful for live rendering, but they do not become part of durable
history.

## Session Execution Flow

1. The API creates a session for an agent.
2. The session manager provisions a sandbox through the configured provider.
3. A user event or message is appended to the event log.
4. The executor builds strategy context from the agent, event log, sandbox,
   tools, skills, MCP connections, and model registry.
5. The strategy builds model messages from the event log.
6. The strategy calls the configured model and processes each step.
7. Tool calls execute through resolved tools or the sandbox.
8. Agent output, tool results, and status changes are appended and broadcast.
9. The session returns to an idle, terminal, or error state.

## Executor Services

The session executor is split into focused services:

- `context-builder.ts` builds system prompt and message context.
- `tool-resolver.ts` resolves built-in tools, MCP tools, and delegation tools.
- `sandbox-lifecycle.ts` provisions and cleans session sandboxes.
- `delegation-service.ts` runs delegated child agents.
- `executor.ts` coordinates the session turn.

This keeps the execution path testable and reduces coupling between session
state, sandbox lifecycle, and tool resolution.

## Extension Contracts

### ModelProvider

```ts
interface ModelProvider {
  readonly name: string;
  createModel(config: ModelConfig): unknown;
  healthCheck?(config: ModelConfig): Promise<boolean>;
}
```

### SandboxProvider

```ts
interface SandboxProvider {
  readonly type: string;
  provision(sessionId: string, config: EnvironmentConfig): Promise<SandboxInstance>;
}

interface SandboxInstance {
  readonly sessionId: string;
  execute(command: string, options?: ExecOptions): Promise<ExecResult>;
  writeFile(path: string, content: string | Buffer): Promise<void>;
  readFile(path: string): Promise<string>;
  listFiles(path: string): Promise<string[]>;
  cleanup(): Promise<void>;
}
```

### AgentStrategy

```ts
interface AgentStrategy {
  readonly name: string;
  execute(context: StrategyContext): AsyncIterable<SessionEvent>;
}
```

## Built-In Tools

The default local tool set includes:

- `bash`
- `read_file`
- `write_file`
- `edit`
- `glob`
- `grep`

Tool results are capped before they are persisted or returned to the model.

## Skills

Skills are Markdown files with optional frontmatter. An agent opts into skills
by name. Only selected skills are included in the system prompt for that agent.

## MCP Connections

MCP servers are declared in agent configuration. Connections are opened per
session, namespaced as runtime tools, and closed during session cleanup.
Connection failures are reported without preventing unrelated tools from
working.

## Context Compaction

When projected history exceeds the configured context threshold, the runtime
creates a summary boundary event. Future context projection includes the latest
summary and events after that boundary.

Compaction failure is best-effort: it should not fail the user turn.

## Crash Recovery

On startup, the runtime inspects sessions left in a running state. It reconciles
them into a resumable state and injects placeholder results for orphaned tool
calls when needed.

## HTTP API

The API is grouped by resources:

- `/v1/agents`
- `/v1/sessions`
- `/v1/sessions/:id/events`
- `/v1/sessions/:id/events/stream`
- `/v1/sessions/:id/messages`
- `/v1/x/health`
- `/v1/x/metrics`
- `/v1/x/mcp/status`
- `/v1/x/reload`

Optional bearer-token authentication protects non-public routes when configured.

## Dashboard

The v1 dashboard is embedded HTML, CSS, and JavaScript served from `/ui`. It
provides:

- agent list
- session list
- chat view
- trajectory view
- runtime metrics
- session inspector
- agent inspector
- system prompt preview

The dashboard uses the same public API and SSE stream as SDK clients.

## Packaging

The package builds to `dist/` and includes runtime code, declarations,
examples, README, license, and public docs. Local runtime state and temporary
development files are excluded from the package.
