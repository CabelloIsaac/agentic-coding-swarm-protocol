/**
 * Integrates the worktree's branch into the integration branch: fetch → rebase → numbered ADRs and index → full
 * verification → tightened quality ratchets (a commit of that one file) → fast-forward → push. One at a time (a lock in git's common directory) and never advancing the
 * integration branch with anything red. It integrates exactly the commit it verified: the SHA is recorded right before
 * verify, and if the branch moved meanwhile (a Stop-hook `wip:` commit, a stray edit) it aborts instead of
 * fast-forwarding to a tip nobody verified. With a remote, it aborts if the remote integration branch has commits the
 * local one lacks (two histories) and publishes the branch at the end (a single published history, only from the
 * designated publisher clone).
 *
 *   pnpm land                     integrate the branch's commits and publish
 *   pnpm land --squash "<msg>"    squash the commits first (needed when intermediate wip commits remain)
 *   pnpm land --no-push           integrate locally only (no network); `wt setup` warns until it is published
 *   pnpm land --no-review "<why>" skip the review gate; the reason is written to the land log
 *
 * Review gate (INTEGRATION.md L2.7): after the rebase and before the ADR commit and verify, a change the review mode
 * covers (`always`, or `sensitive` with a sensitive path changed) needs a passing receipt for its patch id
 * (`review-receipt.ts`), or land aborts before spending minutes on verify.
 *
 * `<ENV_PREFIX>LAND_VERIFY="<command>"` replaces the verification (only for this script's own tests).
 * If the rebase changes the lockfile, dependencies are reinstalled before verifying (otherwise verify fails with
 * "Cannot find module" for a package that is new on the integration branch).
 */
import { execFileSync } from 'node:child_process';
import { appendFileSync, existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { numberDraftAdrs, updateAdrIndex } from './adr.ts';
import { config, landVerifyEnv } from './dev-flow.config.ts';
import {
  INTEGRATION_BRANCH,
  commonDir,
  currentBranch,
  dirtyPaths,
  git,
  isAncestor,
  isLinkedWorktree,
  isWip,
  type LandLock,
  landLockPath,
  pendingSubjects,
  releaseLandLock,
  restoreGenerated,
  toplevel,
  tryGit,
  tryLandLock,
  worktrees,
} from './git.ts';
import { tightenFile } from './ratchets.ts';
import { loadReviewConfig, reviewGate } from './review-receipt.ts';
import { fetchRemote, foreignCommits, hasRemote, publish, REMOTE } from './remote.ts';
import { verify } from './verify.ts';
import { formatGc, gc } from './wt.ts';

const MAX_ATTEMPTS = config.landMaxAttempts;

export class LandError extends Error {}

export interface LandResult {
  branch: string;
  commits: number;
  attempts: number;
  head: string;
  seconds: number;
  /** `true` if the integration branch was published on the remote; `undefined` without remote or with `--no-push`. */
  pushed?: boolean;
  /** Git's error if the push failed (the integration branch already advanced locally). */
  pushError?: string;
}

export interface LandOptions {
  squash?: string;
  verifyCmd?: string;
  /** Install after a rebase that changes the lockfile; defaults to `config.installCommand`. */
  installCmd?: string;
  /** Integrate locally only: do not publish, and a failed fetch does not abort. */
  noPush?: boolean;
  /** Skip the review gate; the reason is mandatory and goes to the land log. */
  noReview?: string;
  log?: (line: string) => void;
}

export async function land(cwd: string, opts: LandOptions = {}): Promise<LandResult> {
  const log = opts.log ?? console.log;
  const started = Date.now();
  // Guards first, before the lock: they are cheap and they must not make anyone wait
  if (!isLinkedWorktree(cwd)) throw new LandError('pnpm land runs from a session worktree, not from the main checkout');
  const root = toplevel(cwd);
  const branch = currentBranch(root);
  if (!branch || branch === INTEGRATION_BRANCH) throw new LandError(`the worktree must be on its own branch (it is on ${branch ?? 'a detached HEAD'})`);
  if (existsSync(join(root, '.env'))) throw new LandError('there is a .env in the worktree: real spending only happens from the main checkout. Delete it and retry');
  const dirty = dirtyPaths(root);
  if (dirty.length) throw new LandError(`${dirty.length} uncommitted change(s): pnpm wt:commit "<message>" and retry`);
  if (opts.noReview !== undefined && !opts.noReview.trim()) throw new LandError('--no-review needs a reason: pnpm land --no-review "<why>"');

  prepareCommits(root, opts.squash);
  const commits = pendingSubjects(root).length;
  if (commits === 0) throw new LandError(`the branch has no new commits relative to ${INTEGRATION_BRANCH}`);

  const lock = acquireLock(root, branch);
  let attempts = 0;
  let head = '';
  try {
    const remote = hasRemote(root);
    if (remote) checkRemote(root, opts, log);
    if (opts.noReview !== undefined) {
      record(root, { branch, result: 'review-bypassed', reason: opts.noReview });
      log(`review gate skipped (--no-review): ${opts.noReview}`);
    }
    for (;;) {
      attempts++;
      if (attempts > MAX_ATTEMPTS) throw new LandError(`${INTEGRATION_BRANCH} moved ${MAX_ATTEMPTS} times during verification; run pnpm land again`);
      if (rebase(root)) {
        log(`${config.lockfile} changed with the rebase: reinstalling dependencies…`);
        if (!runQuiet(root, opts.installCmd ?? config.installCommand)) throw new LandError(`dependency install failed after the rebase: ${INTEGRATION_BRANCH} was not touched`);
      }
      if (opts.noReview === undefined) enforceReview(root, log);
      const docs = regenerateDocs(root);
      if (docs) log(docs);
      // The exact commit under verification: only this SHA may reach the integration branch
      const verified = git(root, 'rev-parse', 'HEAD');
      log(`verifying ${pendingSubjects(root).length} commit(s) on top of ${git(root, 'rev-parse', '--short', INTEGRATION_BRANCH)} (${verified.slice(0, 8)})…`);
      const ok = opts.verifyCmd ? runQuiet(root, opts.verifyCmd) : await verify(root, false);
      if (!ok) throw new LandError(`verification failed: ${INTEGRATION_BRANCH} was not touched`);
      assertUnchanged(root, verified);
      if (!isAncestor(root, INTEGRATION_BRANCH, verified)) {
        log(`${INTEGRATION_BRANCH} moved during verification: rebasing and verifying again`);
        continue;
      }
      const landed = tightenRatchets(root, verified, log);
      advanceIntegration(root, landed);
      head = landed;
      break;
    }
    // Inside the lock, so it does not race the gc of another land or of a session start in the main checkout
    const published: Pick<LandResult, 'pushed' | 'pushError'> = {};
    if (remote && !opts.noPush) {
      published.pushError = publish(root);
      published.pushed = !published.pushError;
      if (published.pushError) log(`✗ ${INTEGRATION_BRANCH} integrated locally but NOT published: ${published.pushError}\n  Retry: git push ${REMOTE} ${INTEGRATION_BRANCH}`);
    }
    const cleaned = await cleanMerged(root);
    if (cleaned) log(cleaned);
    const result: LandResult = { branch, commits, attempts, head: head.slice(0, 8), seconds: Math.round((Date.now() - started) / 1000), ...published };
    record(root, { ...result, result: 'landed' });
    return result;
  } catch (e) {
    record(root, { branch, commits, attempts, seconds: Math.round((Date.now() - started) / 1000), result: 'failed', reason: (e as Error).message });
    throw e;
  } finally {
    releaseLandLock(lock);
  }
}

/**
 * Before integrating: fetch and check that the remote integration branch has no commits the local one lacks. Without
 * network it only continues with `--no-push`; with two histories it never continues.
 */
function checkRemote(root: string, opts: LandOptions, log: (line: string) => void): void {
  if (!fetchRemote(root)) {
    if (!opts.noPush) throw new LandError(`could not fetch ${REMOTE} (no network?): ${INTEGRATION_BRANCH} was not touched. To integrate locally only: pnpm land --no-push`);
    log(`no access to ${REMOTE}: integrating locally only (--no-push)`);
  }
  if (tryGit(root, 'rev-parse', '--verify', '--quiet', `${REMOTE}/${INTEGRATION_BRANCH}`) === undefined) return;
  const foreign = foreignCommits(root);
  if (!foreign.length) return;
  const listed = foreign.slice(0, 10).map((c) => `  ${c}`).join('\n');
  const more = foreign.length > 10 ? `\n  … and ${foreign.length - 10} more` : '';
  throw new LandError(
    `${REMOTE}/${INTEGRATION_BRANCH} has ${foreign.length} commit(s) that ${INTEGRATION_BRANCH} lacks (two histories; ${INTEGRATION_BRANCH} was not touched):\n${listed}${more}\n` +
      'Someone published from another clone. Reconcile before integrating (single-publisher rule).',
  );
}

/** `wt gc` of already-integrated worktrees (the current one stays). A failure here does not undo a land that is done. */
async function cleanMerged(root: string): Promise<string | undefined> {
  try {
    const r = await gc(root);
    if (!r.removed.length && !r.inUse.length) return undefined;
    return `gc: ${formatGc(r).split('\n').join(' · ')}`;
  } catch (e) {
    return `gc: could not complete (${(e as Error).message}); pnpm wt:gc retries it`;
  }
}

/** wip commits: with `--squash` they are folded into one; without it they are accepted only if there are none. */
function prepareCommits(root: string, squash: string | undefined): void {
  const subjects = pendingSubjects(root);
  if (squash) {
    if (!squash.trim()) throw new LandError('--squash needs a message');
    git(root, 'reset', '--soft', git(root, 'merge-base', INTEGRATION_BRANCH, 'HEAD'));
    git(root, 'commit', '-q', '-m', squash);
    return;
  }
  if (subjects.some(isWip))
    throw new LandError('the branch has wip commits (Stop hook): pnpm wt:commit "<message>" absorbs them, or run pnpm land --squash "<message>"');
}

/** Rebase onto the integration branch; returns whether the lockfile changed (the installed dependencies are then stale). */
function rebase(root: string): boolean {
  if (isAncestor(root, INTEGRATION_BRANCH, 'HEAD')) return false;
  const lockBefore = tryGit(root, 'rev-parse', `HEAD:${config.lockfile}`);
  if (tryGit(root, 'rebase', '--quiet', INTEGRATION_BRANCH) !== undefined) return tryGit(root, 'rev-parse', `HEAD:${config.lockfile}`) !== lockBefore;
  // land never resolves conflicts: it reports them, restores the branch and stops
  const conflicts = tryGit(root, 'diff', '--name-only', '--diff-filter=U') ?? '';
  tryGit(root, 'rebase', '--abort');
  record(root, { branch: currentBranch(root), result: 'conflict', files: conflicts.split('\n').filter(Boolean) });
  throw new LandError(
    `conflict while rebasing onto ${INTEGRATION_BRANCH} (rebase aborted, the branch is as it was):\n${conflicts}\n` +
      `Resolve it with git rebase ${INTEGRATION_BRANCH} and run pnpm land again`,
  );
}

/**
 * Review gate, on the rebased branch and before the ADR commit (which would change the patch id the reviewer saw).
 * The mode comes from `swarm.json` on the integration branch, so a branch cannot switch off its own review.
 */
function enforceReview(root: string, log: (line: string) => void): void {
  const gate = reviewGate(root, INTEGRATION_BRANCH, loadReviewConfig(root, INTEGRATION_BRANCH, config.review));
  if (!gate.ok) throw new LandError(`${gate.message}: ${INTEGRATION_BRANCH} was not touched`);
  if (gate.required) log(gate.message);
}

/** Draft ADRs numbered and the index regenerated, in a commit of their own. */
function regenerateDocs(root: string): string | undefined {
  const renumbered = numberDraftAdrs(root);
  updateAdrIndex(root);
  if (dirtyPaths(root).length === 0) return undefined;
  git(root, 'add', '-A');
  const what = renumbered.map((r) => `${r.from} → ${r.to}`).join(', ');
  git(root, 'commit', '-q', '-m', renumbered.length ? `docs: number ADRs (${what}) and regenerate the index` : 'docs: regenerate the ADR index');
  return renumbered.length ? `ADRs numbered: ${what}` : 'ADR index regenerated';
}

/**
 * After a green verify, the quality ratchets move to what was just measured (same pattern as the ADR commit): the
 * ratchets file is rewritten, only ever tightening, and committed on its own on top of the verified SHA. That commit
 * is the one exception to "integrate exactly what was verified", and it is safe because it may contain only that
 * file, whose values are the measurements of the verified tree; anything else aborts. Returns the SHA to integrate.
 * A failure to measure (lint not installed, say) never blocks a verified land: the file is restored and land goes on.
 */
function tightenRatchets(root: string, verified: string, log: (line: string) => void): string {
  const file = config.ratchets.file;
  let changes: string[];
  try {
    changes = tightenFile(root, file);
  } catch (e) {
    tryGit(root, 'checkout', '--', file);
    log(`ratchets: not tightened (${(e as Error).message}); the next land retries`);
    return verified;
  }
  if (!changes.length) return verified;
  const dirty = dirtyPaths(root);
  if (dirty.length !== 1 || dirty[0] !== file) {
    tryGit(root, 'checkout', '--', file);
    throw new LandError(`tightening the ratchets changed more than ${file} (${dirty.join(', ')}): ${INTEGRATION_BRANCH} was not touched`);
  }
  git(root, 'add', '--', file);
  git(root, 'commit', '-q', '-m', config.ratchets.commitMessage);
  const tip = git(root, 'rev-parse', 'HEAD');
  if (git(root, 'diff', '--name-only', verified, tip) !== file) throw new LandError(`the ratchets commit touches more than ${file}: ${INTEGRATION_BRANCH} was not touched`);
  log(`ratchets tightened: ${changes.join('; ')}`);
  return tip;
}

/**
 * After verify: the branch tip must still be the verified SHA and the tree clean. Verify takes minutes, and in that
 * window the session's Stop hook (or anyone editing the worktree) can add a commit; fast-forwarding the branch name
 * would then publish a commit nobody verified. Files the dev tools regenerate are restored first, they are not work.
 */
function assertUnchanged(root: string, verified: string): void {
  restoreGenerated(root);
  const now = git(root, 'rev-parse', 'HEAD');
  const dirty = dirtyPaths(root);
  if (now === verified && dirty.length === 0) return;
  const what = now !== verified ? `the branch moved from ${verified.slice(0, 8)} to ${now.slice(0, 8)}` : `${dirty.length} uncommitted change(s) appeared`;
  throw new LandError(
    `${what} during verification, so the tip is not what was verified: ${INTEGRATION_BRANCH} was not touched.\n` +
      'Nothing may write to the worktree while land runs (the Stop hook already skips it). Absorb or drop the change (pnpm wt:commit "<message>") and run pnpm land again',
  );
}

/**
 * Fast-forward of the integration branch to the verified SHA, never to the branch name (its tip may have moved). If
 * the integration branch is checked out somewhere (normally the main checkout) it is done there with `merge --ff-only`,
 * which moves the ref and the tree together; moving only the ref would leave that tree silently undoing what was
 * integrated. With no checkout, `update-ref` with the old value is a compare-and-swap.
 */
function advanceIntegration(root: string, verified: string): void {
  const holder = worktrees(root).find((w) => w.branch === INTEGRATION_BRANCH);
  if (!holder) {
    const old = git(root, 'rev-parse', INTEGRATION_BRANCH);
    git(root, 'update-ref', `refs/heads/${INTEGRATION_BRANCH}`, verified, old);
    return;
  }
  restoreGenerated(holder.path);
  try {
    execFileSync('git', ['merge', '--ff-only', '--quiet', verified], { cwd: holder.path, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  } catch (e) {
    const stderr = String((e as { stderr?: unknown }).stderr ?? '');
    const dirty = dirtyPaths(holder.path);
    const hint = dirty.length ? `\nUncommitted changes there: ${dirty.join(', ')}. Restore your own with: git -C ${holder.path} checkout -- ${dirty.join(' ')}` : '';
    throw new LandError(`could not advance ${INTEGRATION_BRANCH} in ${holder.path} (no work happens there: it must be clean):\n${stderr.trim()}${hint}`);
  }
}

function runQuiet(root: string, cmd: string): boolean {
  try {
    execFileSync('sh', ['-c', cmd], { cwd: root, stdio: 'ignore' });
    return true;
  } catch {
    return false;
  }
}

function acquireLock(root: string, branch: string): LandLock {
  const lock = tryLandLock(root, branch);
  if (lock) return lock;
  const path = landLockPath(root);
  const holder = existsSync(path) ? readFileSync(path, 'utf8') : '';
  throw new LandError(`another pnpm land is running (${holder}); wait for it to finish and retry`);
}

/** Log of every attempt (your workflow metrics), shared by all worktrees. */
function record(root: string, entry: Record<string, unknown>): void {
  appendFileSync(join(commonDir(root), `${config.projectName}-land-log.jsonl`), `${JSON.stringify({ at: new Date().toISOString(), ...entry })}\n`);
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const squashAt = args.indexOf('--squash');
  const noReviewAt = args.indexOf('--no-review');
  try {
    const r = await land(process.cwd(), {
      squash: squashAt >= 0 ? (args[squashAt + 1] ?? '') : undefined,
      noPush: args.includes('--no-push'),
      noReview: noReviewAt >= 0 ? (args[noReviewAt + 1] ?? '') : undefined,
      verifyCmd: process.env[landVerifyEnv],
    });
    const where = r.pushed ? `, published to ${REMOTE}` : r.pushed === false ? ', NOT published' : '';
    console.log(`✓ ${r.commits} commit(s) of ${r.branch} on ${INTEGRATION_BRANCH} (${r.head}${where}, ${r.seconds}s, ${r.attempts} attempt(s))`);
    if (r.pushed === false) process.exitCode = 1;
    console.log('  The worktree is still there: keep working on this branch or close the session; the next land or main-checkout session start deletes it.');
  } catch (e) {
    console.error(`✗ land: ${(e as Error).message}`);
    process.exit(1);
  }
}
