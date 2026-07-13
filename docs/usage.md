# Usage Guide

`managed-agents` provides a local control plane for building, running, and
debugging managed agents. The usual workflow is:

1. Create or import an agent.
2. Attach skills, tools, MCP servers, files, memory stores, or credentials.
3. Start a session in an environment.
4. Inspect the transcript and debug event stream.
5. Iterate on the agent definition and save new versions.

## Workspace Layout

A workspace is a folder that contains runtime configuration plus optional seed
agent definitions and skill packages. Live metadata is stored in SQLite under
the user-level runtime directory.

```text
my-agents/
+-- agents/                  # Optional seed agent definitions
|   +-- assistant.yaml
+-- skills/                  # Optional seed skill packages
|   +-- code-review/
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

The workspace is portable. Commit examples, templates, config, and any seed
definitions you intentionally maintain. Use `MANAGED_AGENTS_HOME` or
`--data-dir` when you need to move runtime state.

## Agent Definitions

Agents can be imported from YAML files in `agents/` or created through the
Console/API. Once loaded, the runtime source of truth is SQLite.

```yaml
name: assistant
description: Helps with development tasks.
model: gpt-4o
system: |
  You are a helpful assistant. Answer clearly and use tools when needed.
mcp_servers: []
tools:
  - type: agent_toolset_20260401
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
skills:
  - type: custom
    skill_id: skill_code-review
metadata:
  owner: platform
```

Agent ids are stable object identifiers. YAML seed agents use deterministic ids
when they are first imported, while agents created through the API or Console
receive server-generated `agent_...` ids. Use the returned id in API calls,
sessions, and SDK requests; treat `name` as a human-readable display field.

## Console Workflow

Start the runtime:

```bash
managed-agents start
```

Open:

```text
http://127.0.0.1:3000/ui
```

The Console includes:

- Workspace and local runtime status
- Quickstart templates
- Agents and agent versions
- Session creation and session debug timelines
- Environments
- Credential vaults and credentials
- Memory stores and memory entries
- File upload and file resources
- Skill upload and skill details

## Create An Agent

Use the Console `Create agent` action, or add a seed YAML file in `agents/` and
reload to import it into SQLite:

```bash
managed-agents reload
```

Create an agent through the API:

```bash
curl -X POST http://127.0.0.1:3000/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "assistant",
    "description": "Helps with development tasks.",
    "model": "gpt-4o",
    "system": "You are a helpful assistant.",
    "tools": [{ "type": "agent_toolset_20260401" }],
    "skills": [],
    "metadata": {}
  }'
```

## Start A Session

A session is a run of an agent inside an environment.

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent_assistant",
    "environment_id": "env_default",
    "title": "Local smoke test"
  }'
```

The response contains a `sesn_...` id.

Send a user message:

```bash
curl -N -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello", "stream": true}'
```

List events:

```bash
curl http://127.0.0.1:3000/v1/sessions/SESSION_ID/events
```

Resume a live event stream:

```bash
curl -N http://127.0.0.1:3000/v1/sessions/SESSION_ID/events/stream \
  -H "Last-Event-ID: EVENT_ID"
```

Stop a session:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/stop
```

## Attach Files To A Session

Upload a file:

```bash
curl -X POST http://127.0.0.1:3000/v1/files \
  -F "file=@notes.txt"
```

Create a session with the file mounted under `/uploads/`:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent_assistant",
    "environment_id": "env_default",
    "resources": [
      {
        "type": "file",
        "file_id": "file_abc123",
        "mount_path": "/uploads/notes.txt"
      }
    ]
  }'
```

## Attach A Memory Store

Create a memory store:

```bash
curl -X POST http://127.0.0.1:3000/v1/memory_stores \
  -H "Content-Type: application/json" \
  -d '{"name": "project-memory", "description": "Long-term project notes"}'
```

Add a memory:

```bash
curl -X POST http://127.0.0.1:3000/v1/memory_stores/MEMORY_STORE_ID/memories \
  -H "Content-Type: application/json" \
  -d '{"path": "/notes/overview", "content": "Use concise release notes."}'
```

Mount the store into a session:

```json
{
  "type": "memory_store",
  "memory_store_id": "memstore_abc123",
  "access": "read_write",
  "instructions": "Use this store for durable project notes."
}
```

## Use Credential Vaults

Credential vaults hold credentials that sessions can use without writing
secrets into agent YAML files.

Create a vault:

```bash
curl -X POST http://127.0.0.1:3000/v1/credential-vaults \
  -H "Content-Type: application/json" \
  -d '{"name": "production-tools"}'
```

Add an environment variable credential:

```bash
curl -X POST http://127.0.0.1:3000/v1/credential-vaults/VAULT_ID/credentials \
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

Attach one or more vaults when creating a session:

```json
{
  "vault_ids": ["vlt_abc123"]
}
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

for await (const event of client.sessions.chat(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}
```

## CLI Commands

```bash
managed-agents init
managed-agents start --host 127.0.0.1 --port 3000
managed-agents list
managed-agents reload
managed-agents chat agent_assistant --message "hello"
managed-agents template list
managed-agents template install <template-name-or-path>
managed-agents template create <name>
```

## Operational Notes

- Keep credentials in vaults or environment variables, not in agent YAML files.
- Keep uploaded file resources below 10 MB per file.
- Keep skill uploads below 8 MB per package.
- Use `MANAGED_AGENTS_SECRET_KEY` to provide a stable credential encryption key
  across runtime moves.
- Create a managed API key in the Console or set `MANAGED_AGENTS_API_KEY` before
  exposing the runtime beyond a trusted local network.
