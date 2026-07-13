import { createCipheriv, createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, relative, resolve, sep } from 'node:path';
import { Hono } from 'hono';
import { nanoid } from 'nanoid';
import type { ServerDeps } from '../server.js';
import { pageOf } from '../standard.js';

type ResourceKind = 'environment' | 'credential_vault' | 'memory_store';
type FileCreateInput = {
  name: string;
  mediaType: string;
  bytes: Buffer;
  metadata: Record<string, string>;
};

const FILE_PREVIEW_MAX_BYTES = 24 * 1024;
const FILE_CONTENT_MAX_BYTES = 10 * 1024 * 1024;

export function resourceRoutes(deps: ServerDeps) {
  const app = new Hono();

  app.get('/environments', (c) => {
    const rows = deps.db.prepare('SELECT * FROM environments ORDER BY created_at DESC').all() as unknown as EnvironmentRow[];
    return c.json(pageOf(rows.map(toEnvironment)));
  });

  app.post('/environments', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const config = normalizeEnvironmentConfig(body.value);
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('env_')
      ? body.value.id
      : `env_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO environments (id, name, description, config, metadata, updated_at) VALUES (?, ?, ?, ?, ?, datetime(\'now\'))',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(config),
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as unknown as EnvironmentRow;
      return c.json(toEnvironment(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Environment already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/environments/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(c.req.param('id')) as EnvironmentRow | undefined;
    return row ? c.json(toEnvironment(row)) : notFound(c, 'Environment not found');
  });

  app.put('/environments/:id', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const id = c.req.param('id');
    const existing = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as EnvironmentRow | undefined;
    if (!existing) return notFound(c, 'Environment not found');

    const name = stringField(body.value.name) ?? existing.name;
    const config = normalizeEnvironmentConfig(body.value, parseObject(existing.config));
    deps.db.prepare(
      'UPDATE environments SET name = ?, description = ?, config = ?, metadata = ?, updated_at = datetime(\'now\') WHERE id = ?',
    ).run(
      name,
      stringField(body.value.description) ?? existing.description ?? '',
      JSON.stringify(config),
      JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : stringRecordField(body.value.metadata)),
      id,
    );
    const row = deps.db.prepare('SELECT * FROM environments WHERE id = ?').get(id) as unknown as EnvironmentRow;
    return c.json(toEnvironment(row));
  });

  app.post('/environments/:id/archive', (c) => archiveResource(c, deps, 'environments', toEnvironment));

  app.get('/files', (c) => {
    return c.json(pageOf(listFileResources(deps)));
  });

  app.post('/files', async (c) => {
    if (!deps.workspace?.dataDir) return invalid(c, 'workspace data directory is not configured');

    try {
      const input = await readCreateFileRequest(c);
      if (!input.ok) return input.response;
      const file = persistFileResource(deps, input.value);
      return c.json(file, 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, 'File id already exists');
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/files/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM files WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as FileRow | undefined;
    return row ? c.json(toFileResource(row, deps)) : notFound(c, 'File not found');
  });

  app.get('/files/:id/content', (c) => {
    const row = deps.db.prepare('SELECT * FROM files WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as FileRow | undefined;
    if (!row || !isManagedFileStoragePath(row.storage_path, deps) || !existsSync(row.storage_path)) return notFound(c, 'File not found');
    return new Response(readFileSync(row.storage_path), {
      headers: {
        'Content-Type': row.media_type || 'application/octet-stream',
        'Content-Disposition': `attachment; filename="${row.name.replace(/"/g, '')}"`,
      },
    });
  });

  app.delete('/files/:id', (c) => {
    const row = deps.db.prepare('SELECT * FROM files WHERE id = ? AND archived_at IS NULL').get(c.req.param('id')) as FileRow | undefined;
    if (!row) return notFound(c, 'File not found');
    deps.db.prepare('UPDATE files SET status = ?, archived_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ?').run('archived', row.id);
    const archived = deps.db.prepare('SELECT * FROM files WHERE id = ?').get(row.id) as unknown as FileRow;
    return c.json(toFileResource(archived, deps));
  });

  app.get('/credential-vaults', (c) => {
    const rows = deps.db.prepare(`${vaultSelect()} ORDER BY v.created_at DESC`).all() as unknown as VaultRow[];
    return c.json(pageOf(rows.map((row) => toVault(row, deps))));
  });

  app.post('/credential-vaults', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('vlt_')
      ? body.value.id
      : `vlt_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO credential_vaults (id, name, description, metadata) VALUES (?, ?, ?, ?)',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare(vaultSelect('WHERE v.id = ?')).get(id) as unknown as VaultRow;
      return c.json(toVault(row, deps), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Credential vault already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/credential-vaults/:id', (c) => {
    const row = deps.db.prepare(vaultSelect('WHERE v.id = ?')).get(c.req.param('id')) as VaultRow | undefined;
    return row ? c.json(toVault(row, deps)) : notFound(c, 'Credential vault not found');
  });

  app.get('/credential-vaults/:id/credentials', (c) => {
    const vault = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ?').get(c.req.param('id'));
    if (!vault) return notFound(c, 'Credential vault not found');
    return c.json(pageOf(listCredentials(deps, c.req.param('id'))));
  });

  app.post('/credential-vaults/:id/credentials', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const vaultId = c.req.param('id');
    const vault = deps.db.prepare('SELECT id FROM credential_vaults WHERE id = ?').get(vaultId);
    if (!vault) return notFound(c, 'Credential vault not found');

    const authType = stringField(body.value.auth_type);
    if (!isCredentialAuthType(authType)) return invalid(c, 'auth_type must be one of mcp_oauth, bearer_token, environment_variable');

    const mcpServerUrl = stringField(body.value.mcp_server_url);
    const variableName = stringField(body.value.variable_name);
    const secretValue = typeof body.value.value === 'string' ? body.value.value : '';
    if (authType === 'mcp_oauth' && !mcpServerUrl) return invalid(c, 'mcp_server_url is required');
    if (authType === 'bearer_token' && !secretValue) return invalid(c, 'value is required');
    if (authType === 'environment_variable' && (!variableName || !secretValue)) return invalid(c, 'variable_name and value are required');

    const injectionLocations = parseCredentialInjectionLocations(body.value.injection_locations);
    if (!injectionLocations.ok) return invalid(c, injectionLocations.message);
    const encryptedSecret = secretValue ? encryptSecret(secretValue, deps) : { ciphertext: '', nonce: '', tag: '' };
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('vcrd_')
      ? body.value.id
      : `vcrd_${nanoid(18)}`;
    const now = new Date().toISOString();
    deps.db.prepare(
      `INSERT INTO credential_records (
        id, vault_id, name, auth_type, mcp_server_url, variable_name, value_hint,
        network, injection_locations, metadata, secret_ciphertext, secret_nonce, secret_tag, created_at, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      vaultId,
      stringField(body.value.name) ?? '',
      authType,
      mcpServerUrl ?? null,
      variableName ?? null,
      secretHint(secretValue),
      JSON.stringify(normalizeCredentialNetwork(body.value.network)),
      JSON.stringify(injectionLocations.value),
      JSON.stringify(stringRecordField(body.value.metadata)),
      encryptedSecret.ciphertext,
      encryptedSecret.nonce,
      encryptedSecret.tag,
      now,
      now,
    );
    deps.db.prepare('UPDATE credential_vaults SET updated_at = datetime(\'now\') WHERE id = ?').run(vaultId);
    const row = deps.db.prepare('SELECT * FROM credential_records WHERE id = ?').get(id) as unknown as CredentialRow;
    return c.json(toCredential(row), 201);
  });

  app.post('/credential-vaults/:id/credentials/:credentialId/archive', (c) => updateCredentialState(c, deps, 'archived'));

  app.delete('/credential-vaults/:id/credentials/:credentialId', (c) => updateCredentialState(c, deps, 'deleted'));

  app.post('/credential-vaults/:id/archive', (c) => archiveResource(c, deps, 'credential_vaults', (row) => toVault(row, deps)));

  app.get('/memory_stores', (c) => {
    const rows = deps.db.prepare(`${memoryStoreSelect()} ORDER BY m.created_at DESC`).all() as unknown as MemoryStoreRow[];
    return c.json(pageOf(rows.map((row) => toMemoryStore(row, deps))));
  });

  app.post('/memory_stores', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const name = stringField(body.value.name);
    if (!name) return invalid(c, 'name is required');
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('memstore_')
      ? body.value.id
      : `memstore_${nanoid(18)}`;
    try {
      deps.db.prepare(
        'INSERT INTO memory_stores (id, name, description, provider, config, metadata) VALUES (?, ?, ?, ?, ?, ?)',
      ).run(
        id,
        name,
        stringField(body.value.description) ?? '',
        stringField(body.value.provider) ?? 'sqlite',
        JSON.stringify(objectField(body.value.config)),
        JSON.stringify(stringRecordField(body.value.metadata)),
      );
      const row = deps.db.prepare(memoryStoreSelect('WHERE m.id = ?')).get(id) as unknown as MemoryStoreRow;
      return c.json(toMemoryStore(row, deps), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory store already exists: ${name}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.get('/memory_stores/:id', (c) => {
    const row = deps.db.prepare(memoryStoreSelect('WHERE m.id = ?')).get(c.req.param('id')) as MemoryStoreRow | undefined;
    return row ? c.json(toMemoryStore(row, deps)) : notFound(c, 'Memory store not found');
  });

  app.get('/memory_stores/:id/memories', (c) => {
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ?').get(c.req.param('id'));
    if (!store) return notFound(c, 'Memory store not found');
    return c.json(pageOf(listMemories(deps, c.req.param('id'))));
  });

  app.post('/memory_stores/:id/memories', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const storeId = c.req.param('id');
    const store = deps.db.prepare('SELECT id FROM memory_stores WHERE id = ?').get(storeId);
    if (!store) return notFound(c, 'Memory store not found');
    const path = memoryPath(body.value.path);
    if (!path) return invalid(c, 'path is required and must start with /');
    const content = typeof body.value.content === 'string' ? body.value.content : '';
    const id = typeof body.value.id === 'string' && body.value.id.startsWith('mem_')
      ? body.value.id
      : `mem_${nanoid(18)}`;
    const now = new Date().toISOString();
    try {
      deps.db.prepare(
        `INSERT INTO memory_records (id, store_id, path, content, metadata, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).run(id, storeId, path, content, JSON.stringify(stringRecordField(body.value.metadata)), now, now);
      deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
      const row = deps.db.prepare('SELECT * FROM memory_records WHERE id = ?').get(id) as unknown as MemoryRecordRow;
      return c.json(toMemory(row), 201);
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory already exists at path: ${path}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.put('/memory_stores/:id/memories/:memoryId', async (c) => {
    const body = await readObjectBody(c);
    if (!body.ok) return body.response;
    const storeId = c.req.param('id');
    const memoryId = c.req.param('memoryId');
    const existing = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ?').get(memoryId, storeId) as MemoryRecordRow | undefined;
    if (!existing) return notFound(c, 'Memory not found');
    const path = body.value.path === undefined ? existing.path : memoryPath(body.value.path);
    if (!path) return invalid(c, 'path must start with /');
    const content = typeof body.value.content === 'string' ? body.value.content : existing.content;
    try {
      deps.db.prepare(
        'UPDATE memory_records SET path = ?, content = ?, metadata = ?, updated_at = datetime(\'now\') WHERE id = ? AND store_id = ?',
      ).run(
        path,
        content,
        JSON.stringify(body.value.metadata === undefined ? parseObject(existing.metadata) : stringRecordField(body.value.metadata)),
        memoryId,
        storeId,
      );
      deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
      const row = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ?').get(memoryId, storeId) as unknown as MemoryRecordRow;
      return c.json(toMemory(row));
    } catch (err: any) {
      if (String(err.message).includes('UNIQUE')) return conflict(c, `Memory already exists at path: ${path}`);
      return c.json({ error: { type: 'internal_error', message: err.message } }, 500);
    }
  });

  app.delete('/memory_stores/:id/memories/:memoryId', (c) => {
    const storeId = c.req.param('id');
    const memoryId = c.req.param('memoryId');
    const existing = deps.db.prepare('SELECT * FROM memory_records WHERE id = ? AND store_id = ?').get(memoryId, storeId) as MemoryRecordRow | undefined;
    if (!existing) return notFound(c, 'Memory not found');
    deps.db.prepare('UPDATE memory_records SET archived_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND store_id = ?').run(memoryId, storeId);
    deps.db.prepare('UPDATE memory_stores SET updated_at = datetime(\'now\') WHERE id = ?').run(storeId);
    return c.json({ deleted: true, id: memoryId });
  });

  app.post('/memory_stores/:id/archive', (c) => archiveResource(c, deps, 'memory_stores', (row) => toMemoryStore(row, deps)));

  return app;
}

function toEnvironment(row: EnvironmentRow) {
  const config = parseObject(row.config);
  return {
    id: row.id,
    type: 'environment' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    hosting_type: environmentHostingType(config),
    sandbox_provider: typeof config.sandbox_provider === 'string' ? config.sandbox_provider : null,
    network: objectField(config.network),
    packages: Array.isArray(config.packages) ? config.packages : [],
    status: row.archived_at ? 'archived' : 'active',
    config,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at ?? row.created_at,
    archived_at: row.archived_at ?? null,
  };
}

function normalizeEnvironmentConfig(
  body: Record<string, unknown>,
  existing: Record<string, unknown> = {},
): Record<string, unknown> {
  const config = {
    ...existing,
    ...objectField(body.config),
  };
  for (const key of ['hosting_type', 'sandbox_provider', 'network', 'packages'] as const) {
    if (body[key] !== undefined) config[key] = body[key];
  }
  return config;
}

function environmentHostingType(config: Record<string, unknown>): 'cloud' | 'self_hosted' {
  if (config.hosting_type === 'self_hosted') return 'self_hosted';
  if (config.hosting_type === 'cloud') return 'cloud';
  if (config.sandbox_provider === 'self_hosted' || config.sandbox_provider === 'local') return 'self_hosted';
  return 'cloud';
}

export function listFileResources(deps: ServerDeps) {
  const rows = deps.db.prepare(
    `SELECT *
     FROM files
     WHERE archived_at IS NULL
     ORDER BY created_at DESC`,
  ).all() as unknown as FileRow[];
  return rows.map((row) => toFileResource(row, deps));
}

function toFileResource(row: FileRow, deps: ServerDeps) {
  const preview = previewFileResource(row, deps);
  return {
    id: row.id,
    type: 'file',
    name: row.name,
    media_type: row.media_type,
    size_bytes: row.size_bytes,
    status: row.archived_at ? 'archived' : row.status,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
    preview: preview?.content ?? null,
    preview_truncated: preview?.truncated ?? false,
  };
}

async function readCreateFileRequest(c: any): Promise<{ ok: true; value: FileCreateInput } | { ok: false; response: Response }> {
  const contentType = c.req.header('content-type') ?? '';
  if (contentType.includes('multipart/form-data')) {
    return readMultipartFileRequest(c);
  }

  const body = await readObjectBody(c);
  if (!body.ok) return body;

  const name = fileName(body.value.name);
  if (!name) return { ok: false, response: invalid(c, 'name is required') };
  const content = typeof body.value.content === 'string' ? body.value.content : '';
  const encoding = stringField(body.value.encoding) ?? 'utf8';
  if (encoding !== 'utf8' && encoding !== 'base64') {
    return { ok: false, response: invalid(c, 'encoding must be utf8 or base64') };
  }

  const bytes = encoding === 'base64' ? Buffer.from(content, 'base64') : Buffer.from(content, 'utf8');
  if (bytes.length > FILE_CONTENT_MAX_BYTES) {
    return { ok: false, response: invalid(c, 'file content exceeds the 10 MB limit') };
  }

  return {
    ok: true,
    value: {
      name,
      mediaType: stringField(body.value.media_type) ?? mediaTypeForName(name),
      bytes,
      metadata: stringRecordField(body.value.metadata),
    },
  };
}

async function readMultipartFileRequest(c: any): Promise<{ ok: true; value: FileCreateInput } | { ok: false; response: Response }> {
  let body: Record<string, unknown>;
  try {
    body = await c.req.parseBody({ all: true }) as Record<string, unknown>;
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be valid multipart/form-data') };
  }

  const files: Array<{ name: string; mediaType?: string; bytes: Buffer }> = [];
  let requestedName: string | undefined;
  let requestedMediaType: string | undefined;
  let metadata: Record<string, string> = {};

  for (const [key, rawValue] of Object.entries(body)) {
    const values = Array.isArray(rawValue) ? rawValue : [rawValue];
    for (const value of values) {
      if (isFileField(key) && isUploadedFileLike(value)) {
        const bytes = Buffer.from(await value.arrayBuffer());
        files.push({ name: value.name, mediaType: value.type, bytes });
        continue;
      }
      if (key === 'name' && typeof value === 'string') requestedName = value;
      if (key === 'media_type' && typeof value === 'string') requestedMediaType = value;
      if (key === 'metadata' && typeof value === 'string') metadata = parseStringRecord(value);
    }
  }

  if (files.length === 0) return { ok: false, response: invalid(c, 'file is required') };
  if (files.length > 1) return { ok: false, response: invalid(c, 'Only one file can be uploaded per request') };

  const upload = files[0];
  const name = fileName(requestedName) ?? fileName(upload.name);
  if (!name) return { ok: false, response: invalid(c, 'name is required') };
  if (upload.bytes.length > FILE_CONTENT_MAX_BYTES) {
    return { ok: false, response: invalid(c, 'file content exceeds the 10 MB limit') };
  }

  return {
    ok: true,
    value: {
      name,
      mediaType: stringField(requestedMediaType) ?? stringField(upload.mediaType) ?? mediaTypeForName(name),
      bytes: upload.bytes,
      metadata,
    },
  };
}

function persistFileResource(deps: ServerDeps, input: FileCreateInput) {
  if (!deps.workspace?.dataDir) throw new Error('workspace data directory is not configured');
  const id = `file_${nanoid(18)}`;
  const storageDir = resolve(deps.workspace.dataDir, 'files');
  mkdirSync(storageDir, { recursive: true });
  const storagePath = managedFileStoragePath(storageDir, id);
  const now = new Date().toISOString();

  try {
    writeFileSync(storagePath, input.bytes, { mode: 0o600 });
    deps.db.prepare(
      `INSERT INTO files (id, name, media_type, size_bytes, storage_path, metadata, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      id,
      input.name,
      input.mediaType,
      input.bytes.length,
      storagePath,
      JSON.stringify(input.metadata),
      now,
      now,
    );
  } catch (err) {
    if (existsSync(storagePath)) rmSync(storagePath, { force: true });
    throw err;
  }

  const row = deps.db.prepare('SELECT * FROM files WHERE id = ?').get(id) as unknown as FileRow;
  return toFileResource(row, deps);
}

function isFileField(key: string): boolean {
  return key === 'file' || key === 'files' || key === 'files[]';
}

function isUploadedFileLike(value: unknown): value is { name: string; type?: string; arrayBuffer: () => Promise<ArrayBuffer> } {
  return typeof value === 'object'
    && value !== null
    && typeof (value as { name?: unknown }).name === 'string'
    && typeof (value as { arrayBuffer?: unknown }).arrayBuffer === 'function';
}

function parseStringRecord(value: string): Record<string, string> {
  try {
    return stringRecordField(JSON.parse(value));
  } catch {
    return {};
  }
}

function previewFileResource(row: FileRow, deps: ServerDeps): { content: string; truncated: boolean } | null {
  if (!isPreviewableMediaType(row.media_type) || !isManagedFileStoragePath(row.storage_path, deps) || !existsSync(row.storage_path)) return null;
  const bytes = readFileSync(row.storage_path).subarray(0, FILE_PREVIEW_MAX_BYTES);
  const raw = bytes.toString('utf8');
  if (raw.includes('\u0000')) return null;
  return {
    content: raw,
    truncated: row.size_bytes > FILE_PREVIEW_MAX_BYTES,
  };
}

function isManagedFileStoragePath(path: string, deps: ServerDeps): boolean {
  if (!deps.workspace?.dataDir) return false;
  const storageDir = resolve(deps.workspace.dataDir, 'files');
  const resolvedPath = resolve(path);
  const relativePath = relative(storageDir, resolvedPath);
  return Boolean(relativePath) && !relativePath.startsWith('..') && !isAbsolute(relativePath);
}

function managedFileStoragePath(storageDir: string, id: string): string {
  const targetPath = resolve(storageDir, id);
  if (targetPath !== storageDir && targetPath.startsWith(storageDir + sep)) {
    return targetPath;
  }
  throw new Error('File storage path escapes the managed files directory.');
}

function isPreviewableMediaType(mediaType: string): boolean {
  return mediaType.startsWith('text/')
    || mediaType === 'application/json'
    || mediaType === 'application/yaml'
    || mediaType === 'application/x-yaml';
}

function mediaTypeForName(name: string): string {
  if (/\.md$/i.test(name)) return 'text/markdown';
  if (/\.ya?ml$/i.test(name)) return 'application/yaml';
  if (/\.json$/i.test(name)) return 'application/json';
  if (/\.(txt|log|csv)$/i.test(name)) return 'text/plain';
  return 'application/octet-stream';
}

function fileName(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim().replace(/[\\/]/g, '_');
  if (!trimmed) return undefined;
  return trimmed.slice(0, 255);
}

function vaultSelect(where = '') {
  return `
    SELECT v.*,
      (
        SELECT COUNT(*)
        FROM credential_records cr
        WHERE cr.vault_id = v.id AND cr.archived_at IS NULL AND cr.status != 'deleted'
      ) AS credential_count
    FROM credential_vaults v
    ${where}
  `;
}

function toVault(row: VaultRow, deps?: ServerDeps) {
  return {
    id: row.id,
    type: 'credential_vault' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    status: row.archived_at ? 'archived' : row.status,
    credential_count: Number(row.credential_count ?? 0),
    credentials: deps ? listCredentials(deps, row.id) : [],
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function listCredentials(deps: ServerDeps, vaultId: string) {
  const rows = deps.db.prepare(
    `SELECT *
     FROM credential_records
     WHERE vault_id = ? AND archived_at IS NULL AND status != 'deleted'
     ORDER BY created_at DESC`,
  ).all(vaultId) as unknown as CredentialRow[];
  return rows.map(toCredential);
}

function toCredential(row: CredentialRow) {
  return {
    id: row.id,
    type: 'credential',
    vault_id: row.vault_id,
    name: row.name ?? '',
    auth_type: row.auth_type,
    mcp_server_url: row.mcp_server_url ?? '',
    variable_name: row.variable_name ?? '',
    value_hint: row.value_hint ?? '',
    network: parseObject(row.network),
    injection_locations: parseStringArray(row.injection_locations),
    status: row.status === 'deleted' ? 'deleted' : row.archived_at ? 'archived' : row.status,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    last_used_at: row.last_used_at ?? null,
    archived_at: row.archived_at ?? null,
  };
}

function memoryStoreSelect(where = '') {
  return `
    SELECT m.*,
      (
        SELECT COUNT(*)
        FROM memory_records mr
        WHERE mr.store_id = m.id AND mr.archived_at IS NULL
      ) AS memory_count
    FROM memory_stores m
    ${where}
  `;
}

function toMemoryStore(row: MemoryStoreRow, deps?: ServerDeps) {
  return {
    id: row.id,
    type: 'memory_store' as ResourceKind,
    name: row.name,
    description: row.description ?? '',
    provider: row.provider,
    status: row.archived_at ? 'archived' : row.status,
    memory_count: Number(row.memory_count ?? 0),
    memories: deps ? listMemories(deps, row.id) : [],
    config: parseObject(row.config),
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function listMemories(deps: ServerDeps, storeId: string) {
  const rows = deps.db.prepare(
    `SELECT *
     FROM memory_records
     WHERE store_id = ? AND archived_at IS NULL
     ORDER BY path ASC`,
  ).all(storeId) as unknown as MemoryRecordRow[];
  return rows.map(toMemory);
}

function toMemory(row: MemoryRecordRow) {
  return {
    id: row.id,
    type: 'memory',
    store_id: row.store_id,
    path: row.path,
    content: row.content,
    metadata: parseObject(row.metadata),
    created_at: row.created_at,
    updated_at: row.updated_at,
    archived_at: row.archived_at ?? null,
  };
}

function archiveResource(c: any, deps: ServerDeps, table: string, map: (row: any) => unknown) {
  const id = c.req.param('id');
  const existing = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  if (!existing) return notFound(c, 'Resource not found');
  deps.db.prepare(`UPDATE ${table} SET archived_at = datetime('now'), updated_at = datetime('now') WHERE id = ?`).run(id);
  const row = deps.db.prepare(`SELECT * FROM ${table} WHERE id = ?`).get(id);
  return c.json(map(row));
}

async function readObjectBody(c: any): Promise<{ ok: true; value: Record<string, unknown> } | { ok: false; response: Response }> {
  try {
    const value = await c.req.json();
    if (!value || typeof value !== 'object' || Array.isArray(value)) {
      return { ok: false, response: invalid(c, 'Request body must be an object') };
    }
    return { ok: true, value };
  } catch {
    return { ok: false, response: invalid(c, 'Request body must be valid JSON') };
  }
}

function stringField(value: unknown): string | undefined {
  return typeof value === 'string' && value.trim() ? value.trim() : undefined;
}

function objectField(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

function stringRecordField(value: unknown): Record<string, string> {
  return Object.fromEntries(
    Object.entries(objectField(value)).map(([key, recordValue]) => [key, String(recordValue)]),
  );
}

function parseObject(value: string | null | undefined): Record<string, unknown> {
  if (!value) return {};
  try {
    const parsed = JSON.parse(value);
    return objectField(parsed);
  } catch {
    return {};
  }
}

function parseStringArray(value: string | null | undefined): string[] {
  if (!value) return [];
  try {
    return arrayOfStrings(JSON.parse(value));
  } catch {
    return [];
  }
}

function arrayOfStrings(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0).map((item) => item.trim()) : [];
}

function parseCredentialInjectionLocations(value: unknown): { ok: true; value: string[] } | { ok: false; message: string } {
  const locations = arrayOfStrings(value);
  const allowed = new Set(['request_headers', 'request_body']);
  const invalidLocation = locations.find((location) => !allowed.has(location));
  if (invalidLocation) {
    return { ok: false, message: 'injection_locations must contain only request_headers or request_body' };
  }
  return { ok: true, value: Array.from(new Set(locations)) };
}

function isCredentialAuthType(value: unknown): value is 'mcp_oauth' | 'bearer_token' | 'environment_variable' {
  return value === 'mcp_oauth' || value === 'bearer_token' || value === 'environment_variable';
}

function normalizeCredentialNetwork(value: unknown) {
  const record = objectField(value);
  return {
    type: record.type === 'unrestricted' ? 'unrestricted' : 'limited',
    allowed_hosts: arrayOfStrings(record.allowed_hosts),
  };
}

function secretHint(value: string) {
  if (!value) return '';
  const visible = value.slice(-4);
  return visible ? `••••${visible}` : '••••';
}

function encryptSecret(value: string, deps: ServerDeps) {
  const nonce = randomBytes(12);
  const cipher = createCipheriv('aes-256-gcm', resolveSecretKey(deps), nonce);
  const ciphertext = Buffer.concat([cipher.update(value, 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return {
    ciphertext: ciphertext.toString('base64'),
    nonce: nonce.toString('base64'),
    tag: tag.toString('base64'),
  };
}

function resolveSecretKey(deps: ServerDeps): Buffer {
  const configuredKey = process.env.MANAGED_AGENTS_SECRET_KEY;
  if (configuredKey) return createHash('sha256').update(configuredKey).digest();

  if (deps.workspace?.dataDir) {
    const secretsPath = join(deps.workspace.dataDir, 'secrets.key');
    if (!existsSync(secretsPath)) {
      mkdirSync(deps.workspace.dataDir, { recursive: true });
      writeFileSync(secretsPath, `${randomBytes(32).toString('base64')}\n`, { mode: 0o600 });
    }
    return createHash('sha256').update(readFileSync(secretsPath, 'utf8').trim()).digest();
  }

  return createHash('sha256').update('managed-agents-test-secret-key').digest();
}

function memoryPath(value: unknown): string | undefined {
  if (typeof value !== 'string') return undefined;
  const trimmed = value.trim();
  if (!trimmed.startsWith('/')) return undefined;
  const normalized = trimmed.replace(/\/+/g, '/');
  if (normalized === '/' || normalized.endsWith('/')) return undefined;
  return normalized;
}

function updateCredentialState(c: any, deps: ServerDeps, status: 'archived' | 'deleted') {
  const vaultId = c.req.param('id');
  const credentialId = c.req.param('credentialId');
  const existing = deps.db.prepare('SELECT * FROM credential_records WHERE id = ? AND vault_id = ?').get(credentialId, vaultId) as CredentialRow | undefined;
  if (!existing) return notFound(c, 'Credential not found');
  deps.db.prepare(
    'UPDATE credential_records SET status = ?, archived_at = datetime(\'now\'), updated_at = datetime(\'now\') WHERE id = ? AND vault_id = ?',
  ).run(status, credentialId, vaultId);
  deps.db.prepare('UPDATE credential_vaults SET updated_at = datetime(\'now\') WHERE id = ?').run(vaultId);
  const row = deps.db.prepare('SELECT * FROM credential_records WHERE id = ? AND vault_id = ?').get(credentialId, vaultId) as unknown as CredentialRow;
  return c.json(toCredential(row));
}

function invalid(c: any, message: string): Response {
  return c.json({ error: { type: 'invalid_request', message } }, 400);
}

function conflict(c: any, message: string): Response {
  return c.json({ error: { type: 'conflict', message } }, 409);
}

function notFound(c: any, message: string): Response {
  return c.json({ error: { type: 'not_found', message } }, 404);
}

interface EnvironmentRow {
  id: string;
  name: string;
  description: string;
  config: string;
  metadata: string;
  created_at: string;
  updated_at: string | null;
  archived_at: string | null;
}

interface FileRow {
  id: string;
  name: string;
  media_type: string;
  size_bytes: number;
  storage_path: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}

interface VaultRow {
  id: string;
  name: string;
  description: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  credential_count?: number;
}

interface CredentialRow {
  id: string;
  vault_id: string;
  name: string;
  auth_type: 'mcp_oauth' | 'bearer_token' | 'environment_variable';
  mcp_server_url: string | null;
  variable_name: string | null;
  value_hint: string;
  network: string;
  injection_locations: string;
  secret_ciphertext: string;
  secret_nonce: string;
  secret_tag: string;
  status: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  last_used_at: string | null;
  archived_at: string | null;
}

interface MemoryStoreRow {
  id: string;
  name: string;
  description: string;
  provider: string;
  status: string;
  config: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
  memory_count?: number;
}

interface MemoryRecordRow {
  id: string;
  store_id: string;
  path: string;
  content: string;
  metadata: string;
  created_at: string;
  updated_at: string;
  archived_at: string | null;
}
