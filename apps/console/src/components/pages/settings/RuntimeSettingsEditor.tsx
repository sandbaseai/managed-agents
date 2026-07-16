import { useEffect, useState } from 'react';
import { postJson, putJson } from '../../../api';
import { LoadingState } from '../../Common';
import type { ConsoleData, RuntimeSettingsConfig } from '../../../types';
import type { SettingsSection } from './navigation';

type RuntimeSettingsSection = Extract<SettingsSection, 'models' | 'loop-engine' | 'storage' | 'memory' | 'sandbox'>;

type AdapterOption = {
  id: string;
  label: string;
  status: string;
};

export function RuntimeSettingsEditor({
  data,
  section,
  onRefresh,
}: {
  data: ConsoleData;
  section: RuntimeSettingsSection;
  onRefresh: () => void;
}) {
  const settings = data.settings;
  const [mode, setMode] = useState<'form' | 'json'>('form');
  const [draft, setDraft] = useState<RuntimeSettingsConfig | null>(settings?.saved_config ?? null);
  const [json, setJson] = useState('');
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restarting, setRestarting] = useState(false);

  useEffect(() => {
    setDraft(settings?.saved_config ?? null);
    setJson(settings ? JSON.stringify(settings.saved_config, null, 2) : '');
    setError('');
  }, [settings?.revision]);

  if (!settings || !draft) return <LoadingState label="Loading runtime settings..." />;

  const savedJson = JSON.stringify(settings.saved_config, null, 2);
  const currentJson = mode === 'json' ? json : JSON.stringify(draft, null, 2);
  const isDirty = currentJson !== savedJson;
  const isPositiveMessage = error === 'Configuration is valid.'
    || error.startsWith('Saved.')
    || error.includes('OK ')
    || error.includes('SKIPPED ');

  const setConfig = (next: RuntimeSettingsConfig) => {
    setDraft(next);
    setJson(JSON.stringify(next, null, 2));
  };
  const adapters = section === 'models' ? settings.adapters.model
    : section === 'loop-engine' ? settings.adapters.loop_engine
      : section === 'memory' ? settings.adapters.memory
        : section === 'sandbox' ? settings.adapters.sandbox
          : [];
  const title = section === 'models' ? 'Model' : section === 'loop-engine' ? 'Loop engine' : section === 'memory' ? 'Memory' : section === 'sandbox' ? 'Sandbox' : 'Storage';
  const subtitle = section === 'models'
    ? 'Configure the single model vendor used by this workspace.'
    : section === 'loop-engine'
      ? 'Configure the one engine that runs agent turns and tool loops.'
      : section === 'memory'
        ? 'Configure the context-memory backend. Memory Stores remain separate resources.'
        : section === 'sandbox'
          ? 'Configure the default sandbox. Environments can override it for individual sessions.'
          : 'Metadata and artifact storage are the two global storage backends.';

  const validate = async (): Promise<RuntimeSettingsConfig | null> => {
    try {
      const candidate = mode === 'json' ? JSON.parse(json) as RuntimeSettingsConfig : draft;
      const result = await postJson<{ valid: boolean; errors: Array<{ path: string; message: string }> }>('/v1/x/settings/validate', candidate);
      if (!result.valid) {
        setError(result.errors.map((item) => `${item.path || 'config'}: ${item.message}`).join('\n'));
        return null;
      }
      setConfig(candidate);
      setError('Configuration is valid.');
      return candidate;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Configuration is invalid JSON.');
      return null;
    }
  };
  const save = async () => {
    setSaving(true);
    try {
      const candidate = await validate();
      if (!candidate) return;
      await putJson('/v1/x/settings', { revision: settings.revision, config: candidate });
      setError('Saved. Restart the runtime to apply this configuration.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };
  const testConnection = async () => {
    setTesting(true);
    try {
      const candidate = mode === 'json' ? JSON.parse(json) as RuntimeSettingsConfig : draft;
      const areas = section === 'storage'
        ? [
          { area: 'storage.metadata', config: candidate.storage.metadata, full_config: candidate },
          { area: 'storage.artifacts', config: candidate.storage.artifacts, full_config: candidate },
        ]
        : [{ area: testAreaForSection(section), config: candidate[configKeyForSection(section)], full_config: candidate }];
      const results = await Promise.all(areas.map((item) => postJson<{
        ok: boolean;
        status: string;
        checks: Array<{ name: string; status: string; message: string }>;
        errors?: Array<{ path: string; message: string }>;
      }>('/v1/x/settings/test', item)));
      const messages = results.flatMap((result) => {
        if (result.checks.length === 0 && result.errors?.length) return result.errors.map((item) => `${item.path}: ${item.message}`);
        return result.checks.map((check) => `${check.status.toUpperCase()} ${check.name}: ${check.message}`);
      });
      setConfig(candidate);
      setError(messages.join('\n') || 'Connection test completed.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Connection test failed.');
    } finally {
      setTesting(false);
    }
  };
  const restart = async () => {
    setRestarting(true);
    try {
      await postJson('/v1/x/restart', {});
      setError('Restart scheduled. Refresh this page once the runtime is ready.');
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not restart the runtime.');
    } finally {
      setRestarting(false);
    }
  };
  const discard = () => {
    setDraft(settings.saved_config);
    setJson(savedJson);
    setError('');
  };

  const adapterOptions = (items: AdapterOption[], value: string) => (
    <select value={value} onChange={(event) => {
      const selected = event.target.value;
      if (section === 'models') setConfig({ ...draft, model: { ...draft.model, vendor: selected as RuntimeSettingsConfig['model']['vendor'] } });
      if (section === 'loop-engine') setConfig({ ...draft, loop_engine: { ...draft.loop_engine, provider: selected as RuntimeSettingsConfig['loop_engine']['provider'] } });
      if (section === 'memory') setConfig({ ...draft, memory: { ...draft.memory, provider: selected as RuntimeSettingsConfig['memory']['provider'] } });
      if (section === 'sandbox') setConfig({ ...draft, sandbox: { ...draft.sandbox, provider: selected as RuntimeSettingsConfig['sandbox']['provider'] } });
    }}>
      {items.map((item) => <option key={item.id} value={item.id} disabled={item.status !== 'available'}>{item.label}{item.status === 'available' ? '' : ' - unavailable'}</option>)}
    </select>
  );

  return (
    <section className="stack runtimeSettingsEditor">
      <div className="pageIntro">
        <div><h1>{title}</h1><p>{subtitle}</p></div>
        {settings.restart_required ? <span className="providerStateBadge pending">Restart required</span> : null}
      </div>
      <div className="settingsEditorTabs">
        <button type="button" className={mode === 'form' ? 'active' : ''} onClick={() => setMode('form')}>Form</button>
        <button type="button" className={mode === 'json' ? 'active' : ''} onClick={() => setMode('json')}>JSON</button>
      </div>
      {mode === 'form' ? <div className="panel formStack runtimeSettingsForm">
        {section === 'models' ? <>
          <label><span>Vendor</span>{adapterOptions(adapters, draft.model.vendor)}</label>
          <label><span>Base URL</span><input value={draft.model.base_url ?? ''} onChange={(event) => setConfig({ ...draft, model: { ...draft.model, base_url: event.target.value || undefined } })} placeholder="https://api.example.com/v1" /></label>
          <label><span>API key</span><input type="password" value={draft.model.api_key ?? ''} onChange={(event) => setConfig({ ...draft, model: { ...draft.model, api_key: event.target.value || undefined } })} placeholder={settings.secret_states.model.api_key === 'configured' ? 'Configured - leave blank to keep' : '${MODEL_API_KEY}'} /></label>
        </> : null}
        {section === 'loop-engine' ? <>
          <label><span>Provider</span>{adapterOptions(adapters, draft.loop_engine.provider)}</label>
          <label><span>Default max steps</span><input type="number" min="1" max="1000" value={draft.loop_engine.options.default_max_steps} onChange={(event) => setConfig({ ...draft, loop_engine: { ...draft.loop_engine, options: { ...draft.loop_engine.options, default_max_steps: Number(event.target.value) } } })} /></label>
          <p className="formHint">An Agent's max turns setting overrides this default.</p>
        </> : null}
        {section === 'storage' ? <>
          <div className="storageSettingsSection"><h2>Metadata storage</h2><label><span>Provider</span><select value={draft.storage.metadata.provider} disabled><option value="sqlite">SQLite</option></select></label><p className="formHint">The runtime database is initialized through migrations. External database adapters are not available yet.</p></div>
          <div className="storageSettingsSection"><h2>Artifact storage</h2><label><span>Provider</span><select value={draft.storage.artifacts.provider} disabled><option value="local">Local filesystem</option></select></label><label><span>Base path</span><input value={String(draft.storage.artifacts.options.base_path ?? '')} onChange={(event) => setConfig({ ...draft, storage: { ...draft.storage, artifacts: { ...draft.storage.artifacts, options: { ...draft.storage.artifacts.options, base_path: event.target.value } } } })} /></label></div>
        </> : null}
        {section === 'memory' ? <>
          <label className="checkRow"><input type="checkbox" checked={draft.memory.enabled} onChange={(event) => setConfig({ ...draft, memory: { ...draft.memory, enabled: event.target.checked } })} /><span>Enable context memory</span></label>
          <label><span>Provider</span>{adapterOptions(adapters, draft.memory.provider)}</label>
        </> : null}
        {section === 'sandbox' ? <>
          <label><span>Default provider</span>{adapterOptions(adapters, draft.sandbox.provider)}</label>
          <label><span>Timeout (seconds)</span><input type="number" min="1" value={draft.sandbox.options.timeout_seconds} onChange={(event) => setConfig({ ...draft, sandbox: { ...draft.sandbox, options: { ...draft.sandbox.options, timeout_seconds: Number(event.target.value) } } })} /></label>
          <p className="formHint">Named Environments can override this default provider.</p>
        </> : null}
      </div> : <textarea className="settingsJsonEditor" value={json} onChange={(event) => setJson(event.target.value)} spellCheck={false} />}
      {error ? <div className={isPositiveMessage ? 'noticeBox' : 'formError'}>{error}</div> : null}
      <div className="modalActions settingsEditorActions">
        <button className="secondaryButton" type="button" onClick={() => void validate()}>Validate</button>
        <button className="secondaryButton" type="button" onClick={() => void testConnection()} disabled={testing}>{testing ? 'Testing...' : 'Test connection'}</button>
        <button className="secondaryButton" type="button" onClick={discard} disabled={!isDirty || saving}>Discard</button>
        {settings.restart_required ? <button className="secondaryButton" type="button" onClick={() => void restart()} disabled={restarting}>{restarting ? 'Restarting...' : 'Restart runtime'}</button> : null}
        <button className="primaryButton" type="button" onClick={() => void save()} disabled={saving || !isDirty}>{saving ? 'Saving...' : 'Save settings'}</button>
      </div>
    </section>
  );
}

function testAreaForSection(section: RuntimeSettingsSection): 'model' | 'loop_engine' | 'memory' | 'sandbox' {
  if (section === 'models') return 'model';
  if (section === 'loop-engine') return 'loop_engine';
  if (section === 'memory') return 'memory';
  return 'sandbox';
}

function configKeyForSection(section: Exclude<RuntimeSettingsSection, 'storage'>): 'model' | 'loop_engine' | 'memory' | 'sandbox' {
  if (section === 'models') return 'model';
  if (section === 'loop-engine') return 'loop_engine';
  if (section === 'memory') return 'memory';
  return 'sandbox';
}
