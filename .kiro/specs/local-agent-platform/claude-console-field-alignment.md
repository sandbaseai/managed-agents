# Claude Console Field Alignment

## Purpose

This document is the source-of-truth design for the next Console iteration.
Implementation should follow the real Claude Console field model first, then
adapt it to local-first open-source constraints. Do not build another rough
Console or a temporary UI.

Primary references:

- Claude Console, observed at
  `https://platform.claude.com/workspaces/default/agent-quickstart`
- Claude Managed Agents documentation snapshot in
  `references/anthropic-claude-docs/`
- Open Managed Agents reference implementation in
  `../open-managed-agents-reference`
- Open Managed Agents standard gap audit in
  `.kiro/specs/local-agent-platform/open-managed-agents-standard-gap-audit.md`

## Product Decisions

- Build a real Console, not a marketing page or debug UI.
- Keep the Claude-style Console structure: sidebar, workspace selector, dense
  resource lists, detail pages, modals, and YAML-first agent editing.
- Remove billing/cost concepts from this open-source project.
- Keep Credential Vaults and Memory Stores as first-class resources.
- Treat Eval Runs as quality regression testing, not usage analytics.
- Prepare every route for a future desktop shell, but keep runtime process
  controls capability-gated.
- Use Claude field names in the UI and import/export surfaces where possible.
- Build the backend, DTOs, and persisted schema directly on the standard model.
  Non-standard pre-launch field names are not part of the product contract.

## Precedence Rules

When references disagree, use this order:

1. Real Claude Console UI and official Claude Managed Agents semantics.
2. Open Managed Agents field/API shapes for parity, only where they do
   not conflict with Claude.
3. New local runtime implementation details, only after the standard shape is
   satisfied.

Conflict handling:

- If Claude and OMA differ on UI flow, field labels, create/edit forms, or
  resource placement, follow Claude.
- If Claude has a resource that OMA does not have, such as Memory Stores, keep
  the Claude resource.
- If OMA has implementation-only fields that Claude does not expose, such as
  cursor pagination, providers, or MCP connector discovery, keep them as
  supporting API fields without letting them reshape the Claude-like Console.
- If an implementation field differs from Claude naming, replace it with the
  Claude name in the public API.
- Billing, Credits, and Cost are excluded for this open-source local-first
  project even when Claude or OMA exposes billing-adjacent surfaces.

## Navigation

Claude Console observed structure:

```text
Overview
API keys

Build
  Workbench
  Files
  Skills
  Batches

Managed Agents
  Quickstart
  Agents
  Sessions
  Deployments
  Environments
  Credential vaults
  Memory stores

Analytics
  Usage
  Caching
  Rate limits
  Cost
  Logs

Manage
  Limits
  Service accounts
  Privacy controls
  Security
  Webhooks
  Tags
```

managed-agents Console target:

```text
Workspace selector

Build
  Quickstart
  Templates
  Files
  Skills

Managed Agents
  Agents
  Sessions
  Deployments
  Environments
  Credential Vaults
  Memory Stores

Quality
  Eval Runs
  Observability

System
  Workspace
  Local Runtime
  API Keys
  Settings
```

Do not include Billing, Credits, Cost, or cloud account spend pages.

## Quickstart

Purpose: first-run agent creation and template browsing.

Observed Claude fields and layout:

- page title: `Quickstart`
- stepper: `1 2 3 4`
- left panel:
  - heading: `What do you want to build?`
  - supporting copy: `Describe your agent or start with a template.`
  - prompt input placeholder: `Describe your agent...`
  - send action disabled until text exists
- right panel:
  - heading: `Browse templates`
  - search placeholder: `Search templates`
  - template cards

Template card fields:

- `id`
- `name`
- `description`
- `skills` or connector badges
- optional capability badges such as `Recurring`
- backing `agent_yaml`

Observed template examples:

- Blank agent config
- Deep researcher
- Structured extractor
- Field monitor
- Support agent
- Incident commander
- Contract tracker
- Sprint retro facilitator
- Support-to-eng escalator
- Data analyst

Template preview fields:

- `Back to templates`
- title: `{template name} - Template`
- format dropdown: `YAML`
- actions: `Use template`, `Copy code`
- code preview:

```yaml
name: Untitled agent
description: A blank starting point with the core toolset.
model: claude-sonnet-5
system: You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user's task end to end.
mcp_servers: []
tools:
  - type: agent_toolset_20260401
skills: []
```

managed-agents behavior:

- Quickstart defaults to template browsing, not a metrics page.
- `Use template` creates an agent draft or agent version, depending on backend
  capability.
- Prompt-based generation can be P1, but the prompt field and layout should be
  designed in P0.
- Template YAML should use Claude/OMA field names: `system`, `model`,
  `mcp_servers`, `tools`, `skills`, `metadata`.

## Agents

### Agents List

Observed Claude list:

- title: `Agents`
- description: `Create and manage autonomous agents.`
- primary action: `Create agent`
- secondary action: documentation link/icon
- filters:
  - search placeholder: `Search by name or exact ID`
  - `Created`: `All time`
  - `Status`: `Active`
- table columns:
  - checkbox
  - `ID`
  - `Name`
  - `Model`
  - `Status`
  - `Created`
  - `Last updated`
  - row actions

managed-agents additions:

- optional filter: `Environment`
- optional filter: `Skill`
- optional action: `Import agent`
- optional action: `Reload`

### Agent Detail

Observed Claude detail:

- breadcrumb: `Agents / {agent name}`
- heading: `{agent name}`
- status badge: `Active`
- copyable ID: `agent_...`
- metadata: `Last updated {date}`
- actions: `Edit`, row actions menu
- description line
- tabs:
  - `Agent`
  - `Sessions`
  - `Deployments`
  - `Observability`

Agent tab fields:

- `Version`: `v{number}`
- `Model`
- `System prompt`
- `MCPs and tools`
- `Tool permissions`
- `Skills`

### Create/Edit Agent

Observed Claude edit modal:

- title: `Edit agent`
- format dropdown: `YAML`
- action: `Copy code`
- primary submit: `Save new version`
- close action
- YAML fields:

```yaml
name: Untitled agent
model: claude-sonnet-4-6
description: A blank starting point with the core toolset.
system: You are a general-purpose agent that can research, write code, run commands, and use connected tools to complete the user's task end to end.
mcp_servers: []
tools:
  - configs: []
    default_config:
      enabled: true
      permission_policy:
        type: always_allow
    type: agent_toolset_20260401
skills: []
metadata: {}
```

Required Console behavior:

- Agent config editing is YAML-first.
- Saving an edit creates a new agent version.
- The UI should show the selected version and retain session snapshots.
- The editor should accept and emit Claude/OMA fields only.

Agent object target:

```ts
interface ConsoleAgent {
  id: string;
  type: "agent";
  name: string;
  description: string | null;
  system: string | null;
  model: string;
  model_config?: { speed?: "standard" | "fast" | "extended" };
  tools: ToolConfig[];
  mcp_servers: MCPServerDefinition[];
  skills: SkillRef[];
  metadata: Record<string, string>;
  version: number;
  status: "active" | "archived";
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
```

Standardization notes:

- `system` is the canonical field.
- `model` should be normalized to the Claude/OMA model config shape for
  create/edit flows.
- `version` is first-class and persisted from the start.
- `archived_at` is separate from runtime health or load errors.
- Tool permissions use `permission_policy`.

## Sessions

### Sessions List

Observed Claude list:

- title: `Sessions`
- description: `Trace and debug Claude Managed Agents sessions.`
- primary action: `Create session`
- secondary action: documentation link/icon
- filters:
  - search label: `ID`
  - search placeholder: `Search by session ID`
  - `Created`: `All time`
  - `Agent`: `All`
  - `Deployment`: `All`
  - `Status`: `Active`
- table columns:
  - checkbox
  - `ID`
  - `Name`
  - `Status`
  - `Agent`
  - `Tokens in / out`
  - `Created`
  - row actions

managed-agents additions:

- display `Environment` when available.
- support local status display while preserving Claude vocabulary where useful.

Implementation status:

- Implemented in `apps/console` with the Claude column set, primary action,
  search, and filter controls.
- Rows deep link to `#sessions/:sessionId`.

### Create Session

Observed Claude modal:

- title: `Create session`
- subtitle: `Set up an instance of your agent in its environment.`
- fields:
  - `Title`
    - placeholder: `Optional - name this run`
  - `Agent`
    - placeholder: `Select an agent`
    - link: `Manage agents`
  - `Environment`
    - placeholder: `Select an environment`
    - link: `Manage environments`
  - `Credential vaults`
    - placeholder: `Select one or more vaults`
    - link: `Manage credential vaults`
  - `Resources`
    - help text: `Mount files, GitHub repositories, or memory stores into the session.`
    - resource action: `+ Resource`
    - resource options:
      - `GitHub repository`
      - `File`
      - `Memory store`
- submit: `Create session`

Target create params:

```ts
interface ConsoleSessionCreateParams {
  title?: string | null;
  agent: string | { id: string; type: "agent"; version?: number };
  environment_id: string;
  vault_ids?: string[];
  resources?: SessionResourceParams[];
  metadata?: Record<string, unknown>;
}
```

Important behavior:

- Creating a session provisions a session/environment but does not imply a
  model turn has started.
- Work starts when the client sends a `user.message` event to that session.
- There is no separate `resume` method. Continuing a session means sending a
  new user event to the same persistent session.

Implementation status:

- Implemented in `apps/console` with Title, Agent, Environment, Credential
  vaults, and Resources.
- Resource editors support File, GitHub repository, and Memory store payloads.

### Session Detail

Observed Claude detail:

- breadcrumb: `Sessions / {short session id}`
- heading: full `sesn_...`
- right actions: `Actions`, `Ask Claude`
- metadata:
  - status, for example `Idle`
  - linked agent
  - linked environment
  - elapsed or active duration
  - created relative time
- view switch:
  - `Transcript`
  - `Debug`
- toolbar:
  - event filter, e.g. `All events`
  - search
  - keyboard shortcuts
  - copy all
  - download
- transcript rows:
  - `User`
  - `Model`
  - `Error`
  - `Interrupt`
  - elapsed time
- detail panel for selected event:
  - close detail panel
  - event title
  - copyable event ID
  - elapsed time
  - `Rendered` / `Raw`
  - event type and payload

Required Console behavior:

- Session detail must be an observability surface, not just chat.
- Transcript and Debug should use the same event stream with different
  rendering.
- Raw event payloads should be available.
- Event IDs, event types, timings, model usage, parent IDs, and stop reasons
  should be visible in Debug.
- SSE reconnect should use cursor semantics such as `Last-Event-ID`.

Implementation status:

- Implemented in `apps/console` as a session observability surface with
  Transcript/Debug modes, event filters, search, rendered/raw event payloads,
  interrupt action, archive action, copy, and JSON download.
- Follow-up: replace the current event fetch with live SSE tailing once the
  Console has a reusable event stream hook.

Status mapping:

```text
Claude/OMA        Current local        Display target
running           running              Running
idle              paused               Idle
idle              requires_action      Requires action
terminated        completed            Terminated
terminated        failed               Failed
rescheduling      queued               Rescheduling / Queued
```

## Environments

### Environments List

Observed Claude list:

- title: `Environments`
- description: `Configuration template for containers, such as sessions or code execution.`
- primary action: `Create environment`
- filters:
  - search placeholder: `Search by name or exact ID`
  - `Status`: `All`
- table columns:
  - checkbox
  - `ID`
  - `Name`
  - `Status`
  - `Type`
  - `Updated at`
  - row actions

### Create Environment

Observed Claude modal:

- title: `Create environment`
- fields:
  - `Name`
    - placeholder: `E.g. My Environment`
    - note: `50 characters or fewer.`
  - `Hosting type`
    - dropdown default: `Cloud`
    - options: `Cloud`, `Self-hosted`
    - note: `This cannot be changed after creation.`
  - `Description`
    - placeholder: `Optional description for this environment`
- actions: `Cancel`, `Create environment`

managed-agents adaptation:

- UI shape follows Claude.
- Hosting type options are Claude-aligned:
  - `Cloud`
  - `Self-hosted`
- The selected hosting type is immutable after creation.
- Future provider-specific fields can be added after the first modal step.
- Current Console implementation:
  - Environments list uses Claude title, description, search, status filter,
    table columns, row actions, and responsive card list.
  - Create environment modal includes `Name`, `Hosting type`, `Description`,
    `Cancel`, and `Create environment`.
  - Cloud detail includes `Networking`, `Packages`, and `Metadata`.
  - Cloud edit supports name, description, network type, MCP/package-manager
    network access toggles, allowed hosts, packages, and metadata.
  - Self-hosted detail includes overview metrics, environment keys, and the
    worker setup guide.

Target object:

```ts
interface ConsoleEnvironment {
  id: string;
  type: "environment";
  name: string;
  description: string | null;
  hosting_type: "cloud" | "self_hosted";
  status: "active" | "error" | "archived";
  config: Record<string, unknown>;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}
```

## Credential Vaults

### Credential Vaults List

Observed Claude list:

- title: `Credential vaults`
- description:
  `Manage credential vaults that provide your agents with access to MCP servers and other tools.`
- primary action: `Create vault`
- filters:
  - search placeholder: `Search by name or exact ID`
  - `Status`: `All`
- table columns:
  - checkbox
  - `ID`
  - `Name`
  - `Status`
  - `Created`
  - row actions

### Create Vault

Observed Claude modal:

- title: `Create vault`
- security note:
  `Vaults are shared across this workspace. Credentials added to this vault will be usable by anyone with API key access.`
- field:
  - `Name`
    - placeholder: `Production vault`
    - note: `50 characters or fewer.`
- action: `Continue`

Required behavior:

- Vault creation creates an encrypted/workspace-scoped credential container.
- It does not immediately collect a secret value.
- Secret values are never rendered in lists, event views, or logs.
- Secret-backed credentials are stored encrypted at rest with a local
  workspace secret key. API responses expose only redacted hints.
- Vaults can later contain static bearer credentials, MCP OAuth credentials,
  or local env-backed credentials.
- Vault detail lists credentials after the container is created.
- Credential add flow supports:
  - `MCP OAuth`
  - `Bearer token`
  - `Environment variable`
- MCP OAuth credentials select an MCP server URL from a registry-style picker
  or accept a custom URL.
- Bearer token and environment variable credentials require an explicit
  acknowledgement before saving because they are shared across the workspace.
- Environment variable credentials support network scope and injection
  locations (`Request headers`, `Request body`) using the canonical
  `request_headers` and `request_body` API values.
- API responses expose only credential metadata and redacted value hints; raw
  secret values must never be returned.

Target object:

```ts
interface ConsoleVault {
  id: string;
  type: "vault";
  display_name: string;
  status: "active" | "archived";
  credential_count?: number;
  credentials?: ConsoleVaultCredential[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

interface ConsoleVaultCredential {
  id: string;
  type: "credential";
  vault_id: string;
  name: string | null;
  auth_type: "mcp_oauth" | "bearer_token" | "environment_variable";
  mcp_server_url?: string | null;
  variable_name?: string | null;
  value_hint?: string | null;
  network?: {
    type: "limited" | "unrestricted";
    allowed_hosts: string[];
  };
  injection_locations?: ("request_headers" | "request_body")[];
  status: "active" | "archived" | "deleted";
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  last_used_at?: string | null;
  archived_at?: string | null;
}
```

## Memory Stores

### Memory Stores List

Observed Claude list:

- title: `Memory stores`
- description: `Browse and manage persistent memory for your agents.`
- primary action: `Create memory store`
- filters:
  - search placeholder: `Search by name or exact ID`
  - `Created`: `All time`
  - `Status`: `Active`
- table columns:
  - checkbox
  - `ID`
  - `Name`
  - `Status`
  - `Created`
  - row actions

### Create Memory Store

Observed Claude modal:

- title: `Create memory store`
- fields:
  - `Name`
    - placeholder: `My memory store`
  - `Description (optional)`
    - placeholder:
      `What this store contains and how agents should use it`
- note:
  `Name and description are rendered in the agent system prompt when this store is attached.`
- submit: `Create memory store`

Required behavior:

- Memory stores are workspace resources.
- They can be attached to sessions as resources.
- Name and description should be available to the runtime prompt assembly when
  attached.
- Do not describe Memory Stores as billing or usage features.
- Memory store detail uses a file-tree style browser with a content pane.
- `Add memory` requires an absolute path and plain-text content.
- Folder structure is derived from slashes in the memory path.
- Memory paths are normalized absolute file paths such as `/note/d`; root paths
  and trailing directory paths are invalid.
- Active memory paths are unique within a store, but archived memories do not
  block recreating the same path.
- Existing memory content can be edited and saved as a new persisted value.

Target object:

```ts
interface ConsoleMemoryStore {
  id: string;
  type: "memory_store";
  name: string;
  description: string | null;
  status: "active" | "archived";
  memory_count?: number;
  memories?: ConsoleMemoryRecord[];
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}

interface ConsoleMemoryRecord {
  id: string;
  type: "memory";
  store_id: string;
  path: string;
  content: string;
  metadata: Record<string, unknown>;
  created_at: string;
  updated_at: string;
  archived_at?: string | null;
}
```

## Files

Purpose: workspace file and session resource management.

P0 fields:

- `ID`
- `Name`
- `Type`
- `Size`
- `Created`
- `Updated`
- row actions

Create/import file fields:

- file picker in desktop shell
- browser upload in web console when supported
- optional `mount_path` when attaching to a session

## Skills

Purpose: built-in and workspace skill registry.

List fields:

- `ID`
- `Name`
- `Source`: `anthropic` or `custom`
- `Latest version`
- `Description`
- `Updated`

Import/create fields:

- `files`: all files in the same top-level directory
- root `SKILL.md` file inside that directory
- `display_title` (optional, human-readable only)

`SKILL.md` rules:

- must start with YAML frontmatter (`---`)
- frontmatter must include `name` and `description`

Agent YAML skill shape:

```yaml
skills:
  - type: custom
    skill_id: skill_code-review
    version: latest
  - type: anthropic
    skill_id: pptx
    version: latest
```

Standard skill model:

- Skill refs use object form with `type`, `skill_id`, and `version`.
- Built-in Claude skills use `type: anthropic`.
- Project-defined skills use `type: custom`.
- `/v1/skills` is the standard resource API for list/create/retrieve/delete.

## Deployments

Claude includes Deployments under Managed Agents. For local-first open source,
P0 may show an empty/planned route if deployment is not implemented.

Target fields when implemented:

- `ID`
- `Name`
- `Agent`
- `Agent version`
- `Environment`
- `Status`
- `Created`
- `Last updated`

This should not imply hosted billing.

## Eval Runs and Observability

Eval Runs are local quality regression runs.

List fields:

- `ID`
- `Suite`
- `Agent`
- `Agent version`
- `Status`
- `Passed`
- `Failed`
- `Latency`
- `Last run`
- row actions

Create eval run fields:

- `Suite`
- `Agent`
- `Agent version`
- `Environment`
- optional `Credential vaults`
- optional `Resources`

Observability should reuse session event fields:

- event ID
- event type
- status
- elapsed time
- tokens in/out
- model
- parent event ID
- stop reason
- raw payload

## Workspace and Local Runtime

Workspace selector fields:

- workspace name
- workspace path
- role/status label can be local-only, for example `Local`

Workspace page fields:

- workspace path
- config path
- agents directory
- skills directory
- data directory
- database path
- package version
- runtime target
- start command

Local Runtime page fields:

- status
- API URL
- UI URL
- auth mode
- loaded agents
- loaded skills
- active sessions
- sandbox providers
- memory provider
- start command
- recent runtime logs or events

Desktop capability fields:

```ts
interface RuntimeCapabilities {
  canStartRuntime: boolean;
  canStopRuntime: boolean;
  canRestartRuntime: boolean;
  canOpenWorkspaceFolder: boolean;
  canEditWorkspaceFiles: boolean;
  canInstallTemplates: boolean;
}
```

Web Console:

- cannot start the runtime process that is serving it
- can show `Copy start command`

Desktop Console:

- can show `Start`, `Stop`, `Restart`
- can open workspace folders
- can use native file pickers

## API Surface Gaps

P0 standard APIs:

- `GET /v1/x/workspace`
- `GET /v1/x/runtime`
- `GET /v1/x/templates`
- `GET /v1/skills`
- `POST /v1/skills`
- `GET /v1/skills/:skill_id`
- `DELETE /v1/skills/:skill_id`
- `GET /v1/environments`
- `POST /v1/environments`
- `GET /v1/credential-vaults`
- `POST /v1/credential-vaults`
- `GET /v1/credential-vaults/:id`
- `GET /v1/credential-vaults/:id/credentials`
- `POST /v1/credential-vaults/:id/credentials`
- `GET /v1/memory-stores`
- `POST /v1/memory-stores`
- `GET /v1/memory-stores/:id`
- `GET /v1/memory-stores/:id/memories`
- `POST /v1/memory-stores/:id/memories`
- agent create/update with versioning
- session create with `vault_ids` and `resources`
- session detail event stream with raw/debug payloads

Standard serialization:

- use `system`
- use model config objects for create/edit flows
- use ISO `created_at`/`updated_at` strings
- use Claude/OMA session status vocabulary

## Implementation Priority

### P0: Console Foundation and Core Managed Agent Flow

- Console shell and Claude-like sidebar
- workspace selector
- Quickstart with template browser and YAML preview
- Agents list
- Create agent modal
- Agent detail with version, system prompt, tools, skills, sessions
- Edit agent modal with YAML editor and `Save new version`
- Sessions list
- Create session modal with Title, Agent, Environment, Vaults, Resources
- Session detail with Transcript and Debug
- Environments list and create modal
- Credential Vaults list and create modal
- Memory Stores list and create modal
- Credential Vault detail and credential add flow
- Memory Store detail, add-memory, and edit-memory flow
- API/schema layer that exposes Claude/OMA-standard fields

### P1: Resource Depth

- Files list/import/attach
- Skills import/detail
- Memory store session attachment management
- GitHub repository session resource
- raw event renderer, event search, copy/download
- Deployments placeholder or local deployment concept
- Eval Runs schema and first executable suite

### P2: Desktop Readiness

- desktop shell runtime start/stop/restart
- workspace picker
- native file picker
- runtime logs bridge
- desktop settings for port and background process behavior

## Acceptance Criteria

- `/ui` opens the new Console first screen, not the old UI.
- Quickstart visually and structurally matches Claude's template-first flow.
- Every create modal uses the field set described above.
- Agent YAML import/export uses Claude/OMA names.
- Session creation supports agent, environment, vaults, and resources.
- Session detail has Transcript and Debug, with raw event inspection.
- Credential Vaults and Memory Stores exist as real Console pages.
- No Billing, Credits, Cost, or spend language appears in the Console.
- Runtime start/stop controls are capability-gated for desktop.
- Implementation does not rely on the old embedded UI.
