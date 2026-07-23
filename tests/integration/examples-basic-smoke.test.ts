import { afterAll, describe, expect, it } from 'vitest';
import { mkdirSync, mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { Database } from '@/core/db/database.js';
import { loadAgents } from '@/core/agent/loader.js';
import { importAgentSeeds, loadActiveAgentsFromDb } from '@/core/agent/store.js';
import { loadSkills } from '@/core/skills/loader.js';
import { importSkillSeeds, loadCustomSkillsFromDb } from '@/core/skills/store.js';
import { loadRuntimeConfig } from '@/core/runtime/bootstrap.js';
import { seedModelProviders } from '@/core/model/providers.js';
import { SessionManager } from '@/core/session/session-manager.js';
import { createServer } from '@/api/server.js';

describe('examples/basic smoke', () => {
  const tmpDir = mkdtempSync(join(tmpdir(), 'ma-example-basic-'));
  const dataDir = join(tmpDir, '.managed-agents');
  const exampleRoot = resolve('examples/basic');
  const db = new Database(join(tmpDir, 'data.db'));

  afterAll(() => {
    db.close();
    rmSync(tmpDir, { recursive: true, force: true });
  });

  it('loads the example workspace and exposes agents, skills, environments, and sessions through the API app', async () => {
    mkdirSync(dataDir, { recursive: true });
    db.runMigrations();
    db.exec(`INSERT INTO environments (id, name, config) VALUES ('env_default', 'local', '{"sandbox_provider":"local","timeout":300}')`);

    const config = loadRuntimeConfig(join(exampleRoot, 'managed-agents.config.yaml'), 'local', db);
    seedModelProviders(db, config.models);

    const agentLoad = loadAgents(join(exampleRoot, 'agents'));
    expect(agentLoad.errors).toEqual([]);
    expect(importAgentSeeds(db, agentLoad.agents)).toEqual([]);

    const skillLoad = loadSkills(join(exampleRoot, 'skills'));
    expect(skillLoad.errors).toEqual([]);
    importSkillSeeds(db, skillLoad.skills);

    const agents = loadActiveAgentsFromDb(db);
    const skills = loadCustomSkillsFromDb(db);
    const sessionManager = new SessionManager(db);
    const app = createServer({
      db,
      sessionManager,
      agents,
      skills,
      workspace: {
        root: exampleRoot,
        dataDir,
        agentsDir: join(exampleRoot, 'agents'),
        skillsDir: join(exampleRoot, 'skills'),
        configPath: join(exampleRoot, 'managed-agents.config.yaml'),
        target: 'local',
      },
      runtime: {
        models: [],
        sandboxProviders: ['local'],
        memory: config.memory ? 'sqlite' : 'disabled',
        authEnabled: false,
      },
      reloadAgents: () => ({ agents, errors: [] }),
    });

    const workspace = await getJson(app, '/v1/x/workspace');
    expect(workspace.name).toBe('basic');

    const agentPage = await getJson(app, '/v1/agents');
    expect(agentPage.data.map((agent: any) => agent.name)).toContain('echo-assistant');

    const skillPage = await getJson(app, '/v1/skills');
    expect(skillPage.data.map((skill: any) => skill.name)).toContain('code-review');

    const envPage = await getJson(app, '/v1/environments');
    expect(envPage.data.some((environment: any) => environment.name === 'local')).toBe(true);

    const sessionRes = await app.request('/v1/sessions', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ agent: 'agent_echo-assistant', environment_id: 'env_default', title: 'example smoke' }),
    });
    expect(sessionRes.status).toBe(201);
    const session = await sessionRes.json() as any;
    expect(session.id).toMatch(/^sess_/);
  });
});

async function getJson(app: ReturnType<typeof createServer>, path: string) {
  const res = await app.request(path);
  expect(res.status, path).toBe(200);
  return res.json() as Promise<any>;
}
