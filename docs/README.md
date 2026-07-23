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
| [Versioned API Matrix](api-matrix.md) | SDK authors and integrators | `/v1` endpoint status, SDK coverage, CLI coverage, and compatibility gaps. |
| [Skills](skills.md) | Agent builders | Skill package format, upload flow, validation rules, and agent references. |
| [Requirements](spec/requirements.md) | Users and maintainers | Product scope, runtime guarantees, and release-facing requirements. |
| [Technical Design](spec/design.md) | Contributors | Core concepts, data model, extension contracts, and API groups. |
| [Architecture](spec/architecture.md) | Contributors and operators | System diagrams, data boundaries, session flow, and deployment modes. |
| [Implementation Status](spec/tasks.md) | Contributors | Completed work, active work, planned items, and release checks. |

## Advanced / Optional

These documents are not part of the v1 quick-start path. Read them after the
local SQLite + local filesystem runtime is working.

| Document | Audience | Contents |
| --- | --- | --- |
| [Deployment Examples](deployment.md) | Operators | systemd, Docker Compose, Kubernetes, self-hosted workers, and production checks. |

## Documentation Rules

- Public docs describe this project only.
- Public docs avoid internal planning notes and external comparison material.
- Requirements describe observable behavior.
- Design docs describe stable architecture and extension points.
- Implementation status tracks current state without replacing issue tracking.
