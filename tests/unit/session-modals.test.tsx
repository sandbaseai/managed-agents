import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { SessionModal } from '../../apps/console/src/components/modals/SessionModals';
import { Sessions } from '../../apps/console/src/components/pages/SessionPages';
import type { Agent, ConsoleData, Environment } from '../../apps/console/src/types';

const now = '2026-07-18T12:00:00.000Z';

const agent: Agent = {
  id: 'agent_echo',
  type: 'agent',
  name: 'Echo agent',
  description: 'Echoes input for local testing.',
  system: 'Echo.',
  model: 'local-echo',
  tools: [{ type: 'agent_toolset_20260401' }],
  skills: [],
  mcp_servers: [],
  metadata: {},
  status: 'active',
  version: 1,
  created_at: now,
  updated_at: now,
  archived_at: null,
};

const environment: Environment = {
  id: 'env_local',
  type: 'environment',
  name: 'Local',
  description: 'Local test environment.',
  hosting_type: 'local',
  sandbox_provider: 'local',
  network: {},
  packages: [],
  status: 'active',
  config: {},
  metadata: {},
  created_at: now,
  updated_at: now,
  archived_at: null,
};

const data = {
  agents: [agent],
  sessions: [],
  environments: [environment],
  vaults: [],
  memoryStores: [],
  files: [],
  apiKeys: [],
  skills: [],
  templates: [],
  runtime: null,
  workspace: null,
  settings: null,
} as ConsoleData;

describe('Session surfaces', () => {
  it('renders the sessions page without create-button icon errors', () => {
    const html = renderToStaticMarkup(
      <Sessions data={data} onNewSession={() => {}} onOpenSession={() => {}} />,
    );

    expect(html).toContain('Sessions');
    expect(html).toContain('Create session');
    expect(html).toContain('No sessions');
  });

  it('renders the create-session modal without resource-button icon errors', () => {
    const html = renderToStaticMarkup(
      <SessionModal
        data={data}
        onClose={() => {}}
        onSaved={() => {}}
        onNavigate={() => {}}
      />,
    );

    expect(html).toContain('Create session');
    expect(html).toContain('Select an agent');
    expect(html).toContain('Resource');
  });
});
