import { ReactNode } from 'react';
import { RefreshCw, Search } from 'lucide-react';

export function Toolbar({ query, onQuery, placeholder, actions }: { query: string; onQuery: (value: string) => void; placeholder: string; actions: ReactNode }) {
  return (
    <div className="toolbar">
      <div className="searchBox">
        <Search size={17} />
        <input value={query} onChange={(event) => onQuery(event.target.value)} placeholder={placeholder} />
      </div>
      <div className="toolbarActions">{actions}</div>
    </div>
  );
}

export function SummaryStrip({ items }: { items: Array<{ label: string; value: ReactNode; icon: ReactNode }> }) {
  return (
    <div className="summaryStrip">
      {items.map((item) => (
        <div className="summaryItem" key={item.label}>
          <span>{item.icon}</span>
          <div>
            <small>{item.label}</small>
            <strong>{item.value}</strong>
          </div>
        </div>
      ))}
    </div>
  );
}

export function KeyValuePanel({ rows }: { rows: Array<[string, ReactNode]> }) {
  return (
    <div className="tablePanel kv">
      {rows.map(([key, value]) => (
        <div className="kvRow" key={key}>
          <span>{key}</span>
          <strong>{value || 'not configured'}</strong>
        </div>
      ))}
    </div>
  );
}

export function EmptyState({ icon, title, body, action }: { icon: ReactNode; title: string; body?: ReactNode; action?: ReactNode }) {
  return (
    <div className="emptyState">
      {icon}
      <strong>{title}</strong>
      {body ? <span>{body}</span> : null}
      {action ? <div className="emptyStateAction">{action}</div> : null}
    </div>
  );
}

export function LoadingState() {
  return <div className="loading"><RefreshCw size={18} />Loading console</div>;
}

export function StatusPill({ status }: { status: string }) {
  return <span className={`status ${status}`}>{status}</span>;
}

export function RequiredMark() {
  return <span className="requiredMark">*</span>;
}

export function ResourceBadge({ icon, label, children }: { icon?: ReactNode; label?: ReactNode; children?: ReactNode }) {
  return (
    <span className="resourceBadge">
      {icon ? icon : null}
      <span>{label ?? children}</span>
    </span>
  );
}
