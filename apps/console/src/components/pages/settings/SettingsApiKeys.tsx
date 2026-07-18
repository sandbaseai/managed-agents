import { Copy, KeyRound, Lock, Plus, Settings, Shield, Trash2 } from 'lucide-react';
import { FormEvent, useState } from 'react';
import { clearStoredApiKey, deleteJson, getStoredApiKey, postJson, setStoredApiKey } from '../../../api';
import { copyText, formatDateShort, relativeDate, truncateMiddle } from '../../../lib/format';
import type { ApiKey, ApiKeyCreateResponse, ConsoleData } from '../../../types';
import { EmptyState, RequiredMark, ResourceBadge, StatusPill, SummaryStrip } from '../../Common';
import { Modal } from '../../Modal';

export function SettingsApiKeys({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const [modalOpen, setModalOpen] = useState(false);
  const [storedKey, setStoredKey] = useState(() => getStoredApiKey());
  const activeKeys = data.apiKeys.filter((key) => key.status === 'active');
  const managedKeys = data.apiKeys.filter((key) => key.source === 'managed');
  const configuredKeys = data.apiKeys.filter((key) => key.source === 'config_env');

  const saveStoredKey = () => {
    setStoredApiKey(storedKey);
    onRefresh();
  };

  const clearBrowserKey = () => {
    clearStoredApiKey();
    setStoredKey('');
  };

  const deleteKey = async (key: ApiKey) => {
    if (key.source !== 'managed') return;
    if (!window.confirm(`Delete API key "${key.name}"? This cannot be undone.`)) return;
    await deleteJson(`/v1/api-keys/${encodeURIComponent(key.id)}`);
    onRefresh();
  };

  return (
    <section className="stack">
      <SummaryStrip items={[
        { label: 'Auth', value: data.runtime?.auth_enabled ? 'enabled' : 'disabled', icon: <KeyRound size={18} /> },
        { label: 'Active keys', value: String(activeKeys.length), icon: <Shield size={18} /> },
        { label: 'Managed keys', value: String(managedKeys.length), icon: <Lock size={18} /> },
        { label: 'Configured keys', value: String(configuredKeys.length), icon: <Settings size={18} /> },
      ]} />
      <div className="sectionHeaderRow">
        <div>
          <h1>API keys</h1>
          <p>Create and manage bearer tokens for the local API.</p>
        </div>
        <button className="primaryButton" type="button" onClick={() => setModalOpen(true)}>
          <Plus size={18} />Create key
        </button>
      </div>
      <div className="tablePanel">
        <table>
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Source</th>
              <th>Status</th>
              <th>Key prefix</th>
              <th>Last used</th>
              <th>Created</th>
              <th />
            </tr>
          </thead>
          <tbody>
            {data.apiKeys.map((key) => (
              <tr key={key.id}>
                <td><code>{truncateMiddle(key.id, 18)}</code></td>
                <td><strong>{key.name}</strong></td>
                <td><ResourceBadge>{key.source === 'managed' ? 'Managed' : 'Config / env'}</ResourceBadge></td>
                <td><StatusPill status={key.status} /></td>
                <td><code>{key.key_prefix}</code></td>
                <td>{key.last_used_at ? relativeDate(key.last_used_at) : 'Never'}</td>
                <td>{formatDateShort(key.created_at)}</td>
                <td className="rowActionsCell">
                  <button className="iconButton quiet" type="button" title="Copy key prefix" onClick={() => void copyText(key.key_prefix)}>
                    <Copy size={16} />
                  </button>
                  {key.source === 'managed' ? (
                    <button className="iconButton danger" type="button" title="Delete API key" onClick={() => void deleteKey(key)}>
                      <Trash2 size={16} />
                    </button>
                  ) : null}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.apiKeys.length === 0 ? (
          <EmptyState
            icon={<KeyRound size={22} />}
            title="No API keys"
            body="Create a key to require bearer-token authentication for the API."
            action={<button className="primaryButton" type="button" onClick={() => setModalOpen(true)}><Plus size={18} />Create key</button>}
          />
        ) : null}
      </div>
      <div className="panel subtlePanel">
        <h2>Browser token</h2>
        <p>Store a key locally in this browser so Console requests can authenticate when API auth is enabled.</p>
        <div className="inlineForm">
          <input
            value={storedKey}
            onChange={(event) => setStoredKey(event.target.value)}
            placeholder="ma_..."
            type="password"
          />
          <button type="button" onClick={saveStoredKey}>Save token</button>
          <button type="button" className="ghostButton" onClick={clearBrowserKey}>Clear</button>
        </div>
      </div>
      {modalOpen ? (
        <ApiKeyModal
          onClose={() => setModalOpen(false)}
          onSaved={(secret) => {
            setStoredApiKey(secret);
            setStoredKey(secret);
            onRefresh();
          }}
        />
      ) : null}
    </section>
  );
}

function ApiKeyModal({ onClose, onSaved }: { onClose: () => void; onSaved: (secret: string) => void }) {
  const [name, setName] = useState('Default API key');
  const [created, setCreated] = useState<ApiKeyCreateResponse | null>(null);
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    if (created) {
      onClose();
      return;
    }
    setSaving(true);
    setError('');
    try {
      const response = await postJson<ApiKeyCreateResponse>('/v1/api-keys', { name });
      setCreated(response);
      onSaved(response.secret_key);
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setSaving(false);
    }
  };

  return (
    <Modal title="Create API key" onClose={onClose}>
      <form className="modalForm" onSubmit={submit}>
        {error ? <div className="banner error">{error}</div> : null}
        {!created ? (
          <>
            <label>
              <span>Name <RequiredMark /></span>
              <input value={name} onChange={(event) => setName(event.target.value.slice(0, 80))} placeholder="Production key" required />
            </label>
            <p className="formHint">The generated key will be shown once. Store it before closing this dialog.</p>
          </>
        ) : (
          <div className="secretReveal">
            <div>
              <strong>{created.name}</strong>
              <span>{created.key_prefix}</span>
            </div>
            <code>{created.secret_key}</code>
            <button type="button" onClick={() => void copyText(created.secret_key)}>
              <Copy size={16} />Copy key
            </button>
          </div>
        )}
        <div className="modalActions">
          <button type="button" onClick={onClose}>{created ? 'Done' : 'Cancel'}</button>
          {!created ? <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Creating...' : 'Create key'}</button> : null}
        </div>
      </form>
    </Modal>
  );
}
