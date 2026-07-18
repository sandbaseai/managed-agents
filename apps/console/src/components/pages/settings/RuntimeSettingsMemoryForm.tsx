import { FormField, InfoRow, OptionsJsonField, StatusBadge, ToggleSwitch } from '../../FormPrimitives';
import type { RuntimeSettingsConfig } from '../../../types';
import { AdapterSelect, type SettingsFormProps } from './RuntimeSettingsFormShared';

export function MemorySettingsForm({ adapters, config, onChange, errors, resetKey }: SettingsFormProps) {
  const provider = adapters.find((adapter) => adapter.id === config.memory.provider);

  return (
    <>
      <div className="settingsHeroCard">
        <div>
          <span className="settingsHeroEyebrow">Context memory</span>
          <h2>{config.memory.enabled ? 'Memory retrieval is enabled' : 'Memory retrieval is disabled'}</h2>
          <p>{config.memory.enabled
            ? 'Sessions can use the configured backend to retrieve long-term workspace context.'
            : 'Sessions will run without long-term context retrieval until this is enabled.'}</p>
        </div>
        <StatusBadge tone={config.memory.enabled ? 'active' : 'disabled'}>
          {config.memory.enabled ? 'enabled' : 'disabled'}
        </StatusBadge>
      </div>
      <FormField label="Context memory" description="Enable long-term context retrieval for sessions.">
        <ToggleSwitch
          checked={config.memory.enabled}
          onChange={(enabled) => onChange({ ...config, memory: { ...config.memory, enabled } })}
        />
      </FormField>
      <FormField label="Provider" description="The backend used for workspace context memory." error={errors?.['memory.provider']}>
        <AdapterSelect
          adapters={adapters}
          value={config.memory.provider}
          onChange={(provider) => onChange({ ...config, memory: { ...config.memory, provider: provider as RuntimeSettingsConfig['memory']['provider'] } })}
        />
      </FormField>
      <InfoRow>
        <span>Selected provider</span>
        <code>{provider?.label ?? config.memory.provider}</code>
        <StatusBadge tone={provider?.status === 'available' ? 'active' : provider?.status === 'invalid' ? 'error' : 'disabled'}>
          {provider?.status ?? 'unknown'}
        </StatusBadge>
      </InfoRow>
      <OptionsJsonField
        value={config.memory.options}
        onChange={(options) => onChange({ ...config, memory: { ...config.memory, options } })}
        onInvalid={() => onChange(config)}
        error={errors?.['memory.options']}
        resetKey={resetKey}
      />
    </>
  );
}
