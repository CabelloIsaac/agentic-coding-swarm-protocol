/**
 * Self-tests of the parts of `audit.ts` added for detection latency and metric hygiene. Only `node:test` and
 * `node:assert`.
 */
import assert from 'node:assert/strict';
import { describe, it } from 'node:test';
import { countEscapes, countRules, detection, isMetricNoise } from '../scripts/audit.ts';

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
