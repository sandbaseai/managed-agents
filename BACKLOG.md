# Roadmap

This public roadmap tracks product work for `managed-agents`. It describes
project-owned features only.

## Near Term

- Improve API compatibility coverage and documented response shapes.
- Add end-to-end dashboard tests for session creation, messaging, event replay,
  and error states.
- Add SDK helpers for common chat and inspection workflows.
- Add CLI session commands for create, list, message, tail, logs, and inspect.
- Improve template validation and authoring commands.
- Add richer runtime metrics for model usage, tool duration, and session state.

## Runtime

- Add tool confirmation flow for sensitive actions.
- Add client-side custom tool support.
- Add optional workspace snapshots for file-system recovery.
- Add optional long-term memory provider support.
- Expand context-window metadata and compaction controls.
- Improve graceful shutdown reporting for in-flight turns.

## Sandboxes

- Harden local sandbox defaults.
- Expand Docker examples and resource-limit coverage.
- Improve self-hosted worker ergonomics.
- Add provider packages for additional isolated execution backends.

## Dashboard

- Add clearer error and reconnect states.
- Add session delete and stop actions.
- Add event filtering in the trajectory view.
- Add model, skill, and MCP status panels.
- Add read-only configuration inspection.

## CLI and SDK

- Add session lifecycle subcommands.
- Add model and environment inspection commands.
- Add richer SDK examples.
- Add typed helpers for event filtering and replay cursors.

## Documentation

- Keep public documentation in English.
- Keep public documentation focused on this project.
- Keep public documentation focused on release-facing project behavior.
- Add deployment guides after the runtime behavior is stable.
- Add a versioned compatibility matrix before the first stable release.
