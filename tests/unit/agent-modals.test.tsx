import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { AgentModal } from '../../apps/console/src/components/modals/AgentModals';
import type { ConsoleData, Template } from '../../apps/console/src/types';

const template: Template = {
  id: 'blank',
  name: 'Blank agent',
  description: 'Start from a minimal agent definition.',
  tags: ['starter'],
  agent: {
    name: 'Starter agent',
    description: 'A test agent template.',
    model: 'local-echo',
    system: 'You are a test agent.',
    mcp_servers: [],
    tools: [{ type: 'agent_toolset_20260401' }],
    skills: [],
    metadata: {},
  },
};

describe('Agent modals', () => {
  it('renders the create-agent composer without runtime icon errors', () => {
    const data = {
      templates: [template],
      runtime: { models: [{ name: 'local-echo' }] },
    } as ConsoleData;

    const html = renderToStaticMarkup(
      <AgentModal
        template={template}
        data={data}
        onClose={() => {}}
        onSaved={() => {}}
      />,
    );

    expect(html).toContain('Create agent');
    expect(html).toContain('Agent config');
    expect(html).toContain('Starter agent');
  });
});
