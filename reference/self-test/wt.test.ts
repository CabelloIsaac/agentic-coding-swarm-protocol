/**
 * `wt wip` (the Stop hook's safety net) and `wt commit`: the rolling wip never piles up, never fires where it would do
 * harm (main checkout, half-done rebase or merge, a live land of the same branch), and a real commit absorbs it.
 */
import assert from 'node:assert/strict';
import { writeFileSync } from 'node:fs';
import { describe, test } from 'node:test';
import { BRANCH, commit, deadPid, fixture, git, sha, subjects, tryGit, write } from './helpers.ts';

const pending = (fx: ReturnType<typeof fixture>) => subjects(fx.wt, `${BRANCH}..HEAD`);

describe('wt wip', () => {
  test('commits a dirty tree, then amends its own wip instead of stacking', (t) => {
    const fx = fixture(t);
    write(fx.wt, 'a.txt', 'one\n');
    assert.equal(fx.run('wt', ['wip']).status, 0);
    assert.equal(pending(fx).length, 1);
    assert.match(pending(fx)[0] ?? '', /^wip: /);
    assert.equal(git(fx.wt, 'status', '--porcelain'), '');

    write(fx.wt, 'b.txt', 'two\n');
    fx.run('wt', ['wip']);
    assert.equal(pending(fx).length, 1, 'the second wip must amend the first');
    assert.deepEqual(git(fx.wt, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['a.txt', 'b.txt']);
  });

  test('a clean tree makes no commit, and a real commit at the tip is never amended', (t) => {
    const fx = fixture(t);
    const real = commit(fx.wt, 'feat: real work', { 'a.txt': 'a\n' });
    fx.run('wt', ['wip']);
    assert.equal(sha(fx.wt), real);
    write(fx.wt, 'b.txt', 'b\n');
    fx.run('wt', ['wip']);
    const [tip, below, ...rest] = pending(fx);
    assert.match(tip ?? '', /^wip: /);
    assert.equal(below, 'feat: real work');
    assert.deepEqual(rest, []);
  });

  test('does nothing in the main checkout', (t) => {
    const fx = fixture(t);
    const before = sha(fx.main);
    write(fx.main, 'stray.txt', 'x\n');
    assert.equal(fx.run('wt', ['wip'], { cwd: fx.main }).status, 0);
    assert.equal(sha(fx.main), before);
    assert.match(git(fx.main, 'status', '--porcelain'), /stray\.txt/);
  });

  test('does nothing during a rebase or a merge with conflicts', (t) => {
    const fx = fixture(t, { files: { 'shared.txt': 'base\n' } });
    commit(fx.main, 'main: edit shared', { 'shared.txt': 'from main\n' });
    commit(fx.wt, 'feat: edit shared', { 'shared.txt': 'from feature\n' });

    assert.equal(tryGit(fx.wt, 'rebase', BRANCH), undefined, 'the rebase must stop on the conflict');
    const during = sha(fx.wt);
    fx.run('wt', ['wip']);
    assert.equal(sha(fx.wt), during, 'wip committed in the middle of a rebase');
    git(fx.wt, 'rebase', '--abort');

    assert.equal(tryGit(fx.wt, 'merge', BRANCH), undefined, 'the merge must stop on the conflict');
    const merging = sha(fx.wt);
    fx.run('wt', ['wip']);
    assert.equal(sha(fx.wt), merging, 'wip committed in the middle of a merge');
    git(fx.wt, 'merge', '--abort');
  });

  test('does nothing while a live land holds the lock for this branch; any other lock does not stop it', (t) => {
    const fx = fixture(t);
    const before = sha(fx.wt);
    write(fx.wt, 'a.txt', 'a\n');
    writeFileSync(fx.lockPath, JSON.stringify({ branch: fx.branch, pid: process.pid }));
    fx.run('wt', ['wip']);
    assert.equal(sha(fx.wt), before, 'wip committed while land was verifying this branch');

    // A dead land (stale lock) or a land of another branch must not silence the safety net
    writeFileSync(fx.lockPath, JSON.stringify({ branch: fx.branch, pid: deadPid() }));
    fx.run('wt', ['wip']);
    assert.notEqual(sha(fx.wt), before);
    write(fx.wt, 'b.txt', 'b\n');
    const amended = sha(fx.wt);
    writeFileSync(fx.lockPath, JSON.stringify({ branch: 'other', pid: process.pid }));
    fx.run('wt', ['wip']);
    assert.notEqual(sha(fx.wt), amended);
  });
});

describe('wt commit', () => {
  test('absorbs a trailing wip into one commit with a real message', (t) => {
    const fx = fixture(t);
    write(fx.wt, 'a.txt', 'a\n');
    fx.run('wt', ['wip']);
    write(fx.wt, 'b.txt', 'b\n');
    const r = fx.run('wt', ['commit', 'feat: a and b']);
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(pending(fx), ['feat: a and b']);
    assert.deepEqual(git(fx.wt, 'show', '--name-only', '--format=', 'HEAD').split('\n').sort(), ['a.txt', 'b.txt']);
    assert.equal(git(fx.wt, 'status', '--porcelain'), '');
  });

  test('never absorbs a wip that is already on the integration branch', (t) => {
    const fx = fixture(t);
    const integrated = commit(fx.main, 'wip: already integrated');
    git(fx.wt, 'merge', '-q', '--ff-only', BRANCH);
    write(fx.wt, 'a.txt', 'a\n');
    fx.run('wt', ['commit', 'feat: a']);
    assert.equal(sha(fx.wt, 'HEAD~1'), integrated);
    assert.deepEqual(pending(fx), ['feat: a']);
  });

  test('an empty message is refused', (t) => {
    const fx = fixture(t);
    const r = fx.run('wt', ['commit']);
    assert.equal(r.status, 1);
    assert.match(r.out, /usage: pnpm wt:commit/);
  });
});
