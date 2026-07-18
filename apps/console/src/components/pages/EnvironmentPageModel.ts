import { titleCase } from '../../lib/format';
import type { Environment, EnvironmentDraft, EnvironmentHostingType, EnvironmentNetworkType, EnvironmentPackageDraft } from '../../types';

export function environmentKind(environment: Environment) {
  return hostingLabel(environmentHostingType(environment));
}

export function hostingLabel(type: EnvironmentHostingType) {
  if (type === 'self_hosted') return 'Self-hosted';
  if (type === 'docker') return 'Docker';
  if (type === 'local') return 'Local';
  return 'Cloud';
}

export function environmentHostingType(environment: Environment): EnvironmentHostingType {
  const hostingType = environment.hosting_type ?? environment.config.hosting_type;
  const provider = environment.config.sandbox_provider;
  if (hostingType === 'self_hosted' || provider === 'self_hosted') return 'self_hosted';
  if (hostingType === 'docker' || provider === 'docker') return 'docker';
  if (hostingType === 'local' || provider === 'local') return 'local';
  return 'cloud';
}

export function environmentNetwork(environment: Environment) {
  const network = objectValue(environment.config.network);
  const allowedHosts = arrayOfStrings(network.allowed_hosts);
  return {
    type: (network.type === 'unrestricted' ? 'unrestricted' : 'limited') as EnvironmentNetworkType,
    label: titleCase(String(network.type ?? 'limited').replace('_', ' ')),
    allowMcp: Boolean(network.allow_mcp_server_network_access),
    allowPackageManager: Boolean(network.allow_package_manager_network_access),
    allowedHosts,
  };
}

export function environmentPackages(environment: Environment): EnvironmentPackageDraft[] {
  const packages = Array.isArray(environment.config.packages) ? environment.config.packages : [];
  return packages.flatMap((item, index) => {
    if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
    const record = item as Record<string, unknown>;
    const manager = typeof record.manager === 'string' ? record.manager : '';
    const packageName = typeof record.package === 'string' ? record.package : '';
    if (!manager && !packageName) return [];
    return [{ id: `pkg_${index}`, manager, package: packageName }];
  });
}

export function environmentMetadataEntries(environment: Environment): string[][] {
  return Object.entries(environment.metadata ?? {}).map(([key, value]) => [key, String(value)]);
}

export function environmentKeys(environment: Environment): Array<{ id: string; name: string; created_at: string; expires_at: string }> {
  const raw = environment.metadata.environment_keys;
  if (typeof raw !== 'string') return [];
  try {
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.flatMap((item) => {
      if (!item || typeof item !== 'object' || Array.isArray(item)) return [];
      const record = item as Record<string, unknown>;
      if (typeof record.id !== 'string' || typeof record.name !== 'string') return [];
      return [{
        id: record.id,
        name: record.name,
        created_at: typeof record.created_at === 'string' ? record.created_at : environment.created_at,
        expires_at: typeof record.expires_at === 'string' ? record.expires_at : environment.updated_at,
      }];
    });
  } catch {
    return [];
  }
}

export function environmentDraftFromApi(environment: Environment): EnvironmentDraft {
  const network = environmentNetwork(environment);
  const resources = objectValue(environment.config.resources);
  return {
    name: environment.name,
    description: environment.description,
    hostingType: environmentHostingType(environment),
    dockerImage: stringValue(environment.config.image) ?? 'node:22-slim',
    dockerMemory: stringValue(resources.memory) ?? '',
    dockerCpu: numberOrStringValue(resources.cpu) ?? '',
    networkType: network.type,
    allowMcpServerNetworkAccess: network.allowMcp,
    allowPackageManagerNetworkAccess: network.allowPackageManager,
    allowedHosts: network.allowedHosts.join(', '),
    packages: environmentPackages(environment).map((item) => ({ ...item, id: newDraftId() })),
    metadata: environmentMetadataEntries(environment)
      .filter(([key]) => key !== 'environment_keys')
      .map(([key, value]) => ({ id: newDraftId(), key, value })),
    preservedMetadata: Object.fromEntries(
      Object.entries(environment.metadata ?? {}).filter(([key]) => key === 'environment_keys'),
    ),
  };
}

export function environmentPayloadFromDraft(draft: EnvironmentDraft) {
  const editableMetadata = Object.fromEntries(
    draft.metadata
      .map((item) => [item.key.trim().toLowerCase(), item.value.trim()])
      .filter(([key]) => key),
  );
  const metadata = { ...draft.preservedMetadata, ...editableMetadata };
  const config: Record<string, unknown> = {
    hosting_type: draft.hostingType,
    sandbox_provider: sandboxProviderForHostingType(draft.hostingType),
    network: {
      type: draft.networkType,
      allow_mcp_server_network_access: draft.allowMcpServerNetworkAccess,
      allow_package_manager_network_access: draft.allowPackageManagerNetworkAccess,
      allowed_hosts: splitCsv(draft.allowedHosts),
    },
    packages: draft.packages
      .map((item) => ({ manager: item.manager.trim(), package: item.package.trim() }))
      .filter((item) => item.manager || item.package),
  };
  if (draft.hostingType === 'docker') {
    const image = draft.dockerImage.trim() || 'node:22-slim';
    const memory = draft.dockerMemory.trim();
    const cpu = Number(draft.dockerCpu);
    config.image = image;
    config.resources = {
      ...(memory ? { memory } : {}),
      ...(Number.isFinite(cpu) && cpu > 0 ? { cpu } : {}),
    };
  }

  return {
    name: draft.name.trim(),
    description: draft.description,
    config,
    metadata,
  };
}

export function sandboxProviderForHostingType(hostingType: EnvironmentHostingType) {
  if (hostingType === 'self_hosted') return 'self_hosted';
  if (hostingType === 'docker') return 'docker';
  if (hostingType === 'local') return 'local';
  return 'cloud';
}

export function splitCsv(value: string): string[] {
  return value.split(/[,\n]/).map((item) => item.trim()).filter(Boolean);
}

function objectValue(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.length > 0) : [];
}

function stringValue(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value : undefined;
}

function numberOrStringValue(value: unknown): string | undefined {
  if (typeof value === 'number' && Number.isFinite(value)) return String(value);
  return stringValue(value);
}

function newDraftId() {
  return `draft_${Math.random().toString(36).slice(2, 10)}`;
}
