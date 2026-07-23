import {
  Archive,
  Copy,
  FileText,
  Globe,
  KeyRound,
  MoreVertical,
  Pencil,
  Plus,
  RefreshCw,
  Server,
  Trash2,
  X,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { getJson, postJson, putJson } from '../../api';
import { EmptyState, FilterSelect, StatusPill, SummaryStrip, Toolbar } from '../Common';
import { copyText, formatDateShort, relativeDate, shortId, titleCase, truncateMiddle } from '../../lib/format';
import type {
  ConsoleData,
  Environment,
  EnvironmentDraft,
  EnvironmentHostingType,
  EnvironmentNetworkType,
  EnvironmentPackageDraft,
  EnvironmentWorkerKeyCreateResponse,
  MetadataDraft,
  Page,
  Session,
  WorkItem,
} from '../../types';

export function Environments({ data, onNew, onOpenEnvironment }: { data: ConsoleData; onNew: () => void; onOpenEnvironment: (environment: Environment) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const environments = data.environments.filter((environment) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || environment.status === status;
    const matchesQuery = environment.id.toLowerCase().includes(q) || environment.name.toLowerCase().includes(q) || environment.description.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
  const activeEnvironments = data.environments.filter((environment) => environment.status === 'active').length;
  const selfHostedEnvironments = data.environments.filter((environment) => environmentHostingType(environment) === 'self_hosted').length;

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Environments</h1>
          <p>Define reusable execution templates for sandbox, package, network, and worker policy.</p>
        </div>
        <div className="toolbarActions">
          <button className="primaryButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create environment
          </button>
        </div>
      </div>
      <SummaryStrip items={[
        { label: 'Templates', value: data.environments.length, icon: <Server size={18} /> },
        { label: 'Active', value: activeEnvironments, icon: <RefreshCw size={18} /> },
        { label: 'Self-hosted', value: selfHostedEnvironments, icon: <KeyRound size={18} /> },
        { label: 'Sessions', value: data.sessions.length, icon: <Globe size={18} /> },
      ]} />
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={(
          <FilterSelect
            label="Status"
            value={status}
            onChange={setStatus}
            options={[
              { value: 'all', label: 'All' },
              { value: 'active', label: 'Active' },
              { value: 'archived', label: 'Archived' },
            ]}
          />
        )}
      />
      <div className="tablePanel environmentsTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Type</th>
              <th>Updated at</th>
            </tr>
          </thead>
          <tbody>
            {environments.map((environment) => (
              <tr key={environment.id} className="clickableRow" onClick={() => onOpenEnvironment(environment)}>
                <td><strong className="monoText">{shortId(environment.id)}</strong></td>
                <td>{environment.name}</td>
                <td><StatusPill status={environment.status} /></td>
                <td><span className="softChip inlineChip">{environmentKind(environment)}</span></td>
                <td>{formatDateShort(environment.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {environments.length === 0 ? (
          <EmptyState
            icon={<Server size={22} />}
            title="No environments"
            body="Create an environment template to define sandbox, package, and network policy for sessions."
            action={<button className="primaryButton" type="button" onClick={onNew}><Plus size={16} />Create environment</button>}
          />
        ) : null}
      </div>
      <div className="mobileResourceList">
        {environments.map((environment) => (
          <button className="mobileResourceCard" type="button" key={environment.id} onClick={() => onOpenEnvironment(environment)}>
            <span className="mobileAgentMain">
              <strong>{environment.name}</strong>
              <small className="monoText">{environment.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{environmentKind(environment)}</span>
              <StatusPill status={environment.status} />
            </span>
          </button>
        ))}
        {environments.length === 0 ? (
          <EmptyState
            icon={<Server size={22} />}
            title="No environments"
            body="Create an environment template to define sandbox, package, and network policy for sessions."
            action={<button className="primaryButton" type="button" onClick={onNew}><Plus size={16} />Create environment</button>}
          />
        ) : null}
      </div>
    </section>
  );
}

export function EnvironmentDetail({ environment, data, onBack, onRefresh }: { environment: Environment; data: ConsoleData; onBack: () => void; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const environmentSessions = data.sessions.filter((session) => session.environment_id === environment.id);
  const isSelfHosted = environmentHostingType(environment) === 'self_hosted';
  const network = environmentNetwork(environment);
  const packages = environmentPackages(environment);
  const keys = environmentWorkerKeys(environment);

  useEffect(() => {
    setEditing(false);
    setMenuOpen(false);
  }, [environment.id]);

  const archive = async () => {
    await postJson(`/v1/environments/${environment.id}/archive`, {});
    setMenuOpen(false);
    onBack();
    onRefresh();
  };

  if (editing) {
    return (
      <EnvironmentEditor
        environment={environment}
        onCancel={() => setEditing(false)}
        onSaved={() => {
          setEditing(false);
          onRefresh();
        }}
      />
    );
  }

  return (
    <section className="environmentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Environments</button>
        <span>/</span>
        <strong>{environment.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{environment.name}</h1>
            <StatusPill status={environment.status} />
            <span className="softChip inlineChip">{environmentKind(environment)}</span>
            <Globe size={19} className="mutedIcon" />
          </div>
          <p className="mutedLine"><span className="monoText">{shortId(environment.id)}</span> · Last updated {formatDateShort(environment.updated_at)}</p>
          <p className="agentDescription">{environment.description || 'No description yet. Add one to explain when this execution template should be used.'}</p>
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={() => setEditing(true)}>
            <Pencil size={18} />
            Edit
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Environment actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Archive size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SummaryStrip items={[
        { label: 'Backend', value: environmentBackendLabel(environment), icon: <Server size={18} /> },
        { label: 'Sessions', value: environmentSessions.length, icon: <Globe size={18} /> },
        { label: 'Packages', value: packages.length, icon: <FileText size={18} /> },
        { label: isSelfHosted ? 'Worker keys' : 'Network', value: isSelfHosted ? keys.length : titleCase(network.type), icon: isSelfHosted ? <KeyRound size={18} /> : <RefreshCw size={18} /> },
      ]} />
      <div className="resourceTruthStrip" aria-label="Environment truth model">
        <div><span>Template</span><strong>Environments describe reusable session policy, not the global sandbox backend.</strong></div>
        <div><span>Runtime match</span><strong>Settings → Sandbox chooses the active provider this template must run against.</strong></div>
        <div><span>Validation target</span><strong>Package, network, and worker policy should be validated before production use.</strong></div>
      </div>

      {isSelfHosted ? <SelfHostedEnvironment environment={environment} sessions={environmentSessions} onRefresh={onRefresh} /> : <CloudEnvironment environment={environment} />}
    </section>
  );
}

function CloudEnvironment({ environment }: { environment: Environment }) {
  const network = environmentNetwork(environment);
  const packages = environmentPackages(environment);
  const metadata = environmentMetadataEntries(environment);
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Networking</h2>
        <p>Configure network access policies for this environment.</p>
        <div className="readonlyFields">
          <ReadonlyField label="Type" value={titleCase(network.type)} />
          <ReadonlyField label="Allow MCP server network access" value={network.allowMcp ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allow package manager network access" value={network.allowPackageManager ? 'Enabled' : 'Disabled'} />
          <ReadonlyField label="Allowed hosts" value={network.allowedHosts.length ? network.allowedHosts.join(', ') : 'None provided'} wide />
        </div>
      </section>
      <section className="environmentSection">
        <h2>Packages</h2>
        <p>Specify packages and their versions available in this environment. Separate multiple values with spaces.</p>
        <ReadonlyTable
          empty="No packages configured"
          rows={packages.map((item) => [item.manager, item.package])}
          columns={['Manager', 'Package']}
        />
      </section>
      <section className="environmentSection">
        <h2>Metadata</h2>
        <p>Add custom key-value pairs to tag and organize this environment. Keys must be lowercase.</p>
        <ReadonlyTable
          empty="No metadata"
          rows={metadata}
          columns={['Key', 'Value']}
        />
      </section>
    </div>
  );
}

function SelfHostedEnvironment({ environment, sessions, onRefresh }: { environment: Environment; sessions: Session[]; onRefresh?: () => void }) {
  const keys = environmentWorkerKeys(environment);
  const [creating, setCreating] = useState(false);
  const [newKey, setNewKey] = useState<EnvironmentWorkerKeyCreateResponse | null>(null);
  const [workItems, setWorkItems] = useState<WorkItem[]>([]);
  const [queueStats, setQueueStats] = useState<Record<string, number>>(environment.work_queue ?? {});
  const [queueError, setQueueError] = useState<string | null>(null);
  const [setupVisible, setSetupVisible] = useState(true);
  const idleSessions = sessions.filter((session) => session.status === 'idle');
  const runningSessions = sessions.filter((session) => session.status === 'running');
  const completedSessions = sessions.filter((session) => session.status === 'terminated');
  const oldestActiveSession = [...idleSessions, ...runningSessions].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];

  const refreshQueue = async () => {
    try {
      const page = await getJson<Page<WorkItem> & { stats: Record<string, number> }>(`/v1/environments/${environment.id}/work-items?limit=12`);
      setWorkItems(page.data);
      setQueueStats(page.stats ?? {});
      setQueueError(null);
    } catch (err: any) {
      setQueueError(err.message ?? 'Failed to load work queue');
    }
  };

  useEffect(() => {
    setQueueStats(environment.work_queue ?? {});
    void refreshQueue();
  }, [environment.id]);

  const createKey = async () => {
    setCreating(true);
    try {
      const key = await postJson<EnvironmentWorkerKeyCreateResponse>(`/v1/environments/${environment.id}/worker-keys`, {
        name: `Worker ${keys.length + 1}`,
      });
      setNewKey(key);
      onRefresh?.();
    } finally {
      setCreating(false);
    }
  };

  const revokeKey = async (keyId: string) => {
    await postJson(`/v1/environments/${environment.id}/worker-keys/${keyId}/revoke`, {});
    onRefresh?.();
  };

  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Overview</h2>
        <p>Live session activity for this self-hosted environment. Updates every few seconds.</p>
        <div className="metricGrid compactMetrics">
          <MetricCard title="Idle sessions" value={idleSessions.length} />
          <MetricCard title="Running sessions" value={runningSessions.length} />
          <MetricCard title="Completed sessions" value={completedSessions.length} />
          <MetricCard title="Oldest active session" value={oldestActiveSession ? relativeDate(oldestActiveSession.created_at) : 'None'} />
          <MetricCard title="Pending jobs" value={queueStats.pending ?? 0} />
          <MetricCard title="Claimed jobs" value={queueStats.claimed ?? 0} />
        </div>
      </section>
      <div className="selfHostedGrid">
        <section className="environmentSection">
          <div className="sectionTitleRow">
            <div>
              <h2>Environment keys</h2>
              <p>An environment key lets a runner on your infrastructure connect to this environment and pull jobs. Generate one per host so you can revoke access individually.</p>
            </div>
            <button className="secondaryButton" type="button" onClick={() => void createKey()} disabled={creating}>
              <KeyRound size={16} />
              {creating ? 'Generating…' : 'Generate key'}
            </button>
          </div>
          {newKey ? (
            <div className="secretReveal">
              <strong>Copy this worker key now. It will not be shown again.</strong>
              <code>{newKey.secret_key}</code>
              <button type="button" className="secondaryButton" onClick={() => void copyText(newKey.secret_key)}><Copy size={15} />Copy</button>
            </div>
          ) : null}
          <div className="readonlyTable">
            {keys.length === 0 ? (
              <EmptyState
                icon={<KeyRound size={22} />}
                title="No environment keys"
                body="Generate a scoped key when you are ready to connect a self-hosted runner."
              />
            ) : (
              <table>
                <thead><tr><th>Name</th><th>Prefix</th><th>Status</th><th>Last seen</th><th>Created</th><th /></tr></thead>
                <tbody>
                  {keys.map((key) => (
                    <tr key={key.id}>
                      <td>{key.name}</td>
                      <td><code>{key.key_prefix}</code></td>
                      <td><StatusPill status={key.status} /></td>
                      <td>{key.last_seen_at ? relativeDate(key.last_seen_at) : <span className="mutedValue">Never</span>}</td>
                      <td>{formatDateShort(key.created_at)}</td>
                      <td>
                        {key.status === 'active' ? (
                          <button className="textButton dangerText" type="button" onClick={() => void revokeKey(key.id)}>Revoke</button>
                        ) : null}
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        <section className="environmentSection">
          <div className="sectionTitleRow">
            <div>
              <h2>Work queue</h2>
              <p>Recent self-hosted jobs scoped to this environment.</p>
            </div>
            <button className="iconButton quiet" type="button" onClick={() => void refreshQueue()} title="Refresh queue">
              <RefreshCw size={16} />
            </button>
          </div>
          {queueError ? <p className="errorText">{queueError}</p> : null}
          <div className="readonlyTable">
            {workItems.length === 0 ? (
              <EmptyState
                icon={<RefreshCw size={22} />}
                title="No queued work items"
                body="New session work will appear here after a self-hosted runner starts polling this environment."
              />
            ) : (
              <table>
                <thead><tr><th>ID</th><th>Session</th><th>Kind</th><th>Status</th><th>Claimed by</th><th>Created</th></tr></thead>
                <tbody>
                  {workItems.map((item) => (
                    <tr key={item.id}>
                      <td><code>{truncateMiddle(item.id, 18)}</code></td>
                      <td><code>{truncateMiddle(item.session_id, 18)}</code></td>
                      <td>{item.kind}</td>
                      <td><StatusPill status={item.status} /></td>
                      <td>{item.claimed_by ?? <span className="mutedValue">—</span>}</td>
                      <td>{item.created_at ? relativeDate(item.created_at) : <span className="mutedValue">—</span>}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            )}
          </div>
        </section>
        {setupVisible ? (
          <section className="setupCard">
            <div className="setupHeader">
              <h2>Set up your self-hosted environment</h2>
              <button className="iconButton quiet" type="button" title="Dismiss setup" onClick={() => setSetupVisible(false)}><X size={18} /></button>
            </div>
            <p>An environment key lets a runner on your infrastructure connect to this environment and pull jobs. Generate one per host so you can revoke access individually.</p>
            <p>These instructions guide you through a low-code CLI worker setup. Additional options are also available in public documentation.</p>
            <SetupStep index={1} title="Generate an environment key" body="Generate one key per host from this page so you can revoke access independently." />
            <SetupStep index={2} title="Export environment key as env var" body="This authorizes the environment worker to pull work only for this environment." code={`export MANAGED_AGENTS_ENVIRONMENT_KEY='${newKey?.secret_key ?? 'mawk_...'}'`} />
            <SetupStep index={3} title="Install managed-agents CLI" body="Run this command on the machine where you want the environment worker to run." code="npm install -g managed-agents" />
            <SetupStep index={4} title="Invoke the worker" body="Poll for jobs and execute them locally." code={`managed-agents worker poll \\\n  --environment-id "${environment.id}" \\\n  --workdir "/workspace"`} />
          </section>
        ) : null}
      </div>
    </div>
  );
}

function EnvironmentEditor({ environment, onCancel, onSaved }: { environment: Environment; onCancel: () => void; onSaved: () => void }) {
  const [draft, setDraft] = useState<EnvironmentDraft>(() => environmentDraftFromApi(environment));
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  useEffect(() => {
    setDraft(environmentDraftFromApi(environment));
  }, [environment.id]);

  const save = async () => {
    setSaving(true);
    setError('');
    try {
      await putJson(`/v1/environments/${environment.id}`, environmentPayloadFromDraft(draft));
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="environmentDetail editingEnvironment">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onCancel}>Environments</button>
        <span>/</span>
        <strong>{environment.name}</strong>
      </div>
      {error ? <div className="banner error inlineBanner">{error}</div> : null}
      <div className="resourceHero editHero">
        <div className="editTitleGroup">
          <input className="titleInput" value={draft.name} onChange={(event) => setDraft({ ...draft, name: event.target.value.slice(0, 50) })} />
          <span className="softChip inlineChip">{hostingLabel(draft.hostingType)}</span>
          <Globe size={19} className="mutedIcon" />
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={onCancel}>Cancel</button>
          <button className="primaryButton largeAction" type="button" onClick={() => void save()} disabled={saving || !draft.name.trim()}>Save</button>
        </div>
      </div>

      <label className="editField">
        Description
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Add a description for this environment (optional)" />
      </label>

      {draft.hostingType === 'self_hosted' ? (
        <section className="environmentSection editorNoticeCard">
          <h2>Self-hosted runtime settings</h2>
          <p>This edit view updates the environment name and description. Worker keys, queue state, and setup instructions stay in the environment detail view so operational controls are not mixed with metadata editing.</p>
        </section>
      ) : (
        <EnvironmentNetworkEditor draft={draft} onDraft={setDraft} />
      )}
    </section>
  );
}

function EnvironmentNetworkEditor({ draft, onDraft }: { draft: EnvironmentDraft; onDraft: (draft: EnvironmentDraft) => void }) {
  const updatePackage = (id: string, patch: Partial<EnvironmentPackageDraft>) => {
    onDraft({ ...draft, packages: draft.packages.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };
  const updateMetadata = (id: string, patch: Partial<MetadataDraft>) => {
    onDraft({ ...draft, metadata: draft.metadata.map((item) => item.id === id ? { ...item, ...patch } : item) });
  };
  return (
    <div className="environmentBody">
      <section className="environmentSection">
        <h2>Networking</h2>
        <p>Configure network access policies for this environment.</p>
        <label className="editField">
          Type
          <select value={draft.networkType} onChange={(event) => onDraft({ ...draft, networkType: event.target.value as EnvironmentNetworkType })}>
            <option value="unrestricted">Unrestricted</option>
            <option value="limited">Limited</option>
          </select>
        </label>
        <SwitchRow
          label="Allow MCP server network access"
          checked={draft.allowMcpServerNetworkAccess}
          onChecked={(checked) => onDraft({ ...draft, allowMcpServerNetworkAccess: checked })}
        />
        <SwitchRow
          label="Allow package manager network access"
          checked={draft.allowPackageManagerNetworkAccess}
          onChecked={(checked) => onDraft({ ...draft, allowPackageManagerNetworkAccess: checked })}
        />
        <label className="editField">
          Allowed hosts
          <textarea value={draft.allowedHosts} onChange={(event) => onDraft({ ...draft, allowedHosts: event.target.value })} placeholder="www.example1.com, www.example2.com" />
        </label>
      </section>
      <section className="environmentSection editableListSection">
        <div className="sectionHeaderRow">
          <div>
            <h2>Packages</h2>
            <p>Specify packages and their versions available in this environment. Separate multiple values with spaces.</p>
          </div>
          <button className="iconButton" type="button" onClick={() => onDraft({ ...draft, packages: [...draft.packages, { id: newDraftId(), manager: 'pip', package: '' }] })}><Plus size={18} /></button>
        </div>
        {draft.packages.length === 0 ? <ReadonlyTable empty="No packages configured" rows={[]} columns={['Manager', 'Package']} /> : null}
        {draft.packages.map((item) => (
          <div className="editableRow" key={item.id}>
            <select value={item.manager} onChange={(event) => updatePackage(item.id, { manager: event.target.value })}>
              <option value="pip">pip</option>
              <option value="npm">npm</option>
              <option value="apt">apt</option>
              <option value="brew">brew</option>
            </select>
            <input value={item.package} onChange={(event) => updatePackage(item.id, { package: event.target.value })} placeholder="package package==1.0.0" />
            <button className="iconButton quiet" type="button" onClick={() => onDraft({ ...draft, packages: draft.packages.filter((candidate) => candidate.id !== item.id) })}><Trash2 size={18} /></button>
          </div>
        ))}
      </section>
      <section className="environmentSection editableListSection">
        <div className="sectionHeaderRow">
          <div>
            <h2>Metadata</h2>
            <p>Add custom key-value pairs to tag and organize this environment. Keys must be lowercase.</p>
          </div>
          <button className="iconButton" type="button" onClick={() => onDraft({ ...draft, metadata: [...draft.metadata, { id: newDraftId(), key: '', value: '' }] })}><Plus size={18} /></button>
        </div>
        {draft.metadata.length === 0 ? <ReadonlyTable empty="No metadata" rows={[]} columns={['Key', 'Value']} /> : null}
        {draft.metadata.map((item) => (
          <div className="editableRow metadataRow" key={item.id}>
            <input value={item.key} onChange={(event) => updateMetadata(item.id, { key: event.target.value.toLowerCase() })} placeholder="client_key..." />
            <input value={item.value} onChange={(event) => updateMetadata(item.id, { value: event.target.value })} placeholder="Value" />
            <button className="iconButton quiet" type="button" onClick={() => onDraft({ ...draft, metadata: draft.metadata.filter((candidate) => candidate.id !== item.id) })}><Trash2 size={18} /></button>
          </div>
        ))}
      </section>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: ReactNode; subtitle?: string }) {
  return (
    <div className="metricCard">
      <span>{title}</span>
      <strong>{value}</strong>
      {subtitle ? <small>{subtitle}</small> : null}
    </div>
  );
}

function ReadonlyField({ label, value, wide }: { label: string; value: string; wide?: boolean }) {
  return (
    <div className={`readonlyField ${wide ? 'wide' : ''}`}>
      <strong>{label}</strong>
      <span>{value}</span>
    </div>
  );
}

function ReadonlyTable({ columns, rows, empty }: { columns: string[]; rows: string[][]; empty: string }) {
  return (
    <div className="readonlyTable">
      {rows.length === 0 ? (
        <EmptyState
          icon={<FileText size={22} />}
          title={empty}
          body="This section is intentionally blank until the environment records real configuration."
        />
      ) : (
        <table>
          <thead><tr>{columns.map((column) => <th key={column}>{column}</th>)}</tr></thead>
          <tbody>
            {rows.map((row, index) => (
              <tr key={`${row.join('-')}-${index}`}>
                {row.map((cell, cellIndex) => <td key={`${cell}-${cellIndex}`}>{cell}</td>)}
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

function SwitchRow({ label, checked, onChecked }: { label: string; checked: boolean; onChecked: (checked: boolean) => void }) {
  return (
    <label className="switchRow">
      <span>{label}</span>
      <input type="checkbox" checked={checked} onChange={(event) => onChecked(event.target.checked)} />
    </label>
  );
}

function SetupStep({ index, title, body, code }: { index: number; title: string; body: string; code?: string }) {
  return (
    <div className="setupStep">
      <span>{index}</span>
      <div>
        <strong>{title}</strong>
        <p>{body}</p>
        {code ? <pre>{code}</pre> : null}
      </div>
    </div>
  );
}

export function environmentKind(environment: Environment) {
  return hostingLabel(environmentHostingType(environment));
}

function environmentBackendLabel(environment: Environment) {
  const backend = environment.sandbox_provider ?? environment.config.sandbox_provider;
  return typeof backend === 'string' && backend.trim() ? backend : environmentKind(environment);
}

function hostingLabel(type: EnvironmentHostingType) {
  if (type === 'self_hosted') return 'Self-hosted';
  if (type === 'local') return 'Local';
  return 'Cloud';
}

function environmentHostingType(environment: Environment): EnvironmentHostingType {
  const hostingType = environment.hosting_type ?? environment.config.hosting_type;
  const provider = environment.config.sandbox_provider;
  if (hostingType === 'self_hosted' || provider === 'self_hosted') return 'self_hosted';
  if (hostingType === 'local' || provider === 'local') return 'local';
  return 'cloud';
}

function environmentNetwork(environment: Environment) {
  const network = objectValue(environment.config.network);
  const allowedHosts = arrayOfStrings(network.allowed_hosts);
  return {
    type: (network.type === 'unrestricted' ? 'unrestricted' : 'limited') as EnvironmentNetworkType,
    allowMcp: Boolean(network.allow_mcp_server_network_access),
    allowPackageManager: Boolean(network.allow_package_manager_network_access),
    allowedHosts,
  };
}

function environmentPackages(environment: Environment): EnvironmentPackageDraft[] {
  const packages = Array.isArray(environment.config.packages) ? environment.config.packages : [];
  return packages.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const manager = typeof record.manager === 'string' ? record.manager : '';
    const packageName = typeof record.package === 'string' ? record.package : '';
    if (!manager && !packageName) return [];
    return [{ id: `pkg_${index}`, manager, package: packageName }];
  });
}

function environmentMetadataEntries(environment: Environment): string[][] {
  return Object.entries(environment.metadata ?? {}).map(([key, value]) => [key, String(value)]);
}

function environmentWorkerKeys(environment: Environment) {
  return Array.isArray(environment.worker_keys) ? environment.worker_keys : [];
}

function environmentDraftFromApi(environment: Environment): EnvironmentDraft {
  const network = environmentNetwork(environment);
  return {
    name: environment.name,
    description: environment.description,
    hostingType: environmentHostingType(environment),
    networkType: network.type,
    allowMcpServerNetworkAccess: network.allowMcp,
    allowPackageManagerNetworkAccess: network.allowPackageManager,
    allowedHosts: network.allowedHosts.join(', '),
    packages: environmentPackages(environment).map((item) => ({ ...item, id: newDraftId() })),
    metadata: environmentMetadataEntries(environment)
      .filter(([key]) => key !== 'environment_keys')
      .map(([key, value]) => ({ id: newDraftId(), key, value })),
    preservedMetadata: Object.fromEntries(
      Object.entries(environment.metadata ?? {}).filter(([key]) => key === 'environment_keys'),
    ),
  };
}

function environmentPayloadFromDraft(draft: EnvironmentDraft) {
  const editableMetadata = Object.fromEntries(
    draft.metadata
      .map((item) => [item.key.trim().toLowerCase(), item.value.trim()])
      .filter(([key]) => key),
  );
  const metadata = { ...draft.preservedMetadata, ...editableMetadata };
  return {
    name: draft.name.trim(),
    description: draft.description,
    config: {
      hosting_type: draft.hostingType,
      sandbox_provider: sandboxProviderForHostingType(draft.hostingType),
      network: {
        type: draft.networkType,
        allow_mcp_server_network_access: draft.allowMcpServerNetworkAccess,
        allow_package_manager_network_access: draft.allowPackageManagerNetworkAccess,
        allowed_hosts: splitCsv(draft.allowedHosts),
      },
      packages: draft.packages
        .map((item) => ({ manager: item.manager.trim(), package: item.package.trim() }))
        .filter((item) => item.manager || item.package),
    },
    metadata,
  };
}

export function sandboxProviderForHostingType(hostingType: EnvironmentHostingType) {
  if (hostingType === 'self_hosted') return 'self_hosted';
  if (hostingType === 'local') return 'local';
  return 'cloud';
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function splitCsv(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function newDraftId() {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}
