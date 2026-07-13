# Installation

This guide covers installing and starting `managed-agents` in a local
workspace. The runtime is a single Node.js process that serves both the HTTP API
and the local Console.

## Requirements

- Node.js 22 or newer
- npm 10 or newer
- A model provider API key or an OpenAI-compatible local endpoint
- Docker, only when using Docker-backed sandboxes

## Install With npx

Use `npx` when you want to try the runtime without installing a global package:

```bash
mkdir my-agents
cd my-agents
npx managed-agents init
npx managed-agents start
```

The Console will be available at:

```text
http://127.0.0.1:3000/ui
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
npm start
```

During development, run the TypeScript entry point directly:

```bash
npm run dev
```

Run the Console Vite server separately when iterating on UI code:

```bash
npm run dev:console
```

## Initialize A Workspace

Create a workspace with the default seed directories and example files:

```bash
managed-agents init
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

## Configure A Model

Edit `managed-agents.config.yaml` and configure at least one model.

OpenAI-compatible hosted provider:

```yaml
models:
  - name: gpt-4o
    provider: openai
    model: gpt-4o
    api_key: ${OPENAI_API_KEY}
```

OpenAI-compatible local endpoint:

```yaml
models:
  - name: local-llama
    provider: openai
    model: llama3.1
    base_url: http://127.0.0.1:11434/v1
    api_key: ${LOCAL_MODEL_API_KEY}
```

Anthropic model provider:

```yaml
models:
  - name: claude-sonnet
    provider: anthropic
    model: claude-sonnet-4-5
    api_key: ${ANTHROPIC_API_KEY}
```

Environment variables in the config file are resolved at startup.

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
    timeout: 300
```

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

Open the Console:

```text
http://127.0.0.1:3000/ui
```

## Troubleshooting

If the Console loads but agents are missing, run:

```bash
managed-agents reload
```

If sessions fail to start, check:

- The agent `model` value matches a configured model name.
- Required provider API keys are set in the shell that started the runtime.
- The requested `environment_id` exists and is active.
- Uploaded file resources use mount paths under `/uploads/`.
