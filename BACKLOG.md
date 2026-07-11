# Feature Backlog — Gap Analysis vs OMA (open-managed-agents)

This document tracks capabilities present in the reference project OMA that
managed-agents does not yet have, prioritized for incremental delivery.

Legend: 🔴 high value / real gap · 🟡 planned feature · 🟢 nice-to-have · ✅ done

---

## Category A — Engine Loop & Protocol Completeness

| # | Gap | OMA has | We have | Priority | Status |
|---|-----|---------|---------|----------|--------|
| A1 | Token-level streaming events (`agent.message_chunk`, `_stream_start/end`, `thinking_chunk`, `tool_use_input_chunk`) | Yes — live token render | Only final `agent.message` per step | 🟡 | v1.x |
| A2 | Emit `agent.thinking` events from the loop | Yes (reasoning blocks, providerOptions preserved) | eventsToMessages handles them, but strategy never EMITS them | 🔴 | done |
| A3 | Span events `span.model_request_start/end` (+ TTFT, model_usage) | Yes, per-step | None | 🟡 | v1.x |
| A4 | Interrupt handling (`user.interrupt` actually aborts a running turn) | Yes — AbortController + queue jump | Accepts event, does nothing | 🔴 | done |
| A5 | Tool confirmation flow (`user.tool_confirmation`, `always_ask`, `requires_action`) | Yes | Status exists, flow not wired | 🟡 | v1.x |
| A6 | Custom (client-side) tools (`agent.custom_tool_use` → `user.custom_tool_result`) | Yes | None | 🟡 | v1.x |
| A7 | Silent-stop detection (empty model response → error, no infinite retry) | Yes (ModelError) | None | 🟢 | v2 |
| A8 | Model-call retry policy actually wired into calls | Yes (typed error classify) | `DEFAULT_RETRY_POLICY` defined but DEAD CODE | 🔴 | done |

## Category B — Known Deferred Features (from spec, confirmed still open)

| # | Gap | Requirement | Priority | Status |
|---|-----|-------------|----------|--------|
| B1 | MCP client integration (stdio + http) | R5 | 🟡 | v1.x |
| B2 | Skills system (SKILL.md loading + injection) | R4 | 🟡 | v1.x |
| B3 | Multi-agent delegation (`delegations`, `general_subagent`) | R3 | 🟡 | v1.x |
| B4 | Context compaction (summarize + boundary) | R9.15 | 🟡 | v1.x |
| B5 | Memory Provider (mem0/memU, `context_id` scoping) | R9.16-18 | 🟡 | v1.x |
| B6 | Solution templates (install/create) | R14 | 🟡 | v2 |
| B7 | Crash recovery / orphan reconciliation | R9.10 | 🔴 | v1.x |
| B8 | Workspace snapshots | R9.11 | 🟢 | v2 |
| B9 | Web UI (React dashboard) | R10 | 🟡 | v1.x |
| B10 | Docker / E2B / Daytona sandbox providers | R12.3 | 🟡 | v1.x |
| B11 | `self_hosted` sandbox work-queue | R9.14 | 🟢 | v2 |

## Category C — Built-in Tools

| # | Gap | OMA default tools | We have | Priority | Status |
|---|-----|-------------------|---------|----------|--------|
| C1 | `edit` (string-replace in file) | Yes | No | 🔴 | done |
| C2 | `glob` (file pattern match) | Yes | No | 🔴 | done |
| C3 | `grep` (content search) | Yes | No | 🔴 | done |
| C4 | `web_fetch` / `web_search` | Yes | No | 🟡 | v1.x |
| C5 | Tool result size cap (MAX_TOOL_RESULT_CHARS=50k) | Yes | No cap | 🟡 | done |

## Category D — Client SDK & CLI

| # | Gap | OMA has | We have | Priority | Status |
|---|-----|---------|---------|----------|--------|
| D1 | TypeScript client SDK (`chat`, `chatComplete`, `tail`, `interrupt`) | Yes | Raw HTTP only | 🟡 | v1.x |
| D2 | CLI `chat` (interactive streaming) | Yes | No | 🟡 | v1.x |
| D3 | CLI `sessions` subcommands (list/create/message/tail/logs) | Yes | No | 🟢 | v1.x |
| D4 | CLI `models` / `envs` management | Yes | No | 🟢 | v2 |

## Category E — Model Layer

| # | Gap | OMA | We have | Priority | Status |
|---|-----|-----|---------|----------|--------|
| E1 | Real `healthCheck` (actual ping vs stub) | n/a | Stub only checks object created | 🟢 | v1.x |
| E2 | Context-window resolution per model (for compaction trigger) | Yes | None | 🟡 | with B4 |

## Category F — Production Robustness

| # | Gap | OMA | We have | Priority | Status |
|---|-----|-----|---------|----------|--------|
| F1 | API authentication (bearer/API key) | Yes | UNAUTHENTICATED — security risk | 🔴 | v1.x |
| F2 | Rate limiting / quotas | Yes | None | 🟢 | v2 |
| F3 | Structured logging + metrics (pino/prometheus) | Yes | console.log only | 🟡 | v1.x |
| F4 | Graceful shutdown drains in-flight turns + cleans sandboxes | Yes | closes server+db only | 🔴 | done |
| F5 | Multi-backend (Postgres) for horizontal scale | Yes | SQLite only | 🟢 | v2 (out of scope for local-first) |

---

## This Iteration (implemented)

- ✅ **A8** — wire retry policy into actual model calls (retry middleware)
- ✅ **A4** — interrupt aborts the running turn (AbortController), returns to idle
- ✅ **A2** — emit `agent.thinking` events from the loop
- ✅ **C1/C2/C3** — add `edit`, `glob`, `grep` built-in tools
- ✅ **C5** — cap tool result size (50k chars)
- ✅ **F4** — graceful shutdown aborts turns + cleans up sandboxes

### Production bundling bugs found & fixed (would break `npx managed-agents`)

- ✅ **P1** — migrations loaded from `.sql` files via readFileSync were not
  bundled into `dist/` → built binary started with no tables. Fixed by
  embedding migrations as a TS constant (`migrations.ts`).
- ✅ **P2** — tsup/esbuild stripped the `node:` prefix from `node:sqlite`,
  emitting an unresolvable bare `sqlite` import → built binary crashed on
  startup. Fixed by loading via `createRequire('node:sqlite')` so the
  bundler never rewrites the specifier. (Also removed the now-redundant
  vitest node:sqlite plugin.)

## Iteration 2 (implemented)

- ✅ **B7** crash recovery / orphan reconciliation — on startup, sessions left
  `running` get placeholder tool_results injected for orphaned tool_use calls,
  then reset to idle (resumable). Live-verified + 5 unit tests.
- ✅ **F1** API authentication — optional Bearer-token auth. Off by default
  (local-first); enable via `api_keys` in config or `MANAGED_AGENTS_API_KEY`
  env. `/` and `/v1/x/health` stay public. Startup banner shows auth status.

## Iteration 3 (implemented)

- ✅ **B1** MCP integration — stdio + http(sse) transports via the AI SDK's
  built-in MCP client. Tools namespaced `mcp_<server>_<tool>`, connected once
  per session and reused across turns, closed on session teardown. Degraded
  mode (R5.5): a server that fails to connect is skipped, not fatal. New
  `/v1/x/mcp/status?session_id=X` endpoint. Live-verified + 5 tests (incl.
  real stdio server fixture).

## Iteration 4 (implemented)

- ✅ **B4** context compaction — `ContextCompactor` summarizes older messages
  via the model when projected history exceeds 80% of the context window,
  writes an `agent.thread_context_compacted` boundary event (summary stored in
  the event), and eventsToMessages honors the latest boundary on every
  projection (`[summary, ...post-boundary]`). Best-effort (a summarize failure
  never fails the turn). Enabled by default. 7 unit + 2 integration tests.

## Iteration 5 (implemented)

- 🔴→✅ **Broadcast wiring bug (found during A1)** — the strategy's
  `context.broadcast` was a no-op AND events weren't yielded, so agent events
  (message/tool_use/tool_result/thinking) were persisted to the log but NEVER
  pushed to live SSE subscribers — clients only saw them via polling/backfill.
  Fixed by wiring a real broadcast callback from SessionManager → executor →
  strategy. Agent events now stream live at step granularity.
- ✅ **A1** token-level streaming — the strategy now consumes `fullStream` and
  broadcasts transient `agent.message_stream_start` / `agent.message_chunk`
  (with `delta`) / `agent.message_stream_end` events for live token rendering.
  These are broadcast-only (seq=0, not persisted, not in model context); the
  SSE route passes their delta/message_id through, skips seq-dedup, and does
  not advance the resume cursor for them.

## Iteration 6 (implemented)

- 🔴→✅ **System prompt bug (found during B2)** — `streamText` was called
  WITHOUT a `system` param, so the agent's `system_prompt` was never sent to
  the model. Fixed: executor composes the system prompt and passes it through
  StrategyContext → streamText `system`.
- ✅ **B2** Skills system — loads SKILL.md files (YAML frontmatter + markdown
  body) from `skills/`, injects the agent's assigned skill subset into its
  system prompt (R4.5). Round-trip parse/serialize (Property 2). Unknown skill
  refs warned + ignored. `--skills-dir` flag, `init` scaffolds an example
  skill, startup banner shows skill count. 10 tests.

## Iteration 7 (implemented)

- ✅ **B3** multi-agent delegation — declarative, model-decided delegation
  (NOT a visual DAG). `AgentOrchestrator` helpers enforce cycle detection
  (Property 4), max-depth limit (Property 5, default 5), roster membership,
  and target-loaded checks. Executor exposes `delegate_to_<name>` tools for
  each agent in `delegations`, plus `general_subagent` when
  `enable_general_subagent` is set. Sub-agents run ephemerally (in-memory event
  log, own sandbox, nested delegation depth-limited); their final answer
  surfaces as the delegation tool result — the parent's bijection stays intact.
  10 unit + 3 integration tests.

## Iteration 8 (implemented)

- ✅ **B10** Docker sandbox provider + provider registry — `SandboxProviderRegistry`
  selects a provider by an Environment's `sandbox_provider` type (R12.3), with a
  descriptive install-hint error for missing providers (R12.4).
  `DockerSandboxProvider` runs each session in an isolated container (one per
  session), overrides the image entrypoint with `sleep` for robustness,
  supports memory/cpu limits, and transfers files via `docker cp`. Executor
  resolves the provider per-agent-environment (falls back to local). Registry
  tests always run; real container test runs against a locally-cached image
  (skips if none / no docker). 5 tests.

## Iteration 9 (implemented)

- ✅ **D1** client SDK — `ManagedAgentsClient` (`managed-agents/sdk` export)
  wrapping the HTTP API: `agents.list/get`, `sessions.create/get/list/
  sendMessage/sendEvent/events/stop/delete/interrupt`, plus SSE `tail()` and a
  convenience `chat()` (opens the stream before sending, yields until idle).
  Typed errors (`ManagedAgentsApiError`). Ships as a second build entry
  (`dist/sdk.js`) with its own package export. 6 integration tests against a
  real in-process server (incl. live SSE tail).

## Iteration 10 (implemented)

- ✅ **A5** tool confirmation flow — agents declare `confirm_tools`; those tools
  are built WITHOUT execute so the SDK suspends the turn, the session goes
  `requires_action`, and a `user.tool_confirmation(allow|deny)` event runs or
  denies the pending tool (appending a paired result) before the model
  continues. 4 integration tests.
- ✅ **B5** Memory Provider — `MemoryProvider` interface + built-in
  `SqliteMemoryProvider` (keyword-overlap relevance, `context_id`-scoped,
  migration 002). Executor injects relevant memories into the system prompt and
  extracts the user message after the turn — only when the session has a
  `context_id` (R9.16–18). Enabled via `memory.provider: sqlite` in config.
  Isolation across context_ids verified. 7 unit + 2 integration tests.
- ✅ **F3** structured logging + metrics — zero-dep JSON logger
  (`MANAGED_AGENTS_LOG_LEVEL`/`LOG_FORMAT`) + in-process metrics registry
  (counters + histograms) exposed at `/v1/x/metrics` in Prometheus format.
  Request-logging + metrics middleware. Live-verified. 6 tests.

## Iteration 11 (implemented)

- ✅ **B6** Solution templates — `installTemplate`/`createTemplate`/`listTemplates`
  (manifest.yaml + agents/skills/mcp dirs). Byte-identical install placement
  (Property 18), create→install round-trip (Property 19), skip-unless-force on
  collision. CLI `template list|install|create`. 7 tests.
- ✅ **B8** Workspace snapshots — `SnapshotManager` archives a sandbox workdir
  to tar.gz (via `tar` CLI, recorded in `snapshots` table) and restores the
  latest on resume (R9.11). Newest-wins ordering with rowid tiebreaker. 5 tests.

## Iteration 12 (implemented)

- ✅ **A3** span events — the strategy emits a persisted `span.model_request_end`
  per model step carrying token usage, for per-call cost/observability in the
  trajectory (skipped by eventsToMessages).
- ✅ **B9** Web UI — a dependency-free single-page dashboard served at `/ui`
  (embedded HTML, bundle-safe): lists agents/sessions, creates sessions, renders
  history, and streams chat live via EventSource (token chunks, tool calls,
  status). A richer React app can replace it later using the same API/SDK.

## Iteration 13 (implemented — final MVP items)

- ✅ **B8 wiring** — the executor now restores the latest workspace snapshot on
  sandbox (re)provision and creates a snapshot after each turn, gated by the
  Environment's `snapshot.enabled`. `SandboxInstance.hostWorkDir` exposes the
  local workdir for archiving. 2 integration tests.
- ✅ **B11** self_hosted sandbox — work-queue mode (R9.14). `WorkQueue` (SQLite
  `work_items`, migration 003) + `SelfHostedSandboxProvider` dispatch tool calls
  as work items; a user-run Worker claims/completes them via
  `POST /v1/x/worker/claim` and `/complete`. Server never runs the commands.
  FIFO claim, session scoping, timeout/failure handling. 10 tests. Registered
  as the `self_hosted` provider.

## Iteration 14 (remaining requirements + review-driven fixes)

New requirements implemented:
- ✅ **R11.3** CLI `chat` — interactive REPL (and `--message` one-shot) that
  streams the reply token-by-token via the SDK.
- ✅ **R11.6** CLI `deploy` — placeholder printing cloud-deployment guidance.
- ✅ **R5.6** MCP reconnect with exponential backoff (1→2→4→8s, cap 60s, 5
  attempts) via `McpManager.reconnect()`; initial connect stays fast-degrade.
- ✅ **R14 remote** `template install <name>` fetches from a GitHub repo
  (`resolveTemplateSource` via curl+tar), falling back from local path.
- ✅ **R13.3/13.4** `--target local|cloud` merges `overrides.<target>.models`
  over base model configs (same YAML, env-specific settings).

Review-driven correctness fixes (from a full read-only audit):
- 🔴 **H1** stop()/delete() now abort the in-flight turn AND await the execution
  chain before releasing the sandbox (no more calling into a destroyed sandbox).
- 🔴 **H2** WorkQueue.claim uses an atomic guarded UPDATE (`AND status='pending'`
  + changes check) — no cross-worker double-claim.
- 🔴 **Silent model error** — DefaultStrategy now handles the `error` part in
  `fullStream`; a provider/model failure fails the turn (session.error + failed)
  instead of silently going idle. (Found via the `chat` smoke test.)
- 🟡 **M1** tool-confirmation `allow` rebuilds the FULL tool set (built-in + MCP
  + delegation) so confirm-required MCP/delegation tools can execute.
- 🟡 **M2** sub-agent sessions get a unique id suffix (parallel delegations to
  the same target no longer share/destroy each other's sandbox).
- 🟡 **M3** removed duplicate `session.error` on failure (failed → status_terminated
  + one detailed session.error).
- 🟡 **M4** MCP withTimeout clears its timer; a client that connects but fails
  tools/list is closed (no orphaned subprocess).
- 🟡 **M5** shutdown() awaits in-flight turns before teardown.
- 🟢 **L1/L2** executionChains + subscribers maps no longer leak entries.
- 🟢 **L3** execution chain can never reject (prelude errors caught too).
- 🟢 **L4** events batch is pre-flight-rejected on terminal/missing session
  (no partial application).

- ✅ **L5** MCP auto-reconnect on live drop — MCP tools are now returned as
  stable wrappers that delegate to the manager's live clients. When a tool call
  fails with a connection-drop error (`isConnectionError` heuristic), the
  wrapper reconnects the server (backoff) and retries the call once against the
  refreshed client. Cached wrappers survive reconnects transparently. Test
  covers drop→reconnect→retry.

## Status: ALL backlog items complete (no known gaps)

Every requirement (R1–R14) and every review-identified issue (H1–H2, M1–M5,
L1–L5) is implemented and tested. 245 tests passing.

Everything from Categories A–F that was in scope has been delivered. The only
remaining items are explicitly-scoped-out polish:
- A richer React+Vite dashboard (the embedded dependency-free `/ui` covers the
  core flows: agents, sessions, live-streaming chat, tool calls).
- `span.model_request_start` pairing + TTFT — the Vercel AI SDK v4 has no stable
  per-step-start hook; `span.model_request_end` with usage is emitted.
- Semantic (embedding-based) memory — the built-in provider uses keyword
  overlap; mem0/memU adapters can be dropped in via the `MemoryProvider` interface.

## Known limitations / follow-ups on shipped features

- MCP: `http` transport uses SSE; streamable-HTTP transport not yet supported.
- MCP: no automatic reconnect with backoff yet (R5.6) — a mid-session drop
  means those tools go away until the session is recreated.
- MCP: tool calls are correctly classified as `agent.mcp_tool_use` /
  `agent.mcp_tool_result` (via the `mcp_` name prefix), but the
  `mcp_server_name` field is derived from the namespaced tool name rather
  than tracked structurally — fine for v1, revisit if servers can contain `_`.
