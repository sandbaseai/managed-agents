import { describe, expect, it } from 'vitest';
import {
  environmentDraftFromApi,
  environmentKind,
  environmentPayloadFromDraft,
  sandboxProviderForHostingType,
  splitCsv,
} from '../../apps/console/src/components/pages/EnvironmentPageModel';
import type { Environment } from '../../apps/console/src/types';

describe('environment page model helpers', () => {
  it('maps hosting types to labels and sandbox providers', () => {
    expect(environmentKind(environment({ hosting_type: 'self_hosted' }))).toBe('Self-hosted');
    expect(sandboxProviderForHostingType('self_hosted')).toBe('self_hosted');
    expect(sandboxProviderForHostingType('local')).toBe('local');
    expect(sandboxProviderForHostingType('cloud')).toBe('cloud');
  });

  it('builds an editor draft from API environment data', () => {
    const draft = environmentDraftFromApi(environment({
      config: {
        network: {
          type: 'unrestricted',
          allow_mcp_server_network_access: true,
          allow_package_manager_network_access: false,
          allowed_hosts: ['example.com'],
        },
        packages: [{ manager: 'npm', package: 'typescript' }],
      },
      metadata: {
        owner: 'runtime',
        environment_keys: '[{"id":"envkey_1","name":"host"}]',
      },
    }));

    expect(draft.networkType).toBe('unrestricted');
    expect(draft.allowedHosts).toBe('example.com');
    expect(draft.packages).toMatchObject([{ manager: 'npm', package: 'typescript' }]);
    expect(draft.metadata).toMatchObject([{ key: 'owner', value: 'runtime' }]);
    expect(draft.preservedMetadata).toEqual({ environment_keys: '[{"id":"envkey_1","name":"host"}]' });
  });

  it('creates the API payload while preserving protected metadata', () => {
    const payload = environmentPayloadFromDraft({
      name: '  CI  ',
      description: 'runner',
      hostingType: 'local',
      networkType: 'limited',
      allowMcpServerNetworkAccess: true,
      allowPackageManagerNetworkAccess: true,
      allowedHosts: 'example.com, api.example.com\ninternal.local',
      packages: [{ id: 'p1', manager: ' npm ', package: ' typescript ' }],
      metadata: [{ id: 'm1', key: 'Owner', value: ' Team ' }],
      preservedMetadata: { environment_keys: '[]' },
    });

    expect(payload).toMatchObject({
      name: 'CI',
      config: {
        hosting_type: 'local',
        sandbox_provider: 'local',
        network: {
          allowed_hosts: ['example.com', 'api.example.com', 'internal.local'],
        },
        packages: [{ manager: 'npm', package: 'typescript' }],
      },
      metadata: { environment_keys: '[]', owner: 'Team' },
    });
  });

  it('splits comma and newline separated host lists', () => {
    expect(splitCsv('a.com, b.com\nc.com')).toEqual(['a.com', 'b.com', 'c.com']);
  });
});

function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_test',
    type: 'environment',
    name: 'Test',
    description: 'Test environment',
    hosting_type: 'cloud',
    sandbox_provider: null,
    network: {},
    packages: [],
    status: 'active',
    config: {},
    metadata: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-02T00:00:00.000Z',
    archived_at: null,
    ...overrides,
  };
}
