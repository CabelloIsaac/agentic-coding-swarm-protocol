/**
 * Self-tests of the work-in-progress limit in `roadmap.ts`: the active-change cap, staleness measured from the last
 * commit that added a tick, and the `parked:` marker, on throw-away repos with a dated history. Only `node:test` and
 * `node:assert`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { ROADMAP_DEFAULTS, lastProgress, parkedReason, wipProblems } from '../scripts/roadmap.ts';
import { commit, git } from './helpers.ts';

const day = (n: number) => `2026-01-${String(n + 1).padStart(2, '0')}T12:00:00+00:00`;
const unix = (n: number) => Date.parse(day(n)) / 1000;
const tasks = (done: number, open: number) => `${'- [x] done\n'.repeat(done)}${'- [ ] todo\n'.repeat(open)}`;
const change = (id: string, t: string, proposal = '## Why\nbecause\n') => ({ [`openspec/changes/${id}/proposal.md`]: proposal, [`openspec/changes/${id}/tasks.md`]: t });

/** Commits at a given day, so the history the scripts read is one the test controls. */
function commitAt(dir: string, n: number, message: string, files: Record<string, string>) {
  process.env.GIT_COMMITTER_DATE = day(n);
  process.env.GIT_AUTHOR_DATE = day(n);
  try {
    return commit(dir, message, files);
  } finally {
    Reflect.deleteProperty(process.env, 'GIT_COMMITTER_DATE');
    Reflect.deleteProperty(process.env, 'GIT_AUTHOR_DATE');
  }
}

function repo(t: TestContext): string {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'swarm-roadmap-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  return dir;
}

const cfg = { ...ROADMAP_DEFAULTS };

describe('roadmap WIP: the parked marker', () => {
  it('reads the reason from the proposal, and only when there is one', (t) => {
    const dir = repo(t);
    commitAt(dir, 0, 'x', {
      ...change('a', tasks(1, 1), 'parked: waiting for the vendor API\n## Why\n'),
      ...change('b', tasks(1, 1), '## Why\nparked: \n'),
      ...change('c', tasks(1, 1)),
    });
    assert.equal(parkedReason(dir, 'a'), 'waiting for the vendor API');
    assert.equal(parkedReason(dir, 'b'), undefined);
    assert.equal(parkedReason(dir, 'c'), undefined);
  });
});

describe('roadmap WIP: staleness', () => {
  it('dates a change by its last tick, not by later edits of tasks.md', (t) => {
    const dir = repo(t);
    commitAt(dir, 0, 'start', change('a', tasks(0, 3)));
    commitAt(dir, 3, 'first tick', change('a', tasks(1, 2)));
    commitAt(dir, 9, 'reword a task', { 'openspec/changes/a/tasks.md': tasks(1, 2).replace('todo', 'to do') });
    assert.equal(lastProgress(dir, 'a'), unix(3));
    commitAt(dir, 10, 'second tick', change('a', tasks(2, 1)));
    assert.equal(lastProgress(dir, 'a'), unix(10));
  });

  it('a change never started is as old as its folder; outside git nothing is measured', (t) => {
    const dir = repo(t);
    commitAt(dir, 2, 'open', change('idle', tasks(0, 4)));
    assert.equal(lastProgress(dir, 'idle'), unix(2));
    const bare = mkdtempSync(join(realpathSync(tmpdir()), 'swarm-roadmap-nogit-'));
    t.after(() => rmSync(bare, { recursive: true, force: true }));
    mkdirSync(join(bare, 'openspec/changes/x'), { recursive: true });
    writeFileSync(join(bare, 'openspec/changes/x/tasks.md'), tasks(1, 1));
    assert.equal(lastProgress(bare, 'x'), undefined);
    assert.deepEqual(wipProblems(bare, cfg, unix(100)), []);
  });

  it('flags a stale change with what to do, spares fresh and parked ones', (t) => {
    const dir = repo(t);
    commitAt(dir, 0, 'old', { ...change('stale-one', tasks(1, 1)), ...change('parked-one', tasks(0, 2), 'parked: blocked on legal\n') });
    commitAt(dir, 20, 'fresh', change('fresh-one', tasks(1, 1)));
    const problems = wipProblems(dir, cfg, unix(30));
    assert.equal(problems.length, 1, problems.join('\n'));
    assert.match(problems[0] ?? '', /^stale-one: stale, no task ticked for 30 days \(limit 14/);
    assert.match(problems[0] ?? '', /Finish it, archive it, or add "parked: <reason>"/);
    // the same history, 10 days after the last tick: nothing is stale yet
    assert.deepEqual(wipProblems(dir, cfg, unix(10)), []);
  });
});

describe('roadmap WIP: the limit', () => {
  it('fails above maxActive, listing the oldest first, and parked changes still count', (t) => {
    const dir = repo(t);
    commitAt(dir, 5, 'c1', change('newest', tasks(1, 1)));
    commitAt(dir, 1, 'c2', change('oldest', tasks(1, 1)));
    commitAt(dir, 3, 'c3', change('middle', tasks(1, 1), 'parked: later\n'));
    assert.deepEqual(wipProblems(dir, { maxActive: 3, staleDays: 99 }, unix(6)), []);
    const problems = wipProblems(dir, { maxActive: 2, staleDays: 99 }, unix(6));
    assert.equal(problems.length, 1);
    assert.match(problems[0] ?? '', /3 active changes, the limit is 2/);
    assert.match(problems[0] ?? '', /starting with oldest \(5 d since progress\), middle \(3 d since progress\), newest/);
    assert.match(problems[0] ?? '', /finish, archive or park/);
  });

  it('archived changes do not count', (t) => {
    const dir = repo(t);
    commitAt(dir, 0, 'x', { ...change('a', tasks(1, 0)), ...change('archive/2026-01-01-b', tasks(1, 0)) });
    assert.deepEqual(wipProblems(dir, { maxActive: 1, staleDays: 99 }, unix(1)), []);
  });
});

const hasYaml = (() => {
  try {
    createRequire(import.meta.url)('yaml');
    return true;
  } catch {
    return false;
  }
})();

describe('roadmap CLI', { skip: hasYaml ? false : 'the yaml package is not installed here' }, () => {
  it('exits 1 with the WIP message, and 0 once the limit is met (the roadmap file is JSON, which YAML accepts)', (t) => {
    const dir = repo(t);
    const roadmap = JSON.stringify({ goal: 'g', waves: { 0: 'w' }, changes: ['a', 'b'].map((id) => ({ id, title: id, block: 'B', wave: 0, priority: 'P0' })) });
    commitAt(dir, 0, 'x', { 'openspec/roadmap.yaml': roadmap, ...change('a', tasks(1, 1)), ...change('b', tasks(1, 1)) });
    const run = (maxActive: number) => {
      const conf = join(dir, '..', `${dir.split('/').pop()}.json`);
      writeFileSync(conf, JSON.stringify({ roadmap: { maxActive, staleDays: 99999 } }));
      t.after(() => rmSync(conf, { force: true }));
      const r = spawnSync(process.execPath, [join(import.meta.dirname, '../scripts/roadmap.ts')], { cwd: dir, encoding: 'utf8', env: { ...process.env, DEV_FLOW_CONFIG: conf } });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    };
    const over = run(1);
    assert.equal(over.status, 1, over.out);
    assert.match(over.out, /2 active changes, the limit is 1/);
    assert.equal(run(2).status, 0);
  });
});
