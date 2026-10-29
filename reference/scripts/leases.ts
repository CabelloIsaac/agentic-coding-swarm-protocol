/**
 * Leases: temporary reservations of parts of the code by session branches, so parallel sessions learn about each other
 * before they edit, not at `land`. A lease expires on its own when its session stops renewing it (a dead session never
 * holds anything for long); a lock would not.
 *
 *   node scripts/dev/leases.ts claim <glob…> [--intent "<why>"]   declare what this session will touch (shared), and take
 *                                                                  the exclusive zones it covers
 *   node scripts/dev/leases.ts check            PreToolUse (Edit/Write): hook JSON on stdin; exit 2 (blocks the edit) only
 *                                                when the file is in an exclusive zone a live session of another branch holds
 *   node scripts/dev/leases.ts renew [--hook]   Stop hook: extend this branch's lease (with --hook, the worktree comes from the hook JSON)
 *   node scripts/dev/leases.ts session          SessionStart: exclusive zones and who holds them, other sessions' leases
 *   node scripts/dev/leases.ts list [--json]    every lease and zone claim, live or expired
 *   node scripts/dev/leases.ts release          drop this branch's lease and zone claims (`land` does it after a green land)
 *   node scripts/dev/leases.ts break <zone-glob> --reason "<why>"   a human frees a zone a live session holds; logged
 *
 * Two kinds of reservation:
 *  - shared (the default, everything): informs. When a session first touches a file another live lease covers, the
 *    agent gets a note with the other branch and its intent. Nothing is blocked.
 *  - exclusive (only the zones listed in `leases.exclusive`: contracts, schemas, migrations, shared types, CI): the first
 *    live session to touch or claim a zone holds it; an edit there by another branch is refused until the holder lands,
 *    releases, or its lease expires. The list is read from `swarm.json` on the integration branch, like the review
 *    gate, so a branch cannot relax it for itself.
 *
 * Storage, in git's common directory (shared by every worktree of the clone, never committed):
 * `<project>-leases/branch-<branch>.json` is written only by its own branch, atomically (temp file + rename);
 * `<project>-leases/zone-<hash>.json` names a zone's holder and is created with `wx`, so exactly one branch gets it.
 * A claim whose holder's lease is dead is taken over with an atomic rename. Leases are a coordination aid: the
 * guarantee of an always-green integration branch stays with `land` and `verify`.
 */
import { createHash, randomBytes } from 'node:crypto';
import { appendFileSync, closeSync, existsSync, linkSync, mkdirSync, openSync, readFileSync, readdirSync, renameSync, unlinkSync, writeFileSync, writeSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';
import { config } from './dev-flow.config.ts';
import { INTEGRATION_BRANCH, commonDir, currentBranch, isLinkedWorktree, toplevel, tryGit } from './git.ts';
import { globToRegExp } from './review-receipt.ts';

export interface LeaseConfig {
  /** Minutes without a renewal after which a lease is dead. The Stop hook renews it every turn. */
  ttlMinutes: number;
  /** Globs of the exclusive zones. Keep it short: every entry serializes the sessions that need it. */
  exclusive: string[];
}

export interface Lease {
  branch: string;
  worktree: string;
  /** Globs claimed plus files touched, relative to the repo root. */
  paths: string[];
  intent?: string;
  renewedAt: string;
  ttlMinutes: number;
}

export interface ZoneClaim {
  zone: string;
  branch: string;
  at: string;
}

const DEFAULTS: LeaseConfig = { ttlMinutes: 30, exclusive: [], ...config.leases };

/**
 * The lease config in force: the `leases` block of `swarm.json` on the integration branch (the published copy when
 * there is one), else `config.leases`. A branch cannot shrink the exclusive list or stretch the TTL for itself.
 */
export function loadLeaseConfig(cwd: string): LeaseConfig {
  const published = `${config.remote}/${INTEGRATION_BRANCH}`;
  const ref = tryGit(cwd, 'rev-parse', '--verify', '--quiet', published) !== undefined ? published : INTEGRATION_BRANCH;
  const raw = tryGit(cwd, 'show', `${ref}:swarm.json`);
  if (raw === undefined) return DEFAULTS;
  try {
    const block = (JSON.parse(raw) as { leases?: { ttlMinutes?: unknown; exclusive?: unknown } }).leases;
    if (!block || typeof block !== 'object') return DEFAULTS;
    const ttl = typeof block.ttlMinutes === 'number' && block.ttlMinutes > 0 ? block.ttlMinutes : DEFAULTS.ttlMinutes;
    const exclusive = Array.isArray(block.exclusive) && block.exclusive.every((g) => typeof g === 'string') ? (block.exclusive as string[]) : DEFAULTS.exclusive;
    return { ttlMinutes: ttl, exclusive };
  } catch {
    return DEFAULTS;
  }
}

// --- storage -------------------------------------------------------------------------------------------------------

export const leasesDir = (cwd: string) => join(commonDir(cwd), `${config.projectName}-leases`);
const slug = (s: string) => s.replace(/[^A-Za-z0-9._-]/g, '_');
const leasePath = (cwd: string, branch: string) => join(leasesDir(cwd), `branch-${slug(branch)}.json`);
const zonePath = (cwd: string, zone: string) => join(leasesDir(cwd), `zone-${createHash('sha256').update(zone).digest('hex').slice(0, 16)}.json`);

function readJson<T>(path: string): T | undefined {
  try {
    return JSON.parse(readFileSync(path, 'utf8')) as T;
  } catch {
    return undefined;
  }
}

/** Temp file + rename: a reader sees the old lease or the new one, never half of one. */
function writeAtomic(path: string, data: unknown): void {
  mkdirSync(dirname(path), { recursive: true });
  const tmp = `${path}.${process.pid}.${randomBytes(4).toString('hex')}.tmp`;
  writeFileSync(tmp, `${JSON.stringify(data)}\n`);
  renameSync(tmp, path);
}

export function readLease(cwd: string, branch: string): Lease | undefined {
  return readJson<Lease>(leasePath(cwd, branch));
}

export function allLeases(cwd: string): Lease[] {
  const dir = leasesDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('branch-') && f.endsWith('.json'))
    .map((f) => readJson<Lease>(join(dir, f)))
    .filter((l): l is Lease => !!l);
}

export function allClaims(cwd: string): ZoneClaim[] {
  const dir = leasesDir(cwd);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((f) => f.startsWith('zone-') && f.endsWith('.json'))
    .map((f) => readJson<ZoneClaim>(join(dir, f)))
    .filter((c): c is ZoneClaim => !!c);
}

/** A lease is alive while it was renewed within its TTL and its worktree still exists. */
export function isAlive(lease: Lease | undefined, now = Date.now()): lease is Lease {
  if (!lease) return false;
  const renewed = Date.parse(lease.renewedAt);
  return Number.isFinite(renewed) && now - renewed < lease.ttlMinutes * 60_000 && existsSync(lease.worktree);
}

const expiresAt = (l: Lease) => new Date(Date.parse(l.renewedAt) + l.ttlMinutes * 60_000).toISOString();

// --- matching ------------------------------------------------------------------------------------------------------

const hasWildcard = (g: string) => /[*?]/.test(g);

/** Does a lease path (a glob or a file) cover this file? */
export function covers(pattern: string, file: string): boolean {
  return pattern === file || globToRegExp(pattern).test(file);
}

/**
 * Can a claimed glob and a zone glob name the same file? Exact when either is a plain path; otherwise judged on the
 * tracked files, which is what a session can edit today (a claim on files that do not exist yet is checked again,
 * file by file, when they are created).
 */
export function intersects(cwd: string, claim: string, zone: string, tracked?: string[]): boolean {
  if (!hasWildcard(claim)) return covers(zone, claim);
  if (!hasWildcard(zone)) return covers(claim, zone);
  const files = tracked ?? (tryGit(cwd, 'ls-files') ?? '').split('\n').filter(Boolean);
  const a = globToRegExp(claim);
  const b = globToRegExp(zone);
  return files.some((f) => a.test(f) && b.test(f));
}

// --- zones ---------------------------------------------------------------------------------------------------------

export type ZoneResult = { ok: true; acquired: boolean } | { ok: false; holder: string; lease?: Lease };

/**
 * Takes an exclusive zone for `branch`, or reports who holds it. Creation is `wx` (one winner). A claim whose holder's
 * lease is dead is moved aside with `rename` (one winner) and re-read: if what was moved turns out to be a live claim
 * (it changed hands in between), it is put back with `link`, which never overwrites. In the rare case that also
 * races, the displaced holder finds a claim that is not its own at its next edit and is refused there: a duplicate is
 * reported, never silent.
 */
export function acquireZone(cwd: string, zone: string, branch: string, now = Date.now()): ZoneResult {
  const path = zonePath(cwd, zone);
  mkdirSync(dirname(path), { recursive: true });
  for (let attempt = 0; attempt < 4; attempt++) {
    try {
      const fd = openSync(path, 'wx');
      writeSync(fd, `${JSON.stringify({ zone, branch, at: new Date(now).toISOString() } satisfies ZoneClaim)}\n`);
      closeSync(fd);
      return { ok: true, acquired: true };
    } catch (e) {
      if ((e as NodeJS.ErrnoException).code !== 'EEXIST') throw e;
    }
    const claim = readJson<ZoneClaim>(path);
    if (!claim) continue; // removed or half-written right now: try again
    if (claim.branch === branch) return { ok: true, acquired: false };
    const holder = readLease(cwd, claim.branch);
    if (isAlive(holder, now)) return { ok: false, holder: claim.branch, lease: holder };
    const aside = `${path}.reclaim-${process.pid}-${randomBytes(4).toString('hex')}`;
    try {
      renameSync(path, aside);
    } catch {
      continue; // someone else moved it first
    }
    const moved = readJson<ZoneClaim>(aside);
    if (moved && moved.branch !== claim.branch && moved.branch !== branch && isAlive(readLease(cwd, moved.branch), now)) {
      try {
        linkSync(aside, path);
      } catch {
        // A third claim appeared meanwhile; see the comment above
      }
      unlinkSync(aside);
      return { ok: false, holder: moved.branch, lease: readLease(cwd, moved.branch) };
    }
    unlinkSync(aside);
  }
  return { ok: false, holder: '(contended, retry)' };
}

const zonesFor = (file: string, cfg: LeaseConfig) => cfg.exclusive.filter((z) => covers(z, file));

/** The nearest existing directory: a Write may create a file in a folder that does not exist yet. */
function existingDir(path: string): string {
  let dir = dirname(path);
  while (!existsSync(dir) && dirname(dir) !== dir) dir = dirname(dir);
  return dir;
}

// --- the lease of the current branch -------------------------------------------------------------------------------

export interface Session {
  root: string;
  branch: string;
}

/** The session a call is about, or `undefined` outside a linked worktree on a branch. */
export function sessionAt(cwd: string): Session | undefined {
  if (!existsSync(cwd)) return undefined;
  const root = tryGit(cwd, 'rev-parse', '--show-toplevel');
  if (!root || !isLinkedWorktree(root)) return undefined;
  const branch = currentBranch(root);
  return branch && branch !== INTEGRATION_BRANCH ? { root, branch } : undefined;
}

function touchLease(s: Session, cfg: LeaseConfig, add: string[] = [], intent?: string, now = Date.now()): Lease {
  const current = readLease(s.root, s.branch);
  const paths = [...new Set([...(current?.paths ?? []), ...add])];
  const lease: Lease = {
    branch: s.branch,
    worktree: s.root,
    paths,
    ...(intent ?? current?.intent ? { intent: intent ?? current?.intent } : {}),
    renewedAt: new Date(now).toISOString(),
    ttlMinutes: cfg.ttlMinutes,
  };
  writeAtomic(leasePath(s.root, s.branch), lease);
  return lease;
}

const describe = (l: Lease | undefined, branch: string) =>
  l ? `${branch}${l.intent ? ` ("${l.intent}")` : ''}, until ${expiresAt(l)} unless it lands or releases first` : branch;

export interface ClaimResult {
  lease: Lease;
  /** Exclusive zones taken (or already held) by this branch. */
  zones: string[];
  denied: { zone: string; holder: string; lease?: Lease }[];
  /** Live leases of other branches that cover something claimed. */
  sharedWith: { branch: string; intent?: string; paths: string[] }[];
}

export function claim(cwd: string, globs: string[], intent?: string, now = Date.now()): ClaimResult {
  const s = sessionAt(cwd);
  if (!s) throw new Error('claim runs in a session worktree on its own branch');
  if (!globs.length) throw new Error('usage: leases.ts claim <glob…> [--intent "<why>"]');
  const cfg = loadLeaseConfig(s.root);
  const tracked = (tryGit(s.root, 'ls-files') ?? '').split('\n').filter(Boolean);
  const zones: string[] = [];
  const denied: ClaimResult['denied'] = [];
  for (const zone of cfg.exclusive) {
    if (!globs.some((g) => intersects(s.root, g, zone, tracked))) continue;
    const r = acquireZone(s.root, zone, s.branch, now);
    if (r.ok) zones.push(zone);
    else denied.push({ zone, holder: r.holder, ...(r.lease ? { lease: r.lease } : {}) });
  }
  const lease = touchLease(s, cfg, globs, intent, now);
  const sharedWith = allLeases(s.root)
    .filter((l) => l.branch !== s.branch && isAlive(l, now))
    .map((l) => ({ branch: l.branch, intent: l.intent, paths: l.paths.filter((p) => globs.some((g) => intersects(s.root, g, p, tracked))) }))
    .filter((x) => x.paths.length);
  return { lease, zones, denied, sharedWith };
}

export type CheckResult = { decision: 'allow'; context?: string } | { decision: 'deny'; reason: string };

/**
 * PreToolUse for one file. Refuses only an edit inside an exclusive zone that a live session of another branch holds.
 * Otherwise it takes the zone if there is one, adds the file to this branch's lease and, the first time this branch
 * touches the file, tells the agent which other live leases cover it.
 */
export function check(cwd: string, filePath: string, now = Date.now()): CheckResult {
  const absolute = isAbsolute(filePath) ? filePath : resolve(cwd, filePath);
  const s = sessionAt(existingDir(absolute));
  if (!s) return { decision: 'allow' };
  const file = relative(s.root, absolute);
  if (file.startsWith('..') || isAbsolute(file)) return { decision: 'allow' };
  const cfg = loadLeaseConfig(s.root);
  const notes: string[] = [];
  for (const zone of zonesFor(file, cfg)) {
    const r = acquireZone(s.root, zone, s.branch, now);
    if (!r.ok)
      return {
        decision: 'deny',
        reason: `swarm lease: ${file} is in the exclusive zone ${zone}, held by ${describe(r.lease, r.holder)}. Do not work around it: finish what does not need this zone, wait for that branch to land, or ask the human (leases.ts break "${zone}" --reason "<why>").`,
      };
    if (r.acquired) notes.push(`you now hold the exclusive zone ${zone} until this branch lands or its lease expires; other sessions cannot edit it meanwhile`);
  }
  const before = readLease(s.root, s.branch);
  const firstTouch = !before?.paths.some((p) => covers(p, file));
  touchLease(s, cfg, [file], undefined, now);
  if (firstTouch) {
    for (const l of allLeases(s.root)) {
      if (l.branch === s.branch || !isAlive(l, now) || !l.paths.some((p) => covers(p, file))) continue;
      notes.push(`${file} is also leased (shared) by ${describe(l, l.branch)}: read what that branch changes there before going further`);
    }
  }
  return notes.length ? { decision: 'allow', context: `swarm lease: ${notes.join('; ')}.` } : { decision: 'allow' };
}

/** Stop hook: extend this branch's lease, if it has one. A session that never edited holds nothing. */
export function renew(cwd: string, now = Date.now()): Lease | undefined {
  const s = sessionAt(cwd);
  if (!s || !readLease(s.root, s.branch)) return undefined;
  return touchLease(s, loadLeaseConfig(s.root), [], undefined, now);
}

/** Drops a branch's lease and the zones it holds. */
export function release(cwd: string, branch: string): { zones: string[] } {
  const zones: string[] = [];
  for (const c of allClaims(cwd)) {
    if (c.branch !== branch) continue;
    try {
      unlinkSync(zonePath(cwd, c.zone));
      zones.push(c.zone);
    } catch {
      // Already gone
    }
  }
  const path = leasePath(cwd, branch);
  if (existsSync(path)) unlinkSync(path);
  return { zones };
}

/** A human frees a zone held by a live session; the reason is logged next to the leases. */
export function breakZone(cwd: string, zone: string, reason: string): ZoneClaim | undefined {
  if (!reason.trim()) throw new Error('break needs a reason: leases.ts break "<zone>" --reason "<why>"');
  const path = zonePath(cwd, zone);
  const held = readJson<ZoneClaim>(path);
  if (!held) return undefined;
  unlinkSync(path);
  appendFileSync(join(leasesDir(cwd), 'log.jsonl'), `${JSON.stringify({ at: new Date().toISOString(), event: 'break', zone, holder: held.branch, reason })}\n`);
  return held;
}

/** SessionStart text: the exclusive zones and their live holders, and the other live leases. */
export function sessionNotice(cwd: string, now = Date.now()): string[] {
  const s = sessionAt(cwd);
  const root = s?.root ?? toplevel(cwd);
  const cfg = loadLeaseConfig(root);
  const live = allLeases(root).filter((l) => isAlive(l, now) && l.branch !== s?.branch);
  const held = new Map(allClaims(root).map((c) => [c.zone, c.branch]));
  const out: string[] = [];
  if (cfg.exclusive.length) {
    const zones = cfg.exclusive.map((z) => {
      const holder = held.get(z);
      return holder && holder !== s?.branch && isAlive(readLease(root, holder), now) ? `${z} (held by ${holder})` : z;
    });
    out.push(`exclusive zones (the first session to edit one holds it until it lands): ${zones.join(', ')}`);
  }
  for (const l of live) out.push(`${l.branch}${l.intent ? ` ("${l.intent}")` : ''} leases ${l.paths.slice(0, 5).join(', ')}${l.paths.length > 5 ? ` and ${l.paths.length - 5} more` : ''}`);
  if (s && live.length) out.push('declare what you will touch once you have a plan: leases.ts claim <glob…> --intent "<why>"');
  return out;
}

export function formatList(cwd: string, now = Date.now()): string {
  const leases = allLeases(cwd);
  const claims = allClaims(cwd);
  if (!leases.length && !claims.length) return 'no leases';
  const rows = leases.map((l) => `${isAlive(l, now) ? 'live   ' : 'expired'} ${l.branch.padEnd(28)} ${l.intent ? `"${l.intent}" ` : ''}${l.paths.join(', ')} (renewed ${l.renewedAt})`);
  const zones = claims.map((c) => `zone    ${c.zone.padEnd(28)} held by ${c.branch}${isAlive(readLease(cwd, c.branch), now) ? '' : ' (dead: the next session to need it takes it)'}`);
  return [...rows, ...zones].join('\n');
}

// --- CLI -----------------------------------------------------------------------------------------------------------

function hookInput(): { cwd?: string; file?: string } {
  let raw = '';
  try {
    raw = readFileSync(0, 'utf8');
  } catch {
    return {};
  }
  try {
    const data = JSON.parse(raw) as { cwd?: unknown; tool_input?: { file_path?: unknown } };
    return {
      ...(typeof data.cwd === 'string' ? { cwd: data.cwd } : {}),
      ...(typeof data.tool_input?.file_path === 'string' ? { file: data.tool_input.file_path } : {}),
    };
  } catch {
    return {};
  }
}

if (import.meta.main) {
  const [cmd, ...rest] = process.argv.slice(2);
  const hookMode = cmd === 'check' || cmd === 'session' || (cmd === 'renew' && rest.includes('--hook'));
  const flag = (name: string) => {
    const i = rest.indexOf(name);
    return i >= 0 ? rest[i + 1] : undefined;
  };
  try {
    if (cmd === 'check') {
      const input = hookInput();
      if (input.file) {
        const r = check(input.cwd ?? process.cwd(), input.file);
        if (r.decision === 'deny') {
          // Exit 2 is the one way a PreToolUse hook blocks a tool; stderr is what the agent reads
          console.error(r.reason);
          process.exit(2);
        }
        if (r.context) console.log(JSON.stringify({ hookSpecificOutput: { hookEventName: 'PreToolUse', additionalContext: r.context } }));
      }
    } else if (cmd === 'renew') {
      renew((rest.includes('--hook') ? hookInput().cwd : undefined) ?? process.cwd());
    } else if (cmd === 'session') {
      for (const l of sessionNotice(process.cwd())) console.log(`leases · ${l}`);
    } else if (cmd === 'claim') {
      const intent = flag('--intent');
      const globs = rest.filter((a, i) => !a.startsWith('--') && rest[i - 1] !== '--intent');
      const r = claim(process.cwd(), globs, intent);
      console.log(`leased (shared): ${r.lease.paths.join(', ')}`);
      if (r.zones.length) console.log(`exclusive zones held: ${r.zones.join(', ')}`);
      for (const x of r.sharedWith) console.log(`⚠ also leased by ${x.branch}${x.intent ? ` ("${x.intent}")` : ''}: ${x.paths.join(', ')}`);
      for (const d of r.denied) console.log(`✗ exclusive zone ${d.zone} is held by ${describe(d.lease, d.holder)}`);
      if (r.denied.length) process.exit(1);
    } else if (cmd === 'list') {
      const cwd = toplevel(process.cwd());
      console.log(rest.includes('--json') ? JSON.stringify({ leases: allLeases(cwd), claims: allClaims(cwd) }, null, 2) : formatList(cwd));
    } else if (cmd === 'release') {
      const s = sessionAt(process.cwd());
      if (!s) throw new Error('release runs in a session worktree on its own branch');
      const r = release(s.root, s.branch);
      console.log(`released ${s.branch}${r.zones.length ? ` and zone(s) ${r.zones.join(', ')}` : ''}`);
    } else if (cmd === 'break') {
      const zone = rest.find((a, i) => !a.startsWith('--') && rest[i - 1] !== '--reason');
      if (!zone) throw new Error('usage: leases.ts break <zone-glob> --reason "<why>"');
      const held = breakZone(toplevel(process.cwd()), zone, flag('--reason') ?? '');
      console.log(held ? `zone ${zone} freed (was held by ${held.branch}); logged` : `zone ${zone} was not held`);
    } else {
      console.error('usage: leases.ts claim <glob…> [--intent "<why>"] | check | renew [--hook] | session | list [--json] | release | break <zone> --reason "<why>"');
      // Not 2: the PreToolUse wiring treats exit 2 as a refusal, and a typo in swarm.json must not block every edit
      process.exit(1);
    }
  } catch (e) {
    console.error(`leases ${cmd}: ${(e as Error).message}`);
    // From a hook, a failure must never block the session: only a deliberate refusal (exit 2 above) does
    process.exit(hookMode ? 0 : 1);
  }
}
