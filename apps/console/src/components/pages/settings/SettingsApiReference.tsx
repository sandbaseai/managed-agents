import { Copy, Search } from 'lucide-react';
import { useState } from 'react';
import type { ConsoleData } from '../../../types';
import { copyText } from '../../../lib/format';
import { ApiCodeCard, ApiMethodBadge, ApiParamSection } from './ApiReferencePrimitives';
import type { ApiReferenceEndpoint } from './apiReferenceTypes';
import {
  buildApiEndpointExample,
  buildSdkSnippet,
  skillAttachSnippet,
  skillJsonSnippet,
  type ApiReferenceExampleContext,
} from './apiReferenceExamples';
import {
  buildDefaultHeaders,
  getEndpointGroups,
  getVisibleApiEndpoints,
  selectVisibleApiEndpoint,
} from './apiReferenceSelectors';

type SettingsApiReferenceProps = {
  data: ConsoleData;
  docs: ApiReferenceEndpoint[];
};

export const DEFAULT_API_REFERENCE_ENDPOINT_ID = 'sessions-create';

export function SettingsApiReference({ data, docs }: SettingsApiReferenceProps) {
  const baseUrl = typeof window === 'undefined' ? 'http://127.0.0.1:3000' : window.location.origin;
  const authEnabled = data.runtime?.auth_enabled ?? false;
  const firstAgentId = data.agents[0]?.id ?? 'agent_...';
  const firstEnvironmentId = data.environments[0]?.id ?? 'env_...';
  const firstSessionId = data.sessions[0]?.id ?? 'sess_...';
  const exampleContext: ApiReferenceExampleContext = {
    baseUrl,
    authEnabled,
    firstAgentId,
    firstEnvironmentId,
    firstSessionId,
  };
  const sdkSnippet = buildSdkSnippet(exampleContext);
  const [activeEndpointId, setActiveEndpointId] = useState(DEFAULT_API_REFERENCE_ENDPOINT_ID);
  const [search, setSearch] = useState('');
  const visibleDocs = getVisibleApiEndpoints(docs, search);
  const endpointGroups = getEndpointGroups(visibleDocs);
  const activeEndpoint = selectVisibleApiEndpoint(visibleDocs, activeEndpointId);
  const showSkillNotes = activeEndpoint?.group === 'Skills';

  if (docs.length === 0) {
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

  if (!activeEndpoint) {
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
            <label className="apiDocsSearch">
              <Search size={15} />
              <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search endpoints..." />
            </label>
            <div className="apiDocsRuntime">
              <span>Base URL</span>
              <code>{baseUrl}</code>
            </div>
            <p className="formHint">No endpoints match this search.</p>
          </aside>

          <article className="apiDocsArticle">
            <h2>No matching endpoint</h2>
            <p className="apiDocsSummary">Try a different endpoint name, method, path, or group.</p>
          </article>
        </div>
      </section>
    );
  }

  const headers = activeEndpoint.headers ?? buildDefaultHeaders(activeEndpoint, authEnabled);
  const endpointExample = buildApiEndpointExample(activeEndpoint, exampleContext);

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
          <label className="apiDocsSearch">
            <Search size={15} />
            <input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Search endpoints..." />
          </label>
          <div className="apiDocsRuntime">
            <span>Base URL</span>
            <code>{baseUrl}</code>
          </div>
          {endpointGroups.map((group) => (
            <div className="apiDocsNavGroup" key={group}>
              <strong>{group}</strong>
              {visibleDocs.filter((endpoint) => endpoint.group === group).map((endpoint) => (
                <button
                  type="button"
                  key={endpoint.id}
                  className={`apiDocsNavItem ${endpoint.id === activeEndpoint.id ? 'active' : ''}`}
                  aria-current={endpoint.id === activeEndpoint.id ? 'page' : undefined}
                  onClick={() => setActiveEndpointId(endpoint.id)}
                >
                  <ApiMethodBadge method={endpoint.method} variant="square" />
                  <span>{endpoint.title}</span>
                </button>
              ))}
            </div>
          ))}
          {visibleDocs.length === 0 ? <p className="formHint">No endpoints match this search.</p> : null}
        </aside>

        <article className="apiDocsArticle">
          <div className="apiDocsArticleHeader">
            <div>
              <h2>{activeEndpoint.title}</h2>
              <div className="apiDocsPath">
                <ApiMethodBadge method={activeEndpoint.method} />
                <code>{activeEndpoint.path}</code>
              </div>
            </div>
            <button className="secondaryButton" type="button" onClick={() => copyText(`${activeEndpoint.method} ${activeEndpoint.path}`)}>
              <Copy size={15} /> Copy endpoint
            </button>
          </div>
          <p className="apiDocsSummary">{activeEndpoint.summary}</p>

          <ApiParamSection title="Header parameters" fields={headers} emptyLabel="No header parameters." />

          <ApiParamSection
            title={activeEndpoint.method === 'GET' ? 'Query parameters' : 'Body parameters'}
            fields={activeEndpoint.parameters ?? []}
            emptyLabel={activeEndpoint.method === 'GET' ? 'No query parameters.' : 'No body parameters.'}
          />

          <ApiParamSection title="Returns" fields={activeEndpoint.response} emptyLabel="No response schema documented." response />

          {showSkillNotes ? <section className="apiDocsSection">
            <h3>Skills package notes</h3>
            <p>Skill uploads follow Claude's package rule: one top-level folder containing <code>SKILL.md</code> at its root. The runtime derives the custom skill name from that package metadata and generates a random <code>skill_...</code> id.</p>
            <pre className="metricsPreview">code-review-assistant/{'\n'}  SKILL.md{'\n'}  references/checklist.md</pre>
          </section> : null}

          <section className="apiDocsSection apiDocsExamples" aria-label="API examples">
            <h3>Examples</h3>
            <div className="apiDocsExampleGrid">
              <ApiCodeCard title="Example request" code={endpointExample} copyLabel="Copy request" />
              <ApiCodeCard title="TypeScript SDK" code={sdkSnippet} copyLabel="Copy SDK snippet" />
              <ApiCodeCard title="Skill JSON upload" code={skillJsonSnippet} copyLabel="Copy Skill JSON" />
              <ApiCodeCard title="Agent skill reference" code={skillAttachSnippet} />
            </div>
          </section>
        </article>
      </div>
    </section>
  );
}
