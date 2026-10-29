/**
 * Early overlap detection: which live session branches touch the same files, which of them git already knows will
 * conflict, and which branch the integration branch has moved under. `land` finds a collision when the second branch
 * integrates, after both sessions have spent their tokens and a full verify; this finds it while there is still
 * little work to redo. Read-only: it never commits, rebases, fetches or blocks.
 *
 *   node scripts/dev/overlap.ts                 every active branch against every other and against the integration branch
 *   node scripts/dev/overlap.ts --branch <b>    only what involves <b> (default in a linked worktree: its own branch; --all for every pair)
 *   node scripts/dev/overlap.ts --json          the same report as JSON
 *   node scripts/dev/overlap.ts --strict        exit 1 if a textual conflict is predicted (scripts, CI)
 *   node scripts/dev/overlap.ts --session       SessionStart: the other live sessions and the areas they touch
 *   node scripts/dev/overlap.ts --notify        PostToolUse (Edit/Write): reads the hook JSON on stdin and prints an
 *                                               `additionalContext` notice only when this branch's overlap changed
 *
 * Active branch: a linked worktree on its own branch with commits not in the integration branch or uncommitted
 * changes. Its files are `git diff --name-only <integration>...<branch>` plus its dirty paths, minus generated files.
 *
 * Three findings, from cheapest to most specific:
 *  - shared: two active branches touch the same file. Git may merge it cleanly and the result can still be wrong (a
 *    semantic conflict), so it is reported even when the merge is clean.
 *  - conflict: `git merge-tree --write-tree` (git 2.38+, no checkout, milliseconds) says the two tips do not merge.
 *    Only run for pairs that share a file: a textual conflict needs one.
 *  - behind: the integration branch changed, since the branch's merge base, files the branch also touches; a rebase
 *    now is small, a rebase at land time is not. The conflict prediction there is the one a rebase would hit.
 *
 * Not covered on purpose: dependencies between different files (A changes a signature in one file, B calls it from
 * another). That needs the stack's import graph; `verify --quick` after a rebase is what catches it today.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { config } from './dev-flow.config.ts';
import { GENERATED_FILES, INTEGRATION_BRANCH, commonDir, currentBranch, dirtyPaths, isLinkedWorktree, toplevel, tryGit, worktrees } from './git.ts';

const OPTIONS = { notifyEveryMinutes: 5, listFiles: 5, ...config.overlap };

export interface ActiveBranch {
  branch: string;
  path: string;
  /** Files the branch changes relative to its merge base with the integration branch, plus its dirty paths. */
  files: string[];
}

export interface PairOverlap {
  a: string;
  b: string;
  shared: string[];
  /** Files `git merge-tree` reports as conflicting; empty = merges cleanly; `undefined` = could not be predicted. */
  conflicts?: string[];
}

export interface BehindOverlap {
  branch: string;
  /** Commits on the integration branch that the branch lacks. */
  behind: number;
  /** Files the integration branch changed since the merge base that the branch also touches. */
  files: string[];
  conflicts?: string[];
}

export interface OverlapReport {
  integrationBranch: string;
  branches: ActiveBranch[];
  pairs: PairOverlap[];
  behind: BehindOverlap[];
  /** `false` when this git has no `merge-tree --write-tree` (older than 2.38): conflicts are then unknown. */
  conflictPrediction: boolean;
}

const lines = (s: string | undefined) => (s ?? '').split('\n').filter(Boolean);
const intersect = (a: string[], b: string[]) => {
  const set = new Set(b);
  return a.filter((x) => set.has(x)).sort();
};

/** `git status --porcelain` reports a rename as `old -> new`: the new path is the one being worked on. */
const statusPath = (p: string) => p.split(' -> ').pop() ?? p;

/** Linked worktrees on their own branch with work not yet in the integration branch. */
export function activeBranches(cwd: string): ActiveBranch[] {
  const out: ActiveBranch[] = [];
  for (const w of worktrees(cwd)) {
    if (w.main || !w.branch || w.branch === INTEGRATION_BRANCH || !existsSync(w.path)) continue;
    const committed = lines(tryGit(cwd, 'diff', '--name-only', `${INTEGRATION_BRANCH}...${w.branch}`));
    const dirty = dirtyPaths(w.path).map(statusPath);
    const files = [...new Set([...committed, ...dirty])].filter((f) => !GENERATED_FILES.test(f)).sort();
    if (files.length) out.push({ branch: w.branch, path: w.path, files });
  }
  return out;
}

/**
 * Files that would conflict if `ours` and `theirs` were merged, without touching any working tree. `[]` = clean,
 * `undefined` = git cannot tell (too old, or an unexpected error).
 */
export function predictConflicts(cwd: string, ours: string, theirs: string): string[] | undefined {
  const r = spawnSync('git', ['merge-tree', '--write-tree', '--name-only', '--no-messages', '-z', ours, theirs], { cwd, encoding: 'utf8' });
  if (r.status === 0) return [];
  if (r.status !== 1) return undefined;
  // -z: <tree>\0<file>\0<file>\0\0<messages, suppressed>
  const [, ...rest] = r.stdout.split('\0');
  const end = rest.indexOf('');
  return [...new Set(end === -1 ? rest : rest.slice(0, end))].sort();
}

/** Is `git merge-tree --write-tree` available? Checked once against two refs that always merge. */
function mergeTreeAvailable(cwd: string): boolean {
  return predictConflicts(cwd, INTEGRATION_BRANCH, INTEGRATION_BRANCH) !== undefined;
}

export interface OverlapOptions {
  /** Only report pairs and the behind check that involve this branch. */
  branch?: string;
}

export function overlapReport(cwd: string, opts: OverlapOptions = {}): OverlapReport {
  const branches = activeBranches(cwd);
  const conflictPrediction = mergeTreeAvailable(cwd);
  const involves = (b: string) => opts.branch === undefined || b === opts.branch;
  const pairs: PairOverlap[] = [];
  for (let i = 0; i < branches.length; i++) {
    for (let j = i + 1; j < branches.length; j++) {
      const a = branches[i] as ActiveBranch;
      const b = branches[j] as ActiveBranch;
      if (!involves(a.branch) && !involves(b.branch)) continue;
      const shared = intersect(a.files, b.files);
      if (!shared.length) continue;
      const conflicts = conflictPrediction ? predictConflicts(cwd, a.branch, b.branch) : undefined;
      // The one named by --branch goes first, so a session reads "mine ↔ theirs"
      const [first, second] = opts.branch !== undefined && b.branch === opts.branch ? [b, a] : [a, b];
      pairs.push({ a: first.branch, b: second.branch, shared, ...(conflicts ? { conflicts } : {}) });
    }
  }
  const behind: BehindOverlap[] = [];
  for (const b of branches) {
    if (!involves(b.branch)) continue;
    const base = tryGit(cwd, 'merge-base', INTEGRATION_BRANCH, b.branch);
    if (!base) continue;
    const moved = lines(tryGit(cwd, 'diff', '--name-only', base, INTEGRATION_BRANCH));
    const files = intersect(b.files, moved);
    if (!files.length) continue;
    const count = Number(tryGit(cwd, 'rev-list', '--count', `${b.branch}..${INTEGRATION_BRANCH}`) ?? 0);
    const conflicts = conflictPrediction ? predictConflicts(cwd, INTEGRATION_BRANCH, b.branch) : undefined;
    behind.push({ branch: b.branch, behind: count, files, ...(conflicts ? { conflicts } : {}) });
  }
  return { integrationBranch: INTEGRATION_BRANCH, branches, pairs, behind, conflictPrediction };
}

const list = (files: string[], max = OPTIONS.listFiles) => (files.length > max ? `${files.slice(0, max).join(', ')} and ${files.length - max} more` : files.join(', '));

/** One line per finding, most severe first; empty when nothing overlaps. */
export function formatFindings(r: OverlapReport): string[] {
  const out: string[] = [];
  const conflicted = (p: PairOverlap) => (p.conflicts?.length ?? 0) > 0;
  for (const p of [...r.pairs].sort((x, y) => Number(conflicted(y)) - Number(conflicted(x)))) {
    if (conflicted(p)) {
      const others = p.shared.length - (p.conflicts?.length ?? 0);
      out.push(`✗ ${p.a} ↔ ${p.b}: conflict predicted in ${list(p.conflicts ?? [])}${others > 0 ? ` (+${others} more shared file(s))` : ''}. Coordinate now: whichever lands second resolves it on its branch.`);
    } else {
      const how = p.conflicts ? 'git merges them cleanly, the logic may still clash' : 'conflicts unknown (git < 2.38)';
      out.push(`⚠ ${p.a} ↔ ${p.b}: both touch ${list(p.shared)} (${how}). Check what the other branch is changing before going further.`);
    }
  }
  for (const b of r.behind) {
    const conflict = b.conflicts?.length ? `; a rebase now would conflict in ${list(b.conflicts)}` : '';
    out.push(`${b.conflicts?.length ? '✗' : '⚠'} ${b.branch} is ${b.behind} commit(s) behind ${r.integrationBranch}, which changed ${list(b.files)} that it also touches${conflict}. Rebase onto ${r.integrationBranch} now, while it is small.`);
  }
  return out;
}

export function formatReport(r: OverlapReport): string {
  const findings = formatFindings(r);
  const head = `overlap · ${r.branches.length} active branch(es) · ${r.pairs.length} overlapping pair(s) · ${r.behind.length} branch(es) behind on files they touch`;
  const note = r.conflictPrediction ? [] : ['(git older than 2.38: no merge-tree --write-tree, so conflicts are not predicted, only shared files)'];
  return [head, ...findings, ...note].join('\n');
}

/** Top-level areas a branch touches (`src/billing (4)`), for a one-line summary per session. */
export function areas(files: string[], depth = 2): string {
  const counts = new Map<string, number>();
  for (const f of files) {
    const area = f.split('/').slice(0, Math.min(depth, f.split('/').length - 1)).join('/') || f;
    counts.set(area, (counts.get(area) ?? 0) + 1);
  }
  return [...counts.entries()]
    .sort((x, y) => y[1] - x[1] || x[0].localeCompare(y[0]))
    .slice(0, OPTIONS.listFiles)
    .map(([a, n]) => `${a} (${n})`)
    .join(', ');
}

/** SessionStart text: what the other live sessions are touching, plus this branch's own findings if it has work. */
export function sessionNotice(cwd: string): string[] {
  const branch = isLinkedWorktree(cwd) ? currentBranch(cwd) : undefined;
  const r = overlapReport(cwd, branch ? { branch } : {});
  const others = r.branches.filter((b) => b.branch !== branch);
  if (!others.length) return [];
  return [
    `${others.length} other active session branch(es); avoid editing their areas unless the task needs it:`,
    ...others.map((b) => `  ${b.branch}: ${areas(b.files)}`),
    ...formatFindings(r),
  ];
}

// --- PostToolUse notice: throttled, and silent unless the overlap of this branch changed ---------------------------

interface NotifyState {
  checkedAt: number;
  signature: string;
}

const statePath = (cwd: string, branch: string) => join(commonDir(cwd), `${config.projectName}-overlap`, `${branch.replace(/[^A-Za-z0-9._-]/g, '_')}.json`);

function readState(path: string): NotifyState | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as NotifyState;
  } catch {
    return undefined;
  }
}

/** What changes the notice: who overlaps, on which files, and which conflicts. Order-independent. */
export function signature(r: OverlapReport): string {
  return JSON.stringify({
    pairs: r.pairs.map((p) => [p.a, p.b, p.shared, p.conflicts ?? null]).sort(),
    behind: r.behind.map((b) => [b.branch, b.files, b.conflicts ?? null]).sort(),
  });
}

/** The worktree a hook call is about: the edited file's own worktree, else the hook's `cwd`, else ours. */
export function hookWorktree(input: string, fallback: string): string {
  let data: { cwd?: unknown; tool_input?: { file_path?: unknown } } = {};
  try {
    data = JSON.parse(input) as typeof data;
  } catch {
    // Not JSON (run by hand): fall back
  }
  const file = typeof data.tool_input?.file_path === 'string' ? data.tool_input.file_path : undefined;
  const candidates = [file && dirname(file), typeof data.cwd === 'string' ? data.cwd : undefined, fallback];
  for (const dir of candidates) {
    if (!dir || !existsSync(dir)) continue;
    const top = tryGit(dir, 'rev-parse', '--show-toplevel');
    if (top) return top;
  }
  return fallback;
}

/**
 * The PostToolUse notice. Returns the hook's JSON output, or `undefined` to stay silent: outside a linked worktree,
 * within `notifyEveryMinutes` of the last check, or when the overlap is the same as at the last notice.
 */
export function notify(cwd: string, now = Date.now()): string | undefined {
  if (!isLinkedWorktree(cwd)) return undefined;
  const branch = currentBranch(cwd);
  if (!branch) return undefined;
  const path = statePath(cwd, branch);
  const previous = readState(path);
  if (previous && now - previous.checkedAt < OPTIONS.notifyEveryMinutes * 60_000) return undefined;
  const r = overlapReport(cwd, { branch });
  const sig = signature(r);
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, JSON.stringify({ checkedAt: now, signature: sig } satisfies NotifyState));
  const findings = formatFindings(r);
  if (!findings.length || sig === previous?.signature) return undefined;
  const additionalContext = [`swarm overlap (${branch}):`, ...findings].join('\n');
  return JSON.stringify({ hookSpecificOutput: { hookEventName: 'PostToolUse', additionalContext } });
}

if (import.meta.main) {
  const args = process.argv.slice(2);
  const hookMode = args.includes('--session') || args.includes('--notify');
  try {
    if (args.includes('--notify')) {
      let input = '';
      try {
        input = readFileSync(0, 'utf8');
      } catch {
        // No stdin: use the current directory
      }
      const out = notify(hookWorktree(input, process.cwd()));
      if (out) console.log(out);
    } else if (args.includes('--session')) {
      for (const l of sessionNotice(process.cwd())) console.log(`overlap · ${l}`);
    } else {
      const cwd = process.cwd();
      const i = args.indexOf('--branch');
      const named = i >= 0 ? args[i + 1] : undefined;
      if (i >= 0 && !named) throw new Error('usage: --branch <name>');
      const own = !args.includes('--all') && isLinkedWorktree(cwd) ? currentBranch(cwd) : undefined;
      const branch = named ?? own;
      const r = overlapReport(toplevel(cwd), branch ? { branch } : {});
      console.log(args.includes('--json') ? JSON.stringify(r, null, 2) : formatReport(r));
      const conflict = r.pairs.some((p) => p.conflicts?.length) || r.behind.some((b) => b.conflicts?.length);
      if (args.includes('--strict') && conflict) process.exit(1);
    }
  } catch (e) {
    console.error(`overlap: ${(e as Error).message}`);
    // From a hook, a failure must never block the session
    process.exit(hookMode ? 0 : 1);
  }
}
