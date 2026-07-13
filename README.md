# managed-agents

Open-source managed-agent runtime with a local Console, Claude Managed
Agents-style resource APIs, skills, files, credential vaults, memory stores,
environments, and resumable session events.

`managed-agents` is designed for teams that want a local-first control plane for
agent development, desktop apps, and self-hosted workflows. Runtime metadata is
stored in SQLite outside your project by default. Optional YAML and skill folders
can seed a workspace, while agents created from the Console or API are managed
as runtime records.

## Features

- SQLite-backed agents, skills, sessions, environments, vaults, memory stores,
  API keys, and file metadata
- Local Console at `/ui`
- HTTP APIs under `/v1` for managed-agent resources
- Resumable Server-Sent Events for session timelines
- File resources, memory stores, credential vaults, and environment templates
- Optional seed/import folders for `agents/*.yaml` and `skills/*/SKILL.md`
- Local, Docker, and self-hosted sandbox provider support
- OpenAI-compatible, Ollama-compatible, and Anthropic model adapters
- TypeScript SDK export at `managed-agents/sdk`

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A configured model provider key or local OpenAI-compatible endpoint

Docker is optional and is only needed when you want Docker-backed sandboxes.

## Install

Use the CLI with `npx`:

```bash
npx managed-agents init
npx managed-agents start
```

Or install it globally:

```bash
npm install -g managed-agents
managed-agents init
managed-agents start
```

For source builds:

```bash
git clone git@github.com:sandbaseai/managed-agents.git
cd managed-agents
npm ci
npm run build
npm start
```

## Quick Start

Create a workspace:

```bash
mkdir my-agents
cd my-agents
npx managed-agents init
```

Configure a model in `managed-agents.config.yaml`. For Anthropic:

```yaml
models:
  - name: claude-opus-4-8
    provider: anthropic
    model: claude-opus-4-8
    api_key: ${ANTHROPIC_API_KEY}

environments:
  local:
    sandbox_provider: local
    timeout: 300
```

For an OpenAI-compatible endpoint, use `provider: openai`, set `model` to the
provider model name, and optionally set `base_url`.

Start the runtime:

```bash
export ANTHROPIC_API_KEY=...
npx managed-agents start
```

Open the Console:

```text
http://127.0.0.1:3000/ui
```

The API is available at:

```text
http://127.0.0.1:3000/v1
```

## Workspace Layout

```text
my-agents/
+-- agents/                  # Optional seed agent definitions
|   +-- assistant.yaml
+-- skills/                  # Optional seed skill packages
|   +-- example-skill/
|       +-- SKILL.md
+-- managed-agents.config.yaml
```

Runtime state is stored outside the repository by default:

```text
~/.managed-agents/<workspace-name>-<hash>/
+-- data.db                  # SQLite metadata store
+-- files/                   # Uploaded file bytes
+-- skills/                  # Uploaded custom skill package assets
+-- snapshots/               # Session workspace snapshots
+-- sandbox/                 # Local session workspaces
```

Set `MANAGED_AGENTS_HOME` or pass `--data-dir` to override this location.

## Agent Definition

Agents use the Claude Managed Agents-style shape below. The Console/API generate
stable `agent_...` IDs. `name` is a human-readable label, not a filesystem path
or uniqueness key.

```yaml
name: Incident commander
description: Triages alerts, opens incident tickets, and coordinates status updates.
model: claude-opus-4-8
system: |-
  You are an on-call incident commander. Be decisive, cite the evidence you used,
  and recommend rollback when confidence is high.
mcp_servers:
  - name: sentry
    type: url
    url: https://mcp.sentry.dev/mcp
  - name: linear
    type: url
    url: https://mcp.linear.app/mcp
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy:
        type: always_ask
    configs:
      - name: read
        enabled: true
      - name: grep
        enabled: true
      - name: bash
        enabled: true
        permission_policy:
          type: always_ask
  - type: mcp_toolset
    mcp_server_name: sentry
    default_config:
      permission_policy:
        type: always_allow
  - type: mcp_toolset
    mcp_server_name: linear
    default_config:
      permission_policy:
        type: always_allow
skills:
  - type: anthropic
    skill_id: pdf
metadata:
  template: incident-commander
```

Use `model: <model-id>` for the common path. API clients may also send a model
configuration object when they need additional controls such as `speed`.

## Console

The Console provides a local dashboard for:

- Creating and editing agents
- Starting sessions and viewing transcripts
- Inspecting session debug events
- Creating environments
- Managing credential vaults
- Uploading files
- Creating and editing memory stores
- Uploading skills
- Creating and archiving local API keys
- Reviewing local runtime and workspace configuration

## CLI

```bash
managed-agents init
managed-agents start --host 127.0.0.1 --port 3000
managed-agents list
managed-agents reload
managed-agents chat <agent-id> --message "hello"
managed-agents template list
managed-agents template install <template-name-or-path>
managed-agents template create <name>
```

## API Example

Create an agent:

```bash
curl -X POST http://127.0.0.1:3000/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Incident commander",
    "description": "Triages alerts and coordinates incident response.",
    "model": "claude-opus-4-8",
    "system": "You are an on-call incident commander.",
    "tools": [{ "type": "agent_toolset_20260401" }],
    "metadata": { "template": "incident-commander" }
  }'
```

Create an environment:

```bash
curl -X POST http://127.0.0.1:3000/v1/environments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Default cloud",
    "config": {
      "type": "cloud",
      "networking": {
        "type": "limited",
        "allow_mcp_servers": true,
        "allow_package_managers": true,
        "allowed_hosts": ["api.github.com"]
      },
      "packages": {
        "type": "packages",
        "pip": ["pytest"],
        "npm": ["typescript"]
      }
    }
  }'
```

Create a memory store:

```bash
curl -X POST http://127.0.0.1:3000/v1/memory_stores \
  -H "Content-Type: application/json" \
  -d '{
    "name": "Incident notes",
    "description": "Long-lived incident context and follow-up notes.",
    "metadata": { "team": "platform" }
  }'
```

Create a session:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent_...",
    "environment_id": "env_...",
    "title": "Sentry alert triage",
    "resources": [
      {
        "type": "memory_store",
        "memory_store_id": "memstore_...",
        "access": "read_write",
        "instructions": "Use this store for incident timelines and decisions."
      }
    ]
  }'
```

Send a user event:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [{ "type": "text", "text": "Investigate SENTRY-123." }]
      }
    ]
  }'
```

Resume the event stream:

```bash
curl -N http://127.0.0.1:3000/v1/sessions/SESSION_ID/events/stream \
  -H "Last-Event-ID: 42"
```

## TypeScript SDK

The SDK wraps the same local API. Use generated resource IDs from the Console or
from the create responses above.

```typescript
import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: 'http://127.0.0.1:3000',
});

const session = await client.sessions.create({
  agent: 'agent_...',
  environment_id: 'env_...',
  title: 'SDK smoke test',
});

for await (const event of client.sessions.message(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}
```

## Authentication

Local development is open by default. Authentication turns on when at least one
API key exists. You can create managed keys from the Console/API, or configure a
static key:

```bash
export MANAGED_AGENTS_API_KEY=sk-local-example
```

Static keys can also be configured in `managed-agents.config.yaml`:

```yaml
api_keys:
  - ${MANAGED_AGENTS_API_KEY}
```

Create a managed key through the API:

```bash
curl -X POST http://127.0.0.1:3000/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{ "name": "Local Console" }'
```

Clients then send:

```text
Authorization: Bearer sk-local-example
```

## Documentation

- [Installation](docs/installation.md)
- [Usage Guide](docs/usage.md)
- [API Reference](docs/api.md)
- [Skills](docs/skills.md)
- [Architecture](docs/spec/architecture.md)
- [Technical Design](docs/spec/design.md)
- [Contributing](CONTRIBUTING.md)

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Run the runtime and Console during development:

```bash
npm run dev
npm run dev:console
```

## Release Checks

Before publishing a release:

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Smoke test the example project:

```bash
cd examples/basic
npx managed-agents start --config managed-agents.config.yaml --agents-dir agents --skills-dir skills
```

## License

[Apache-2.0](LICENSE)
