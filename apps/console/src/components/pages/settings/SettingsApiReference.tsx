import { Copy, Search } from 'lucide-react';
import { useState } from 'react';
import type { ConsoleData } from '../../../types';
import { copyText } from '../../../lib/format';

export type ApiReferenceField = {
  name: string;
  type: string;
  description: string;
  required?: boolean;
};

export type ApiReferenceEndpoint = {
  id: string;
  group: string;
  title: string;
  method: 'GET' | 'POST' | 'PUT' | 'DELETE';
  path: string;
  summary: string;
  headers?: ApiReferenceField[];
  parameters?: ApiReferenceField[];
  response: ApiReferenceField[];
};

type SettingsApiReferenceProps = {
  data: ConsoleData;
  docs: ApiReferenceEndpoint[];
};

export function SettingsApiReference({ data, docs }: SettingsApiReferenceProps) {
  const baseUrl = typeof window === 'undefined' ? 'http://127.0.0.1:3000' : window.location.origin;
  const authEnabled = data.runtime?.auth_enabled ?? false;
  const firstAgentId = data.agents[0]?.id ?? 'agent_...';
  const firstEnvironmentId = data.environments[0]?.id ?? 'env_...';
  const firstSessionId = data.sessions[0]?.id ?? 'sess_...';
  const authCurl = authEnabled ? "  -H 'Authorization: Bearer ma_...' \\\n" : '';
  const sdkAuth = authEnabled ? "\n  apiKey: process.env.MANAGED_AGENTS_API_KEY," : '';
  const sessionCurl = [
    `curl -sS -X POST '${baseUrl}/v1/sessions' \\`,
    "  -H 'Content-Type: application/json' \\",
    authCurl.trimEnd(),
    `  -d '{"agent":"${firstAgentId}","environment_id":"${firstEnvironmentId}","title":"API smoke test"}'`,
    '',
    `curl -N -X POST '${baseUrl}/v1/sessions/${firstSessionId}/messages' \\`,
    "  -H 'Content-Type: application/json' \\",
    authCurl.trimEnd(),
    "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
  ].filter(Boolean).join('\n');
  const sdkSnippet = `import { ManagedAgentsClient } from 'managed-agents/sdk';

const client = new ManagedAgentsClient({
  baseUrl: '${baseUrl}',${sdkAuth}
});

const session = await client.sessions.create({
  agent: '${firstAgentId}',
  environment_id: '${firstEnvironmentId}',
  title: 'SDK smoke test',
});

for await (const event of client.sessions.chat(session.id, 'Hello')) {
  if (event.type === 'agent.message_chunk') {
    process.stdout.write(event.delta ?? '');
  }
}`;
  const skillUploadSnippet = [
    'zip -r code-review-assistant.zip code-review-assistant',
    '',
    `curl -sS -X POST '${baseUrl}/v1/skills' \\`,
    authCurl.trimEnd(),
    "  -F 'files=@code-review-assistant.zip'",
  ].filter(Boolean).join('\n');
  const skillJsonSnippet = `{
  "files": [
    {
      "path": "code-review-assistant/SKILL.md",
      "content": "---\\nname: code-review-assistant\\ndescription: Review TypeScript changes for correctness, tests, and API compatibility.\\n---\\n\\nUse this skill when reviewing code changes."
    }
  ],
  "display_title": "Code review assistant"
}`;
  const skillAttachSnippet = `name: Incident commander
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
  const [activeEndpointId, setActiveEndpointId] = useState('sessions-create');
  const endpointGroups = Array.from(new Set(docs.map((endpoint) => endpoint.group)));
  const activeEndpoint = docs.find((endpoint) => endpoint.id === activeEndpointId) ?? docs[0];

  if (!activeEndpoint) {
    return (
      <section className="stack apiReference">
        <div className="pageIntro">
          <div>
            <h1>API reference</h1>
            <p>No API reference endpoints are available.</p>
          </div>
        </div>
      </section>
    );
  }

  const headers = activeEndpoint.headers ?? [
    { name: 'Content-Type', type: 'application/json', description: 'Required for JSON request bodies.', required: activeEndpoint.method !== 'GET' },
    { name: 'Authorization', type: 'Bearer token', description: authEnabled ? 'Required when local API authentication is enabled.' : 'Optional while local API authentication is disabled.' },
    { name: 'anthropic-beta', type: 'string', description: 'Accepted for Claude Managed Agents-compatible clients.' },
  ];
  const endpointExample = activeEndpoint.id === 'sessions-create' ? sessionCurl
    : activeEndpoint.id === 'sessions-message' ? [
      `curl -N -X POST '${baseUrl}/v1/sessions/${firstSessionId}/messages' \\`,
      "  -H 'Content-Type: application/json' \\",
      authCurl.trimEnd(),
      "  -d '{\"content\":\"Hello from the API\",\"stream\":true}'",
    ].filter(Boolean).join('\n')
      : activeEndpoint.id === 'agents-create' ? [
        `curl -sS -X POST '${baseUrl}/v1/agents' \\`,
        "  -H 'Content-Type: application/json' \\",
        authCurl.trimEnd(),
        "  -d '{",
        '    "name": "assistant",',
        '    "description": "Helps with development tasks.",',
        '    "model": { "id": "claude-opus-4-8", "speed": "standard" },',
        '    "system": "You are a helpful assistant.",',
        '    "tools": [{ "type": "agent_toolset_20260401" }],',
        '    "skills": []',
        "  }'",
      ].filter(Boolean).join('\n')
        : activeEndpoint.id === 'skills-create' ? skillUploadSnippet
          : activeEndpoint.id === 'files-upload' ? [
            `curl -sS -X POST '${baseUrl}/v1/files' \\`,
            authCurl.trimEnd(),
            "  -F 'file=@notes.txt'",
          ].filter(Boolean).join('\n')
            : activeEndpoint.id === 'environments-create' ? [
              `curl -sS -X POST '${baseUrl}/v1/environments' \\`,
              "  -H 'Content-Type: application/json' \\",
              authCurl.trimEnd(),
              "  -d '{\"name\":\"local-dev\",\"hosting_type\":\"self_hosted\",\"network\":{\"type\":\"limited\"}}'",
            ].filter(Boolean).join('\n')
              : activeEndpoint.id === 'vaults-credential-create' ? [
                `curl -sS -X POST '${baseUrl}/v1/credential-vaults/vlt_.../credentials' \\`,
                "  -H 'Content-Type: application/json' \\",
                authCurl.trimEnd(),
                "  -d '{\"auth_type\":\"environment_variable\",\"variable_name\":\"GITHUB_TOKEN\",\"value\":\"ghp_example\"}'",
              ].filter(Boolean).join('\n')
                : activeEndpoint.id === 'memory-create' ? [
                  `curl -sS -X POST '${baseUrl}/v1/memory_stores/memstore_.../memories' \\`,
                  "  -H 'Content-Type: application/json' \\",
                  authCurl.trimEnd(),
                  "  -d '{\"path\":\"/notes/release\",\"content\":\"Keep release notes concise.\"}'",
                ].filter(Boolean).join('\n')
                  : activeEndpoint.id === 'api-keys-create' ? [
                    `curl -sS -X POST '${baseUrl}/v1/api-keys' \\`,
                    "  -H 'Content-Type: application/json' \\",
                    authCurl.trimEnd(),
                    "  -d '{\"name\":\"Local Console\"}'",
                  ].filter(Boolean).join('\n')
                    : `curl -sS '${baseUrl}${activeEndpoint.path}'`;

  return (
    <section className="stack apiReference">
      <div className="pageIntro">
        <div>
          <h1>API reference</h1>
          <p>Use these endpoints to automate managed-agents from local scripts, SDKs, CI jobs, and external tools.</p>
        </div>
      </div>

      <div className="apiDocsShell">
        <aside className="apiDocsNav" aria-label="API endpoints">
          <div className="apiDocsSearch">
            <Search size={15} />
            <span>Search endpoints...</span>
          </div>
          <div className="apiDocsRuntime">
            <span>Base URL</span>
            <code>{baseUrl}</code>
          </div>
          {endpointGroups.map((group) => (
            <div className="apiDocsNavGroup" key={group}>
              <strong>{group}</strong>
              {docs.filter((endpoint) => endpoint.group === group).map((endpoint) => (
                <button
                  type="button"
                  key={endpoint.id}
                  className={`apiDocsNavItem ${endpoint.id === activeEndpoint.id ? 'active' : ''}`}
                  onClick={() => setActiveEndpointId(endpoint.id)}
                >
                  <span className={`methodSquare method${endpoint.method}`}>{endpoint.method}</span>
                  <span>{endpoint.title}</span>
                </button>
              ))}
            </div>
          ))}
        </aside>

        <article className="apiDocsArticle">
          <div className="apiDocsArticleHeader">
            <div>
              <h2>{activeEndpoint.title}</h2>
              <div className="apiDocsPath">
                <span className={`methodPill method${activeEndpoint.method}`}>{activeEndpoint.method}</span>
                <code>{activeEndpoint.path}</code>
              </div>
            </div>
            <button className="button secondary" type="button" onClick={() => copyText(`${activeEndpoint.method} ${activeEndpoint.path}`)}>
              <Copy size={15} /> Copy endpoint
            </button>
          </div>
          <p className="apiDocsSummary">{activeEndpoint.summary}</p>

          <section className="apiDocsSection">
            <h3>Header parameters</h3>
            <div className="apiParamList">
              {headers.map((field) => (
                <div className="apiParamRow" key={field.name}>
                  <div>
                    <strong>{field.name}</strong>
                    {field.required ? <span>required</span> : <span>optional</span>}
                  </div>
                  <p><code>{field.type}</code> {field.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="apiDocsSection">
            <h3>{activeEndpoint.method === 'GET' ? 'Query parameters' : 'Body parameters'}</h3>
            <div className="apiParamList">
              {(activeEndpoint.parameters ?? []).map((field) => (
                <div className="apiParamRow" key={field.name}>
                  <div>
                    <strong>{field.name}</strong>
                    {field.required ? <span>required</span> : <span>optional</span>}
                  </div>
                  <p><code>{field.type}</code> {field.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="apiDocsSection">
            <h3>Returns</h3>
            <div className="apiParamList">
              {activeEndpoint.response.map((field) => (
                <div className="apiParamRow" key={field.name}>
                  <div>
                    <strong>{field.name}</strong>
                    <span>{field.type}</span>
                  </div>
                  <p>{field.description}</p>
                </div>
              ))}
            </div>
          </section>

          <section className="apiDocsSection">
            <h3>Skills package notes</h3>
            <p>Skill uploads follow Claude's package rule: one top-level folder containing <code>SKILL.md</code> at its root. The runtime derives the custom skill name from that package metadata and generates a random <code>skill_...</code> id.</p>
            <pre className="metricsPreview">code-review-assistant/{'\n'}  SKILL.md{'\n'}  references/checklist.md</pre>
          </section>

          <section className="apiDocsSection apiDocsExamples" aria-label="API examples">
            <h3>Examples</h3>
            <div className="apiDocsExampleGrid">
              <div className="apiDocsCodeCard">
                <div className="snippetHeader">
                  <h2>Example request</h2>
                  <button className="iconButton" type="button" title="Copy request" aria-label="Copy request" onClick={() => copyText(endpointExample)}>
                    <Copy size={15} />
                  </button>
                </div>
                <pre className="metricsPreview apiSnippet">{endpointExample}</pre>
              </div>
              <div className="apiDocsCodeCard">
                <div className="snippetHeader">
                  <h2>TypeScript SDK</h2>
                  <button className="iconButton" type="button" title="Copy SDK snippet" aria-label="Copy SDK snippet" onClick={() => copyText(sdkSnippet)}>
                    <Copy size={15} />
                  </button>
                </div>
                <pre className="metricsPreview apiSnippet">{sdkSnippet}</pre>
              </div>
              <div className="apiDocsCodeCard">
                <div className="snippetHeader">
                  <h2>Skill JSON upload</h2>
                  <button className="iconButton" type="button" title="Copy Skill JSON" aria-label="Copy Skill JSON" onClick={() => copyText(skillJsonSnippet)}>
                    <Copy size={15} />
                  </button>
                </div>
                <pre className="metricsPreview apiSnippet">{skillJsonSnippet}</pre>
              </div>
              <div className="apiDocsCodeCard">
                <h2>Agent skill reference</h2>
                <pre className="metricsPreview apiSnippet">{skillAttachSnippet}</pre>
              </div>
            </div>
          </section>
        </article>
      </div>
    </section>
  );
}
