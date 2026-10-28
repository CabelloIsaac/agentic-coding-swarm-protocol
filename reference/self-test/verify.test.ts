/**
 * `verify`, the single gate: exit code, one summary line per step, the tail of each failure, full logs on disk, the
 * step time limit, and the one tolerated flake matched by its exact signature and nothing looser.
 */
import assert from 'node:assert/strict';
import { readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { onlyRpcTimeouts, quickSteps } from '../scripts/verify.ts';
import { fixture } from './helpers.ts';

/** The per-step summary lines: `✓ name (3s)` or `✗ name (3s)`, optionally with a warning. */
const stepLines = (out: string) => out.split('\n').filter((l) => /^[✓✗] .+ \(\d+s\)( · warning: .+)?$/.test(l) && !/^(✓ all green|✗ \d+ step\(s\) red) /.test(l));
const RPC = 'Error: [vitest-worker]: Timeout calling "onTaskUpdate"';
const runnerOutput = (opts: { failed?: boolean; errors: number; rpc: number; rpcLine?: string }) =>
  [
    ` Test Files  ${opts.failed ? '1 failed | 11 passed' : '12 passed'} (12)`,
    `      Tests  ${opts.failed ? '1 failed | 339 passed' : '340 passed'} (340)`,
    `     Errors  ${opts.errors} error${opts.errors === 1 ? '' : 's'}`,
    ...Array.from({ length: opts.rpc }, () => opts.rpcLine ?? RPC),
    '',
  ].join('\n');

describe('verify', () => {
  test('all green: exit 0, one line per step, logs written', (t) => {
    const fx = fixture(t, {
      config: { verify: { full: [{ name: 'lint', cmd: 'echo lint ok' }, { name: 'types', cmd: 'echo types ok' }, { name: 'tests', cmd: 'echo tests ok', serial: true }] } },
    });
    const r = fx.run('verify');
    assert.equal(r.status, 0, r.out);
    assert.deepEqual(stepLines(r.stdout).map((l) => l.replace(/ \(\d+s\).*$/, '')), ['✓ lint', '✓ types', '✓ tests']);
    assert.match(r.stdout, /✓ all green/);
    assert.equal(readFileSync(join(fx.wt, 'tmp/verify/lint.log'), 'utf8'), 'lint ok\n');
    assert.equal(readFileSync(join(fx.wt, 'tmp/verify/tests.log'), 'utf8'), 'tests ok\n');
  });

  test('a red step: exit 1, only the tail of its output, the full log on disk', (t) => {
    const noisy = 'for i in $(seq 1 60); do echo "line $i"; done; echo ""; echo "ELIFECYCLE noise"; echo "error TS2322: boom"; exit 2';
    const fx = fixture(t, { config: { verify: { tailLines: 40, full: [{ name: 'lint', cmd: 'echo lint ok' }, { name: 'types', cmd: noisy }] } } });
    const r = fx.run('verify');
    assert.equal(r.status, 1, r.out);
    assert.deepEqual(stepLines(r.stdout).map((l) => l.replace(/ \(\d+s\).*$/, '')).sort(), ['✓ lint', '✗ types']);
    const tail = r.stdout.split('── types ──\n')[1] ?? '';
    assert.match(tail, /error TS2322: boom/);
    // 61 useful lines, 40 shown: the blank line and the package-manager noise are dropped
    assert.match(tail, /^line 22$/m);
    assert.doesNotMatch(tail, /^line 21$/m);
    assert.doesNotMatch(tail, /ELIFECYCLE/);
    assert.match(r.stdout, /✗ 1 step\(s\) red .* logs in tmp\/verify\//);
    assert.doesNotMatch(r.stdout, /lint ok/, 'a green step prints no output');
    const log = readFileSync(join(fx.wt, 'tmp/verify/types.log'), 'utf8');
    assert.match(log, /^line 1$/m);
    assert.match(log, /ELIFECYCLE noise/);
  });

  test('a step past its time limit is killed with its whole process group', (t) => {
    const fx = fixture(t, { config: { verify: { killGraceMs: 200, full: [{ name: 'hangs', cmd: 'sleep 30 & sleep 30', timeoutMs: 500 }] } } });
    const started = Date.now();
    const r = fx.run('verify');
    assert.equal(r.status, 1, r.out);
    assert.match(r.stdout, /hangs: exceeded its time limit/);
    assert.ok(Date.now() - started < 15_000, 'the background grandchild kept the step alive');
  });

  test('the tolerated flake passes only with its exact signature', (t) => {
    const fx = fixture(t);
    const outputs = {
      rpc: runnerOutput({ errors: 2, rpc: 2 }),
      failedTest: runnerOutput({ failed: true, errors: 1, rpc: 1 }),
      otherError: runnerOutput({ errors: 2, rpc: 1 }),
      otherTimeout: runnerOutput({ errors: 1, rpc: 1, rpcLine: 'Error: [vitest-worker]: Timeout calling "onTaskFinished"' }),
    };
    const full = Object.entries(outputs).map(([name, text]) => {
      const file = join(fx.base, `${name}.out`);
      writeFileSync(file, text);
      return { name, cmd: `cat '${file}'; exit 1`, serial: true };
    });
    fx.setConfig({ verify: { full } });
    const r = fx.run('verify');
    assert.equal(r.status, 1, r.out);
    const lines = stepLines(r.stdout);
    assert.match(lines.find((l) => l.includes(' rpc ')) ?? '', /^✓ rpc .*warning: test-runner RPC timeout/);
    for (const name of ['failedTest', 'otherError', 'otherTimeout']) assert.match(lines.find((l) => l.includes(` ${name} `)) ?? '', /^✗ /, name);
    assert.match(r.stdout, /✗ 3 step\(s\) red/);
  });

  test('onlyRpcTimeouts: coverage below its floor or no passing summary is never tolerated', () => {
    assert.equal(onlyRpcTimeouts(runnerOutput({ errors: 1, rpc: 1 })), true);
    assert.equal(onlyRpcTimeouts(`${runnerOutput({ errors: 1, rpc: 1 })}ERROR: Coverage for lines (79%) does not meet global threshold (80%)\n`), false);
    assert.equal(onlyRpcTimeouts(`${RPC}\n     Errors  1 error\n`), false);
    assert.equal(onlyRpcTimeouts(runnerOutput({ errors: 0, rpc: 0 })), false);
  });

  test('quick tier: rules select steps from the changed files, cheap ones first', () => {
    const rules = [
      { name: 'typecheck', cmd: 'tsc' },
      { name: 'lint', cmd: 'biome lint', appendChanged: /\.ts$/, first: true },
      { name: 'docs', cmd: 'check-docs', whenChanged: /^docs\// },
      { name: 'affected tests', cmd: 'vitest --changed {{integrationBranch}}', serial: true },
    ];
    assert.deepEqual(quickSteps(['src/a.ts', "src/it's.ts"], rules), [
      { name: 'lint', cmd: `biome lint 'src/a.ts' 'src/it'\\''s.ts'`, serial: undefined },
      { name: 'typecheck', cmd: 'tsc', serial: undefined },
      { name: 'affected tests', cmd: 'vitest --changed main', serial: true },
    ]);
    assert.deepEqual(
      quickSteps(['docs/x.md'], rules).map((s) => s.name),
      ['typecheck', 'docs', 'affected tests'],
    );
  });

  test('--quick runs the quick rules from the config, with the integration branch substituted', (t) => {
    const fx = fixture(t, { config: { verify: { quick: [{ name: 'affected', cmd: 'echo "changed since {{integrationBranch}}"' }] } } });
    const r = fx.run('verify', ['--quick']);
    assert.equal(r.status, 0, r.out);
    assert.match(r.stdout, /^verify --quick: affected$/m);
    assert.equal(readFileSync(join(fx.wt, 'tmp/verify/affected.log'), 'utf8'), 'changed since main\n');
  });
});
