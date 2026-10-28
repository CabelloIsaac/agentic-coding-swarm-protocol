/**
 * Self-tests of the parts of `audit.ts` added for detection latency and metric hygiene. Only `node:test` and
 * `node:assert`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { type Metrics, closureMetrics, countEscapes, countRules, detection, fixCounts, hotFiles, isMetricNoise, landActivity, renderTable } from '../scripts/audit.ts';
import type { Finding } from '../scripts/findings.ts';
import { commit, fixture } from './helpers.ts';

describe('audit: metric hygiene', () => {
  it('the playground and the audit script itself are noise, the product is not', () => {
    assert.ok(isMetricNoise('playground/x/try.ts', 'scripts/dev/audit.ts'));
    assert.ok(isMetricNoise('scripts/dev/audit.ts', 'scripts/dev/audit.ts'));
    assert.ok(!isMetricNoise('src/a.ts', 'scripts/dev/audit.ts'));
    // why it matters: the escape patterns match their own source
    assert.ok(countEscapes([{ file: 'audit.ts', text: "text.match(/@ts-ignore/g); const x: any = 1; // as any" }]).ts_ignore > 0);
  });
});

describe('audit: rules by marker', () => {
  it('counts enforced, preference and unmarked bullets under ## headings, joining continuation lines', () => {
    const md = [
      '# Rules',
      '- not a rule: no section yet',
      '## Work',
      '- One session = one worktree. (enforced: scripts/dev/land.ts)',
      '- Show the command',
      '  and its output. (preference)',
      '- Ask before spending.',
      '```',
      '- inside a fence (preference)',
      '```',
    ].join('\n');
    assert.deepEqual(countRules(md), { total: 3, enforced: 1, preference: 1, unmarked: 1 });
  });
});

describe('audit: detection latency', () => {
  it('latency from the introducing commit to the audit; median and escape rate over new findings only', () => {
    const dates: Record<string, string> = { a1: '2026-10-08T10:00:00+02:00', b2: '2026-10-20T09:00:00+02:00', c3: '2026-10-01T09:00:00+02:00' };
    const d = detection(
      [
        { id: 'AUD-a', severity: 'high', introduced: 'a1', detected: '2026-10-28', catchable_at_review: true },
        { id: 'AUD-b', severity: 'medium', introduced: 'b2', detected: '2026-10-28', catchable_at_review: false },
        { id: 'AUD-c', severity: 'low', introduced: 'unknown', detected: '2026-10-28', catchable_at_review: true },
        { id: 'AUD-old', severity: 'low', introduced: 'c3', detected: '2026-10-18', catchable_at_review: true },
      ],
      '2026-10-28',
      (sha) => dates[sha],
    );
    assert.equal(d.new, 3);
    assert.equal(d.findings[0]?.latency_days, 20);
    assert.equal(d.findings[1]?.latency_days, 8);
    assert.equal(d.findings[2]?.latency_days, undefined);
    assert.equal(d.median_latency_days, 14);
    assert.equal(d.escape_rate, 0.67);
  });
});

describe('audit: land log', () => {
  it('counts landed, conflict and review-bypassed entries since the previous snapshot, so bypasses reach the audit', () => {
    const lines = [
      JSON.stringify({ at: '2026-10-10T08:00:00Z', result: 'landed' }),
      JSON.stringify({ at: '2026-10-20T08:00:00Z', result: 'landed' }),
      JSON.stringify({ at: '2026-10-21T08:00:00Z', result: 'review-bypassed', reason: 'hotfix' }),
      JSON.stringify({ at: '2026-10-22T08:00:00Z', result: 'conflict' }),
      JSON.stringify({ at: '2026-10-22T08:30:00Z', result: 'findings-overridden', reason: 'incident' }),
      JSON.stringify({ at: '2026-10-22T09:00:00Z', result: 'failed' }),
      'not json',
    ];
    assert.deepEqual(landActivity(lines), { landed: 2, conflict: 1, review_bypassed: 1, findings_overridden: 1 });
    assert.deepEqual(landActivity(lines, '2026-10-20'), { landed: 1, conflict: 1, review_bypassed: 1, findings_overridden: 1, since: '2026-10-20' });
  });
});

const finding = (over: Partial<Finding>): Finding => ({ id: 'AUD-x', severity: 'medium', title: 't', file: 'f', source: 'audit', opened: '2026-10-01', sla_due: '2026-10-15', status: 'open', detected: '2026-10-01', ...over });

describe('audit: closure block', () => {
  const list = [
    finding({ id: 'AUD-1', severity: 'high', sla_due: '2026-10-05' }),
    finding({ id: 'AUD-2', opened: '2026-10-20', sla_due: '2026-11-03' }),
    finding({ id: 'AUD-3', status: 'closed', closed: '2026-10-25' }),
    finding({ id: 'AUD-4', status: 'accepted', closed: '2026-10-26' }),
  ];
  it('summarises the ledger and renders it first, with arrows against the previous snapshot', () => {
    const c = closureMetrics(list, '2026-10-28');
    assert.deepEqual(c.open, { high: 1, medium: 1, low: 0, total: 2 });
    assert.deepEqual([c.overdue, c.median_open_age_days, c.opened_14d, c.closed_14d, c.accepted], [1, 18, 1, 1, 1]);
    assert.equal(c.closure_ratio, 1);
    const m = { date: '2026-10-28', commit: 'abc', lint: { errors: 0, warnings: 0, infos: 0, rules: {} }, escapes: { any: 0, as_unknown_as: 0, ts_ignore: 0, ts_expect_error: 0, biome_ignore: 0, biome_ignore_without_reason: 0 }, big_files: { count: 0, top: [] }, todos: 0, specs: { active: 0, near_done: [], not_started: [], validate_errors: 0, validate_warnings: 0 }, env_undocumented: [], secret_hits: [], adr_drafts: [], coverage: { thresholds: {} }, closure: c, hot_files: [{ file: 'src/big.ts', fixes: 4, lines: 620 }], detection: { findings: [], new: 0 } } as Metrics;
    const prev = { ...m, date: '2026-10-14', closure: { ...c, overdue: 0, open: { ...c.open, total: 5 } } } as Metrics;
    const table = renderTable(m, prev);
    const rows = table.split('\n');
    assert.match(rows[2] ?? '', /Closure\*\* · open findings \| 2 \(1 high · 1 medium · 0 low\) \| ↓ -3/);
    assert.match(table, /Closure · overdue \(past SLA\) \| 1 \| ↑ \+1/);
    assert.match(table, /src\/big\.ts \| 4 fixes · 620 lines/);
    const at = (needle: string) => table.indexOf(needle);
    assert.ok(at('Closure · overdue') < at('Hot files') && at('Hot files') < at('Detection · new findings') && at('Detection · new findings') < at('Lint · errors'));
  });
});

describe('audit: hot files', () => {
  it('counts only commits whose subject starts with fix', () => {
    const log = '\x01fix: a\nsrc/a.ts\nsrc/b.ts\n\x01feat: b\nsrc/a.ts\n\x01Fix(x): c\nsrc/a.ts\n\x01fixture: not a fix\nsrc/a.ts\n';
    assert.deepEqual([...fixCounts(log)], [['src/a.ts', 2], ['src/b.ts', 1]]);
  });

  it('lists files with >= N fixes in the window that are over the size limit, from a real history', (t) => {
    const fx = fixture(t);
    const long = (n: number) => `${'x\n'.repeat(n)}`;
    commit(fx.main, 'feat: add files', { 'src/big.ts': long(30), 'src/small.ts': long(3), 'src/steady.ts': long(30), 'src/other.ts': long(30) });
    for (const n of [1, 2, 3]) commit(fx.main, `fix: round ${n}`, { 'src/big.ts': long(30 + n), 'src/small.ts': long(3 + n), 'src/other.ts': long(30 + n) });
    commit(fx.main, 'feat: touch steady', { 'src/steady.ts': long(31) });
    commit(fx.main, 'fix: only once', { 'src/steady.ts': long(32) });
    const opts = { fixes: 3, days: 30, max: 20 };
    assert.deepEqual(hotFiles(fx.main, opts), [
      { file: 'src/big.ts', fixes: 3, lines: 33 },
      { file: 'src/other.ts', fixes: 3, lines: 33 },
    ]);
    assert.deepEqual(hotFiles(fx.main, { ...opts, max: 100 }), [], 'under the limit is not hot');
    assert.deepEqual(hotFiles(fx.main, { ...opts, fixes: 4 }), []);
  });
});
