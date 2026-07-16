import { Archive, FileText, Globe, MoreVertical, Pencil, Plus, Server, Trash2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { postJson, putJson } from '../../api';
import { EmptyState, FilterSelect, MetricCard, StatusPill, Toolbar } from '../Common';
import { formatDateShort, relativeDate, shortId, titleCase } from '../../lib/format';
import type { ConsoleData, Environment, EnvironmentDraft, EnvironmentHostingType, EnvironmentNetworkType, EnvironmentPackageDraft, MetadataDraft, Session } from '../../types';

export function Environments({ data, onNew, onOpenEnvironment }: { data: ConsoleData; onNew: () => void; onOpenEnvironment: (environment: Environment) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const environments = data.environments.filter((environment) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || environment.status === status;
    const matchesQuery = environment.id.toLowerCase().includes(q) || environment.name.toLowerCase().includes(q) || environment.description.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Environments</h1>
          <p>Configuration template for containers, such as sessions or code execution.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create environment
          </button>
          <button className="iconButton" type="button" title="Documentation">
            <FileText size={18} />
          </button>
        </div>
      </div>
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
              <th className="selectCol"><input type="checkbox" aria-label="Select all environments" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Type</th>
              <th>Updated at</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {environments.map((environment) => (
              <tr key={environment.id} className="clickableRow" onClick={() => onOpenEnvironment(environment)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${environment.id}`} /></td>
                <td><strong className="monoText">{shortId(environment.id)}</strong></td>
                <td>{environment.name}</td>
                <td><StatusPill status={environment.status} /></td>
                <td><span className="softChip inlineChip">{environmentKind(environment)}</span></td>
                <td>{formatDateShort(environment.updated_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Environment actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {environments.length === 0 ? <EmptyState icon={<Server size={22} />} title="No environments" /> : null}
      </div>
      <div className="mobileResourceList">
        {environments.map((environment) => (
          <button className="mobileAgentCard" type="button" key={environment.id} onClick={() => onOpenEnvironment(environment)}>
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
        {environments.length === 0 ? <EmptyState icon={<Server size={22} />} title="No environments" /> : null}
      </div>
    </section>
  );
}

export function EnvironmentDetail({ environment, data, onBack, onRefresh }: { environment: Environment; data: ConsoleData; onBack: () => void; onRefresh: () => void }) {
  const [editing, setEditing] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const environmentSessions = data.sessions.filter((session) => session.environment_id === environment.id);
  const isSelfHosted = environmentHostingType(environment) === 'self_hosted';

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
            <span className="softChip inlineChip">{environmentKind(environment)}</span>
            <Globe size={19} className="mutedIcon" />
          </div>
          <p className="mutedLine"><span className="monoText">{shortId(environment.id)}</span> · Last updated {formatDateShort(environment.updated_at)}</p>
          <p className="agentDescription">{environment.description || 'No description.'}</p>
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

      {isSelfHosted ? <SelfHostedEnvironment environment={environment} sessions={environmentSessions} /> : <CloudEnvironment environment={environment} />}
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

function SelfHostedEnvironment({ environment, sessions }: { environment: Environment; sessions: Session[] }) {
  const keys = environmentKeys(environment);
  const idleSessions = sessions.filter((session) => session.status === 'idle');
  const runningSessions = sessions.filter((session) => session.status === 'running');
  const completedSessions = sessions.filter((session) => session.status === 'terminated');
  const oldestActiveSession = [...idleSessions, ...runningSessions].sort((a, b) => a.created_at.localeCompare(b.created_at))[0];
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
        </div>
      </section>
      <div className="selfHostedGrid">
        <section className="environmentSection">
          <h2>Environment keys</h2>
          <p>An environment key lets a runner on your infrastructure connect to this environment and pull jobs. Generate one per host so you can revoke access individually.</p>
          <ReadonlyTable
            empty="No environment keys"
            rows={keys.map((key) => [key.name, shortId(key.id), formatDateShort(key.created_at), formatDateShort(key.expires_at)])}
            columns={['Name', 'ID', 'Created', 'Expires at']}
          />
        </section>
        <section className="setupCard">
          <div className="setupHeader">
            <h2>Set up your self-hosted environment</h2>
            <button className="iconButton quiet" type="button" title="Dismiss setup"><X size={18} /></button>
          </div>
          <p>These instructions guide you through a low-code CLI worker setup. Additional options are also available in public documentation.</p>
          <SetupStep index={1} title="Register an environment key" body="Generate an environment key authenticating your infrastructure with this environment." />
          <SetupStep index={2} title="Export environment key as env var" body="This authorizes the environment worker to pull for work." code={`export MANAGED_AGENTS_ENVIRONMENT_KEY='env-key-...'`} />
          <SetupStep index={3} title="Install managed-agents CLI" body="Run this command on the machine where you want the environment worker to run." code={`npm install -g managed-agents`} />
          <SetupStep index={4} title="Invoke the worker" body="Poll for jobs and execute them locally." code={`managed-agents worker poll \\\n  --environment-id "${environment.id}" \\\n  --workdir "/workspace"`} />
        </section>
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
          <button className="darkButton largeAction" type="button" onClick={() => void save()} disabled={saving || !draft.name.trim()}>Save</button>
        </div>
      </div>

      <label className="editField">
        Description
        <textarea value={draft.description} onChange={(event) => setDraft({ ...draft, description: event.target.value })} placeholder="Add a description for this environment (optional)" />
      </label>

      {draft.hostingType === 'self_hosted' ? (
        <SelfHostedEnvironment environment={environment} sessions={[]} />
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
      {rows.length === 0 ? <div className="emptyValue">{empty}</div> : (
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

function environmentNetworkLabel(environment: Environment) {
  const network = environment.network;
  const type = typeof network?.type === 'string' ? network.type : environment.config?.network;
  if (typeof type === 'string' && type.length > 0) return titleCase(type.replace('_', ' '));
  if (environment.hosting_type === 'self_hosted') return 'Self-hosted';
  return 'Limited';
}

export function environmentKind(environment: Environment) {
  return hostingLabel(environmentHostingType(environment));
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

function environmentKeys(environment: Environment): Array<{ id: string; name: string; created_at: string; expires_at: string }> {
  const raw = environment.metadata.environment_keys;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
      return [{
        id: record.id,
        name: record.name,
        created_at: typeof record.created_at === 'string' ? record.created_at : environment.created_at,
        expires_at: typeof record.expires_at === 'string' ? record.expires_at : environment.updated_at,
      }];
    });
  } catch {
    return [];
  }
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

export function splitCsv(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function newDraftId() {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}
