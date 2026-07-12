# managed-agents

Local-first runtime for stateful managed agents. Run agents on your own machine with YAML definitions, MCP tools, skills, templates, SSE session events, and a minimal built-in dashboard.

> A small, hackable runtime for stateful agents: local execution, portable config, and open-source code.

## Status

This project is pre-1.0. The core runtime is usable, but the public API surface is still being stabilized.

| Area | Status | Notes |
| --- | --- | --- |
| Agent YAML loading | Stable | Agents live in `agents/*.yaml`. |
| Session/event runtime | Stable | Sessions persist history and stream events over SSE. |
| Local sandbox | Stable | Local subprocess backend with workspace path isolation. |
| Models | Stable | Provider registry for local and hosted model APIs. |
| MCP, skills, templates | Experimental | Implemented, still expanding compatibility coverage. |
| Docker/self-hosted sandboxes | Experimental | Available for integration testing and advanced setups. |
| Managed-agent API compatibility | In progress | Core event/session endpoints and `POST /v1/sessions/:id/messages` exist; compatibility coverage is still expanding. |
| Dashboard | Minimal | Built-in dependency-free HTML dashboard, not a full React console. |

## Quick Start

Use the published CLI package name:

```bash
npx managed-agents init
npx managed-agents start
```

Then open:

```text
http://localhost:3000/ui
```

For a local example:

```bash
cd examples/basic
npx managed-agents start --config managed-agents.config.yaml --agents-dir agents --skills-dir skills
```

## Contributor Setup

From a fresh clone:

```bash
git clone git@github.com:sandbaseai/managed-agents.git
cd managed-agents
npm ci
npm run typecheck
npm test
npm run build
```

Node.js 22 or newer is required.

During development:

```bash
npm run dev
```

## CLI

```bash
managed-agents init
managed-agents start --port 3000
managed-agents list
managed-agents reload
managed-agents chat <agent-name> --message "hello"
managed-agents template list
managed-agents template install <template-name-or-path>
```

## API Shape

The runtime exposes session and event endpoints for managed-agent clients. The stable path today is:

1. Create or select a session.
2. Send user events to the session.
3. Subscribe to the session event stream.

The project is intentionally conservative about compatibility claims. It supports common session and event patterns, but it should not yet be treated as a complete implementation of every managed-agent endpoint.

## Project Layout

```text
managed-agents/
├── src/
│   ├── api/        # Hono HTTP routes
│   ├── core/       # agents, sessions, events, memory, templates
│   ├── model/      # model provider registry
│   ├── sandbox/    # local, docker, self-hosted sandbox providers
│   ├── strategy/   # execution strategies
│   └── types/      # protocol and runtime types
├── tests/
├── examples/
└── docs/spec/
```

## Documentation

- [Requirements](docs/spec/requirements.md)
- [Technical Design](docs/spec/design.md)
- [Architecture Diagrams](docs/spec/architecture.md)
- [Implementation Tasks](docs/spec/tasks.md)

## Release Checklist

Before publishing a release:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Also smoke test `examples/basic` and verify README claims against the current implementation.

## License

[Apache-2.0](LICENSE)
