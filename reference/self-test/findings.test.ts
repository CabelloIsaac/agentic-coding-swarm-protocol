/**
 * The findings ledger: append-only history, SLA by severity, the `check` gate, stats and the commit-message parsing
 * `land` relies on. The CLI runs as a real subprocess inside a throw-away repository, with `--today` pinning the clock.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { DEFAULTS, addDays, closingIds, daysBetween, headline, isRefactor, loadFindings, newId, openFindings, overdue, parseLedger, stats } from '../scripts/findings.ts';
import { fixture } from './helpers.ts';

const LEDGER = 'docs/audits/findings.jsonl';
const TODAY = '2026-10-28';

describe('findings CLI', () => {
  test('add assigns AUD-<slug>, computes the SLA by severity and keeps ids unique', (t) => {
    const fx = fixture(t);
    const run = (...a: string[]) => fx.run('findings', [...a, '--today', TODAY], { cwd: fx.main });
    const high = run('add', '--severity', 'high', '--title', 'Open redirect on login', '--file', 'src/login.ts', '--line', '42', '--owner', 'ana', '--dc', 'DC-SEC-01');
    assert.equal(high.status, 0, high.out);
    assert.match(high.out, /added AUD-open-redirect-on-login \(high, due 2026-10-30\)/);
    run('add', '--severity', 'medium', '--title', 'Big file', '--file', 'a.ts');
    run('add', '--severity', 'low', '--title', 'Big file', '--file', 'b.ts', '--source', 'review');
    run('add', '--severity', 'low', '--id', 'AUD-mine', '--title', 'x', '--file', 'c.ts');
    const dup = run('add', '--severity', 'low', '--id', 'AUD-mine', '--title', 'x', '--file', 'c.ts');
    assert.equal(dup.status, 1);
    assert.match(dup.out, /already exists/);
    const list = loadFindings(join(fx.main, LEDGER));
    assert.deepEqual(list.map((f) => [f.id, f.sla_due]), [['AUD-open-redirect-on-login', '2026-10-30'], ['AUD-big-file', '2026-11-11'], ['AUD-big-file-2', '2026-12-27'], ['AUD-mine', '2026-12-27']]);
    assert.equal(list[0]?.dc, 'DC-SEC-01');
    assert.equal(list[2]?.source, 'review');
    assert.equal(run('add', '--severity', 'urgent', '--title', 't', '--file', 'f').status, 1);
  });

  test('close and accept append a new line with the same id (nothing is rewritten) and refuse a second change', (t) => {
    const fx = fixture(t);
    const run = (...a: string[]) => fx.run('findings', [...a, '--today', TODAY], { cwd: fx.main });
    run('add', '--severity', 'high', '--id', 'AUD-a', '--title', 'a', '--file', 'a.ts', '--owner', 'ana');
    run('add', '--severity', 'medium', '--id', 'AUD-b', '--title', 'b', '--file', 'b.ts');
    const before = readFileSync(join(fx.main, LEDGER), 'utf8');
    assert.equal(run('close', 'AUD-a', '--by', 'abc1234', '--reason', 'fixed').status, 0);
    assert.equal(run('accept', 'AUD-b').status, 1, 'accepting a risk needs a reason');
    assert.equal(run('accept', 'AUD-b', '--reason', 'replaced next quarter').status, 0);
    const text = readFileSync(join(fx.main, LEDGER), 'utf8');
    assert.ok(text.startsWith(before), 'earlier lines must stay byte for byte');
    assert.equal(text.trim().split('\n').length, 4);
    const [a, b] = loadFindings(join(fx.main, LEDGER));
    assert.deepEqual([a?.status, a?.closed_by, a?.closed, a?.owner], ['closed', 'abc1234', TODAY, 'ana']);
    assert.deepEqual([b?.status, b?.reason], ['accepted', 'replaced next quarter']);
    assert.match(run('close', 'AUD-a').out, /already closed/);
    assert.match(run('close', 'AUD-zzz').out, /no finding AUD-zzz/);
    assert.equal(run('assign', 'AUD-b', '--owner', 'bo').status, 0);
  });

  test('list filters; check fails only for an overdue HIGH, names it with the days, and warns for mediums', (t) => {
    const fx = fixture(t);
    const run = (...a: string[]) => fx.run('findings', [...a, '--today', TODAY], { cwd: fx.main });
    run('add', '--severity', 'high', '--id', 'AUD-late', '--title', 'late', '--file', 'a.ts', '--owner', 'ana', '--opened', '2026-10-20');
    run('add', '--severity', 'high', '--id', 'AUD-fresh', '--title', 'fresh', '--file', 'b.ts', '--opened', '2026-10-28');
    run('add', '--severity', 'medium', '--id', 'AUD-slow', '--title', 'slow', '--file', 'c.ts', '--opened', '2026-09-01');
    run('add', '--severity', 'low', '--id', 'AUD-done', '--title', 'done', '--file', 'd.ts');
    run('close', 'AUD-done');
    assert.deepEqual(run('list', '--overdue').stdout.trim().split('\n').map((l) => l.split(/\s+/)[0]), ['AUD-slow', 'AUD-late']);
    assert.match(run('list', '--open').stdout, /AUD-fresh/);
    assert.doesNotMatch(run('list', '--open').stdout, /AUD-done/);
    assert.match(run('list', '--closed').stdout, /AUD-done/);
    const check = run('check');
    assert.equal(check.status, 1, check.out);
    assert.match(check.out, /1 open HIGH past the SLA: AUD-late \(6 day\(s\) overdue, owner ana\)/);
    assert.match(check.out, /warning: 1 open MEDIUM past the SLA: AUD-slow/);
    run('close', 'AUD-late');
    const ok = run('check');
    assert.equal(ok.status, 0, ok.out);
    assert.match(ok.out, /warning: 1 open MEDIUM/, 'an overdue medium warns but does not fail');
  });

  test('stats: open by severity, median age, overdue, opened vs closed in the window, closure ratio', (t) => {
    const fx = fixture(t);
    const run = (...a: string[]) => fx.run('findings', [...a, '--today', TODAY], { cwd: fx.main });
    run('add', '--severity', 'high', '--id', 'AUD-1', '--title', '1', '--file', 'a', '--opened', '2026-10-18');
    run('add', '--severity', 'medium', '--id', 'AUD-2', '--title', '2', '--file', 'a', '--opened', '2026-10-24');
    run('add', '--severity', 'medium', '--id', 'AUD-3', '--title', '3', '--file', 'a', '--opened', '2026-10-26');
    run('add', '--severity', 'low', '--id', 'AUD-4', '--title', '4', '--file', 'a', '--opened', '2026-08-01');
    run('close', 'AUD-4');
    run('add', '--severity', 'low', '--id', 'AUD-5', '--title', '5', '--file', 'a', '--opened', '2026-10-27');
    run('accept', 'AUD-5', '--reason', 'fine');
    const s = stats(loadFindings(join(fx.main, LEDGER)), { today: TODAY, sinceDays: 14 });
    assert.deepEqual(s.open, { high: 1, medium: 2, low: 0, total: 3 });
    assert.equal(s.overdue, 1);
    assert.equal(s.median_open_age_days, 4);
    assert.equal(s.opened_in_window, 4);
    assert.equal(s.closed_in_window, 1);
    assert.equal(s.closure_ratio, 0.25);
    assert.equal(s.accepted, 1);
    assert.equal(headline(s), 'open 3 · overdue 1 · median age 4d · closure 0.25');
    const cli = run('stats', '--since', '14');
    assert.equal(cli.status, 0, cli.out);
    assert.match(cli.out, /open: 1 high · 2 medium · 0 low \(3\)/);
    assert.match(cli.out, /closure ratio 0\.25/);
  });

  test('a malformed ledger line is an error that names the line', (t) => {
    const fx = fixture(t, { files: { [LEDGER]: '{"id":"AUD-a"}\n' } });
    const r = fx.run('findings', ['check'], { cwd: fx.main });
    assert.equal(r.status, 1);
    assert.match(r.out, /findings\.jsonl:1: severity must be/);
    assert.throws(() => parseLedger('not json', 'x'), /x:1: not valid JSON/);
  });
});

describe('findings library', () => {
  test('dates, ids and the defaults', () => {
    assert.equal(addDays('2026-02-27', 3), '2026-03-02');
    assert.equal(daysBetween('2026-10-20', '2026-10-28'), 8);
    assert.equal(newId('Óscar: the thing!!', ['AUD-oscar-the-thing']), 'AUD-oscar-the-thing-2');
    assert.deepEqual(DEFAULTS.sla, { high: 2, medium: 14, low: 60 });
    assert.equal(DEFAULTS.closureEvery, 3);
  });

  test('overdue and openFindings ignore closed and accepted findings', () => {
    const base = { title: 't', file: 'f', source: 'audit' as const, opened: '2026-01-01', detected: '2026-01-01', sla_due: '2026-01-03' };
    const list = [
      { ...base, id: 'a', severity: 'high' as const, status: 'open' as const },
      { ...base, id: 'b', severity: 'high' as const, status: 'accepted' as const },
      { ...base, id: 'c', severity: 'high' as const, status: 'closed' as const },
    ];
    assert.deepEqual(overdue(list, '2026-10-28').map((f) => f.id), ['a']);
    assert.equal(openFindings(list).length, 1);
    assert.deepEqual(overdue(list, '2026-01-03'), [], 'due today is not overdue yet');
  });

  test('closingIds reads Closes trailers and fix(AUD-x) subjects; refactor subjects are recognised', () => {
    assert.deepEqual(closingIds({ subject: 'fix: x', body: 'why\n\nCloses: AUD-a, AUD-b\nAssumption: y' }), ['AUD-a', 'AUD-b']);
    assert.deepEqual(closingIds({ subject: 'fix(AUD-c): patch', body: '' }), ['AUD-c']);
    assert.deepEqual(closingIds({ subject: 'feat: x', body: 'Closes: #12' }), []);
    assert.deepEqual(closingIds({ subject: 'feat: x', body: 'mentions Closes: nothing' }), []);
    assert.ok(isRefactor('refactor: split the handler') && isRefactor('refactor(api): x') && !isRefactor('feat: refactor later'));
  });
});
