# managed-agents

Local-first runtime for stateful managed agents. Run standard agent definitions on your own machine with MCP tools, skills, templates, SSE session events, and a built-in Console.

> A small, hackable runtime for stateful agents: local execution, portable config, and open-source code.

## Status

This project is pre-1.0. The core runtime is usable, but the public API surface is still being stabilized.

| Area | Status | Notes |
| --- | --- | --- |
| Agent YAML loading | Stable | Agents live in `agents/*.yaml`. |
| Session/event runtime | Stable | Sessions persist history and stream events over SSE. |
| Local sandbox | Stable | Local subprocess backend with workspace path isolation. |
| Models | Stable | Provider registry for local and hosted model APIs. |
| MCP, skills, templates | Experimental | Implemented and evolving around the standard agent definition shape. |
| Docker/self-hosted sandboxes | Experimental | Available for integration testing and advanced setups. |
| Managed-agent API | In progress | Agents use `system`, standard toolsets, `permission_policy`, event id cursors, resources, and vault ids. |
| Console | In progress | React/Vite Console served from `/ui` by the same Node process. |

## Quick Start

Use the published CLI package name:

```bash
npx managed-agents init
npx managed-agents start
```

Then open:

```text
http://127.0.0.1:3000/ui
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
npm run dev:console
```

## CLI

```bash
managed-agents init
managed-agents start --host 127.0.0.1 --port 3000
managed-agents list
managed-agents reload
managed-agents chat <agent-id> --message "hello"
managed-agents template list
managed-agents template install <template-name-or-path>
```

## API Shape

The runtime exposes standard resource endpoints for managed-agent clients. The stable path today is:

1. Create or select an agent by standard `agent_...` id.
2. Create a session with `agent`, `environment_id`, optional `resources`, and optional `vault_ids`.
3. Send user events through `events: [...]` or use `POST /v1/sessions/:id/messages`.
4. Subscribe to the session event stream and resume by event id.

The project does not expose legacy field aliases. Agent definitions use `system`, toolsets use `permission_policy`, and event pagination uses `after_id`.

## Project Layout

```text
managed-agents/
├── src/
│   ├── api/        # Hono HTTP routes
│   ├── sdk/        # TypeScript client
│   ├── core/       # agents, sessions, events, memory, templates
│   ├── model/      # model provider registry
│   ├── sandbox/    # local, docker, self-hosted sandbox providers
│   ├── strategy/   # execution strategies
│   └── types/      # protocol and runtime types
├── tests/
├── apps/console/   # React Console served from dist/console
├── examples/
└── docs/spec/
```

## Documentation

Start with the [documentation index](docs/README.md).

| Document | Purpose |
| --- | --- |
| [Requirements](docs/spec/requirements.md) | Product requirements and runtime guarantees. |
| [Technical Design](docs/spec/design.md) | Core concepts, extension contracts, and API shape. |
| [Architecture](docs/spec/architecture.md) | System diagrams, runtime flow, and deployment modes. |
| [Implementation Status](docs/spec/tasks.md) | Completed work, in-progress items, and release checklist. |

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
