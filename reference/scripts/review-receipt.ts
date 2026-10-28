/**
 * Review receipts: the proof that a change was reviewed, which `land` requires before it verifies (INTEGRATION.md
 * L2.7). A receipt is a small JSON file in `<git-common-dir>/swarm-reviews/<patch_id>.json`: local to the clone,
 * shared by its worktrees, never committed.
 *
 * The key is `git patch-id --stable` over `git diff <integration>...HEAD`: a hash of the change itself, not of a
 * commit. It survives a squash and a clean rebase (land's own rebase), and any later edit to the change produces a new
 * id, so a receipt can never be reused for code nobody reviewed. It does change when the integration branch edits the
 * context lines around the change's hunks; then the change is reviewed again, which is what a moved context deserves.
 *
 *   node review-receipt.ts write --reviewers reviewer,security-reviewer --verdict pass --open-high 0
 *   node review-receipt.ts check            exit 0 if land would accept the change, 1 with the reason otherwise
 *
 * The review skill can write the same file with plain git and printf (see skills/review/SKILL.md), so the receipt
 * works in any stack; this script is the Node convenience and the implementation `land` uses.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, type ReviewConfig, type ReviewMode } from './dev-flow.config.ts';

export const RECEIPTS_DIR = 'swarm-reviews';

export interface ReviewReceipt {
  patch_id: string;
  /** SHA of the integration branch when the review ended. */
  base: string;
  /** SHA of the reviewed head. */
  head: string;
  reviewers: string[];
  verdict: 'pass' | 'changes_requested';
  /** High-severity findings still open. A passing receipt has 0. */
  open_high: number;
  at: string;
}

export interface GateResult {
  /** Whether land may continue. */
  ok: boolean;
  /** Whether the mode requires a receipt for this change. */
  required: boolean;
  mode: ReviewMode;
  /** Changed paths that matched a sensitive glob (mode `sensitive`). */
  matched: string[];
  patchId?: string;
  receipt?: ReviewReceipt;
  /** Human-readable reason: why it passed, or what to do to pass. */
  message: string;
}

function git(cwd: string, args: string[], input?: string): string {
  return execFileSync('git', args, { cwd, encoding: 'utf8', input, stdio: ['pipe', 'pipe', 'pipe'], maxBuffer: 256 * 1024 * 1024 }).trimEnd();
}

function tryGit(cwd: string, args: string[]): string | undefined {
  try {
    return git(cwd, args);
  } catch {
    return undefined;
  }
}

/** `<git-common-dir>/swarm-reviews`: shared by every worktree of the clone, outside the tracked tree. */
export function receiptsDir(cwd: string): string {
  return join(resolve(cwd, git(cwd, ['rev-parse', '--git-common-dir'])), RECEIPTS_DIR);
}

/**
 * Stable patch id of `<integration>...HEAD` (the change since the merge base), or `undefined` if the change is empty.
 * `--no-ext-diff` and `--no-color` keep user diff settings from changing the hash.
 */
export function patchId(cwd: string, integrationBranch: string): string | undefined {
  const diff = git(cwd, ['diff', '--no-color', '--no-ext-diff', `${integrationBranch}...HEAD`]);
  if (!diff) return undefined;
  const out = git(cwd, ['patch-id', '--stable'], `${diff}\n`);
  return out.split(/\s+/)[0] || undefined;
}

export function changedPaths(cwd: string, integrationBranch: string): string[] {
  return git(cwd, ['diff', '--name-only', '--no-renames', `${integrationBranch}...HEAD`]).split('\n').filter(Boolean);
}

/**
 * Minimal glob → RegExp: `**` any depth (including none), `*` within one segment, `?` one character. A pattern
 * without a `/` matches the basename at any depth (`*.sql`, `swarm.json`), like a `.gitignore` entry.
 */
export function globToRegExp(glob: string): RegExp {
  const anyDepth = !glob.includes('/');
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob.charAt(i);
    if (c === '*' && glob.charAt(i + 1) === '*') {
      const slash = glob.charAt(i + 2) === '/';
      re += slash ? '(?:.*/)?' : '.*';
      i += slash ? 2 : 1;
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(anyDepth ? `^(?:.*/)?${re}$` : `^${re}$`);
}

export function matchSensitive(paths: string[], globs: string[]): string[] {
  const res = globs.map(globToRegExp);
  return paths.filter((p) => res.some((r) => r.test(p)));
}

/**
 * The review config in force: the `review` block of `swarm.json` **as it is on the integration branch**, else the
 * fallback. Read from the integration branch on purpose: a branch must not be able to switch off its own review by
 * editing the manifest (and `swarm.json` is itself a sensitive path).
 */
export function loadReviewConfig(cwd: string, integrationBranch: string, fallback: ReviewConfig): ReviewConfig {
  const raw = tryGit(cwd, ['show', `${integrationBranch}:swarm.json`]);
  if (raw === undefined) return fallback;
  let review: unknown;
  try {
    review = (JSON.parse(raw) as { review?: unknown }).review;
  } catch {
    return fallback;
  }
  if (!review || typeof review !== 'object') return fallback;
  const r = review as { mode?: unknown; sensitive?: unknown };
  const mode = r.mode === 'always' || r.mode === 'sensitive' || r.mode === 'off' ? r.mode : fallback.mode;
  const sensitive = Array.isArray(r.sensitive) && r.sensitive.every((g) => typeof g === 'string') ? (r.sensitive as string[]) : fallback.sensitive;
  return { mode, sensitive };
}

export function parseReceipt(text: string): ReviewReceipt | undefined {
  let v: unknown;
  try {
    v = JSON.parse(text);
  } catch {
    return undefined;
  }
  if (!v || typeof v !== 'object') return undefined;
  const r = v as Record<string, unknown>;
  const ok =
    typeof r.patch_id === 'string' &&
    typeof r.base === 'string' &&
    typeof r.head === 'string' &&
    Array.isArray(r.reviewers) &&
    r.reviewers.every((x) => typeof x === 'string') &&
    (r.verdict === 'pass' || r.verdict === 'changes_requested') &&
    typeof r.open_high === 'number' &&
    Number.isInteger(r.open_high) &&
    r.open_high >= 0 &&
    typeof r.at === 'string';
  return ok ? (r as unknown as ReviewReceipt) : undefined;
}

export function readReceipt(cwd: string, id: string): ReviewReceipt | undefined {
  const path = join(receiptsDir(cwd), `${id}.json`);
  return existsSync(path) ? parseReceipt(readFileSync(path, 'utf8')) : undefined;
}

export interface WriteOptions {
  reviewers: string[];
  verdict: ReviewReceipt['verdict'];
  openHigh: number;
  now?: Date;
}

/** Writes the receipt for the current change and returns it. Refuses an empty change and a `pass` with open highs. */
export function writeReceipt(cwd: string, integrationBranch: string, opts: WriteOptions): ReviewReceipt {
  const id = patchId(cwd, integrationBranch);
  if (!id) throw new Error(`no change between ${integrationBranch} and HEAD: nothing to review`);
  if (!opts.reviewers.length) throw new Error('a receipt names at least one reviewer');
  if (!Number.isInteger(opts.openHigh) || opts.openHigh < 0) throw new Error('--open-high must be a whole number ≥ 0');
  if (opts.verdict === 'pass' && opts.openHigh > 0) throw new Error('a passing review has no open high findings');
  const receipt: ReviewReceipt = {
    patch_id: id,
    base: git(cwd, ['rev-parse', integrationBranch]),
    head: git(cwd, ['rev-parse', 'HEAD']),
    reviewers: opts.reviewers,
    verdict: opts.verdict,
    open_high: opts.openHigh,
    at: (opts.now ?? new Date()).toISOString(),
  };
  const dir = receiptsDir(cwd);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(receipt)}\n`);
  return receipt;
}

/**
 * The land gate. Mode `off` never requires a receipt; `always` requires one for every change; `sensitive` only when a
 * changed path matches a sensitive glob. When required, the receipt must exist for the current patch id, say `pass`
 * and have no open high findings.
 */
export function reviewGate(cwd: string, integrationBranch: string, review: ReviewConfig): GateResult {
  const { mode } = review;
  const base = { mode, matched: [] as string[] };
  if (mode === 'off') return { ...base, ok: true, required: false, message: 'review gate off' };
  const matched = mode === 'sensitive' ? matchSensitive(changedPaths(cwd, integrationBranch), review.sensitive) : [];
  if (mode === 'sensitive' && !matched.length) return { ...base, ok: true, required: false, message: 'review not required (no sensitive path changed)' };
  const why = mode === 'always' ? 'review mode is always' : `sensitive paths changed: ${matched.slice(0, 5).join(', ')}${matched.length > 5 ? ', …' : ''}`;
  const id = patchId(cwd, integrationBranch);
  if (!id) return { ...base, matched, ok: true, required: false, message: 'empty change: nothing to review' };
  const receipt = readReceipt(cwd, id);
  if (!receipt)
    return { ...base, matched, patchId: id, ok: false, required: true, message: `run /swarm:review (no receipt for this change; ${why}; patch-id ${id.slice(0, 12)})` };
  if (receipt.verdict !== 'pass' || receipt.open_high > 0)
    return {
      ...base,
      matched,
      patchId: id,
      receipt,
      ok: false,
      required: true,
      message: `the review of this change is ${receipt.verdict} with ${receipt.open_high} open high finding(s): fix them, then run /swarm:review again`,
    };
  return { ...base, matched, patchId: id, receipt, ok: true, required: true, message: `review receipt ${id.slice(0, 12)} ✓ (${receipt.reviewers.join(', ')}, ${receipt.at})` };
}

function arg(args: string[], name: string): string | undefined {
  const at = args.indexOf(name);
  return at >= 0 ? args[at + 1] : undefined;
}

if (import.meta.main) {
  const [cmd, ...args] = process.argv.slice(2);
  const cwd = process.cwd();
  const integration = arg(args, '--integration') ?? config.integrationBranch;
  try {
    if (cmd === 'write') {
      const verdict = arg(args, '--verdict') ?? 'pass';
      if (verdict !== 'pass' && verdict !== 'changes_requested') throw new Error('--verdict is pass or changes_requested');
      const r = writeReceipt(cwd, integration, {
        reviewers: (arg(args, '--reviewers') ?? 'reviewer').split(',').map((s) => s.trim()).filter(Boolean),
        verdict,
        openHigh: Number(arg(args, '--open-high') ?? '0'),
      });
      console.log(`✓ receipt ${r.patch_id.slice(0, 12)} · ${r.verdict} · open_high ${r.open_high} · ${join(receiptsDir(cwd), `${r.patch_id}.json`)}`);
    } else if (cmd === 'check') {
      const g = reviewGate(cwd, integration, loadReviewConfig(cwd, integration, config.review));
      console.log(`${g.ok ? '✓' : '✗'} ${g.message}`);
      if (!g.ok) process.exitCode = 1;
    } else {
      console.error('usage: review-receipt.ts write [--reviewers a,b] [--verdict pass|changes_requested] [--open-high N] | check [--integration <branch>]');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`✗ review-receipt: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
