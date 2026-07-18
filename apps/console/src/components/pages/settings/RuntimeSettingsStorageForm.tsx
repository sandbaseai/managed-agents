import { BadgeList, FormField, FormSection, InfoRow, OptionsJsonField, StatusBadge, ToggleSwitch } from '../../FormPrimitives';
import type { RuntimeSettingsConfig } from '../../../types';
import {
  AdapterSelect,
  optionDefaultsForAdapter,
  type AdapterOption,
  type SettingsFormProps,
} from './RuntimeSettingsFormShared';

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
