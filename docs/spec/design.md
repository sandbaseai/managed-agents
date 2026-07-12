# Technical Design

## Overview

`managed-agents` is a single-process TypeScript runtime for local-first agents.
It combines an HTTP API, CLI, SDK, persistent session store, sandbox providers,
model providers, tool loading, and a React Console served by the same process.

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
- Built-in Console for inspection and local operation.
- Safe defaults for local file access and optional API authentication.

## Non-Goals

- No visual workflow canvas.
- No graph-based workflow DSL.
- No hidden remote control plane.
- No public documentation that depends on non-project source material.

## Runtime Structure

```text
apps/
  console/    React/Vite Console source served from dist/console
src/
  api/        HTTP server, auth, routes, and resource APIs
  core/       agents, sessions, events, memory, MCP, skills, templates
  model/      model provider registry
  sandbox/    local, docker, and self-hosted sandbox providers
  sdk/        TypeScript client
  strategy/   session execution strategies
  types/      public runtime and protocol types
```

## Core Concepts

### Agent

An agent is a durable YAML or JSON definition. It declares the model, `system`
instructions, standard toolsets, skills, MCP servers, delegations, strategy, and environment used
by sessions.

### Environment

An environment describes how a session should provision its sandbox. It is a
configuration template, not a running resource.

### Session

A session is the control-plane resource for one conversation or task. It owns
the event log, status, metadata, resources, vault references, and sandbox lifecycle.

### Sandbox

A sandbox is an execution-plane resource. It runs commands and file operations
for one session. A sandbox is never shared across sessions.

### Workspace

A workspace is the project boundary for local and enterprise usage. It owns the
project root, agent files, skills, configuration, runtime data directory,
credential vault metadata, memory store metadata, and local runtime status.

The current Web Console exposes a single active local workspace. Desktop shells
may add a workspace registry, folder picker, and runtime process manager, but
workspace switching must remain a real runtime transition rather than a purely
client-side UI state.

Workspace-scoped resources must not leak across workspace boundaries. This
applies to credentials, memory stores, session resources, sandbox file paths,
and future shared team policy.

## Data Model

The default store is SQLite. The logical tables are:

- `agents` - loaded agent metadata and definition snapshots
- `sessions` - session metadata, status, agent, resources, vault ids, and timestamps
- `environments` - local and configured sandbox environments
- `credential_vaults` - local credential vault metadata
- `memory_stores` - long-term memory store metadata
- `events` - append-only event log ordered by session sequence
- `models` - model registry entries
- `snapshots` - optional workspace snapshot metadata
- `_migrations` - applied database migrations

The event log is the source of truth for reconstructing model context and user
visible history.

Workspace metadata is supplied from the active runtime configuration in the Web
Console. A future desktop shell may persist a local workspace registry outside
the project directory so users can create, open, and switch workspaces without
manually restarting the runtime.

## Event Model

Events are structured objects with:

- `id`
- `session_id`
- `type`
- `content`
- metadata such as model usage, duration, parent event, and timestamps

Persisted events include user messages, agent messages, tool calls, tool
results, status changes, errors, and compaction boundaries.

Transient stream chunks may be broadcast to SSE subscribers without being persisted.
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
- `read`
- `write`
- `edit`
- `glob`
- `grep`

Tool results are capped before they are persisted or returned to the model.

## Skills

Skills are Markdown files with optional frontmatter. An agent opts into skills
with `skills: [{ type: "custom", skill_id }]`. Only selected skills are included
in the system instructions for that agent.

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
- `/v1/environments`
- `/v1/credential-vaults`
- `/v1/memory-stores`
- `/v1/x/health`
- `/v1/x/metrics`
- `/v1/x/mcp/status`
- `/v1/x/reload`
- `/v1/x/runtime`
- `/v1/x/workspace`
- `/v1/x/templates`
- `/v1/x/skills`

Optional bearer-token authentication protects non-public routes when configured.

`/v1/x/workspace` is an extension endpoint for the active local workspace. In
Web P0 it is read-only introspection. Workspace creation and switching should be
implemented through a desktop shell bridge or a future workspace registry API
that can safely restart or rebind the runtime.

## Console

The Console is a React/Vite application built into `dist/console` and served
from `/ui`. It provides:

- Quickstart templates
- agent list and agent creation
- session list and session creation
- environment, credential vault, and memory store management
- skill, workspace, runtime, API key, and observability views

The Console uses the same public API and SSE stream as SDK clients. It does not
read private database state or legacy field aliases.

## Packaging

The package builds to `dist/` and includes runtime code, declarations,
examples, README, license, and public docs. Local runtime state and temporary
development files are excluded from the package.
