/**
 * Roadmap on top of spec-driven changes (OpenSpec layout): the roadmap file orders and prioritizes the changes (the
 * spec tool itself has no priority).
 *
 *   pnpm roadmap        table by wave and priority, with the status derived from the changes folder and the progress of tasks.md
 *
 * Status is never written by hand: planned (does not exist yet), active (in the changes folder), done (archived).
 * `roadmapProblems` is what the test checks: every active change is in the roadmap and every reference exists.
 *
 * Work in progress has a limit. `wipProblems` (part of `roadmapProblems`, so part of verify) fails when more changes
 * are active than `roadmap.maxActive`, and when a change has gone `roadmap.staleDays` without a task being ticked.
 * The reference project reached 75 active changes, 19 of them never started, because nothing said "enough": opening
 * is cheap, closing is work, and without a limit only opening happens. The message names the way out: finish, archive
 * or park. A change is PARKED, and exempt from the stale check only, by a line in its proposal.md:
 *
 *     parked: <reason>
 *
 * Parking is not an escape from the limit: a parked change still counts as active. To stop counting it, archive it
 * or delete the folder and leave its roadmap entry as `planned`.
 *
 * The one dependency outside node:* is the `yaml` package (already present wherever the OpenSpec CLI is installed),
 * loaded only when the roadmap file is read, so the WIP check works without it. If you keep the roadmap as JSON, swap
 * `parse` for `JSON.parse` and drop `createRequire`.
 */
import { spawnSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';

/** `roadmap` block of dev-flow.config.ts (optional; read through a cast so the config file stays the other agents'). */
export interface RoadmapConfig {
  /** Active changes allowed at once. */
  maxActive: number;
  /** Days without a task ticked after which a change is stale. */
  staleDays: number;
}
export const ROADMAP_DEFAULTS: RoadmapConfig = { maxActive: 12, staleDays: 14 };
const wipConfig = (): RoadmapConfig => ({ ...ROADMAP_DEFAULTS, ...(config.roadmap ?? {}) });

export type Priority = 'P0' | 'P1' | 'P2';
const PRIORITIES: Priority[] = ['P0', 'P1', 'P2'];

export interface RoadmapChange {
  id: string;
  title: string;
  /** Product area or block the change belongs to. */
  block: string;
  wave?: number;
  priority: Priority;
  depends_on?: string[];
  absorbed_by?: string;
  frozen?: boolean;
}

export interface Roadmap {
  goal: string;
  waves: Record<string, string>;
  changes: RoadmapChange[];
}

export type Status = 'planned' | 'active' | 'done';

export function loadRoadmap(root: string): Roadmap {
  const { parse } = createRequire(import.meta.url)('yaml') as { parse: (text: string) => unknown };
  return parse(readFileSync(join(root, config.roadmapFile), 'utf8')) as Roadmap;
}

/** Active changes (folders of the changes dir except archive). */
export function activeChanges(root: string): string[] {
  const dir = join(root, config.changesDir);
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => d.name);
}

/** Archived: `archive/<date>-<id>`. */
function archivedChanges(root: string): Set<string> {
  const dir = join(root, config.changesDir, 'archive');
  if (!existsSync(dir)) return new Set();
  return new Set(readdirSync(dir).map((n) => n.replace(/^\d{4}-\d{2}-\d{2}-/, '')));
}

export function statusOf(root: string, id: string): Status {
  if (existsSync(join(root, config.changesDir, id))) return 'active';
  return archivedChanges(root).has(id) ? 'done' : 'planned';
}

/** Closed / total tasks of an active change. */
export function taskProgress(root: string, id: string): { done: number; total: number } | undefined {
  const file = join(root, config.changesDir, id, 'tasks.md');
  if (!existsSync(file)) return undefined;
  const text = readFileSync(file, 'utf8');
  const done = (text.match(/^\s*- \[x\]/gim) ?? []).length;
  const open = (text.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] });
  return r.status === 0 ? r.stdout.trim() : '';
};

/** The reason after `parked:` in the change's proposal, if it has one. */
export function parkedReason(root: string, id: string): string | undefined {
  const file = join(root, config.changesDir, id, 'proposal.md');
  if (!existsSync(file)) return undefined;
  return /^\s*parked:[ \t]*(\S.*)$/im.exec(readFileSync(file, 'utf8'))?.[1]?.trim();
}

/**
 * Unix time of the last commit that added or removed a tick in the change's tasks.md; when it never had one, of the
 * commit that created the file (a change nobody has started is as old as its folder). `undefined` outside git or
 * before the first commit: nothing to measure, so nothing is flagged.
 */
export function lastProgress(root: string, id: string): number | undefined {
  const file = `${config.changesDir}/${id}/tasks.md`;
  const tick = git(root, 'log', '-1', '--format=%ct', '-S[x]', '--', file);
  const created = git(root, 'log', '--diff-filter=A', '--format=%ct', '--', file).split('\n').filter(Boolean).pop();
  const at = Number(tick || created);
  return Number.isFinite(at) && at > 0 ? at : undefined;
}

/** The work-in-progress limit: too many active changes, and stale ones that are not parked. */
export function wipProblems(root: string, cfg = wipConfig(), now = Date.now() / 1000): string[] {
  const dir = join(root, config.changesDir);
  if (!existsSync(dir)) return [];
  const problems: string[] = [];
  const active = activeChanges(root).map((id) => ({ id, at: lastProgress(root, id), parked: parkedReason(root, id) }));
  const ageDays = (at: number | undefined) => (at === undefined ? 0 : Math.floor((now - at) / 86400));
  if (active.length > cfg.maxActive) {
    const oldest = [...active].sort((a, b) => (a.at ?? Infinity) - (b.at ?? Infinity)).slice(0, 5);
    problems.push(
      `${active.length} active changes, the limit is ${cfg.maxActive} (roadmap.maxActive). Close before opening: finish, archive or park the oldest, ` +
        `starting with ${oldest.map((c) => `${c.id} (${c.at === undefined ? 'age unknown' : `${ageDays(c.at)} d since progress`})`).join(', ')}. Parked changes still count: archive them or delete the folder and keep the roadmap entry as planned.`,
    );
  }
  for (const c of active) {
    if (c.parked || c.at === undefined || ageDays(c.at) < cfg.staleDays) continue;
    problems.push(
      `${c.id}: stale, no task ticked for ${ageDays(c.at)} days (limit ${cfg.staleDays}, roadmap.staleDays). Finish it, archive it, or add "parked: <reason>" to its proposal.md.`,
    );
  }
  return problems;
}

export function roadmapProblems(root: string, roadmap = loadRoadmap(root)): string[] {
  const problems: string[] = wipProblems(root);
  const byId = new Map<string, RoadmapChange>();
  for (const c of roadmap.changes) {
    if (byId.has(c.id)) problems.push(`${c.id}: appears twice`);
    byId.set(c.id, c);
  }
  for (const c of roadmap.changes) {
    if (!PRIORITIES.includes(c.priority)) problems.push(`${c.id}: priority "${c.priority}" is not one of ${PRIORITIES.join(', ')}`);
    if (c.priority !== 'P2' && c.wave === undefined) problems.push(`${c.id}: a ${c.priority} change needs a wave`);
    if (c.wave !== undefined && !(String(c.wave) in roadmap.waves)) problems.push(`${c.id}: wave ${c.wave} does not exist`);
    if (c.frozen && c.priority === 'P0') problems.push(`${c.id}: a P0 change cannot be frozen`);
    for (const d of c.depends_on ?? []) {
      const dep = byId.get(d);
      if (!dep) problems.push(`${c.id}: depends on "${d}", which is not in the roadmap`);
      else if (dep.wave !== undefined && c.wave !== undefined && dep.wave > c.wave) problems.push(`${c.id}: depends on "${d}", which is in a later wave`);
    }
    if (c.absorbed_by && !byId.has(c.absorbed_by)) problems.push(`${c.id}: absorbed by "${c.absorbed_by}", which is not in the roadmap`);
  }
  for (const id of activeChanges(root)) if (!byId.has(id)) problems.push(`${id}: active change without an entry in ${config.roadmapFile}`);
  return problems;
}

/** Work order: wave, priority and file order; frozen and P2 at the end. */
export function ordered(roadmap: Roadmap): RoadmapChange[] {
  const rank = (c: RoadmapChange) => (c.frozen ? 2 : 0) + (c.priority === 'P2' ? 1 : 0);
  return roadmap.changes
    .map((c, i) => ({ c, i }))
    .sort((a, b) => rank(a.c) - rank(b.c) || (a.c.wave ?? 99) - (b.c.wave ?? 99) || PRIORITIES.indexOf(a.c.priority) - PRIORITIES.indexOf(b.c.priority) || a.i - b.i)
    .map((x) => x.c);
}

export function renderRoadmap(root: string, roadmap = loadRoadmap(root)): string {
  const lines = [`Goal: ${roadmap.goal}`, ''];
  let wave: string | undefined;
  for (const c of ordered(roadmap)) {
    const group = c.frozen ? 'Frozen' : c.wave === undefined ? 'Outside the plan' : `Wave ${c.wave} · ${roadmap.waves[String(c.wave)]}`;
    if (group !== wave) lines.push(`${wave === undefined ? '' : '\n'}${group}`);
    wave = group;
    const own = statusOf(root, c.id);
    // Absorbed and already removed from the repo: its work continues in the change that absorbs it
    const status = own === 'planned' && c.absorbed_by ? 'merged' : own;
    const tasks = status === 'active' ? taskProgress(root, c.id) : undefined;
    const extra = [tasks ? `${tasks.done}/${tasks.total}` : '', c.absorbed_by ? `→ ${c.absorbed_by}` : ''].filter(Boolean).join(' ');
    lines.push(`  ${c.priority} ${c.block.padEnd(4)} ${status.padEnd(7)} ${c.id.padEnd(36)} ${extra}`.trimEnd());
  }
  return lines.join('\n');
}

if (import.meta.main) {
  const root = process.cwd();
  const problems = roadmapProblems(root);
  if (problems.length) {
    console.error(`✗ ${config.roadmapFile}:\n${problems.map((p) => `  - ${p}`).join('\n')}`);
    process.exit(1);
  }
  console.log(renderRoadmap(root));
}
