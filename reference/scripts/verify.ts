/**
 * The single quality gate: runs the same checks as CI and prints only a summary and the tail of each failure, so a
 * session does not spend context reading full logs.
 *
 *   pnpm verify           everything (what `pnpm land` requires)
 *   pnpm verify --quick   development loop: lint, types, structural rules and tests affected relative to the integration branch
 *
 * Full logs are left in `<config.verify.logDir>/<step>.log`. The steps themselves live in dev-flow.config.ts.
 *
 * Ratchets (`ratchets.ts`): the full tier runs them as the last serial step, after the tests, because the coverage
 * ratchet reads the summary the test step writes; serial steps run in their config order. The quick tier checks only
 * the file-size and silent-error ratchets, on the changed files. `land` tightens the ratchets file after a green full
 * run.
 *
 * Formatter (`format` step, both tiers): `config.format.check` on the whole repo in the full tier (it must exit
 * non-zero when something is unformatted; Biome does), `config.format.quickCheck` plus the changed files in the quick
 * tier. A formatter that is installed but switched off is not a gate: the reference project had it off and 3,232 lines
 * over 200 characters. The step lists live in dev-flow.config.ts and read the same commands from `config.format`.
 *
 * Dependencies (`deps` step, full tier, serial, last): `deps-audit.ts` runs the stack's audit as JSON and fails on a
 * critical or high advisory unless `deps-allowlist.json` has an unexpired entry for it. It needs the network, so the
 * quick tier does not run it.
 */
import { spawn } from 'node:child_process';
import { existsSync, mkdirSync, readdirSync, rmSync, statSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { config, type QuickRule, type VerifyStep } from './dev-flow.config.ts';
import { INTEGRATION_BRANCH, git, toplevel } from './git.ts';

export type Step = VerifyStep;

export interface StepResult {
  name: string;
  ok: boolean;
  seconds: number;
  output: string;
  warning?: string;
}

const TAIL_LINES = config.verify.tailLines;
const STEP_TIMEOUT_MS = config.verify.stepTimeoutMinutes * 60_000;
const KILL_GRACE_MS = config.verify.killGraceMs;

export function fullSteps(): Step[] {
  return config.verify.full.map((s) => ({ ...s }));
}

const quote = (s: string) => `'${s.replaceAll("'", "'\\''")}'`;

/** Quick tier: built from the changed files and the rules in the config. */
export function quickSteps(changed: string[], rules: QuickRule[] = config.verify.quick): Step[] {
  const steps: Step[] = [];
  const first: Step[] = [];
  for (const rule of rules) {
    if (rule.whenChanged && !changed.some((f) => rule.whenChanged?.test(f))) continue;
    let cmd = rule.cmd.replaceAll('{{integrationBranch}}', INTEGRATION_BRANCH);
    if (rule.appendChanged) {
      const files = changed.filter((f) => rule.appendChanged?.test(f));
      if (!files.length) continue;
      cmd += ` ${files.map(quote).join(' ')}`;
    }
    (rule.first ? first : steps).push({ name: rule.name, cmd, serial: rule.serial });
  }
  return [...first, ...steps];
}

/** Optional suites only run with an external resource: make it visible when they were skipped. */
export function optionalSuiteNotes(env: Record<string, string | undefined> = process.env): string[] {
  return config.verify.optionalSuites.map((s) => (env[s.envVar]?.trim() ? `${s.name}: contract suites included (${s.envVar})` : `${s.name}: skipped (no ${s.envVar}; ${s.hint})`));
}

/** Files changed relative to the integration branch, committed or not. */
export function changedFiles(cwd: string): string[] {
  const committed = git(cwd, 'diff', '--name-only', `${INTEGRATION_BRANCH}...HEAD`);
  const local = git(cwd, 'diff', '--name-only', 'HEAD');
  const untracked = git(cwd, 'ls-files', '--others', '--exclude-standard');
  return [...new Set([committed, local, untracked].join('\n').split('\n').filter(Boolean))];
}

/** Process groups of the running steps: each step leads its own group (`detached`), so its grandchildren fall too. */
const running = new Set<number>();

function killGroup(pid: number, signal: NodeJS.Signals): void {
  try {
    process.kill(-pid, signal);
  } catch {
    // the group no longer exists
  }
}

function runStep(cwd: string, step: Step): Promise<StepResult> {
  const started = Date.now();
  return new Promise((done) => {
    // Own group: the test runner spawns workers and the dev framework spawns servers; killing only `sh` would orphan them
    const child = spawn('sh', ['-c', step.cmd], { cwd, detached: true, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
    const pid = child.pid;
    if (pid) running.add(pid);
    let output = '';
    let timedOut = false;
    child.stdout.on('data', (d) => (output += d));
    child.stderr.on('data', (d) => (output += d));
    const timer = setTimeout(() => {
      if (!pid) return;
      timedOut = true;
      killGroup(pid, 'SIGTERM');
      setTimeout(() => killGroup(pid, 'SIGKILL'), KILL_GRACE_MS).unref();
    }, step.timeoutMs ?? STEP_TIMEOUT_MS);
    // `sh` finished, but a background child of the step may still be alive in the group (and, with the output pipe
    // open, would delay `close` until it died)
    child.on('exit', () => {
      if (pid) killGroup(pid, 'SIGKILL');
    });
    child.on('close', (code) => {
      clearTimeout(timer);
      if (pid) running.delete(pid);
      const seconds = Math.round((Date.now() - started) / 1000);
      if (timedOut) output += `\n${step.name}: exceeded its time limit (${Math.round((step.timeoutMs ?? STEP_TIMEOUT_MS) / 1000)}s); process group terminated\n`;
      const rpc = !timedOut && code !== 0 && onlyRpcTimeouts(output);
      done({ name: step.name, ok: !timedOut && (code === 0 || rpc), seconds, output, warning: rpc ? 'test-runner RPC timeout caused by machine load; every test passes' : undefined });
    });
  });
}

/** If verify itself is killed (Ctrl-C, closed session) it takes the steps' groups with it and dies with the same signal. */
function onSignal(signal: NodeJS.Signals): void {
  for (const pid of running) killGroup(pid, 'SIGKILL');
  running.clear();
  removeSignalHandlers();
  process.kill(process.pid, signal);
}

const SIGNALS: NodeJS.Signals[] = ['SIGINT', 'SIGTERM', 'SIGHUP'];
const addSignalHandlers = () => {
  for (const s of SIGNALS) process.on(s, onSignal);
};
const removeSignalHandlers = () => {
  for (const s of SIGNALS) process.off(s, onSignal);
};

export async function runSteps(cwd: string, steps: Step[], log: (line: string) => void = console.log): Promise<StepResult[]> {
  const report = (r: StepResult) => {
    log(`${r.ok ? '✓' : '✗'} ${r.name} (${r.seconds}s)${r.warning ? ` · warning: ${r.warning}` : ''}`);
    return r;
  };
  addSignalHandlers();
  try {
    const parallel = await Promise.all(steps.filter((s) => !s.serial).map((s) => runStep(cwd, s).then(report)));
    const serial: StepResult[] = [];
    for (const s of steps.filter((s) => s.serial)) serial.push(report(await runStep(cwd, s)));
    return [...parallel, ...serial];
  } finally {
    removeSignalHandlers();
  }
}

/**
 * The test runner exits with an error if a worker cannot report its progress (`onTaskUpdate`) within 60 s, which
 * happens on a machine saturated by other sessions even when every test passes. It is accepted only when nothing else
 * is wrong: no failed test or file, no other uncaught error, and coverage above its floor. This is the one tolerated
 * flake, matched by its exact signature; nothing else is ever tolerated.
 */
export function onlyRpcTimeouts(output: string): boolean {
  const errors = Number(/^\s*Errors\s+(\d+) errors?/m.exec(output)?.[1] ?? 0);
  const rpc = output.match(/^Error: \[vitest-worker\]: Timeout calling "onTaskUpdate"$/gm)?.length ?? 0;
  return (
    /^\s*Tests\s+\d+ passed/m.test(output) &&
    !/^\s*(Test Files|Tests)\s+.*failed/m.test(output) &&
    !/ERROR: Coverage/.test(output) &&
    errors > 0 &&
    rpc === errors
  );
}

/** The last useful lines of a failure: no blank lines and no package-manager noise. */
export function failureTail(output: string, lines = TAIL_LINES): string {
  return output
    .split('\n')
    .filter((l) => l.trim() && !/^\s*(ELIFECYCLE|ERR_PNPM_|✓)/.test(l))
    .slice(-lines)
    .join('\n');
}

/** Files the framework regenerates on start but that are no longer versioned: without them `tsc` fails on a clean checkout. */
export function ensureGeneratedFiles(root: string): void {
  for (const f of config.verify.ensureFiles) {
    const file = join(root, f.path);
    if (!existsSync(file) && existsSync(dirname(file))) writeFileSync(file, f.content);
  }
}

/**
 * Defensive sweep: deletes `<tmpPrefix>*` entries in the temp directory older than `maxAgeMin` minutes (leftovers of
 * tests that died before cleaning up; ~173,000 of them once filled a disk). Returns how many it deleted.
 */
export function sweepStaleTmp(dir = tmpdir(), maxAgeMin = config.verify.tmpMaxAgeMinutes, now = Date.now()): number {
  let removed = 0;
  for (const name of readdirSync(dir)) {
    if (!name.startsWith(config.tmpPrefix)) continue;
    const path = join(dir, name);
    try {
      if (now - statSync(path).mtimeMs < maxAgeMin * 60_000) continue;
      rmSync(path, { recursive: true, force: true });
      removed++;
    } catch {
      // another session may have deleted it at the same time: not an error
    }
  }
  return removed;
}

export async function verify(cwd: string, quick: boolean): Promise<boolean> {
  const root = toplevel(cwd);
  ensureGeneratedFiles(root);
  const steps = quick ? quickSteps(changedFiles(root)) : fullSteps();
  console.log(`verify${quick ? ' --quick' : ''}: ${steps.map((s) => s.name).join(', ')}`);
  for (const note of optionalSuiteNotes()) console.log(note);
  const swept = sweepStaleTmp();
  if (swept) console.log(`tmp: ${swept} old ${config.tmpPrefix}* root(s) deleted from ${tmpdir()}`);
  const started = Date.now();
  const results = await runSteps(root, steps);
  const logDir = join(root, config.verify.logDir);
  mkdirSync(logDir, { recursive: true });
  for (const r of results) writeFileSync(join(logDir, `${r.name.replace(/[^a-z0-9]+/gi, '-')}.log`), r.output);
  const failed = results.filter((r) => !r.ok);
  for (const r of failed) console.log(`\n── ${r.name} ──\n${failureTail(r.output)}`);
  const seconds = Math.round((Date.now() - started) / 1000);
  console.log(failed.length ? `\n✗ ${failed.length} step(s) red (${seconds}s) · logs in ${config.verify.logDir}/` : `\n✓ all green (${seconds}s)`);
  return failed.length === 0;
}

if (import.meta.main) {
  const ok = await verify(process.cwd(), process.argv.includes('--quick'));
  process.exit(ok ? 0 : 1);
}
