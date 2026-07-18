import { Archive, FileText, Lock, MoreVertical, Plus, Shield, Trash2 } from 'lucide-react';
import { useState } from 'react';
import { deleteJson, postJson } from '../../api';
import { EmptyState, FilterSelect, StatusPill, Toolbar } from '../Common';
import { formatDateShort, relativeDate, shortId } from '../../lib/format';
import type { ConsoleData, CredentialAuthType, Vault, VaultCredential } from '../../types';

export function CredentialVaults({ data, onNew, onOpenVault }: { data: ConsoleData; onNew: () => void; onOpenVault: (vault: Vault) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const vaults = data.vaults.filter((vault) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || vault.status === status;
    const matchesQuery = vault.id.toLowerCase().includes(q) || vault.name.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Credential vaults</h1>
          <p>Manage credential vaults that provide your agents with access to MCP servers and other tools.</p>
        </div>
        <div className="toolbarActions">
          <button className="darkButton" type="button" onClick={onNew}>
            <Plus size={18} />
            Create vault
          </button>
          <button className="iconButton" type="button" title="Documentation"><FileText size={18} /></button>
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
      <div className="tablePanel resourceTablePanel">
        <table className="resourceTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Created</th>
              <th className="actionsCol" aria-label="Actions" />
            </tr>
          </thead>
          <tbody>
            {vaults.map((vault) => (
              <tr key={vault.id} className="clickableRow" onClick={() => onOpenVault(vault)}>
                <td><strong className="monoText">{shortId(vault.id)}</strong></td>
                <td>{vault.name}</td>
                <td><StatusPill status={vault.status} /></td>
                <td>{formatDateShort(vault.created_at)}</td>
                <td className="actionsCol" onClick={(event) => event.stopPropagation()}>
                  <button className="iconButton quiet" type="button" title="Vault actions"><MoreVertical size={18} /></button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
        {vaults.length === 0 ? <EmptyState icon={<Lock size={22} />} title="No credential vaults" /> : null}
      </div>
    </section>
  );
}

export function CredentialVaultDetail({
  vault,
  onBack,
  onRefresh,
  onNewCredential,
}: {
  vault: Vault;
  onBack: () => void;
  onRefresh: () => void;
  onNewCredential: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const [credentialMenuId, setCredentialMenuId] = useState<string | null>(null);
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const credentials = vault.credentials.filter((credential) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || credential.status === status;
    const matchesQuery = credential.id.toLowerCase().includes(q)
      || credential.name.toLowerCase().includes(q)
      || credentialAuthLabel(credential.auth_type).toLowerCase().includes(q)
      || credential.mcp_server_url.toLowerCase().includes(q)
      || credential.variable_name.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });

  const archiveVault = async () => {
    await postJson(`/v1/credential-vaults/${vault.id}/archive`, {});
    setMenuOpen(false);
    onBack();
    onRefresh();
  };
  const archiveCredential = async (credential: VaultCredential) => {
    await postJson(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}/archive`, {});
    setCredentialMenuId(null);
    onRefresh();
  };
  const deleteCredential = async (credential: VaultCredential) => {
    await deleteJson(`/v1/credential-vaults/${vault.id}/credentials/${credential.id}`);
    setCredentialMenuId(null);
    onRefresh();
  };

  return (
    <section className="environmentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Credential vaults</button>
        <span>/</span>
        <strong>{vault.name}</strong>
      </div>
      <div className="resourceHero">
        <div>
          <div className="titleLine">
            <h1>{vault.name}</h1>
            <StatusPill status={vault.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{vault.id}</span> · Created {formatDateShort(vault.created_at)} · Updated {formatDateShort(vault.updated_at)}</p>
        </div>
        <div className="agentHeroActions">
          <button className="darkButton largeAction" type="button" onClick={onNewCredential}>
            <Plus size={18} />
            Add credential
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Vault actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" className="dangerMenuItem" onClick={() => void archiveVault()}><Archive size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>
      <div className="detailStack wideDetailStack">
        <Toolbar
          query={query}
          onQuery={setQuery}
          placeholder="Search credentials"
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
        <div className="tablePanel">
          <table>
            <thead>
              <tr>
                <th>ID</th>
                <th>Name</th>
                <th>Auth</th>
                <th>Status</th>
                <th>Last used</th>
                <th>Updated</th>
                <th className="actionsCol" aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {credentials.map((credential) => (
                <tr key={credential.id}>
                  <td><strong className="monoText">{shortId(credential.id)}</strong></td>
                  <td>{credential.name || credentialAuthLabel(credential.auth_type)}</td>
                  <td><CredentialAuthCell credential={credential} /></td>
                  <td><StatusPill status={credential.status} /></td>
                  <td>{credential.last_used_at ? relativeDate(credential.last_used_at) : 'Never'}</td>
                  <td>{formatDateShort(credential.updated_at)}</td>
                  <td className="actionsCol">
                    <div className="menuWrap">
                      <button className="iconButton quiet" type="button" title="Credential actions" onClick={() => setCredentialMenuId((current) => current === credential.id ? null : credential.id)}>
                        <MoreVertical size={18} />
                      </button>
                      {credentialMenuId === credential.id ? (
                        <div className="agentMenu rowMenu">
                          <button type="button" onClick={() => void archiveCredential(credential)}><Archive size={18} />Archive</button>
                          <button type="button" className="dangerMenuItem" onClick={() => void deleteCredential(credential)}><Trash2 size={18} />Delete</button>
                        </div>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {credentials.length === 0 ? <EmptyState icon={<Shield size={22} />} title="No credentials" /> : null}
        </div>
      </div>
    </section>
  );
}

function CredentialAuthCell({ credential }: { credential: VaultCredential }) {
  const secondary = credential.auth_type === 'mcp_oauth'
    ? credential.mcp_server_url
    : credential.auth_type === 'environment_variable'
      ? credential.variable_name
      : credential.value_hint;
  return (
    <span className="authCell">
      <strong>{credentialAuthLabel(credential.auth_type)}</strong>
      {secondary ? <small>{secondary}</small> : null}
    </span>
  );
}

function credentialAuthLabel(type: CredentialAuthType) {
  if (type === 'mcp_oauth') return 'MCP OAuth';
  if (type === 'bearer_token') return 'Bearer token';
  return 'Environment variable';
}
