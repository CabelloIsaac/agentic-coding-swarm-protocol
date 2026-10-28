/**
 * One session, one worktree, one branch.
 *
 *   pnpm wt:setup            prepare the worktree: dependencies, own ports, warning if credentials are present (SessionStart hook)
 *   pnpm wt:status [--all]   worktrees with branch, distance to the integration branch, uncommitted changes, wip commits and
 *                            processes; with --all, also remote branches with unintegrated work (git cherry)
 *   pnpm wt:archive <branch> publish an archive/<date>-<branch> tag and, afterwards, delete the branch (local, remote and worktree)
 *   pnpm wt:gc [--dry-run]   delete clean worktrees whose branch is already integrated and that have no agent session (stops their processes)
 *   pnpm wt:reap [--dry-run] stop the orphaned dev processes of integrated or deleted worktrees
 *   pnpm wt:commit "<msg>"   commit the whole worktree, absorbing the hook's wip commit if there is one
 *   node scripts/wt.ts wip   rolling wip commit (Stop hook): a dying session never loses its work
 *
 * In the main checkout all of this is a no-op except `status`, `gc`, `reap` and `archive`: no work happens there.
 * There, `setup` does run `gc` (if no `land` is in progress) and warns if system memory is tight. In both places,
 * `setup` activates the versioned hooks and warns if the local and remote integration branches diverge or have
 * unpublished commits.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, statSync, writeFileSync } from 'node:fs';
import { basename, dirname, join } from 'node:path';
import { auditReminder } from './audit.ts';
import { config } from './dev-flow.config.ts';
import {
  GENERATED_FILES,
  INTEGRATION_BRANCH,
  currentBranch,
  dirtyPaths,
  git,
  isAncestor,
  isLinkedWorktree,
  isWip,
  lockPid,
  mainCheckout,
  operationInProgress,
  readLandLock,
  releaseLandLock,
  restoreGenerated,
  toplevel,
  tryGit,
  tryLandLock,
  type Worktree,
  worktrees,
} from './git.ts';
import { archiveBranch, divergenceWarning, ensureHooks, formatRemoteBranches, remoteBranches } from './remote.ts';
import { type MemoryInfo, type Proc, formatMb, isAgent, isDevTool, isInside, listProcesses, memoryInfo, processesIn, stopProcesses } from './procs.ts';

/** Deterministic ports per worktree name, far from the defaults; one per configured service. */
export function portsFor(name: string): Record<string, number> {
  let hash = 0;
  for (const ch of name) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
  const services = config.portServices;
  const base = config.portBase + (hash % config.portRange) * services.length;
  return Object.fromEntries(services.map((s, i) => [s, base + i]));
}

export interface SetupOptions {
  /** System memory already read (tests); defaults to `memoryInfo()`. */
  memory?: MemoryInfo;
  procs?: Proc[];
}

/** More live heavy dev servers than this, or one above the size limit, raises a warning. */
export const HEAVY_SERVERS_WARN = config.heavyServer.maxCount;
export const HEAVY_SERVER_WARN_KB = config.heavyServer.maxRssKb;

/** Memory warning for the session context; `undefined` if the system is healthy or could not be read. */
export function memoryWarning(mem: MemoryInfo, mergedWorktrees: number): string | undefined {
  const limits = config.memory;
  const reasons: string[] = [];
  if (mem.pressure === 'warn' || mem.pressure === 'critical') reasons.push(`memory pressure ${mem.pressure}`);
  if (mem.swapPct !== undefined && mem.swapPct > limits.swapWarnPct) reasons.push(`swap at ${mem.swapPct} %`);
  if (mergedWorktrees > limits.mergedWorktreesWarn) reasons.push(`${mergedWorktrees} integrated worktrees not yet deleted`);
  const fsevents = mem.fseventsdKb !== undefined && mem.fseventsdKb > limits.indexerWarnKb;
  if (fsevents) reasons.push(`fseventsd uses ${formatMb(mem.fseventsdKb ?? 0)}`);
  const mds = mem.mdsStoresKb !== undefined && mem.mdsStoresKb > limits.indexerWarnKb;
  if (mds) reasons.push(`mds_stores (Spotlight) uses ${formatMb(mem.mdsStoresKb ?? 0)}`);
  if (!reasons.length) return undefined;
  const top = mem.top.map((t) => `${t.command} ${formatMb(t.kb)}`).join(', ');
  const actions = [
    'pnpm wt:gc',
    'pnpm wt:reap',
    ...(fsevents ? ['restart the machine (fseventsd does not give its memory back)'] : []),
    ...(mds ? ['exclude the code folder in System Settings > Spotlight > Privacy and `sudo killall mds_stores`'] : []),
  ];
  return `MEMORY WARNING: ${reasons.join(', ')}.${top ? ` Biggest consumers: ${top}.` : ''} Before launching builds or tests: ${actions.join(', ')}.`;
}

/**
 * Does the worktree have a live agent session? An agent process with `cwd` inside, or a worktree lock whose pid is
 * still alive (sessions and subagents put it in the reason). A lock with a dead pid is orphaned: it does not count.
 * A lock without a readable pid is respected, to be safe.
 */
export function hasLiveSession(w: Pick<Worktree, 'path' | 'locked' | 'lockReason'>, procs: Proc[]): boolean {
  if (processesIn(procs, w.path).some(isAgent)) return true;
  if (!w.locked) return false;
  const pid = lockPid(w);
  return pid === undefined || procs.some((p) => p.pid === pid);
}

/** Warning if there are too many live heavy dev servers or a huge one (a bundler with transpiled packages reaches 5-9 GB). */
export function heavyServersWarning(procs: Proc[]): string | undefined {
  const servers = procs.filter((p) => p.command === config.heavyServer.command);
  const big = servers.filter((p) => p.rssKb > HEAVY_SERVER_WARN_KB);
  if (servers.length <= HEAVY_SERVERS_WARN && !big.length) return undefined;
  const container = new RegExp(`^.*/${config.worktreeContainer.replaceAll('.', '\\.')}/`);
  const list = [...servers]
    .sort((a, b) => b.rssKb - a.rssKb)
    .map((p) => `${p.cwd?.replace(container, '') ?? '?'} ${formatMb(p.rssKb)}`)
    .join(', ');
  return `WARNING: ${servers.length} ${config.heavyServer.command} servers alive (${list}). For the ones you do not use: pnpm wt:reap (those of worktrees without a session) or kill <pid>.`;
}

/** Linked worktrees whose branch is already in the integration branch. */
function mergedCount(cwd: string): number {
  return worktrees(cwd).filter((w) => !w.main && w.branch && existsSync(w.path) && isAncestor(cwd, w.head, INTEGRATION_BRANCH)).length;
}

export async function setup(cwd: string, opts: SetupOptions = {}): Promise<string[]> {
  const notes: string[] = [];
  const mem = opts.memory ?? memoryInfo();
  if (!isLinkedWorktree(cwd)) {
    // In the main checkout gc is nearly free; with a land in progress it is left to the land itself
    const lock = tryLandLock(cwd, 'wt:setup');
    if (lock) {
      try {
        const r = await gc(cwd, { procs: opts.procs });
        if (r.removed.length) notes.push(`gc: ${r.removed.length} integrated worktree(s) deleted${r.freedKb ? `, ${formatMb(r.freedKb)} freed` : ''}`);
      } finally {
        releaseLandLock(lock);
      }
    }
    await reapNote(cwd, opts, notes);
    const warning = memoryWarning(mem, mergedCount(cwd));
    if (warning) notes.push(warning);
    remoteNotes(cwd, notes);
    const reminder = auditReminder(cwd);
    if (reminder) notes.push(reminder);
    return notes;
  }
  const root = toplevel(cwd);
  const marker = join(root, config.installMarker);
  const lockfile = join(root, config.lockfile);
  if (!existsSync(marker) || statSync(lockfile).mtimeMs > statSync(marker).mtimeMs) {
    if (mem.pressure === 'critical')
      notes.push('dependencies NOT installed: memory pressure is critical and the install could hang the machine. Free memory (pnpm wt:gc, pnpm wt:reap, close servers) and run pnpm wt:setup again');
    else {
      const [cmd, ...args] = config.setupInstallCommand;
      execFileSync(cmd as string, args, { cwd: root, stdio: 'ignore' });
      notes.push('dependencies installed');
    }
  }
  const ports = portsFor(basename(root));
  const envFile = join(root, config.worktreeEnvFile);
  mkdirSync(dirname(envFile), { recursive: true });
  writeFileSync(
    envFile,
    [
      `# Generated by pnpm wt:setup: this worktree's own ports. Usage: source ${config.worktreeEnvFile}`,
      ...Object.entries(ports).map(([service, port]) => `export ${config.envPrefix}${service}_PORT=${port}`),
      '',
    ].join('\n'),
  );
  notes.push(`ports: ${Object.entries(ports).map(([s, p]) => `${s} ${p}`).join(', ')} (source ${config.worktreeEnvFile})`);
  if (existsSync(join(root, '.env')))
    notes.push('WARNING: there is a .env in this worktree. Real spending only happens from the main checkout; `pnpm land` will not continue while it exists.');
  await reapNote(root, opts, notes);
  const warning = memoryWarning(mem, mergedCount(root));
  if (warning) notes.push(warning);
  remoteNotes(root, notes);
  // The periodic repo audit is reminded at session start, like the memory warning
  const reminder = auditReminder(root);
  if (reminder) notes.push(reminder);
  return notes;
}

/** Versioned hooks active (no note: it is almost always a no-op) and a no-network divergence warning. */
function remoteNotes(cwd: string, notes: string[]): void {
  ensureHooks(cwd);
  const warning = divergenceWarning(cwd);
  if (warning) notes.push(warning);
}

/** reap at session start, and a warning if heavy dev servers remain or there are too many. */
async function reapNote(cwd: string, opts: SetupOptions, notes: string[]): Promise<void> {
  const procs = opts.procs ?? listProcesses();
  const reaped = await reap(cwd, { procs });
  if (reaped.length) notes.push(`reap: ${reaped.length} dev process(es) without a session stopped, ${formatMb(reaped.reduce((sum, p) => sum + p.rssKb, 0))} freed`);
  const gone = new Set(reaped.map((p) => p.pid));
  const warning = heavyServersWarning(procs.filter((p) => !gone.has(p.pid)));
  if (warning) notes.push(warning);
}

/** Rolling wip commit: if the tip is already wip it is amended, so the hook does not fill the branch with commits. */
export function wip(cwd: string): string | undefined {
  if (!isLinkedWorktree(cwd) || !currentBranch(cwd) || operationInProgress(cwd)) return undefined;
  const root = toplevel(cwd);
  if (dirtyPaths(root).length === 0) return undefined;
  git(root, 'add', '-A');
  const tipIsOwnWip = isWip(git(root, 'log', '-1', '--format=%s')) && !isAncestor(root, 'HEAD', INTEGRATION_BRANCH);
  const message = `wip: ${new Date().toISOString()} (Stop hook; pnpm wt:commit absorbs it)`;
  // --no-verify: a safety-net commit must never be blocked by a hook
  git(root, 'commit', '--no-verify', '-q', ...(tipIsOwnWip ? ['--amend'] : []), '-m', message);
  return message;
}

/** Normal commit that absorbs the tip's wip, so the branch only carries commits with a real message. */
export function commit(cwd: string, message: string): string {
  if (!message.trim()) throw new Error('usage: pnpm wt:commit "<message>"');
  const root = toplevel(cwd);
  const tip = git(root, 'log', '-1', '--format=%s');
  if (isWip(tip) && !isAncestor(root, 'HEAD', INTEGRATION_BRANCH)) git(root, 'reset', '--soft', 'HEAD~1');
  git(root, 'add', '-A');
  if (git(root, 'diff', '--cached', '--name-only') === '') return 'nothing to commit';
  git(root, 'commit', '-q', '-m', message);
  return git(root, 'log', '-1', '--format=%h %s');
}

export interface WorktreeStatus {
  path: string;
  branch: string;
  ahead: number;
  behind: number;
  dirty: number;
  wip: number;
  merged: boolean;
  lastCommit: string;
  /** Processes with `cwd` inside and their total resident memory (KB). */
  procs: number;
  rssKb: number;
}

export function status(cwd: string, procs: Proc[] = listProcesses()): WorktreeStatus[] {
  const all = worktrees(cwd);
  return all.map((w) => {
    // A process of the main checkout does not count there if it is inside a linked worktree (under the worktree container)
    const inside = processesIn(procs, w.path).filter((p) => !w.main || !all.some((o) => !o.main && isInside(o.path, p.cwd)));
    const branch = w.branch ?? `(HEAD ${w.head.slice(0, 7)})`;
    const counts = tryGit(w.path, 'rev-list', '--left-right', '--count', `${INTEGRATION_BRANCH}...HEAD`)?.split(/\s+/).map(Number) ?? [0, 0];
    const subjects = tryGit(w.path, 'log', '--format=%s', `${INTEGRATION_BRANCH}..HEAD`)?.split('\n').filter(Boolean) ?? [];
    return {
      path: w.path,
      branch,
      behind: counts[0] ?? 0,
      ahead: counts[1] ?? 0,
      dirty: existsSync(w.path) ? dirtyPaths(w.path).length : 0,
      wip: subjects.filter(isWip).length,
      merged: !w.main && isAncestor(cwd, w.head, INTEGRATION_BRANCH),
      lastCommit: tryGit(w.path, 'log', '-1', '--format=%cr') ?? '',
      procs: inside.length,
      rssKb: inside.reduce((sum, p) => sum + p.rssKb, 0),
    };
  });
}

export function formatStatus(rows: WorktreeStatus[]): string {
  return rows
    .map((r) => {
      const flags = [
        r.ahead ? `+${r.ahead}` : '',
        r.behind ? `-${r.behind}` : '',
        r.dirty ? `${r.dirty} uncommitted` : '',
        r.wip ? `${r.wip} wip` : '',
        r.merged ? 'integrated' : '',
        r.procs ? `${r.procs} proc ${formatMb(r.rssKb)}` : '',
      ].filter(Boolean);
      return `${r.branch.padEnd(32)} ${flags.join(' · ').padEnd(56)} ${r.lastCommit.padEnd(16)} ${r.path}`;
    })
    .join('\n');
}

export interface GcOptions {
  dryRun?: boolean;
  /** Processes already read (tests); defaults to `listProcesses()`. */
  procs?: Proc[];
  graceMs?: number;
}

export interface GcReport {
  removed: string[];
  /** Integrated and clean, but with a live agent session inside: left alone. */
  inUse: string[];
  stopped: Proc[];
  freedKb: number;
}

/**
 * Deletes clean, already-integrated worktrees and first stops their processes, which have no owner without a session.
 * It never touches the main checkout, the current one, one with changes, or one with a live agent session (`cwd`
 * inside, or locked with `git worktree lock` as sessions with subagents do).
 */
export async function gc(cwd: string, opts: GcOptions = {}): Promise<GcReport> {
  const here = toplevel(cwd);
  const procs = opts.procs ?? listProcesses();
  const report: GcReport = { removed: [], inUse: [], stopped: [], freedKb: 0 };
  for (const w of worktrees(cwd)) {
    if (w.main || w.path === here || !w.branch) continue;
    if (!existsSync(w.path)) continue;
    // Dev servers rewrite some versioned files: that alone is not unintegrated work
    if (dirtyPaths(w.path).some((f) => !GENERATED_FILES.test(f)) || !isAncestor(cwd, w.head, INTEGRATION_BRANCH)) continue;
    const inside = processesIn(procs, w.path);
    if (hasLiveSession(w, procs)) {
      report.inUse.push(`${w.branch} (${w.path})`);
      continue;
    }
    if (!opts.dryRun) {
      restoreGenerated(w.path);
      report.stopped.push(...(await stopProcesses(inside, opts.graceMs)));
      git(cwd, 'worktree', 'remove', w.path);
      git(cwd, 'branch', '-d', w.branch);
    } else report.stopped.push(...inside);
    report.freedKb += inside.reduce((sum, p) => sum + p.rssKb, 0);
    report.removed.push(`${w.branch} (${w.path})`);
  }
  if (!opts.dryRun) git(cwd, 'worktree', 'prune');
  return report;
}

export function formatGc(r: GcReport, dryRun = false): string {
  const verb = dryRun ? 'would delete' : 'deleted';
  const lines = [
    ...r.removed.map((x) => `${verb} ${x}`),
    ...r.stopped.map((p) => `${dryRun ? 'would stop' : 'stopped'} ${p.pid} ${p.command} (${formatMb(p.rssKb)})`),
    ...r.inUse.map((x) => `in use (live agent session): ${x}`),
  ];
  if (r.freedKb) lines.push(`memory ${dryRun ? 'to free' : 'freed'}: ${formatMb(r.freedKb)}`);
  return lines.length ? lines.join('\n') : 'nothing to delete';
}

export interface ReapOptions {
  dryRun?: boolean;
  procs?: Proc[];
  /** Folder of the session worktrees; defaults to `<main checkout>/<config.worktreeContainer>`. */
  container?: string;
  graceMs?: number;
}

/**
 * Stops ownerless dev processes: those of a linked worktree without a live session (no agent inside and no lock with a
 * live pid, even if their parent is still alive) and orphans (`ppid` 1) whose `cwd` is in an integrated or already
 * deleted worktree: leftovers of sessions, `verify` runs or dev servers that died without taking their children.
 * Never an agent process, nor those of the worktree of a `pnpm land` in progress.
 */
export async function reap(cwd: string, opts: ReapOptions = {}): Promise<Proc[]> {
  const all = worktrees(cwd);
  const container = opts.container ?? join(mainCheckout(cwd), config.worktreeContainer);
  const merged = all.filter((w) => !w.main && isAncestor(cwd, w.head, INTEGRATION_BRANCH)).map((w) => w.path);
  const live = all.filter((w) => !w.main).map((w) => w.path);
  const procs = opts.procs ?? listProcesses();
  const here = toplevel(cwd);
  // A live `pnpm land` owns its worktree even if the session (e.g. a subagent) has already finished
  const land = readLandLock(cwd);
  const landing = land?.pid !== undefined && procs.some((p) => p.pid === land.pid) ? land.branch : undefined;
  // Linked worktrees without a live session: their servers and tests have no owner even if their parent is alive
  const ownerless = all
    .filter((w) => !w.main && w.path !== here && !(landing && w.branch === landing) && !hasLiveSession(w, procs))
    .map((w) => w.path);
  const orphans = procs.filter((p) => {
    if (!isDevTool(p) || !p.cwd) return false;
    if (ownerless.some((o) => isInside(o, p.cwd))) return true;
    if (p.ppid !== 1) return false;
    if (merged.some((m) => isInside(m, p.cwd))) return true;
    // Already-deleted worktree: under the worktree container but outside every live one
    return isInside(container, p.cwd) && p.cwd !== container && !live.some((l) => isInside(l, p.cwd));
  });
  return opts.dryRun ? orphans : stopProcesses(orphans, opts.graceMs);
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const cwd = process.cwd();
  try {
    if (cmd === 'setup') {
      // A SessionStart hook's output enters the session context: remind whoever opens the main checkout of the flow
      if (!isLinkedWorktree(cwd))
        console.log('wt:setup · You are in the main checkout: nothing is edited here. Work in a worktree (claude -w <name> or EnterWorktree) and integrate with pnpm land.');
      for (const n of await setup(cwd)) console.log(`wt:setup · ${n}`);
    } else if (cmd === 'wip') wip(cwd);
    else if (cmd === 'commit') console.log(commit(cwd, rest.join(' ')));
    else if (cmd === 'status') {
      console.log(formatStatus(status(cwd)));
      const warning = divergenceWarning(cwd);
      if (warning) console.log(`\n${warning}`);
      if (rest.includes('--all')) {
        const remote = remoteBranches(cwd);
        console.log(`\nRemote branches (last fetch):\n${remote.length ? formatRemoteBranches(remote) : 'none'}`);
      }
    } else if (cmd === 'archive') {
      const branch = rest.find((a) => !a.startsWith('-'));
      if (!branch) throw new Error('usage: pnpm wt:archive <branch>');
      const r = archiveBranch(cwd, branch);
      const gone = [r.removedWorktree && `worktree ${r.removedWorktree}`, r.deletedLocal && 'local branch', r.deletedRemote && 'remote branch'].filter(Boolean);
      console.log(`archived at ${r.tag} (${r.sha.slice(0, 8)}, published); deleted: ${gone.join(', ') || 'nothing else'}`);
    } else if (cmd === 'gc') {
      const dryRun = rest.includes('--dry-run');
      console.log(formatGc(await gc(cwd, { dryRun }), dryRun));
    } else if (cmd === 'reap') {
      const dryRun = rest.includes('--dry-run');
      const procs = await reap(cwd, { dryRun });
      const lines = procs.map((p) => `${dryRun ? 'would stop' : 'stopped'} ${p.pid} ${p.command} (${formatMb(p.rssKb)}) in ${p.cwd}`);
      console.log(lines.length ? lines.join('\n') : 'no orphans');
    } else {
      console.error('usage: node scripts/wt.ts setup|wip|commit|status [--all]|gc|reap [--dry-run]|archive <branch>');
      process.exit(2);
    }
  } catch (e) {
    console.error(`wt ${cmd}: ${(e as Error).message}`);
    // From a hook, a failure must not block the session (exit code 2 would block it)
    process.exit(cmd === 'setup' || cmd === 'wip' ? 0 : 1);
  }
}
