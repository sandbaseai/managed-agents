import type { ReactNode } from 'react';
import { useEffect, useMemo, useState } from 'react';

export type OptionsJsonParseResult =
  | { ok: true; value: Record<string, unknown> }
  | { ok: false; message: string };

export function FieldError({ message }: { message?: string }) {
  return message ? <span className="fieldError" role="alert">{message}</span> : null;
}

export function FormField({
  label,
  description,
  error,
  children,
}: {
  label: string;
  description?: ReactNode;
  error?: string;
  children: ReactNode;
}) {
  return (
    <div className="formField">
      <div className="formFieldMeta">
        <span>{label}</span>
        {description ? <small>{description}</small> : null}
      </div>
      <div className="formFieldControl">
        {children}
        <FieldError message={error} />
      </div>
    </div>
  );
}

export function FormSection({ title, children }: { title: string; children: ReactNode }) {
  return (
    <section className="formSection">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export function InlineStatus({ tone = 'neutral', children }: { tone?: 'neutral' | 'error'; children: ReactNode }) {
  return <div className={`inlineStatus ${tone}`}>{children}</div>;
}

export function SegmentedControl<TValue extends string>({
  value,
  options,
  onChange,
}: {
  value: TValue;
  options: Array<{ value: TValue; label: string }>;
  onChange: (value: TValue) => void;
}) {
  return (
    <div className="segmentedControl">
      {options.map((option) => (
        <button
          type="button"
          className={value === option.value ? 'active' : ''}
          aria-pressed={value === option.value}
          onClick={() => onChange(option.value)}
          key={option.value}
        >
          {option.label}
        </button>
      ))}
    </div>
  );
}

export function FormActions({ children }: { children: ReactNode }) {
  return <div className="formActions">{children}</div>;
}

export function ActionNotice({ children }: { children: ReactNode }) {
  return <div className="noticeBox actionNotice">{children}</div>;
}

export function InfoRow({ children }: { children: ReactNode }) {
  return <div className="infoRow">{children}</div>;
}

export function BadgeList({ ariaLabel, children }: { ariaLabel?: string; children: ReactNode }) {
  return <div className="badgeList" aria-label={ariaLabel}>{children}</div>;
}

export function StatusBadge({
  tone,
  children,
}: {
  tone: 'pending' | 'adapter' | 'active' | 'error' | 'disabled';
  children: ReactNode;
}) {
  return <span className={`providerStateBadge ${tone}`}>{children}</span>;
}

export function ToggleSwitch({
  checked,
  onChange,
  onLabel = 'Enabled',
  offLabel = 'Disabled',
}: {
  checked: boolean;
  onChange: (checked: boolean) => void;
  onLabel?: string;
  offLabel?: string;
}) {
  return (
    <label className="toggleSwitch">
      <input
        type="checkbox"
        checked={checked}
        onChange={(event) => onChange(event.target.checked)}
      />
      <span className="toggleSwitchTrack" aria-hidden="true">
        <span className="toggleSwitchThumb" />
      </span>
      <span className="toggleSwitchLabel">{checked ? onLabel : offLabel}</span>
    </label>
  );
}

export function parseOptionsJsonDraft(value: string): OptionsJsonParseResult {
  try {
    const parsed = JSON.parse(value || '{}');
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      return { ok: false, message: 'Options must be a JSON object.' };
    }
    return { ok: true, value: parsed as Record<string, unknown> };
  } catch {
    return { ok: false, message: 'Options must be valid JSON.' };
  }
}

export function OptionsJsonField({
  label = 'Advanced JSON options',
  value,
  onChange,
  onInvalid,
  error,
  resetKey,
}: {
  label?: string;
  value: Record<string, unknown>;
  onChange: (value: Record<string, unknown>) => void;
  onInvalid?: () => void;
  error?: string;
  resetKey?: number;
}) {
  const serialized = useMemo(() => JSON.stringify(value, null, 2), [value]);
  const [draft, setDraft] = useState(serialized);
  const [localError, setLocalError] = useState('');

  useEffect(() => {
    if (!localError) setDraft(serialized);
  }, [serialized, localError]);

  useEffect(() => {
    setDraft(serialized);
    setLocalError('');
  }, [resetKey, serialized]);

  return (
    <details className="formAdvancedOptions">
      <summary>{label}</summary>
      <textarea
        className="formOptionsEditor"
        value={draft}
        onChange={(event) => {
          const next = event.target.value;
          setDraft(next);
          const parsed = parseOptionsJsonDraft(next);
          if (!parsed.ok) {
            setLocalError(parsed.message);
            onInvalid?.();
            return;
          }
          setLocalError('');
          onChange(parsed.value);
        }}
        onBlur={() => {
          if (!localError) setDraft(JSON.stringify(value, null, 2));
        }}
        spellCheck={false}
      />
      <FieldError message={localError || error} />
    </details>
  );
}
