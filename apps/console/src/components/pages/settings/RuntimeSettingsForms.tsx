import { FormField, OptionsJsonField } from '../../FormPrimitives';
import type { RuntimeSettingsConfig } from '../../../types';
import {
  AdapterSelect,
  type SettingsFormProps,
} from './RuntimeSettingsFormShared';

export { parseOptionsJsonDraft } from '../../FormPrimitives';
export { optionDefaultsForAdapter, type AdapterOption, type SettingsFormProps } from './RuntimeSettingsFormShared';
export { MemorySettingsForm } from './RuntimeSettingsMemoryForm';
export { SandboxSettingsForm } from './RuntimeSettingsSandboxForm';
export { StorageSettingsForm } from './RuntimeSettingsStorageForm';

export function ModelSettingsForm({ adapters, config, onChange, errors, resetKey, apiKeyConfigured }: SettingsFormProps & { apiKeyConfigured: boolean }) {
  return (
    <>
      <FormField label="Vendor" description="The model API family used by this workspace." error={errors?.['model.vendor']}>
        <AdapterSelect
          adapters={adapters}
          value={config.model.vendor}
          onChange={(vendor) => onChange({ ...config, model: { ...config.model, vendor: vendor as RuntimeSettingsConfig['model']['vendor'] } })}
        />
      </FormField>
      <FormField label="Base URL" description="Use the default endpoint or point to an OpenAI-compatible gateway." error={errors?.['model.base_url']}>
        <input
          value={config.model.base_url ?? ''}
          onChange={(event) => onChange({ ...config, model: { ...config.model, base_url: event.target.value || undefined } })}
          placeholder="https://api.example.com/v1"
        />
      </FormField>
      <FormField
        label="API key"
        description={apiKeyConfigured ? 'Keep ******** to preserve the stored key, or replace it with an environment placeholder or a new key.' : 'Environment placeholders such as ${OPENAI_API_KEY} are supported.'}
        error={errors?.['model.api_key']}
      >
        <input
          type="password"
          value={config.model.api_key ?? ''}
          onChange={(event) => onChange({ ...config, model: { ...config.model, api_key: event.target.value || undefined } })}
          placeholder={apiKeyConfigured ? '********' : '${MODEL_API_KEY}'}
        />
      </FormField>
    </>
  );
}

export function LoopEngineSettingsForm({ adapters, config, onChange, errors, resetKey }: SettingsFormProps) {
  return (
    <>
      <FormField label="Provider" description="The engine that executes agent turns and tool loops." error={errors?.['loop_engine.provider']}>
        <AdapterSelect
          adapters={adapters}
          value={config.loop_engine.provider}
          onChange={(provider) => onChange({ ...config, loop_engine: { ...config.loop_engine, provider: provider as RuntimeSettingsConfig['loop_engine']['provider'] } })}
        />
      </FormField>
      <FormField label="Default max steps" description="An Agent's max turns setting overrides this default." error={errors?.['loop_engine.options.default_max_steps']}>
        <input
          type="number"
          min="1"
          max="1000"
          value={config.loop_engine.options.default_max_steps}
          onChange={(event) => onChange({ ...config, loop_engine: { ...config.loop_engine, options: { ...config.loop_engine.options, default_max_steps: Number(event.target.value) } } })}
        />
      </FormField>
      <OptionsJsonField
        value={config.loop_engine.options}
        onChange={(options) => onChange({
          ...config,
          loop_engine: {
            ...config.loop_engine,
            options: { ...options, default_max_steps: Number(options.default_max_steps ?? config.loop_engine.options.default_max_steps) } as RuntimeSettingsConfig['loop_engine']['options'],
          },
        })}
        onInvalid={() => onChange(config)}
        error={errors?.['loop_engine.options']}
        resetKey={resetKey}
      />
    </>
  );
}
