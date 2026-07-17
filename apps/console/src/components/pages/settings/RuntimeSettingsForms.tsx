import { BadgeList, FormField, FormSection, InfoRow, OptionsJsonField, StatusBadge, ToggleSwitch } from '../../FormPrimitives';
import type { RuntimeSettingsConfig } from '../../../types';

export { parseOptionsJsonDraft } from '../../FormPrimitives';

export type AdapterOption = {
  id: string;
  label: string;
  status: 'available' | 'unavailable' | 'invalid';
  options_schema?: Record<string, unknown>;
};

type SettingsFormProps = {
  adapters: AdapterOption[];
  config: RuntimeSettingsConfig;
  onChange: (config: RuntimeSettingsConfig) => void;
  errors?: Record<string, string>;
  resetKey?: number;
};

function AdapterSelect({
  adapters,
  value,
  onChange,
  allowUnavailable = false,
}: {
  adapters: AdapterOption[];
  value: string;
  onChange: (value: string) => void;
  allowUnavailable?: boolean;
}) {
  return (
    <select value={value} onChange={(event) => onChange(event.target.value)}>
      {adapters.map((item) => (
        <option key={item.id} value={item.id} disabled={allowUnavailable ? item.status === 'invalid' : item.status !== 'available'}>
          {item.label}{item.status === 'available' ? '' : ` - ${item.status}`}
        </option>
      ))}
    </select>
  );
}

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

export function StorageSettingsForm({
  metadataAdapters,
  artifactAdapters,
  config,
  onChange,
  errors,
  resetKey,
  diagnostics,
}: Omit<SettingsFormProps, 'adapters'> & {
  metadataAdapters: AdapterOption[];
  artifactAdapters: AdapterOption[];
  diagnostics: { path: string | null; health: 'ok' | 'failed' };
}) {
  const changeMetadataProvider = (provider: RuntimeSettingsConfig['storage']['metadata']['provider']) => {
    onChange({
      ...config,
      storage: {
        ...config.storage,
        metadata: {
          provider,
          options: optionDefaultsForAdapter(metadataAdapters, provider),
        },
      },
    });
  };
  const changeArtifactProvider = (provider: RuntimeSettingsConfig['storage']['artifacts']['provider']) => {
    onChange({
      ...config,
      storage: {
        ...config.storage,
        artifacts: {
          provider,
          options: optionDefaultsForAdapter(artifactAdapters, provider),
        },
      },
    });
  };

  return (
    <>
      <FormSection title="Metadata storage">
        <FormField label="Provider" description="Stores agents, sessions, settings, events, and other workspace metadata." error={errors?.['storage.metadata.provider']}>
          <AdapterSelect
            adapters={metadataAdapters}
            value={config.storage.metadata.provider}
            allowUnavailable
            onChange={(provider) => changeMetadataProvider(provider as RuntimeSettingsConfig['storage']['metadata']['provider'])}
          />
        </FormField>
        {config.storage.metadata.provider === 'sqlite' ? (
          <InfoRow>
            <span>Database</span>
            <code>{diagnostics.path ?? 'Unavailable'}</code>
            <StatusBadge tone={diagnostics.health === 'ok' ? 'active' : 'error'}>{diagnostics.health}</StatusBadge>
          </InfoRow>
        ) : (
          <FormField label="Connection string" description="Use an environment placeholder such as ${DATABASE_URL}." error={errors?.['storage.metadata.options.connection_string']}>
            <input
              value={String(config.storage.metadata.options.connection_string ?? '')}
              onChange={(event) => onChange({
                ...config,
                storage: {
                  ...config.storage,
                  metadata: {
                    ...config.storage.metadata,
                    options: { ...config.storage.metadata.options, connection_string: event.target.value },
                  },
                },
              })}
              placeholder="${DATABASE_URL}"
            />
          </FormField>
        )}
        <OptionsJsonField
          value={config.storage.metadata.options}
          onChange={(options) => onChange({ ...config, storage: { ...config.storage, metadata: { ...config.storage.metadata, options } } })}
          onInvalid={() => onChange(config)}
          error={errors?.['storage.metadata.options']}
          resetKey={resetKey}
        />
      </FormSection>
      <FormSection title="Artifact storage">
        <FormField label="Provider" description="Stores uploaded files and generated artifacts." error={errors?.['storage.artifacts.provider']}>
          <AdapterSelect
            adapters={artifactAdapters}
            value={config.storage.artifacts.provider}
            allowUnavailable
            onChange={(provider) => changeArtifactProvider(provider as RuntimeSettingsConfig['storage']['artifacts']['provider'])}
          />
        </FormField>
        {config.storage.artifacts.provider === 'local' ? (
          <FormField label="Base path" description="Relative paths resolve under the runtime data directory." error={errors?.['storage.artifacts.options.base_path']}>
            <input
              value={String(config.storage.artifacts.options.base_path ?? '')}
              onChange={(event) => onChange({
                ...config,
                storage: {
                  ...config.storage,
                  artifacts: {
                    ...config.storage.artifacts,
                    options: { ...config.storage.artifacts.options, base_path: event.target.value },
                  },
                },
              })}
            />
          </FormField>
        ) : (
          <>
            <FormField label="Endpoint" description="S3 or S3-compatible API endpoint." error={errors?.['storage.artifacts.options.endpoint']}>
              <input
                value={String(config.storage.artifacts.options.endpoint ?? '')}
                onChange={(event) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, endpoint: event.target.value } } } })}
                placeholder="https://s3.amazonaws.com"
              />
            </FormField>
            <FormField label="Bucket" description="Bucket used for uploaded files and generated artifacts." error={errors?.['storage.artifacts.options.bucket']}>
              <input
                value={String(config.storage.artifacts.options.bucket ?? '')}
                onChange={(event) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, bucket: event.target.value } } } })}
                placeholder="managed-agents-artifacts"
              />
            </FormField>
            <FormField label="Region" description="Region for AWS S3; leave provider-specific values in options for compatible stores." error={errors?.['storage.artifacts.options.region']}>
              <input
                value={String(config.storage.artifacts.options.region ?? '')}
                onChange={(event) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, region: event.target.value } } } })}
                placeholder="us-east-1"
              />
            </FormField>
            <FormField label="Access key" description="Environment placeholders such as ${AWS_ACCESS_KEY_ID} are supported." error={errors?.['storage.artifacts.options.access_key']}>
              <input
                type="password"
                value={String(config.storage.artifacts.options.access_key ?? '')}
                onChange={(event) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, access_key: event.target.value } } } })}
                placeholder="${AWS_ACCESS_KEY_ID}"
              />
            </FormField>
            <FormField label="Secret key" description="Use an environment placeholder or a stored secret reference." error={errors?.['storage.artifacts.options.secret_key']}>
              <input
                type="password"
                value={String(config.storage.artifacts.options.secret_key ?? '')}
                onChange={(event) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, secret_key: event.target.value } } } })}
                placeholder="${AWS_SECRET_ACCESS_KEY}"
              />
            </FormField>
            <FormField label="Path-style requests" description="Enable for MinIO and some S3-compatible stores.">
              <ToggleSwitch
                checked={Boolean(config.storage.artifacts.options.force_path_style)}
                onChange={(checked) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options: { ...config.storage.artifacts.options, force_path_style: checked } } } })}
              />
            </FormField>
          </>
        )}
        <OptionsJsonField
          value={config.storage.artifacts.options}
          onChange={(options) => onChange({ ...config, storage: { ...config.storage, artifacts: { ...config.storage.artifacts, options } } })}
          onInvalid={() => onChange(config)}
          error={errors?.['storage.artifacts.options']}
          resetKey={resetKey}
        />
        <BadgeList ariaLabel="Storage adapter availability">
          {[...metadataAdapters.map((adapter) => ({ ...adapter, prefix: 'Metadata' })), ...artifactAdapters.map((adapter) => ({ ...adapter, prefix: 'Artifacts' }))].map((adapter) => (
            <StatusBadge key={`${adapter.prefix}-${adapter.id}`} tone={adapter.status === 'available' ? 'active' : adapter.status === 'invalid' ? 'error' : 'disabled'}>
              {adapter.prefix} {adapter.label}: {adapter.status}
            </StatusBadge>
          ))}
        </BadgeList>
      </FormSection>
    </>
  );
}

export function optionDefaultsForAdapter(adapters: AdapterOption[], id: string): Record<string, unknown> {
  const schema = adapters.find((adapter) => adapter.id === id)?.options_schema;
  if (!schema || typeof schema !== 'object') return {};
  const properties = (schema as { properties?: unknown }).properties;
  if (!properties || typeof properties !== 'object' || Array.isArray(properties)) return {};
  return Object.fromEntries(Object.entries(properties as Record<string, unknown>).flatMap(([key, value]) => {
    if (!value || typeof value !== 'object' || Array.isArray(value) || !('default' in value)) return [];
    return [[key, (value as { default: unknown }).default]];
  }));
}

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
