import { Brain, ChevronDown, Database, ExternalLink, Globe, KeyRound, Layers, Plus, Search, Server, Shield, Trash2 } from 'lucide-react';
import { type Dispatch, type FormEvent, type SetStateAction, useMemo, useState } from 'react';
import { postJson } from '../../api';
import { Modal } from '../Modal';
import { environmentKind, sandboxProviderForHostingType } from './EnvironmentPages';
import { formatBytes, formatDateShort } from '../../lib/format';
import type { ConsoleData, EnvironmentHostingType, MemoryRecord, SessionResourceDraft, ViewId } from '../../types';

export function SessionModal({
  data,
  initialAgentId,
  onClose,
  onSaved,
  onNavigate,
}: {
  data: ConsoleData;
  initialAgentId?: string;
  onClose: () => void;
  onSaved: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  const [agent, setAgent] = useState(initialAgentId ?? '');
  const [environment, setEnvironment] = useState('');
  const [title, setTitle] = useState('');
  const [vaultIds, setVaultIds] = useState<Set<string>>(new Set());
  const [resources, setResources] = useState<SessionResourceDraft[]>([]);
  const [resourceMenuOpen, setResourceMenuOpen] = useState(false);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    try {
      await postJson('/v1/sessions', {
        agent,
        environment_id: environment,
        title: title || undefined,
        resources: resources.map(toSessionResourcePayload),
        vault_ids: Array.from(vaultIds),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  const addResource = (type: SessionResourceDraft['type']) => {
    setResources((current) => [...current, createResourceDraft(type)]);
    setResourceMenuOpen(false);
  };

  const updateResource = (index: number, resource: SessionResourceDraft) => {
    setResources((current) => current.map((item, itemIndex) => itemIndex === index ? resource : item));
  };

  const removeResource = (index: number) => {
    setResources((current) => current.filter((_, itemIndex) => itemIndex !== index));
  };

  return (
    <Modal title="Create session" subtitle="Set up an instance of your agent in its environment." onClose={onClose} size="wide">
      <form className="sessionForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        <label className="sessionField">
          <span>Title</span>
          <input value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Optional - name this run" />
        </label>

        <SelectPicker
          label="Agent"
          placeholder="Select an agent"
          searchPlaceholder="Search agents by name or exact ID"
          manageLabel="Manage agents"
          onManage={() => onNavigate('agents')}
          value={agent}
          onValue={setAgent}
          options={data.agents.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: formatDateShort(item.created_at),
          }))}
        />

        <SelectPicker
          label="Environment"
          placeholder="Select an environment"
          searchPlaceholder="Search environments by name or exact ID"
          manageLabel="Manage environments"
          onManage={() => onNavigate('environments')}
          value={environment}
          onValue={setEnvironment}
          options={data.environments.map((item) => ({
            id: item.id,
            title: item.name,
            subtitle: formatDateShort(item.created_at),
            badge: environmentKind(item),
          }))}
        />

        <VaultPicker
          vaults={data.vaults}
          selected={vaultIds}
          onSelected={setVaultIds}
          onManage={() => onNavigate('credential-vaults')}
        />

        <div className="sessionResources">
          <div>
            <h3>Resources</h3>
            <p>Mount files, GitHub repositories, or memory stores into the session.</p>
          </div>
          {resources.map((resource, index) => (
            <SessionResourceEditor
              key={`${resource.type}-${index}`}
              resource={resource}
              data={data}
              onChange={(next) => updateResource(index, next)}
              onRemove={() => removeResource(index)}
              onNavigate={onNavigate}
            />
          ))}
          {resources.length === 0 ? (
            <div className="sessionResourceEmpty">
              <Layers size={18} />
              <span>No resources mounted yet. You can start with just an agent and environment, or add files, repositories, and memory stores.</span>
            </div>
          ) : null}
          <div className="menuWrap resourceAddWrap">
            <button className="secondaryButton resourceAddButton" type="button" onClick={() => setResourceMenuOpen((open) => !open)}>
              <Plus size={18} />
              Resource
              <ChevronDown size={16} />
            </button>
            {resourceMenuOpen ? (
              <div className="resourceMenu">
                <button type="button" onClick={() => addResource('github_repository')}>GitHub repository</button>
                <button type="button" onClick={() => addResource('file')}>File</button>
                <button type="button" onClick={() => addResource('memory_store')}>Memory store</button>
              </div>
            ) : null}
          </div>
        </div>

        <div className="modalActions stickyActions">
          <button className="primaryButton" type="submit" disabled={saving || !agent || !environment}>
            Create session
          </button>
        </div>
      </form>
    </Modal>
  );
}

type PickerOption = {
  id: string;
  title: string;
  subtitle?: string;
  badge?: string;
};

function SelectPicker({
  label,
  placeholder,
  searchPlaceholder,
  manageLabel,
  onManage,
  value,
  onValue,
  options,
}: {
  label: string;
  placeholder: string;
  searchPlaceholder: string;
  manageLabel: string;
  onManage: () => void;
  value: string;
  onValue: (value: string) => void;
  options: PickerOption[];
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const selected = options.find((option) => option.id === value);
  const filtered = options.filter((option) => {
    const q = query.toLowerCase();
    return option.id.toLowerCase().includes(q) || option.title.toLowerCase().includes(q) || (option.subtitle ?? '').toLowerCase().includes(q);
  });

  return (
    <div className="sessionField pickerWrap">
      <span className="fieldHeader">
        {label}
        <button className="linkButton" type="button" onClick={onManage}>{manageLabel} <ExternalLink size={15} /></button>
      </span>
      <button className={`pickerButton ${selected ? 'selected' : ''}`} type="button" onClick={() => setOpen((current) => !current)}>
        <span>
          <strong>{selected?.title ?? placeholder}</strong>
          {selected?.subtitle ? <small>{selected.subtitle}</small> : null}
        </span>
        {selected?.badge ? <b>{selected.badge}</b> : null}
        <ChevronDown size={18} />
      </button>
      {open ? (
        <div className="pickerPopover">
          <div className="pickerSearch">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder={searchPlaceholder} autoFocus />
          </div>
          <div className="pickerOptions">
            {filtered.map((option) => (
              <button
                type="button"
                className={`pickerOption ${option.id === value ? 'active' : ''}`}
                key={option.id}
                onClick={() => {
                  onValue(option.id);
                  setOpen(false);
                  setQuery('');
                }}
              >
                <span>
                  <strong>{option.title}</strong>
                  {option.subtitle ? <small>{option.subtitle}</small> : null}
                </span>
                {option.badge ? <b>{option.badge}</b> : null}
              </button>
            ))}
            {filtered.length === 0 ? <span className="pickerEmpty">No matches</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function VaultPicker({
  vaults,
  selected,
  onSelected,
  onManage,
}: {
  vaults: Vault[];
  selected: Set<string>;
  onSelected: Dispatch<SetStateAction<Set<string>>>;
  onManage: () => void;
}) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const filtered = vaults.filter((vault) => {
    const q = query.toLowerCase();
    return vault.id.toLowerCase().includes(q) || vault.name.toLowerCase().includes(q) || vault.description.toLowerCase().includes(q);
  });
  const selectedNames = vaults.filter((vault) => selected.has(vault.id)).map((vault) => vault.name);

  return (
    <div className="sessionField pickerWrap">
      <span className="fieldHeader">
        Credential vaults
        <button className="linkButton" type="button" onClick={onManage}>Manage credential vaults <ExternalLink size={15} /></button>
      </span>
      <button className={`pickerButton ${selectedNames.length ? 'selected' : ''}`} type="button" onClick={() => setOpen((current) => !current)}>
        <span>
          <strong>{selectedNames.length ? selectedNames.join(', ') : 'Select one or more vaults'}</strong>
          {selectedNames.length ? <small>{selectedNames.length} selected</small> : null}
        </span>
        <ChevronDown size={18} />
      </button>
      {open ? (
        <div className="pickerPopover">
          <div className="pickerSearch">
            <Search size={18} />
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Search vaults by name or exact ID" autoFocus />
          </div>
          <div className="pickerOptions">
            {filtered.map((vault) => (
              <label className="pickerOption vaultOption" key={vault.id}>
                <input
                  type="checkbox"
                  checked={selected.has(vault.id)}
                  onChange={(event) => toggleSet(vault.id, event.target.checked, onSelected)}
                />
                <span>
                  <strong>{vault.name}</strong>
                  <small>{formatDateShort(vault.created_at)}</small>
                </span>
                <Shield size={17} />
              </label>
            ))}
            {filtered.length === 0 ? <span className="pickerEmpty">No credential vaults</span> : null}
          </div>
        </div>
      ) : null}
    </div>
  );
}

function SessionResourceEditor({
  resource,
  data,
  onChange,
  onRemove,
  onNavigate,
}: {
  resource: SessionResourceDraft;
  data: ConsoleData;
  onChange: (resource: SessionResourceDraft) => void;
  onRemove: () => void;
  onNavigate: (view: ViewId) => void;
}) {
  if (resource.type === 'file') {
    return (
      <div className="resourceEditor">
        <ResourceEditorHeader title="File" onRemove={onRemove} />
        <label>
          <span className="fieldHeader">
            File ID <RequiredMark />
            <button className="linkButton" type="button" onClick={() => onNavigate('files')}>Manage files <ExternalLink size={15} /></button>
          </span>
          {data.files.length > 0 ? (
            <select value={resource.file_id} onChange={(event) => onChange({ ...resource, file_id: event.target.value })} required>
              <option value="">Select a file</option>
              {data.files.map((file) => (
                <option key={file.id} value={file.id}>
                  {file.name} · {formatBytes(file.size_bytes)}
                </option>
              ))}
            </select>
          ) : (
            <input value={resource.file_id} onChange={(event) => onChange({ ...resource, file_id: event.target.value })} placeholder="file_abc123..." required />
          )}
        </label>
        <label>
          Mount path <RequiredMark />
          <input value={resource.mount_path} onChange={(event) => onChange({ ...resource, mount_path: event.target.value })} placeholder="/uploads/myfile.txt" required />
          <small>Must start with /uploads/</small>
        </label>
      </div>
    );
  }

  if (resource.type === 'github_repository') {
    return (
      <div className="resourceEditor">
        <ResourceEditorHeader title="GitHub repository" onRemove={onRemove} />
        <label>
          URL <RequiredMark />
          <input value={resource.url} onChange={(event) => onChange({ ...resource, url: event.target.value })} placeholder="https://github.com/owner/repo" required />
        </label>
        <label>
          Authorization token <RequiredMark />
          <input value={resource.authorization_token} onChange={(event) => onChange({ ...resource, authorization_token: event.target.value })} placeholder="ghp_xxxxxxxxxxxxxxxxxxxx" required />
        </label>
        <label className="shortField">
          Checkout
          <select value={resource.checkout} onChange={(event) => onChange({ ...resource, checkout: event.target.value })}>
            <option value="">None</option>
            <option value="default_branch">Default branch</option>
            <option value="commit">Commit SHA</option>
            <option value="branch">Branch</option>
          </select>
        </label>
        <label>
          Mount path
          <input value={resource.mount_path} onChange={(event) => onChange({ ...resource, mount_path: event.target.value })} placeholder="/workspace/repo-name (default)" />
        </label>
      </div>
    );
  }

  return (
    <div className="resourceEditor">
      <ResourceEditorHeader title="Memory store" onRemove={onRemove} />
      <label>
        <span className="fieldHeader">
          Memory store <RequiredMark />
          <button className="linkButton" type="button" onClick={() => onNavigate('memory-stores')}>Manage memory stores <ExternalLink size={15} /></button>
        </span>
        <select value={resource.memory_store_id} onChange={(event) => onChange({ ...resource, memory_store_id: event.target.value })} required>
          <option value="">Select a memory store</option>
          {data.memoryStores.map((store) => <option key={store.id} value={store.id}>{store.name}</option>)}
        </select>
      </label>
      <label>
        Access
        <select value={resource.access} onChange={(event) => onChange({ ...resource, access: event.target.value as 'read_write' | 'read_only' })}>
          <option value="read_write">Read & write</option>
          <option value="read_only">Read only</option>
        </select>
      </label>
      <label>
        Instructions (optional)
        <textarea value={resource.instructions} onChange={(event) => onChange({ ...resource, instructions: event.target.value })} placeholder="Tell the agent what this store contains and when to use it." />
      </label>
    </div>
  );
}

function ResourceEditorHeader({ title, onRemove }: { title: string; onRemove: () => void }) {
  return (
    <div className="resourceEditorHeader">
      <strong>{title}</strong>
      <button className="iconButton quiet" type="button" onClick={onRemove} aria-label={`Remove ${title}`}>
        <Trash2 size={19} />
      </button>
    </div>
  );
}

export function ResourceModal({ kind, onClose, onSaved }: { kind: 'environment' | 'credential_vault' | 'memory_store'; onClose: () => void; onSaved: () => void }) {
  const [name, setName] = useState('');
  const [description, setDescription] = useState('');
  const [hostingType, setHostingType] = useState<EnvironmentHostingType>('local');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setError('');
    const path = kind === 'environment' ? '/v1/environments' : kind === 'credential_vault' ? '/v1/credential-vaults' : '/v1/memory_stores';
    try {
      await postJson(path, {
        name,
        ...(kind !== 'credential_vault' ? { description } : {}),
        ...(kind === 'environment' ? {
          config: {
            hosting_type: hostingType,
            sandbox_provider: sandboxProviderForHostingType(hostingType),
            network: {
              type: 'limited',
              allow_mcp_server_network_access: false,
              allow_package_manager_network_access: false,
              allowed_hosts: [],
            },
            packages: [],
          },
        } : {}),
      });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  if (kind === 'environment') {
    return (
      <Modal title="Create environment" onClose={onClose} size="medium">
        <form className="environmentCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value.slice(0, 50))} placeholder="E.g. My Environment" required />
            <small>50 characters or fewer.</small>
          </label>
          <label className="editField">
            Hosting type
            <select value={hostingType} onChange={(event) => setHostingType(event.target.value as EnvironmentHostingType)}>
              <option value="local">Local</option>
            </select>
            <small>Local is the v1 quick-start path. Advanced workers stay in Environments.</small>
          </label>
          <label className="editField">
            Description
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="Optional description for this environment" />
          </label>
          <div className="modalActions">
            <button className="secondaryButton largeAction" type="button" onClick={onClose}>Cancel</button>
            <button className="primaryButton largeAction" type="submit" disabled={saving || !name.trim()}>Create environment</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (kind === 'credential_vault') {
    return (
      <Modal title="Create vault" onClose={onClose} size="medium">
        <form className="vaultCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <div className="warningNotice">
            <Info size={18} />
            <span>Vaults are shared across this workspace. Credentials added to this vault are usable by anyone with API key access. Review access controls in <a href="#api-keys">API keys</a>.</span>
          </div>
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value.slice(0, 50))} placeholder="Production vault" required />
            <small>50 characters or fewer.</small>
          </label>
          <div className="modalActions">
            <button className="primaryButton largeAction" type="submit" disabled={saving || !name.trim()}>Continue</button>
          </div>
        </form>
      </Modal>
    );
  }

  if (kind === 'memory_store') {
    return (
      <Modal title="Create memory store" onClose={onClose} size="medium">
        <form className="memoryCreateForm" onSubmit={submit}>
          {error ? <div className="banner error inlineBanner">{error}</div> : null}
          <label className="editField">
            Name
            <input value={name} onChange={(event) => setName(event.target.value)} placeholder="My memory store" required />
          </label>
          <label className="editField">
            Description (optional)
            <textarea value={description} onChange={(event) => setDescription(event.target.value)} placeholder="What this store contains and how agents should use it" />
            <small>Name and description are rendered in the agent system prompt when this store is attached.</small>
          </label>
          <div className="modalActions">
            <button className="primaryButton largeAction" type="submit" disabled={saving || !name.trim()}>Create memory store</button>
          </div>
        </form>
      </Modal>
    );
  }

  throw new Error(`Unsupported resource kind: ${kind}`);
}

export function AddMemoryModal({ storeId, onClose, onSaved }: { storeId: string; onClose: () => void; onSaved: () => void }) {
  const [path, setPath] = useState('/');
  const [content, setContent] = useState('');
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState('');
  const normalizedPath = path.trim().replace(/\/+/g, '/');
  const canSubmit = normalizedPath.startsWith('/') && normalizedPath.length > 1 && !normalizedPath.endsWith('/');
  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (!canSubmit) return;
    setSaving(true);
    setError('');
    try {
      await postJson(`/v1/memory_stores/${storeId}/memories`, { path: normalizedPath, content });
      onSaved();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };
  return (
    <Modal title="Add memory" onClose={onClose} size="medium">
      <form className="addMemoryForm" onSubmit={submit}>
        {error ? <div className="banner error inlineBanner">{error}</div> : null}
        <label className="editField">
          Path
          <input value={path} onChange={(event) => setPath(event.target.value)} placeholder="/note/d" required />
          <small>Folders are derived from the slashes in your path.</small>
        </label>
        <label className="editField">
          Content
          <textarea value={content} onChange={(event) => setContent(event.target.value)} />
        </label>
        <div className="modalActions">
          <button className="primaryButton largeAction" type="submit" disabled={saving || !canSubmit}>Add memory</button>
        </div>
      </form>
    </Modal>
  );
}

function createResourceDraft(type: SessionResourceDraft['type']): SessionResourceDraft {
  if (type === 'file') return { type, file_id: '', mount_path: '' };
  if (type === 'github_repository') return { type, url: '', authorization_token: '', checkout: '', mount_path: '' };
  return { type, memory_store_id: '', access: 'read_write', instructions: '' };
}

function toSessionResourcePayload(resource: SessionResourceDraft): Record<string, unknown> {
  if (resource.type === 'file') {
    return {
      type: 'file',
      file_id: resource.file_id,
      mount_path: resource.mount_path,
    };
  }
  if (resource.type === 'github_repository') {
    return {
      type: 'github_repository',
      url: resource.url,
      authorization_token: resource.authorization_token,
      ...(resource.checkout ? { checkout: resource.checkout } : {}),
      ...(resource.mount_path ? { mount_path: resource.mount_path } : {}),
    };
  }
  return {
    type: 'memory_store',
    memory_store_id: resource.memory_store_id,
    access: resource.access,
    ...(resource.instructions ? { instructions: resource.instructions } : {}),
  };
}

function toggleSet<T>(value: T, checked: boolean, setter: Dispatch<SetStateAction<Set<T>>>) {
  setter((current) => {
    const next = new Set(current);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  });
}

function toolNames(agent: Pick<Agent, 'tools'>): string[] {
  const names = new Set<string>();
  for (const toolset of agent.tools ?? []) {
    for (const [name, config] of Object.entries(toolset.configs ?? {})) {
      if (config.enabled !== false && config.permission_policy?.type !== 'never_allow') names.add(name);
    }
  }
  return [...names];
}
