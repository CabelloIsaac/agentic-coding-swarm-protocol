/**
 * One published integration branch: divergence from the remote, remote branches with unintegrated work, branch
 * archiving before deletion, and the versioned `pre-push` hook. No network except `fetchRemote`, `publish` and
 * `archiveBranch`: the warnings use the last known `fetch`.
 */
import { existsSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';
import { INTEGRATION_BRANCH, dirtyPaths, git, isAncestor, toplevel, tryGit, worktrees } from './git.ts';

export const REMOTE = config.remote;
const REMOTE_INTEGRATION = `${REMOTE}/${INTEGRATION_BRANCH}`;

export function hasRemote(cwd: string): boolean {
  return tryGit(cwd, 'remote', 'get-url', REMOTE) !== undefined;
}

export function fetchRemote(cwd: string): boolean {
  return tryGit(cwd, 'fetch', '--quiet', '--prune', REMOTE) !== undefined;
}

export interface Divergence {
  /** Commits of the integration branch that are not on the remote (unpublished). */
  unpublished: number;
  /** Commits of the remote integration branch that are not local (another history). */
  foreign: number;
  /** Days since the oldest unpublished commit. */
  oldestUnpublishedDays?: number;
}

/** Distance between the local and remote integration branch per the last `fetch`; `undefined` without remote or branch. */
export function divergence(cwd: string, now = Date.now()): Divergence | undefined {
  if (!hasRemote(cwd) || tryGit(cwd, 'rev-parse', '--verify', '--quiet', REMOTE_INTEGRATION) === undefined) return undefined;
  const [unpublished = 0, foreign = 0] = git(cwd, 'rev-list', '--left-right', '--count', `${INTEGRATION_BRANCH}...${REMOTE_INTEGRATION}`).split(/\s+/).map(Number);
  const oldest = unpublished ? git(cwd, 'log', '--reverse', '--format=%ct', `${REMOTE_INTEGRATION}..${INTEGRATION_BRANCH}`).split('\n')[0] : undefined;
  return { unpublished, foreign, oldestUnpublishedDays: oldest ? Math.floor((now - Number(oldest) * 1000) / 86_400_000) : undefined };
}

/** Commits of the remote integration branch missing locally, for the message of an aborted land. */
export function foreignCommits(cwd: string): string[] {
  return git(cwd, 'log', '--format=%h %s', `${INTEGRATION_BRANCH}..${REMOTE_INTEGRATION}`).split('\n').filter(Boolean);
}

/** Warning for `wt setup` and `wt status`; `undefined` if both branches match or there is no remote. */
export function divergenceWarning(cwd: string, now = Date.now()): string | undefined {
  const d = divergence(cwd, now);
  if (!d || (!d.unpublished && !d.foreign)) return undefined;
  if (d.foreign)
    return (
      `DIVERGENCE WARNING: ${REMOTE_INTEGRATION} has ${d.foreign} commit(s) that ${INTEGRATION_BRANCH} lacks and ${INTEGRATION_BRANCH} has ${d.unpublished} unpublished. ` +
      'There are two histories: do not integrate or publish until they are reconciled (only the designated publisher clone commits and publishes).'
    );
  const age = d.oldestUnpublishedDays ? `, the oldest ${d.oldestUnpublishedDays} day(s) old` : '';
  return `WARNING: ${INTEGRATION_BRANCH} has ${d.unpublished} unpublished commit(s)${age}. The next pnpm land publishes them (or git push ${REMOTE} ${INTEGRATION_BRANCH}).`;
}

/** Publishes the integration branch; returns git's error if it fails. */
export function publish(cwd: string): string | undefined {
  try {
    git(cwd, 'push', '--quiet', REMOTE, `refs/heads/${INTEGRATION_BRANCH}:refs/heads/${INTEGRATION_BRANCH}`);
    return undefined;
  } catch (e) {
    return String((e as { stderr?: unknown }).stderr ?? (e as Error).message).trim();
  }
}

export interface RemoteBranchStatus {
  branch: string;
  /** Commits without an equivalent patch on the integration branch (`git cherry`). */
  pending: number;
  /** Of those, the ones that are also on the remote integration branch (covered by whatever is done with that branch). */
  inRemoteIntegration: number;
  lastCommit: string;
}

/** Remote branches (except the integration branch) with their unintegrated work, per the last `fetch`. */
export function remoteBranches(cwd: string): RemoteBranchStatus[] {
  if (!hasRemote(cwd)) return [];
  const refs = git(cwd, 'for-each-ref', '--format=%(refname:short)', `refs/remotes/${REMOTE}/`).split('\n').filter(Boolean);
  const hasRemoteIntegration = refs.includes(REMOTE_INTEGRATION);
  return refs
    .filter((r) => r !== REMOTE_INTEGRATION && r !== REMOTE && r !== `${REMOTE}/HEAD`)
    .map((ref) => {
      const pending = git(cwd, 'cherry', INTEGRATION_BRANCH, ref)
        .split('\n')
        .filter((l) => l.startsWith('+'))
        .map((l) => l.slice(2));
      return {
        branch: ref.slice(REMOTE.length + 1),
        pending: pending.length,
        inRemoteIntegration: hasRemoteIntegration ? pending.filter((sha) => isAncestor(cwd, sha, REMOTE_INTEGRATION)).length : 0,
        lastCommit: git(cwd, 'log', '-1', '--format=%cr', ref),
      };
    });
}

export function formatRemoteBranches(rows: RemoteBranchStatus[]): string {
  return rows
    .map((r) => {
      const state = r.pending ? `+${r.pending}${r.inRemoteIntegration ? ` (${r.inRemoteIntegration} of ${REMOTE_INTEGRATION})` : ''}` : 'already integrated';
      return `${`${REMOTE}/${r.branch}`.padEnd(40)} ${state.padEnd(48)} ${r.lastCommit}`;
    })
    .join('\n');
}

export class ArchiveError extends Error {}

export interface ArchiveResult {
  tag: string;
  sha: string;
  removedWorktree?: string;
  deletedLocal: boolean;
  deletedRemote: boolean;
}

/** Name of the archive tag: `archive/<YYYY-MM-DD>-<branch with / → ->`. */
export function archiveTagName(branch: string, date = new Date()): string {
  return `archive/${date.toISOString().slice(0, 10)}-${branch.replaceAll('/', '-')}`;
}

/**
 * Archives a branch before deleting it: an annotated tag on its tip, published and verified on the remote; only then
 * does it delete its worktree (if clean), the local branch and the remote one. Without the published tag nothing is deleted.
 */
export function archiveBranch(cwd: string, branch: string, date = new Date()): ArchiveResult {
  if (branch === INTEGRATION_BRANCH) throw new ArchiveError(`${INTEGRATION_BRANCH} is never archived`);
  if (!hasRemote(cwd)) throw new ArchiveError(`no remote ${REMOTE}: the tag cannot be published and nothing is deleted`);
  fetchRemote(cwd);
  const local = tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/heads/${branch}`);
  const remote = tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/remotes/${REMOTE}/${branch}`);
  if (!local && !remote) throw new ArchiveError(`branch ${branch} exists neither locally nor on ${REMOTE}`);
  let sha = (local ?? remote) as string;
  if (local && remote && local !== remote) {
    if (isAncestor(cwd, remote, local)) sha = local;
    else if (isAncestor(cwd, local, remote)) sha = remote;
    else throw new ArchiveError(`local ${branch} and ${REMOTE}/${branch} have diverged: archive each one separately or reconcile them`);
  }
  const holder = worktrees(cwd).find((w) => w.branch === branch);
  if (holder && !holder.main && existsSync(holder.path) && dirtyPaths(holder.path).length)
    throw new ArchiveError(`worktree ${holder.path} has uncommitted changes: commit or move them before archiving`);
  if (holder && holder.path === toplevel(cwd)) throw new ArchiveError('the branch of the worktree you are running from is never archived');
  // A lock is put by the session working there (or by someone on purpose): archiving would pull the floor from under it
  if (holder?.locked) throw new ArchiveError(`worktree ${holder.path} is locked (${holder.lockReason ?? 'no reason'}): close that session or run git worktree unlock before archiving`);

  const tag = archiveTagName(branch, date);
  const existing = tryGit(cwd, 'rev-parse', '--verify', '--quiet', `refs/tags/${tag}^{commit}`);
  if (existing && existing !== sha) throw new ArchiveError(`tag ${tag} already exists on another commit (${existing.slice(0, 8)})`);
  if (!existing) git(cwd, 'tag', '-a', tag, '-m', `Archive of ${branch} before deleting it (pnpm wt:archive)`, sha);
  try {
    git(cwd, 'push', '--quiet', REMOTE, `refs/tags/${tag}`);
  } catch (e) {
    throw new ArchiveError(`could not publish ${tag}; nothing was deleted: ${String((e as { stderr?: unknown }).stderr ?? '').trim()}`);
  }
  // Verify, do not trust the push exit code: the tag must be on the remote and point at the same commit
  const published = tryGit(cwd, 'ls-remote', '--tags', REMOTE, `refs/tags/${tag}^{}`)?.split(/\s+/)[0];
  if (published !== sha) throw new ArchiveError(`${tag} does not appear on ${REMOTE} pointing at ${sha.slice(0, 8)}; nothing was deleted`);

  const result: ArchiveResult = { tag, sha, deletedLocal: false, deletedRemote: false };
  if (holder && !holder.main && existsSync(holder.path)) {
    git(cwd, 'worktree', 'remove', holder.path);
    result.removedWorktree = holder.path;
  }
  if (local) {
    git(cwd, 'branch', '-D', branch);
    result.deletedLocal = true;
  }
  if (remote) {
    git(cwd, 'push', '--quiet', REMOTE, '--delete', branch);
    result.deletedRemote = true;
  }
  return result;
}

/** Activates the versioned hooks in the clone if they exist and are not active yet. */
export function ensureHooks(cwd: string): boolean {
  const root = toplevel(cwd);
  if (!existsSync(join(root, config.hooksDir, 'pre-push'))) return false;
  if (tryGit(root, 'config', '--get', 'core.hooksPath') === config.hooksDir) return false;
  git(root, 'config', 'core.hooksPath', config.hooksDir);
  return true;
}
