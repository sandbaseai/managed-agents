import { BadgeList, FormField, InfoRow, OptionsJsonField, StatusBadge } from '../../FormPrimitives';
import type { RuntimeSettingsConfig } from '../../../types';
import {
  AdapterSelect,
  optionDefaultsForAdapter,
  type SettingsFormProps,
} from './RuntimeSettingsFormShared';

export function SandboxSettingsForm({ adapters, config, onChange, errors, resetKey }: SettingsFormProps) {
  const changeSandboxProvider = (provider: RuntimeSettingsConfig['sandbox']['provider']) => {
    onChange({
      ...config,
      sandbox: {
        provider,
        options: optionDefaultsForAdapter(adapters, provider) as RuntimeSettingsConfig['sandbox']['options'],
      },
    });
  };

  return (
    <>
      <FormField
        label="Default provider"
        description={<>Named <a href="#environments">Environments</a> can override this default provider.</>}
        error={errors?.['sandbox.provider']}
      >
        <AdapterSelect
          adapters={adapters}
          value={config.sandbox.provider}
          onChange={(provider) => changeSandboxProvider(provider as RuntimeSettingsConfig['sandbox']['provider'])}
        />
      </FormField>
      <FormField label="Timeout" description="Maximum runtime for a tool execution." error={errors?.['sandbox.options.timeout_seconds']}>
        <input
          type="number"
          min="1"
          value={config.sandbox.options.timeout_seconds}
          onChange={(event) => onChange({ ...config, sandbox: { ...config.sandbox, options: { ...config.sandbox.options, timeout_seconds: Number(event.target.value) } } })}
        />
      </FormField>
      {config.sandbox.provider === 'docker' ? (
        <FormField label="Image" description="Container image used when Docker sandboxing is active." error={errors?.['sandbox.options.image']}>
          <input
            value={String(config.sandbox.options.image ?? '')}
            onChange={(event) => onChange({ ...config, sandbox: { ...config.sandbox, options: { ...config.sandbox.options, image: event.target.value } } })}
            placeholder="node:22-bookworm"
          />
        </FormField>
      ) : null}
      {config.sandbox.provider === 'remote' ? (
        <>
          <InfoRow>
            <span>Runtime mapping</span>
            <code>remote → self_hosted worker queue</code>
            <StatusBadge tone="active">worker endpoints enabled</StatusBadge>
          </InfoRow>
          <FormField
            label="Worker API URL"
            description="Base URL workers use to claim and complete queued sandbox work items."
            error={errors?.['sandbox.options.endpoint']}
          >
            <input
              value={String(config.sandbox.options.endpoint ?? '')}
              onChange={(event) => onChange({ ...config, sandbox: { ...config.sandbox, options: { ...config.sandbox.options, endpoint: event.target.value } } })}
              placeholder="${MANAGED_AGENTS_API_URL}"
            />
          </FormField>
          <FormField
            label="Worker API key"
            description="Bearer token used by remote workers when local API authentication is enabled."
            error={errors?.['sandbox.options.api_key']}
          >
            <input
              type="password"
              value={String(config.sandbox.options.api_key ?? '')}
              onChange={(event) => onChange({ ...config, sandbox: { ...config.sandbox, options: { ...config.sandbox.options, api_key: event.target.value } } })}
              placeholder="${MANAGED_AGENTS_WORKER_API_KEY}"
            />
          </FormField>
        </>
      ) : null}
      <OptionsJsonField
        value={config.sandbox.options}
        onChange={(options) => onChange({
          ...config,
          sandbox: {
            ...config.sandbox,
            options: { ...options, timeout_seconds: Number(options.timeout_seconds ?? config.sandbox.options.timeout_seconds) } as RuntimeSettingsConfig['sandbox']['options'],
          },
        })}
        onInvalid={() => onChange(config)}
        error={errors?.['sandbox.options']}
        resetKey={resetKey}
      />
      <BadgeList ariaLabel="Sandbox adapter availability">
        {adapters.map((adapter) => (
          <StatusBadge key={adapter.id} tone={adapter.status === 'available' ? 'active' : adapter.status === 'invalid' ? 'error' : 'disabled'}>
            {adapter.label}: {adapter.status}
          </StatusBadge>
        ))}
      </BadgeList>
    </>
  );
}
