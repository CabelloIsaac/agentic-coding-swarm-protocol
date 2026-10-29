/**
 * `overlap`: early detection of session branches that touch the same files, predicted textual conflicts
 * (`git merge-tree`) and branches the integration branch moved under. Read-only, never blocks, and its hook notice only
 * speaks when something changed.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BRANCH, SCRIPTS, commit, fixture, git, sha, write } from './helpers.ts';

type Fx = ReturnType<typeof fixture>;

const TEN = Array.from({ length: 10 }, (_, i) => `line ${i + 1}`).join('\n');
const edit = (n: number, text: string) => TEN.replace(`line ${n}\n`, `${text}\n`);

/** The fixture plus a second session worktree on branch `other`. */
function twoSessions(t: Parameters<typeof fixture>[0], config: Record<string, unknown> = {}) {
  const fx = fixture(t, { files: { 'src/billing/invoice.ts': `${TEN}\n`, 'src/export/csv.ts': 'export {};\n' }, config });
  const other = join(fx.base, 'other');
  git(fx.main, 'worktree', 'add', '-q', '-b', 'other', other, BRANCH);
  return { fx, other };
}

/** Runs `overlap --notify` the way the PostToolUse hook does: hook JSON on stdin. */
function notify(fx: Fx, file: string, cwd = fx.base): { status: number | null; out: string } {
  const input = JSON.stringify({ hook_event_name: 'PostToolUse', cwd, tool_name: 'Edit', tool_input: { file_path: file } });
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'overlap.ts'), '--notify'], {
    cwd,
    input,
    encoding: 'utf8',
    env: { ...process.env, DEV_FLOW_CONFIG: fx.configPath },
  });
  return { status: r.status, out: `${r.stdout}${r.stderr}` };
}

const report = (fx: Fx, args: string[] = [], cwd = fx.wt) => JSON.parse(fx.run('overlap', ['--json', ...args], { cwd }).stdout) as {
  branches: { branch: string; files: string[] }[];
  pairs: { a: string; b: string; shared: string[]; conflicts?: string[] }[];
  behind: { branch: string; behind: number; files: string[]; conflicts?: string[] }[];
  conflictPrediction: boolean;
};

describe('overlap report', () => {
  test('branches that touch different files do not overlap; a branch with no work is not active', (t) => {
    const { fx, other } = twoSessions(t);
    commit(fx.wt, 'feat: invoice', { 'src/billing/invoice.ts': edit(1, 'changed') });
    const r = report(fx, ['--all']);
    assert.deepEqual(r.branches.map((b) => b.branch), ['feature'], 'other has no commits and a clean tree');
    commit(other, 'feat: csv', { 'src/export/csv.ts': 'export const csv = 1;\n' });
    const both = report(fx, ['--all']);
    assert.deepEqual(both.branches.map((b) => b.branch).sort(), ['feature', 'other']);
    assert.deepEqual(both.pairs, []);
    assert.deepEqual(both.behind, []);
    assert.equal(both.conflictPrediction, true);
  });

  test('same file, different lines: shared, and git merges it cleanly', (t) => {
    const { fx, other } = twoSessions(t);
    commit(fx.wt, 'feat: top', { 'src/billing/invoice.ts': edit(1, 'top') });
    commit(other, 'feat: bottom', { 'src/billing/invoice.ts': edit(10, 'bottom') });
    const r = report(fx);
    assert.deepEqual(r.pairs, [{ a: 'feature', b: 'other', shared: ['src/billing/invoice.ts'], conflicts: [] }]);
    const text = fx.run('overlap').stdout;
    assert.match(text, /⚠ feature ↔ other: both touch src\/billing\/invoice\.ts \(git merges them cleanly/);
    assert.equal(fx.run('overlap', ['--strict']).status, 0, 'a clean shared file is not a predicted conflict');
  });

  test('same lines: the conflict is predicted without touching either working tree', (t) => {
    const { fx, other } = twoSessions(t);
    const mine = commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    const theirs = commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(1, 'theirs'), 'src/export/csv.ts': 'x\n' });
    const r = report(fx);
    assert.deepEqual(r.pairs[0]?.conflicts, ['src/billing/invoice.ts']);
    const run = fx.run('overlap', ['--strict']);
    assert.equal(run.status, 1);
    assert.match(run.stdout, /✗ feature ↔ other: conflict predicted in src\/billing\/invoice\.ts/);
    // Read-only: no branch moved, no tree changed
    assert.equal(sha(fx.wt), mine);
    assert.equal(sha(other), theirs);
    assert.equal(git(fx.wt, 'status', '--porcelain'), '');
    assert.equal(git(other, 'status', '--porcelain'), '');
  });

  test('uncommitted edits count as touching a file', (t) => {
    const { fx, other } = twoSessions(t);
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    write(other, 'src/billing/invoice.ts', edit(5, 'dirty'));
    const r = report(fx);
    assert.deepEqual(r.pairs.map((p) => [p.a, p.b, p.shared]), [['feature', 'other', ['src/billing/invoice.ts']]]);
  });

  test('generated files never count as overlap', (t) => {
    const { fx, other } = twoSessions(t, {});
    commit(fx.wt, 'chore: dev server rewrote it', { 'apps/web/tsconfig.json': '{"a":1}\n' });
    commit(other, 'chore: dev server rewrote it', { 'apps/web/tsconfig.json': '{"b":2}\n' });
    assert.deepEqual(report(fx, ['--all']).pairs, []);
  });

  test('behind: the integration branch changed a file the branch touches, and the rebase conflict is predicted', (t) => {
    const { fx } = twoSessions(t);
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    commit(fx.main, 'unrelated', { 'docs/x.md': 'x\n' });
    assert.deepEqual(report(fx).behind, [], 'main moved, but not under anything this branch touches');
    commit(fx.main, 'fix: landed elsewhere', { 'src/billing/invoice.ts': edit(1, 'landed') });
    const [b] = report(fx).behind;
    assert.deepEqual(b, { branch: 'feature', behind: 2, files: ['src/billing/invoice.ts'], conflicts: ['src/billing/invoice.ts'] });
    assert.match(fx.run('overlap').stdout, /✗ feature is 2 commit\(s\) behind main, which changed src\/billing\/invoice\.ts that it also touches; a rebase now would conflict/);
  });

  test('in a session worktree it reports only its own branch; --all reports every pair', (t) => {
    const { fx, other } = twoSessions(t);
    const third = join(fx.base, 'third');
    git(fx.main, 'worktree', 'add', '-q', '-b', 'third', third, BRANCH);
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(10, 'theirs'), 'src/export/csv.ts': 'a\n' });
    commit(third, 'feat: third', { 'src/export/csv.ts': 'b\n' });
    assert.deepEqual(report(fx).pairs.map((p) => `${p.a}↔${p.b}`), ['feature↔other']);
    // From the other worktree the same pair reads "mine ↔ theirs" the other way round
    assert.deepEqual(report(fx, [], other).pairs.map((p) => `${p.a}↔${p.b}`).sort(), ['other↔feature', 'other↔third']);
    assert.deepEqual(report(fx, ['--all']).pairs.map((p) => `${p.a}↔${p.b}`).sort(), ['feature↔other', 'other↔third']);
    assert.deepEqual(report(fx, ['--branch', 'third'], fx.main).pairs.map((p) => `${p.a}↔${p.b}`), ['third↔other']);
  });
});

describe('overlap --session', () => {
  test('lists the other live sessions and the areas they touch; silent when alone', (t) => {
    const { fx, other } = twoSessions(t);
    assert.equal(fx.run('overlap', ['--session']).stdout, '');
    commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(1, 'theirs'), 'src/billing/tax.ts': 'x\n' });
    const out = fx.run('overlap', ['--session']).stdout;
    assert.match(out, /1 other active session branch/);
    assert.match(out, /other: src\/billing \(2\)/);
    assert.equal(fx.run('overlap', ['--session']).status, 0);
  });
});

describe('overlap --notify (PostToolUse hook)', () => {
  test('speaks once per change of the overlap, as additionalContext for the agent', (t) => {
    const { fx, other } = twoSessions(t, { overlap: { notifyEveryMinutes: 0 } });
    const file = join(fx.wt, 'src/billing/invoice.ts');
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    assert.equal(notify(fx, file).out, '', 'no overlap yet');

    commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(10, 'theirs') });
    const first = notify(fx, file);
    assert.equal(first.status, 0);
    const parsed = JSON.parse(first.out) as { hookSpecificOutput: { hookEventName: string; additionalContext: string } };
    assert.equal(parsed.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(parsed.hookSpecificOutput.additionalContext, /swarm overlap \(feature\):\n⚠ feature ↔ other/);

    assert.equal(notify(fx, file).out, '', 'the same overlap is not repeated on every edit');

    commit(other, 'feat: now on my line', { 'src/billing/invoice.ts': edit(1, 'theirs') });
    assert.match(notify(fx, file).out, /conflict predicted in src\/billing\/invoice\.ts/, 'a new conflict is news');
  });

  test('throttled: within notifyEveryMinutes it does not even check', (t) => {
    const { fx, other } = twoSessions(t, { overlap: { notifyEveryMinutes: 60 } });
    const file = join(fx.wt, 'src/billing/invoice.ts');
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    assert.equal(notify(fx, file).out, '');
    commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(1, 'theirs') });
    assert.equal(notify(fx, file).out, '', 'the last check was less than an hour ago');
  });

  test('silent for files of the main checkout, and never fails the hook on bad input', (t) => {
    const { fx, other } = twoSessions(t, { overlap: { notifyEveryMinutes: 0 } });
    commit(fx.wt, 'feat: mine', { 'src/billing/invoice.ts': edit(1, 'mine') });
    commit(other, 'feat: theirs', { 'src/billing/invoice.ts': edit(1, 'theirs') });
    assert.equal(notify(fx, join(fx.main, 'src/billing/invoice.ts'), fx.main).out, '');
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'overlap.ts'), '--notify'], {
      cwd: fx.base,
      input: 'not json',
      encoding: 'utf8',
      env: { ...process.env, DEV_FLOW_CONFIG: fx.configPath },
    });
    assert.equal(r.status, 0);
  });
});
