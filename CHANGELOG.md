# Changelog

## 0.1.0 - 2026-07-18

First public release of `managed-agents`.

### Highlights

- Local-first managed agent runtime with a Claude Managed Agents-style `/v1`
  API surface.
- React Dashboard for agents, sessions, environments, credential vaults,
  memory stores, files, skills, settings, logs, monitoring, and API reference.
- SQLite-backed runtime state stored outside source-controlled workspaces by
  default.
- Settings V2 for one workspace model vendor, loop engine, storage backends,
  context-memory backend, sandbox provider, API keys, validation, and restart
  flows.
- Session lifecycle, event replay, resumable SSE streams, memory resources,
  file resources, credential vaults, snapshots, local/Docker/self-hosted
  sandbox registration, MCP tools, and skill packages.
- TypeScript SDK and CLI commands for init, start, list, reload, chat, deploy
  guidance, and templates.
- Release gate covering typecheck, tests, production build, package dry-run,
  CLI init smoke, and example workspace startup smoke.

### Known first-release boundaries

- One active model vendor, one built-in loop engine, SQLite metadata storage,
  local artifact storage, SQLite memory, and runtime-registered sandbox
  providers are supported in 0.1.0.
- Planned adapters such as S3, Postgres/MySQL, mem0, MemU, Harness, Codex, and
  Claude loop engines remain unavailable until their runtime implementations
  are added.
- Live remote model credential checks and production deployment examples are
  tracked as follow-up work.
