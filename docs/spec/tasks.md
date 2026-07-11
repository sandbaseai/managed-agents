# Implementation Plan: managed-agents (MVP)

## Overview

This implementation plan covers the minimum viable path for managed-agents — a CMA-compatible agent runtime built with TypeScript, Hono, better-sqlite3, and Vercel AI SDK.

MVP scope: project setup → CMA protocol types → Agent YAML loading → Session state machine + Event_Log → Vercel AI SDK streamText → CMA-compatible API → end-to-end verification with @anthropic-ai/sdk.

**Architecture decision: single-package monorepo (NOT multi-package).**

Small team, no internal npm publish — all code lives in one `src/` directory with clear folder structure instead of separate packages. This avoids workspace linking overhead and simplifies imports.

```
managed-agents/
├── src/
│   ├── core/           # Session, EventLog, Agent loader, state machine
│   ├── strategy/       # AgentStrategy implementations (DefaultStrategy)
│   ├── sandbox/        # SandboxProvider implementations (local)
│   ├── model/          # ModelProvider registry
│   ├── api/            # Hono HTTP routes (CMA-compatible)
│   └── types/          # All TypeScript interfaces and CMA protocol types
├── tests/
│   ├── unit/
│   ├── property/
│   └── integration/
├── examples/
│   └── basic/          # Example agent YAML + config for verification
├── package.json        # Single package: "managed-agents"
├── tsconfig.json
└── vitest.config.ts
```

**Reference projects** (all cloned at `/Users/liyb/code-new/sandbase-monorepo/references/`):
- `open-managed-agents/` — OMA: core reference for Session/Event/Loop/Sandbox/eventsToMessages
- `vercel-ai-sdk/` — Engine loop source: `packages/ai/src/generate-text/`
- `cloudflare-claude-managed-agents/` — CMA webhook/event types
- `vercel-cma-starter/.agents/skills/claude-api/shared/managed-agents-events.md` — Full CMA event type reference
- `claude-agent-sdk-python/src/claude_agent_sdk/types.py` — CMA type definitions
- `linear-claude-managed-agents-demo/src/agent.ts` — CMA client calling pattern

## Tasks

- [ ] 1. Initialize project structure and extract CMA protocol types
  - [ ] 1.1 Set up single-package project structure
    - Create `package.json` with name `managed-agents`, type `module`, engines `node>=22`
    - Install core dependencies: `typescript`, `hono`, `@hono/node-server`, `better-sqlite3`, `ai` (Vercel AI SDK), `@ai-sdk/openai`, `@ai-sdk/anthropic`, `yaml`, `zod`, `nanoid`
    - Install dev dependencies: `vitest`, `fast-check`, `@types/better-sqlite3`, `@types/node`, `tsx`, `tsup`
    - Create `tsconfig.json` (strict, ESM, paths alias `@/` → `src/`)
    - Create `vitest.config.ts`
    - Create `src/` directory structure as shown in overview
    - _Requirements: 1.1, 1.2_

  - [ ] 1.2 Extract complete CMA protocol types from reference projects
    - Read CMA event types from: `references/vercel-cma-starter/.agents/skills/claude-api/shared/managed-agents-events.md`
    - Read CMA type definitions from: `references/open-managed-agents/packages/api-types/src/types.ts`
    - Read session/event patterns from: `references/linear-claude-managed-agents-demo/src/agent.ts`
    - Create `src/types/cma-protocol.ts` — complete CMA event type definitions:
      - User events: `user.message`, `user.interrupt`, `user.custom_tool_result`, `user.tool_confirmation`
      - Agent events: `agent.message`, `agent.thinking`, `agent.tool_use`, `agent.tool_result`, `agent.mcp_tool_use`, `agent.mcp_tool_result`, `agent.custom_tool_use`, `agent.thread_context_compacted`
      - Session events: `session.status_idle`, `session.status_running`, `session.status_rescheduled`, `session.status_terminated`, `session.error`, `session.deleted`
      - Span events: `span.model_request_start`, `span.model_request_end`
      - Terminal event: `turn_complete`
      - Total: 21 event types (4 user + 8 agent + 6 session + 2 span + 1 terminal) — verify count against `src/types/index.ts` export before closing this task
    - Create `src/types/session.ts` — Session, SessionStatus, SessionEvent, ContentBlock
    - Create `src/types/agent.ts` — AgentDefinition, McpServerConfig
    - Create `src/types/sandbox.ts` — SandboxProvider, SandboxInstance, ExecOptions, ExecResult
    - Create `src/types/strategy.ts` — AgentStrategy, StrategyContext, AgentStrategyConfig
    - Create `src/types/model.ts` — ModelProvider, ModelConfig
    - Create `src/types/index.ts` — barrel export
    - _Requirements: 7.3, 9.4_

  - [ ] 1.3 Set up SQLite database layer with schema and migrations
    - Create `src/core/db/migrations/001_initial.sql` — full schema:
      - `_migrations` (version tracking)
      - `agents` (id, name, definition JSON, status, error_message, loaded_at, updated_at)
      - `environments` (id, name, config JSON, created_at)
      - `sessions` (id, agent_id, agent_name, environment_id, status, title, context_id, metadata JSON, sandbox_type, sandbox_state JSON, usage_tokens_in, usage_tokens_out, created_at, updated_at, completed_at)
      - `events` (id, session_id, seq, type, content JSON, model_used, tokens_in, tokens_out, stop_reason, duration_ms, parent_event_id, delegation_depth, created_at, processed_at)
      - `compaction_boundaries` (id, session_id, summary, event_id_before, tokens_before, tokens_after, created_at)
      - `models` (name, provider, model, base_url, config JSON, created_at)
      - `snapshots` (id, session_id, path, size_bytes, created_at)
      - All indexes as defined in design.md
    - Create `src/core/db/database.ts` — Database class:
      - Constructor opens/creates SQLite file, runs pending migrations
      - Methods: `exec()`, `prepare()`, `transaction()`
      - Default path: `.managed-agents/data.db` (auto-create directory)
    - Reference: `references/open-managed-agents/apps/main-node/src/index.ts` (SQLite setup pattern)
    - _Requirements: 1.2, 8.1, 8.2, 8.3, 8.6_

  - [ ]* 1.4 Write property test for database migration idempotency
    - **Property 17**: Run migration sequence multiple times, verify schema and data are identical
    - **Validates: Requirements 8.4**

- [ ] 2. Implement Agent YAML loading and schema validation
  - [ ] 2.1 Implement Agent definition schema validator
    - Create `src/core/agent/schema.ts`
    - Use `zod` to define AgentDefinition schema:
      - Required: `name` (string, unique identifier), `model` (string, model registry ref), `system_prompt` (string)
      - Optional: `description`, `skills` (string[]), `mcp_servers` (McpServerConfig[]), `tools` (string[]), `max_turns` (number, default 50), `temperature` (number, default 0.7), `delegations` (string[]), `enable_general_subagent` (boolean), `strategy` (string, default 'default'), `environment` (string, default 'local')
    - Return structured errors with field path and reason on validation failure
    - _Requirements: 2.2, 2.3, 2.6_

  - [ ]* 2.2 Write property test for Agent definition schema validation
    - **Property 1**: Generate random AgentDefinition objects (valid and invalid), verify schema accepts/rejects correctly
    - **Validates: Requirements 2.2, 2.4, 2.6**

  - [ ] 2.3 Implement Agent YAML loader
    - Create `src/core/agent/loader.ts`
    - Implement `loadAgents(agentsDir: string)` — scan directory for `.yaml` and `.json` files
    - Parse each file with `yaml` package, run schema validation
    - On validation failure: log error with file path and reason; skip agent; continue loading others
    - Return `{ agents: AgentDefinition[], errors: LoadError[] }`
    - _Requirements: 2.1, 2.4_

  - [ ] 2.4 Implement environment variable resolver
    - Create `src/core/config/env-resolver.ts`
    - Implement `resolveEnvVars(value: string): string` — replace `${VAR_NAME}` with `process.env` values
    - If env var not found and context requires it: throw descriptive error
    - Recursively resolve in nested objects (for mcp_servers.env, api_key fields)
    - _Requirements: 5.7, 6.3_

  - [ ]* 2.5 Write property test for environment variable resolution
    - **Property 13**: Generate random strings with `${VAR}` patterns, set env vars, verify resolution
    - **Validates: Requirements 5.7**

- [ ] 3. Checkpoint
  - Run `npm test` — ensure all tests pass. Ask user if questions arise.

- [ ] 4. Implement Session state machine and Event_Log
  - [ ] 4.1 Implement Session state machine
    - Create `src/core/session/state-machine.ts`
    - Valid transitions: `queued→running`, `running→paused`, `running→requires_action`, `running→completed`, `running→failed`, `paused→running`, `requires_action→running`
    - Implement `transition(current: SessionStatus, trigger: string): SessionStatus` — throws on invalid transition
    - _Requirements: 9.4_

  - [ ]* 4.2 Write property test for Session state machine
    - **Property 6**: Generate random event sequences, verify only valid transitions occur
    - **Validates: Requirements 9.4**

  - [ ] 4.3 Implement Event Logger (append-only)
    - Create `src/core/session/event-logger.ts`
    - Methods: `append(sessionId, event)`, `getEvents(sessionId, afterSeq?)`, `getLatestSeq(sessionId)`
    - Append-only — no update/delete methods exposed
    - Auto-increment `seq` per session, generate `sevt_` prefixed IDs
    - _Requirements: 9.6_

  - [ ]* 4.4 Write property test for Event_Log append-only invariant
    - **Property 7**: Append random events, verify length monotonically increases and content unchanged
    - **Validates: Requirements 9.6**

  - [ ] 4.5 Implement Session Manager
    - Create `src/core/session/session-manager.ts`
    - Methods: `create(params)`, `sendEvent(sessionId, event)`, `subscribe(sessionId, afterSeq?)`, `resume(sessionId, newProvider?)`, `get(sessionId)`, `list(params)`, `stop(sessionId)`
    - `create()`: generate `sess_` ID, insert DB with status `queued`
    - `sendEvent()`: return `{ accepted: true }` synchronously; execution result via SSE (subscribe)
    - `subscribe()`: return AsyncIterable<SessionEvent> (SSE pub/sub channel, independent of sendEvent)
    - `resume(sessionId, newProvider?)`: for a Session in `paused`/`requires_action`/`idle` status, re-provision a Sandbox (optionally via a different `SandboxProvider` than the one used at creation), rebuild model context via `eventsToMessages(eventLog.getEvents(sessionId))`, and mark the Session ready to accept the next `sendEvent()` call — does NOT itself dispatch an event, only re-establishes the Sandbox + context. Reject with an error if Session status is `completed`/`failed`
    - `list()`: paginated (default 20, ordered by created_at DESC)
    - _Requirements: 9.2, 9.4, 9.5, 9.6, 9.7, 8.5_

  - [ ]* 4.6 Write property test for Session pagination
    - **Property 16**: Insert N sessions, paginate with varying pageSize, verify no duplicates/gaps
    - **Validates: Requirements 8.5**

  - [ ]* 4.7 Write property test for Session resume context restoration
    - **Property 8**: For a paused Session, resume with a different SandboxProvider than the one used at creation, verify the message sequence rebuilt via `eventsToMessages()` is semantically equivalent to the pre-pause context
    - **Validates: Requirements 9.5, 9.7**

- [ ] 5. Checkpoint
  - Run `npm test` — ensure all tests pass. Ask user if questions arise.

- [ ] 6. Connect Vercel AI SDK streamText (DefaultStrategy)
  - [ ] 6.1 Implement DefaultStrategy with Vercel AI SDK streamText
    - Create `src/strategy/default-strategy.ts`
    - Implement `DefaultStrategy` class implementing `AgentStrategy` interface
    - Use `streamText` with `maxSteps` for automatic tool loop
    - On each step: append event to Event_Log, broadcast via SSE
    - Handle `onStepFinish` for tool_use / tool_result / agent.message events
    - Wire `AgentStrategyConfig` lifecycle hooks explicitly, invoked from inside `execute()`:
      - `beforeTurn(ctx)` — called once before the maxSteps loop starts (used later for Memory Provider injection, currently a no-op passthrough)
      - `afterStep(step)` — called after each `onStepFinish` step, before broadcasting
      - `onError(error)` — called on thrown/streamed error, return value (`'retry' | 'abort'`) determines loop continuation
      - `onComplete(result)` — called once after the loop exits normally
      - `onCompact` — stub only in this task; real wiring happens when Context Compactor is built (deferred, see Notes)
    - _Requirements: 9.19, 6.5_

  - [ ] 6.2 Implement eventsToMessages mapper
    - Create `src/core/session/events-to-messages.ts`
    - Implement `eventsToMessages(events: SessionEvent[]): CoreMessage[]`
    - Rules: respect compaction boundary, skip session.*/span.* events, pair tool_use + tool_result, iterate by seq
    - Reference: `references/open-managed-agents/apps/agent/src/runtime/history.ts`
    - _Requirements: 9.5, 9.6_

  - [ ] 6.3 Implement Local Sandbox Provider
    - Create `src/sandbox/local-provider.ts`
    - `provision()`: create `.managed-agents/sandbox/<session_id>/` directory
    - `execute()`: `child_process.spawn('/bin/sh', ['-c', cmd])` with timeout watchdog
    - `writeFile()` / `readFile()`: scoped to working directory
    - `listFiles(path)`: return relative file paths under the working directory (scoped, no traversal outside it)
    - `cleanup()`: remove working directory
    - Reference: `references/open-managed-agents/packages/sandbox/src/adapters/local-subprocess.ts`
    - _Requirements: 12.1, 12.2, 12.5_

  - [ ]* 6.4 Write property test for Sandbox execution timeout
    - **Property 20**: Execute commands that exceed timeout, verify `timedOut: true`
    - **Validates: Requirements 12.5**

  - [ ] 6.5 Implement Model Provider registry
    - Create `src/model/registry.ts`
    - Methods: `register(config)`, `get(name)`, `createModel(name): LanguageModelV1`, `healthCheck(name): Promise<boolean>`
    - Support: `openai` (via `@ai-sdk/openai` — covers Ollama/vLLM too), `anthropic` (via `@ai-sdk/anthropic`)
    - Resolve `${ENV_VAR}` in api_key and base_url
    - Throw descriptive error if model not registered
    - `healthCheck(name)`: issue a minimal test call (e.g. 1-token completion) against the registered model, return false on any error instead of throwing
    - Implement the model-call retry policy here (wraps `createModel()` calls made by DefaultStrategy): network timeout retries up to 3x with no backoff, 401/403 auth failures never retry, 429 rate limits wait per `Retry-After` header (up to 3 retries)
    - _Requirements: 6.1, 6.2, 6.3, 6.4, 6.6_

  - [ ]* 6.6 Write property test for model retry policy
    - **Property 14**: For each error type (timeout/auth/rate-limit), verify retry count and wait behavior exactly matches the policy (timeout: 3x no backoff, auth: 0x, rate-limit: Retry-After honored up to 3x)
    - **Validates: Requirements 6.6**

  - [ ] 6.7 Wire Session execution end-to-end
    - Update `SessionManager.sendEvent()` to:
      1. Load agent definition for the session
      2. Create model via `ModelRegistry.createModel(agent.model)`
      3. Provision sandbox via `LocalSandboxProvider.provision(sessionId)`
      4. Build messages from `eventsToMessages(eventLog.getEvents(sessionId))`
      5. Execute `DefaultStrategy.execute(context)` and iterate events
      6. Broadcast events to subscribers, update session status on completion/failure
    - Update `SessionManager.resume()` (task 4.5) to reuse steps 2-4 above without dispatching an event, so a resumed Session is ready for the next `sendEvent()` call
    - _Requirements: 9.2, 9.19_

- [ ] 7. Checkpoint
  - Run `npm test` — ensure all tests pass. Ask user if questions arise.

- [ ] 8. Expose CMA-compatible API
  - [ ] 8.1 Set up Hono HTTP server
    - Create `src/api/server.ts` — Hono app with CORS, JSON body parsing
    - Create `src/api/index.ts` — export `createServer(config)` factory function
    - Wire SessionManager, AgentLoader, ModelRegistry as dependencies
    - _Requirements: 1.1, 7.1_

  - [ ] 8.2 Implement CMA-compatible REST endpoints
    - Create `src/api/routes/sessions.ts`:
      - `POST /v1/sessions` — create session (agent, environment_id, optional context_id, vault_ids)
      - `GET /v1/sessions` — list sessions (paginated)
      - `GET /v1/sessions/:id` — get session detail
      - `POST /v1/sessions/:id/events` — send events (user.message, user.interrupt, etc.)
      - `GET /v1/sessions/:id/events` — list events (paginated, with limit param)
      - `POST /v1/sessions/:id/stop` — stop session
      - `DELETE /v1/sessions/:id` — delete session
    - Create `src/api/routes/agents.ts`:
      - `GET /v1/agents` — list loaded agents
      - `GET /v1/agents/:id` — get agent detail
    - Create `src/api/routes/extended.ts` (`/v1/x/*` prefix, platform-specific, non-CMA):
      - `POST /v1/x/reload` — hot-reload all Agent definitions (calls `loadAgents()` from task 2.3 and refreshes the in-memory/DB agent cache)
      - `GET /v1/x/health` — basic health check (DB reachable, returns 200)
    - Follow CMA protocol response structure (reference: managed-agents-events.md)
    - Unknown fields in request body silently ignored (forward compat)
    - _Requirements: 7.1, 7.2, 7.3, 7.4, 7.6, 2.5_

  - [ ]* 8.3 Write property test for CMA API unknown field forward compatibility
    - **Property 15**: Send requests with random extra fields, verify normal processing
    - **Validates: Requirements 7.6**

  - [ ] 8.4 Implement SSE streaming endpoint
    - Create `src/api/routes/stream.ts`:
      - `GET /v1/sessions/:id/events/stream` — SSE endpoint
    - Subscribe to SessionManager's event broadcast for the session
    - Support `Last-Event-ID` header for resume (via events.seq)
    - Stream events as SSE `data:` lines with `id:` set to event seq
    - _Requirements: 7.5_

  - [ ] 8.5 Implement server entry point
    - Create `src/index.ts` — main entry point
    - Parse CLI args: `--port` (default 3000), `--data-dir` (default `.managed-agents`)
    - Load config file (`managed-agents.config.yaml`):
      - Parse `models:` array → call `ModelRegistry.register()` for each entry, resolving `${ENV_VAR}` in `api_key`/`base_url` via the env resolver (task 2.4)
      - Parse `environments:` map → insert/upsert into the `environments` table via `Database`
      - Missing config file: fall back to a single default `local` environment and no pre-registered models (agents referencing unregistered models fail per Requirement 6.4)
    - Initialize: Database → load Agents → register Models → create SessionManager → start Hono
    - Log access URLs to terminal on ready
    - Handle SIGINT/SIGTERM: graceful shutdown (close DB, stop sessions, release MCP)
    - If port occupied: output clear error and exit
    - _Requirements: 1.1, 1.2, 1.3, 1.4, 1.5, 1.6, 6.3, 6.4_

  - [ ] 8.6 Add CLI bin entry with core commands
    - Add `"bin": { "managed-agents": "./dist/index.js" }` to package.json
    - Add build script (`tsup` for bundling)
    - Use Commander.js to implement subcommands:
      - `managed-agents start` — launch server (task 8.5 behavior). Ensure `npx managed-agents` with no subcommand defaults to `start`
      - `managed-agents init` — scaffold `agents/`, `skills/` directories, a `managed-agents.config.yaml` template, and one example Agent definition in the current directory; error if `agents/` already exists (no silent overwrite)
      - `managed-agents list` — connect to a running instance's `/v1/agents` endpoint (or read DB directly if no server running) and print loaded Agent names, status, and model
      - `managed-agents reload` — POST to `/v1/x/reload` (task 8.2's extended endpoint) against a running instance
    - On any command error: print `Error: [TYPE] reason` + suggestion line (per design.md CLI error format), exit with non-zero code
    - _Requirements: 1.1, 11.1, 11.2, 11.4, 11.5, 11.7_

- [ ] 9. Checkpoint
  - Run `npm test` — ensure all tests pass. Ask user if questions arise.

- [ ] 10. End-to-end verification
  - [ ] 10.1 Create integration test: full CMA flow with @anthropic-ai/sdk
    - Install `@anthropic-ai/sdk` as dev dependency
    - Create `tests/integration/cma-compat.test.ts`
    - Test flow:
      1. Start server programmatically on a random test port
      2. Create Anthropic client with `baseURL` pointing to `http://localhost:<port>`
      3. Call `client.beta.sessions.create({ agent: agentId, environment_id: envId })`
      4. Call `client.beta.sessions.events.send(sessionId, { events: [{ type: 'user.message', content: [...] }] })`
      5. Stream events via `client.beta.sessions.events.stream(sessionId)` and collect
      6. Verify: got `agent.message` event with response text
      7. Verify: session status transitions (queued → running → idle/completed)
    - Use mock model provider that echoes input for deterministic testing
    - _Requirements: 7.2, 7.5_

  - [ ] 10.2 Create example agent and config
    - Create `examples/basic/agents/echo-assistant.yaml`:
      ```yaml
      name: echo-assistant
      model: local-echo
      system_prompt: "You are a helpful echo assistant. Repeat what the user says."
      ```
    - Create `examples/basic/managed-agents.config.yaml`:
      ```yaml
      models:
        - name: local-echo
          provider: openai
          model: gpt-4o
          base_url: ${OPENAI_BASE_URL}
          api_key: ${OPENAI_API_KEY}
      environments:
        local:
          sandbox_provider: local
          timeout: 300
      ```
    - Add `examples/basic/README.md` with usage instructions
    - _Requirements: 2.1, 6.3_

- [ ] 11. Final checkpoint
  - Run full test suite (`npm test`), verify all pass.
  - Verify `npx managed-agents start` works from the examples/basic directory.
  - Ask user if questions arise.

## Notes

- Tasks marked with `*` are optional property tests (can skip for faster MVP)
- Each task references specific requirements for traceability
- Checkpoints (tasks 3, 5, 7, 9, 11) ensure incremental validation
- **Single package** — no workspace linking, no internal npm publish. All `src/` imports use `@/` path alias
- **Naming**: package is `managed-agents`, no `@sandbase/core` or `@sandbase/api` scope
- **Reference code is at** `/Users/liyb/code-new/sandbase-monorepo/references/`
- MVP defers: Web UI, multi-agent delegation (`AgentOrchestrator.delegate`/`detectCycle`/`getDepth`, Requirement 3), MCP integration (Requirement 5), Skills system (Requirement 4), Templates (Requirement 14), crash recovery / orphan reconciliation (Requirement 9.10), Context Compaction (Requirement 9.15, `ContextCompactor` class), Memory Provider (Requirement 9.16-9.18), CLI `chat` and `deploy` commands (Requirement 11.3, 11.6), Workspace Snapshots (Requirement 9.11), `self_hosted` Sandbox work-queue mode (Requirement 9.14), `agent_with_overrides` (Requirement 9.13)
- Covered in this MVP (previously looked deferred but are now explicit): Session `resume()` (task 4.5), CLI `init`/`list`/`reload` (task 8.6), Model Provider `healthCheck()` + retry policy (task 6.5/6.6), Sandbox `listFiles()` (task 6.3), AgentStrategy lifecycle hooks wiring (task 6.1), config file `models:`/`environments:` loading (task 8.5)

## Task Dependency Graph

```json
{
  "waves": [
    { "id": 0, "tasks": ["1.1"] },
    { "id": 1, "tasks": ["1.2", "1.3"] },
    { "id": 2, "tasks": ["1.4", "2.1", "2.4"] },
    { "id": 3, "tasks": ["2.2", "2.3", "2.5"] },
    { "id": 4, "tasks": ["4.1", "4.3"] },
    { "id": 5, "tasks": ["4.2", "4.4", "4.5"] },
    { "id": 6, "tasks": ["4.6", "4.7", "6.1", "6.2", "6.3", "6.5"] },
    { "id": 7, "tasks": ["6.4", "6.6", "6.7"] },
    { "id": 8, "tasks": ["8.1"] },
    { "id": 9, "tasks": ["8.2", "8.4", "8.5"] },
    { "id": 10, "tasks": ["8.3", "8.6"] },
    { "id": 11, "tasks": ["10.1", "10.2"] }
  ]
}
```
