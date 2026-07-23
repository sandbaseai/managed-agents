import { FormEvent, useEffect, useState } from 'react';
import { Activity, Brain, Database, FileText, Gauge, Shield } from 'lucide-react';
import { postJson, putJson } from '../../../api';
import { formatDateShort, titleCase } from '../../../lib/format';
import type { ConsoleData, RuntimeConfigState, RuntimeSettings, Workspace } from '../../../types';
import { EmptyState, KeyValuePanel, RequiredMark, ResourceBadge, StatusPill } from '../../Common';

export function SettingsModels({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const settings = data.settings;
  const [vendor, setVendor] = useState(settings?.model_provider.vendor ?? 'openai-compatible');
  const [baseUrl, setBaseUrl] = useState(settings?.model_provider.base_url ?? '');
  const [apiKeyEnv, setApiKeyEnv] = useState(settings?.model_provider.api_key_env ?? '');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setVendor(settings?.model_provider.vendor ?? 'openai-compatible');
    setBaseUrl(settings?.model_provider.base_url ?? '');
    setApiKeyEnv(settings?.model_provider.api_key_env ?? '');
  }, [settings?.model_provider.vendor, settings?.model_provider.base_url, settings?.model_provider.api_key_env]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await putJson<RuntimeSettings>('/v1/x/settings', {
        model_provider: {
          vendor,
          base_url: baseUrl || undefined,
          api_key_env: apiKeyEnv || undefined,
        },
      });
      setMessage('Model provider saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save model provider');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Models</h1>
          <p>Configure one active model provider boundary. Agents remain responsible for their own model/runtime intent.</p>
        </div>
      </div>
      <SettingsTruthStrip
        items={[
          ['Configured here', 'Vendor, base URL, and secret reference only.'],
          ['Not configured here', 'Model IDs stay in agent definitions or adapter config.'],
          ['Validation', 'Checks the provider boundary before runtime trust.'],
        ]}
      />
      <form className="settingsFormCard" onSubmit={submit}>
        <div className="settingsCardHeader">
          <span className="pluginSettingsIcon"><Brain size={18} /></span>
          <div>
            <h2>Active provider</h2>
            <p>Configure the single provider boundary used by local runs. Model catalogs stay out of Settings until they are backed by runtime adapters.</p>
          </div>
          <SettingsConfigStatePill state={settings?.model_provider.api_key_state ?? 'not_set'} />
        </div>
        <div className="settingsFieldGrid">
          <label>
            <span>Vendor <RequiredMark /></span>
            <select value={vendor} onChange={(event) => setVendor(event.target.value)}>
              <option value="openai-compatible">OpenAI compatible</option>
              <option value="anthropic">Anthropic</option>
              <option value="openai">OpenAI</option>
              <option value="local-compatible">Local compatible</option>
            </select>
          </label>
          <label>
            <span>Base URL</span>
            <input value={baseUrl} onChange={(event) => setBaseUrl(event.target.value)} placeholder="https://api.example.com/v1" />
          </label>
          <label>
            <span>API key env</span>
            <input value={apiKeyEnv} onChange={(event) => setApiKeyEnv(event.target.value)} placeholder="ANTHROPIC_API_KEY" />
            <small>Store only the environment variable name. The raw secret is never returned by the API.</small>
          </label>
        </div>
        <SettingsNotice message={message} />
        <div className="formActions">
          <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save provider'}</button>
        </div>
      </form>
      <SettingsValidationPanel settings={settings} filterPrefix="model_provider" onRefresh={onRefresh} />
      <SettingsJsonPanel settings={settings} onRefresh={onRefresh} />
    </section>
  );
}

export function SettingsLoopEngine({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const engine = data.settings?.loop_engine;
  const [engineType, setEngineType] = useState(engine?.type ?? 'managed-agents');
  const [configText, setConfigText] = useState(formatConfig(engine?.config));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setEngineType(engine?.type ?? 'managed-agents');
    setConfigText(formatConfig(engine?.config));
  }, [engine?.type, engine?.config]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await putJson<RuntimeSettings>('/v1/x/settings', {
        loop_engine: {
          type: engineType,
          config: parseConfig(configText),
        },
      });
      setMessage('Loop engine settings saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save loop engine settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Loop engine</h1>
          <p>One active engine drives model turns, tool scheduling, approval policy, and event handling.</p>
        </div>
      </div>
      <SettingsTruthStrip
        items={[
          ['Active contract', 'Exactly one loop engine is active at a time.'],
          ['Implemented now', 'The built-in managed-agents engine.'],
          ['Roadmap', 'Harness, Codex, and Claude adapters require executable adapters and probes.'],
        ]}
      />
      <form className="settingsFormCard" onSubmit={submit}>
        <div className="settingsCardHeader">
          <span className="pluginSettingsIcon"><Gauge size={18} /></span>
          <div>
            <h2>Active engine</h2>
            <p>The built-in engine is implemented today. Future engines stay visible as roadmap adapters until they can validate.</p>
          </div>
          <ResourceBadge>{engine?.implemented ? 'Implemented' : 'Roadmap'}</ResourceBadge>
        </div>
        <div className="settingsFieldGrid">
          <label>
            <span>Engine</span>
            <select value={engineType} onChange={(event) => setEngineType(event.target.value)}>
              <option value="managed-agents">Managed Agents</option>
            </select>
          </label>
          <label className="settingsJsonField">
            <span>Engine config JSON</span>
            <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={5} spellCheck={false} />
            <small>Advanced adapter options. Must be valid JSON and should stay empty for the built-in engine.</small>
          </label>
        </div>
        <KeyValuePanel rows={[
          ['Runtime capable', engine?.implemented ? 'yes' : 'no'],
          ['Agents', data.agents.length],
          ['Sessions', data.sessions.length],
        ]} />
        <div className="formActions">
          <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save engine'}</button>
          <SettingsNotice message={message} compact />
        </div>
      </form>
      <RoadmapAdapterGrid items={[
        ['managed-agents', 'Built-in local loop engine', true],
        ['harness', 'Future external harness adapter', false],
        ['codex', 'Future Codex-backed loop adapter', false],
        ['claude', 'Future Claude-compatible loop adapter', false],
      ]} />
      <SettingsValidationPanel settings={data.settings} filterPrefix="loop_engine" onRefresh={onRefresh} />
    </section>
  );
}

export function SettingsStorage({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const settings = data.settings;
  const [metadataPath, setMetadataPath] = useState(settings?.storage.metadata.path ?? runtimeDatabasePath(data.workspace) ?? '');
  const [artifactPath, setArtifactPath] = useState(settings?.storage.artifacts.path ?? 'files');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setMetadataPath(settings?.storage.metadata.path ?? runtimeDatabasePath(data.workspace) ?? '');
    setArtifactPath(settings?.storage.artifacts.path ?? 'files');
  }, [settings?.storage.metadata.path, settings?.storage.artifacts.path, data.workspace]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await putJson<RuntimeSettings>('/v1/x/settings', {
        storage: {
          metadata: { type: 'sqlite', path: metadataPath || undefined },
          artifacts: { type: 'local_filesystem', path: artifactPath || undefined },
        },
      });
      setMessage('Storage settings saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save storage settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Storage</h1>
          <p>Storage is global and flat: metadata storage plus artifact storage. No Add Provider UI until adapters are real.</p>
        </div>
      </div>
      <SettingsTruthStrip
        items={[
          ['Metadata', 'SQLite stores agents, sessions, events, settings, vault metadata, and indexes.'],
          ['Artifacts', 'Local filesystem stores uploads, skill packages, and generated session artifacts.'],
          ['Future adapters', 'Postgres and S3 stay roadmap until they can validate.'],
        ]}
      />
      <form className="settingsTwoColumn" onSubmit={submit}>
        <div className="settingsFormCard">
          <div className="settingsCardHeader">
            <span className="pluginSettingsIcon"><Database size={18} /></span>
            <div>
              <h2>Metadata storage</h2>
              <p>Persists agents, sessions, events, vaults, memory stores, API keys, and runtime metadata.</p>
            </div>
            <ResourceBadge>{settings?.storage.metadata.implemented ? 'Implemented' : 'Adapter required'}</ResourceBadge>
          </div>
          <label>
            <span>Type</span>
            <span className="readonlySettingValue">SQLite</span>
          </label>
          <label>
            <span>SQLite path</span>
            <input value={metadataPath} onChange={(event) => setMetadataPath(event.target.value)} placeholder="~/.managed-agents/<workspace>/data.db" />
          </label>
        </div>
        <div className="settingsFormCard">
          <div className="settingsCardHeader">
            <span className="pluginSettingsIcon"><FileText size={18} /></span>
            <div>
              <h2>Artifact storage</h2>
              <p>Stores uploaded files, skill bundles, artifacts, and local generated resources.</p>
            </div>
            <ResourceBadge>{settings?.storage.artifacts.implemented ? 'Implemented' : 'Adapter required'}</ResourceBadge>
          </div>
          <label>
            <span>Type</span>
            <span className="readonlySettingValue">Local filesystem</span>
          </label>
          <label>
            <span>Base path</span>
            <input value={artifactPath} onChange={(event) => setArtifactPath(event.target.value)} placeholder="files" />
          </label>
        </div>
        <div className="formActions wide">
          <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save storage'}</button>
          <SettingsNotice message={message} compact />
        </div>
      </form>
      <RoadmapAdapterGrid items={[
        ['sqlite', 'Implemented metadata storage', true],
        ['local filesystem', 'Implemented artifact storage', true],
        ['postgres', 'Future metadata adapter', false],
        ['s3', 'Future artifact adapter', false],
      ]} />
      <SettingsValidationPanel settings={settings} filterPrefix="storage" onRefresh={onRefresh} />
    </section>
  );
}

export function SettingsMemory({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const settings = data.settings;
  const [backend, setBackend] = useState(settings?.memory.backend.type ?? 'sqlite');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setBackend(settings?.memory.backend.type ?? 'sqlite');
  }, [settings?.memory.backend.type]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await putJson<RuntimeSettings>('/v1/x/settings', {
        memory: { backend: { type: backend } },
      });
      setMessage('Memory backend saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save memory backend');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Memory</h1>
          <p>This page configures the context-memory backend. Memory Stores are separate attachable resources.</p>
        </div>
      </div>
      <SettingsTruthStrip
        items={[
          ['Backend', 'Controls how context memory is stored and retrieved by the runtime.'],
          ['Resources', 'Memory Stores remain under Default and are mounted into sessions.'],
          ['Adapters', 'mem0, MemU, and external DB backends need real adapters before selection.'],
        ]}
      />
      <form className="settingsFormCard" onSubmit={submit}>
        <div className="settingsCardHeader">
          <span className="pluginSettingsIcon"><Brain size={18} /></span>
          <div>
            <h2>Active backend</h2>
            <p>Use SQLite locally now. mem0, MemU, and external DBs appear as roadmap adapters until implemented.</p>
          </div>
          <ResourceBadge>{settings?.memory.backend.implemented ? 'Implemented' : 'Adapter required'}</ResourceBadge>
        </div>
        <label>
          <span>Backend</span>
          <select value={backend} onChange={(event) => setBackend(event.target.value)}>
            <option value="sqlite">SQLite</option>
            <option value="in_memory">In-memory</option>
          </select>
        </label>
        <KeyValuePanel rows={[
          ['Memory stores', data.memoryStores.length],
          ['Active stores', data.memoryStores.filter((store) => store.status === 'active').length],
          ['Session mount model', 'Memory Store resource'],
          ['Backend API key', settings?.memory.backend.api_key_state],
        ]} />
        <div className="formActions">
          <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save memory'}</button>
          <SettingsNotice message={message} compact />
        </div>
      </form>
      <RoadmapAdapterGrid items={[
        ['sqlite', 'Implemented local memory backend', true],
        ['in-memory', 'Implemented ephemeral backend for tests', true],
        ['external database', 'Future context-memory adapter', false],
        ['mem0', 'Future semantic memory adapter', false],
        ['MemU', 'Future semantic memory adapter', false],
      ]} />
      <SettingsValidationPanel settings={settings} filterPrefix="memory" onRefresh={onRefresh} />
    </section>
  );
}

export function SettingsSandbox({ data, onRefresh }: { data: ConsoleData; onRefresh: () => void }) {
  const sandbox = data.settings?.sandbox;
  const availableProviders = sandbox?.providers.length ? sandbox.providers : data.runtime?.sandbox_providers ?? ['local'];
  const options = Array.from(new Set([sandbox?.type ?? 'local', ...availableProviders]));
  const [sandboxType, setSandboxType] = useState(sandbox?.type ?? 'local');
  const [configText, setConfigText] = useState(formatConfig(sandbox?.config));
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setSandboxType(sandbox?.type ?? 'local');
    setConfigText(formatConfig(sandbox?.config));
  }, [sandbox?.type, sandbox?.config]);

  const submit = async (event: FormEvent) => {
    event.preventDefault();
    setSaving(true);
    setMessage('');
    try {
      await putJson<RuntimeSettings>('/v1/x/settings', {
        sandbox: {
          type: sandboxType,
          config: parseConfig(configText),
        },
      });
      setMessage('Sandbox settings saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save sandbox settings');
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Sandbox</h1>
          <p>One active sandbox backend controls local execution. Environments describe named execution templates on top of it.</p>
        </div>
      </div>
      <SettingsTruthStrip
        items={[
          ['Backend', 'Selects the runtime execution boundary.'],
          ['Environment templates', 'Define named package, network, and worker policies for sessions.'],
          ['Validation', 'Must prove availability before remote/cloud-style claims.'],
        ]}
      />
      <form className="settingsFormCard" onSubmit={submit}>
        <div className="settingsCardHeader">
          <span className="pluginSettingsIcon"><Shield size={18} /></span>
          <div>
            <h2>Active sandbox</h2>
            <p>Choose one backend reported by the runtime. Environment templates stay separate and are validated against this backend.</p>
          </div>
          <ResourceBadge>{sandbox?.available ? 'Available' : 'Unavailable'}</ResourceBadge>
        </div>
        <div className="settingsFieldGrid">
          <label>
            <span>Backend</span>
            <select value={sandboxType} onChange={(event) => setSandboxType(event.target.value)}>
              {options.map((provider) => <option value={provider} key={provider}>{titleCase(provider.replace('_', ' '))}</option>)}
            </select>
          </label>
          <label className="settingsJsonField">
            <span>Sandbox config JSON</span>
            <textarea value={configText} onChange={(event) => setConfigText(event.target.value)} rows={5} spellCheck={false} />
            <small>Backend-specific options such as docker image, network policy, or worker queue hints once supported.</small>
          </label>
        </div>
        <KeyValuePanel rows={[
          ['Implemented', sandbox?.implemented ? 'yes' : 'no'],
          ['Reported providers', sandbox?.providers.join(', ') || data.runtime?.sandbox_providers.join(', ') || 'local'],
          ['Environment templates', data.environments.length],
        ]} />
        <div className="formActions">
          <button className="primaryButton" type="submit" disabled={saving}>{saving ? 'Saving...' : 'Save sandbox'}</button>
          <SettingsNotice message={message} compact />
        </div>
      </form>
      <div className="tablePanel">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Hosting</th><th>Provider</th><th>Network</th><th>Updated</th></tr></thead>
          <tbody>
            {data.environments.map((environment) => (
              <tr key={environment.id}>
                <td><code>{truncateMiddle(environment.id, 18)}</code></td>
                <td><strong>{environment.name}</strong></td>
                <td><StatusPill status={environment.status} /></td>
                <td><ResourceBadge>{titleCase(environment.hosting_type.replace('_', ' '))}</ResourceBadge></td>
                <td><code>{environment.sandbox_provider ?? 'default'}</code></td>
                <td>{environmentNetworkLabel(environment)}</td>
                <td>{formatDateShort(environment.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {data.environments.length === 0 ? (
          <EmptyState
            icon={<Shield size={22} />}
            title="No environments configured"
            body="Create an environment template before validating how sessions map onto this sandbox backend."
          />
        ) : null}
      </div>
      <SettingsValidationPanel settings={data.settings} filterPrefix="sandbox" onRefresh={onRefresh} />
    </section>
  );
}

function SettingsValidationPanel({ settings, filterPrefix, onRefresh }: { settings: RuntimeSettings | null; filterPrefix?: string; onRefresh?: () => void }) {
  const [validation, setValidation] = useState<RuntimeSettings['validation'] | null>(settings?.validation ?? null);
  const [validating, setValidating] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setValidation(settings?.validation ?? null);
    setMessage('');
  }, [settings?.validation]);

  const runValidation = async () => {
    if (!settings) return;
    setValidating(true);
    setMessage('');
    try {
      const next = await postJson<RuntimeSettings['validation']>('/v1/x/settings/validate', settings);
      setValidation(next);
      setMessage('Validation refreshed.');
      onRefresh?.();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not validate settings');
    } finally {
      setValidating(false);
    }
  };

  const checks = validation?.checks.filter((check) => !filterPrefix || check.key.startsWith(filterPrefix)) ?? [];
  if (!settings || checks.length === 0) return null;
  return (
    <div className="panel subtlePanel">
      <div className="sectionHeaderRow compact">
        <div>
          <h2>Validation</h2>
          <p>Runs current structural and adapter checks. Deeper dry-run probes are tracked in the P0 spec and should replace optimism before alpha.</p>
        </div>
        <button className="secondaryButton" type="button" onClick={() => void runValidation()} disabled={validating}>
          {validating ? 'Validating...' : 'Validate now'}
        </button>
      </div>
      <div className="settingsValidationList">
        {checks.map((check) => (
          <div key={check.key} className={`settingsValidationItem ${check.status}`}>
            <span className="validationDot" />
            <div>
              <strong>{check.label}</strong>
              <p>{check.message}</p>
            </div>
          </div>
        ))}
      </div>
      <SettingsNotice message={message} />
    </div>
  );
}

function SettingsJsonPanel({ settings, onRefresh }: { settings: RuntimeSettings | null; onRefresh: () => void }) {
  const [jsonText, setJsonText] = useState(settings ? JSON.stringify(settings, null, 2) : '{}');
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState('');

  useEffect(() => {
    setJsonText(settings ? JSON.stringify(settings, null, 2) : '{}');
    setMessage('');
  }, [settings]);

  if (!settings) return null;

  const saveJson = async () => {
    setSaving(true);
    setMessage('');
    try {
      const parsed = JSON.parse(jsonText);
      if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
        throw new Error('Settings JSON must be an object');
      }
      await putJson<RuntimeSettings>('/v1/x/settings', parsed);
      setMessage('Settings JSON saved and validated.');
      onRefresh();
    } catch (err: any) {
      setMessage(err?.message ?? 'Could not save settings JSON');
    } finally {
      setSaving(false);
    }
  };

  return (
    <details className="settingsJsonPanel">
      <summary>JSON editor</summary>
      <p>Advanced escape hatch for the same runtime settings contract. The API validates before returning the saved settings.</p>
      <textarea value={jsonText} onChange={(event) => setJsonText(event.target.value)} spellCheck={false} />
      <div className="formActions">
        <button className="secondaryButton" type="button" onClick={() => setJsonText(JSON.stringify(settings, null, 2))}>Reset</button>
        <button className="primaryButton" type="button" onClick={() => void saveJson()} disabled={saving}>{saving ? 'Saving...' : 'Save JSON'}</button>
        <SettingsNotice message={message} compact />
      </div>
    </details>
  );
}

function SettingsTruthStrip({ items }: { items: Array<[string, string]> }) {
  return (
    <div className="settingsTruthStrip" aria-label="Settings truth model">
      {items.map(([label, body]) => (
        <div key={label} className="settingsTruthItem">
          <span>{label}</span>
          <strong>{body}</strong>
        </div>
      ))}
    </div>
  );
}

function SettingsNotice({ message, compact = false }: { message: string; compact?: boolean }) {
  if (!message) return null;
  const warning = /^(could not|settings json must|invalid|failed|error)/i.test(message);
  const success = !warning && /(saved|validated|refreshed)/i.test(message);
  const tone = warning ? 'warning' : success ? 'success' : '';
  return <div className={`noticeBox settingsNotice ${compact ? 'compact' : ''} ${tone}`.trim()}>{message}</div>;
}

function RoadmapAdapterGrid({ items }: { items: Array<[string, string, boolean]> }) {
  return (
    <div className="roadmapAdapterGrid">
      {items.map(([name, description, implemented]) => (
        <div key={name} className={`roadmapAdapterCard ${implemented ? 'implemented' : 'roadmap'}`}>
          <strong>{name}</strong>
          <p>{description}</p>
          <ResourceBadge>{implemented ? 'Implemented' : 'Roadmap'}</ResourceBadge>
        </div>
      ))}
    </div>
  );
}

function SettingsConfigStatePill({ state }: { state: RuntimeConfigState }) {
  if (state === 'configured') return <span className="providerStateBadge ok">configured</span>;
  if (state === 'missing_env') return <span className="providerStateBadge pending">missing env</span>;
  return <span className="providerStateBadge adapter">not set</span>;
}

function runtimeDatabasePath(workspace: Workspace | null) {
  const dataDir = workspace?.directories?.data ?? workspace?.dataDir;
  if (!dataDir) return '';
  return `${dataDir.replace(/\/$/, '')}/data.db`;
}

function formatConfig(value: Record<string, unknown> | undefined) {
  return JSON.stringify(value ?? {}, null, 2);
}

function parseConfig(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return {};
  const parsed = JSON.parse(trimmed);
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw new Error('Config must be a JSON object');
  }
  return parsed;
}

function truncateMiddle(value: string, max = 22) {
  if (value.length <= max) return value;
  const head = Math.max(4, Math.floor((max - 1) / 2));
  const tail = Math.max(4, max - head - 1);
  return `${value.slice(0, head)}…${value.slice(-tail)}`;
}

function environmentNetworkLabel(environment: ConsoleData['environments'][number]) {
  const type = environment.network?.type;
  return typeof type === 'string' ? titleCase(type.replace('_', ' ')) : 'Default';
}
