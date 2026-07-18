import { Archive, FileText, Globe, MoreVertical, Pencil, Plus, Server, Trash2 } from 'lucide-react';
import { useEffect, useState } from 'react';
import { postJson, putJson } from '../../api';
import { EmptyState, FilterSelect, StatusPill, Toolbar } from '../Common';
import { formatDateShort, shortId } from '../../lib/format';
import type { ConsoleData, Environment, EnvironmentDraft, EnvironmentNetworkType, EnvironmentPackageDraft, MetadataDraft } from '../../types';
import { CloudEnvironment, ReadonlyTable, SelfHostedEnvironment } from './EnvironmentDetailViews';
import {
  environmentDraftFromApi,
  environmentHostingType,
  environmentKind,
  environmentPayloadFromDraft,
  hostingLabel,
} from './EnvironmentPageModel';

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

function newDraftId() {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}
