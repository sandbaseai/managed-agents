import type { ApiReferenceEndpoint } from './apiReferenceTypes';

export type ApiReferenceExampleContext = {
  baseUrl: string;
  authEnabled: boolean;
  firstAgentId: string;
  firstEnvironmentId: string;
  firstSessionId: string;
};

function authHeaderLine(authEnabled: boolean) {
  return authEnabled ? "  -H 'Authorization: Bearer ma_...' \\" : '';
}

function joinCurlLines(lines: string[]) {
  return lines.filter(Boolean).join('\n');
}

export function buildApiEndpointExample(endpoint: ApiReferenceEndpoint, context: ApiReferenceExampleContext): string {
  const authCurl = authHeaderLine(context.authEnabled);

  if (endpoint.id === 'sessions-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/sessions' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      `  -d '{"agent":"${context.firstAgentId}","environment_id":"${context.firstEnvironmentId}","title":"API smoke test"}'`,
      '',
      `curl -N -X POST '${context.baseUrl}/v1/sessions/${context.firstSessionId}/messages' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
    ]);
  }

  if (endpoint.id === 'sessions-message') {
    return joinCurlLines([
      `curl -N -X POST '${context.baseUrl}/v1/sessions/${context.firstSessionId}/messages' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
    ]);
  }

  if (endpoint.id === 'agents-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/agents' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{",
      '    "name": "assistant",',
      '    "description": "Helps with development tasks.",',
      '    "model": { "id": "claude-opus-4-8", "speed": "standard" },',
      '    "system": "You are a helpful assistant.",',
      '    "tools": [{ "type": "agent_toolset_20260401" }],',
      '    "skills": []',
      "  }'",
    ]);
  }

  if (endpoint.id === 'skills-create') {
    return joinCurlLines([
      'zip -r code-review-assistant.zip code-review-assistant',
      '',
      `curl -sS -X POST '${context.baseUrl}/v1/skills' \\`,
      authCurl,
      "  -F 'files=@code-review-assistant.zip'",
    ]);
  }

  if (endpoint.id === 'files-upload') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/files' \\`,
      authCurl,
      "  -F 'file=@notes.txt'",
    ]);
  }

  if (endpoint.id === 'environments-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/environments' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"name\":\"local-dev\",\"hosting_type\":\"self_hosted\",\"network\":{\"type\":\"limited\"}}'",
    ]);
  }

  if (endpoint.id === 'vaults-credential-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/credential-vaults/vlt_.../credentials' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"auth_type\":\"environment_variable\",\"variable_name\":\"GITHUB_TOKEN\",\"value\":\"ghp_example\"}'",
    ]);
  }

  if (endpoint.id === 'memory-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/memory_stores/memstore_.../memories' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"path\":\"/notes/release\",\"content\":\"Keep release notes concise.\"}'",
    ]);
  }

  if (endpoint.id === 'api-keys-create') {
    return joinCurlLines([
      `curl -sS -X POST '${context.baseUrl}/v1/api-keys' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl,
      "  -d '{\"name\":\"Local Console\"}'",
    ]);
  }

  if (endpoint.method === 'GET') return `curl -sS '${context.baseUrl}${endpoint.path}'`;
  if (endpoint.method === 'DELETE') {
    return joinCurlLines([
      `curl -sS -X DELETE '${context.baseUrl}${endpoint.path}' \\`,
      authCurl,
    ]);
  }
  return joinCurlLines([
    `curl -sS -X ${endpoint.method} '${context.baseUrl}${endpoint.path}' \\`,
    "  -H 'Content-Type: application/json' \\",
    authCurl,
    "  -d '{}'",
  ]);
}

export function buildSdkSnippet(context: ApiReferenceExampleContext) {
  const sdkAuth = context.authEnabled ? "\n  apiKey: process.env.MANAGED_AGENTS_API_KEY," : '';

  return `import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: '${context.baseUrl}',${sdkAuth}
});

const session = await client.sessions.create({
  agent: '${context.firstAgentId}',
  environment_id: '${context.firstEnvironmentId}',
  title: 'SDK smoke test',
});

for await (const event of client.sessions.chat(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}`;
}

export const skillJsonSnippet = `{
  "files": [
    {
      "path": "code-review-assistant/SKILL.md",
      "content": "---\\nname: code-review-assistant\\ndescription: Review TypeScript changes for correctness, tests, and API compatibility.\\n---\\n\\nUse this skill when reviewing code changes."
    }
  ],
  "display_title": "Code review assistant"
}`;

export const skillAttachSnippet = `name: Incident commander
description: Triages a Sentry alert, opens a Linear incident ticket, and runs the Slack war room.
model:
  id: claude-opus-4-8
  speed: standard
system: |-
  You are an on-call incident commander.
tools:
  - type: agent_toolset_20260401
skills:
  - type: custom
    skill_id: skill_...
metadata:
  template: incident-commander`;
