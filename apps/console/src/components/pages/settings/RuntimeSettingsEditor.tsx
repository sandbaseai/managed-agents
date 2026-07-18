import { MoreVertical } from 'lucide-react';
import { useEffect, useState } from 'react';
import { postJson, putJson } from '../../../api';
import { JsonCodeEditor } from '../../CodeEditor';
import { LoadingState } from '../../Common';
import { ActionNotice, FormActions, InlineStatus, SegmentedControl } from '../../FormPrimitives';
import type { ConsoleData, RuntimeSettingsConfig } from '../../../types';
import {
  LoopEngineSettingsForm,
  MemorySettingsForm,
  ModelSettingsForm,
  SandboxSettingsForm,
  StorageSettingsForm,
} from './RuntimeSettingsForms';
import {
  applyRuntimeSettingsDefaults,
  configKeyForSection,
  isSettingsPathInSection,
  mergeRuntimeSettingsSectionJson,
  preserveCandidateSecrets,
  runtimeSettingsSectionJson,
  stableSettingsJson,
  testAreaForSection,
  type RuntimeSettingsSection,
} from './RuntimeSettingsEditorState';

export {
  applyRuntimeSettingsDefaults,
  mergeRuntimeSettingsSectionJson,
  preserveCandidateSecrets,
  runtimeSettingsSectionJson,
} from './RuntimeSettingsEditorState';

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
  const [draft, setDraft] = useState<RuntimeSettingsConfig | null>(
    settings ? applyRuntimeSettingsDefaults(settings.saved_config, settings.adapters) : null,
  );
  const [json, setJson] = useState(
    settings ? runtimeSettingsSectionJson(applyRuntimeSettingsDefaults(settings.saved_config, settings.adapters), section) : '',
  );
  const [error, setError] = useState('');
  const [saving, setSaving] = useState(false);
  const [testing, setTesting] = useState(false);
  const [restarting, setRestarting] = useState(false);
  const [validationState, setValidationState] = useState<'unknown' | 'valid' | 'invalid'>('unknown');
  const [validatedJson, setValidatedJson] = useState('');
  const [validationErrors, setValidationErrors] = useState<Record<string, string>>({});
  const [formResetKey, setFormResetKey] = useState(0);
  const [actionsOpen, setActionsOpen] = useState(false);

  useEffect(() => {
    const hydrated = settings ? applyRuntimeSettingsDefaults(settings.saved_config, settings.adapters) : null;
    setDraft(hydrated);
    setJson(hydrated ? runtimeSettingsSectionJson(hydrated, section) : '');
    setError('');
    setValidationState('unknown');
    setValidatedJson('');
    setValidationErrors({});
    setFormResetKey((key) => key + 1);
  }, [settings?.revision, section]);

  if (!settings || !draft) return <LoadingState label="Loading runtime settings..." />;

  const savedConfig = applyRuntimeSettingsDefaults(settings.saved_config, settings.adapters);
  const savedJson = runtimeSettingsSectionJson(savedConfig, section);
  const savedFingerprint = stableSettingsJson(savedConfig);
  const currentJsonCandidate = mode === 'json' ? mergeRuntimeSettingsSectionJson(draft, section, json) : draft;
  const currentJson = mode === 'json' ? json : runtimeSettingsSectionJson(draft, section);
  const currentFingerprint = currentJsonCandidate ? stableSettingsJson(currentJsonCandidate) : null;
  const isDirty = currentFingerprint ? currentFingerprint !== savedFingerprint : currentJson !== savedJson;
  const isPositiveMessage = error === 'Configuration is valid.'
    || error.startsWith('Saved.')
    || error.startsWith('Restart scheduled.')
    || error.includes('OK ')
    || error.includes('SKIPPED ');
  const canRestartFromMessage = error.startsWith('Saved.') || error.startsWith('Restart scheduled.');
  const sectionActivationErrors = settings.activation_status === 'failed'
    ? settings.activation_errors.filter((item) => isSettingsPathInSection(item.path || 'config', section))
    : [];
  const activationErrorCount = sectionActivationErrors.length;
  const visibleErrors = {
    ...Object.fromEntries(sectionActivationErrors.map((item) => [item.path || 'config', item.message])),
    ...validationErrors,
  };
  const setConfig = (next: RuntimeSettingsConfig, validation: 'unknown' | 'valid' = 'unknown') => {
    const hydrated = applyRuntimeSettingsDefaults(next, settings.adapters);
    setDraft(hydrated);
    setJson(runtimeSettingsSectionJson(hydrated, section));
    setValidationState(validation);
    setValidatedJson(validation === 'valid' ? stableSettingsJson(hydrated) : '');
    if (validation === 'unknown') setValidationErrors({});
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
      const candidate = mode === 'json' ? mergeRuntimeSettingsSectionJson(draft, section, json) : draft;
      if (!candidate) throw new Error('Configuration is invalid JSON.');
      const result = await postJson<{
        valid: boolean;
        normalized_config?: RuntimeSettingsConfig;
        errors: Array<{ path: string; message: string }>;
      }>('/v1/x/settings/validate', candidate);
      if (!result.valid) {
        setValidationErrors(Object.fromEntries(result.errors.map((item) => [item.path, item.message])));
        setError(result.errors.map((item) => `${item.path || 'config'}: ${item.message}`).join('\n'));
        setValidationState('invalid');
        setValidatedJson('');
        return null;
      }
      const normalized = result.normalized_config
        ? preserveCandidateSecrets(result.normalized_config, candidate)
        : candidate;
      setConfig(normalized, 'valid');
      setValidationErrors({});
      setError('Configuration is valid.');
      return normalized;
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Configuration is invalid JSON.');
      setValidationState('invalid');
      setValidatedJson('');
      setValidationErrors({ config: err instanceof Error ? err.message : 'Configuration is invalid JSON.' });
      return null;
    }
  };
  const save = async () => {
    if (!currentFingerprint || !isDirty) {
      setError('No settings changes to save.');
      return;
    }
    let configToSave = draft;
    if (validationState !== 'valid' || validatedJson !== currentFingerprint) {
      const validated = await validate();
      if (!validated) return;
      configToSave = validated;
    }
    setSaving(true);
    try {
      await putJson('/v1/x/settings', { revision: settings.revision, config: configToSave });
      setError('Saved. Restart the runtime once to apply this saved configuration.');
      onRefresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : 'Could not save settings.');
    } finally {
      setSaving(false);
    }
  };
  const testConnection = async () => {
    setActionsOpen(false);
    setTesting(true);
    try {
      const candidate = mode === 'json' ? mergeRuntimeSettingsSectionJson(draft, section, json) : draft;
      if (!candidate) throw new Error('Configuration is invalid JSON.');
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
      syncConfigAfterConnectionTest(candidate);
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
    setActionsOpen(false);
    setDraft(savedConfig);
    setJson(savedJson);
    setError('');
    setValidationState('unknown');
    setValidatedJson('');
    setValidationErrors({});
    setFormResetKey((key) => key + 1);
  };
  const syncConfigAfterConnectionTest = (next: RuntimeSettingsConfig) => {
    const hydrated = applyRuntimeSettingsDefaults(next, settings.adapters);
    const fingerprint = stableSettingsJson(hydrated);
    setDraft(hydrated);
    setJson(runtimeSettingsSectionJson(hydrated, section));
    if (validatedJson !== fingerprint) {
      setValidationState('unknown');
      setValidatedJson('');
      setValidationErrors({});
    }
  };

  return (
    <section className="stack runtimeSettingsEditor">
      <div className="pageIntro">
        <div>
          <h1>{title}</h1>
          <p>{subtitle}</p>
          {sectionActivationErrors.length > 0 ? <InlineStatus tone="error">
            <span>Saved settings are not active.</span>
            <span>Fix {activationErrorCount === 1 ? 'the highlighted field' : `${activationErrorCount} highlighted fields`}, save, then restart once.</span>
          </InlineStatus> : null}
        </div>
      </div>
      <SegmentedControl value={mode} onChange={setMode} options={[{ value: 'form', label: 'Form' }, { value: 'json', label: 'JSON' }]} />
      {mode === 'form' ? <div className="panel formStack runtimeSettingsForm">
        {section === 'models' ? <ModelSettingsForm adapters={adapters} config={draft} onChange={setConfig} errors={visibleErrors} resetKey={formResetKey} apiKeyConfigured={settings.secret_states.model.api_key === 'configured'} /> : null}
        {section === 'loop-engine' ? <LoopEngineSettingsForm adapters={adapters} config={draft} onChange={setConfig} errors={visibleErrors} resetKey={formResetKey} /> : null}
        {section === 'storage' ? (
          <StorageSettingsForm
            metadataAdapters={settings.adapters.storage.metadata}
            artifactAdapters={settings.adapters.storage.artifacts}
            config={draft}
            onChange={setConfig}
            errors={visibleErrors}
            resetKey={formResetKey}
            diagnostics={settings.diagnostics.metadata}
          />
        ) : null}
        {section === 'memory' ? <MemorySettingsForm adapters={adapters} config={draft} onChange={setConfig} errors={visibleErrors} resetKey={formResetKey} /> : null}
        {section === 'sandbox' ? <SandboxSettingsForm adapters={adapters} config={draft} onChange={setConfig} errors={visibleErrors} resetKey={formResetKey} /> : null}
      </div> : <div className="stack">
        <p className="formHint">Editing only the {title} configuration JSON. Save merges this section into the versioned runtime settings document.</p>
        <JsonCodeEditor value={json} onChange={(value) => {
          setJson(value);
          setValidationState('unknown');
          setValidatedJson('');
          setValidationErrors({});
        }} />
      </div>}
      {error ? isPositiveMessage ? (
        <ActionNotice>
          <span>{error}</span>
          {canRestartFromMessage ? <button className="secondaryButton" type="button" onClick={() => void restart()} disabled={restarting}>{restarting ? 'Restarting...' : 'Restart now'}</button> : null}
        </ActionNotice>
      ) : <div className="formError">{error}</div> : null}
      <FormActions>
        <div className="menuWrap settingsActionsMenu">
          <button className="iconButton" type="button" onClick={() => setActionsOpen((open) => !open)} title="More settings actions" aria-label="More settings actions">
            <MoreVertical size={18} />
          </button>
          {actionsOpen ? (
            <div className="agentMenu settingsMoreMenu">
              <button type="button" onClick={() => { setActionsOpen(false); void validate(); }}>Validate</button>
              <button type="button" onClick={() => void testConnection()} disabled={testing}>{testing ? 'Checking...' : 'Check configuration'}</button>
            </div>
          ) : null}
        </div>
        {isDirty ? <button className="secondaryButton" type="button" onClick={discard} disabled={saving}>Discard</button> : null}
        <button className="primaryButton" type="button" onClick={() => void save()} disabled={!isDirty || saving}>{saving ? 'Saving...' : 'Save settings'}</button>
      </FormActions>
    </section>
  );
}
