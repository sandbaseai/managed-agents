import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { API_REFERENCE_DOCS } from '../../apps/console/src/components/pages/settings/apiReferenceDocs';

const apiDocs = readFileSync(join(process.cwd(), 'docs/api.md'), 'utf8');

describe('API documentation', () => {
  it('mentions every endpoint path shown in the Console API reference', () => {
    const normalizedDocs = normalizePaths(apiDocs);

    for (const endpoint of API_REFERENCE_DOCS) {
      expect(normalizedDocs, endpoint.path).toContain(normalizePath(endpoint.path));
    }
  });

  it('documents Settings V2 as the provider configuration surface', () => {
    for (const path of [
      '/v1/x/model-providers',
      '/v1/x/model-providers/{name}/default',
      '/v1/x/memory-providers',
      '/v1/x/memory-providers/{name}/default',
      '/v1/x/storage-providers?role=metadata',
      '/v1/x/storage-providers/{name}/initialize',
      '/v1/x/storage-providers/{name}/default',
    ]) {
      expect(apiDocs).not.toContain(path);
    }

    expect(apiDocs).toContain('Settings V2 is the source of truth');
    expect(apiDocs).toContain('/v1/x/settings');
  });

  it('keeps the restart response example aligned with the runtime route', () => {
    expect(apiDocs).toContain('"restarting": true');
    expect(apiDocs).toContain('"status": "scheduled"');
    expect(apiDocs).not.toContain('"scheduled": true');
  });
});

function normalizePaths(value: string): string {
  return value.replace(/\{[^}]+\}/g, '{}').replace(/\?[^`|\s]*/g, '');
}

function normalizePath(value: string): string {
  return normalizePaths(value);
}
