# Implementation Status

This document tracks public implementation status for `managed-agents`.

## Completed

- [x] Single-package TypeScript project structure.
- [x] Agent YAML and JSON loading.
- [x] Agent schema validation.
- [x] Environment variable resolution.
- [x] SQLite database layer and idempotent migrations.
- [x] Session state machine.
- [x] Append-only event logger.
- [x] Session manager with create, get, list, stop, delete, interrupt, and
      event dispatch.
- [x] Session message endpoint: `POST /v1/sessions/:id/messages`.
- [x] SSE event stream with persisted replay and live broadcast.
- [x] Event-to-message projection.
- [x] Context compaction boundary support.
- [x] Crash recovery for sessions left running after restart.
- [x] Default session execution strategy.
- [x] Model registry with retry-aware execution path.
- [x] Local sandbox provider with path isolation.
- [x] Docker sandbox provider.
- [x] Self-hosted sandbox work queue.
- [x] Built-in tools: `bash`, `read`, `write`, `edit`, `glob`,
      and `grep`.
- [x] Tool result size cap.
- [x] Skills loader and system prompt injection.
- [x] MCP server integration for `stdio` and `url` transports.
- [x] Multi-agent delegation tools.
- [x] Optional bearer-token API authentication.
- [x] Structured logging and runtime metrics.
- [x] TypeScript SDK for agents, sessions, events, messages, and SSE tailing.
- [x] CLI commands for init, start, list, reload, chat, and templates.
- [x] React/Vite Dashboard at `/dashboard`.
- [x] Standard agent fields: `system`, `agent_toolset_20260401`, and
      `permission_policy`.
- [x] Standard event pagination with `after_id`.
- [x] Environment, credential vault, and memory store resource APIs.
- [x] Active workspace introspection for the Console.
- [x] Claude Managed Agents gap spec and prioritized Console/runtime parity plan.
- [x] Canonical runtime settings API for one active model provider, loop engine,
      metadata storage, artifact storage, memory backend, and sandbox backend.
- [x] Settings validation endpoint with sanitized secret references.
- [x] Settings Console pages for truthful single active configurations instead
      of fake provider-list controls.
- [x] Console runtime settings pages split out of the root `App.tsx` module.
- [x] Console Logs and Monitoring settings pages split out of the root
      `App.tsx` module.
- [x] CLI command registration split out of the runtime entrypoint.
- [x] Webhook, scheduled deployment, outcome definition, and session outcome
      control-plane APIs.
- [x] Console list pages for webhooks, scheduled deployments, and outcomes.
- [x] Webhook delivery history and signed local test delivery endpoint.
- [x] Scheduled deployment run history and manual trigger endpoint.
- [x] Deterministic local outcome evaluator for session transcripts.
- [x] Console operation actions for webhook test delivery, scheduled manual
      run, and session outcome evaluation.
- [x] README and installation docs aligned with Settings V2 provider-boundary
      semantics.
- [x] Agent version snapshots and optional stale-version conflict checks in the
      API and Console edit flow.
- [x] Session creation pins supplied agent versions to immutable agent
      snapshots.
- [x] Console agent version history, basic diff, and copy-to-new-version
      rollback flow.
- [x] Console Session detail actions for interrupt, continue message,
      tool-confirmation approve/deny, and custom tool result submission.
- [x] Self-hosted environment worker key lifecycle: generate once, list without
      secrets, revoke, hash at rest, and update last-seen on scoped claims.
- [x] Console self-hosted environment queue visibility and worker key actions.
- [x] CLI self-hosted worker polling command with scoped key support.
- [x] File upload, list, metadata preview, download, archive, and session mount
      API/Console flow.
- [x] Session artifact output conventions, artifact storage, previews,
      download API, and Console session artifact cards.
- [x] Outcome pass thresholds and deterministic threshold-aware evaluation.
- [x] Webhook dispatcher, signed delivery attempts, retry scheduling, delivery
      attempt metadata, and Console retry-due action.
- [x] Scheduled deployment due-runner, UTC cron next-run calculation,
      next_run_at advancement, and Console run-due action.
- [x] Runtime metrics summary endpoint and Monitoring page cards for sessions,
      events, artifact bytes, HTTP counters, and worker queue state.
- [x] Credential vault API/Console flow for secret redaction, encrypted storage,
      scoped injection metadata, archive/delete, and session attach validation.
- [x] Credential rotation, last-used updates, audit events, Console rotate
      action, and internal runtime injection resolver.
- [x] Memory records expose content size and SHA-256 hash metadata in API and
      Console detail views.
- [x] CLI session helper commands for create, message, tail, inspect, and logs.
- [x] CLI self-hosted worker command for scoped queue polling and local
      work-item execution.
- [x] CLI model provider and environment management commands for listing,
      adding/defaulting model providers, inspecting/updating/archiving
      environments, and JSON-backed environment configuration.
- [x] SDK helper resources for agent create/update/archive/versions, files,
      session artifacts, API keys, metrics summary, model providers, and
      environments.
- [x] Template validation for manifests, agent schema files, required
      `SKILL.md`, and non-empty template content.
- [x] Expanded standard API conformance tests for collection page envelopes
      and invalid-write error envelopes across core, operations, and extended APIs.
- [x] Console static coverage for Skills empty/drawer state, Operations empty
      states, Settings second-level navigation, and honest Storage settings.
- [x] Runtime bootstrap extraction for path resolution, SQLite initialization,
      default environment seeding, config loading, target model overrides, and
      configured environment import.
- [x] Runtime lifecycle extraction for graceful shutdown/restart, server close,
      session drain, DB close, and restart spawn error handling.
- [x] Runtime server assembly extraction for API dependency wiring, runtime
      summary, workspace metadata, model registry callbacks, and reload hooks.
- [x] Model-assisted outcome evaluator path with ModelRegistry-backed
      `generateText`, deterministic fallback, unsupported-state reporting, and
      injectable API tests.
- [x] Console module split for Settings/API reference, Credential Vaults,
      Memory Stores list/detail, Agents list/detail, and Environments
      list/detail/editor, Sessions list/detail, Agent modals, and Session
      resource modals.
- [x] Example project under `examples/basic`.
- [x] CI workflow for typecheck, tests, build, smoke, and package checks.
- [x] Public documentation in English.
- [x] No-port API-to-Console E2E coverage creates representative runtime
      resources through the HTTP app and server-renders the matching Console
      pages.
- [x] V1 local-first architecture review and reduction spec for keeping the
      first open-source release focused on SQLite metadata, local
      files/skills/artifacts, one active model provider boundary, one loop
      engine, one memory backend, and one default sandbox.
- [x] Console data loading no longer depends on historical memory/storage
      provider-list endpoints for first-run rendering.
- [x] SDK canonical runtime settings helpers: get, patch, and validate.
- [x] CLI canonical runtime settings commands for get, set-model, and
      validate.
- [x] Historical `managed-agents models ...` CLI command removed from the v1
      public command surface.
- [x] Historical `client.modelProviders` SDK helper removed from the v1 public
      SDK surface.
- [x] Public API matrix removes provider CRUD endpoints and points users to
      canonical `/v1/x/settings`.
- [x] Historical provider CRUD endpoints removed from `/v1/x`; v1 API surface
      now uses canonical runtime settings plus read-only runtime summary.
- [x] First-run examples and API reference environment snippets use
      `hosting_type: local` and `sandbox_provider: local`.
- [x] Sandbox provider and deployment docs moved under Advanced / Optional in
      the public docs index.
- [x] Future sandbox provider package documentation/example removed from the
      public docs index and workspace; v1 keeps local sandbox as the default.
- [x] Webhooks, scheduled deployments, outcomes, worker queues, and worker keys
      are marked Advanced so the first-run path stays focused on local agents,
      sessions, files, skills, and settings.
- [x] README SDK section now leads with `managed-agents/sdk`; Anthropic beta
      compatibility is documented only as an advanced compatibility note.
- [x] Removed placeholder `managed-agents deploy` command; v1 does not expose
      fake deployment actions.
- [x] Quick-create Environment modal only exposes Local for the v1 quick-start
      path; advanced workers remain in Environments after explicit setup.

## In Progress

- [x] Continue splitting large Console page modules so `App.tsx` is focused on
      navigation, data loading, and route dispatch.
- [ ] Complete browser-based dashboard route smoke tests in an environment that
      permits binding a local HTTP port. Current sandbox rejects even a minimal
      Node HTTP server with `listen EPERM` on both `127.0.0.1` and `0.0.0.0`;
      no-port API-to-Console E2E coverage is in place.
- [x] Remove or quarantine historical provider CRUD APIs and adapter-required
      tests after Console and docs are fully on `/v1/x/settings`.
- [x] Replace integration tests that create adapter-required Postgres/S3/mem0
      provider records with settings validation tests for unsupported
      backends.

## Planned

- [x] Tool confirmation flow.
- [x] Client-side custom tool result protocol with Console controls and SDK
      helpers for tool confirmation and custom tool result submission.
- [x] Session subcommands for create, message, tail, logs, and inspect.
- [x] Settings and environment management commands.
- [x] Optional workspace snapshots.
- [x] Workspace registry for desktop create, open, list, resolve, and remove
      workflows; runtime switching remains a process-manager concern.
- [x] Optional long-term memory provider.
- [x] Additional sandbox provider package contract and template; only
      implemented providers are shown as runtime-available.
- [x] Production deployment examples.
- [x] Versioned standard API matrix.

## Release Checklist

Before a release:

- [ ] `npm ci` (dry-run passed; full install is blocked in the current sandbox
      by registry DNS failures and npm's `Exit handler never called` error.
      Dependencies were restored with `npm install --ignore-scripts
      --prefer-offline` and validation passed afterward.)
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm pack --dry-run`
- [x] Smoke test `managed-agents init`
- [x] Smoke test `examples/basic`
- [x] Verify public documentation against current behavior
