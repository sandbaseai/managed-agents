# Documentation

This directory contains public, project-owned documentation for
`managed-agents`. It is written for users, contributors, and operators of the
open-source runtime.

## Start Here

| Document | Audience | Contents |
| --- | --- | --- |
| [Installation](installation.md) | Users and operators | Install options, model configuration, startup flags, and health checks. |
| [Usage Guide](usage.md) | Users and integrators | Workspace layout, Console workflows, sessions, resources, credentials, memory, and SDK usage. |
| [API Reference](api.md) | API and SDK integrators | HTTP endpoints, request shapes, response shapes, errors, and examples. |
| [Skills](skills.md) | Agent builders | Skill package format, upload flow, validation rules, and agent references. |
| [Requirements](spec/requirements.md) | Users and maintainers | Product scope, runtime guarantees, and release-facing requirements. |
| [Technical Design](spec/design.md) | Contributors | Core concepts, data model, extension contracts, and API groups. |
| [Architecture](spec/architecture.md) | Contributors and operators | System diagrams, data boundaries, session flow, and deployment modes. |
| [Implementation Status](spec/tasks.md) | Contributors | Completed work, active work, planned items, and release checks. |

## Release Gate

For a source checkout, the maintainer release gate is:

```bash
npm run release:check
```

It runs typecheck, tests, production builds, package dry-run, and CLI smoke
checks for `managed-agents init` plus `examples/basic` startup.

## Documentation Rules

- Public docs describe this project only.
- Public docs avoid internal planning notes and external comparison material.
- Requirements describe observable behavior.
- Design docs describe stable architecture and extension points.
- Implementation status tracks current state without replacing issue tracking.
