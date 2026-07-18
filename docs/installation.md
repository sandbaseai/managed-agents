# Installation

This guide covers installing and starting `managed-agents` in a local
workspace. The runtime is a single Node.js process that serves both the HTTP API
and the local Console.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A model vendor API key or an OpenAI-compatible local endpoint
- Docker, only when using Docker-backed sandboxes

## Install With npx

Use `npx` when you want to try the runtime without installing a global package:

```bash
mkdir my-agents
cd my-agents
npx managed-agents init
npx managed-agents start
```

The Dashboard will be available at:

```text
http://127.0.0.1:3000/dashboard
```

The API will be available at:

```text
http://127.0.0.1:3000/v1
```

## Global Install

Use a global install for a workstation or shared development machine:

```bash
npm install -g managed-agents
managed-agents init
managed-agents start
```

Upgrade the global install with:

```bash
npm update -g managed-agents
```

Remove it with:

```bash
npm uninstall -g managed-agents
```

## Build From Source

Use a source checkout when contributing to the project:

```bash
git clone git@github.com:sandbaseai/managed-agents.git
cd managed-agents
npm ci
npm run build
```

Before publishing or handing off a release branch, run:

```bash
npm run release:check
```

This validates type safety, tests, production builds, npm package contents, CLI
workspace initialization, and `examples/basic` startup.

Then create a runtime workspace outside the source checkout:

```bash
mkdir ../my-agents
cd ../my-agents
node ../managed-agents/dist/index.js init
node ../managed-agents/dist/index.js start
```

During development, run the TypeScript entry point directly:

```bash
npm run dev
```

Run the Dashboard Vite server separately when iterating on frontend code:

```bash
npm run dev:console
```

## Initialize A Workspace

Create a workspace with the default seed directories and example files:

```bash
managed-agents init
```

When running from a source checkout without a global install, use:

```bash
node /path/to/managed-agents/dist/index.js init
```

This creates:

```text
agents/
skills/
managed-agents.config.yaml
```

`agents/` and `skills/` are optional seed/import folders. Runtime metadata and
uploaded resource state are stored outside the repository under
`~/.managed-agents/<workspace-name>-<hash>/` by default.

## Configure The Model Vendor

Start the runtime, open the Dashboard, and go to `Settings > Models`.

```text
http://127.0.0.1:3000/dashboard#models
```

Configure the workspace model vendor, then click `Validate` or
`Check configuration` before saving:

- `Vendor`: `anthropic`, `openai`, or `openai_compatible`
- `Base URL`: required for OpenAI-compatible local or hosted endpoints
- `API key`: the provider key for model requests

Runtime settings are stored as one versioned Settings V2 document in SQLite
under the runtime data directory, not in the source checkout. Agents using
`model: default` run through the configured vendor. Concrete model IDs remain
adapter-owned implementation details; the Dashboard does not ask for a model ID.
Config-file model entries are only used as optional bootstrap data for a new
workspace.

The same Settings page also configures the single active Loop engine, Storage
backends, Memory backend, and default Sandbox. Docker appears as available only
when the runtime detects Docker support. Planned adapters such as S3, mem0,
MemU, Codex, Harness, and Claude are shown as unavailable until a real runtime
adapter exists.

## Configure Environments

Every session runs in an environment. The default local environment is enough
for a first run:

```yaml
environments:
  local:
    sandbox_provider: local
    timeout: 300
```

Docker-backed environments can be added when command execution needs stronger
process isolation:

```yaml
environments:
  docker:
    sandbox_provider: docker
    image: node:22-slim
    resources:
      memory: 1g
      cpu: 1
    timeout: 300
```

Docker mode creates one long-lived container per session and runs tool commands
with `docker exec` inside `/workspace`. The Docker CLI and daemon must be
available to the local runtime process; if Docker is not detected, the Console
marks the adapter unavailable and existing Docker environments cannot start new
containers until Docker is running again.

## Start Options

```bash
managed-agents start \
  --host 127.0.0.1 \
  --port 3000 \
  --config managed-agents.config.yaml \
  --agents-dir agents \
  --skills-dir skills
```

| Option | Default | Purpose |
| --- | --- | --- |
| `--host` | `127.0.0.1` | Bind address for the API and Console. |
| `--port` | `3000` | HTTP port. |
| `--config` | `managed-agents.config.yaml` | Runtime configuration file. |
| `--agents-dir` | `agents` | Directory containing agent YAML files. |
| `--skills-dir` | `skills` | Directory containing skill packages. |
| `--data-dir` | `~/.managed-agents/<workspace-name>-<hash>` | SQLite database, uploaded files, and runtime data. |
| `--target` | unset | Optional runtime target label surfaced in the Console. |

Set `MANAGED_AGENTS_HOME` to move all workspace runtime folders together, or
pass `--data-dir` for a single workspace override.

The API and Dashboard are served from the same origin. CORS is restricted by
default to same-origin and local loopback browser origins. For a deployed
Console or a trusted separate frontend, set a comma-separated allowlist:

```bash
export MANAGED_AGENTS_CORS_ORIGINS=https://console.example.com,https://admin.example.com
managed-agents start --host 0.0.0.0
```

## Enable API Authentication

Local development is open by default. Authentication turns on when at least one
API key exists. You can create managed keys from the Console/API, or set a
static key before starting the runtime:

```bash
export MANAGED_AGENTS_API_KEY=sk-local-example
managed-agents start
```

Static keys can also be configured in `managed-agents.config.yaml`:

```yaml
api_keys:
  - ${MANAGED_AGENTS_API_KEY}
```

Clients must then send:

```text
Authorization: Bearer sk-local-example
```

Managed keys created through `/v1/api-keys` are stored in SQLite as hashes. The
raw `secret_key` is returned only once when the key is created.

## Verify The Install

Check the runtime:

```bash
curl http://127.0.0.1:3000/v1/x/health
```

List agents:

```bash
curl http://127.0.0.1:3000/v1/agents
```

Open the Dashboard:

```text
http://127.0.0.1:3000/dashboard
```

## Troubleshooting

If the Dashboard loads but agents are missing, run:

```bash
managed-agents reload
```

For a source checkout, run the same command through the built entry point:

```bash
node /path/to/managed-agents/dist/index.js reload
```

If sessions fail to start, check:

- The agent `model` value matches a configured model name.
- Required provider API keys are set in the shell that started the runtime.
- The requested `environment_id` exists and is active.
- Uploaded file resources use mount paths under `/uploads/`.
