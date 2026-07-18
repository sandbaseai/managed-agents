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
- [x] Example project under `examples/basic`.
- [x] CI workflow for typecheck, tests, build, smoke, and package checks.
- [x] Public documentation in English.

## In Progress

- [ ] Expand standard API conformance tests.
- [ ] Improve Console coverage for edge states and errors.
- [ ] Add more SDK convenience helpers.
- [ ] Improve template authoring and validation.
- [ ] Expand runtime metrics.

## Planned

- [x] Tool confirmation flow.
- [ ] Client-side custom tools.
- [ ] Session subcommands for create, message, tail, logs, and inspect.
- [ ] Model and environment management commands.
- [x] Optional workspace snapshots.
- [ ] Workspace registry for desktop create, open, and switch workflows.
- [x] Optional long-term memory provider.
- [ ] Additional sandbox provider packages.
- [ ] Production deployment examples.
- [ ] Versioned standard API matrix.

## Release Checklist

Before a release:

- [ ] `npm ci`
- [x] `npm run typecheck`
- [x] `npm test`
- [x] `npm run build`
- [x] `npm pack --dry-run`
- [x] Smoke test `managed-agents init`
- [x] Smoke test `examples/basic`
- [x] Verify public documentation against current behavior

Maintainers can run the local release gate with:

```bash
npm run release:check
```

The gate runs typecheck, tests, build, package dry-run, and release smoke
checks. The source checkout was verified with this gate on 2026-07-18 after the
Settings V2, Console, and runtime decomposition work. `npm ci` remains the
fresh-clone CI install step and is intentionally listed separately because it
mutates `node_modules`.

Known non-blocking release follow-ups:

- Split the Dashboard production bundle if the Vite chunk-size warning becomes
  a release-size target.
- Keep expanding standard API conformance tests and Console edge-state tests.
- Enable deferred adapters only after the backing runtime implementations
  exist.
