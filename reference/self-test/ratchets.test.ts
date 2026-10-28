/**
 * Self-tests of `ratchets.ts`: the pure checks and tightening, then the CLI in a throw-away repo, then `land`
 * tightening and committing the file after a green verify. Only `node:test` and `node:assert`.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, it } from 'node:test';
import {
  type Ratchets,
  check,
  checkCoverage,
  checkFileSize,
  checkLint,
  countLines,
  countLintWarnings,
  globToRegExp,
  initial,
  targetFloor,
  tighten,
} from '../scripts/ratchets.ts';
import { LAND_VERIFY, commit, fixture, git, sha, subjects, write } from './helpers.ts';

const lines = (n: number) => 'x\n'.repeat(n);
const sizeRatchet = (exceptions: Record<string, number> = {}) => ({ max: 500, include: ['src/**/*.ts'], exclude: ['**/*.test.ts'], exceptions });

describe('ratchets: pure parts', () => {
  it('counts lines like wc -l, plus an unterminated last line', () => {
    assert.equal(countLines(''), 0);
    assert.equal(countLines('a\nb\n'), 2);
    assert.equal(countLines('a\nb'), 2);
  });

  it('matches globs with **, * and braces', () => {
    const re = globToRegExp('src/**/*.{ts,tsx}');
    assert.ok(re.test('src/a.ts'));
    assert.ok(re.test('src/deep/er/b.tsx'));
    assert.ok(!re.test('src/a.js'));
    assert.ok(!re.test('lib/a.ts'));
    assert.ok(globToRegExp('**/*.test.ts').test('a.test.ts'));
    assert.ok(!globToRegExp('src/*.ts').test('src/x/a.ts'));
  });

  it('file size: a new file over the max fails; an exception may shrink but not grow', () => {
    const r = sizeRatchet({ 'src/big.ts': 600 });
    assert.deepEqual(checkFileSize(r, [{ path: 'src/ok.ts', lines: 500 }, { path: 'src/big.ts', lines: 600 }, { path: 'src/x.test.ts', lines: 900 }]), []);
    const problems = checkFileSize(r, [{ path: 'src/new.ts', lines: 501 }, { path: 'src/big.ts', lines: 601 }]);
    assert.equal(problems.length, 2);
    assert.match(problems[0]?.message ?? '', /src\/new\.ts has 501 lines \(max 500\)/);
    assert.match(problems[1]?.message ?? '', /src\/big\.ts grew to 601 lines \(recorded exception: 600\)/);
  });

  it('coverage: below the floor fails, and so does a gap above maxGap, naming the floor to raise to', () => {
    const r = { summary: 'c.json', floor: { lines: 80, branches: 70 }, maxGap: 1 };
    assert.deepEqual(checkCoverage(r, { lines: 80.9, branches: 70 }, r.floor), []);
    const below = checkCoverage(r, { lines: 79.9 }, r.floor);
    assert.match(below[0]?.message ?? '', /below the floor 80/);
    const gap = checkCoverage(r, { lines: 82.74 }, r.floor);
    assert.match(gap[0]?.message ?? '', /raise the floor to 82\.2/);
    assert.equal(targetFloor(82.74, 1), 82.2);
  });

  it('coverage: with floorFrom the floor read from the runner config is used, and tighten leaves it alone', () => {
    const r: Ratchets = { coverage: { summary: 'c.json', floorFrom: 'vitest.config.ts', maxGap: 1 } };
    const problems = check(r, { coverage: { lines: 90 }, externalFloor: { lines: 86 } });
    assert.match(problems[0]?.message ?? '', /raise the floor to 89\.5 in vitest\.config\.ts/);
    assert.deepEqual(tighten(r, { coverage: { lines: 90 } }).changes, []);
  });

  it('lint: counts Biome and ESLint warnings per rule and enforces the budgets', () => {
    const biome = JSON.stringify({ diagnostics: [{ category: 'lint/style/noNonNullAssertion', severity: 'warning' }, { category: 'lint/a', severity: 'error' }, { category: 'lint/style/noNonNullAssertion', severity: 'warning' }] });
    assert.deepEqual(countLintWarnings(`some banner\n${biome}`), { warnings: 2, rules: { 'lint/style/noNonNullAssertion': 2 } });
    const eslint = JSON.stringify([{ messages: [{ ruleId: 'no-console', severity: 1 }, { ruleId: 'eqeqeq', severity: 2 }] }, { messages: [{ ruleId: 'no-console', severity: 1 }] }]);
    const counted = countLintWarnings(eslint);
    assert.deepEqual(counted, { warnings: 2, rules: { 'no-console': 2 } });
    assert.deepEqual(checkLint({ command: '', budget: 2, perRule: { 'no-console': 2 } }, counted), []);
    const over = checkLint({ command: '', budget: 1, perRule: { 'no-console': 1 } }, counted);
    assert.equal(over.length, 2);
    assert.throws(() => countLintWarnings('{"something": 1}'), /unrecognized lint report/);
  });

  it('tighten only ever tightens', () => {
    const r: Ratchets = {
      '//': 'kept',
      fileSize: sizeRatchet({ 'src/a.ts': 700, 'src/b.ts': 600, 'src/gone.ts': 550, 'src/small.ts': 520 }),
      coverage: { summary: 'c.json', floor: { lines: 80, branches: 75 }, maxGap: 1 },
      lintWarnings: { command: 'x', budget: 10, perRule: { r1: 5, r2: 3 } },
    };
    const { next, changes } = tighten(r, {
      files: [{ path: 'src/a.ts', lines: 650 }, { path: 'src/b.ts', lines: 640 }, { path: 'src/small.ts', lines: 480 }, { path: 'src/new.ts', lines: 900 }],
      coverage: { lines: 85.37, branches: 74 },
      lint: { warnings: 12, rules: { r1: 2, r2: 9 } },
    });
    assert.equal(next['//'], 'kept');
    // shrunk, kept at its recorded size (it grew: the check fails, tighten does not hide it), removed, removed; never added
    assert.deepEqual(next.fileSize?.exceptions, { 'src/a.ts': 650, 'src/b.ts': 600 });
    assert.deepEqual(next.coverage?.floor, { lines: 84.8, branches: 75 });
    assert.deepEqual(next.lintWarnings, { command: 'x', budget: 10, perRule: { r1: 2, r2: 3 } });
    assert.equal(changes.length, 5);
  });

  it('init records the current state', () => {
    const r = initial(
      { fileSize: sizeRatchet(), coverage: { summary: 'c.json', floor: {}, maxGap: 1 }, lintWarnings: { command: 'x', budget: 0 } },
      { files: [{ path: 'src/big.ts', lines: 700 }, { path: 'src/ok.ts', lines: 10 }], coverage: { lines: 88.3 }, lint: { warnings: 4, rules: { r: 4 } } },
    );
    assert.deepEqual(r.fileSize?.exceptions, { 'src/big.ts': 700 });
    assert.deepEqual(r.coverage?.floor, { lines: 87.8 });
    assert.deepEqual(r.lintWarnings, { command: 'x', budget: 4, perRule: { r: 4 } });
  });
});

describe('ratchets: CLI in a repo', () => {
  it('checks, restricts --size-only to the given files, tightens, and refuses --init once committed', (t) => {
    const fx = fixture(t);
    const ratchets: Ratchets = {
      fileSize: sizeRatchet({ 'src/big.ts': 620 }),
      coverage: { summary: 'coverage/coverage-summary.json', floor: { lines: 80 }, maxGap: 1 },
      lintWarnings: { command: `node -e "console.log(JSON.stringify({diagnostics:[{category:'r',severity:'warning'}]}))"`, budget: 3 },
    };
    commit(fx.wt, 'add code', {
      'quality-ratchets.json': JSON.stringify(ratchets),
      'src/big.ts': lines(600),
      'src/ok.ts': lines(10),
      'coverage/coverage-summary.json': JSON.stringify({ total: { lines: { pct: 80.4 } } }),
    });

    const green = fx.run('ratchets');
    assert.equal(green.status, 0, green.out);
    assert.match(green.out, /✓ ratchets: fileSize, coverage, lintWarnings within bounds/);

    write(fx.wt, 'src/huge.ts', lines(501));
    const red = fx.run('ratchets');
    assert.equal(red.status, 1);
    assert.match(red.out, /src\/huge\.ts has 501 lines/);
    assert.equal(fx.run('ratchets', ['--size-only', 'src/ok.ts']).status, 0);
    assert.equal(fx.run('ratchets', ['--size-only', 'src/huge.ts']).status, 1);
    git(fx.wt, 'clean', '-fq', 'src');

    const tightened = fx.run('ratchets', ['--tighten']);
    assert.equal(tightened.status, 0, tightened.out);
    const after = JSON.parse(readFileSync(join(fx.wt, 'quality-ratchets.json'), 'utf8')) as Ratchets;
    assert.deepEqual(after.fileSize?.exceptions, { 'src/big.ts': 600 });
    assert.equal(after.lintWarnings?.budget, 1);
    assert.deepEqual(after.coverage?.floor, { lines: 80 });

    const init = fx.run('ratchets', ['--init']);
    assert.equal(init.status, 1);
    assert.match(init.out, /already committed/);
  });

  it('--init records the state of an uncommitted file', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'code', { 'src/big.ts': lines(700) });
    write(fx.wt, 'quality-ratchets.json', JSON.stringify({ fileSize: sizeRatchet() }));
    const r = fx.run('ratchets', ['--init']);
    assert.equal(r.status, 0, r.out);
    const written = JSON.parse(readFileSync(join(fx.wt, 'quality-ratchets.json'), 'utf8')) as Ratchets;
    assert.deepEqual(written.fileSize?.exceptions, { 'src/big.ts': 700 });
  });
});

describe('ratchets: land tightens after a green verify', () => {
  it('commits only the ratchets file on top of the verified SHA and integrates that commit', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: shrink big.ts', { 'quality-ratchets.json': JSON.stringify({ fileSize: sizeRatchet({ 'src/big.ts': 700 }) }), 'src/big.ts': lines(650) });
    const verified = sha(fx.wt);
    const r = fx.run('land', ['--no-push'], { env: { [LAND_VERIFY]: 'true' } });
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(subjects(fx.main, `${verified}..main`), ['chore: tighten quality ratchets']);
    assert.equal(git(fx.main, 'rev-parse', 'main^'), verified);
    assert.deepEqual(git(fx.main, 'diff', '--name-only', verified, 'main').split('\n'), ['quality-ratchets.json']);
    const landed = JSON.parse(git(fx.main, 'show', 'main:quality-ratchets.json')) as Ratchets;
    assert.deepEqual(landed.fileSize?.exceptions, { 'src/big.ts': 650 });
  });

  it('integrates the verified SHA unchanged when nothing tightens', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'feat: code', { 'quality-ratchets.json': JSON.stringify({ fileSize: sizeRatchet({ 'src/big.ts': 650 }) }), 'src/big.ts': lines(650) });
    const verified = sha(fx.wt);
    const r = fx.run('land', ['--no-push'], { env: { [LAND_VERIFY]: 'true' } });
    assert.equal(r.status, 0, r.out);
    assert.equal(sha(fx.main, 'main'), verified);
  });
});
