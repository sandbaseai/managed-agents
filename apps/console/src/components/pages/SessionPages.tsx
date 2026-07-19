import { Archive, ChevronDown, Clock, Cloud, Copy, Download, Keyboard, MessageSquare, Monitor, Plus, Search, Send, Square, X } from 'lucide-react';
import { type Dispatch, type FormEvent, type SetStateAction, useEffect, useState } from 'react';
import { deleteJson, getPage, postJson } from '../../api';
import { EmptyState, FilterSelect, LoadingState, ResourceBadge, StatusPill, Toolbar } from '../Common';
import { downloadJson, formatDateShort, formatDuration, formatUsage, relativeDate, shortId, titleCase } from '../../lib/format';
import type { Agent, ConsoleData, Session, SessionEvent } from '../../types';

const SESSION_EVENT_KINDS = ['user', 'agent', 'tool', 'error', 'system'] as const;
type SessionEventKind = (typeof SESSION_EVENT_KINDS)[number];
type SessionDisplayStatus = Session['status'] | 'queued' | 'completed';

export function Sessions({ data, onNewSession, onOpenSession }: { data: ConsoleData; onNewSession: () => void; onOpenSession: (session: Session) => void }) {
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('active');
  const [agentId, setAgentId] = useState('all');
  const sessions = data.sessions.filter((session) => {
    const q = query.toLowerCase();
    const matchesStatus = status === 'all' || (status === 'active' ? !session.archived_at : session.status === status);
    const matchesAgent = agentId === 'all' || session.agent.id === agentId;
    const matchesQuery = session.id.toLowerCase().includes(q) || session.agent.name.toLowerCase().includes(q) || (session.title ?? '').toLowerCase().includes(q);
    return matchesStatus && matchesAgent && matchesQuery;
  });
  return (
    <section className="stack">
      <div className="pageIntro">
        <div>
          <h1>Sessions</h1>
          <p>Trace and debug managed agent sessions.</p>
        </div>
        <button className="darkButton" type="button" onClick={onNewSession}>
          <Plus size={18} />
          Create session
        </button>
      </div>
      <Toolbar
        query={query}
        onQuery={setQuery}
        placeholder="Search by session ID"
        actions={(
          <>
            <FilterSelect label="Created" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All time' }]} />
            <FilterSelect
              label="Agent"
              value={agentId}
              onChange={setAgentId}
              options={[
                { value: 'all', label: 'All' },
                ...data.agents.map((agent) => ({ value: agent.id, label: agent.name })),
              ]}
            />
            <FilterSelect label="Deployment" value="all" onChange={() => undefined} options={[{ value: 'all', label: 'All' }]} />
            <FilterSelect
              label="Status"
              value={status}
              onChange={setStatus}
              options={[
                { value: 'active', label: 'Active' },
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
      <div className="tablePanel sessionsTablePanel">
        <table className="sessionTable">
          <thead>
            <tr>
              <th className="selectCol"><input type="checkbox" aria-label="Select all sessions" /></th>
              <th>ID</th>
              <th>Name</th>
              <th>Status</th>
              <th>Agent</th>
              <th>Tokens in / out</th>
              <th>Created</th>
            </tr>
          </thead>
          <tbody>
            {sessions.map((session) => (
              <tr key={session.id} className="clickableRow" onClick={() => onOpenSession(session)}>
                <td className="selectCol" onClick={(event) => event.stopPropagation()}><input type="checkbox" aria-label={`Select ${session.id}`} /></td>
                <td>
                  <strong className="monoText">{shortId(session.id)}</strong>
                </td>
                <td>{session.title || '-'}</td>
                <td><StatusPill status={session.status} /></td>
                <td><ResourceBadge icon={<Monitor size={15} />} label={session.agent.name} /></td>
                <td>{formatUsage(session.usage)}</td>
                <td>{formatDateShort(session.created_at)}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {sessions.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
      <div className="mobileSessionList">
        {sessions.map((session) => (
          <button className="mobileAgentCard" type="button" key={session.id} onClick={() => onOpenSession(session)}>
            <span className="mobileAgentMain">
              <strong>{session.title || session.id}</strong>
              <small className="monoText">{session.id}</small>
            </span>
            <span className="mobileAgentMeta">
              <span>{session.agent.name}</span>
              <StatusPill status={session.status} />
            </span>
          </button>
        ))}
        {sessions.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No sessions" /> : null}
      </div>
    </section>
  );
}

export function SessionDetail({
  session,
  data,
  onBack,
  onRefresh,
  onOpenAgent,
}: {
  session: Session;
  data: ConsoleData;
  onBack: () => void;
  onRefresh: () => void;
  onOpenAgent: (agent: Agent) => void;
}) {
  const [events, setEvents] = useState<SessionEvent[]>([]);
  const [loadingEvents, setLoadingEvents] = useState(true);
  const [eventError, setEventError] = useState('');
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null);
  const [mode, setMode] = useState<'transcript' | 'debug'>('transcript');
  const [detailMode, setDetailMode] = useState<'rendered' | 'raw'>('rendered');
  const [filterOpen, setFilterOpen] = useState(false);
  const [actionsOpen, setActionsOpen] = useState(false);
  const [selectedKinds, setSelectedKinds] = useState<Set<SessionEventKind>>(new Set(SESSION_EVENT_KINDS));
  const [query, setQuery] = useState('');
  const [messageDraft, setMessageDraft] = useState('');
  const [messageError, setMessageError] = useState('');
  const [sendingMessage, setSendingMessage] = useState(false);

  const agent = data.agents.find((item) => item.id === session.agent.id);
  const environment = data.environments.find((item) => item.id === session.environment_id);
  const selectedEvent = events.find((event) => event.id === selectedEventId) ?? events[0] ?? null;
  const displayStatus = sessionDisplayStatus(session, events);

  const loadEvents = async (options: { silent?: boolean } = {}) => {
    if (!options.silent) setLoadingEvents(true);
    setEventError('');
    try {
      const page = await getPage<SessionEvent>(`/v1/sessions/${encodeURIComponent(session.id)}/events?limit=1000`);
      setEvents(page.data);
      setSelectedEventId((current) => current && page.data.some((event) => event.id === current) ? current : page.data.at(-1)?.id ?? null);
      return page.data;
    } catch (err) {
      setEventError(err instanceof Error ? err.message : String(err));
      return [];
    } finally {
      if (!options.silent) setLoadingEvents(false);
    }
  };

  useEffect(() => {
    void loadEvents();
  }, [session.id]);

  useEffect(() => {
    if (!['queued', 'running'].includes(displayStatus)) return undefined;
    const timer = window.setInterval(() => {
      void loadEvents({ silent: true });
      void onRefresh();
    }, 1500);
    return () => window.clearInterval(timer);
  }, [displayStatus, session.id, onRefresh]);

  const visibleEvents = events.filter((event) => {
    const kind = eventKind(event);
    if (mode === 'transcript' && !['user', 'agent', 'tool', 'error'].includes(kind)) return false;
    if (!selectedKinds.has(kind)) return false;
    const text = `${event.type} ${eventText(event)} ${event.id}`.toLowerCase();
    return text.includes(query.toLowerCase());
  });

  const canSendMessage = messageDraft.trim().length > 0
    && !sendingMessage
    && displayStatus !== 'failed'
    && displayStatus !== 'terminated';

  useEffect(() => {
    if (displayStatus !== 'failed') return;
    const errorEvent = [...events].reverse().find((item) => eventKind(item) === 'error');
    if (errorEvent) setMessageError(eventText(errorEvent) || eventTitle(errorEvent));
  }, [displayStatus, events]);

  const sendMessage = async (event?: FormEvent) => {
    event?.preventDefault();
    const content = messageDraft.trim();
    if (!content || sendingMessage) return;
    setSendingMessage(true);
    setMessageError('');
    try {
      const previousLastEventId = events.at(-1)?.id ?? null;
      await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/messages`, { content, stream: false });
      setMessageDraft('');
      const nextEvents = await loadEvents();
      const newEvents = eventsAfter(nextEvents, previousLastEventId);
      const errorEvent = [...newEvents].reverse().find((item) => eventKind(item) === 'error');
      if (errorEvent) setMessageError(eventText(errorEvent) || eventTitle(errorEvent));
      onRefresh();
    } catch (err) {
      setMessageError(err instanceof Error ? err.message : String(err));
    } finally {
      setSendingMessage(false);
    }
  };

  const interrupt = async () => {
    await postJson(`/v1/sessions/${encodeURIComponent(session.id)}/events`, { events: [{ type: 'user.interrupt', content: [{ type: 'text', text: 'Run interrupted by the user.' }] }] });
    setActionsOpen(false);
    await loadEvents();
    onRefresh();
  };

  const archive = async () => {
    await deleteJson(`/v1/sessions/${session.id}`);
    setActionsOpen(false);
    onBack();
    onRefresh();
  };

  return (
    <section className="sessionDetail">
      <div className="sessionCrumb">
        <button type="button" className="textButton" onClick={onBack}>Sessions</button>
        <span>/</span>
        <strong>{shortId(session.id)}</strong>
      </div>

      <div className="sessionHero">
        <div className="sessionHeroMain">
          <div className="titleLine">
            <h1>{session.id}</h1>
            <StatusPill status={displayStatus} />
          </div>
          <div className="sessionMetaRow">
            <button className="resourceBadge" type="button" onClick={() => agent ? onOpenAgent(agent) : undefined}>
              <Monitor size={15} />
              {session.agent.name}
            </button>
            <ResourceBadge icon={<Cloud size={15} />} label={environment?.name ?? session.environment_id} />
            <span><Clock size={15} />{formatDuration(session.created_at, session.updated_at)}</span>
            <span><Clock size={15} />{relativeDate(session.created_at)}</span>
          </div>
        </div>
        <div className="sessionHeroActions">
          <div className="menuWrap">
            <button className="secondaryButton largeAction" type="button" onClick={() => setActionsOpen((open) => !open)}>
              Actions <ChevronDown size={16} />
            </button>
            {actionsOpen ? (
              <div className="agentMenu sessionActionsMenu">
                <button type="button" onClick={() => void interrupt()}><Square size={18} />Send interrupt</button>
                <button type="button" className="dangerMenuItem" onClick={() => void archive()}><Archive size={18} />Archive session</button>
              </div>
            ) : null}
          </div>
        </div>
      </div>

      <div className="sessionToolbar">
        <div className="segment compactSegment">
          <button type="button" className={mode === 'transcript' ? 'active' : ''} onClick={() => setMode('transcript')}>Transcript</button>
          <button type="button" className={mode === 'debug' ? 'active' : ''} onClick={() => setMode('debug')}>Debug</button>
        </div>
        <div className="filterWrap">
          <button className="filterButton" type="button" onClick={() => setFilterOpen((open) => !open)}>All events <ChevronDown size={15} /></button>
          {filterOpen ? (
            <div className="eventFilterMenu">
              {SESSION_EVENT_KINDS.map((kind) => (
                <label key={kind}>
                  <input
                    type="checkbox"
                    checked={selectedKinds.has(kind)}
                    onChange={(event) => toggleSet(kind, event.target.checked, setSelectedKinds)}
                  />
                  <span>{kind[0].toUpperCase() + kind.slice(1)}</span>
                </label>
              ))}
              <button type="button" onClick={() => setSelectedKinds(new Set(SESSION_EVENT_KINDS))}>Select all</button>
            </div>
          ) : null}
        </div>
        <div className="sessionSearch">
          <Search size={18} />
          <input value={query} onChange={(event) => setQuery(event.target.value)} aria-label="Search events" />
        </div>
        <div className="sessionIconActions">
          <button className="iconButton" type="button" title="Keyboard shortcuts"><Keyboard size={18} /></button>
          <button className="iconButton" type="button" title="Copy session id" onClick={() => void navigator.clipboard?.writeText(session.id)}><Copy size={18} /></button>
          <button className="iconButton" type="button" title="Download event JSON" onClick={() => downloadJson(`${session.id}-events.json`, events)}><Download size={18} /></button>
        </div>
      </div>

      <div className="sessionTimeline">
        <div className="eventMiniMap">
          {events.slice(0, 42).map((event) => <span key={event.id} className={`miniEvent ${eventKind(event)}`} title={event.type} />)}
        </div>
        <div className="eventPane">
          <div className="eventList">
            {eventError ? <div className="banner error inlineBanner">{eventError}</div> : null}
            {loadingEvents ? <LoadingState /> : null}
            {!loadingEvents && visibleEvents.map((event) => (
              <button
                type="button"
                key={event.id}
                className={`eventRow ${selectedEvent?.id === event.id ? 'active' : ''}`}
                onClick={() => setSelectedEventId(event.id)}
              >
                <span className={`eventType ${eventKind(event)}`}>{eventLabel(event, mode)}</span>
                <strong>{eventTitle(event)}</strong>
                <time>{eventTime(event)}</time>
              </button>
            ))}
            {!loadingEvents && visibleEvents.length === 0 ? <EmptyState icon={<MessageSquare size={22} />} title="No events" /> : null}
          </div>
          <div className="eventInspector">
            {selectedEvent ? (
              <>
                <div className="eventInspectorHeader">
                  <button className="iconButton" type="button" title="Close selection" onClick={() => setSelectedEventId(null)}><X size={18} /></button>
                  <div>
                    <span className={`eventType ${eventKind(selectedEvent)}`}>{selectedEvent.type}</span>
                    <h2>{eventTitle(selectedEvent)}</h2>
                    <p>{eventTime(selectedEvent)}</p>
                  </div>
                  <div className="segment tinySegment">
                    <button type="button" className={detailMode === 'rendered' ? 'active' : ''} onClick={() => setDetailMode('rendered')}>Rendered</button>
                    <button type="button" className={detailMode === 'raw' ? 'active' : ''} onClick={() => setDetailMode('raw')}>Raw</button>
                  </div>
                </div>
                {detailMode === 'rendered' ? (
                  <div className="renderedEvent">{eventText(selectedEvent) || 'No rendered content.'}</div>
                ) : (
                  <pre className="rawEvent">{JSON.stringify(selectedEvent, null, 2)}</pre>
                )}
              </>
            ) : (
              <EmptyState icon={<MessageSquare size={22} />} title="Select an event" />
            )}
          </div>
        </div>
      </div>

      <form className="sessionComposer" onSubmit={(event) => void sendMessage(event)}>
        <textarea
          value={messageDraft}
          onChange={(event) => setMessageDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === 'Enter' && !event.shiftKey) {
              event.preventDefault();
              void sendMessage();
            }
          }}
          placeholder="Message this session..."
          aria-label="Message this session"
          disabled={sendingMessage || displayStatus === 'failed' || displayStatus === 'terminated'}
        />
        <button className="primaryButton" type="submit" disabled={!canSendMessage}>
          <Send size={16} />
          {sendingMessage ? 'Sending...' : 'Send'}
        </button>
        {messageError ? <div className="sessionComposerError">{messageError}</div> : null}
      </form>
    </section>
  );
}


function toggleSet<T>(value: T, checked: boolean, setter: Dispatch<SetStateAction<Set<T>>>) {
  setter((current) => {
    const next = new Set(current);
    if (checked) next.add(value);
    else next.delete(value);
    return next;
  });
}

function eventKind(event: SessionEvent): 'user' | 'agent' | 'tool' | 'error' | 'system' {
  if (event.type.startsWith('user.')) return 'user';
  if (event.type.startsWith('agent.')) return event.type.includes('tool') ? 'tool' : 'agent';
  if (event.type.includes('tool') || event.type.includes('mcp')) return 'tool';
  if (event.type.includes('error') || event.type.includes('failed')) return 'error';
  return 'system';
}

function eventLabel(event: SessionEvent, mode: 'transcript' | 'debug') {
  if (mode === 'debug') return truncateMiddle(event.type, 22);
  const kind = eventKind(event);
  return kind[0].toUpperCase() + kind.slice(1);
}

function eventTitle(event: SessionEvent) {
  const text = eventText(event);
  if (event.type === 'user.message') return text || 'User message';
  if (event.type === 'agent.message') return text || 'Agent message';
  if (event.type === 'user.interrupt') return 'Interrupted';
  if (event.type === 'session.error') return text || 'Session error';
  if (event.type.includes('model') && event.type.endsWith('start')) return 'Model request start';
  if (event.type.includes('model') && event.type.endsWith('end')) return text ? `Model request stop (${text})` : 'Model request stop';
  return titleCase(event.type.replaceAll('.', ' ').replaceAll('_', ' '));
}

function eventText(event: SessionEvent) {
  if (event.delta) return event.delta;
  const content = normalizeEventContent(event.content);
  if (content.length === 0) return '';
  return content.map((part) => {
    if (part && typeof part === 'object') {
      const record = part as Record<string, unknown>;
      if (typeof record.text === 'string') return record.text;
      if (typeof record.message === 'string') return record.message;
      if (typeof record.error === 'string') return record.error;
    }
    return typeof part === 'string' ? part : JSON.stringify(part);
  }).join('\n');
}

function normalizeEventContent(content: SessionEvent['content']): unknown[] {
  if (Array.isArray(content)) return content;
  if (content === null || content === undefined) return [];
  return [content];
}

function eventsAfter(events: SessionEvent[], previousLastEventId: string | null): SessionEvent[] {
  if (!previousLastEventId) return events;
  const index = events.findIndex((event) => event.id === previousLastEventId);
  return index >= 0 ? events.slice(index + 1) : events;
}

function sessionDisplayStatus(session: Session, events: SessionEvent[]): SessionDisplayStatus {
  if (session.status === 'failed' || hasErrorEvent(events)) return 'failed';
  if (session.status === 'terminated') return 'terminated';
  const lastStatus = [...events].reverse().find((event) => event.type.startsWith('session.status_'));
  if (!lastStatus) return session.status;
  if (lastStatus.type === 'session.status_running') return 'running';
  if (lastStatus.type === 'session.status_queued') return 'queued';
  if (lastStatus.type === 'session.status_idle') return 'idle';
  if (lastStatus.type === 'session.status_completed') return 'completed';
  if (lastStatus.type === 'session.status_terminated') return 'terminated';
  if (lastStatus.type === 'session.status_failed') return 'failed';
  return session.status;
}

function hasErrorEvent(events: SessionEvent[]) {
  return events.some((event) => eventKind(event) === 'error');
}

function eventTime(event: SessionEvent) {
  const value = event.processed_at ?? event.created_at;
  if (!value) return '-';
  return new Intl.DateTimeFormat(undefined, { hour: '2-digit', minute: '2-digit', second: '2-digit' }).format(new Date(value));
}
