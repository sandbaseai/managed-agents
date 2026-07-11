/**
 * Unit tests for structured logging + metrics (F3).
 */

import { describe, it, expect } from 'vitest';
import { createLogger } from '@/core/observability/logger.js';
import { Metrics } from '@/core/observability/metrics.js';

describe('Logger', () => {
  it('emits JSON lines at or above the configured level', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', write: (l) => lines.push(l) });
    log.debug('should be filtered');
    log.info('hello', { a: 1 });
    log.error('boom');

    expect(lines).toHaveLength(2); // debug filtered out
    const first = JSON.parse(lines[0]);
    expect(first.level).toBe('info');
    expect(first.msg).toBe('hello');
    expect(first.a).toBe(1);
    expect(first.time).toBeTruthy();
  });

  it('child loggers merge bindings', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'debug', write: (l) => lines.push(l) }).child({ sessionId: 's1' });
    log.info('x');
    expect(JSON.parse(lines[0]).sessionId).toBe('s1');
  });

  it('pretty mode is human-readable', () => {
    const lines: string[] = [];
    const log = createLogger({ level: 'info', pretty: true, write: (l) => lines.push(l) });
    log.info('readable', { k: 'v' });
    expect(lines[0]).toContain('INFO readable');
    expect(lines[0]).toContain('"k":"v"');
  });
});

describe('Metrics', () => {
  it('counts and renders counters in Prometheus format', () => {
    const m = new Metrics();
    m.counter('http_requests_total', 'total', 1);
    m.counter('http_requests_total', '', 2);
    const out = m.render();
    expect(out).toContain('# TYPE http_requests_total counter');
    expect(out).toContain('http_requests_total 3');
  });

  it('observes histograms with buckets, sum, and count', () => {
    const m = new Metrics();
    m.observe('dur_ms', 30);
    m.observe('dur_ms', 700);
    const out = m.render();
    expect(out).toContain('# TYPE dur_ms histogram');
    expect(out).toContain('dur_ms_count 2');
    expect(out).toContain('dur_ms_sum 730');
    expect(out).toContain('dur_ms_bucket{le="+Inf"} 2');
  });

  it('snapshot returns plain values', () => {
    const m = new Metrics();
    m.counter('c', '', 5);
    m.observe('h', 100);
    const snap = m.snapshot();
    expect(snap.counters.c).toBe(5);
    expect(snap.histograms.h).toEqual({ count: 1, sum: 100 });
  });
});
