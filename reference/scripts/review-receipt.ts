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
 *   node review-receipt.ts write --report <review.md> --reviewers reviewer,security-reviewer --verdict pass --open-high 0
 *   node review-receipt.ts check            exit 0 if land would accept the change, 1 with the reason otherwise
 *
 * A receipt is only as good as the review behind it, and the names in it are typed by the session that wants to land.
 * So the review skill also leaves its full report (findings with their DC ids, the agents dispatched, their verdicts)
 * at `<git-common-dir>/swarm-reviews/<patch_id>.md`; the receipt stores that file's sha256 and size, `write` refuses a
 * missing or tiny report, and `check` refuses a receipt whose report is missing or was edited afterwards. This does
 * not prove a review happened (nothing local can), but a pass now needs a document someone has to fabricate, which
 * an audit or a reviewer can read.
 *
 * The review skill can write the same file with plain git and printf (see skills/review/SKILL.md), so the receipt
 * works in any stack; this script is the Node convenience and the implementation `land` uses.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { copyFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { config, type ReviewConfig, type ReviewMode } from './dev-flow.config.ts';

export const RECEIPTS_DIR = 'swarm-reviews';
/** A report shorter than this cannot hold a findings list, the agents and their verdicts. */
export const MIN_REPORT_BYTES = 200;

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
  /** sha256 (hex) and size of `<patch_id>.md`, the review report; the gate refuses a receipt without them. */
  report_sha256?: string;
  report_bytes?: number;
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
 * editing the manifest (and `swarm.json` is itself a sensitive path). The published copy (`<remote>/<integration>`)
 * wins when it exists: the local branch is one `git commit` away from relaxing the gate, the remote one needs the
 * publisher's push.
 */
export function loadReviewConfig(cwd: string, integrationBranch: string, fallback: ReviewConfig, remote: string = config.remote): ReviewConfig {
  const published = `${remote}/${integrationBranch}`;
  const ref = tryGit(cwd, ['rev-parse', '--verify', '--quiet', published]) !== undefined ? published : integrationBranch;
  const raw = tryGit(cwd, ['show', `${ref}:swarm.json`]);
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
    typeof r.at === 'string' &&
    (r.report_sha256 === undefined || typeof r.report_sha256 === 'string') &&
    (r.report_bytes === undefined || typeof r.report_bytes === 'number');
  return ok ? (r as unknown as ReviewReceipt) : undefined;
}

export function readReceipt(cwd: string, id: string): ReviewReceipt | undefined {
  const path = join(receiptsDir(cwd), `${id}.json`);
  return existsSync(path) ? parseReceipt(readFileSync(path, 'utf8')) : undefined;
}

/** Where the report of a change lives: next to its receipt. */
export const reportPath = (cwd: string, id: string) => join(receiptsDir(cwd), `${id}.md`);

const sha256 = (data: Buffer) => createHash('sha256').update(data).digest('hex');

/** Why the report does not back the receipt, or `undefined` if it does. */
export function reportProblem(cwd: string, receipt: ReviewReceipt): string | undefined {
  if (!receipt.report_sha256 || receipt.report_bytes === undefined) return 'the receipt names no review report (report_sha256)';
  const path = reportPath(cwd, receipt.patch_id);
  if (!existsSync(path)) return `the review report ${receipt.patch_id}.md is missing`;
  const data = readFileSync(path);
  if (data.length < MIN_REPORT_BYTES) return `the review report is ${data.length} bytes (min ${MIN_REPORT_BYTES})`;
  if (data.length !== receipt.report_bytes || sha256(data) !== receipt.report_sha256) return 'the review report was altered after the receipt was written';
  return undefined;
}

export interface WriteOptions {
  /** The review report (Markdown). Required: copied to `<patch_id>.md` next to the receipt when it lives elsewhere. */
  report: string;
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
  if (!existsSync(opts.report)) throw new Error(`--report ${opts.report} does not exist: the review skill writes the full report before the receipt`);
  const report = readFileSync(opts.report);
  if (report.length < MIN_REPORT_BYTES) throw new Error(`the review report is ${report.length} bytes (min ${MIN_REPORT_BYTES}): it must list the findings, the agents dispatched and their verdicts`);
  const receipt: ReviewReceipt = {
    patch_id: id,
    base: git(cwd, ['rev-parse', integrationBranch]),
    head: git(cwd, ['rev-parse', 'HEAD']),
    reviewers: opts.reviewers,
    verdict: opts.verdict,
    open_high: opts.openHigh,
    at: (opts.now ?? new Date()).toISOString(),
    report_sha256: sha256(report),
    report_bytes: report.length,
  };
  const dir = receiptsDir(cwd);
  mkdirSync(dir, { recursive: true });
  if (resolve(opts.report) !== resolve(reportPath(cwd, id))) copyFileSync(opts.report, reportPath(cwd, id));
  writeFileSync(join(dir, `${id}.json`), `${JSON.stringify(receipt)}\n`);
  return receipt;
}

/**
 * The land gate. Mode `off` never requires a receipt; `always` requires one for every change; `sensitive` only when a
 * changed path matches a sensitive glob. When required, the receipt must exist for the current patch id, say `pass`
 * and have no open high findings, and the review report it hashes must still be there, unchanged.
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
  const unbacked = reportProblem(cwd, receipt);
  if (unbacked) return { ...base, matched, patchId: id, receipt, ok: false, required: true, message: `${unbacked}: run /swarm:review again (it writes the report, then the receipt)` };
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
      const report = arg(args, '--report');
      const r = writeReceipt(cwd, integration, {
        report: report ?? reportPath(cwd, patchId(cwd, integration) ?? ''),
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
      console.error('usage: review-receipt.ts write [--report <review.md>] [--reviewers a,b] [--verdict pass|changes_requested] [--open-high N] | check [--integration <branch>]');
      process.exitCode = 2;
    }
  } catch (e) {
    console.error(`✗ review-receipt: ${(e as Error).message}`);
    process.exitCode = 1;
  }
}
