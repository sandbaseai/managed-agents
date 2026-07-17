import React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import { describe, expect, it } from 'vitest';
import { highlightJson, JsonCodeEditor } from '../../apps/console/src/components/CodeEditor';
import {
  ActionNotice,
  BadgeList,
  FormActions,
  FormField,
  FormSection,
  InfoRow,
  InlineStatus,
  parseOptionsJsonDraft,
  SegmentedControl,
  StatusBadge,
  ToggleSwitch,
} from '../../apps/console/src/components/FormPrimitives';

describe('Console UI primitives', () => {
  it('renders shared form field, section, status, segmented control, and actions classes', () => {
    const html = renderToStaticMarkup(
      <FormSection title="Runtime">
        <InlineStatus tone="error"><span>Problem</span></InlineStatus>
        <SegmentedControl value="json" options={[{ value: 'form', label: 'Form' }, { value: 'json', label: 'JSON' }]} onChange={() => {}} />
        <FormField label="Provider" description="Runtime provider" error="Required">
          <input value="local" readOnly />
        </FormField>
        <InfoRow><span>Database</span><StatusBadge tone="active">ok</StatusBadge></InfoRow>
        <BadgeList ariaLabel="Adapters"><StatusBadge tone="disabled">Docker: unavailable</StatusBadge></BadgeList>
        <ToggleSwitch checked onChange={() => {}} />
        <ActionNotice><span>Saved</span><button type="button">Restart</button></ActionNotice>
        <FormActions><button type="button">Save</button></FormActions>
      </FormSection>,
    );

    expect(html).toContain('class="formSection"');
    expect(html).toContain('class="inlineStatus error"');
    expect(html).toContain('class="segmentedControl"');
    expect(html).toContain('class="active"');
    expect(html).toContain('aria-pressed="true"');
    expect(html).toContain('aria-pressed="false"');
    expect(html).toContain('class="formField"');
    expect(html).toContain('class="infoRow"');
    expect(html).toContain('class="badgeList"');
    expect(html).toContain('aria-label="Adapters"');
    expect(html).toContain('class="providerStateBadge active"');
    expect(html).toContain('class="providerStateBadge disabled"');
    expect(html).toContain('class="toggleSwitch"');
    expect(html).toContain('class="toggleSwitchTrack"');
    expect(html).toContain('class="toggleSwitchThumb"');
    expect(html).toContain('class="toggleSwitchLabel"');
    expect(html).toContain('class="noticeBox actionNotice"');
    expect(html).toContain('class="formActions"');
    expect(html).toContain('role="alert"');
    expect(html).toContain('Required');
  });

  it('parses advanced JSON options only as objects', () => {
    expect(parseOptionsJsonDraft('')).toEqual({ ok: true, value: {} });
    expect(parseOptionsJsonDraft('{"timeout_seconds":300}')).toEqual({ ok: true, value: { timeout_seconds: 300 } });
    expect(parseOptionsJsonDraft('[]')).toEqual({ ok: false, message: 'Options must be a JSON object.' });
    expect(parseOptionsJsonDraft('{')).toEqual({ ok: false, message: 'Options must be valid JSON.' });
  });

  it('highlights JSON keys, strings, numbers, booleans, and nulls', () => {
    const html = renderToStaticMarkup(<>{highlightJson('{"provider":"local","enabled":true,"timeout":300,"note":null}')}</>);

    expect(html).toContain('class="jsonKey"');
    expect(html).toContain('class="jsonString"');
    expect(html).toContain('class="jsonBoolean"');
    expect(html).toContain('class="jsonNumber"');
    expect(html).toContain('class="jsonNull"');
  });

  it('renders JSON code editor with shared code editor classes', () => {
    const html = renderToStaticMarkup(<JsonCodeEditor value={'{"provider":"local"}'} onChange={() => {}} />);

    expect(html).toContain('class="codeEditorShell"');
    expect(html).toContain('class="codeEditorHighlight"');
    expect(html).toContain('class="codeEditorInput"');
    expect(html).toContain('spellCheck="false"');
  });
});
