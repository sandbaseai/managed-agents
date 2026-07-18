import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

const css = readFileSync(join(process.cwd(), 'apps/console/src/styles.css'), 'utf8');

describe('Console CSS contracts', () => {
  it('keeps Settings as a responsive two-pane layout that collapses on narrow screens', () => {
    expect(ruleFor('.settingsShell')).toContain('grid-template-columns: 232px minmax(0, 1fr)');
    expect(mediaRuleFor('max-width: 1080px', '.settingsShell')).toContain('grid-template-columns: 220px minmax(0, 1fr)');
    expect(mediaRuleFor('max-width: 760px', '.settingsShell')).toContain('grid-template-columns: 1fr');
    expect(mediaRuleFor('max-width: 760px', '.settingsNav')).toContain('flex-direction: row');
    expect(mediaRuleFor('max-width: 760px', '.settingsNav')).toContain('overflow-x: auto');
  });

  it('keeps the runtime log viewer large enough for operations debugging', () => {
    expect(ruleFor('.settingsLogsPage .runtimeLogPanel')).toContain('min-height: 520px');
    expect(ruleFor('.runtimeLogList')).toContain('height: clamp(520px, calc(100vh - 390px), 820px)');
    expect(ruleFor('.runtimeLogList')).toContain('min-height: 520px');
    expect(ruleFor('.runtimeLogList')).toContain('overflow: auto');
  });

  it('keeps API reference and form grids responsive instead of forcing horizontal scroll', () => {
    const mobile = mediaRuleFor('max-width: 760px', '.apiDocsShell');

    expect(ruleFor('.apiDocsShell')).toContain('grid-template-columns');
    expect(mobile).toContain('grid-template-columns: 1fr');
    expect(mediaRuleFor('max-width: 760px', '.formGrid')).toContain('grid-template-columns: 1fr');
    expect(mediaRuleFor('max-width: 760px', '.apiParamRow')).toContain('grid-template-columns: 1fr');
  });
});

function ruleFor(selector: string): string {
  const match = css.match(rulePattern(selector));
  expect(match, `Missing CSS rule for ${selector}`).toBeTruthy();
  return match?.[2] ?? '';
}

function mediaRuleFor(condition: string, selector: string): string {
  const mediaStart = css.indexOf(`@media (${condition})`);
  expect(mediaStart, `Missing @media (${condition})`).toBeGreaterThanOrEqual(0);
  const nextMedia = css.indexOf('@media ', mediaStart + 1);
  const block = css.slice(mediaStart, nextMedia === -1 ? undefined : nextMedia);
  const match = block.match(rulePattern(selector));
  expect(match, `Missing CSS rule for ${selector} inside @media (${condition})`).toBeTruthy();
  return match?.[2] ?? '';
}

function rulePattern(selector: string): RegExp {
  return new RegExp(`(^|})[^{}]*${escapeRegExp(selector)}[^{}]*\\{([^}]*)\\}`, 'm');
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}
