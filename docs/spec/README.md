# Project Documentation

This directory contains the public specification set for `managed-agents`.
These documents are release-facing and describe the runtime as an open-source
project.

## Files

- `v1-local-first-architecture.md` - architecture review and reduction plan for
  the first open-source release: SQLite metadata, local files/skills/artifacts,
  one model provider boundary, one loop engine, one memory backend, and one
  default sandbox.
- `requirements.md` - product requirements, runtime guarantees, and open-source
  readiness rules.
- `design.md` - technical design, core concepts, data model, and extension
  contracts.
- `architecture.md` - diagrams for system boundaries, session flow, workspace
  scope, and deployment modes.
- `claude-managed-agents-gap.md` - Claude Managed Agents parity gap analysis,
  Settings V2 direction, and prioritized implementation plan.
- `tasks.md` - implementation status, planned work, and release checks.

## Reading Order

1. Read `v1-local-first-architecture.md` before changing first-run behavior,
   Settings, storage, memory, sandbox, model provider, CLI, SDK, or docs.
2. Read `requirements.md` to understand scope and guarantees.
3. Read `design.md` to understand the runtime model.
4. Read `architecture.md` when changing cross-module behavior.
5. Read `claude-managed-agents-gap.md` before changing Console or runtime
   parity behavior.
6. Read `tasks.md` before planning implementation work.
