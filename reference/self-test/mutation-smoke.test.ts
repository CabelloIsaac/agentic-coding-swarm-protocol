/**
 * Self-tests of `mutation-smoke.ts`: the mutation operators, the test resolution, then the CLI in a throw-away repo
 * whose test runner is `node --test`. Only `node:test` and `node:assert`.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import type { TestContext } from 'node:test';
import { DEFAULTS, candidates, notProven, relatedTests, smokeFile } from '../scripts/mutation-smoke.ts';
import { SCRIPTS, commit, git } from './helpers.ts';

const GOOD = `export function check(n: number, flag = true): string {
  if (n >= 10 && flag) {
    return 'big';
  }
  return 'small';
}
`;
const GOOD_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { check } from './good.ts';
test('check', () => {
  assert.equal(check(10), 'big');
  assert.equal(check(9), 'small');
  assert.equal(check(10, false), 'small');
});
`;
const WEAK = `export function build(n: number) {
  const ok = n >= 1 && true;
  return {
    ok,
  };
}
`;
// The incident shape (its multi-line return is out of reach of the return operator, so only the three others apply): the test runs the code and checks that something came back, not what it says.
const WEAK_TEST = `import assert from 'node:assert/strict';
import { test } from 'node:test';
import { build } from './weak.ts';
test('build', () => {
  assert.ok(typeof build(1) === 'object');
});
`;
const ORPHAN = 'export const enabled = true;\n';

interface Repo {
  dir: string;
  config: string;
  run(args?: string[]): { status: number | null; out: string };
}

function repo(t: TestContext): Repo {
  const dir = mkdtempSync(join(realpathSync(tmpdir()), 'swarm-mutsmoke-'));
  t.after(() => rmSync(dir, { recursive: true, force: true }));
  const config = join(dir, '..', `${dir.split('/').pop()}.json`);
  writeFileSync(config, JSON.stringify({ integrationBranch: 'main', mutation: { command: 'node --test {files}', timeoutSec: 30 } }));
  t.after(() => rmSync(config, { force: true }));
  git(dir, 'init', '-q', '-b', 'main');
  commit(dir, 'base', { 'README.md': '# fixture\n' });
  git(dir, 'checkout', '-q', '-b', 'feature');
  commit(dir, 'change', {
    'src/good.ts': GOOD,
    'src/good.test.ts': GOOD_TEST,
    'src/weak.ts': WEAK,
    'src/weak.test.ts': WEAK_TEST,
    'src/orphan.ts': ORPHAN,
  });
  return {
    dir,
    config,
    run(args = []) {
      // NODE_TEST_CONTEXT is set inside `node --test`; left on, the inner `node --test` runs as a subtest and always exits 0
      const env: NodeJS.ProcessEnv = { ...process.env, DEV_FLOW_CONFIG: config };
      delete env.NODE_TEST_CONTEXT;
      const r = spawnSync(process.execPath, [join(SCRIPTS, 'mutation-smoke.ts'), ...args], { cwd: dir, encoding: 'utf8', env, timeout: 120_000 });
      return { status: r.status, out: `${r.stdout}${r.stderr}` };
    },
  };
}

describe('mutation smoke: operators', () => {
  it('mutates the first occurrence of each operator, one per mutation, and says where', () => {
    const m = candidates(GOOD, '.ts', 10);
    assert.deepEqual(
      m.map((x) => [x.line, x.description]),
      [
        [1, 'flipped true → false'],
        [2, 'replaced >= → >'],
        [2, 'replaced && → ||'],
        [3, 'replaced the returned value → undefined'],
      ],
    );
    assert.ok(m[0]?.mutated.includes('flag = false'));
    assert.ok(m[3]?.mutated.includes('return undefined;'));
    assert.equal(candidates(GOOD, '.ts', 2).length, 2);
  });

  it('skips comments and string contents, and does not turn => or !== into something else', () => {
    const src = ["// if (a >= b && true) {}", "const s = 'x === y';", 'const f = (a) => a !== 1;', 'const t = a === b;'].join('\n');
    const m = candidates(src, '.ts', 10);
    assert.deepEqual(m.map((x) => x.description), ['replaced === → !==']);
    assert.equal(m[0]?.line, 4);
  });

  it('uses the literal and operator ones only outside TS/JS', () => {
    const py = 'def f(a, b):\n    if a == 1 and b >= 2:\n        return True\n';
    assert.deepEqual(candidates(py, '.py', 10).map((x) => x.description), ['flipped True → False', 'replaced >= → >', 'replaced == → !=', 'replaced and → or']);
  });
});

describe('mutation smoke: related tests', () => {
  const testRe = new RegExp(DEFAULTS.testPattern);
  it('finds the sibling and, in grep mode, a test elsewhere that imports the module', (t) => {
    const r = repo(t);
    commit(r.dir, 'more', { 'test/integration.test.ts': "import { check } from '../src/good.ts';\n", 'test/other.test.ts': "import { x } from '../src/goodness.ts';\n" });
    const all = ['src/good.ts', 'src/good.test.ts', 'test/integration.test.ts', 'test/other.test.ts'];
    assert.deepEqual(relatedTests(r.dir, 'src/good.ts', all, testRe, 'sibling'), ['src/good.test.ts']);
    assert.deepEqual(relatedTests(r.dir, 'src/good.ts', all, testRe, 'sibling+grep'), ['src/good.test.ts', 'test/integration.test.ts']);
    assert.deepEqual(relatedTests(r.dir, 'src/orphan.ts', all, testRe, 'sibling+grep'), []);
  });
});

describe('mutation smoke: CLI in a throw-away repo', () => {
  it('real assertions kill the mutations, weak ones let them survive, untested files are listed; warn exits 0', (t) => {
    const r = repo(t);
    const before = { good: readFileSync(join(r.dir, 'src/good.ts'), 'utf8'), weak: readFileSync(join(r.dir, 'src/weak.ts'), 'utf8') };
    const res = r.run();
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /✓ src\/good\.ts: 4 mutations, 0 survived/);
    assert.match(res.out, /✗ src\/weak\.ts: 3 mutations, 3 survived/);
    assert.match(res.out, /line 2: flipped true → false survived/);
    assert.match(res.out, /✗ src\/orphan\.ts: untested/);
    assert.match(res.out, /2 file\(s\) not proven/);
    // the originals are back, byte for byte
    assert.equal(readFileSync(join(r.dir, 'src/good.ts'), 'utf8'), before.good);
    assert.equal(readFileSync(join(r.dir, 'src/weak.ts'), 'utf8'), before.weak);
    assert.equal(git(r.dir, 'status', '--porcelain'), '');
  });

  it('--mode fail exits 1 when a file is not proven; with only the proven file it exits 0', (t) => {
    const r = repo(t);
    assert.equal(r.run(['--mode', 'fail']).status, 1);
    assert.equal(r.run(['--mode', 'fail', '--files', 'src/good.ts']).status, 0);
    assert.equal(r.run(['--mode', 'fail', '--files', 'src/weak.ts']).status, 1);
    assert.equal(r.run(['--mode', 'fail', '--files', 'src/orphan.ts']).status, 1);
  });

  it('--max-total caps the run and reports what it skipped', (t) => {
    const r = repo(t);
    const res = r.run(['--max-total', '4']);
    assert.equal(res.status, 0, res.out);
    assert.match(res.out, /skipped \(mutation budget used up/);
  });
});

describe('mutation smoke: the original always comes back', () => {
  it('after a runner that fails halfway, the file is restored and the error propagates', (t) => {
    const r = repo(t);
    let calls = 0;
    const crashing = () => {
      calls++;
      if (calls === 3) throw new Error('boom');
      return { ok: true, interrupted: false };
    };
    assert.throws(() => smokeFile(r.dir, 'src/good.ts', ['src/good.test.ts'], { ...DEFAULTS, command: 'x {files}' }, 24, crashing), /boom/);
    assert.equal(readFileSync(join(r.dir, 'src/good.ts'), 'utf8'), GOOD);
  });

  it('an interrupted test run aborts and restores; a red baseline gives no verdict', (t) => {
    const r = repo(t);
    const cfg = { ...DEFAULTS, command: 'x {files}' };
    let n = 0;
    const interrupting = () => ({ ok: n++ === 0, interrupted: n > 1 });
    assert.throws(() => smokeFile(r.dir, 'src/good.ts', ['src/good.test.ts'], cfg, 24, interrupting), /interrupted/);
    assert.equal(readFileSync(join(r.dir, 'src/good.ts'), 'utf8'), GOOD);
    const red = smokeFile(r.dir, 'src/good.ts', ['src/good.test.ts'], cfg, 24, () => ({ ok: false, interrupted: false }));
    assert.equal(red.status, 'baseline-red');
    assert.ok(notProven(red));
  });
});
