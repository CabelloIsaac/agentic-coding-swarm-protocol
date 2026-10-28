/**
 * `land` end to end against throw-away repositories: it integrates exactly the SHA it verified, publishes it, and in
 * every failure leaves the integration branch (local and remote) where it was.
 */
import assert from 'node:assert/strict';
import { existsSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BRANCH, LAND_VERIFY, SCRIPTS, commit, deadPid, fixture, git, sha, subjects, tryGit, write } from './helpers.ts';

const verifyWith = (cmd: string) => ({ [LAND_VERIFY]: cmd });

/** The integration branch did not move anywhere: local, remote, and the main checkout's tree. */
function assertUntouched(fx: ReturnType<typeof fixture>, before: string): void {
  assert.equal(sha(fx.main, BRANCH), before, 'local integration branch moved');
  assert.equal(sha(fx.remote, BRANCH), before, 'remote integration branch moved');
  assert.equal(git(fx.main, 'status', '--porcelain'), '', 'main checkout left dirty');
}

describe('land', () => {
  test('happy path: integrates the verified SHA, publishes it and logs `landed`', (t) => {
    const fx = fixture(t);
    const verified = commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const r = fx.run('land', [], { env: verifyWith('true') });
    assert.equal(r.status, 0, r.out);
    assert.equal(sha(fx.main, BRANCH), verified);
    assert.equal(sha(fx.remote, BRANCH), verified);
    // The main checkout's tree moved with the ref (merge --ff-only there, not update-ref)
    assert.equal(git(fx.main, 'status', '--porcelain'), '');
    assert.ok(existsSync(join(fx.main, 'a.txt')));
    const landed = fx.landLog().filter((e) => e.result === 'landed');
    assert.equal(landed.length, 1);
    assert.equal(landed[0]?.branch, fx.branch);
    assert.equal(landed[0]?.head, verified.slice(0, 8));
    assert.equal(landed[0]?.pushed, true);
    assert.ok(!existsSync(fx.lockPath), 'the lock must be released');
  });

  test('H2: the verify override is honoured only under DEV_FLOW_CONFIG, and then the log says overridden', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const marker = join(fx.base, 'override-ran');
    // Without the self-test marker the variable is ignored and the configured verify really runs (it is red here)
    const ignored = fx.run('land', ['--no-push'], { env: { DEV_FLOW_CONFIG: '', [LAND_VERIFY]: `touch "${marker}"` } });
    assert.match(ignored.out, /ignoring MYPROJECT_LAND_VERIFY \(only honoured under DEV_FLOW_CONFIG\)/);
    assert.ok(!existsSync(marker), 'the override command ran without the marker');
    assert.notEqual(ignored.status, 0, 'the real verify of the default config does not pass in this repo');
    assert.ok(!fx.landLog().some((e) => e.verify === 'overridden'));

    const honoured = fx.run('land', ['--no-push'], { env: verifyWith(`touch "${marker}"`) });
    assert.equal(honoured.status, 0, honoured.out);
    assert.ok(existsSync(marker));
    assert.match(honoured.out, /verify: overridden/);
    assert.equal(fx.landLog().find((e) => e.result === 'landed')?.verify, 'overridden');
  });

  test('AUD-land-sha-no-fijado: a commit made while verify runs never reaches the integration branch', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    // A Stop-hook `wip:` commit (or any edit) landing on the branch in the middle of verification
    const sneak = 'echo unverified > sneaky.txt && git add sneaky.txt && git commit -q --no-verify -m "wip: during verify"';
    const r = fx.run('land', [], { env: verifyWith(sneak) });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /the branch moved from [0-9a-f]{8} to [0-9a-f]{8} during verification/);
    assertUntouched(fx, before);
    assert.equal(tryGit(fx.main, 'cat-file', '-e', `${BRANCH}:sneaky.txt`), undefined, 'the unverified file reached the integration branch');
    assert.equal(fx.landLog().at(-1)?.result, 'failed');
    assert.ok(!existsSync(fx.lockPath));
  });

  test('the real Stop hook firing during verify sees the live land and does not commit', (t) => {
    const fx = fixture(t);
    const tip = commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    const hook = `echo edit > edited.txt && "${process.execPath}" "${join(SCRIPTS, 'wt.ts')}" wip`;
    const r = fx.run('land', [], { env: verifyWith(hook) });
    assert.notEqual(r.status, 0, r.out);
    assert.equal(sha(fx.wt), tip, 'the Stop hook committed while land held the lock for this branch');
    assert.match(r.out, /uncommitted change\(s\) appeared during verification/);
    assertUntouched(fx, before);
  });

  test('an uncommitted change that appears during verify also aborts', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    const r = fx.run('land', [], { env: verifyWith('echo stray > stray.txt') });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /uncommitted change\(s\) appeared during verification/);
    assertUntouched(fx, before);
  });

  test('the integration branch moving during verify is rebased and verified again', (t) => {
    const fx = fixture(t);
    const mine = commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    // First verification: another land advances the integration branch in the main checkout meanwhile
    const marker = join(fx.base, 'moved-once');
    const cmd = `if [ ! -e "${marker}" ]; then touch "${marker}"; git -C "$MAIN" commit -q --allow-empty -m "other: landed meanwhile"; fi`;
    const r = fx.run('land', [], { env: verifyWith(cmd) });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /moved during verification: rebasing and verifying again/);
    assert.deepEqual(subjects(fx.main, `${BRANCH}~2..${BRANCH}`), ['feat: add a', 'other: landed meanwhile']);
    assert.notEqual(sha(fx.main, BRANCH), mine, 'the rebased commit is a new SHA');
    assert.equal(sha(fx.remote, BRANCH), sha(fx.main, BRANCH));
    assert.equal(fx.landLog().at(-1)?.attempts, 2);
  });

  test('a foreign commit on the remote aborts before anything moves', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const other = join(fx.base, 'other-clone');
    git(fx.base, 'clone', '-q', fx.remote, other);
    commit(other, 'foreign: published from another clone', { 'f.txt': 'f\n' });
    git(other, 'push', '-q', 'origin', BRANCH);
    const localBefore = sha(fx.main, BRANCH);
    const remoteBefore = sha(fx.remote, BRANCH);
    const r = fx.run('land', [], { env: verifyWith('true') });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /has 1 commit\(s\) that main lacks \(two histories/);
    assert.match(r.out, /foreign: published from another clone/);
    assert.equal(sha(fx.main, BRANCH), localBefore);
    assert.equal(sha(fx.remote, BRANCH), remoteBefore);
  });

  test('a conflicting rebase aborts with the file list and leaves main and the branch untouched', (t) => {
    const fx = fixture(t, { files: { 'shared.txt': 'base\n' } });
    const before = commit(fx.main, 'main: edit shared', { 'shared.txt': 'from main\n' });
    git(fx.main, 'push', '-q', 'origin', BRANCH);
    const tip = commit(fx.wt, 'feat: edit shared', { 'shared.txt': 'from feature\n' });
    const r = fx.run('land', [], { env: verifyWith('true') });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /conflict while rebasing onto main/);
    assert.match(r.out, /shared\.txt/);
    assertUntouched(fx, before);
    assert.equal(sha(fx.wt), tip, 'the branch must be restored as it was');
    assert.equal(git(fx.wt, 'status', '--porcelain'), '');
    const conflict = fx.landLog().find((e) => e.result === 'conflict');
    assert.deepEqual(conflict?.files, ['shared.txt']);
  });

  test('a red verify leaves main untouched', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    const r = fx.run('land', [], { env: verifyWith('false') });
    assert.notEqual(r.status, 0, r.out);
    assert.match(r.out, /verification failed: main was not touched/);
    assertUntouched(fx, before);
    assert.equal(fx.landLog().at(-1)?.result, 'failed');
  });

  test('a lock held by a live process refuses; a stale one is taken over', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    writeFileSync(fx.lockPath, JSON.stringify({ branch: 'someone-else', pid: process.pid, at: new Date().toISOString() }));
    const held = fx.run('land', [], { env: verifyWith('true') });
    assert.notEqual(held.status, 0, held.out);
    assert.match(held.out, /another pnpm land is running/);
    assertUntouched(fx, before);
    assert.ok(existsSync(fx.lockPath), 'a live holder keeps its lock');

    writeFileSync(fx.lockPath, JSON.stringify({ branch: 'someone-else', pid: deadPid(), at: new Date().toISOString() }));
    const stale = fx.run('land', [], { env: verifyWith('true') });
    assert.equal(stale.status, 0, stale.out);
    assert.equal(sha(fx.main, BRANCH), sha(fx.wt));
    assert.ok(!existsSync(fx.lockPath));
  });

  test('wip commits are refused unless --squash folds them into one', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'wip: 2026-10-28 (Stop hook)', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    const refused = fx.run('land', [], { env: verifyWith('true') });
    assert.notEqual(refused.status, 0, refused.out);
    assert.match(refused.out, /wip commits/);
    assertUntouched(fx, before);
    const squashed = fx.run('land', ['--squash', 'feat: add a'], { env: verifyWith('true') });
    assert.equal(squashed.status, 0, squashed.out);
    assert.deepEqual(subjects(fx.main, `${before}..${BRANCH}`), ['feat: add a']);
  });

  test('guards: the main checkout, a dirty tree and a .env never land', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const before = sha(fx.main, BRANCH);
    assert.match(fx.run('land', [], { cwd: fx.main, env: verifyWith('true') }).out, /runs from a session worktree/);
    write(fx.wt, 'dirty.txt', 'x\n');
    assert.match(fx.run('land', [], { env: verifyWith('true') }).out, /uncommitted change/);
    git(fx.wt, 'clean', '-qfd');
    write(fx.wt, '.env', 'SECRET=1\n');
    assert.match(fx.run('land', [], { env: verifyWith('true') }).out, /there is a \.env in the worktree/);
    assertUntouched(fx, before);
  });

  test('from a clone that is not the publisher it integrates locally but the pre-push hook refuses to publish', (t) => {
    const fx = fixture(t, { publisher: false });
    const verified = commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const remoteBefore = sha(fx.remote, BRANCH);
    const r = fx.run('land', [], { env: verifyWith('true') });
    assert.equal(r.status, 1, r.out);
    assert.match(r.out, /integrated locally but NOT published/);
    assert.equal(sha(fx.main, BRANCH), verified);
    assert.equal(sha(fx.remote, BRANCH), remoteBefore);
  });

  test('without the override it runs the configured verify steps (and their logs stay out of the tree)', (t) => {
    const fx = fixture(t, { config: { verify: { full: [{ name: 'checks', cmd: 'test -f a.txt' }] } } });
    const before = sha(fx.main, BRANCH);
    commit(fx.wt, 'chore: nothing to check yet');
    const red = fx.run('land');
    assert.notEqual(red.status, 0, red.out);
    assert.match(red.out, /✗ checks/);
    assertUntouched(fx, before);
    const verified = commit(fx.wt, 'feat: add a', { 'a.txt': 'a\n' });
    const green = fx.run('land');
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /✓ all green/);
    assert.equal(sha(fx.remote, BRANCH), verified);
  });

  test('draft ADRs are numbered and the index regenerated in a commit of their own before verify', (t) => {
    const index = `# ADRs\n\n<!-- generated:adr-index -->\n<!-- /generated:adr-index -->\n`;
    const fx = fixture(t, { files: { 'docs/adr/README.md': index, 'docs/adr/0001-first.md': '# ADR-0001 — First\n\n- Status: Accepted\n' } });
    commit(fx.wt, 'docs: propose second', { 'docs/adr/draft-second.md': '# ADR-draft — Second\n', 'notes.md': 'See ADR-draft-second.\n' });
    // The draft must be in what verify sees: verify fails if the numbered file is missing
    const r = fx.run('land', [], { env: verifyWith('test -f docs/adr/0002-second.md') });
    assert.equal(r.status, 0, r.out);
    assert.match(r.out, /ADRs numbered: draft-second\.md → 0002-second\.md/);
    assert.equal(git(fx.main, 'show', `${BRANCH}:notes.md`), 'See ADR-0002.');
    assert.match(git(fx.main, 'show', `${BRANCH}:docs/adr/README.md`), /\| \[0002\]\(0002-second\.md\) \| Second \| Proposed \|/);
    assert.equal(subjects(fx.main, `${BRANCH}~1..${BRANCH}`)[0], 'docs: number ADRs (draft-second.md → 0002-second.md) and regenerate the index');
  });
});
