/**
 * Web Dashboard (Requirement 10)
 *
 * A minimal, dependency-free single-page dashboard served at /ui. It lists
 * agents and sessions, creates sessions, and streams a chat conversation live
 * over SSE. Embedded as a string constant so it survives bundling (no separate
 * build pipeline). For a richer UI, a React+Vite app can replace this and be
 * served from the same route — the API + SDK already support it.
 */

export const DASHBOARD_HTML = `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8" />
<meta name="viewport" content="width=device-width, initial-scale=1" />
<title>managed-agents</title>
<style>
  :root { color-scheme: light dark; }
  * { box-sizing: border-box; }
  body { margin: 0; font: 14px/1.5 -apple-system, system-ui, sans-serif; display: grid; grid-template-columns: 260px 1fr; height: 100vh; }
  nav { border-right: 1px solid #8883; padding: 16px; overflow: auto; }
  main { display: flex; flex-direction: column; min-width: 0; }
  h1 { font-size: 16px; margin: 0 0 16px; }
  h2 { font-size: 12px; text-transform: uppercase; opacity: 0.6; margin: 16px 0 8px; }
  .item { padding: 6px 8px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  .item:hover { background: #8882; }
  .item.active { background: #4a9eff33; }
  .mono { font-family: ui-monospace, monospace; font-size: 12px; }
  header { padding: 12px 16px; border-bottom: 1px solid #8883; display: flex; gap: 12px; align-items: center; }
  #log { flex: 1; overflow: auto; padding: 16px; }
  .msg { margin-bottom: 12px; padding: 8px 12px; border-radius: 8px; max-width: 80%; white-space: pre-wrap; }
  .msg.user { background: #4a9eff33; margin-left: auto; }
  .msg.agent { background: #8882; }
  .msg.tool { background: #f0a83322; font-family: ui-monospace, monospace; font-size: 12px; }
  .msg.status { opacity: 0.5; font-size: 11px; text-align: center; background: none; }
  footer { padding: 12px 16px; border-top: 1px solid #8883; display: flex; gap: 8px; }
  input, select, button { font: inherit; padding: 8px 10px; border-radius: 6px; border: 1px solid #8884; background: transparent; color: inherit; }
  input { flex: 1; }
  button { cursor: pointer; background: #4a9eff; color: #fff; border: none; }
  button:disabled { opacity: 0.5; cursor: default; }
</style>
</head>
<body>
<nav>
  <h1>managed-agents</h1>
  <h2>Agents</h2>
  <div id="agents"></div>
  <h2>Sessions</h2>
  <div id="sessions"></div>
</nav>
<main>
  <header>
    <select id="agentSel"></select>
    <button id="newBtn">New session</button>
    <span id="sid" class="mono" style="opacity:.6"></span>
  </header>
  <div id="log"></div>
  <footer>
    <input id="input" placeholder="Type a message..." disabled />
    <button id="sendBtn" disabled>Send</button>
  </footer>
</main>
<script>
const api = (p, opts) => fetch(p, opts).then(r => r.json());
let currentSession = null;
let currentStream = null;

async function loadAgents() {
  const { data } = await api('/v1/agents');
  const sel = document.getElementById('agentSel');
  const list = document.getElementById('agents');
  sel.innerHTML = ''; list.innerHTML = '';
  for (const a of data) {
    const o = document.createElement('option'); o.value = a.name; o.textContent = a.name; sel.appendChild(o);
    const d = document.createElement('div'); d.className = 'item'; d.textContent = a.name + '  (' + a.model + ')'; list.appendChild(d);
  }
}

async function loadSessions() {
  const { data } = await api('/v1/sessions?limit=50');
  const list = document.getElementById('sessions');
  list.innerHTML = '';
  for (const s of data) {
    const d = document.createElement('div');
    d.className = 'item' + (s.id === currentSession ? ' active' : '');
    d.textContent = s.agent_name + ' · ' + s.status;
    d.title = s.id;
    d.onclick = () => openSession(s.id);
    list.appendChild(d);
  }
}

function addMsg(cls, text) {
  const log = document.getElementById('log');
  const d = document.createElement('div'); d.className = 'msg ' + cls; d.textContent = text;
  log.appendChild(d); log.scrollTop = log.scrollHeight;
  return d;
}

async function openSession(id) {
  currentSession = id;
  document.getElementById('sid').textContent = id;
  document.getElementById('input').disabled = false;
  document.getElementById('sendBtn').disabled = false;
  document.getElementById('log').innerHTML = '';
  await loadSessions();

  // Load history
  const { data } = await api('/v1/sessions/' + id + '/events');
  for (const e of data) renderEvent(e);

  // Live stream
  if (currentStream) currentStream.close();
  currentStream = new EventSource('/v1/sessions/' + id + '/events/stream');
  let streamMsg = null;
  currentStream.onmessage = (ev) => {
    try {
      const e = JSON.parse(ev.data);
      if (e.type === 'agent.message_chunk') {
        if (!streamMsg) streamMsg = addMsg('agent', '');
        streamMsg.textContent += e.delta || '';
      } else if (e.type === 'agent.message_stream_end') {
        streamMsg = null;
      } else {
        renderEvent(e);
      }
    } catch {}
  };
}

function renderEvent(e) {
  const text = (e.content || []).filter(b => b.type === 'text').map(b => b.text).join('\\n');
  if (e.type === 'user.message') addMsg('user', text);
  else if (e.type === 'agent.message') addMsg('agent', text);
  else if (e.type === 'agent.tool_use' || e.type === 'agent.mcp_tool_use') {
    const b = (e.content || [])[0] || {}; addMsg('tool', '→ ' + (b.name || 'tool') + ' ' + JSON.stringify(b.input || {}));
  } else if (e.type === 'agent.tool_result' || e.type === 'agent.mcp_tool_result') {
    const b = (e.content || [])[0] || {}; addMsg('tool', '← ' + (typeof b.content === 'string' ? b.content : JSON.stringify(b.content)).slice(0, 500));
  } else if (e.type && e.type.startsWith('session.')) addMsg('status', e.type);
}

document.getElementById('newBtn').onclick = async () => {
  const agent = document.getElementById('agentSel').value;
  if (!agent) return;
  const s = await api('/v1/sessions', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ agent }) });
  await openSession(s.id);
};

async function send() {
  const input = document.getElementById('input');
  const text = input.value.trim();
  if (!text || !currentSession) return;
  input.value = '';
  await fetch('/v1/sessions/' + currentSession + '/events', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ type: 'user.message', content: [{ type: 'text', text }] }),
  });
}
document.getElementById('sendBtn').onclick = send;
document.getElementById('input').addEventListener('keydown', (e) => { if (e.key === 'Enter') send(); });

loadAgents(); loadSessions();
setInterval(loadSessions, 5000);
</script>
</body>
</html>`;
