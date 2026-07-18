import { Box, Check, ChevronDown, Lock, MessageSquare, Monitor, MoreVertical, Pencil, Play, Plus, Server, Sparkles, Zap } from 'lucide-react';
import { useState } from 'react';
import { postJson } from '../../api';
import { EmptyState, FilterSelect, MetricCard, StatusPill, Toolbar } from '../Common';
import { formatDate, formatDateShort, formatUsage, shortId } from '../../lib/format';
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
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Agents</h1>
          <p>Create and manage autonomous agents.</p>
        </div>
        <button className="darkButton" type="button" onClick={onNewAgent}>
          <Plus size={18} />
          Create agent
        </button>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by name or exact ID"
        actions={(
          <>
            <FilterSelect label="Created" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All time' }]} />
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
              <th className="selectCol"><input type="checkbox" aria-label="Select all agents" /></th>
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
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${agent.name}`} /></td>
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
        {agents.length === 0 ? <EmptyState icon={<Monitor size={22} />} title="No agents" /> : null}
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
        {agents.length === 0 ? <EmptyState icon={<Monitor size={22} />} title="No agents" /> : null}
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
          <p className="agentDescription">{agent.description || 'No description.'}</p>
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

      {tab === 'agent' ? <AgentConfigTab agent={agent} /> : null}
      {tab === 'sessions' ? <AgentSessionsTab sessions={agentSessions} onOpenSession={onOpenSession} /> : null}
      {tab === 'deployments' ? <EmptyState icon={<Server size={22} />} title="Deployments are not configured for this local runtime" /> : null}
      {tab === 'observability' ? (
        <AgentObservability sessions={agentSessions} tokenIn={tokenIn} tokenOut={tokenOut} />
      ) : null}
    </section>
  );
}

function AgentConfigTab({ agent }: { agent: Agent }) {
  const builtinToolCount = toolNames(agent).length;
  const mcpToolsets = agent.tools.filter((toolset): toolset is McpToolset => toolset.type === 'mcp_toolset');
  return (
    <div className="detailStack">
      <div className="versionRow">
        <button className="filterButton" type="button">Version <strong>v{agent.version}</strong> <ChevronDown size={15} /></button>
      </div>
      <div className="systemPreview">
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
            <span className="allowText"><Check size={16} />Always allow</span>
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
        ) : <p className="emptyInline">No skills attached.</p>}
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
            <FilterSelect label="Created" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All time' }]} />
            <FilterSelect label="Version" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All' }]} />
            <FilterSelect label="Deployment" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All' }]} />
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
          <thead><tr><th className="selectCol"><input type="checkbox" aria-label="Select sessions" /></th><th>ID</th><th>Name</th><th>Status</th><th>Version</th><th>Tokens in / out</th><th>Created</th></tr></thead>
          <tbody>
            {filtered.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${session.id}`} /></td>
                <td className="monoCell">{shortId(session.id)}</td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td>v1</td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {filtered.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
    </div>
  );
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
          <button className="filterButton" type="button">Version <strong>All</strong> <ChevronDown size={15} /></button>
        </div>
      </div>
    </div>
  );
}

function toolNames(agent: Pick<Agent, 'tools'>): string[] {
  const names = new Set<string>();
  for (const toolset of agent.tools ?? []) {
    for (const [name, config] of Object.entries(toolset.configs ?? {})) {
      if (config.enabled !== false && config.permission_policy?.type !== 'never_allow') names.add(name);
    }
  }
  return [...names];
}
