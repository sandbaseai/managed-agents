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
- [x] Built-in tools: `bash`, `read_file`, `write_file`, `edit`, `glob`,
      and `grep`.
- [x] Tool result size cap.
- [x] Skills loader and system prompt injection.
- [x] MCP server integration for stdio and HTTP transports.
- [x] Multi-agent delegation tools.
- [x] Optional bearer-token API authentication.
- [x] Structured logging and runtime metrics.
- [x] TypeScript SDK for agents, sessions, events, messages, and SSE tailing.
- [x] CLI commands for init, start, list, reload, chat, and templates.
- [x] Dependency-free built-in dashboard at `/ui`.
- [x] Example project under `examples/basic`.
- [x] CI workflow for typecheck, tests, build, smoke, and package checks.
- [x] Public documentation in English.

## In Progress

- [ ] Expand API compatibility tests.
- [ ] Improve dashboard coverage for edge states and errors.
- [ ] Add more SDK convenience helpers.
- [ ] Improve template authoring and validation.
- [ ] Expand runtime metrics.

## Planned

- [ ] Tool confirmation flow.
- [ ] Client-side custom tools.
- [ ] Session subcommands for create, message, tail, logs, and inspect.
- [ ] Model and environment management commands.
- [ ] Optional workspace snapshots.
- [ ] Optional long-term memory provider.
- [ ] Additional sandbox provider packages.
- [ ] Production deployment examples.
- [ ] Versioned compatibility matrix.

## Release Checklist

Before a release:

- [ ] `npm ci`
- [ ] `npm run typecheck`
- [ ] `npm test`
- [ ] `npm run build`
- [ ] `npm pack --dry-run`
- [ ] Smoke test `managed-agents init`
- [ ] Smoke test `examples/basic`
- [ ] Verify public documentation against current behavior
