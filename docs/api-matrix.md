# Versioned API Matrix

This matrix tracks the public `/v1` API shape for the open-source runtime. It
is a compatibility guide for SDK authors and integrators; it is not a promise
that every Claude hosted capability exists locally.

## Version Policy

- The current public namespace is `/v1`.
- Resource ids are opaque.
- Collection responses use `{ data, has_more, first_id, last_id }`.
- Errors use `{ error: { type, message } }`.
- Optional Claude-style beta headers are accepted locally for compatibility
  tests, but local behavior is controlled by this repository.

## `/v1` Resource Matrix

| Area | Endpoint group | Status | Notes |
| --- | --- | --- | --- |
| Agents | `/v1/agents` | Supported | Create, list, retrieve, update, archive, and list versions. |
| Sessions | `/v1/sessions` | Supported | Create, list, retrieve, stop, delete/archive, event ingestion, event listing, SSE stream, and message convenience endpoint. |
| Session artifacts | `/v1/sessions/{id}/artifacts` | Supported | Create/list artifact records and fetch content. |
| Files | `/v1/files` | Supported | Upload/list/retrieve/delete workspace files and fetch content. |
| Environments | `/v1/environments` | Supported | Create/list/retrieve/update/archive environment templates. |
| Environment worker keys | `/v1/environments/{id}/worker-keys` | Advanced | Create/list/revoke scoped self-hosted worker keys; not needed for the default local runtime. |
| Environment work queue | `/v1/environments/{id}/work-items` | Advanced | Inspect recent queued self-hosted work and queue stats; not needed for the default local runtime. |
| Credential vaults | `/v1/credential_vaults` | Supported | Create/list/retrieve/update/archive/delete vaults. |
| Vault credentials | `/v1/credential_vaults/{id}/credentials` | Supported | Create/list/update/delete credentials with secret redaction. |
| Credential audit | `/v1/credential_vaults/{id}/audit` | Supported | Lists rotation/use/audit metadata events. |
| Memory stores | `/v1/memory_stores` | Supported | Create/list/retrieve/update/archive/delete stores. |
| Memory records | `/v1/memory_stores/{id}/memories` | Supported | Create/list/update/delete memory records with size/hash metadata. |
| Skills | `/v1/skills` | Supported | List built-in/custom skills and upload validated custom ZIPs. |
| API keys | `/v1/api-keys` | Supported | List/create/delete managed keys; config/env keys are read-only. |
| Webhooks | `/v1/webhooks` | Advanced | Create/list/update/archive, test deliveries, attempts, and retry due deliveries. Not needed for the first local run. |
| Scheduled deployments | `/v1/scheduled-deployments` | Advanced | Create/list/update/archive/pause/unpause/run/run-due schedules. Not needed for the first local run. |
| Outcomes | `/v1/outcomes` and `/v1/sessions/{id}/outcomes` | Advanced | Create/list/update/archive outcomes and evaluate sessions. Not needed for the first local run. |
| Runtime settings | `/v1/x/settings` | Supported | Read/patch/validate canonical runtime settings for one active model provider boundary, loop engine, metadata store, artifact store, memory backend, and sandbox backend. |
| Runtime operations | `/v1/x/health`, `/v1/x/logs`, `/v1/x/metrics`, `/v1/x/metrics/summary`, `/v1/x/restart` | Supported | Health, logs, Prometheus-style metrics, summary cards, and local restart hook. |
| Worker queue | `/v1/x/worker/claim`, `/v1/x/worker/complete` | Advanced | Used by `managed-agents worker poll` when running a self-hosted worker. |
| Custom client tools | Session events and SDK helpers | Partial | Custom tool result submission is supported; first-class tool registration/discovery is planned. |
| Hosted cloud deployment | N/A | Missing | The open-source runtime runs locally or in user-owned infrastructure. |

## SDK Coverage

| SDK resource | Coverage |
| --- | --- |
| `client.agents` | list, get, create, update, versions, archive |
| `client.sessions` | create, get, list, events, send event, message, chat, tail, artifacts, create artifact, artifact text, stop, delete, interrupt, approve/deny tool, submit custom tool result |
| `client.files` | list, get, create, text, delete |
| `client.apiKeys` | list, create, delete |
| `client.metrics` | Prometheus text and runtime summary |
| `client.settings` | get, patch, validate canonical runtime settings |
| `client.environments` | list, get, create, update, archive, worker keys, create/revoke worker key |

## CLI Coverage

| CLI group | Coverage |
| --- | --- |
| `managed-agents init/start/list/reload/chat` | Core local lifecycle and chat workflows. |
| `managed-agents session ...` | Create, message, tail, inspect, and logs. |
| `managed-agents worker poll` | Advanced self-hosted environment worker queue execution. |
| `managed-agents settings ...` | Get, set model boundary, and validate canonical runtime settings. |
| `managed-agents environments ...` | List, inspect, create, update, archive, and list worker keys. |
| `managed-agents workspace ...` | Create, open/register, list, resolve, and remove local workspace registry entries. |
| `managed-agents template ...` | List, install, and create templates. |

## Compatibility Gaps To Track

- Client-side custom tools need named registration/discovery above the current
  event result protocol.
- Desktop workspace switching still needs a process manager; the CLI registry
  supplies the durable workspace index.
- Additional sandbox provider packages should be separated from the core once
  provider contracts stabilize.
- Historical provider CRUD endpoints, the old `client.modelProviders` SDK
  helper, and the old `managed-agents models ...` CLI command have been
  removed from the v1 public surface. The canonical v1 path is
  `/v1/x/settings`.
- Browser Dashboard smoke tests require an environment that allows binding a
  local HTTP port.
