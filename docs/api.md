# API Reference

`managed-agents` exposes a local-first JSON API under `/v1`. The Dashboard, the
TypeScript SDK, and external automation all use the same resource model: agents,
sessions, environments, credential vaults, memory stores, files, skills, API
keys, and runtime operations.

The API is intentionally close to Claude Managed Agents while remaining
self-hosted and inspectable. Resource metadata is stored in SQLite, uploaded
assets live under the runtime data directory, and session timelines are
persisted as replayable events.

## Interactive Reference

Open `Settings > API reference` in the Dashboard for an in-product reference page
modeled after platform API docs:

- endpoint navigation grouped by resource
- method/path headers for each operation
- header, query, body, and return field descriptions
- copyable `curl` examples generated from the active runtime base URL
- TypeScript SDK and Skill upload examples

Use this page when integrating a local runtime into scripts, CI jobs, desktop
apps, or an internal control plane. It reflects the server you are connected to,
including whether bearer authentication is currently enabled.

## Runtime Contract

The local server exposes the Dashboard and API from the same origin:

```text
Dashboard: http://127.0.0.1:3000/dashboard
API:       http://127.0.0.1:3000/v1
```

All timestamps are RFC 3339 strings. Identifiers are opaque tagged ids such as
`agent_...`, `sess_...`, `env_...`, `skill_...`, and `memstore_...`; clients
should not infer meaning from their length or suffix.

## Compatibility Headers

The local runtime accepts requests with the same beta headers used by Claude
Managed Agents clients. They are optional locally, but useful when testing SDK
code intended to run against the hosted API:

```text
anthropic-beta: managed-agents-2026-04-01
anthropic-beta: agent-memory-2026-07-22
```

## Authentication

Authentication is disabled by default for local development. It is enabled when
at least one API key exists. Keys can be configured in
`managed-agents.config.yaml`, supplied through `MANAGED_AGENTS_API_KEY`, or
created through `/v1/api-keys`.

Send a bearer token with every request once authentication is enabled:

```text
Authorization: Bearer ma_local_example
```

Raw API keys are never returned from list or retrieve responses. A newly created
managed key returns `secret_key` once; store it before discarding the response.

## Pagination and Errors

Collection responses:

```json
{
  "data": [],
  "has_more": false,
  "first_id": null,
  "last_id": null
}
```

Error responses:

```json
{
  "error": {
    "type": "invalid_request",
    "message": "name is required"
  }
}
```

Common error types are `invalid_request`, `not_found`, `conflict`,
`not_available`, and `internal_error`.

## API Keys

API keys control bearer-token authentication for the local runtime. Managed keys
are stored in SQLite as SHA-256 hashes. Keys from config or environment variables
are shown as read-only `config_env` records.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/api-keys` | List managed and configured API keys. |
| `POST` | `/v1/api-keys` | Create a managed API key. |
| `DELETE` | `/v1/api-keys/{key_id}` | Delete a managed API key. |

Create a key:

```bash
curl -X POST http://127.0.0.1:3000/v1/api-keys \
  -H "Content-Type: application/json" \
  -d '{ "name": "Local Console" }'
```

Create response:

```json
{
  "id": "key_abc123",
  "type": "api_key",
  "name": "Local Console",
  "source": "managed",
  "key_prefix": "ma_abc123...wxyz",
  "status": "active",
  "created_at": "2026-07-12T00:00:00.000Z",
  "updated_at": "2026-07-12T00:00:00.000Z",
  "last_used_at": null,
  "archived_at": null,
  "secret_key": "ma_full_secret_returned_once"
}
```

List response entries omit `secret_key`:

```json
{
  "id": "key_abc123",
  "type": "api_key",
  "name": "Local Console",
  "source": "managed",
  "key_prefix": "ma_abc123...wxyz",
  "status": "active",
  "last_used_at": "2026-07-12T00:01:00.000Z"
}
```

## Agents

Agents are SQLite-backed runtime resources. Optional YAML files in the configured
agents directory can seed a workspace, but creates and updates are persisted in
the local database.

Agent ids are object identifiers. Seeded YAML agents use deterministic ids on
import; API and Console-created agents receive server-generated `agent_...` ids.
Names are display fields and do not need to be unique.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/agents` | List loaded agents. |
| `POST` | `/v1/agents` | Create an agent resource. |
| `GET` | `/v1/agents/{agent_id}` | Retrieve an agent. |
| `PUT` | `/v1/agents/{agent_id}` | Save a new agent version. |
| `GET` | `/v1/agents/{agent_id}/versions` | List versions known to the local store. |
| `POST` | `/v1/agents/{agent_id}/archive` | Archive an agent. |

Create an agent:

```bash
curl -X POST http://127.0.0.1:3000/v1/agents \
  -H "Content-Type: application/json" \
  -d '{
    "name": "assistant",
    "description": "Helps with development tasks.",
    "model": "default",
    "system": "You are a helpful assistant.",
    "mcp_servers": [],
    "tools": [{ "type": "agent_toolset_20260401" }],
    "skills": [],
    "metadata": {}
  }'
```

Agent response:

```json
{
  "id": "agent_01JAbcdefghijklmnopqrstuvw",
  "type": "agent",
  "name": "assistant",
  "description": "Helps with development tasks.",
  "model": "default",
  "status": "active",
  "version": 1,
  "created_at": "2026-07-12T00:00:00.000Z",
  "updated_at": "2026-07-12T00:00:00.000Z",
  "archived_at": null
}
```

## Sessions

Sessions run an agent in an environment and persist a resumable event log.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/sessions` | List sessions. |
| `POST` | `/v1/sessions` | Create a session. |
| `GET` | `/v1/sessions/{session_id}` | Retrieve a session. |
| `POST` | `/v1/sessions/{session_id}/messages` | Send a user message and optionally stream. |
| `POST` | `/v1/sessions/{session_id}/events` | Append user events. |
| `GET` | `/v1/sessions/{session_id}/events` | List persisted events. |
| `GET` | `/v1/sessions/{session_id}/events/stream` | Stream live events with SSE. |
| `POST` | `/v1/sessions/{session_id}/stop` | Stop a session. |
| `DELETE` | `/v1/sessions/{session_id}` | Delete a session from active listings. |

Create a session:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions \
  -H "Content-Type: application/json" \
  -d '{
    "agent": "agent_assistant",
    "environment_id": "env_default",
    "title": "Local test",
    "resources": [],
    "vault_ids": [],
    "metadata": { "source": "docs" }
  }'
```

Supported session resources:

```json
[
  {
    "type": "file",
    "file_id": "file_abc123",
    "mount_path": "/uploads/input.txt"
  },
  {
    "type": "github_repository",
    "url": "https://github.com/owner/repo",
    "authorization_token": "ghp_example",
    "checkout": "main",
    "mount_path": "/workspace/repo"
  },
  {
    "type": "memory_store",
    "memory_store_id": "memstore_abc123",
    "access": "read_write",
    "instructions": "Use this for durable project notes."
  }
]
```

Only `user.*` events can be appended by clients:

```bash
curl -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/events \
  -H "Content-Type: application/json" \
  -d '{
    "events": [
      {
        "type": "user.message",
        "content": [{ "type": "text", "text": "Hello" }]
      }
    ]
  }'
```

Send and stream a message:

```bash
curl -N -X POST http://127.0.0.1:3000/v1/sessions/SESSION_ID/messages \
  -H "Content-Type: application/json" \
  -d '{"content": "Hello", "stream": true}'
```

Resume the event stream:

```bash
curl -N http://127.0.0.1:3000/v1/sessions/SESSION_ID/events/stream \
  -H "Last-Event-ID: EVENT_ID"
```

## Files

Files can be uploaded once and mounted into sessions.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/files` | List active files. |
| `POST` | `/v1/files` | Upload a file. |
| `GET` | `/v1/files/{file_id}` | Retrieve file metadata and preview. |
| `GET` | `/v1/files/{file_id}/content` | Download file content. |
| `DELETE` | `/v1/files/{file_id}` | Archive a file. |

Multipart upload:

```bash
curl -X POST http://127.0.0.1:3000/v1/files \
  -F "file=@notes.txt"
```

JSON upload:

```bash
curl -X POST http://127.0.0.1:3000/v1/files \
  -H "Content-Type: application/json" \
  -d '{
    "name": "notes.txt",
    "media_type": "text/plain",
    "content": "hello",
    "encoding": "utf8"
  }'
```

The per-file upload limit is 10 MB.

## Skills

Skills are reusable instruction packages. See [Skills](skills.md) for package
format and upload rules.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/skills` | List skills. |
| `POST` | `/v1/skills` | Upload a skill package. |
| `GET` | `/v1/skills/{skill_id}` | Retrieve a skill. |
| `DELETE` | `/v1/skills/{skill_id}` | Delete a custom skill. |

List query parameters:

| Parameter | Purpose |
| --- | --- |
| `limit` | Page size, maximum 100. |
| `page` | Cursor from `next_page`. |
| `source` | `custom` or `anthropic`. |

Upload:

```bash
zip -r code-review-assistant.zip code-review-assistant

curl -X POST http://127.0.0.1:3000/v1/skills \
  -F "files=@code-review-assistant.zip"
```

Skill list responses include `next_page` in addition to the common page fields.

## Environments

Environments describe where sessions run.
Environment names are human-readable labels and do not need to be unique. Use
the returned `env_...` id when creating sessions or updating an environment.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/environments` | List environments. |
| `POST` | `/v1/environments` | Create an environment. |
| `GET` | `/v1/environments/{environment_id}` | Retrieve an environment. |
| `PUT` | `/v1/environments/{environment_id}` | Update an environment. |
| `POST` | `/v1/environments/{environment_id}/archive` | Archive an environment. |

Create:

```bash
curl -X POST http://127.0.0.1:3000/v1/environments \
  -H "Content-Type: application/json" \
  -d '{
    "name": "local-dev",
    "description": "Local development environment",
    "hosting_type": "self_hosted",
    "sandbox_provider": "local",
    "network": {
      "type": "limited",
      "allow_mcp_server_network_access": false,
      "allow_package_manager_network_access": true,
      "allowed_hosts": []
    },
    "packages": []
  }'
```

## Credential Vaults

Credential vaults group secrets that sessions can attach by id.
Vault names are human-readable labels and do not need to be unique. Use the
returned `vlt_...` id when attaching a vault to a session.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/credential-vaults` | List vaults. |
| `POST` | `/v1/credential-vaults` | Create a vault. |
| `GET` | `/v1/credential-vaults/{vault_id}` | Retrieve a vault. |
| `POST` | `/v1/credential-vaults/{vault_id}/archive` | Archive a vault. |
| `GET` | `/v1/credential-vaults/{vault_id}/credentials` | List credentials. |
| `POST` | `/v1/credential-vaults/{vault_id}/credentials` | Add a credential. |
| `POST` | `/v1/credential-vaults/{vault_id}/credentials/{credential_id}/archive` | Archive a credential. |
| `DELETE` | `/v1/credential-vaults/{vault_id}/credentials/{credential_id}` | Delete a credential. |

Credential `auth_type` values:

- `mcp_oauth`
- `bearer_token`
- `environment_variable`

Add a credential:

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

Secret values are encrypted at rest. Responses return `value_hint`, not the raw
secret.

## Memory Stores

Memory stores persist named memory entries that can be mounted into sessions.
Memory store names are human-readable labels and do not need to be unique.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/memory_stores` | List memory stores. |
| `POST` | `/v1/memory_stores` | Create a memory store. |
| `GET` | `/v1/memory_stores/{store_id}` | Retrieve a memory store. |
| `POST` | `/v1/memory_stores/{store_id}/archive` | Archive a memory store. |
| `GET` | `/v1/memory_stores/{store_id}/memories` | List memories. |
| `POST` | `/v1/memory_stores/{store_id}/memories` | Add a memory. |
| `PUT` | `/v1/memory_stores/{store_id}/memories/{memory_id}` | Update a memory. |
| `DELETE` | `/v1/memory_stores/{store_id}/memories/{memory_id}` | Delete a memory. |

Create a memory:

```bash
curl -X POST http://127.0.0.1:3000/v1/memory_stores/STORE_ID/memories \
  -H "Content-Type: application/json" \
  -d '{
    "path": "/notes/release",
    "content": "Keep release notes concise."
  }'
```

Memory paths must start with `/` and must not end with `/`.

## Runtime Extension Endpoints

Extension endpoints expose local runtime operations.

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/v1/x/health` | Health check. |
| `GET` | `/v1/x/runtime` | Runtime status. |
| `GET` | `/v1/x/workspace` | Workspace paths and metadata. |
| `GET` | `/v1/x/settings` | Read the versioned Settings V2 runtime document. |
| `POST` | `/v1/x/settings/validate` | Validate a complete Settings V2 document without saving. |
| `POST` | `/v1/x/settings/test` | Test one settings area without saving. |
| `PUT` | `/v1/x/settings` | Save a validated Settings V2 document. |
| `GET` | `/v1/x/templates` | Built-in agent templates. |
| `POST` | `/v1/x/reload` | Reload file-backed agents. |
| `POST` | `/v1/x/restart` | Restart the local runtime process when the server was started through the CLI. |
| `GET` | `/v1/x/logs?limit=200&level=info&q=term` | Recent in-process structured runtime logs. |
| `GET` | `/v1/x/metrics` | Prometheus metrics, when enabled. |
| `GET` | `/v1/x/mcp/status?session_id=...` | MCP connection status for a session. |

`GET /v1/x/runtime` returns runtime-safe introspection data. Model entries expose
configuration metadata only:

```json
{
  "type": "runtime",
  "status": "running",
  "models": [
    {
      "name": "local",
      "provider": "openai",
      "model": "gpt-4o",
      "api_key_state": "configured",
      "base_url_state": "not_set"
    }
  ],
  "auth_enabled": true
}
```

The runtime never returns raw API keys or resolved secret values to the Console.

Settings V2 is the source of truth for model vendor, loop engine, storage,
memory, and sandbox configuration. Responses include both the saved document and
the effective document currently used by the process. Response excerpt:

```json
{
  "schema_version": 1,
  "revision": 2,
  "effective_revision": 1,
  "saved_config": {
    "schema_version": 1,
    "model": {
      "vendor": "openai",
      "base_url": "https://api.openai.com/v1",
      "api_key": "********",
      "options": {}
    }
  },
  "effective_config": {},
  "restart_required": true,
  "activation_status": "pending",
  "activation_errors": [],
  "diagnostics": {
    "metadata": {
      "path": ".managed-agents/data.db",
      "health": "ok"
    }
  },
  "secret_states": {
    "model": {
      "api_key": "configured"
    }
  },
  "adapters": {
    "loop_engine": [
      {
        "id": "builtin",
        "label": "Default",
        "status": "available",
        "restart_policy": "runtime",
        "options_schema": {
          "type": "object",
          "properties": {
            "default_max_steps": {
              "type": "integer",
              "minimum": 1,
              "maximum": 1000,
              "default": 25
            }
          },
          "additionalProperties": true
        }
      }
    ]
  }
}
```

Secret-looking adapter option keys, including `api_key`, `access_key`,
`secret`, `token`, `password`, and `credential`, are always masked in public
settings responses.
Adapter descriptors include backend-owned `options_schema` metadata for
adapter-specific options.

The Dashboard validates a changed candidate before enabling save, and API
clients should follow the same sequence: `GET /v1/x/settings`, edit the complete
document, `POST /v1/x/settings/validate`, optionally `POST /v1/x/settings/test`,
then `PUT /v1/x/settings` with the current `revision`. A successful save updates
`saved_config` and sets `restart_required` when the running process still uses
the older `effective_config`. The next CLI-managed restart promotes the last
valid saved revision to `effective_config`. If a saved row is corrupted outside
the API, startup keeps the last valid effective document instead of activating
the bad candidate and returns `activation_status: "failed"` with
`activation_errors` on subsequent settings reads until the saved document is
repaired.

Validate a candidate document:

```bash
curl -X POST http://127.0.0.1:3000/v1/x/settings/validate \
  -H "Content-Type: application/json" \
  -d @settings.json
```

Test one area without saving:

```bash
curl -X POST http://127.0.0.1:3000/v1/x/settings/test \
  -H "Content-Type: application/json" \
  -d '{
    "area": "storage.artifacts",
    "config": {
      "provider": "local",
      "options": {
        "base_path": "files"
      }
    }
}'
```

Model tests apply the same credential validation used by validate and save.
Other area tests are scoped to their adapter so local storage, memory, and
sandbox diagnostics can run before a model API key has been configured.
Those scoped checks still validate credentials that belong to the tested area.
Registered non-local sandbox providers return a skipped live-health check until
their provider-specific health checks are implemented.

Save the complete document with optimistic concurrency:

```bash
curl -X PUT http://127.0.0.1:3000/v1/x/settings \
  -H "Content-Type: application/json" \
  -d '{
    "revision": 2,
    "config": {
      "schema_version": 1,
      "model": {
        "vendor": "openai",
        "api_key": "${OPENAI_API_KEY}",
        "options": {}
      },
      "loop_engine": {
        "provider": "builtin",
        "options": {
          "default_max_steps": 25
        }
      },
      "storage": {
        "metadata": {
          "provider": "sqlite",
          "options": {}
        },
        "artifacts": {
          "provider": "local",
          "options": {
            "base_path": "files"
          }
        }
      },
      "memory": {
        "enabled": true,
        "provider": "sqlite",
        "options": {}
      },
      "sandbox": {
        "provider": "local",
        "options": {
          "timeout_seconds": 300
        }
      }
    }
  }'
```

Literal secrets are encrypted at rest. API responses return masked placeholders
and `secret_states`; they never return plaintext or ciphertext.

Successful saves emit a `runtime_settings_saved` structured log with only the
old revision, new revision, changed JSON paths, and restart flag. Secret values
and internal managed-secret references are not logged.

`GET /v1/x/logs` returns a standard page envelope with the most recent log
entries captured by the current process. `level` is a minimum severity filter
(`debug`, `info`, `warn`, or `error`), and `q` searches the rendered log line.
The in-memory buffer is intended for local operations and is reset when the
runtime restarts.

`POST /v1/x/restart` schedules a local runtime restart and returns:

```json
{
  "restarting": true,
  "status": "scheduled"
}
```

Embedded test servers or custom hosts that do not provide a restart hook return
`501 unsupported`. When available, restart stops accepting requests, drains the
session manager, closes SQLite, and starts a new process with the same command
line arguments.
