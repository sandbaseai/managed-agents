import {
  Box,
  Check,
  ChevronDown,
  Lock,
  MessageSquare,
  Monitor,
  MoreVertical,
  Pencil,
  Play,
  Plus,
  Server,
  Sparkles,
  Zap,
} from 'lucide-react';
import { type ReactNode, useEffect, useState } from 'react';
import { getPage, postJson, putJson } from '../../api';
import { EmptyState, FilterSelect, StatusPill, SummaryStrip, Toolbar } from '../Common';
import { formatDate, formatDateShort, formatUsage, shortId, truncateMiddle } from '../../lib/format';
import type { Agent, AgentTab, ConsoleData, McpToolset, Session } from '../../types';

export function Agents({ data, onNewAgent, onOpenAgent }: { data: ConsoleData; onNewAgent: () => void; onOpenAgent: (agent: Agent) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const agents = data.agents.filter((agent) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || (status === 'active' ? !agent.archived_at : status === 'archived' ? !!agent.archived_at : agent.status === status);
    const matchesQuery = agent.id.toLowerCase().includes(q) || agent.name.toLowerCase().includes(q) || agent.description.toLowerCase().includes(q) || agent.model.toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
  const activeAgents = data.agents.filter((agent) => !agent.archived_at).length;
  const archivedAgents = data.agents.filter((agent) => Boolean(agent.archived_at)).length;
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Agents</h1>
          <p>Define local agents with prompts, tools, skills, and versioned runtime behavior.</p>
        </div>
        <button className="primaryButton" type="button" onClick={onNewAgent}>
          <Plus size={18} />
          Create agent
        </button>
      </div>
      <SummaryStrip items={[
        { label: 'Agents', value: data.agents.length, icon: <Monitor size={18} /> },
        { label: 'Active', value: activeAgents, icon: <Check size={18} /> },
        { label: 'Archived', value: archivedAgents, icon: <Lock size={18} /> },
        { label: 'Sessions', value: data.sessions.length, icon: <MessageSquare size={18} /> },
      ]} />
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={(
          <>
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
                { value: 'all', label: 'All' },
                { value: 'archived', label: 'Archived' },
              ]}
            />
          </>
        )}
      />
      <div className="tablePanel agentsTablePanel">
        <table className="agentTable">
          <thead>
            <tr>
              <th>ID</th>
              <th>Name</th>
              <th>Model</th>
              <th>Status</th>
              <th>Created</th>
              <th>Last updated</th>
            </tr>
          </thead>
          <tbody>
            {agents.map((agent) => (
              <tr key={agent.id} className="clickableRow" onClick={() => onOpenAgent(agent)}>
                <td className="monoCell">{shortId(agent.id)}</td>
                <td>
                  <strong>{agent.name}</strong>
                  <span>{agent.description || agent.id}</span>
                </td>
                <td>{agent.model}</td>
                <td><StatusPill status={agent.status} /></td>
                <td>{formatDate(agent.created_at)}</td>
                <td>{formatDate(agent.updated_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {agents.length === 0 ? (
          <EmptyState
            icon={<Monitor size={22} />}
            title="No agents"
            body="Create an agent to define its system prompt, tools, skills, and runtime behavior."
            action={<button className="primaryButton" type="button" onClick={onNewAgent}><Plus size={16} />Create agent</button>}
          />
        ) : null}
      </div>
      <div className="mobileAgentList">
        {agents.map((agent) => (
          <button className="mobileAgentCard" type="button" key={agent.id} onClick={() => onOpenAgent(agent)}>
            <span className="mobileAgentMain">
              <strong>{agent.name}</strong>
              <small className="monoText">{agent.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{agent.model}</span>
              <StatusPill status={agent.status} />
            </span>
          </button>
        ))}
        {agents.length === 0 ? (
          <EmptyState
            icon={<Monitor size={22} />}
            title="No agents"
            body="Create an agent to define its system prompt, tools, skills, and runtime behavior."
            action={<button className="primaryButton" type="button" onClick={onNewAgent}><Plus size={16} />Create agent</button>}
          />
        ) : null}
      </div>
    </section>
  );
}

export function AgentDetail({
  agent,
  data,
  tab,
  onTab,
  onBack,
  onEdit,
  onNewSession,
  onOpenSession,
  onRefresh,
}: {
  agent: Agent;
  data: ConsoleData;
  tab: AgentTab;
  onTab: (tab: AgentTab) => void;
  onBack: () => void;
  onEdit: () => void;
  onNewSession: () => void;
  onOpenSession: (session: Session) => void;
  onRefresh: () => void;
}) {
  const [menuOpen, setMenuOpen] = useState(false);
  const agentSessions = data.sessions.filter((session) => session.agent.id === agent.id);
  const tokenIn = agentSessions.reduce((sum, session) => sum + session.usage.input_tokens, 0);
  const tokenOut = agentSessions.reduce((sum, session) => sum + session.usage.output_tokens, 0);

  const archive = async () => {
    await postJson(`/v1/agents/${agent.id}/archive`, {});
    setMenuOpen(false);
    onRefresh();
  };

  return (
    <section className="agentDetail">
      <div className="detailCrumb">
        <button type="button" className="textButton" onClick={onBack}>Agents</button>
        <span>/</span>
        <strong>{agent.name}</strong>
      </div>

      <div className="agentHero">
        <div>
          <div className="titleLine">
            <h1>{agent.name}</h1>
            <StatusPill status={agent.status} />
          </div>
          <p className="mutedLine"><span className="monoText">{agent.id}</span> · Last updated {formatDate(agent.updated_at)}</p>
          <p className="agentDescription">{agent.description || 'No description yet. Add one to make this agent easier to identify in sessions and operations.'}</p>
        </div>
        <div className="agentHeroActions">
          <button className="secondaryButton largeAction" type="button" onClick={onEdit}>
            <Pencil size={18} />
            Edit
          </button>
          <div className="menuWrap">
            <button className="iconButton" type="button" onClick={() => setMenuOpen((open) => !open)} title="Agent actions">
              <MoreVertical size={18} />
            </button>
            {menuOpen ? (
              <div className="agentMenu">
                <button type="button" onClick={onNewSession}><Play size={18} />Start session</button>
                <button type="button" onClick={onEdit}><Sparkles size={18} />Guided edit</button>
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Lock size={18} />Archive</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <SummaryStrip items={[
        { label: 'Version', value: `v${agent.version}`, icon: <Sparkles size={18} /> },
        { label: 'Sessions', value: agentSessions.length, icon: <MessageSquare size={18} /> },
        { label: 'Tools', value: toolNames(agent).length, icon: <Box size={18} /> },
        { label: 'Skills', value: agent.skills.length, icon: <Zap size={18} /> },
      ]} />

      <div className="detailTabs">
        {(['agent', 'sessions', 'deployments', 'observability'] as AgentTab[]).map((item) => (
          <button
            key={item}
            type="button"
            className={tab === item ? 'active' : ''}
            onClick={() => onTab(item)}
          >
            {item === 'agent' ? 'Agent' : item[0].toUpperCase() + item.slice(1)}
            {item === 'observability' ? <span className="newPill">New</span> : null}
          </button>
        ))}
      </div>

      {tab === 'agent' ? <AgentConfigTab agent={agent} onRefresh={onRefresh} /> : null}
      {tab === 'sessions' ? <AgentSessionsTab sessions={agentSessions} onOpenSession={onOpenSession} /> : null}
      {tab === 'deployments' ? (
        <EmptyState
          icon={<Server size={22} />}
          title="No deployments for this local runtime"
          body="Use Sessions for local runs today. Deployment history will appear here once remote or scheduled deployment adapters are enabled."
        />
      ) : null}
      {tab === 'observability' ? (
        <AgentObservability sessions={agentSessions} tokenIn={tokenIn} tokenOut={tokenOut} />
      ) : null}
    </section>
  );
}

function AgentConfigTab({ agent, onRefresh }: { agent: Agent; onRefresh: () => void }) {
  const builtinToolCount = toolNames(agent).length;
  const mcpToolsets = agent.tools.filter((toolset): toolset is McpToolset => toolset.type === 'mcp_toolset');
  const [versions, setVersions] = useState<Agent[]>([]);
  const [versionsOpen, setVersionsOpen] = useState(false);
  const [baseVersion, setBaseVersion] = useState<number | null>(null);
  const [compareVersion, setCompareVersion] = useState<number | null>(agent.version);
  const [versionMessage, setVersionMessage] = useState('');

  useEffect(() => {
    let mounted = true;
    getPage<Agent>(`/v1/agents/${agent.id}/versions`)
      .then((page) => {
        if (!mounted) return;
        setVersions(page.data);
        const latest = page.data[0]?.version ?? agent.version;
        const previous = page.data[1]?.version ?? null;
        setCompareVersion(latest);
        setBaseVersion(previous);
      })
      .catch((err: Error) => {
        if (!mounted) return;
        setVersionMessage(err.message);
      });
    return () => {
      mounted = false;
    };
  }, [agent.id, agent.version]);

  const selectedBase = versions.find((version) => version.version === baseVersion) ?? null;
  const selectedCompare = versions.find((version) => version.version === compareVersion) ?? versions[0] ?? agent;
  const diffRows = selectedBase && selectedCompare ? agentVersionDiff(selectedBase, selectedCompare) : [];

  const rollbackToVersion = async (version: Agent) => {
    if (!window.confirm(`Create a new version from v${version.version}?`)) return;
    setVersionMessage('');
    try {
      await putJson(`/v1/agents/${agent.id}`, {
        ...agentPayloadFromApi(version),
        expected_version: agent.version,
      });
      setVersionMessage(`Created a new version from v${version.version}.`);
      onRefresh();
    } catch (err) {
      setVersionMessage(err instanceof Error ? err.message : String(err));
    }
  };

  return (
    <div className="detailStack">
      <div className="versionRow">
        <button className="filterButton" type="button" onClick={() => setVersionsOpen((open) => !open)}>
          Version <strong>v{agent.version}</strong> <ChevronDown size={15} />
        </button>
      </div>
      {versionsOpen ? (
        <section className="versionPanel">
          <div className="sectionHeaderRow compactHeader">
            <div>
              <h2>Version history</h2>
              <p>Immutable snapshots created by agent create/update. Compare versions or create a new version from an older snapshot.</p>
            </div>
          </div>
          <div className="versionCompareControls">
            <label>
              <span>Base</span>
              <select value={baseVersion ?? ''} onChange={(event) => setBaseVersion(event.target.value ? Number(event.target.value) : null)}>
                <option value="">None</option>
                {versions.map((version) => <option value={version.version} key={version.version}>v{version.version}</option>)}
              </select>
            </label>
            <label>
              <span>Compare</span>
              <select value={compareVersion ?? ''} onChange={(event) => setCompareVersion(event.target.value ? Number(event.target.value) : null)}>
                {versions.map((version) => <option value={version.version} key={version.version}>v{version.version}</option>)}
              </select>
            </label>
          </div>
          <div className="versionHistoryList">
            {versions.map((version) => (
              <div className="versionHistoryRow" key={version.version}>
                <div>
                  <strong>v{version.version}</strong>
                  <span>{formatDateShort(version.updated_at ?? version.created_at)}</span>
                </div>
                <p>{version.description || truncateMiddle(version.system, 120)}</p>
                <button className="ghostButton compactButton" type="button" onClick={() => void rollbackToVersion(version)} disabled={version.version === agent.version}>
                  Copy to new version
                </button>
              </div>
            ))}
          </div>
          {diffRows.length ? (
            <div className="versionDiff">
              {diffRows.map((row) => (
                <div className={`versionDiffRow ${row.changed ? 'changed' : ''}`} key={row.field}>
                  <strong>{row.field}</strong>
                  <pre>{row.before}</pre>
                  <pre>{row.after}</pre>
                </div>
              ))}
            </div>
          ) : (
            <EmptyState
              icon={<MessageSquare size={22} />}
              title="Select two versions"
              body="Choose a base and compare version to inspect field-level changes before copying an older snapshot."
            />
          )}
          {versionMessage ? <div className="noticeBox">{versionMessage}</div> : null}
        </section>
      ) : null}
      <div className="systemPreview">
        <div className="systemPreviewHeader">
          <span>System prompt</span>
          <code>{agent.model}</code>
        </div>
        <pre>{agent.system}</pre>
      </div>

      <section className="detailSection">
        <h2>MCPs and tools</h2>
        <div className="toolsetCard">
          <div className="toolsetHeader">
            <div className="toolsetIcon"><Box size={22} /></div>
            <div>
              <strong>Built-in tools</strong>
              <span>agent_toolset_20260401</span>
            </div>
          </div>
          <div className="toolsetRow">
            <span><ChevronDown size={16} />Tool permissions <b>{builtinToolCount}</b></span>
            <span className="allowText"><Check size={16} />{permissionPolicyLabel(agent)}</span>
          </div>
        </div>
        {mcpToolsets.map((toolset) => (
          <div className="toolsetCard" key={toolset.mcp_server_name}>
            <div className="toolsetHeader">
              <div className="toolsetIcon"><Zap size={22} /></div>
              <div>
                <strong>{toolset.mcp_server_name}</strong>
                <span>mcp_toolset</span>
              </div>
            </div>
          </div>
        ))}
      </section>

      <section className="detailSection">
        <h2>Skills</h2>
        {agent.skills.length ? (
          <div className="chipRow">{agent.skills.map((skill) => <span className="softChip" key={skill.skill_id}>{skill.skill_id}</span>)}</div>
        ) : (
          <EmptyState
            icon={<Sparkles size={22} />}
            title="No skills attached"
            body="Attach Skills when this agent needs reusable instructions beyond its system prompt."
          />
        )}
      </section>
    </div>
  );
}

function AgentSessionsTab({ sessions, onOpenSession }: { sessions: Session[]; onOpenSession: (session: Session) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('all');
  const filtered = sessions.filter((session) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || session.status === status;
    const matchesQuery = session.id.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesQuery;
  });
  return (
    <div className="detailStack">
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by session ID"
        actions={(
          <>
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'all', label: 'All' },
                { value: 'idle', label: 'Idle' },
                { value: 'running', label: 'Running' },
                { value: 'failed', label: 'Failed' },
                { value: 'terminated', label: 'Terminated' },
              ]}
            />
          </>
        )}
      />
      <div className="tablePanel">
        <table>
          <thead><tr><th>ID</th><th>Name</th><th>Status</th><th>Version</th><th>Tokens in / out</th><th>Created</th></tr></thead>
          <tbody>
            {filtered.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td className="monoCell">{shortId(session.id)}</td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td>{sessionAgentVersionLabel(session)}</td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" body="Start a session from this agent to see its run history here." /> : null}
      </div>
    </div>
  );
}

function sessionAgentVersionLabel(session: Session): string {
  return 'version' in session.agent && typeof session.agent.version === 'number'
    ? `v${session.agent.version}`
    : 'pinned/default';
}

function AgentObservability({ sessions, tokenIn, tokenOut }: { sessions: Session[]; tokenIn: number; tokenOut: number }) {
  const failed = sessions.filter((session) => session.status === 'failed').length;
  const errorRate = sessions.length ? Math.round((failed / sessions.length) * 100) : 0;
  return (
    <div className="detailStack">
      <div className="metricGrid">
        <MetricCard title="Sessions" value={sessions.length} subtitle="in total" />
        <MetricCard title="Error rate" value={`${errorRate}%`} />
        <MetricCard title="Total input tokens" value={tokenIn} />
        <MetricCard title="Total output tokens" value={tokenOut} />
      </div>
      <div className="panel sessionActivity">
        <div className="panelHeader">
          <h2>Session activity</h2>
          <span className="readonlyFilterBadge">Version <strong>All</strong></span>
        </div>
      </div>
    </div>
  );
}

function MetricCard({ title, value, subtitle }: { title: string; value: ReactNode; subtitle?: string }) {
  return (
    <div className="metricCard">
      <span>{title}</span>
      <strong>{value}</strong>
      {subtitle ? <small>{subtitle}</small> : null}
    </div>
  );
}

function toolNames(agent: Pick<Agent, 'tools'>): string[] {
  return agent.tools.flatMap((toolset) => {
    if (toolset.type !== 'agent_toolset_20260401') return [];
    if (Array.isArray(toolset.configs)) {
      return (toolset.configs as Array<{ name?: string }>).map((item) => item.name).filter((name): name is string => Boolean(name));
    }
    if (toolset.configs && typeof toolset.configs === 'object') return Object.keys(toolset.configs);
    return ['read', 'write', 'bash'];
  });
}

function permissionPolicyLabel(agent: Pick<Agent, 'tools'>): string {
  const builtin = agent.tools.find((toolset) => toolset.type === 'agent_toolset_20260401');
  const policy = builtin?.default_config?.permission_policy?.type;
  if (policy === 'always_ask') return 'Ask before use';
  if (policy === 'never_allow') return 'Never allow';
  return 'Always allow';
}

function agentPayloadFromApi(agent: Agent) {
  return {
    name: agent.name,
    description: agent.description,
    model: agent.model,
    system: agent.system,
    mcp_servers: agent.mcp_servers,
    tools: agent.tools,
    skills: agent.skills,
    metadata: agent.metadata,
  };
}

function agentVersionDiff(base: Agent, compare: Agent) {
  const fields: Array<[string, string, string]> = [
    ['Name', base.name, compare.name],
    ['Description', base.description, compare.description],
    ['Model', base.model, compare.model],
    ['System', base.system, compare.system],
    ['Tools', JSON.stringify(base.tools, null, 2), JSON.stringify(compare.tools, null, 2)],
    ['MCP servers', JSON.stringify(base.mcp_servers, null, 2), JSON.stringify(compare.mcp_servers, null, 2)],
    ['Skills', JSON.stringify(base.skills, null, 2), JSON.stringify(compare.skills, null, 2)],
  ];
  return fields.map(([field, before, after]) => ({
    field,
    before: before || '-',
    after: after || '-',
    changed: before !== after,
  }));
}
