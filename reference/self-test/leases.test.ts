/**
 * `leases`: shared leases inform, exclusive zones refuse another live session's edit, a dead session (expired lease or
 * removed worktree) holds nothing, `land` releases what its branch held, and the zone list is the integration branch's.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { BRANCH, LAND_VERIFY, SCRIPTS, commit, fixture, git } from './helpers.ts';

type Fx = ReturnType<typeof fixture>;

const ZONE = 'db/migrations/**';

/** The fixture plus a second session worktree on branch `other`, with one exclusive zone. */
function twoSessions(t: Parameters<typeof fixture>[0], config: Record<string, unknown> = {}) {
  const fx = fixture(t, {
    files: { 'db/migrations/001-init.sql': 'create table a();\n', 'src/billing/invoice.ts': 'export {};\n', 'src/contracts/api.ts': 'export {};\n' },
    config: { leases: { ttlMinutes: 30, exclusive: [ZONE] }, ...config },
  });
  const other = join(fx.base, 'other');
  git(fx.main, 'worktree', 'add', '-q', '-b', 'other', other, BRANCH);
  return { fx, other };
}

const leasesDir = (fx: Fx) => join(fx.main, '.git', 'myproject-leases');
const leaseFile = (fx: Fx, branch: string) => join(leasesDir(fx), `branch-${branch}.json`);
const lease = (fx: Fx, branch: string) => JSON.parse(readFileSync(leaseFile(fx, branch), 'utf8')) as { paths: string[]; renewedAt: string; intent?: string };
const zoneHolders = (fx: Fx) =>
  readdirSync(leasesDir(fx))
    .filter((f) => f.startsWith('zone-'))
    .map((f) => (JSON.parse(readFileSync(join(leasesDir(fx), f), 'utf8')) as { branch: string }).branch);

/** Runs `leases <cmd>` the way a hook does: hook JSON on stdin. */
function hook(fx: Fx, cmd: string[], input: Record<string, unknown>, cwd = fx.main) {
  const r = spawnSync(process.execPath, [join(SCRIPTS, 'leases.ts'), ...cmd], {
    cwd,
    input: JSON.stringify(input),
    encoding: 'utf8',
    env: { ...process.env, DEV_FLOW_CONFIG: fx.configPath },
  });
  return { status: r.status, stdout: r.stdout, stderr: r.stderr };
}

/** PreToolUse on Edit/Write of `file` (absolute). The hook runs in the project root, not in the worktree. */
const edit = (fx: Fx, file: string) => hook(fx, ['check'], { hook_event_name: 'PreToolUse', cwd: fx.main, tool_name: 'Edit', tool_input: { file_path: file } });
const context = (r: { stdout: string }) => (r.stdout ? (JSON.parse(r.stdout) as { hookSpecificOutput: { additionalContext: string } }).hookSpecificOutput.additionalContext : '');

describe('leases: shared', () => {
  test('an edit leases the file; the first time another live session touches it, its agent is told, once', (t) => {
    const { fx, other } = twoSessions(t);
    const mine = edit(fx, join(fx.wt, 'src/billing/invoice.ts'));
    assert.equal(mine.status, 0);
    assert.equal(mine.stdout, '', 'nobody else holds it');
    assert.deepEqual(lease(fx, 'feature').paths, ['src/billing/invoice.ts']);

    const theirs = edit(fx, join(other, 'src/billing/invoice.ts'));
    assert.equal(theirs.status, 0, 'shared leases never block');
    assert.match(context(theirs), /src\/billing\/invoice\.ts is also leased \(shared\) by feature, until /);
    assert.equal(edit(fx, join(other, 'src/billing/invoice.ts')).stdout, '', 'not repeated on every edit');
  });

  test('claim declares globs and an intent; a second session claiming the same area is warned', (t) => {
    const { fx, other } = twoSessions(t);
    const mine = fx.run('leases', ['claim', 'src/billing/**', '--intent', 'volume discounts']);
    assert.equal(mine.status, 0, mine.out);
    assert.equal(lease(fx, 'feature').intent, 'volume discounts');
    const theirs = fx.run('leases', ['claim', 'src/billing/invoice.ts'], { cwd: other });
    assert.equal(theirs.status, 0);
    assert.match(theirs.out, /⚠ also leased by feature \("volume discounts"\): src\/billing\/\*\*/);
    // Editing a file under the claimed glob is not a "first touch" for the owner
    assert.equal(edit(fx, join(fx.wt, 'src/billing/tax.ts')).stdout, '');
  });

  test('outside a session worktree nothing is leased', (t) => {
    const { fx } = twoSessions(t);
    const r = edit(fx, join(fx.main, 'src/billing/invoice.ts'));
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(existsSync(leasesDir(fx)), false);
    assert.equal(edit(fx, '/somewhere/else/entirely.ts').status, 0);
  });
});

describe('leases: exclusive zones', () => {
  test('the first live session to edit a zone holds it; another branch is refused with exit 2', (t) => {
    const { fx, other } = twoSessions(t);
    const mine = edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    assert.equal(mine.status, 0);
    assert.match(context(mine), /you now hold the exclusive zone db\/migrations\/\*\*/);
    const again = edit(fx, join(fx.wt, 'db/migrations/003-more.sql'));
    assert.equal(again.status, 0, 'the holder keeps editing its own zone');
    assert.equal(again.stdout, '', 'holding it already is not news');

    const theirs = edit(fx, join(other, 'db/migrations/002-other.sql'));
    assert.equal(theirs.status, 2, 'exit 2 is what blocks a PreToolUse');
    assert.match(theirs.stderr, /db\/migrations\/002-other\.sql is in the exclusive zone db\/migrations\/\*\*, held by feature/);
    assert.deepEqual(zoneHolders(fx), ['feature']);
    // A new file in a folder that does not exist yet is still checked against the zones
    assert.equal(edit(fx, join(other, 'db/migrations/new/004.sql')).status, 2);
  });

  test('claim takes the zones its globs cover, and fails when another live session holds one', (t) => {
    const { fx, other } = twoSessions(t);
    const mine = fx.run('leases', ['claim', 'db/**', '--intent', 'split the users table']);
    assert.equal(mine.status, 0, mine.out);
    assert.match(mine.out, /exclusive zones held: db\/migrations\/\*\*/);
    const theirs = fx.run('leases', ['claim', 'db/migrations/001-init.sql'], { cwd: other });
    assert.equal(theirs.status, 1);
    assert.match(theirs.out, /✗ exclusive zone db\/migrations\/\*\* is held by feature \("split the users table"\)/);
  });

  test('an expired lease holds nothing: the next session takes the zone, and the old holder is refused after', (t) => {
    const { fx, other } = twoSessions(t);
    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    const stale = { ...lease(fx, 'feature'), renewedAt: new Date(Date.now() - 31 * 60_000).toISOString() };
    writeFileSync(leaseFile(fx, 'feature'), JSON.stringify(stale));

    assert.equal(edit(fx, join(other, 'db/migrations/002-other.sql')).status, 0);
    assert.deepEqual(zoneHolders(fx), ['other']);
    const back = edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    assert.equal(back.status, 2, 'the zone changed hands while the old session was away');
    assert.match(back.stderr, /held by other/);
  });

  test('a removed worktree holds nothing', (t) => {
    const { fx, other } = twoSessions(t);
    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    git(fx.main, 'worktree', 'remove', '--force', fx.wt);
    assert.equal(edit(fx, join(other, 'db/migrations/002-other.sql')).status, 0);
  });

  test('renew (Stop hook) keeps a live lease alive and creates nothing for a session that never edited', (t) => {
    const { fx, other } = twoSessions(t);
    assert.equal(hook(fx, ['renew', '--hook'], { hook_event_name: 'Stop', cwd: other }).status, 0);
    assert.equal(existsSync(leaseFile(fx, 'other')), false);

    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    const old = new Date(Date.now() - 29 * 60_000).toISOString();
    writeFileSync(leaseFile(fx, 'feature'), JSON.stringify({ ...lease(fx, 'feature'), renewedAt: old }));
    assert.equal(hook(fx, ['renew', '--hook'], { hook_event_name: 'Stop', cwd: fx.wt }).status, 0);
    assert.ok(Date.parse(lease(fx, 'feature').renewedAt) > Date.parse(old) + 60_000, 'renewed from the hook cwd, not the process cwd');
    assert.equal(edit(fx, join(other, 'db/migrations/002-other.sql')).status, 2);
  });

  test('land releases the branch lease and its zones', (t) => {
    const { fx, other } = twoSessions(t);
    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    commit(fx.wt, 'feat: migration', { 'db/migrations/002-add.sql': 'alter table a add b int;\n' });
    const landed = fx.run('land', ['--no-review', 'self-test'], { env: { [LAND_VERIFY]: 'true' } });
    assert.equal(landed.status, 0, landed.out);
    assert.match(landed.out, /leases: released exclusive zone\(s\) db\/migrations\/\*\*/);
    assert.equal(existsSync(leaseFile(fx, 'feature')), false);
    assert.equal(edit(fx, join(other, 'db/migrations/003-next.sql')).status, 0);
  });

  test('break frees a zone a live session holds, only with a reason, and logs it', (t) => {
    const { fx } = twoSessions(t);
    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    assert.equal(fx.run('leases', ['break', ZONE], { cwd: fx.main }).status, 1, 'a reason is required');
    const r = fx.run('leases', ['break', ZONE, '--reason', 'session abandoned, human decision'], { cwd: fx.main });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(zoneHolders(fx), []);
    const log = readFileSync(join(leasesDir(fx), 'log.jsonl'), 'utf8');
    assert.match(log, /"event":"break","zone":"db\/migrations\/\*\*","holder":"feature","reason":"session abandoned, human decision"/);
  });

  test('the zone list comes from swarm.json on the integration branch; a branch cannot change it for itself', (t) => {
    const { fx, other } = twoSessions(t);
    commit(fx.main, 'chore: leases policy', { 'swarm.json': JSON.stringify({ protocol: 'swarm', leases: { exclusive: ['src/contracts/**'] } }) });
    git(fx.main, 'push', '-q', 'origin', BRANCH);
    git(fx.main, 'fetch', '-q', 'origin');
    // The branch tries to drop the zone in its own copy: ignored
    commit(other, 'chore: relax', { 'swarm.json': JSON.stringify({ protocol: 'swarm', leases: { exclusive: [] } }) });

    edit(fx, join(fx.wt, 'src/contracts/api.ts'));
    assert.equal(edit(fx, join(other, 'src/contracts/api.ts')).status, 2);
    // db/migrations is no longer a zone: the integration branch's list replaced the config default
    edit(fx, join(fx.wt, 'db/migrations/002-add.sql'));
    assert.equal(edit(fx, join(other, 'db/migrations/002-add.sql')).status, 0);
  });
});

describe('leases session and list', () => {
  test('the session notice names the zones, their live holders and the other leases', (t) => {
    const { fx, other } = twoSessions(t);
    fx.run('leases', ['claim', 'db/migrations/**', 'src/billing/**', '--intent', 'split users']);
    const out = fx.run('leases', ['session'], { cwd: other }).stdout;
    assert.match(out, /leases · exclusive zones .*: db\/migrations\/\*\* \(held by feature\)/);
    assert.match(out, /leases · feature \("split users"\) leases db\/migrations\/\*\*, src\/billing\/\*\*/);
    assert.match(out, /leases · declare what you will touch/);
    assert.match(fx.run('leases', ['list'], { cwd: fx.main }).stdout, /live\s+feature/);
  });

  test('a hook failure never blocks: bad input exits 0', (t) => {
    const { fx } = twoSessions(t);
    const r = spawnSync(process.execPath, [join(SCRIPTS, 'leases.ts'), 'check'], { cwd: fx.main, input: 'not json', encoding: 'utf8', env: { ...process.env, DEV_FLOW_CONFIG: fx.configPath } });
    assert.equal(r.status, 0);
    const usage = fx.run('leases', ['nonsense']);
    assert.equal(usage.status, 1, 'a misconfigured command must not look like a refusal (exit 2)');
  });
});
