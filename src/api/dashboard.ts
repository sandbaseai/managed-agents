/**
 * Web Dashboard (Requirement 10)
 *
 * A dependency-free single-page console served at /ui. The layout borrows the
 * quiet, document-like feel of Claude surfaces while keeping the control-plane
 * affordances expected from Claude Managed Agents / OMA: agents, sessions,
 * trajectory, live stream, and an inspector.
 */

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>managed-agents</title>
<style>
  :root {
    color-scheme: light;
    --bg: #f7f4ee;
    --surface: #fffdf8;
    --surface-2: #f0ede6;
    --ink: #26231f;
    --muted: #746f66;
    --faint: #9b9489;
    --line: #ded8cc;
    --line-strong: #cfc6b7;
    --accent: #7a4f2b;
    --accent-2: #b66032;
    --good: #2f7d55;
    --warn: #a76516;
    --bad: #a13a33;
    --shadow: 0 18px 60px rgba(40, 32, 22, .08);
    --mono: ui-monospace, SFMono-Regular, Menlo, Monaco, Consolas, monospace;
    --sans: Inter, ui-sans-serif, -apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif;
    --serif: ui-serif, Georgia, Cambria, "Times New Roman", serif;
  }
  * { box-sizing: border-box; }
  html, body { height: 100%; }
  body {
    margin: 0;
    overflow: hidden;
    background: linear-gradient(180deg, #fbf8f2 0%, var(--bg) 44%, #f3efe7 100%);
    color: var(--ink);
    font: 14px/1.5 var(--sans);
    letter-spacing: 0;
  }
  button, input, select, textarea { font: inherit; letter-spacing: 0; }
  button {
    border: 1px solid var(--line);
    background: var(--surface);
    color: var(--ink);
    min-height: 34px;
    padding: 0 12px;
    border-radius: 7px;
    cursor: pointer;
  }
  button:hover { border-color: var(--line-strong); background: #fffaf1; }
  button.primary { background: var(--ink); color: #fffaf1; border-color: var(--ink); }
  button.ghost { background: transparent; }
  button.icon { width: 34px; padding: 0; display: grid; place-items: center; }
  button:disabled { opacity: .45; cursor: default; }
  select, input, textarea {
    border: 1px solid var(--line);
    background: #fffefa;
    color: var(--ink);
    border-radius: 7px;
    outline: none;
  }
  select:focus, input:focus, textarea:focus { border-color: #9f7d61; box-shadow: 0 0 0 3px rgba(122, 79, 43, .11); }
  .app {
    height: 100vh;
    display: grid;
    grid-template-rows: 56px 1fr;
    min-width: 0;
  }
  .topbar {
    display: flex;
    align-items: center;
    justify-content: space-between;
    padding: 0 18px;
    border-bottom: 1px solid var(--line);
    background: rgba(255, 253, 248, .82);
    backdrop-filter: blur(18px);
  }
  .brand { display: flex; align-items: center; gap: 10px; min-width: 0; }
  .mark {
    width: 28px;
    height: 28px;
    border: 1px solid #d0a47e;
    border-radius: 8px;
    display: grid;
    place-items: center;
    color: var(--accent);
    background: #fff8ed;
    font-family: var(--serif);
    font-weight: 700;
  }
  .brand-title { font-weight: 650; white-space: nowrap; }
  .brand-subtitle { color: var(--muted); font-size: 12px; white-space: nowrap; overflow: hidden; text-overflow: ellipsis; }
  .top-actions { display: flex; align-items: center; gap: 8px; }
  .shell {
    min-height: 0;
    display: grid;
    grid-template-columns: 292px minmax(420px, 1fr) 336px;
    gap: 12px;
    padding: 12px;
  }
  .panel {
    background: rgba(255, 253, 248, .86);
    border: 1px solid var(--line);
    border-radius: 8px;
    box-shadow: var(--shadow);
    min-height: 0;
    overflow: hidden;
  }
  .sidebar, .inspector { display: flex; flex-direction: column; }
  .section { padding: 14px; border-bottom: 1px solid var(--line); }
  .section:last-child { border-bottom: 0; }
  .section-head {
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 10px;
    margin-bottom: 10px;
  }
  .eyebrow {
    color: var(--muted);
    font-size: 11px;
    font-weight: 700;
    text-transform: uppercase;
  }
  .stack { display: grid; gap: 8px; }
  .list-scroll { overflow: auto; min-height: 0; }
  .agent-card, .session-card {
    border: 1px solid transparent;
    border-radius: 8px;
    padding: 10px;
    cursor: pointer;
    background: transparent;
  }
  .agent-card:hover, .session-card:hover { background: #f5f0e8; border-color: #e2d8c8; }
  .agent-card.active, .session-card.active { background: #efe5d7; border-color: #d7bd9d; }
  .row { display: flex; align-items: center; justify-content: space-between; gap: 10px; min-width: 0; }
  .title { font-weight: 620; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .subtle { color: var(--muted); font-size: 12px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .mono { font-family: var(--mono); font-size: 11px; }
  .pill {
    display: inline-flex;
    align-items: center;
    gap: 5px;
    height: 22px;
    padding: 0 8px;
    border-radius: 999px;
    border: 1px solid var(--line);
    color: var(--muted);
    background: #fffaf2;
    font-size: 11px;
    white-space: nowrap;
  }
  .dot { width: 7px; height: 7px; border-radius: 50%; background: var(--faint); }
  .dot.active, .dot.paused, .dot.queued { background: var(--good); }
  .dot.running { background: var(--accent-2); }
  .dot.failed { background: var(--bad); }
  .workspace {
    display: grid;
    grid-template-rows: auto 1fr auto;
    min-height: 0;
  }
  .workspace-head {
    padding: 14px 16px;
    border-bottom: 1px solid var(--line);
    display: flex;
    align-items: center;
    justify-content: space-between;
    gap: 16px;
  }
  .workspace-title { min-width: 0; }
  .workspace-title h1 { margin: 0; font-size: 18px; line-height: 1.25; font-weight: 680; }
  .toolbar { display: flex; align-items: center; gap: 8px; flex-wrap: wrap; justify-content: flex-end; }
  .toolbar select { height: 34px; max-width: 220px; padding: 0 10px; }
  .tabs {
    display: flex;
    align-items: center;
    gap: 4px;
    padding: 8px 12px 0;
    background: rgba(255, 253, 248, .76);
  }
  .tab {
    height: 32px;
    padding: 0 12px;
    border-radius: 7px 7px 0 0;
    border: 1px solid transparent;
    border-bottom: 0;
    background: transparent;
    color: var(--muted);
  }
  .tab.active { color: var(--ink); background: var(--surface); border-color: var(--line); }
  .content-area { min-height: 0; display: grid; grid-template-rows: auto 1fr; }
  .view { display: none; min-height: 0; overflow: auto; padding: 16px; }
  .view.active { display: block; }
  .chat-log { min-height: 100%; display: flex; flex-direction: column; gap: 12px; }
  .empty {
    margin: auto;
    max-width: 520px;
    text-align: center;
    padding: 48px 18px;
  }
  .empty h2 {
    margin: 0 0 8px;
    font-family: var(--serif);
    font-size: 29px;
    font-weight: 500;
    line-height: 1.12;
  }
  .empty p { margin: 0 0 18px; color: var(--muted); }
  .message {
    display: grid;
    gap: 5px;
    max-width: 820px;
  }
  .message.user { margin-left: auto; justify-items: end; }
  .message.agent { margin-right: auto; }
  .message .label { color: var(--muted); font-size: 11px; font-weight: 700; text-transform: uppercase; }
  .bubble {
    border: 1px solid var(--line);
    background: #fffefa;
    border-radius: 8px;
    padding: 10px 12px;
    white-space: pre-wrap;
    overflow-wrap: anywhere;
  }
  .message.user .bubble { background: #2f2a24; color: #fff8ed; border-color: #2f2a24; }
  .message.tool .bubble { background: #fbf2e3; font-family: var(--mono); font-size: 12px; color: #3a2d20; }
  .message.status { align-self: center; color: var(--muted); font-size: 12px; }
  .trajectory { display: grid; gap: 8px; }
  .event-row {
    display: grid;
    grid-template-columns: 72px minmax(140px, 220px) 1fr;
    gap: 10px;
    align-items: start;
    border: 1px solid var(--line);
    background: #fffefa;
    border-radius: 8px;
    padding: 10px;
  }
  .event-type { font-family: var(--mono); font-size: 12px; color: var(--accent); overflow-wrap: anywhere; }
  .event-body { color: var(--muted); font-size: 12px; white-space: pre-wrap; overflow-wrap: anywhere; }
  .composer {
    border-top: 1px solid var(--line);
    padding: 12px;
    background: rgba(255, 253, 248, .92);
  }
  .composer-inner {
    display: grid;
    grid-template-columns: 1fr auto;
    gap: 10px;
    align-items: end;
    border: 1px solid var(--line);
    background: #fffefa;
    border-radius: 8px;
    padding: 8px;
  }
  textarea {
    resize: none;
    width: 100%;
    min-height: 44px;
    max-height: 140px;
    padding: 10px;
    border: 0;
    background: transparent;
  }
  textarea:focus { box-shadow: none; }
  .meta-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 8px; }
  .metric {
    border: 1px solid var(--line);
    border-radius: 8px;
    padding: 10px;
    background: #fffefa;
  }
  .metric strong { display: block; font-size: 18px; line-height: 1.1; }
  .metric span { color: var(--muted); font-size: 11px; }
  .detail-list { display: grid; gap: 8px; }
  .detail {
    display: grid;
    grid-template-columns: 92px 1fr;
    gap: 8px;
    font-size: 12px;
  }
  .detail span:first-child { color: var(--muted); }
  .codebox {
    border: 1px solid var(--line);
    border-radius: 8px;
    background: #28231f;
    color: #fff8ed;
    padding: 10px;
    max-height: 170px;
    overflow: auto;
    font-family: var(--mono);
    font-size: 11px;
    white-space: pre-wrap;
  }
  .toast {
    position: fixed;
    right: 16px;
    bottom: 16px;
    max-width: 360px;
    background: #2f2a24;
    color: #fff8ed;
    padding: 10px 12px;
    border-radius: 8px;
    box-shadow: var(--shadow);
    display: none;
  }
  .toast.show { display: block; }
  @media (max-width: 1040px) {
    body { overflow: auto; }
    .app { height: auto; min-height: 100vh; }
    .shell { grid-template-columns: 260px minmax(0, 1fr); }
    .inspector { grid-column: 1 / -1; min-height: 320px; }
  }
  @media (max-width: 760px) {
    .app { grid-template-rows: auto 1fr; }
    .topbar { align-items: flex-start; height: auto; padding: 12px; gap: 10px; flex-direction: column; }
    .top-actions { width: 100%; justify-content: space-between; }
    .shell { grid-template-columns: 1fr; padding: 8px; }
    .sidebar { max-height: 360px; }
    .workspace { min-height: 620px; }
    .workspace-head { align-items: stretch; flex-direction: column; }
    .toolbar { justify-content: stretch; }
    .toolbar select, .toolbar button { flex: 1; max-width: none; }
    .event-row { grid-template-columns: 1fr; }
    .meta-grid { grid-template-columns: 1fr; }
  }
</style>
</head>
<body>
<div class="app">
  <header class="topbar">
    <div class="brand">
      <div class="mark">m</div>
      <div>
        <div class="brand-title">managed-agents</div>
        <div class="brand-subtitle">Local Claude Managed Agents-style runtime</div>
      </div>
    </div>
    <div class="top-actions">
      <span class="pill"><span class="dot active"></span><span id="healthText">checking</span></span>
      <button id="reloadBtn" class="ghost" title="Reload agents">Reload</button>
      <button id="refreshBtn" class="icon" title="Refresh">↻</button>
    </div>
  </header>
  <div class="shell">
    <aside class="panel sidebar">
      <div class="section">
        <div class="section-head">
          <div class="eyebrow">Agents</div>
          <span id="agentCount" class="pill">0</span>
        </div>
        <div id="agents" class="stack"></div>
      </div>
      <div class="section" style="display:flex; flex-direction:column; min-height:0; flex:1;">
        <div class="section-head">
          <div class="eyebrow">Sessions</div>
          <span id="sessionCount" class="pill">0</span>
        </div>
        <div id="sessions" class="stack list-scroll"></div>
      </div>
    </aside>
    <main class="panel workspace">
      <div class="workspace-head">
        <div class="workspace-title">
          <h1 id="sessionTitle">New session</h1>
          <div id="sessionSubtitle" class="subtle">Choose an agent, create a session, then send a message.</div>
        </div>
        <div class="toolbar">
          <select id="agentSel" aria-label="Agent"></select>
          <button id="newBtn" class="primary">New session</button>
        </div>
      </div>
      <div class="content-area">
        <div class="tabs">
          <button class="tab active" data-view="chat">Chat</button>
          <button class="tab" data-view="trajectory">Trajectory</button>
        </div>
        <section id="chatView" class="view active">
          <div id="chatLog" class="chat-log"></div>
        </section>
        <section id="trajectoryView" class="view">
          <div id="trajectory" class="trajectory"></div>
        </section>
      </div>
      <form id="composer" class="composer">
        <div class="composer-inner">
          <textarea id="input" placeholder="Message the agent..." disabled></textarea>
          <button id="sendBtn" class="primary" disabled>Send</button>
        </div>
      </form>
    </main>
    <aside class="panel inspector">
      <div class="section">
        <div class="section-head">
          <div class="eyebrow">Runtime</div>
          <span id="runtimeStatus" class="pill">local</span>
        </div>
        <div class="meta-grid">
          <div class="metric"><strong id="metricAgents">0</strong><span>agents</span></div>
          <div class="metric"><strong id="metricSessions">0</strong><span>sessions</span></div>
          <div class="metric"><strong id="metricEvents">0</strong><span>events in view</span></div>
          <div class="metric"><strong id="metricStatus">idle</strong><span>session status</span></div>
        </div>
      </div>
      <div class="section">
        <div class="section-head"><div class="eyebrow">Session</div></div>
        <div id="sessionDetails" class="detail-list"></div>
      </div>
      <div class="section">
        <div class="section-head"><div class="eyebrow">Agent</div></div>
        <div id="agentDetails" class="detail-list"></div>
      </div>
      <div class="section">
        <div class="section-head"><div class="eyebrow">System prompt</div></div>
        <div id="systemPrompt" class="codebox">Select an agent to inspect its prompt.</div>
      </div>
    </aside>
  </div>
</div>
<div id="toast" class="toast"></div>
<script>
const state = {
  agents: [],
  agentDetails: new Map(),
  sessions: [],
  currentSession: null,
  currentAgent: null,
  currentStream: null,
  streamBubble: null,
  suppressNextAgentMessage: false,
  events: [],
  view: 'chat',
  apiKey: localStorage.getItem('managed-agents.apiKey') || ''
};

const eventTypes = [
  'user.message',
  'agent.message',
  'agent.message_chunk',
  'agent.message_stream_start',
  'agent.message_stream_end',
  'agent.thinking',
  'agent.tool_use',
  'agent.tool_result',
  'agent.mcp_tool_use',
  'agent.mcp_tool_result',
  'agent.custom_tool_use',
  'agent.thread_context_compacted',
  'span.model_request_start',
  'span.model_request_end',
  'session.status_running',
  'session.status_idle',
  'session.status_rescheduled',
  'session.status_terminated',
  'session.error',
  'session.deleted'
];

function $(id) { return document.getElementById(id); }
function headers(extra) {
  const h = Object.assign({ 'Content-Type': 'application/json' }, extra || {});
  if (state.apiKey) h.Authorization = 'Bearer ' + state.apiKey;
  return h;
}
async function api(path, opts) {
  const res = await fetch(path, Object.assign({}, opts || {}, { headers: headers((opts || {}).headers) }));
  if (!res.ok) {
    let msg = res.statusText;
    try {
      const body = await res.json();
      msg = body.error && body.error.message ? body.error.message : msg;
    } catch {}
    throw new Error(msg);
  }
  return res.json();
}
function showToast(message) {
  const el = $('toast');
  el.textContent = message;
  el.classList.add('show');
  clearTimeout(showToast.timer);
  showToast.timer = setTimeout(() => el.classList.remove('show'), 3200);
}
function textFromContent(content) {
  return (content || [])
    .filter((block) => block.type === 'text')
    .map((block) => block.text)
    .join('\\n');
}
function shortId(id) {
  if (!id) return 'none';
  return id.length > 18 ? id.slice(0, 10) + '...' + id.slice(-5) : id;
}
function statusDot(status) {
  return '<span class="dot ' + (status || '') + '"></span>';
}
function detail(label, value) {
  return '<div class="detail"><span>' + label + '</span><strong>' + escapeHtml(String(value ?? 'none')) + '</strong></div>';
}
function escapeHtml(value) {
  return String(value)
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}
function setView(view) {
  state.view = view;
  document.querySelectorAll('.tab').forEach((tab) => tab.classList.toggle('active', tab.dataset.view === view));
  $('chatView').classList.toggle('active', view === 'chat');
  $('trajectoryView').classList.toggle('active', view === 'trajectory');
}
async function loadHealth() {
  try {
    const health = await fetch('/v1/x/health').then((r) => r.json());
    $('healthText').textContent = health.status || 'healthy';
    $('runtimeStatus').textContent = 'local';
  } catch {
    $('healthText').textContent = 'offline';
    $('runtimeStatus').textContent = 'offline';
  }
}
async function loadAgents() {
  const { data } = await api('/v1/agents');
  state.agents = data || [];
  $('agentCount').textContent = String(state.agents.length);
  $('metricAgents').textContent = String(state.agents.length);
  const select = $('agentSel');
  select.innerHTML = '';
  const list = $('agents');
  list.innerHTML = '';
  for (const agent of state.agents) {
    const opt = document.createElement('option');
    opt.value = agent.name;
    opt.textContent = agent.name;
    select.appendChild(opt);
    const card = document.createElement('div');
    card.className = 'agent-card' + (state.currentAgent === agent.name ? ' active' : '');
    card.innerHTML =
      '<div class="row"><div class="title">' + escapeHtml(agent.name) + '</div><span class="pill">' + statusDot(agent.status) + escapeHtml(agent.status) + '</span></div>' +
      '<div class="subtle">' + escapeHtml(agent.model || 'model not set') + '</div>' +
      '<div class="subtle">' + escapeHtml(agent.description || 'No description') + '</div>';
    card.onclick = () => selectAgent(agent.name);
    list.appendChild(card);
  }
  if (!state.currentAgent && state.agents[0]) {
    await selectAgent(state.agents[0].name, false);
  }
}
async function selectAgent(name, rerender) {
  state.currentAgent = name;
  $('agentSel').value = name;
  if (!state.agentDetails.has(name)) {
    try {
      state.agentDetails.set(name, await api('/v1/agents/' + encodeURIComponent(name)));
    } catch (err) {
      showToast(err.message);
    }
  }
  renderAgentDetails();
  if (rerender !== false) renderAgentsOnly();
}
function renderAgentsOnly() {
  const list = $('agents');
  [...list.children].forEach((child, index) => {
    child.classList.toggle('active', state.agents[index] && state.agents[index].name === state.currentAgent);
  });
}
async function loadSessions() {
  const { data } = await api('/v1/sessions?limit=50');
  state.sessions = data || [];
  if (state.currentSession) {
    const current = state.sessions.find((session) => session.id === state.currentSession.id);
    if (current) state.currentSession = Object.assign({}, state.currentSession, current);
  }
  $('sessionCount').textContent = String(state.sessions.length);
  $('metricSessions').textContent = String(state.sessions.length);
  renderSessions();
  renderInspector();
}
function renderSessions() {
  const list = $('sessions');
  list.innerHTML = '';
  for (const session of state.sessions) {
    const card = document.createElement('div');
    card.className = 'session-card' + (state.currentSession && state.currentSession.id === session.id ? ' active' : '');
    card.innerHTML =
      '<div class="row"><div class="title">' + escapeHtml(session.agent_name) + '</div><span class="pill">' + statusDot(session.status) + escapeHtml(session.status) + '</span></div>' +
      '<div class="subtle mono">' + escapeHtml(shortId(session.id)) + '</div>' +
      '<div class="subtle">' + escapeHtml(new Date(session.updated_at || session.created_at).toLocaleString()) + '</div>';
    card.onclick = () => openSession(session.id);
    list.appendChild(card);
  }
}
async function newSession() {
  const agent = $('agentSel').value || state.currentAgent;
  if (!agent) return showToast('Create an agent first.');
  try {
    const session = await api('/v1/sessions', {
      method: 'POST',
      body: JSON.stringify({ agent })
    });
    await loadSessions();
    await openSession(session.id);
  } catch (err) {
    showToast(err.message);
  }
}
async function openSession(id) {
  try {
    const session = await api('/v1/sessions/' + encodeURIComponent(id));
    state.currentSession = session;
    await selectAgent(session.agent_name, false);
    $('input').disabled = false;
    $('sendBtn').disabled = false;
    $('sessionTitle').textContent = session.agent_name;
    $('sessionSubtitle').textContent = session.id + ' / ' + session.status;
    state.events = [];
    state.streamBubble = null;
    $('chatLog').innerHTML = '';
    $('trajectory').innerHTML = '';
    const { data } = await api('/v1/sessions/' + encodeURIComponent(id) + '/events');
    state.events = data || [];
    renderAllEvents();
    connectStream(id);
    await loadSessions();
    renderInspector();
  } catch (err) {
    showToast(err.message);
  }
}
function connectStream(id) {
  if (state.currentStream) state.currentStream.close();
  state.currentStream = new EventSource('/v1/sessions/' + encodeURIComponent(id) + '/events/stream');
  for (const type of eventTypes) {
    state.currentStream.addEventListener(type, (event) => {
      try {
        const payload = JSON.parse(event.data || '{}');
        handleLiveEvent(payload);
      } catch {}
    });
  }
  state.currentStream.onerror = () => {
    $('healthText').textContent = 'stream retrying';
  };
}
function handleLiveEvent(event) {
  if (!event || !event.type || event.type === 'heartbeat') return;
  if (typeof event.seq === 'number' && state.events.some((existing) => existing.seq === event.seq)) return;
  if (typeof event.seq === 'number' && event.seq !== 0) state.events.push(event);
  if (event.type.startsWith('session.')) {
    if (state.currentSession) state.currentSession.status = event.type.replace('session.status_', '');
    $('sessionSubtitle').textContent = state.currentSession ? state.currentSession.id + ' / ' + event.type.replace('session.status_', '') : event.type;
  }
  renderEvent(event, { live: true });
  renderInspector();
}
function renderAllEvents() {
  const chat = $('chatLog');
  const trajectory = $('trajectory');
  chat.innerHTML = '';
  trajectory.innerHTML = '';
  state.streamBubble = null;
  state.suppressNextAgentMessage = false;
  if (state.events.length === 0) {
    chat.innerHTML = '<div class="empty"><h2>Start a managed session</h2><p>Choose an agent and send a message. The transcript and event trajectory will appear here.</p><button class="primary" onclick="document.getElementById(\\'input\\').focus()">Focus composer</button></div>';
  }
  for (const event of state.events) renderEvent(event, { live: false });
  renderInspector();
}
function renderNoSession() {
  state.currentSession = null;
  state.events = [];
  state.streamBubble = null;
  state.suppressNextAgentMessage = false;
  $('input').disabled = true;
  $('sendBtn').disabled = true;
  $('sessionTitle').textContent = 'New session';
  $('sessionSubtitle').textContent = 'Choose an agent, create a session, then send a message.';
  $('chatLog').innerHTML = '<div class="empty"><h2>Start a managed session</h2><p>Choose an agent and open a session to begin.</p><button id="emptyNewSession" class="primary" type="button">New session</button></div>';
  $('trajectory').innerHTML = '<div class="empty"><h2>No trajectory yet</h2><p>Runtime events will appear after a session starts.</p></div>';
  const button = $('emptyNewSession');
  if (button) button.onclick = newSession;
  renderInspector();
}
function addMessage(kind, label, text) {
  const chat = $('chatLog');
  const empty = chat.querySelector('.empty');
  if (empty) empty.remove();
  const node = document.createElement('div');
  node.className = 'message ' + kind;
  node.innerHTML = '<div class="label">' + escapeHtml(label) + '</div><div class="bubble">' + escapeHtml(text || '(empty)') + '</div>';
  chat.appendChild(node);
  chat.scrollTop = chat.scrollHeight;
  return node.querySelector('.bubble');
}
function addStatus(text) {
  const chat = $('chatLog');
  const empty = chat.querySelector('.empty');
  if (empty) empty.remove();
  const node = document.createElement('div');
  node.className = 'message status';
  node.textContent = text;
  chat.appendChild(node);
}
function renderEvent(event, opts) {
  const live = opts && opts.live;
  if (event.type === 'agent.message_chunk') {
    if (!state.streamBubble) state.streamBubble = addMessage('agent', 'Agent', '');
    state.streamBubble.textContent += event.delta || '';
    state.suppressNextAgentMessage = live;
  } else if (event.type === 'agent.message_stream_end') {
    state.streamBubble = null;
  } else if (event.type === 'user.message') {
    addMessage('user', 'User', textFromContent(event.content));
  } else if (event.type === 'agent.message') {
    if (live && state.suppressNextAgentMessage) {
      state.suppressNextAgentMessage = false;
    } else {
      addMessage('agent', 'Agent', textFromContent(event.content));
    }
  } else if (event.type === 'agent.tool_use' || event.type === 'agent.mcp_tool_use' || event.type === 'agent.custom_tool_use') {
    const block = (event.content || [])[0] || {};
    addMessage('tool', 'Tool use', (block.name || 'tool') + ' ' + JSON.stringify(block.input || {}, null, 2));
  } else if (event.type === 'agent.tool_result' || event.type === 'agent.mcp_tool_result') {
    const block = (event.content || [])[0] || {};
    const content = typeof block.content === 'string' ? block.content : JSON.stringify(block.content || '', null, 2);
    addMessage('tool', 'Tool result', content.slice(0, 1200));
  } else if (event.type === 'agent.thinking') {
    addMessage('agent', 'Thinking', textFromContent(event.content));
  } else if (event.type && event.type.startsWith('session.')) {
    addStatus(event.type);
  }
  renderTrajectoryEvent(event);
}
function renderTrajectoryEvent(event) {
  const row = document.createElement('div');
  row.className = 'event-row';
  const body = textFromContent(event.content) || event.delta || JSON.stringify(event.content || {}, null, 2);
  row.innerHTML =
    '<div class="mono">#' + escapeHtml(event.seq ?? 0) + '</div>' +
    '<div class="event-type">' + escapeHtml(event.type) + '</div>' +
    '<div class="event-body">' + escapeHtml(body || 'no payload') + '</div>';
  $('trajectory').appendChild(row);
}
async function sendMessage(event) {
  event.preventDefault();
  const input = $('input');
  const text = input.value.trim();
  if (!text || !state.currentSession) return;
  input.value = '';
  input.style.height = 'auto';
  try {
    await api('/v1/sessions/' + encodeURIComponent(state.currentSession.id) + '/messages', {
      method: 'POST',
      body: JSON.stringify({ content: text, stream: false })
    });
  } catch (err) {
    showToast(err.message);
  }
}
function renderInspector() {
  const session = state.currentSession;
  $('metricEvents').textContent = String(state.events.length);
  $('metricStatus').textContent = session ? session.status : 'none';
  if (!session) {
    $('sessionDetails').innerHTML = '<div class="subtle">No session selected.</div>';
    return;
  }
  $('sessionDetails').innerHTML =
    detail('id', session.id) +
    detail('agent', session.agent_name) +
    detail('status', session.status) +
    detail('created', new Date(session.created_at).toLocaleString()) +
    detail('updated', new Date(session.updated_at).toLocaleString()) +
    detail('context', session.context_id || 'none');
}
function renderAgentDetails() {
  const agent = state.agentDetails.get(state.currentAgent);
  if (!agent) {
    $('agentDetails').innerHTML = '<div class="subtle">No agent selected.</div>';
    $('systemPrompt').textContent = 'Select an agent to inspect its prompt.';
    return;
  }
  $('agentDetails').innerHTML =
    detail('name', agent.name) +
    detail('model', agent.model) +
    detail('environment', agent.environment) +
    detail('strategy', agent.strategy) +
    detail('tools', (agent.tools || []).join(', ') || 'none') +
    detail('skills', (agent.skills || []).join(', ') || 'none') +
    detail('delegates', (agent.delegations || []).join(', ') || 'none');
  $('systemPrompt').textContent = agent.system_prompt || 'No system prompt.';
}
async function reloadAgents() {
  try {
    await api('/v1/x/reload', { method: 'POST', body: JSON.stringify({}) });
    state.agentDetails.clear();
    await loadAgents();
    showToast('Agents reloaded.');
  } catch (err) {
    showToast(err.message);
  }
}
async function refreshAll() {
  try {
    await Promise.all([loadHealth(), loadAgents(), loadSessions()]);
    if (state.currentSession) await openSession(state.currentSession.id);
    else renderNoSession();
  } catch (err) {
    showToast(err.message);
  }
}

document.querySelectorAll('.tab').forEach((tab) => tab.onclick = () => setView(tab.dataset.view));
$('newBtn').onclick = newSession;
$('refreshBtn').onclick = refreshAll;
$('reloadBtn').onclick = reloadAgents;
$('agentSel').onchange = (event) => selectAgent(event.target.value);
$('composer').onsubmit = sendMessage;
$('input').addEventListener('input', (event) => {
  event.target.style.height = 'auto';
  event.target.style.height = Math.min(event.target.scrollHeight, 140) + 'px';
});
$('input').addEventListener('keydown', (event) => {
  if (event.key === 'Enter' && !event.shiftKey) {
    event.preventDefault();
    $('composer').requestSubmit();
  }
});

refreshAll();
setInterval(loadSessions, 5000);
</script>
</body>
</html>`;
