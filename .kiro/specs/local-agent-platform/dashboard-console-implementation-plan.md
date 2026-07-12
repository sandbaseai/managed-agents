# Console Implementation Plan

Status update: this plan supersedes the earlier minimal embedded Console
scope. The implementation now uses a dedicated React/Vite Console under
`apps/console`, built into `dist/console`, with no old embedded UI.
Public fields follow the standard model directly: `system`,
`agent_toolset_20260401`, `permission_policy`, event id cursors, session
`resources`, and `vault_ids`.

Current implementation status:

- Console shell, Quickstart, Agents, Agent detail/edit, Sessions list,
  Create session, Session detail, workspace, runtime, resources, skills,
  API keys, and observability are implemented in `apps/console`.
- Environments, Credential Vaults, and Memory Stores now have Claude-style
  list, create, and detail surfaces instead of placeholder cards.
- Credential Vault detail supports adding MCP OAuth, bearer token, and
  environment variable credentials without returning raw secret values.
- Memory Store detail supports a path-derived tree, add-memory, and
  edit-memory flows.
- Console navigation currently uses hash routes (`#agents/:id`,
  `#sessions/:id`, `#credential-vaults/:id`, `#memory-stores/:id`) so it can
  run under the existing `/ui` static mount without server-side SPA route
  rewrites.
- Session pages follow the Claude Console structure: filters, create modal
  with Agent/Environment/Vaults/Resources, and Transcript/Debug event views.

## Goal

Build a real Console for `managed-agents` that can run both as:

- a web console served by the runtime at `/ui`
- a future desktop-console frontend embedded by a desktop shell

Do not continue iterating on the old embedded UI. The next product
iteration should replace it.

## Design Inputs

Reference patterns:

- Claude Console: workspace selector, Quickstart flow, managed agents nav,
  template-first creation experience.
- Claude Console field alignment:
  `.kiro/specs/local-agent-platform/claude-console-field-alignment.md`
- Open Managed Agents standard gap audit:
  `.kiro/specs/local-agent-platform/open-managed-agents-standard-gap-audit.md`
- Open Managed Agents: left console shell, resource list pages, detail pages,
  transcript/debug session views.
- Current project runtime: agents, sessions, events, skills, MCP, local/docker
  sandboxes, self-hosted worker, auth, metrics, Console endpoint.

Project-specific constraints:

- open source and local-first
- no billing page
- full Console, not just chat
- desktop support later
- Web Console cannot start the runtime process because it is served by that
  process
- Desktop shell can start/stop/restart runtime and choose workspaces

## Source Precedence

When implementation choices conflict:

1. Follow Claude Console and official Claude Managed Agents semantics for UI,
   field names, forms, and resource hierarchy.
2. Use Open Managed Agents to fill in typed API details that do not conflict
   with Claude.
3. Treat pre-launch implementation fields as replaceable draft details.

This means the Console should look and behave like Claude first. OMA should
prevent field omissions and guide standard API details. The old UI and
pre-launch database shapes must not define the new product surface. Because
the service has not launched, prefer changing schema/API to the standard model
over keeping non-standard field names.

## Route Map

```text
/quickstart
/templates
/templates/:templateId
/agents
/agents/:agentId
/agents/:agentId/versions/:version
/sessions
/sessions/:sessionId
/workspace
/files
/skills
/deployments
/runtime
/environments
/environments/:environmentId
/credential-vaults
/credential-vaults/:vaultId
/memory-stores
/memory-stores/:memoryStoreId
/eval-runs
/observability
/settings
```

Default route:

```text
/ui -> /quickstart
```

SPA history route:

```text
/ui/* -> console index.html
```

This route serves the real Console app for deep links. It never serves the old
embedded UI.

## Frontend Stack

P0:

- React
- Vite
- TypeScript
- lucide-react
- plain CSS with design tokens
- native hash routing and fetch helpers

Avoid:

- a large component library in P0
- landing-page composition
- decorative hero sections
- billing/cost UI
- one-off embedded HTML Console code

CSS direction:

- light console UI
- compact resource tables
- 8px radius maximum for cards and controls
- restrained orange accent
- neutral background
- no gradient-orb/bokeh decoration
- no text-overflow inside controls
- mobile-responsive sidebar and tables

## Runtime Capability Model

The Console should treat runtime controls as capability-gated:

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

Web Console P0:

```ts
{
  canStartRuntime: false,
  canStopRuntime: false,
  canRestartRuntime: false,
  canOpenWorkspaceFolder: false,
  canEditWorkspaceFiles: false,
  canInstallTemplates: false
}
```

Desktop shell later:

```ts
{
  canStartRuntime: true,
  canStopRuntime: true,
  canRestartRuntime: true,
  canOpenWorkspaceFolder: true,
  canEditWorkspaceFiles: true,
  canInstallTemplates: true
}
```

UI behavior:

- Web Console shows `Copy start command` instead of `Start runtime`.
- Desktop Console shows `Start`, `Stop`, and `Restart` when the shell exposes
  those capabilities.
- Template install and file edit can be shown as disabled/planned in Web P0.

## P0 API Contracts

### `GET /v1/x/workspace`

Purpose: feed the Workspace page and sidebar workspace selector.

```json
{
  "name": "managed-agents",
  "workspace_path": "/path/to/project",
  "config_path": "/path/to/managed-agents.config.yaml",
  "agents_dir": "/path/to/agents",
  "skills_dir": "/path/to/skills",
  "data_dir": "/path/to/.managed-agents",
  "database_path": "/path/to/.managed-agents/data.db",
  "package_version": "0.1.0",
  "runtime_target": "local",
  "start_command": "managed-agents start --config managed-agents.config.yaml"
}
```

### `GET /v1/x/runtime`

Purpose: feed Local Runtime, Settings, and sidebar status.

```json
{
  "status": "healthy",
  "api_url": "http://localhost:3000/v1",
  "ui_url": "http://localhost:3000/ui",
  "auth_enabled": false,
  "agents_loaded": 1,
  "skills_loaded": 1,
  "active_sessions": 0,
  "sandbox_providers": [
    { "type": "local", "available": true },
    { "type": "docker", "available": true },
    { "type": "self_hosted", "available": true }
  ],
  "memory": {
    "enabled": false,
    "provider": null
  },
  "capabilities": {
    "canStartRuntime": false,
    "canStopRuntime": false,
    "canRestartRuntime": false,
    "canOpenWorkspaceFolder": false,
    "canEditWorkspaceFiles": false,
    "canInstallTemplates": false
  }
}
```

### `GET /v1/skills`

Purpose: feed the Claude-aligned Skills registry.

```json
{
  "data": [
    {
      "id": "skill_code-review",
      "type": "skill",
      "display_title": "Code review",
      "description": "Review code for correctness and maintainability.",
      "source": "custom",
      "latest_version": "20260712",
      "file": "code-review/SKILL.md",
      "created_at": "2026-07-12T00:00:00.000Z",
      "updated_at": "2026-07-12T00:00:00.000Z"
    }
  ]
}
```
```

### `GET /v1/x/templates`

Purpose: feed Quickstart and Templates pages.

```json
{
  "data": [
    {
      "id": "blank-agent",
      "name": "Blank agent",
      "description": "Start with a minimal agent definition.",
      "category": "General",
      "skills": [],
      "tools": ["bash", "read", "write"],
      "mcp_servers": [],
      "agent_yaml": "name: my-agent\nmodel:\n  id: local-echo\n  speed: standard\n..."
    }
  ]
}
```

### Core Console DTO alignment

The Console API and runtime schema should adopt Claude/OMA-style fields as the
canonical model:

- `Agent.system` is the UI/API name.
- `Agent.model` should normalize to `{ id, speed }` for create/edit flows.
- `Agent.model_provider_id` should be optional for OMA provider parity.
- `Agent.version` is required for versioned edits and session snapshots.
- `Session.resources` should support `file`, `github_repository`, and
  `memory_store` resource types.
- `Session.vault_ids` should be present even when empty.
- list APIs should support cursor pagination with `has_more`, `first_id`, and
  `last_id`.
- event APIs should accept OMA-style `{ events: [...] }` batch sends and
  cursor params `after_id`/`before_id`.
- `Environment.hosting_type` should be immutable after creation.
- `Environment.config.networking` and `Environment.config.packages` should be
  represented for OMA parity even when a local sandbox provider ignores them
  initially.
- `Vault.display_name` is the UI-facing vault name.
- `MemoryStore.name` and `MemoryStore.description` are rendered into the agent
  system prompt when attached.

The detailed field matrix lives in
`.kiro/specs/local-agent-platform/claude-console-field-alignment.md`.

### `GET /v1/x/vaults`

P0 can be read-only and synthetic.

```json
{
  "data": [
    {
      "name": "OPENAI_API_KEY",
      "source": "environment",
      "required_by": ["model:local"],
      "present": true,
      "secret": true
    }
  ]
}
```

### `GET /v1/x/memory`

P0 can be read-only status.

```json
{
  "enabled": false,
  "provider": null,
  "stores": []
}
```

### `GET /v1/x/evals`

P0 can be empty-state data.

```json
{
  "data": [],
  "planned": true
}
```

## Existing API Usage

The Console should reuse:

- `GET /v1/agents`
- `GET /v1/agents/:id`
- `GET /v1/sessions`
- `POST /v1/sessions`
- `GET /v1/sessions/:id`
- `POST /v1/sessions/:id/messages`
- `GET /v1/sessions/:id/events`
- `GET /v1/sessions/:id/events/stream`
- `POST /v1/sessions/:id/stop`
- `DELETE /v1/sessions/:id`
- `POST /v1/x/reload`
- `GET /v1/x/health`
- `GET /v1/x/metrics`
- `GET /v1/x/mcp/status?session_id=...`

## Data Loading Strategy

Use TanStack Query:

- resource list pages poll lightly or refetch on action
- session detail uses SSE as the primary event source
- mutations invalidate relevant list/detail queries
- API client centralizes auth header handling

SSE:

- transcript/debug should listen to custom SSE event names
- transient stream chunks should update a live message bubble
- persisted final events should dedupe by event ID or stream cursor
- status events should update session header and lists

## Component Map

```text
components/layout/
  console-shell.tsx
  sidebar.tsx
  page-header.tsx

components/ui/
  button.tsx
  badge.tsx
  table.tsx
  tabs.tsx
  empty-state.tsx
  code-block.tsx
  stat-card.tsx
  command-box.tsx

components/domain/
  agent-status-badge.tsx
  session-status-badge.tsx
  template-card.tsx
  event-row.tsx
  transcript-message.tsx
  skill-pill.tsx
  capability-gate.tsx
```

## Page Acceptance Criteria

### Quickstart

- shows workspace name and runtime health
- shows prompt/draft panel
- shows template search and cards
- selecting a template shows YAML preview
- can create a session from an existing loaded agent
- no billing/cost content

### Templates

- lists built-in templates
- search works client-side in P0
- template detail shows YAML and required skills/tools
- install button is disabled or capability-gated in Web P0

### Agents

- lists loaded agents from API
- supports status/model/environment/skills/tools columns
- detail page shows YAML and JSON previews
- `Start session` creates a session and routes to session detail
- `Reload` calls runtime reload

### Sessions

- lists sessions from API
- supports agent/status filters
- detail page has Transcript and Debug tabs
- composer sends messages through messages endpoint
- live events update transcript/debug views

### Workspace

- shows workspace/config/agents/skills/data paths
- shows start command with copy action
- shows validation/desktop-only actions as disabled in Web P0

### Local Runtime

- shows health and runtime metadata
- shows reload action
- shows desktop-only start/stop/restart controls disabled in Web P0
- shows sandbox providers

### Skills

- lists built-in and custom skills
- shows source, latest version, and updated time
- previews skill details and versions

### Credential Vaults

- never renders secret values
- lists vault containers with Claude-style ID, name, status, and created date
- creates vault containers without collecting secret values
- shows vault detail with credential metadata
- supports MCP OAuth, bearer token, and environment variable credential add
  flows
- stores secret-backed credentials encrypted at rest and returns only redacted
  value hints
- uses canonical `request_headers` / `request_body` injection locations
- explains workspace sharing before saving secret-backed credentials

### Memory Stores

- lists memory stores with Claude-style filters and table columns
- creates stores with name and optional description
- shows store detail as a tree plus content pane
- supports adding and editing memories by absolute path
- validates memory paths as absolute file paths and keeps active paths unique
  without archived records blocking path reuse
- explains session attachment and prompt injection
- does not imply billing

### Eval Runs

- explains quality regression testing
- no billing/cost language
- P0 empty state is useful and clear

## Implementation Milestones

### Milestone 0: Design Lock

- [x] reference review
- [x] no old embedded UI decision
- [x] route map
- [x] P0 API contracts
- [x] page acceptance criteria
- [ ] user approval to start development

### Milestone 1: Console App Skeleton

- create `apps/console`
- add Vite/React/TS config
- add route shell and sidebar
- add shared CSS tokens
- add API client
- no runtime server changes yet

### Milestone 2: Runtime Metadata APIs

- add `/v1/x/workspace`
- add `/v1/x/runtime`
- add `/v1/skills`
- add `/v1/x/templates`
- add read-only `/v1/x/vaults`, `/v1/x/memory`, `/v1/x/evals`
- add tests for route shapes

### Milestone 3: Core Pages

- Quickstart
- Templates
- Agents list/detail
- Sessions list/detail
- Workspace
- Local Runtime

### Milestone 4: Secondary Pages

- Files read-only placeholder
- Skills
- Environments list, create modal, detail, Cloud edit, Self-hosted setup view
- Credential Vaults list, create modal, detail, credential add flow
- Memory Stores list, create modal, detail, add/edit memory flow
- Eval Runs
- Settings

### Milestone 5: Server Integration

- root build script builds Console and runtime
- package includes Console dist
- server serves Console at `/ui`
- server supports `/ui/*` SPA history route
- remove old `src/api/dashboard.ts`
- no embedded UI

### Milestone 6: QA

- typecheck
- Console build
- runtime build
- API tests
- full tests
- browser QA at desktop viewport
- browser QA at mobile viewport
- verify `/ui` never serves the old embedded UI

## Desktop Preparation

Do not build desktop app in P0, but keep the Console ready:

- no browser-only assumption around runtime controls
- all desktop-only actions go through capability checks
- no direct filesystem writes from Web Console
- route state should work in an embedded WebView
- settings should separate API base URL from desktop process controls

Future desktop shape:

```text
apps/desktop/
  Tauri shell
  workspace picker
  runtime process manager
  log viewer bridge
  embeds apps/console build
```

Desktop shell API bridge:

```ts
window.managedAgentsDesktop?.runtime.start(options)
window.managedAgentsDesktop?.runtime.stop()
window.managedAgentsDesktop?.runtime.restart()
window.managedAgentsDesktop?.workspace.select()
window.managedAgentsDesktop?.workspace.openFolder(path)
window.managedAgentsDesktop?.logs.tail()
```

## Risks

- Adding React/Vite changes package build complexity.
- Serving built assets from Node needs careful path handling after bundling.
- The current single-package setup may need workspace-style scripts without
  turning the whole repository into a heavy monorepo.
- API gaps for templates/files/evals can start read-only, but vault credentials
  and memory records now have first-class data models because Claude's Console
  exposes them as core resource workflows.

## Non-Negotiables

- No Billing page.
- No old embedded UI.
- No one-screen chat-only UI.
- No desktop start/stop controls shown as active in Web Console.
- No secret values rendered in the UI.
- No non-standard credential field aliases; use Claude-aligned canonical API
  values before the first release.
- No public Console page should mention implementation scratch notes.
