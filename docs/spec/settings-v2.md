# Settings V2 Specification

Status: Implemented, active iteration
Target: managed-agents local runtime and Dashboard
Primary surface: `/dashboard#settings`

## 1. Purpose

Settings V2 defines one truthful, validated configuration system for the local
runtime and Dashboard. It replaces the current mixture of YAML bootstrap
configuration, SQLite provider records, read-only selects, and provider rows
that are not connected to runtime behavior.

The design has four goals:

1. Every setting shown as editable must affect the runtime.
2. Every saved configuration must be validated before it becomes active.
3. The Dashboard form and the JSON editor must edit the same document.
4. New implementations can be added through adapter registries without
   changing the top-level configuration shape.

Settings V2 does not imply that every planned adapter is implemented. An
adapter may be `available`, `unavailable`, or `invalid`. The UI must never show
an unavailable adapter as if it can be activated.

## 2. Product model

The workspace owns one active runtime configuration.

| Area | Cardinality | Selection model |
| --- | --- | --- |
| Model | One active vendor | Select one installed model adapter |
| Loop engine | One active engine | Select one installed loop adapter |
| Metadata storage | One active backend | Select one installed metadata adapter |
| Artifact storage | One active backend | Select one installed artifact adapter |
| Memory | One active backend | Select one installed memory adapter; may be disabled |
| Sandbox | One default backend plus Environment overrides | Select one installed sandbox adapter |

“One active” means the workspace has one effective choice at a time. It does
not prevent the codebase from registering multiple adapter implementations.

Agent definitions and Environments may still contain scoped overrides where
the runtime supports them. In particular, an Environment may override the
workspace default sandbox.

## 3. Source of truth

The effective configuration is stored as one versioned JSON document in
SQLite. YAML remains a portable bootstrap/import format, but it is not a
second mutable source of truth after workspace initialization.

Recommended table:

```sql
CREATE TABLE runtime_settings (
  id TEXT PRIMARY KEY CHECK (id = 'default'),
  schema_version INTEGER NOT NULL,
  config TEXT NOT NULL,
  effective_config TEXT NOT NULL,
  revision INTEGER NOT NULL DEFAULT 1,
  effective_revision INTEGER NOT NULL DEFAULT 1,
  restart_required INTEGER NOT NULL DEFAULT 0,
  activation_status TEXT NOT NULL DEFAULT 'active',
  activation_errors TEXT NOT NULL DEFAULT '[]',
  created_at TEXT NOT NULL DEFAULT (datetime('now')),
  updated_at TEXT NOT NULL DEFAULT (datetime('now'))
);
```

The runtime must expose both:

- `saved_config`: the last valid document saved by the user;
- `effective_config`: the configuration currently used by the process.

If a change requires restart, `saved_config` may differ from
`effective_config`, and `restart_required` must be true.

## 4. Configuration document

Initial schema version: `1`.

```json
{
  "schema_version": 1,
  "model": {
    "vendor": "openai",
    "base_url": "https://api.openai.com/v1",
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
```

Unknown top-level keys are rejected. Adapter-specific fields belong under
`options`. This keeps the stable schema small while allowing adapters to own
their detailed configuration.

### 4.1 Secrets

The API accepts a secret value or an environment placeholder. Responses never
return a stored secret. They return a state such as `configured`,
`missing_env`, or `not_set`.

Literal secrets must be encrypted at rest with the existing AES-GCM secret
facility. JSON returned by GET endpoints must contain a masked placeholder,
not ciphertext or plaintext.

The first implementation treats `model.api_key` and nested `options` keys
whose final segment contains a secret-looking token such as `api_key`,
`access_key`, `secret`, `token`, `password`, or `credential` as secrets.
Literal values are stored in
`runtime_settings_secrets` by complete JSON path and the configuration document
stores only an internal reference. `${ENV_NAME}` references remain in the
document. `********` preserves an existing value; omitting a secret removes it.
Secret mutation and revision update occur in one transaction. GET, validate,
save, and test responses must mask every recognized secret key with the same
path-matching rule, including `access_key`; internal managed-secret references
are never part of the public API. If a managed-secret reference appears during
validation, it is valid only when it points to the same JSON path and a stored
secret exists at that path. While a restart-required revision is pending,
secrets referenced by either `saved_config` or `effective_config` must be kept;
after activation, unreferenced Settings secrets are removed. Future adapter
schemas should replace name-based discovery with an explicit secret annotation
while preserving these wire semantics.

## 5. Adapter contract

Each configurable area uses a registry of adapters. The initial contract is:

```ts
interface SettingsAdapter<TOptions> {
  readonly id: string;
  readonly label: string;
  readonly version: string;
  readonly status: 'available' | 'unavailable' | 'invalid';
  readonly restartPolicy: 'none' | 'runtime';

  describe(): AdapterDescriptor;
  validate(options: unknown): ValidationResult<TOptions>;
  test?(options: TOptions): Promise<ConnectionTestResult>;
  initialize?(options: TOptions): Promise<InitializeResult>;
}
```

Runtime adapters additionally implement the interface required by their
subsystem, for example `MemoryProvider`, `SandboxProvider`, or
`AgentStrategy`.

An adapter descriptor contains a JSON Schema for its `options`. The Dashboard
may render a friendly form from known fields, but the backend is always the
authority for validation.

## 6. Area specifications

### 6.1 Model

The workspace configures one model vendor, not a list of models.

Initial vendors:

- `openai`
- `anthropic`
- `openai_compatible`

The user-facing form contains:

- Vendor
- Base URL when the vendor supports or requires it
- API key
- Advanced JSON options
- Validate button

There is no required Model ID field in Settings. The selected vendor adapter
owns its default model behavior. If an adapter needs extra routing details,
they live in `model.options` and must have documented defaults. Agent-level
model selection is outside Settings V2 and must not reintroduce a workspace
provider list.

Validation checks:

- vendor adapter exists and is available;
- URL format and protocol are valid;
- required credential is configured or resolves from the environment;
- optional live validation can authenticate against the vendor endpoint.

### 6.2 Loop engine

The workspace has one active loop engine.

Planned engine identifiers:

- `builtin`: current managed-agents `DefaultStrategy`;
- `harness`: future harness-based execution adapter;
- `codex`: future Codex execution adapter;
- `claude`: future Claude execution adapter.

Only `builtin` is available in the first implementation. Other engines may be
listed in an adapter capability response as unavailable, but they must not be
selectable or savable.

The built-in form contains:

- Provider
- Default max steps
- Advanced JSON options
- Validate button

Agent `max_turns` overrides `default_max_steps`. The engine registry replaces
the direct `new DefaultStrategy()` construction at startup.

Changing engine provider requires a runtime restart. Invalid engine settings
must never replace the current effective engine.

### 6.3 Storage

Storage is displayed as two flat sections on one page. It is not displayed as
a provider table and does not have an “Add provider” action.

#### Metadata storage

Purpose: agents, sessions, event log, settings, API keys, and other runtime
metadata.

Initial adapter:

- `sqlite`: available and active.

Future adapters:

- `postgres`
- `mysql`

The SQLite form displays the resolved database path and health status. It does
not ask the user to initialize a database that migrations already initialized.

Changing metadata storage is a migration operation, not a normal hot setting.
The first Settings V2 release therefore treats SQLite as editable JSON with a
fixed provider value. External adapters must not be enabled until migration,
transaction, backup, and rollback behavior exists.

#### Artifact storage

Purpose: uploaded files, generated artifacts, snapshots, and future large
binary outputs.

Initial adapter:

- `local`: available.

Future adapter:

- `s3`

The local form contains the base path. The S3 form is exposed only after the
S3 adapter performs real reads, writes, deletes, and connection validation.

Storage validation checks path safety, writability, connection details, and
adapter availability. Literal access keys and secret keys are encrypted.

### 6.4 Memory

Memory is one extensible context-memory backend. It is separate from the
Memory Stores resource page.

Planned adapters:

- `sqlite`: available first;
- `memu`: available only after a real adapter is installed;
- `mem0`: available only after a real adapter is installed.

The form contains:

- Enabled
- Provider
- Provider-specific fields
- Advanced JSON options
- Validate or Check configuration button

When disabled, the runtime does not retrieve or extract long-term context.
When enabled, the selected adapter is injected into `ContextBuilder`.
Credential validation for memory adapter options runs only while memory is
enabled, so stale credentials for a disabled backend do not block saving the
workspace configuration.

Changing memory provider requires a runtime restart in the initial release.
Future hot swapping may be added only after in-flight session behavior is
defined.

### 6.5 Sandbox

Sandbox supports multiple adapter implementations but one workspace default.

Planned adapters:

- `local`
- `docker`
- `remote`

The workspace setting is the fallback. `Environment.sandbox_provider` may
override it for a session.

The form contains:

- Default provider
- Timeout
- Provider-specific options
- Validate button
- Link to Environments

Validation examples:

- Local: data directory is writable;
- Docker: Docker is installed, daemon is reachable, and image is valid;
- Remote: endpoint and credentials are valid and a health check succeeds.

Adapter descriptors distinguish `available` and `unavailable`. Capability
checks report `ok`, `failed`, or `skipped`; a failed connection check does not
change whether an installed adapter is selectable.

## 7. API

### 7.1 Read configuration

`GET /v1/x/settings`

Returns:

```json
{
  "schema_version": 1,
  "revision": 4,
  "effective_revision": 3,
  "saved_config": {},
  "effective_config": {},
  "restart_required": true,
  "activation_status": "pending",
  "activation_errors": [],
  "diagnostics": { "metadata": { "path": ".../data.db", "health": "ok" } },
  "adapters": {},
  "secret_states": {}
}
```

Each adapter descriptor returned under `adapters` contains `id`, `label`,
`version`, `status`, `restart_policy`, and an `options_schema` JSON Schema.
`invalid` is reserved for runtime-reported providers that Settings V2 does
not recognize, so the Dashboard can show and disable the mismatch instead of
silently hiding it.
The first-release UI renders known controls directly, but this schema remains
the backend-owned contract for adapter-specific options.

### 7.2 Validate configuration

`POST /v1/x/settings/validate`

Request contains a complete candidate document. Validation does not persist
or activate it.

Response contains normalized configuration plus field-level errors:

```json
{
  "valid": false,
  "normalized_config": {},
  "errors": [
    {
      "path": "memory.options.api_key",
      "code": "missing_env",
      "message": "MEM0_API_KEY is not set"
    }
  ],
  "warnings": []
}
```

### 7.3 Test an adapter

`POST /v1/x/settings/test`

The request identifies one area and contains a candidate area configuration.
It performs a bounded connection or capability check without saving.

Implemented request shape:

```json
{
  "area": "model",
  "config": {},
  "full_config": {}
}
```

`area` is one of `model`, `loop_engine`, `storage.metadata`,
`storage.artifacts`, `memory`, or `sandbox`. `full_config` is optional; when
omitted, the server merges `config` into the current saved document before
validation. The first implementation performs local capability checks only:
credential resolution, URL shape, SQLite quick check, local artifact
writability, memory enablement, and local sandbox data-dir writability. It
does not perform live vendor authentication against OpenAI, Anthropic, S3,
Docker, mem0, or MemU until those adapters are real runtime implementations;
registered non-local sandbox providers return a skipped live-health check.
Model checks run the same credential validation as save/validate for the model
area. Non-model area checks are scoped to their own adapter so storage, memory,
and sandbox diagnostics can still run in a workspace whose model credential has
not been configured yet; they still validate credentials that belong to the
tested area.

### 7.4 Save configuration

`PUT /v1/x/settings`

Requirements:

- complete document, not a partial patch;
- `If-Match` or revision field for optimistic concurrency;
- server-side validation before transaction commit;
- secret merge semantics so a masked secret does not overwrite the stored
  value;
- audit event recording old revision, new revision, and changed paths;
- response indicates whether restart is required.

Invalid configuration returns `422`. Revision conflict returns `409`.

### 7.5 Restart

The existing restart endpoint applies saved settings. After a successful
restart, saved and effective revisions match and `restart_required` becomes
false.

All Settings V2 fields use `restartPolicy = runtime` in schema version 1. A
save therefore always creates a pending revision. Hot activation must not be
introduced until in-flight session behavior and path-level activation results
are defined.

If the saved document cannot be parsed, fails schema validation, selects a
schema-valid but unavailable adapter, or contains a required credential that no
longer resolves at startup, the runtime keeps the last valid effective
document and reports `activation_status = failed`, `activation_errors`, the
saved `revision`, and the older `effective_revision`. The pending document is
retained for diagnosis and repair; it is never copied over the effective
document.
Activation uses the providers registered by the current process. For example,
a saved Docker sandbox default is not promoted unless Docker was actually
registered in the runtime sandbox registry for that startup.

## 8. Dashboard UX

Settings keeps a Codex-style secondary vertical menu:

- Models
- Loop engine
- Storage
- Memory
- Sandbox
- API keys
- API reference
- Logs
- Monitoring

Each configurable page has two editing modes over the same state:

1. `Form`: focused controls for common fields;
2. `JSON`: the current page's configuration section using a code editor.

The backend stores and validates one complete versioned runtime settings
document, but the Console projects that document into page-level sections:
`model`, `loop_engine`, `storage`, `memory`, and `sandbox`. Saving from a page
merges only that section back into the complete document.

Required actions:

- Validate
- Check configuration when supported
- Save
- Discard changes
- Restart runtime when required

Save remains disabled until the candidate is changed and valid. Validation
errors are shown both next to form fields and as JSON paths.

Storage is one page with Metadata storage followed by Artifact storage. Memory
is one backend configuration, not a table. Loop engine is one engine
configuration, not a plugin card grid. Sandbox is one default configuration
plus an adapter availability summary.

Unavailable adapters use neutral explanatory text. They are not selectable,
and the UI does not render fake configuration forms for them.

## 9. Migration

Settings V2 is introduced with an additive migration.

1. Create `runtime_settings`.
2. Seed the single document from the effective legacy configuration:
   - first/default model row becomes `model`;
   - current `DefaultStrategy` becomes `loop_engine.provider = builtin`;
   - actual runtime database becomes `storage.metadata = sqlite`;
   - actual files directory becomes `storage.artifacts = local`;
   - YAML memory configuration becomes `memory`;
   - default Environment sandbox becomes the workspace sandbox fallback.
3. Keep legacy provider tables readable during one compatibility period.
4. Stop writing `memory_providers` and `storage_providers` from the Dashboard.
5. Remove legacy endpoints only after the new API and UI are stable.

Migration must prefer actual runtime wiring over records that were previously
saved but never connected to runtime behavior.

## 10. Delivery plan and status

### Phase 1: schema and validation

- [x] Define Zod schemas for the top-level document and built-in adapter
  options.
- [x] Implement adapter descriptors and availability reporting.
- [x] Add `runtime_settings` migration and legacy seed logic.
- [x] Implement read and validate APIs.
- [x] Add encrypted secret serialization.

Exit criteria: a candidate JSON document can be validated with field-level
errors, and existing workspaces produce a correct effective document.

### Phase 2: runtime wiring

- [x] Create settings-driven model, memory, artifact storage, and sandbox
  composition helpers.
- [x] Keep the built-in loop engine as the single implemented engine while
  making its default step limit configurable.
- [x] Replace direct model and memory construction with settings-driven
  factories.
- [x] Make workspace sandbox the fallback while preserving Environment
  overrides.
- [x] Report saved/effective revisions and restart requirements.
- [x] Implement save and adapter test APIs for implemented adapters.

Exit criteria: changing every available setting changes observable runtime
behavior after the documented activation step.

### Phase 3: Dashboard

- [x] Replace the current model list with one vendor form.
- [x] Replace Loop engine plugin cards with one engine form.
- [x] Flatten Storage into Metadata and Artifact sections.
- [x] Replace Memory provider table with one backend form.
- [x] Replace Sandbox fake selects with one default form and capability summary.
- [x] Add Form/JSON modes, validation results, dirty state, restart banner, and
  validate-before-save gating.
- [x] Keep unavailable adapters visible only as neutral, disabled capability
  descriptors.

Exit criteria: no page offers an action that the backend cannot perform.

### Phase 4: cleanup and compatibility

- [x] Deprecate legacy provider write endpoints.
- [x] Remove stale unrendered Dashboard provider components from `App.tsx`.
- [x] Remove legacy provider arrays from the Console page-state model.
- [x] Update README, installation, usage, API, and configuration documentation.
- [x] Add upgrade notes for workspaces created before Settings V2.

Compatibility decision: legacy provider `GET` endpoints remain readable for
one release so older clients can inspect existing rows. Legacy provider
mutation endpoints return `410 Gone` and point callers to `/v1/x/settings`.

Deferred compatibility/future backlog:

- Add real non-local adapters only after their runtime implementations exist.
- Continue Claude/Codex visual polish after behavior remains stable.
- Remove legacy read endpoints after the compatibility window ends.

Upgrade note for existing workspaces: existing YAML model entries and legacy
provider rows are treated as bootstrap/import data only. On first Settings V2
startup, the runtime seeds the single `runtime_settings` document from the
actual effective local runtime: default model vendor, built-in loop engine,
SQLite metadata, local artifact storage, configured memory enablement, and the
default Environment sandbox. After that seed, normal Dashboard edits persist to
SQLite under the user data directory and do not rewrite source-controlled YAML.

## 11. Test plan

### Unit tests

- Top-level and adapter option schema validation.
- Unknown key rejection and normalized defaults.
- Secret masking, encryption, environment resolution, and merge behavior.
- Adapter registry availability and duplicate ID handling.
- Agent max-turn override over engine default.
- Environment sandbox override over workspace default.

### Migration tests

- New database receives the expected Settings V2 document.
- Existing model, memory, storage, and Environment records seed correctly.
- Fake legacy provider rows do not override actual runtime wiring.
- Migration is idempotent and preserves existing resources.

### API integration tests

- Read, validate, test, save, revision conflict, and restart-required flows.
- Invalid adapter and unavailable adapter rejection.
- Literal and environment-backed secret behavior.
- Saved/effective revision behavior across runtime restart.
- Settings save audit log includes old revision, new revision, changed paths,
  and never includes secret values.
- No secret is returned by any API.

### Runtime integration tests

- Selected model vendor creates the expected model adapter.
- Built-in loop receives configured default max steps.
- SQLite memory enabled/disabled changes retrieval and extraction behavior.
- Local artifact storage writes into the configured safe base path.
- Workspace sandbox fallback and Environment override select the correct
  provider.
- Invalid saved configuration cannot prevent startup; runtime retains the last
  valid effective revision and reports the error.

### Dashboard tests

- Form edits update the current section JSON and section JSON edits update form
  fields after validation.
- Invalid JSON and field errors prevent save.
- Select controls open above cards and drawers.
- Storage sections are vertically flattened without horizontal scrolling.
- Memory and Loop engine never render provider tables.
- Unavailable adapters cannot be selected.
- Default saveable availability includes only implemented adapters; planned
  adapters may appear only as unavailable capability descriptors.
- Restart banner appears and clears after restart.
- Layout is verified at desktop, medium, and narrow viewport widths.

### Manual smoke sequence

1. Start with a temporary data directory.
2. Open every Settings subsection.
3. Validate the default configuration.
4. Save a built-in engine option change and confirm restart is required.
5. Restart and verify the effective revision changes.
6. Toggle SQLite memory and verify a session with `context_id` changes memory
   behavior.
7. Change the local artifact base path and upload/read/delete a file.
8. Create an Environment that overrides the default sandbox and run a tool.
9. Confirm logs and audit data record settings changes without secret values.

### Schema-version compatibility

The runtime accepts schema version `1` only. A document with an unknown newer
version is rejected and must not replace the effective document. Future schema
versions require an explicit, idempotent document migration that runs before
adapter validation, preserves secret references by JSON path, and records the
result as a new revision. Downgrade startup keeps the last readable effective
revision and reports an activation error instead of rewriting newer data.

## 12. Non-goals for the first release

- Multiple active model vendors.
- Multiple simultaneous loop engines.
- Hot switching engine or memory adapters during an in-flight session.
- Postgres/MySQL metadata migration.
- S3 artifact storage before a complete adapter exists.
- mem0 or MemU selection before their adapters exist.
- A visual workflow builder.

## 13. Architecture review and delivery priorities

Review date: 2026-07-16

The first Settings V2 implementation establishes the configuration document,
validation API, encrypted Settings secret storage, and the Dashboard editing
surface. It is intentionally not the final runtime cutover. Until the items
below are complete, the Dashboard must describe availability accurately and
must not imply that a planned adapter is active.

### 13.1 Current effective-behavior matrix

| Area | Current behavior | Required before claiming full support |
| --- | --- | --- |
| Model | Runtime ModelRegistry is constructed from effective Settings V2. Vendor adapters own internal default model IDs. | Add optional live credential tests before claiming remote vendor health. |
| Loop engine | `builtin` default max steps is applied by the executor through the runtime loop-engine bootstrap helper. Planned engines are unavailable. | Add real adapters before enabling non-builtin engines. |
| Metadata storage | SQLite is the real metadata store. | Add a migration/backup/rollback contract before exposing external databases. |
| Artifact storage | Local artifact path is resolved from effective Settings V2 through a shared `ArtifactStore`, used by File resources and snapshots. | Add generated artifact consumers and a real S3 implementation before exposing S3 as selectable. |
| Memory | SQLite enable/disable is wired and locally testable. mem0 and MemU are unavailable. | Add real adapters before making either selectable. |
| Sandbox | The workspace setting is used as the `env_default` fallback; named Environments override it. Local, Docker, and remote/self-hosted providers are selectable only when registered by the current runtime; local writability is testable. | Add Docker daemon/image and remote endpoint health checks before claiming live connection validation for those providers. |

### 13.2 Findings

1. **Single source of truth is now Settings V2 for shipped runtime settings.**
   The Dashboard no longer loads legacy memory-provider or storage-provider
   data into its page state. Legacy provider mutation endpoints are read-only
   compatibility failures (`410`) and no new Dashboard writes may be added.
2. **Model vendor needs an adapter-owned resolved model.** Settings must not
   ask for a Model ID, but a concrete provider request still needs one. Each
   shipped vendor adapter therefore owns a versioned default mapping and
   reports the resolved model as read-only diagnostics.
3. **Security boundaries are mostly closed for local-first use.** Local shell
   commands receive an allowlisted environment only. Self-hosted workers may
   complete only work they claimed. CORS no longer defaults to `*`; same-origin
   and local loopback origins are allowed by default, and deployment origins
   must be explicitly configured. API credentials use the single SecretStore
   for Settings V2 secrets; legacy read-only provider tables remain only for
   compatibility inspection.
4. **The rendered Console is honest for Settings V2.** Settings pages use the
   Settings V2 editor, old provider mutation surfaces are removed from
   `App.tsx`, and Skills starts as a table without an open drawer.
5. **The Console composition root is now lean; runtime bootstrap remains broad.**
   `App.tsx` has been reduced to shell, route selection, and modal wiring.
   Console data loading, Settings V2 editor/navigation, Workspace, Settings
   overview, Settings logs, API keys, Monitoring, API Reference, API endpoint
   docs data, the Settings section router, Agents pages, Sessions pages,
   Environments pages, Credential Vault pages, Memory Store pages, Agent YAML
   modals, Session creation/resource modals, Resource, Credential, and Memory
   creation modals, and the Settings page shell moved out of `App.tsx`. Shared
   metric cards moved into common Console components. Runtime Settings
   composition, runtime config bootstrap, ModelRegistry bootstrap, Agent/Skill
   bootstrap, Sandbox provider bootstrap, runtime API auth resolution, and
   Session runtime service wiring, HTTP startup/error helpers, runtime
   shutdown/restart lifecycle handling, and CLI command registration moved out
   of `src/index.ts`. `src/index.ts` is now a lean runtime entry point. The
   stale pre-Settings Runtime view was removed.

### 13.3 Priority order

1. **P0 — Safety and integrity:** sandbox environment allowlist, worker claim
   ownership enforcement, and CORS allowlist are complete for the current
   local-first runtime. Remaining work is broader deployment auth policy and
   retiring legacy provider tables after the compatibility window.
2. **P0 — Runtime cutover:** settings-driven ModelRegistry, saved/effective
   revision behavior, Settings save audit logs, and the local ArtifactStore
   abstraction are complete. Future non-local artifact adapters remain.
3. **P1 — Honest Console:** rendered Settings pages use one active config,
   legacy provider write paths are disabled, and stale unrendered provider
   components have been removed from `App.tsx`.
4. **P2 — Maintainability:** Console feature/page/modal decomposition is
   complete for the current first-release Dashboard. Runtime composition,
   config bootstrap, ModelRegistry bootstrap, Agent/Skill bootstrap, and
   Sandbox provider bootstrap, API auth resolution, Session runtime service
   wiring, HTTP startup/error helpers, shutdown/restart lifecycle, and CLI
   registration are now tested helpers. `src/index.ts` is no longer a broad
   composition root; global Console bootstrap loading now uses parallel domain
   loaders, while future work can make each page invoke only the domain it
   needs.

No configuration page may offer a save action whose adapter is not connected
to observable runtime behavior.

## 14. First-release implementation status

The first-release Settings V2 scope is implemented when all available adapters
are truthful, configurable, validated, and wired to runtime behavior. Planned
adapters remain visible only as unavailable capability descriptors until their
runtime implementations exist; sandbox providers are the exception where
Docker and remote/self-hosted availability is reported from the current runtime
registry.

Implemented for this release:

- one versioned Settings V2 document with saved/effective revisions;
- encrypted secret storage and masked API responses;
- read, validate, test, save, revision conflict, and restart-required APIs;
- audit log entry for settings saves with revisions and changed paths only;
- settings-driven model vendor, built-in loop max steps, SQLite memory
  enablement, local artifact storage, and workspace sandbox fallback;
- Dashboard Form/JSON editor for Models, Loop engine, Storage, Memory, and
  Sandbox, with Save gated by a changed and validated candidate;
- read-only legacy provider compatibility and `410 Gone` legacy mutations;
- documentation for local setup, API usage, upgrade behavior, and adapter
  availability, including the README, installation guide, usage guide, and API
  reference.
- incremental Console decomposition for Settings data loading, navigation,
  editor pages, Workspace, logs, API keys, Monitoring, API Reference, endpoint
  docs data, section router, Agents pages, Sessions pages, Environments pages,
  Credential Vault pages, Memory Store pages, Agent YAML modals, Session
  creation/resource modals, Resource/Credential/Memory creation modals,
  overview, and shell layout.
- parallel domain-level Console data loaders for build, resource, access, and
  runtime data instead of one monolithic endpoint list.
- runtime composition helper for Settings activation, model registration,
  memory selection, artifact storage, and default Environment sandbox fallback.
- runtime config bootstrap helper for default Environment seeding, YAML API key
  loading, legacy model bootstrap, SQLite memory seeding, and config-defined
  Environments.
- runtime ModelRegistry bootstrap helper for config model seeding, DB provider
  precedence, provider registration, and default model selection.
- runtime loop-engine bootstrap helper for the built-in strategy and configured
  default max steps.
- runtime Agent/Skill bootstrap helper for YAML Agent seed import, custom Skill
  seed import, built-in/custom Skill reference validation, and reload-time Agent
  refresh.
- runtime Sandbox bootstrap helper for local provider registration, optional
  Docker provider registration, and self-hosted WorkQueue provider wiring.
- runtime API auth helper for config/env key resolution plus dynamic
  SQLite-managed API key presence and validation.
- runtime Session services helper for SessionManager, DefaultSessionExecutor,
  SnapshotManager, context compaction, durable Agent resolution, and orphaned
  session recovery wiring.
- runtime HTTP helper for CORS CSV parsing, startup banner formatting, and
  port-in-use/server error handling.
- runtime lifecycle helper for graceful shutdown, restart spawning, server close
  errors, session drain errors, and idempotent repeated stop requests.
- CLI program helper for command registration, default `start` options, init,
  chat, list, reload, deploy, and template commands.
- stale pre-Settings Runtime view removed from the Console composition root.
- legacy provider arrays removed from the Console page-state model.

Explicitly not part of the first-release done definition:

- live remote credential authentication for model vendors;
- Postgres/MySQL metadata migration;
- S3 artifact storage;
- mem0 or MemU memory backends;
- Docker or remote sandbox health checks;
- Harness, Codex, or Claude loop engines;
- removing legacy read endpoints before the compatibility window ends.
