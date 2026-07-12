# Requirements

## Purpose

`managed-agents` is a local-first runtime for stateful agents. It loads agent
definitions from project files, runs sessions against configurable model and
sandbox backends, persists event history locally, and exposes a small HTTP API,
SDK, CLI, and built-in Console.

The project is an agent runtime, not a visual workflow engine. It supports
declarative multi-agent collaboration, but it does not define graph nodes,
branches, loops, or a canvas-based workflow DSL.

## Users

- Developers who want to run agents locally while keeping configuration in Git.
- Field engineering teams that need reusable agent definitions and templates.
- Platform teams that need a self-hosted control plane for agent sessions.

## Product Requirements

### R1. Project Setup

1. The runtime shall run on Node.js 22 or newer.
2. The CLI shall initialize a project with agent, skill, and configuration
   directories.
3. The runtime shall start from a project configuration file and load agents,
   skills, model settings, sandbox settings, and optional API keys.
4. Startup output shall report the API URL, Console URL, loaded agents,
   loaded skills, sandbox providers, memory status, target profile, and auth
   status.

### R2. Agent Definitions

1. Agents shall be declared as YAML or JSON files.
2. An agent definition shall include a stable `name`, `model`, and
   `system`.
3. An agent definition may include `description`, `tools`, `skills`,
   `mcp_servers`, `delegations`, `strategy`, `environment`,
   `enable_general_subagent`, `max_turns`, and generation settings.
4. Invalid agent definitions shall be skipped with structured load errors.
5. Agent files shall be portable and reviewable in Git.

### R3. Sessions

1. The runtime shall create sessions for a selected agent.
2. A session shall own its event log, status, metadata, and sandbox lifecycle.
3. The public API shall expose session statuses as `idle`, `running`,
   `terminated`, and `failed`; the runtime may keep additional internal
   lifecycle states.
4. A session shall persist history in an append-only event log.
5. A session shall be recoverable from persisted events after process restart.
6. Session listing shall support pagination and stable ordering.

### R4. Events and Messaging

1. The runtime shall accept structured session events.
2. The runtime shall provide a convenience message endpoint for plain user
   text: `POST /v1/sessions/:id/messages`.
3. The runtime shall persist user messages, agent messages, tool calls, tool
   results, status changes, errors, and compaction boundaries.
4. The runtime shall stream session events over Server-Sent Events.
5. SSE streams shall support replay from the last observed event id.
6. Broadcast-only transient stream chunks may be sent to live subscribers
   without being persisted.

### R5. Agent Execution

1. The default strategy shall build model context from the session event log.
2. The default strategy shall call the configured model through the model
   provider registry.
3. The default strategy shall resolve built-in tools, MCP tools, and delegation
   tools for the active session.
4. Tool calls shall execute through the active sandbox or tool implementation.
5. Tool results shall be recorded back into the event log.
6. Strategy failures shall become structured session errors.

### R6. Sandboxes

1. The runtime shall define a stable `SandboxProvider` interface.
2. The local sandbox provider shall scope file operations to the session
   workspace and reject path traversal.
3. Docker and self-hosted providers may be enabled for stronger isolation or
   remote execution.
4. A sandbox instance shall belong to exactly one session.
5. Sandbox cleanup shall run when a session ends or the service shuts down.

### R7. Tools, Skills, and MCP

1. The runtime shall provide built-in file and shell tools suitable for local
   development.
2. Tool output shall be capped to protect event size and model context size.
3. Skills shall be loaded from Markdown files and injected into the system
   prompt only for agents that request them.
4. MCP servers shall be configured per agent and connected per session.
5. Failed optional tool integrations shall degrade gracefully and report useful
   status.

### R8. Models

1. The runtime shall resolve model references from a local model registry.
2. Model configuration shall support environment variable substitution.
3. Missing model references shall fail agent execution with clear errors.
4. Model calls shall use a retry policy that distinguishes transient,
   authentication, and rate-limit failures.
5. Model usage metadata should be captured when available.

### R9. Persistence and Recovery

1. Local SQLite shall be the default persistent store.
2. Database migrations shall be idempotent.
3. Running sessions found after restart shall be reconciled into a resumable
   state.
4. Orphaned tool calls shall receive placeholder results during recovery.
5. Context compaction shall summarize older history when projected context
   exceeds the configured threshold.
6. Workspace snapshots may be added as an optional file-system recovery layer.

### R10. HTTP API and SDK

1. The API shall expose agents, sessions, session events, health, metrics, MCP
   status, and reload endpoints.
2. Error responses shall be structured and predictable.
3. Optional bearer-token authentication shall protect non-public endpoints when
   configured.
4. The TypeScript SDK shall wrap the HTTP API and SSE stream in ergonomic
   methods.
5. Public API additions shall follow the standard project field names; legacy
   aliases shall not be added for pre-release fields.

### R11. CLI

1. The CLI shall support `init`, `start`, `list`, `reload`, `chat`, and
   template commands.
2. CLI output shall be readable in terminals and useful in scripts.
3. CLI commands shall return non-zero exit codes on failure.
4. Future CLI session commands should support create, list, message, tail, and
   inspect workflows.

### R12. Console

1. The Console shall be served by the same process at `/ui`.
2. The Console shall be implemented as a dedicated React/Vite application under
   `apps/console` and built into `dist/console`.
3. The Console shall show Quickstart templates, agents, sessions,
   environments, credential vaults, memory stores, skills, workspace, local
   runtime, API keys, and observability.
4. The Console shall support creating agents, sessions, environments,
   credential vaults, and memory stores through the public API.
5. The Console shall use the same public API and SSE stream as SDK clients.
6. The Console shall remain usable on desktop and mobile viewports.

### R13. Workspaces

1. A workspace shall be the resource boundary for agents, sessions, skills,
   environments, credential vaults, memory stores, runtime data, and sandbox
   file access.
2. The Web Console shall expose the active local workspace through read-only
   introspection.
3. Workspace switching shall not be represented as client-only UI state.
4. A future desktop shell may provide workspace create, open, and switch
   workflows backed by a local workspace registry and runtime process manager.
5. Credential vaults, memory stores, and session resources shall remain scoped
   to the active workspace.

### R14. Templates

1. Templates shall package reusable agents, skills, and optional MCP settings.
2. The CLI shall support listing and installing templates.
3. Template installation shall never overwrite user files without an explicit
   choice or force flag.
4. Template authoring commands may export a local project layout into a reusable
   template.

### R15. Open Source Readiness

1. Public documentation shall be written in English.
2. Public documentation shall describe this project only.
3. Public documentation shall be project-owned and release-facing.
4. CI shall run type checks, tests, build, and package smoke checks.
5. The package contents shall exclude local runtime data, examples of secrets,
   and temporary development files.
