/**
 * Review receipts and the land review gate (INTEGRATION.md L2.7): the receipt is keyed by the change's stable patch id,
 * survives land's own rebase, and land refuses a change the review mode covers unless a passing receipt exists.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import type { ReviewConfig } from '../scripts/dev-flow.config.ts';
import { globToRegExp, loadReviewConfig, patchId, receiptsDir, reportPath, reviewGate, writeReceipt } from '../scripts/review-receipt.ts';
import { BRANCH, LAND_VERIFY, REPORT_TEXT, commit, fixture, git, reportFile, sha } from './helpers.ts';

const SENSITIVE: ReviewConfig = { mode: 'sensitive', sensitive: ['**/auth/**', 'swarm.json', '*.sql'] };
const ALWAYS: ReviewConfig = { ...SENSITIVE, mode: 'always' };
const OFF: ReviewConfig = { ...SENSITIVE, mode: 'off' };
const verifyOk = { [LAND_VERIFY]: 'true' };

describe('review receipt', () => {
  test('the patch id is stable across a clean rebase and changes with the content', (t) => {
    const fx = fixture(t, { files: { 'src/a.ts': 'export const a = 1;\n', 'src/b.ts': 'export const b = 1;\n' } });
    const head1 = commit(fx.wt, 'feat: a', { 'src/a.ts': 'export const a = 2;\n' });
    const before = patchId(fx.wt, BRANCH);
    assert.ok(before);
    commit(fx.main, 'feat: b on main', { 'src/b.ts': 'export const b = 2;\n' });
    git(fx.wt, 'rebase', '-q', BRANCH);
    assert.notEqual(sha(fx.wt), head1, 'the rebase must create a new commit');
    assert.equal(patchId(fx.wt, BRANCH), before, 'a clean rebase keeps the patch id');
    commit(fx.wt, 'fix: a again', { 'src/a.ts': 'export const a = 3;\n' });
    assert.notEqual(patchId(fx.wt, BRANCH), before, 'any further edit needs a new review');
  });

  test('globs: ** spans folders, a pattern without / matches the basename anywhere', () => {
    assert.ok(globToRegExp('**/auth/**').test('auth/login.ts'));
    assert.ok(globToRegExp('**/auth/**').test('src/auth/deep/login.ts'));
    assert.ok(!globToRegExp('**/auth/**').test('src/author.ts'));
    assert.ok(globToRegExp('*.sql').test('db/migrations/0001.sql'));
    assert.ok(globToRegExp('.github/**').test('.github/workflows/ci.yml'));
    assert.ok(!globToRegExp('.github/**').test('docs/.github.md'));
    assert.ok(globToRegExp('swarm.json').test('swarm.json'));
  });

  test('sensitive mode: an ordinary change needs no receipt; a sensitive one is blocked until a passing receipt exists', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: plain', { 'src/plain.ts': 'export {};\n' });
    const plain = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(plain.ok, true);
    assert.equal(plain.required, false);

    commit(fx.wt, 'feat: login', { 'src/auth/login.ts': 'export {};\n' });
    const missing = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(missing.ok, false);
    assert.equal(missing.required, true);
    assert.deepEqual(missing.matched, ['src/auth/login.ts']);
    assert.match(missing.message, /run \/swarm:review \(no receipt for this change/);

    const r = writeReceipt(fx.wt, BRANCH, { report: reportFile(fx), reviewers: ['reviewer', 'security-reviewer'], verdict: 'pass', openHigh: 0 });
    assert.ok(existsSync(join(receiptsDir(fx.wt), `${r.patch_id}.json`)));
    assert.equal(r.head, sha(fx.wt));
    assert.equal(r.base, sha(fx.main, BRANCH));
    const passed = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(passed.ok, true, passed.message);
    assert.equal(passed.required, true);
  });

  test('a changes_requested receipt blocks, and a pass with open highs cannot be written', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: login', { 'src/auth/login.ts': 'export {};\n' });
    assert.throws(() => writeReceipt(fx.wt, BRANCH, { report: reportFile(fx), reviewers: ['reviewer'], verdict: 'pass', openHigh: 1 }), /no open high/);
    writeReceipt(fx.wt, BRANCH, { report: reportFile(fx), reviewers: ['reviewer'], verdict: 'changes_requested', openHigh: 2 });
    const g = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(g.ok, false);
    assert.match(g.message, /changes_requested with 2 open high/);
  });

  test('always mode requires a receipt for any change; off mode never does', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'docs: typo', { 'docs/readme.md': 'fixed\n' });
    assert.equal(reviewGate(fx.wt, BRANCH, ALWAYS).ok, false);
    assert.equal(reviewGate(fx.wt, BRANCH, OFF).ok, true);
    writeReceipt(fx.wt, BRANCH, { report: reportFile(fx), reviewers: ['reviewer'], verdict: 'pass', openHigh: 0 });
    assert.equal(reviewGate(fx.wt, BRANCH, ALWAYS).ok, true);
  });

  test('the mode is read from swarm.json on the integration branch: a branch cannot switch off its own review', (t) => {
    const fx = fixture(t, { files: { 'swarm.json': JSON.stringify({ protocol: 'swarm', review: { mode: 'always', sensitive: [] } }) } });
    git(fx.wt, 'rebase', '-q', BRANCH);
    commit(fx.wt, 'chore: relax review', { 'swarm.json': JSON.stringify({ protocol: 'swarm', review: { mode: 'off' } }), 'src/x.ts': 'export {};\n' });
    const cfg = loadReviewConfig(fx.wt, BRANCH, SENSITIVE);
    assert.equal(cfg.mode, 'always');
    assert.equal(reviewGate(fx.wt, BRANCH, cfg).ok, false);
  });
});

describe('review config source', () => {
  test('a local integration branch that relaxes swarm.json does not relax the gate while the remote one is strict', (t) => {
    const strict = JSON.stringify({ protocol: 'swarm', review: { mode: 'always', sensitive: [] } });
    const fx = fixture(t, { files: { 'swarm.json': strict } });
    // A direct commit on the local integration branch, never published
    commit(fx.main, 'chore: relax review locally', { 'swarm.json': JSON.stringify({ protocol: 'swarm', review: { mode: 'off' } }) });
    assert.equal(git(fx.main, 'show', `${BRANCH}:swarm.json`).includes('"off"'), true);
    commit(fx.wt, 'feat: x', { 'src/x.ts': 'export {};\n' });
    const cfg = loadReviewConfig(fx.wt, BRANCH, SENSITIVE);
    assert.equal(cfg.mode, 'always');
    assert.equal(reviewGate(fx.wt, BRANCH, cfg).ok, false);
    // Without a remote ref the local branch is the only source
    assert.equal(loadReviewConfig(fx.wt, BRANCH, SENSITIVE, 'no-such-remote').mode, 'off');
  });
});

describe('review report', () => {
  test('write refuses a missing or tiny report and stores its hash; check refuses a missing or edited one', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: login', { 'src/auth/login.ts': 'export {};\n' });
    const opts = { reviewers: ['reviewer'], verdict: 'pass' as const, openHigh: 0 };
    assert.throws(() => writeReceipt(fx.wt, BRANCH, { ...opts, report: join(fx.base, 'nope.md') }), /does not exist/);
    assert.throws(() => writeReceipt(fx.wt, BRANCH, { ...opts, report: reportFile(fx, 'all good\n', 'tiny.md') }), /min 200/);
    const none = fx.run('review-receipt', ['write', '--reviewers', 'reviewer']);
    assert.equal(none.status, 1, 'the CLI looks for <patch_id>.md when --report is not given');
    assert.match(none.out, /does not exist/);

    const r = writeReceipt(fx.wt, BRANCH, { ...opts, report: reportFile(fx) });
    assert.equal(r.report_bytes, Buffer.byteLength(REPORT_TEXT));
    assert.equal(r.report_sha256?.length, 64);
    assert.equal(readFileSync(reportPath(fx.wt, r.patch_id), 'utf8'), REPORT_TEXT, 'the report is copied next to the receipt');
    assert.equal(reviewGate(fx.wt, BRANCH, SENSITIVE).ok, true);

    // Same size, different content: only the hash can tell
    writeFileSync(reportPath(fx.wt, r.patch_id), REPORT_TEXT.replace('READY', 'FAKE!'));
    const altered = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(altered.ok, false);
    assert.match(altered.message, /altered after the receipt was written/);

    writeFileSync(reportPath(fx.wt, r.patch_id), REPORT_TEXT);
    assert.equal(reviewGate(fx.wt, BRANCH, SENSITIVE).ok, true);
    rmSync(reportPath(fx.wt, r.patch_id));
    assert.match(reviewGate(fx.wt, BRANCH, SENSITIVE).message, /report .* is missing/);
  });

  test('a hand-written receipt without report fields (the old format) does not pass', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: login', { 'src/auth/login.ts': 'export {};\n' });
    const id = patchId(fx.wt, BRANCH) as string;
    mkdirSync(receiptsDir(fx.wt), { recursive: true });
    writeFileSync(
      join(receiptsDir(fx.wt), `${id}.json`),
      JSON.stringify({ patch_id: id, base: sha(fx.main, BRANCH), head: sha(fx.wt), reviewers: ['reviewer'], verdict: 'pass', open_high: 0, at: new Date().toISOString() }),
    );
    const g = reviewGate(fx.wt, BRANCH, SENSITIVE);
    assert.equal(g.ok, false);
    assert.match(g.message, /names no review report/);
  });
});

describe('land review gate', () => {
  test('a sensitive change without a receipt never lands; with one it lands after land rebases it', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: login', { 'src/auth/login.ts': 'export const login = 1;\n' });
    const before = sha(fx.main, BRANCH);

    const refused = fx.run('land', [], { env: verifyOk });
    assert.notEqual(refused.status, 0);
    assert.match(refused.out, /run \/swarm:review \(no receipt for this change/);
    assert.equal(sha(fx.main, BRANCH), before, 'main moved without a review');

    const written = fx.run('review-receipt', ['write', '--report', reportFile(fx), '--reviewers', 'reviewer,security-reviewer']);
    assert.equal(written.status, 0, written.out);
    assert.equal(fx.run('review-receipt', ['check']).status, 0);
    // The integration branch moves after the review: land's rebase must not invalidate the receipt
    commit(fx.main, 'feat: unrelated', { 'src/other.ts': 'export {};\n' });

    const landed = fx.run('land', [], { env: verifyOk });
    assert.equal(landed.status, 0, landed.out);
    assert.match(landed.out, /review receipt [0-9a-f]{12} ✓/);
    assert.equal(git(fx.main, 'log', '-1', '--format=%s', BRANCH), 'feat: login');
  });

  test('--no-review needs a reason, and the bypass is written to the land log', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: migration', { 'db/0001.sql': 'select 1;\n' });
    const noReason = fx.run('land', ['--no-review', ''], { env: verifyOk });
    assert.notEqual(noReason.status, 0);
    assert.match(noReason.out, /--no-review needs a reason/);

    const r = fx.run('land', ['--no-review', 'hotfix approved by the tech lead'], { env: verifyOk });
    assert.equal(r.status, 0, r.out);
    const bypass = fx.landLog().find((e) => e.result === 'review-bypassed');
    assert.equal(bypass?.reason, 'hotfix approved by the tech lead');
  });
});
