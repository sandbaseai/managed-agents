import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const apiDocs = readFileSync(join(process.cwd(), 'docs/api.md'), 'utf8');

describe('API documentation', () => {
  it('documents Settings V2 legacy provider compatibility endpoints', () => {
    for (const path of [
      '/v1/x/model-providers',
      '/v1/x/model-providers/{name}/default',
      '/v1/x/memory-providers',
      '/v1/x/memory-providers/{name}/default',
      '/v1/x/storage-providers?role=metadata',
      '/v1/x/storage-providers/{name}/initialize',
      '/v1/x/storage-providers/{name}/default',
    ]) {
      expect(apiDocs).toContain(path);
    }

    expect(apiDocs).toContain('410 Gone');
    expect(apiDocs).toContain('legacy_provider_mutation_unsupported');
    expect(apiDocs).toContain('New clients should read and write');
    expect(apiDocs).toContain('runtime configuration through `/v1/x/settings`.');
  });

  it('keeps the restart response example aligned with the runtime route', () => {
    expect(apiDocs).toContain('"restarting": true');
    expect(apiDocs).toContain('"status": "scheduled"');
    expect(apiDocs).not.toContain('"scheduled": true');
  });
});
