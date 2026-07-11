/**
 * Metrics (F3)
 *
 * A tiny in-process metrics registry: counters and histograms. Exposed in a
 * Prometheus-compatible text format at /v1/x/metrics. No external dependency.
 */

export class Metrics {
  private counters = new Map<string, { value: number; help: string }>();
  private histograms = new Map<string, { buckets: Map<number, number>; sum: number; count: number; help: string }>();

  private static readonly BUCKETS = [5, 10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000];

  counter(name: string, help = '', delta = 1): void {
    const c = this.counters.get(name) ?? { value: 0, help };
    c.value += delta;
    if (help) c.help = help;
    this.counters.set(name, c);
  }

  observe(name: string, valueMs: number, help = ''): void {
    let h = this.histograms.get(name);
    if (!h) {
      h = { buckets: new Map(Metrics.BUCKETS.map((b) => [b, 0])), sum: 0, count: 0, help };
      this.histograms.set(name, h);
    }
    if (help) h.help = help;
    h.sum += valueMs;
    h.count++;
    for (const b of Metrics.BUCKETS) {
      if (valueMs <= b) h.buckets.set(b, (h.buckets.get(b) ?? 0) + 1);
    }
  }

  /** Render in Prometheus text exposition format. */
  render(): string {
    const lines: string[] = [];
    for (const [name, c] of this.counters) {
      if (c.help) lines.push(`# HELP ${name} ${c.help}`);
      lines.push(`# TYPE ${name} counter`);
      lines.push(`${name} ${c.value}`);
    }
    for (const [name, h] of this.histograms) {
      if (h.help) lines.push(`# HELP ${name} ${h.help}`);
      lines.push(`# TYPE ${name} histogram`);
      let cumulative = 0;
      for (const b of Metrics.BUCKETS) {
        cumulative = h.buckets.get(b) ?? 0;
        lines.push(`${name}_bucket{le="${b}"} ${cumulative}`);
      }
      lines.push(`${name}_bucket{le="+Inf"} ${h.count}`);
      lines.push(`${name}_sum ${h.sum}`);
      lines.push(`${name}_count ${h.count}`);
    }
    return lines.join('\n') + '\n';
  }

  /** Snapshot as a plain object (for JSON/tests). */
  snapshot(): { counters: Record<string, number>; histograms: Record<string, { count: number; sum: number }> } {
    const counters: Record<string, number> = {};
    for (const [k, v] of this.counters) counters[k] = v.value;
    const histograms: Record<string, { count: number; sum: number }> = {};
    for (const [k, v] of this.histograms) histograms[k] = { count: v.count, sum: v.sum };
    return { counters, histograms };
  }
}
