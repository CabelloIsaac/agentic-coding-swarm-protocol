/**
 * Throw-away repositories for the self-tests of the reference scripts: a bare "remote", a main clone on the integration
 * branch (the publisher, with the versioned `pre-push` hook active) and a linked worktree on a feature branch. Every
 * script runs as a real subprocess (`node scripts/<name>.ts`), the way hooks and people run it, with its config
 * overridden through `DEV_FLOW_CONFIG`. Only `node:` built-ins: the public repo has no dependencies.
 */
import { type SpawnSyncReturns, execFileSync, spawnSync } from 'node:child_process';
import { chmodSync, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import type { TestContext } from 'node:test';

export const SCRIPTS = resolve(import.meta.dirname, '../scripts');
export const PRE_PUSH = resolve(import.meta.dirname, '../config/pre-push');
/** Defaults of `dev-flow.config.ts` the fixtures rely on (the env var is `<envPrefix>LAND_VERIFY`). */
export const BRANCH = 'main';
export const PROJECT = 'myproject';
export const LAND_VERIFY = 'MYPROJECT_LAND_VERIFY';
export const PUBLISHER_FLAG = 'myproject.publisher';

// Isolation from the machine running the tests: no global or system git config (hooks, signing, templates), a fixed
// identity, and no GIT_* variables inherited from a hook that may be running the suite.
for (const key of ['GIT_DIR', 'GIT_WORK_TREE', 'GIT_INDEX_FILE', 'GIT_COMMON_DIR', 'GIT_OBJECT_DIRECTORY', 'DEV_FLOW_CONFIG', LAND_VERIFY]) delete process.env[key];
Object.assign(process.env, {
  GIT_CONFIG_NOSYSTEM: '1',
  GIT_CONFIG_GLOBAL: process.platform === 'win32' ? 'NUL' : '/dev/null',
  GIT_AUTHOR_NAME: 'Self Test',
  GIT_AUTHOR_EMAIL: 'self-test@example.com',
  GIT_COMMITTER_NAME: 'Self Test',
  GIT_COMMITTER_EMAIL: 'self-test@example.com',
  GIT_TERMINAL_PROMPT: '0',
});

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

export function tryGit(cwd: string, ...args: string[]): string | undefined {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
}

/** Writes `files` (relative path → content) and commits them; returns the new SHA. */
export function commit(cwd: string, message: string, files: Record<string, string> = {}): string {
  for (const [path, content] of Object.entries(files)) write(cwd, path, content);
  git(cwd, 'add', '-A');
  git(cwd, 'commit', '-q', '--allow-empty', '-m', message);
  return git(cwd, 'rev-parse', 'HEAD');
}

export function write(cwd: string, path: string, content: string): void {
  mkdirSync(dirname(join(cwd, path)), { recursive: true });
  writeFileSync(join(cwd, path), content);
}

export const sha = (cwd: string, ref = 'HEAD') => git(cwd, 'rev-parse', ref);
export const subjects = (cwd: string, range: string) => git(cwd, 'log', '--format=%s', range).split('\n').filter(Boolean);

export interface RunResult {
  status: number | null;
  stdout: string;
  stderr: string;
  /** stdout and stderr together, for assertions on messages. */
  out: string;
}

export interface Fixture {
  /** Temp folder that holds everything; deleted after the test. */
  base: string;
  remote: string;
  /** Main checkout, on the integration branch. */
  main: string;
  /** Linked worktree on `branch`. */
  wt: string;
  branch: string;
  configPath: string;
  /** Land lock and land log, in git's common directory. */
  lockPath: string;
  logPath: string;
  /** Runs `node scripts/<script>.ts <args>` in `cwd` (the worktree by default) with the fixture's config. */
  run(script: string, args?: string[], opts?: { cwd?: string; env?: Record<string, string> }): RunResult;
  /** Entries of the land log (JSONL). */
  landLog(): Record<string, unknown>[];
  /** Overrides more config keys (merged over the current override). */
  setConfig(over: Record<string, unknown>): void;
}

export interface FixtureOptions {
  /** Merged over the base override (see `baseConfig`). */
  config?: Record<string, unknown>;
  /** Mark the main clone as the publisher (default `true`). */
  publisher?: boolean;
  /** Extra files of the first commit. */
  files?: Record<string, string>;
}

/** Keeps the scripts' side effects inside the fixture: `verify` sweeps `<tmpPrefix>*` in the temp dir. */
const baseConfig = (base: string) => ({ tmpPrefix: `swarm-selftest-sweep-${base.slice(-6)}-` });

function merge(a: Record<string, unknown>, b: Record<string, unknown>): Record<string, unknown> {
  const out = { ...a };
  for (const [k, v] of Object.entries(b)) {
    const cur = out[k];
    const plain = (x: unknown): x is Record<string, unknown> => typeof x === 'object' && x !== null && !Array.isArray(x);
    out[k] = plain(cur) && plain(v) ? merge(cur, v) : v;
  }
  return out;
}

/** Builds the fixture and registers its cleanup in the test's `after`. */
export function fixture(t: TestContext, opts: FixtureOptions = {}): Fixture {
  const base = mkdtempSync(join(realpathSync(tmpdir()), 'swarm-selftest-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  const remote = join(base, 'remote.git');
  const main = join(base, 'main');
  const wt = join(base, 'feature');
  const branch = 'feature';
  const configPath = join(base, 'dev-flow.json');
  let override = merge(baseConfig(base), opts.config ?? {});
  writeFileSync(configPath, JSON.stringify(override, null, 2));

  git(base, 'init', '-q', '--bare', '-b', BRANCH, remote);
  git(base, 'init', '-q', '-b', BRANCH, main);
  mkdirSync(join(main, '.githooks'), { recursive: true });
  copyFileSync(PRE_PUSH, join(main, '.githooks', 'pre-push'));
  chmodSync(join(main, '.githooks', 'pre-push'), 0o755);
  git(main, 'config', 'core.hooksPath', '.githooks');
  if (opts.publisher ?? true) git(main, 'config', '--bool', PUBLISHER_FLAG, 'true');
  commit(main, 'initial commit', { 'README.md': '# fixture\n', '.gitignore': 'tmp/\n', ...opts.files });
  git(main, 'remote', 'add', 'origin', remote);
  // The very first publish happens before the fixture's rules apply
  git(main, 'push', '-q', '--no-verify', 'origin', BRANCH);
  git(main, 'fetch', '-q', 'origin');
  git(main, 'worktree', 'add', '-q', '-b', branch, wt, BRANCH);

  const common = join(main, '.git');
  const fx: Fixture = {
    base,
    remote,
    main,
    wt,
    branch,
    configPath,
    lockPath: join(common, `${PROJECT}-land.lock`),
    logPath: join(common, `${PROJECT}-land-log.jsonl`),
    run(script, args = [], o = {}) {
      const r: SpawnSyncReturns<string> = spawnSync(process.execPath, [join(SCRIPTS, `${script}.ts`), ...args], {
        cwd: o.cwd ?? wt,
        encoding: 'utf8',
        env: { ...process.env, DEV_FLOW_CONFIG: configPath, MAIN: main, REMOTE: remote, ...o.env },
        timeout: 120_000,
      });
      if (r.error) throw r.error;
      return { status: r.status, stdout: r.stdout, stderr: r.stderr, out: `${r.stdout}${r.stderr}` };
    },
    landLog() {
      if (!existsSync(fx.logPath)) return [];
      return readFileSync(fx.logPath, 'utf8')
        .split('\n')
        .filter(Boolean)
        .map((l) => JSON.parse(l) as Record<string, unknown>);
    },
    setConfig(over) {
      override = merge(override, over);
      writeFileSync(configPath, JSON.stringify(override, null, 2));
    },
  };
  return fx;
}

/** A pid that certainly belongs to no live process: a child that has already exited. */
export function deadPid(): number {
  const r = spawnSync(process.execPath, ['-e', '0']);
  if (!r.pid) throw new Error('could not spawn a child to obtain a dead pid');
  return r.pid;
}
