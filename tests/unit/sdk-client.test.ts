import { describe, expect, it, vi } from 'vitest';
import { ManagedAgentsClient } from '@/sdk/client.js';

describe('ManagedAgentsClient runtime management resources', () => {
  it('sends tool confirmation and custom tool result events', async () => {
    const fetchImpl = vi.fn(async () => jsonResponse({ accepted: true })) as unknown as typeof fetch;
    const client = new ManagedAgentsClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await client.sessions.approveTool('sess_1', 'tool_1');
    await client.sessions.denyTool('sess_1', 'tool_2', 'No thanks');
    await client.sessions.customToolResult('sess_1', 'custom_1', 'external result');

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://localhost:3000/v1/sessions/sess_1/events', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'user.tool_confirmation', tool_use_id: 'tool_1', result: 'allow' }] }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://localhost:3000/v1/sessions/sess_1/events', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'user.tool_confirmation', tool_use_id: 'tool_2', result: 'deny', deny_message: 'No thanks' }] }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'http://localhost:3000/v1/sessions/sess_1/events', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ events: [{ type: 'user.custom_tool_result', custom_tool_use_id: 'custom_1', content: [{ type: 'text', text: 'external result' }] }] }),
    }));
  });

  it('calls canonical runtime settings endpoints', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/x/settings') && init?.method === 'GET') {
        return jsonResponse(settings());
      }
      if (url.endsWith('/v1/x/settings') && init?.method === 'PATCH') {
        return jsonResponse(settings({ vendor: 'anthropic' }));
      }
      if (url.endsWith('/v1/x/settings/validate') && init?.method === 'POST') {
        return jsonResponse({ status: 'ok', checks: [] });
      }
      throw new Error(`Unexpected request: ${url} ${init?.method}`);
    }) as unknown as typeof fetch;
    const client = new ManagedAgentsClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await client.settings.get();
    await client.settings.patch({
      model_provider: {
        vendor: 'anthropic',
        base_url: 'https://api.anthropic.com',
        api_key_env: 'ANTHROPIC_API_KEY',
      },
    });
    await client.settings.validate();

    expect(fetchImpl).toHaveBeenNthCalledWith(1, 'http://localhost:3000/v1/x/settings', expect.objectContaining({ method: 'GET' }));
    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://localhost:3000/v1/x/settings', expect.objectContaining({
      method: 'PATCH',
      body: JSON.stringify({
        model_provider: {
          vendor: 'anthropic',
          base_url: 'https://api.anthropic.com',
          api_key_env: 'ANTHROPIC_API_KEY',
        },
      }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(3, 'http://localhost:3000/v1/x/settings/validate', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({}),
    }));
  });

  it('calls environment endpoints', async () => {
    const fetchImpl = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url.endsWith('/v1/environments') && init?.method === 'GET') return jsonResponse(page([]));
      if (url.endsWith('/v1/environments') && init?.method === 'POST') return jsonResponse(environment('env_docker'));
      if (url.endsWith('/v1/environments/env_docker') && init?.method === 'GET') return jsonResponse(environment('env_docker'));
      if (url.endsWith('/v1/environments/env_docker') && init?.method === 'PUT') return jsonResponse(environment('env_docker'));
      if (url.endsWith('/v1/environments/env_docker/archive') && init?.method === 'POST') return jsonResponse({ ...environment('env_docker'), status: 'archived' });
      if (url.endsWith('/v1/environments/env_docker/worker-keys') && init?.method === 'GET') return jsonResponse(page([]));
      throw new Error(`Unexpected request: ${url} ${init?.method}`);
    }) as unknown as typeof fetch;
    const client = new ManagedAgentsClient({ baseUrl: 'http://localhost:3000', fetch: fetchImpl });

    await client.environments.list();
    await client.environments.create({ name: 'docker', hosting_type: 'local', sandbox_provider: 'docker', config: { timeout: 600 } });
    await client.environments.get('env_docker');
    await client.environments.update('env_docker', { description: 'Updated' });
    await client.environments.workerKeys('env_docker');
    await client.environments.archive('env_docker');

    expect(fetchImpl).toHaveBeenNthCalledWith(2, 'http://localhost:3000/v1/environments', expect.objectContaining({
      method: 'POST',
      body: JSON.stringify({ name: 'docker', hosting_type: 'local', sandbox_provider: 'docker', config: { timeout: 600 } }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(4, 'http://localhost:3000/v1/environments/env_docker', expect.objectContaining({
      method: 'PUT',
      body: JSON.stringify({ description: 'Updated' }),
    }));
    expect(fetchImpl).toHaveBeenNthCalledWith(6, 'http://localhost:3000/v1/environments/env_docker/archive', expect.objectContaining({ method: 'POST' }));
  });
});

function jsonResponse(value: unknown): Response {
  return new Response(JSON.stringify(value), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

function page(data: unknown[]) {
  return { data, has_more: false, first_id: null, last_id: null };
}

function settings(overrides: { vendor?: string } = {}) {
  return {
    type: 'settings',
    model_provider: {
      vendor: overrides.vendor ?? 'openai-compatible',
      base_url: 'https://api.example.com/v1',
      api_key_env: 'MODEL_API_KEY',
      api_key_state: 'configured',
      configured: true,
    },
    loop_engine: {
      type: 'managed-agents',
      implemented: true,
      config: {},
    },
    storage: {
      metadata: {
        type: 'sqlite',
        path: '/tmp/managed-agents/data.db',
        state: 'configured',
        implemented: true,
      },
      artifacts: {
        type: 'local_filesystem',
        path: '/tmp/managed-agents/files',
        state: 'configured',
        implemented: true,
      },
    },
    memory: {
      backend: {
        type: 'sqlite',
        api_key_state: 'not_set',
        implemented: true,
      },
    },
    sandbox: {
      type: 'local',
      implemented: true,
      available: true,
      providers: ['local'],
      config: {},
    },
    validation: {
      status: 'ok',
      checks: [],
    },
  };
}

function environment(id: string) {
  return {
    id,
    type: 'environment',
    name: 'docker',
    description: '',
    hosting_type: 'local',
    sandbox_provider: 'docker',
    network: {},
    packages: [],
    status: 'active',
    config: { timeout: 600 },
    metadata: {},
    worker_keys: [],
    work_queue: {},
    created_at: '2026-01-01T00:00:00.000Z',
    updated_at: '2026-01-01T00:00:00.000Z',
    archived_at: null,
  };
}
