/**
 * Self-tests of `deps-audit.ts`: the report shapes it reads, the allowlist rules, and the CLI against a fake audit
 * command (a script that prints canned JSON) in a throw-away repo. Only `node:test` and `node:assert`.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import { type Allowlist, evaluate, parseAudit } from '../scripts/deps-audit.ts';
import { type Fixture, fixture, write } from './helpers.ts';

const HIGH = { vulnerabilities: [{ id: 'GHSA-aaaa-bbbb-cccc', severity: 'high', package: 'lodash', title: 'Prototype pollution', range: '<4.17.21' }] };
const MODERATE = { vulnerabilities: [{ id: 'GHSA-dddd-eeee-ffff', severity: 'moderate', package: 'left-pad', title: 'Slow regex' }] };
const FUTURE = '2999-12-31';
const PAST = '2020-01-01';

/** A fake audit: `audit.cjs` prints `report` and exits 1 like real tools do when they find something. */
function fakeAudit(fx: Fixture, report: unknown, extra: Record<string, unknown> = {}): void {
  write(fx.wt, 'audit.cjs', `console.log(${JSON.stringify(JSON.stringify(report))}); process.exit(1);\n`);
  fx.setConfig({ deps: { command: 'node audit.cjs', ...extra } });
}

const allow = (key: string, expires: string, owner = 'toni', reason = 'no fix released yet') => join(JSON.stringify({ [key]: { reason, expires, owner } }));

describe('deps-audit: report shapes', () => {
  it('reads the generic shape', () => {
    const [a] = parseAudit(JSON.stringify(HIGH));
    assert.deepEqual(a, { ids: ['GHSA-aaaa-bbbb-cccc'], severity: 'high', package: 'lodash', range: '<4.17.21', title: 'Prototype pollution' });
  });

  it('reads pnpm (advisories keyed by id)', () => {
    const report = { advisories: { 1096: { id: 1096, module_name: 'minimist', severity: 'critical', title: 'Prototype Pollution', vulnerable_versions: '<1.2.6', github_advisory_id: 'GHSA-xvch-5gv4-984h', cves: ['CVE-2021-44906'] } }, metadata: {} };
    const [a] = parseAudit(`warning banner\n${JSON.stringify(report)}`);
    assert.equal(a?.ids[0], 'GHSA-xvch-5gv4-984h');
    assert.deepEqual(a?.ids.slice(1), ['CVE-2021-44906', '1096']);
    assert.equal(a?.severity, 'critical');
    assert.equal(a?.package, 'minimist');
  });

  it('reads npm 7+ (only the `via` entries that are advisories, not the names of carriers)', () => {
    const report = { vulnerabilities: { semver: { name: 'semver', severity: 'high', via: [{ source: 1, name: 'semver', title: 'ReDoS', url: 'https://github.com/advisories/GHSA-c2qf-rxjj-qqgw', severity: 'high', range: '<5.7.2' }] }, carrier: { name: 'carrier', severity: 'high', via: ['semver'] } }, metadata: {} };
    const found = parseAudit(JSON.stringify(report));
    assert.equal(found.length, 1);
    assert.deepEqual(found[0]?.ids, ['GHSA-c2qf-rxjj-qqgw', '1']);
  });

  it('reads pip-audit and cargo-audit, whose advisories have no severity (unknown, treated as high)', () => {
    const pip = parseAudit(JSON.stringify({ dependencies: [{ name: 'flask', version: '1.0', vulns: [{ id: 'PYSEC-2023-62', aliases: ['CVE-2023-30861'], description: 'cookie' }] }, { name: 'ok', version: '1', vulns: [] }] }));
    assert.equal(pip.length, 1);
    assert.equal(pip[0]?.severity, 'unknown');
    const cargo = parseAudit(JSON.stringify({ vulnerabilities: { found: true, list: [{ advisory: { id: 'RUSTSEC-2020-0071', title: 'time' }, package: { name: 'time', version: '0.1' } }] } }));
    assert.equal(cargo[0]?.package, 'time');
    assert.equal(evaluate([...pip, ...cargo], {}, ['critical', 'high'], '2026-01-01').blocking.length, 2);
  });

  it('a clean report parses to nothing; text that is not a report throws', () => {
    assert.deepEqual(parseAudit('{"vulnerabilities":{},"metadata":{"vulnerabilities":{"total":0}}}'), []);
    assert.throws(() => parseAudit('no json here'), /printed no JSON/);
    assert.throws(() => parseAudit('{"something":1}'), /unrecognized audit report/);
  });
});

describe('deps-audit: the allowlist', () => {
  const [high] = parseAudit(JSON.stringify(HIGH));
  const ok = { reason: 'no fix yet', owner: 'toni', expires: FUTURE };

  it('only the configured severities block', () => {
    const moderate = parseAudit(JSON.stringify(MODERATE));
    assert.equal(evaluate(moderate, {}, ['critical', 'high'], '2026-01-01').blocking.length, 0);
    assert.equal(evaluate(moderate, {}, ['critical', 'high', 'moderate'], '2026-01-01').blocking.length, 1);
  });

  it('an entry by id, by alias, or by package@range covers it; `package@*` covers any range', () => {
    for (const key of ['GHSA-aaaa-bbbb-cccc', 'lodash@<4.17.21', 'lodash@*']) {
      const ev = evaluate(high ? [high] : [], { [key]: ok } as Allowlist, ['high'], '2026-01-01');
      assert.equal(ev.blocking.length, 0, key);
      assert.equal(ev.allowed.length, 1, key);
    }
    assert.equal(evaluate(high ? [high] : [], { 'lodash@<1.0.0': ok }, ['high'], '2026-01-01').blocking.length, 1, 'another range does not cover it');
  });

  it('an expired entry blocks ("allowlist entry expired"), valid through its last day; a malformed one blocks too', () => {
    const list = (expires: string): Allowlist => ({ 'GHSA-aaaa-bbbb-cccc': { ...ok, expires } });
    assert.match(evaluate(high ? [high] : [], list('2026-01-01'), ['high'], '2026-01-02').blocking[0]?.why ?? '', /allowlist entry expired 2026-01-01/);
    assert.equal(evaluate(high ? [high] : [], list('2026-01-02'), ['high'], '2026-01-02').blocking.length, 0);
    const bad = evaluate(high ? [high] : [], { 'GHSA-aaaa-bbbb-cccc': { reason: '', owner: 'x', expires: 'soon' } }, ['high'], '2026-01-02');
    assert.match(bad.blocking[0]?.why ?? '', /allowlist entry invalid/);
  });

  it('an entry that covers nothing is a note, and `_`-keys are ignored', () => {
    const ev = evaluate([], { 'GHSA-gone': ok, _example: ok as AllowEntryLike }, ['high'], '2026-01-01');
    assert.deepEqual(ev.notes, ['allowlist entry GHSA-gone matches no blocking advisory: remove it']);
  });
});
type AllowEntryLike = { reason: string; owner: string; expires: string };

describe('deps-audit: CLI with a fake audit command', () => {
  it('clean: exit 0', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, { vulnerabilities: [] });
    const r = fx.run('deps-audit');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /✓ deps: 0 advisories, none blocking/);
  });

  it('a high advisory: exit 1, one line naming id, package, range and title', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, HIGH);
    const r = fx.run('deps-audit');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /✗ deps: high GHSA-aaaa-bbbb-cccc lodash <4\.17\.21: Prototype pollution \[no allowlist entry\]/);
    assert.match(r.out, /✗ deps: 1 blocking advisory/);
  });

  it('failOn is configurable', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, MODERATE);
    assert.equal(fx.run('deps-audit').status, 0);
    fx.setConfig({ deps: { failOn: ['critical', 'high', 'moderate'] } });
    assert.equal(fx.run('deps-audit').status, 1);
  });

  it('allowlisted with a valid entry: exit 0 and the entry is shown with its owner and expiry', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, HIGH);
    write(fx.wt, 'deps-allowlist.json', allow('GHSA-aaaa-bbbb-cccc', FUTURE));
    const r = fx.run('deps-audit');
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /allowed GHSA-aaaa-bbbb-cccc until 2999-12-31 \(owner toni\): no fix released yet/);
  });

  it('an expired allowlist entry fails with "allowlist entry expired"', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, HIGH);
    write(fx.wt, 'deps-allowlist.json', allow('GHSA-aaaa-bbbb-cccc', PAST));
    const r = fx.run('deps-audit');
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /allowlist entry expired 2020-01-01/);
  });

  it('--json prints one document; a command that prints no JSON fails (an audit that did not run is not clean)', (t) => {
    const fx = fixture(t);
    fakeAudit(fx, HIGH);
    const r = fx.run('deps-audit', ['--json']);
    assert.equal(r.status, 1);
    const doc = JSON.parse(r.stdout) as { ok: boolean; blocking: { package: string; why: string }[] };
    assert.equal(doc.ok, false);
    assert.equal(doc.blocking[0]?.package, 'lodash');

    writeFileSync(join(fx.wt, 'audit.cjs'), 'console.error("ENOTFOUND registry"); process.exit(1);\n');
    const offline = fx.run('deps-audit');
    assert.equal(offline.status, 1);
    assert.match(offline.out, /printed no JSON .*ENOTFOUND registry.*did not run/);
  });
});
