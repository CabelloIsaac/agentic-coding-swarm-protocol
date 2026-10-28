/**
 * Git helpers for the multi-session dev tooling. Synchronous and dependency-free: these are short scripts run from a
 * terminal and from agent hooks.
 */
import { execFileSync } from 'node:child_process';
import { closeSync, existsSync, openSync, readFileSync, statSync, unlinkSync, writeSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config } from './dev-flow.config.ts';

export const INTEGRATION_BRANCH = config.integrationBranch;

export function git(cwd: string, ...args: string[]): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] }).trimEnd();
}

/** Like `git()`, but returns `undefined` if the command fails (e.g. a ref that does not exist). */
export function tryGit(cwd: string, ...args: string[]): string | undefined {
  try {
    return git(cwd, ...args);
  } catch {
    return undefined;
  }
}

export interface Worktree {
  path: string;
  head: string;
  /** Branch without `refs/heads/`; `undefined` on a detached HEAD. */
  branch?: string;
  main: boolean;
  /** Locked with `git worktree lock` (agent sessions do it while they live, so nothing deletes the worktree). */
  locked: boolean;
  /** Lock reason: agent sessions write their pid there ("agent session x (pid 90290 start …)"). */
  lockReason?: string;
}

/** The repo's worktrees; the first of `git worktree list` is always the main checkout. */
export function worktrees(cwd: string): Worktree[] {
  const blocks = git(cwd, 'worktree', 'list', '--porcelain').split('\n\n').filter(Boolean);
  return blocks.map((block, i) => {
    const field = (name: string) => block.split('\n').find((l) => l.startsWith(`${name} `))?.slice(name.length + 1);
    return {
      path: field('worktree') ?? '',
      head: field('HEAD') ?? '',
      branch: field('branch')?.replace(/^refs\/heads\//, ''),
      main: i === 0,
      locked: block.split('\n').some((l) => l === 'locked' || l.startsWith('locked ')),
      lockReason: field('locked')?.trim() || undefined,
    };
  });
}

/** Pid of the session that locked the worktree, if the lock reason carries it ("… (pid 64211 start …)"). */
export function lockPid(w: Pick<Worktree, 'lockReason'>): number | undefined {
  const m = /\(pid (\d+)\b/.exec(w.lockReason ?? '');
  return m ? Number(m[1]) : undefined;
}

export function toplevel(cwd: string): string {
  return git(cwd, 'rev-parse', '--show-toplevel');
}

export function mainCheckout(cwd: string): string {
  const main = worktrees(cwd)[0];
  if (!main) throw new Error('git worktree list did not return the main checkout');
  return main.path;
}

/** Is `cwd` a linked worktree (not the main checkout)? */
export function isLinkedWorktree(cwd: string): boolean {
  return resolve(toplevel(cwd)) !== resolve(mainCheckout(cwd));
}

/** Git's common directory (shared by every worktree): the land lock and the land log live there. */
export function commonDir(cwd: string): string {
  return resolve(cwd, git(cwd, 'rev-parse', '--git-common-dir'));
}

export function currentBranch(cwd: string): string | undefined {
  return tryGit(cwd, 'symbolic-ref', '--quiet', '--short', 'HEAD');
}

/** Paths from `git status --porcelain` (empty = clean tree). */
export function dirtyPaths(cwd: string): string[] {
  return git(cwd, 'status', '--porcelain', '--untracked-files=all')
    .split('\n')
    .filter(Boolean)
    .map((l) => l.slice(3));
}

/** Is a rebase or merge half-done? A hook must never commit in that state. */
export function operationInProgress(cwd: string): boolean {
  const dir = resolve(cwd, git(cwd, 'rev-parse', '--git-dir'));
  return ['rebase-merge', 'rebase-apply', 'MERGE_HEAD', 'CHERRY_PICK_HEAD'].some((f) => existsSync(resolve(dir, f)));
}

export function isAncestor(cwd: string, ancestor: string, descendant: string): boolean {
  return tryGit(cwd, 'merge-base', '--is-ancestor', ancestor, descendant) !== undefined;
}

/** Subjects of the branch's commits not yet in the integration branch, oldest first. */
export function pendingSubjects(cwd: string, base = INTEGRATION_BRANCH): string[] {
  return git(cwd, 'log', '--reverse', '--format=%s', `${base}..HEAD`).split('\n').filter(Boolean);
}

export const isWip = (subject: string) => /^wip:/.test(subject);

const STALE_LOCK_MS = config.staleLockMinutes * 60_000;

export interface LandLock {
  path: string;
  fd: number;
}

/** The land lock lives in the common directory; the automatic `wt gc` runs take it too, so they never delete at the same time as a land. */
export const landLockPath = (cwd: string) => join(commonDir(cwd), `${config.projectName}-land.lock`);

/** Who holds the land lock (branch and pid), if there is a lock and it can be read. */
export function readLandLock(cwd: string): { branch?: string; pid?: number } | undefined {
  try {
    const { branch, pid } = JSON.parse(readFileSync(landLockPath(cwd), 'utf8')) as { branch?: unknown; pid?: unknown };
    return { branch: typeof branch === 'string' ? branch : undefined, pid: typeof pid === 'number' ? pid : undefined };
  } catch {
    return undefined;
  }
}

/**
 * Is a live `land` integrating this branch right now? The Stop hook must not commit then: land fast-forwards only the
 * SHA it verified and aborts if the tip moves, so a `wip:` commit during verify would only make it fail.
 */
export function landRunningFor(cwd: string, branch: string): boolean {
  const lock = readLandLock(cwd);
  return lock?.branch === branch && lock.pid !== undefined && pidAlive(lock.pid);
}

/** `EPERM` is a live process of another user; only `ESRCH` says it does not exist. */
export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return (e as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/**
 * Takes the lock or returns `undefined` if someone else holds it. It is considered abandoned if its pid no longer
 * exists (a land that died halfway never releases it) or, without a readable pid, if it is older than the stale limit.
 */
export function tryLandLock(cwd: string, owner: string): LandLock | undefined {
  const path = landLockPath(cwd);
  if (existsSync(path)) {
    const pid = readLandLock(cwd)?.pid;
    const stale = pid !== undefined ? !pidAlive(pid) : Date.now() - statSync(path).mtimeMs > STALE_LOCK_MS;
    if (stale) unlinkSync(path);
  }
  try {
    // `wx` is the atomic part: exactly one process creates the file
    const fd = openSync(path, 'wx');
    writeSync(fd, JSON.stringify({ branch: owner, pid: process.pid, at: new Date().toISOString() }));
    return { path, fd };
  } catch {
    return undefined;
  }
}

export function releaseLandLock(lock: LandLock): void {
  closeSync(lock.fd);
  if (existsSync(lock.path)) unlinkSync(lock.path);
}

/** Versioned files the dev servers rewrite on start: restoring them never loses anyone's work. */
export const GENERATED_FILES = config.generatedFiles;

/** If the tree is dirty only because of generated files, restores them; any other change is left untouched. */
export function restoreGenerated(dir: string): string[] {
  const generated = dirtyPaths(dir).filter((f) => GENERATED_FILES.test(f));
  for (const f of generated) tryGit(dir, 'checkout', '--', f);
  return generated;
}
