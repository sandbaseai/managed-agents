# managed-agents

Open-source managed-agent runtime with a local Console, standard resource APIs,
skills, files, credential vaults, memory stores, environments, and resumable
session events.

`managed-agents` is designed for teams that want a local-first control plane for
agent development, evaluation, and desktop or self-hosted workflows. Runtime
metadata is stored in a local SQLite database, optional YAML and skill folders
can seed a workspace, and the web Console is served by the same Node.js process.

## Features

- SQLite-backed agents, skills, sessions, environments, vaults, memory stores, and file metadata
- Optional seed/import folders for `agents/*.yaml` and `skills/*/SKILL.md`
- Local Console at `/ui`
- Standard HTTP API under `/v1`
- Resumable Server-Sent Events for session timelines
- File resources, memory stores, credential vaults, and environments
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

Configure a model in `managed-agents.config.yaml`:

```yaml
models:
  - name: gpt-4o
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}

environments:
  local:
    sandbox_provider: local
    timeout: 300
```

Start the runtime:

```bash
export OPENAI_API_KEY=...
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

Agents use the standard runtime shape below. You can import them from YAML seed
files or create them through the Console/API; runtime records are stored in
SQLite.

```yaml
name: assistant
description: Helps with development tasks.
model:
  id: gpt-4o
  speed: standard
system: |
  You are a helpful assistant. Answer clearly and use tools when needed.
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
    configs:
      bash:
        enabled: true
        permission_policy:
          type: always_ask
skills:
  - type: custom
    skill_id: skill_example-skill
metadata:
  owner: local
```

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

Create a session:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent_assistant",
    "environment_id": "env_default",
    "title": "Local test"
  }'
```

Send a message and stream the turn:

```bash
curl -N -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello", "stream": true}'
```

Resume the event stream:

```bash
curl -N http://127.0.0.1:3000/v1/sessions/SESSION_ID/events/stream \
  -H "Last-Event-ID: 42"
```

## TypeScript SDK

```typescript
import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: 'http://127.0.0.1:3000',
});

const session = await client.sessions.create({
  agent: 'agent_assistant',
  environment_id: 'env_default',
});

for await (const event of client.sessions.message(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}
```

## Authentication

Local development is open by default. To require bearer tokens, set either:

```bash
export MANAGED_AGENTS_API_KEY=sk-local-example
```

Or configure keys in `managed-agents.config.yaml`:

```yaml
api_keys:
  - ${MANAGED_AGENTS_API_KEY}
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
