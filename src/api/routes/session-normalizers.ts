import type { ServerDeps } from '../server.js';
import type { ContentBlock } from '@/types/cma-protocol.js';
import { encryptSecret } from '@/core/security/secrets.js';

export type ValidationResult<T> = { ok: true; value: T } | { ok: false; message: string };

export function normalizeMessageContent(content: unknown): ContentBlock[] | null {
  if (typeof content === 'string') {
    return [{ type: 'text', text: content }];
  }
  if (Array.isArray(content) && content.every((block) => block && typeof block === 'object')) {
    return content as ContentBlock[];
  }
  return null;
}

export function normalizeAgentRef(value: unknown): string | null {
  if (typeof value === 'string' && value.length > 0) return value;
  if (!value || typeof value !== 'object' || Array.isArray(value)) return null;
  const record = value as Record<string, unknown>;
  if (record.type !== undefined && record.type !== 'agent') return null;
  return typeof record.id === 'string' && record.id.length > 0 ? record.id : null;
}

export function normalizeEnvironmentId(deps: ServerDeps, value: unknown): ValidationResult<string> {
  const id = typeof value === 'string' && value.trim() ? value.trim() : 'env_default';
  const row = deps.db.prepare('SELECT id FROM environments WHERE id = ? AND archived_at IS NULL').get(id);
  if (!row) return { ok: false, message: `Environment not found: ${id}` };
  return { ok: true, value: id };
}

export function normalizeVaultIds(deps: ServerDeps, value: unknown): ValidationResult<string[]> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'vault_ids must be an array' };
  const ids: string[] = [];
  for (const [index, item] of value.entries()) {
    const id = readString(item);
    if (!id) return { ok: false, message: `vault_ids[${index}] must be a credential vault id` };
    if (!ids.includes(id)) ids.push(id);
  }
  for (const id of ids) {
    const row = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ? AND archived_at IS NULL').get(id);
    if (!row) return { ok: false, message: `Credential vault not found: ${id}` };
  }
  return { ok: true, value: ids };
}

export function normalizeResources(deps: ServerDeps, value: unknown): ValidationResult<Array<Record<string, unknown>>> {
  if (value === undefined) return { ok: true, value: [] };
  if (!Array.isArray(value)) return { ok: false, message: 'resources must be an array' };

  const resources: Array<Record<string, unknown>> = [];
  for (const [index, resource] of value.entries()) {
    if (!resource || typeof resource !== 'object' || Array.isArray(resource)) {
      return { ok: false, message: `resources[${index}] must be an object` };
    }
    const normalized = normalizeSessionResource(deps, resource as Record<string, unknown>, index);
    if (!normalized.ok) return normalized;
    resources.push(normalized.value);
  }
  return { ok: true, value: resources };
}

export function memoryScopeFromResources(resources: Array<Record<string, unknown>>): string | undefined {
  const memoryStore = resources.find((resource) => resource.type === 'memory_store');
  return typeof memoryStore?.memory_store_id === 'string' ? memoryStore.memory_store_id : undefined;
}

function normalizeSessionResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  switch (resource.type) {
    case 'file':
      return normalizeFileResource(deps, resource, index);
    case 'github_repository':
      return normalizeGithubRepositoryResource(deps, resource, index);
    case 'memory_store':
      return normalizeMemoryStoreResource(deps, resource, index);
    default:
      return { ok: false, message: `resources[${index}].type must be file, github_repository, or memory_store` };
  }
}

function normalizeFileResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const fileId = readString(resource.file_id);
  const mountPath = readString(resource.mount_path);
  if (!fileId?.startsWith('file_')) return { ok: false, message: `resources[${index}].file_id is required` };
  if (!mountPath?.startsWith('/uploads/')) return { ok: false, message: `resources[${index}].mount_path must start with /uploads/` };
  const row = deps.db.prepare('SELECT id FROM files WHERE id = ? AND archived_at IS NULL').get(fileId);
  if (!row) return { ok: false, message: `File not found: ${fileId}` };
  return { ok: true, value: { type: 'file', file_id: fileId, mount_path: mountPath } };
}

function normalizeGithubRepositoryResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const url = readString(resource.url);
  const authorizationToken = readString(resource.authorization_token);
  const mountPath = readString(resource.mount_path);
  if (!url) return { ok: false, message: `resources[${index}].url is required` };
  if (!authorizationToken) return { ok: false, message: `resources[${index}].authorization_token is required` };
  if (mountPath && !mountPath.startsWith('/')) return { ok: false, message: `resources[${index}].mount_path must start with /` };
  const normalized: Record<string, unknown> = {
    type: 'github_repository',
    url,
    authorization_token: {
      type: 'encrypted_secret',
      ...encryptSecret(authorizationToken, deps.workspace?.dataDir),
    },
  };
  if (resource.checkout !== undefined) {
    if (
      typeof resource.checkout !== 'string'
      && (!resource.checkout || typeof resource.checkout !== 'object' || Array.isArray(resource.checkout))
    ) {
      return { ok: false, message: `resources[${index}].checkout must be a string or object` };
    }
    normalized.checkout = resource.checkout;
  }
  if (mountPath) normalized.mount_path = mountPath;
  return { ok: true, value: normalized };
}

function normalizeMemoryStoreResource(deps: ServerDeps, resource: Record<string, unknown>, index: number): ValidationResult<Record<string, unknown>> {
  const memoryStoreId = readString(resource.memory_store_id);
  if (!memoryStoreId?.startsWith('memstore_')) return { ok: false, message: `resources[${index}].memory_store_id is required` };
  const row = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ? AND archived_at IS NULL').get(memoryStoreId);
  if (!row) return { ok: false, message: `Memory store not found: ${memoryStoreId}` };

  const access = readString(resource.access);
  if (access && access !== 'read_write' && access !== 'read_only') {
    return { ok: false, message: `resources[${index}].access must be read_write or read_only` };
  }
  const mountPath = readString(resource.mount_path);
  if (mountPath && !mountPath.startsWith('/')) return { ok: false, message: `resources[${index}].mount_path must start with /` };
  const instructions = readString(resource.instructions);
  return {
    ok: true,
    value: {
      type: 'memory_store',
      memory_store_id: memoryStoreId,
      ...(access ? { access } : {}),
      ...(mountPath ? { mount_path: mountPath } : {}),
      ...(instructions ? { instructions } : {}),
    },
  };
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}
