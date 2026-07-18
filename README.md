# managed-agents

**SandBase managed-agents is the safe, local-first runtime layer for enterprise
AI agents.**

`managed-agents` helps teams move AI agents from demos to production with
runtime infrastructure for sessions, tools, approvals, sandboxed execution,
memory, credential vaults, audit trails, replayable events, and operational
visibility. It exposes a Claude Managed Agents-compatible Console and `/v1`
resource API while keeping runtime metadata in SQLite outside your project by
default.

Use it to build and operate self-hosted AI agents, local developer agents,
desktop agent runtimes, MCP-enabled workflows, and enterprise proofs of concept
without locking your runtime layer to a single model provider.

## Why managed-agents?

Agent SDKs are great for writing an agent loop. Production agents need more:
state, session history, tool governance, sandbox boundaries, credential handling,
memory, auditability, and a Console for humans to inspect what happened.

`managed-agents` focuses on that runtime layer. It is not a visual workflow
builder and it is not another model SDK. It is an open-source control plane for
running, observing, and governing AI agents locally or in self-hosted
environments.

## Features

- Claude Managed Agents-style Console and `/v1` resource APIs
- SQLite-backed agents, skills, sessions, environments, credential vaults,
  memory stores, API keys, and file metadata
- Resumable Server-Sent Events for session timelines, debugging, audit, and
  replay
- File resources, memory stores, credential vaults, and environment templates
- Local API keys and bearer-token authentication for shared local runtimes
- Optional seed/import folders for `agents/*.yaml` and `skills/*/SKILL.md`
- Local, Docker, and self-hosted sandbox provider support
- MCP toolsets, built-in tools, permission policies, and skill packages
- OpenAI-compatible, Ollama-compatible, and Anthropic model adapters
- Optional TypeScript convenience SDK at `managed-agents/sdk`

## Common Use Cases

- Run a local Claude Managed Agents-style Console for agent development
- Build self-hosted enterprise AI agents with auditable sessions and tool calls
- Prototype customer support, incident response, research, data analysis, and
  software engineering agents
- Package reusable agent templates, MCP connectors, permission policies, and
  skills for field deployments
- Embed an agent runtime in a future desktop app or private internal platform

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A configured model vendor API key or local OpenAI-compatible endpoint

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
```

Then create and run an agent workspace outside the source checkout:

```bash
mkdir ../my-agents
cd ../my-agents
node ../managed-agents/dist/index.js init
node ../managed-agents/dist/index.js start
```

## Run A Workspace

Create a workspace:

```bash
mkdir my-agents
cd my-agents
npx managed-agents init
```

If you are running from a source checkout, replace `npx managed-agents` with
`node /path/to/managed-agents/dist/index.js`.

Start the runtime:

```bash
npx managed-agents start
# source checkout:
# node /path/to/managed-agents/dist/index.js start
```

Open the Dashboard:

```text
http://127.0.0.1:3000/dashboard
```

Open `Settings > Models` and configure the single workspace model vendor:
vendor, optional base URL, and API key. The Dashboard stores Settings V2 in the
runtime SQLite database under the user data directory. Agents that use
`model: default` run through that configured vendor; concrete model IDs remain
adapter-owned implementation details. No source-controlled file changes are
required for normal local use.

The API is available at:

```text
http://127.0.0.1:3000/v1
```

Inside the Dashboard, open `Settings > API reference` for a Claude-style
developer reference page. It shows the active base URL, authentication mode,
grouped endpoints, parameter descriptions, return fields, and copyable `curl`
and TypeScript SDK examples generated from your running runtime.

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
model: default
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

Use `model: default` for the common path. The workspace Settings page maps that
name to the configured vendor, and each vendor adapter owns its default concrete
model ID. Runtime settings are stored in SQLite under the runtime data
directory. API clients may also send a model configuration object when they need
additional controls such as `speed`.

## Dashboard

The Dashboard provides a local console for:

- Creating and editing agents
- Starting sessions and viewing transcripts
- Inspecting session debug events
- Creating environments
- Managing credential vaults
- Uploading files
- Creating and editing memory stores
- Uploading skills
- Creating and archiving local API keys
- Reading the built-in API reference for `/v1` endpoints, SDK snippets, and
  Skill upload examples
- Reviewing Settings for models, loop engine behavior, storage, sandboxing,
  API keys, API reference, logs, and monitoring
- Restarting the runtime and viewing recent structured logs from Settings

Open `Settings > API reference` in the Dashboard to see the active base URL,
authentication mode, core service endpoints, copyable `curl` examples, SDK
snippets, and the required Skill package shape.

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
    "model": "default",
    "system": "You are an on-call incident commander.",
    "tools": [{ "type": "agent_toolset_20260401" }],
    "metadata": { "template": "incident-commander" }
  }'
```

The response contains the stable `agent_...` id to use for sessions. Agent
names are display labels; Console/API-created agents receive server-generated
ids and do not rely on name-derived identifiers.

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

The response contains the stable `env_...` id to use for sessions. Environment
names are display labels and do not need to be unique.

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

Upload a Skill package:

```bash
zip -r code-review-assistant.zip code-review-assistant

curl -X POST http://127.0.0.1:3000/v1/skills \
  -F "files=@code-review-assistant.zip"
```

The archive must contain one top-level directory and a root `SKILL.md` file:

```text
code-review-assistant/
+-- SKILL.md
+-- references/
    +-- checklist.md
```

`SKILL.md` must start with YAML frontmatter that includes `name` and
`description`. The server generates the stable `skill_...` id; the Skill name is
read from the package metadata and can then be attached to agents:

```yaml
skills:
  - type: custom
    skill_id: skill_...
```

Memory store names are labels for humans and prompts; they do not need to be
unique. Use the returned `memstore_...` id when mounting a store into a session.

Create a credential vault and add a credential:

```bash
curl -X POST http://127.0.0.1:3000/v1/credential-vaults \
  -H "Content-Type: application/json" \
  -d '{ "name": "production-tools" }'

curl -X POST http://127.0.0.1:3000/v1/credential-vaults/vlt_.../credentials \
  -H "Content-Type: application/json" \
  -d '{
    "name": "github-token",
    "auth_type": "environment_variable",
    "variable_name": "GITHUB_TOKEN",
    "value": "ghp_example",
    "network": {
      "type": "limited",
      "allowed_hosts": ["api.github.com"]
    },
    "injection_locations": ["request_headers"]
  }'
```

Credential records use `auth_type` values `mcp_oauth`, `bearer_token`, or
`environment_variable`. Secret values are encrypted at rest and never returned
by list or retrieve responses.

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

## SDK Usage

The public API is designed to follow Claude Managed Agents resource shapes. When
your SDK supports the managed-agent beta resources, point the official Anthropic
SDK at the local runtime with `baseURL`:

```typescript
import Anthropic from '@anthropic-ai/sdk';

const client = new Anthropic({
  apiKey: process.env.MANAGED_AGENTS_API_KEY ?? 'local-dev-key',
  baseURL: 'http://127.0.0.1:3000',
});

const session = await client.beta.sessions.create({
  agent: 'agent_...',
  environment_id: 'env_...',
  title: 'SDK smoke test',
});

await client.beta.sessions.events.send(session.id, {
  events: [
    {
      type: 'user.message',
      content: [{ type: 'text', text: 'Hello' }],
    },
  ],
});
```

For local-only helpers such as message streaming convenience methods, the package
also exports a small TypeScript wrapper over the same HTTP API:

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

for await (const event of client.sessions.chat(session.id, 'Hello')) {
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

## Project Keywords

`enterprise-ai-agents`, `ai-agent-runtime`, `managed-agents`,
`claude-managed-agents`, `self-hosted-ai`, `local-first`, `mcp`,
`sandboxed-execution`, `agent-memory`, `credential-vaults`, `audit-log`,
`session-replay`, `typescript`, `sqlite`

## Development

```bash
npm ci
npm run typecheck
npm test
npm run build
```

Before handing a branch to release, run the full local release gate:

```bash
npm run release:check
```

That gate runs typecheck, the Vitest suite, production builds, `npm pack
--dry-run`, and a CLI smoke test that verifies both `managed-agents init` and
the `examples/basic` workspace startup path.

Run the runtime and Dashboard during development:

```bash
npm run dev
npm run dev:console
```

The Dashboard's `Settings > Logs` page can restart the CLI-managed server and
display the current process log buffer. Runtime configuration is organized
under `Settings > Models`, `Settings > Loop engine`, `Settings > Storage`,
`Settings > Memory`, and `Settings > Sandbox`. Each page edits the same
versioned Settings V2 document, supports Form and JSON modes, and can validate
or test the local capability before saving. Save is enabled only after a changed
candidate validates successfully; saved settings become the effective runtime
configuration after restart when a restart is required. The same log controls
are available through `POST /v1/x/restart` and `GET /v1/x/logs`.

## Release Checks

Before publishing a release:

```bash
npm ci
npm run release:check
```

`release:check` verifies:

- TypeScript type safety
- Unit and integration tests
- Runtime and Dashboard production builds
- npm package contents with `npm pack --dry-run`
- `managed-agents init` output in a temporary workspace
- `examples/basic` startup, health, and agent loading

Manual example smoke, when you want to inspect the running Dashboard:

```bash
cd examples/basic
npx managed-agents start --config managed-agents.config.yaml --agents-dir agents --skills-dir skills
```

Then open `http://127.0.0.1:3000/dashboard` and configure
`Settings > Models` before calling a real hosted model.

## License

[Apache-2.0](LICENSE)
