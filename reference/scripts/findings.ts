/**
 * The findings ledger: every problem somebody found (an audit, a review, an incident, CI) with an owner, an SLA and a
 * way out. The reference project detected plenty and closed little (about 20 of 32 audit findings stayed open for ten
 * days, one critical one-line CVE fix sat unapplied), so the number that matters is not how many are found but how
 * long they stay open. This file is that number's source, and `land` reads it as a gate (see `land.ts`).
 *
 *   node scripts/dev/findings.ts add --severity high --title "<what>" --file <path> [--line N] [--source audit|review|incident|ci]
 *                                    [--owner <name>] [--dc DC-xxx] [--id AUD-x] [--introduced <sha>|unknown]
 *                                    [--opened <date>] [--detected <date>] [--catchable-at-review]
 *   node scripts/dev/findings.ts assign <id> --owner <name>
 *   node scripts/dev/findings.ts close <id> [--by <sha>] [--reason "<why>"]
 *   node scripts/dev/findings.ts accept <id> --reason "<why>"     risk accepted: closed for the gate, reported apart
 *   node scripts/dev/findings.ts list [--open | --overdue | --closed]
 *   node scripts/dev/findings.ts check                           exit 1 when an open HIGH is past its SLA
 *   node scripts/dev/findings.ts stats [--since <days>]          open by severity, median age, overdue, closure ratio
 *
 * The ledger is append-only JSONL (`docs/audits/findings.jsonl` by default): a status change is a NEW line with the
 * same `id`, carrying the whole record again, like every ledger of the protocol; the latest line of an id is its
 * state. Nothing is ever deleted, so "how long was it open" stays answerable. `add` is a plain command with no
 * prompts, so an audit loop can call it once per finding.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { type ParseArgsConfig, parseArgs } from 'node:util';
import { config } from './dev-flow.config.ts';
import { git, toplevel, tryGit } from './git.ts';

export type Severity = 'high' | 'medium' | 'low';
export type Status = 'open' | 'closed' | 'accepted';
export type Source = 'audit' | 'review' | 'incident' | 'ci';

export interface Finding {
  id: string;
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  source: Source;
  /** Day the finding entered the ledger (`YYYY-MM-DD`); the SLA clock starts here. */
  opened: string;
  owner?: string;
  sla_due: string;
  status: Status;
  closed?: string;
  /** Commit that closed it (the one carrying `Closes: <id>`). */
  closed_by?: string;
  reason?: string;
  /** Commit that introduced the defect, or "unknown". */
  introduced?: string;
  /** Day the finding was first reported (a carried-over audit finding keeps its date). */
  detected: string;
  catchable_at_review?: boolean;
  /** Defect class of `checklists/defect-classes.md`. */
  dc?: string;
}

export interface FindingsConfig {
  /** Ledger path relative to the repo root. */
  file: string;
  /** Days from `opened` to `sla_due`, by severity. */
  sla: Record<Severity, number>;
  /** `land` refuses when none of the last N lands (any branch) closed a finding, unless this one does. */
  closureEvery: number;
  /** Files with this many `fix` commits in the window that are also over the size limit are "hot" (`audit`). */
  hotFiles: { fixes: number; days: number };
}

export const DEFAULTS: FindingsConfig = {
  file: 'docs/audits/findings.jsonl',
  sla: { high: 2, medium: 14, low: 60 },
  closureEvery: 3,
  hotFiles: { fixes: 3, days: 30 },
};

type DeepPartial<T> = { [K in keyof T]?: T[K] extends object ? DeepPartial<T[K]> : T[K] };

export class FindingsError extends Error {}

const SEVERITIES: readonly Severity[] = ['high', 'medium', 'low'];
const STATUSES: readonly Status[] = ['open', 'closed', 'accepted'];
const SOURCES: readonly Source[] = ['audit', 'review', 'incident', 'ci'];
const DAY = /^\d{4}-\d{2}-\d{2}$/;
const DAY_MS = 86_400_000;

const isObj = (v: unknown): v is Record<string, unknown> => typeof v === 'object' && v !== null && !Array.isArray(v);

/** Defaults, then the dev-flow config, then the `findings` block of `swarm.json` (of `ref` when given, else the file). */
export function findingsConfig(root?: string, ref?: string): FindingsConfig {
  const layers: DeepPartial<FindingsConfig>[] = [(config as { findings?: DeepPartial<FindingsConfig> }).findings ?? {}];
  if (root) {
    try {
      const raw = ref ? tryGit(root, 'show', `${ref}:swarm.json`) : existsSync(join(root, 'swarm.json')) ? readFileSync(join(root, 'swarm.json'), 'utf8') : undefined;
      const block = raw ? (JSON.parse(raw) as { findings?: unknown }).findings : undefined;
      if (isObj(block)) layers.push(block as DeepPartial<FindingsConfig>);
    } catch {
      // an unreadable manifest is the conformance check's problem, not a reason to stop a land
    }
  }
  const out: FindingsConfig = { ...DEFAULTS, sla: { ...DEFAULTS.sla }, hotFiles: { ...DEFAULTS.hotFiles } };
  for (const l of layers) {
    if (typeof l.file === 'string' && l.file) out.file = l.file;
    if (typeof l.closureEvery === 'number' && l.closureEvery >= 0) out.closureEvery = l.closureEvery;
    for (const s of SEVERITIES) if (typeof l.sla?.[s] === 'number') out.sla[s] = l.sla[s] as number;
    if (typeof l.hotFiles?.fixes === 'number') out.hotFiles.fixes = l.hotFiles.fixes;
    if (typeof l.hotFiles?.days === 'number') out.hotFiles.days = l.hotFiles.days;
  }
  return out;
}

// ---- dates (UTC calendar days, so a ledger written in one timezone reads the same in another)

export const isoDay = (d: Date = new Date()): string => d.toISOString().slice(0, 10);
export const addDays = (day: string, n: number): string => isoDay(new Date(Date.parse(`${day}T00:00:00Z`) + n * DAY_MS));
export const daysBetween = (from: string, to: string): number => Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / DAY_MS);

// ---- reading and writing

function validate(raw: unknown, where: string): Finding {
  if (!isObj(raw)) throw new FindingsError(`${where}: not a JSON object`);
  const bad = (what: string) => new FindingsError(`${where}: ${what}`);
  if (typeof raw.id !== 'string' || !raw.id) throw bad('missing id');
  if (!SEVERITIES.includes(raw.severity as Severity)) throw bad(`severity must be ${SEVERITIES.join('|')}`);
  if (!STATUSES.includes(raw.status as Status)) throw bad(`status must be ${STATUSES.join('|')}`);
  if (!SOURCES.includes(raw.source as Source)) throw bad(`source must be ${SOURCES.join('|')}`);
  for (const k of ['title', 'file'] as const) if (typeof raw[k] !== 'string' || !raw[k]) throw bad(`missing ${k}`);
  for (const k of ['opened', 'sla_due', 'detected'] as const) if (typeof raw[k] !== 'string' || !DAY.test(raw[k] as string)) throw bad(`${k} must be YYYY-MM-DD`);
  return raw as unknown as Finding;
}

/** Every line of ledger text, in order (the history). A malformed line is an error that names the line. */
export function parseLedger(text: string, label = 'ledger'): Finding[] {
  return text.split('\n').flatMap((l, i) => {
    if (!l.trim()) return [];
    let raw: unknown;
    try {
      raw = JSON.parse(l);
    } catch {
      throw new FindingsError(`${label}:${i + 1}: not valid JSON`);
    }
    return [validate(raw, `${label}:${i + 1}`)];
  });
}

export const readLedger = (file: string): Finding[] => (existsSync(file) ? parseLedger(readFileSync(file, 'utf8'), file) : []);

/** The state of every finding: the latest line of each id, in order of first appearance. */
export function latest(lines: Finding[]): Finding[] {
  const byId = new Map<string, Finding>();
  for (const l of lines) byId.set(l.id, { ...byId.get(l.id), ...l });
  return [...byId.values()];
}

export const loadFindings = (file: string): Finding[] => latest(readLedger(file));

/** Same, from ledger text (for a file read from another git ref). */
export const parseFindings = (text: string, label = 'ledger'): Finding[] => latest(parseLedger(text, label));

export function appendFinding(file: string, f: Finding): void {
  mkdirSync(dirname(file), { recursive: true });
  appendFileSync(file, `${JSON.stringify(f)}\n`);
}

// ---- queries

export const openFindings = (list: Finding[]): Finding[] => list.filter((f) => f.status === 'open');

/** Open findings whose SLA date is before `today`, oldest deadline first; optionally only one severity. */
export function overdue(list: Finding[], today: string = isoDay(), severity?: Severity): Finding[] {
  return openFindings(list)
    .filter((f) => f.sla_due < today && (!severity || f.severity === severity))
    .sort((a, b) => a.sla_due.localeCompare(b.sla_due));
}

export const daysOverdue = (f: Finding, today: string): number => daysBetween(f.sla_due, today);

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

export interface Stats {
  open: Record<Severity, number> & { total: number };
  overdue: number;
  /** Median days since `opened` over the open findings; absent when none is open. */
  median_open_age_days?: number;
  window_days: number;
  opened_in_window: number;
  closed_in_window: number;
  /** closed / opened in the window (two decimals); absent when nothing was opened. Accepted risks are not closures. */
  closure_ratio?: number;
  accepted: number;
}

export function stats(list: Finding[], opts: { today?: string; sinceDays?: number } = {}): Stats {
  const today = opts.today ?? isoDay();
  const window = opts.sinceDays ?? 14;
  const from = addDays(today, -window);
  const open = openFindings(list);
  const count = (s: Severity) => open.filter((f) => f.severity === s).length;
  const opened = list.filter((f) => f.opened >= from).length;
  const closed = list.filter((f) => f.status === 'closed' && f.closed !== undefined && f.closed >= from).length;
  const age = median(open.map((f) => daysBetween(f.opened, today)));
  return {
    open: { high: count('high'), medium: count('medium'), low: count('low'), total: open.length },
    overdue: overdue(list, today).length,
    ...(age === undefined ? {} : { median_open_age_days: Math.round(age) }),
    window_days: window,
    opened_in_window: opened,
    closed_in_window: closed,
    ...(opened ? { closure_ratio: Math.round((closed / opened) * 100) / 100 } : {}),
    accepted: list.filter((f) => f.status === 'accepted').length,
  };
}

/** `open 12 · overdue 2 · median age 9d · closure 0.6`: one line for headlines (conformance check, session notice). */
export function headline(s: Stats): string {
  const age = s.median_open_age_days === undefined ? '-' : `${s.median_open_age_days}d`;
  return `open ${s.open.total} · overdue ${s.overdue} · median age ${age} · closure ${s.closure_ratio ?? '-'}`;
}

// ---- changing state

function transition(file: string, id: string, to: 'closed' | 'accepted', extra: { by?: string; reason?: string; today?: string }): Finding {
  const f = loadFindings(file).find((x) => x.id === id);
  if (!f) throw new FindingsError(`no finding ${id} in ${file}`);
  if (f.status !== 'open') throw new FindingsError(`${id} is already ${f.status}${f.closed ? ` (${f.closed})` : ''}`);
  const next: Finding = { ...f, status: to, closed: extra.today ?? isoDay(), ...(extra.by ? { closed_by: extra.by } : {}), ...(extra.reason ? { reason: extra.reason } : {}) };
  appendFinding(file, next);
  return next;
}

export const closeFinding = (file: string, id: string, opts: { by?: string; reason?: string; today?: string } = {}): Finding => transition(file, id, 'closed', opts);

export function acceptFinding(file: string, id: string, opts: { reason: string; today?: string }): Finding {
  if (!opts.reason.trim()) throw new FindingsError('accepting a risk needs a reason');
  return transition(file, id, 'accepted', opts);
}

export function assignFinding(file: string, id: string, owner: string): Finding {
  const f = loadFindings(file).find((x) => x.id === id);
  if (!f) throw new FindingsError(`no finding ${id} in ${file}`);
  const next: Finding = { ...f, owner };
  appendFinding(file, next);
  return next;
}

export const slug = (title: string): string =>
  title
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '')
    .slice(0, 40)
    .replace(/-+$/, '');

/** `AUD-<slug of the title>`, made unique against the ids already in the ledger. */
export function newId(title: string, existing: string[]): string {
  const base = `AUD-${slug(title) || 'finding'}`;
  let id = base;
  for (let n = 2; existing.includes(id); n++) id = `${base}-${n}`;
  return id;
}

export interface AddInput {
  severity: Severity;
  title: string;
  file: string;
  line?: number;
  source?: Source;
  owner?: string;
  dc?: string;
  id?: string;
  introduced?: string;
  opened?: string;
  detected?: string;
  catchable_at_review?: boolean;
}

export function addFinding(file: string, cfg: FindingsConfig, input: AddInput, today: string = isoDay()): Finding {
  const existing = loadFindings(file).map((f) => f.id);
  if (input.id && existing.includes(input.id)) throw new FindingsError(`${input.id} already exists: use close, accept or assign to change it`);
  const opened = input.opened ?? today;
  const f: Finding = {
    id: input.id ?? newId(input.title, existing),
    severity: input.severity,
    title: input.title,
    file: input.file,
    ...(input.line === undefined ? {} : { line: input.line }),
    source: input.source ?? 'audit',
    opened,
    ...(input.owner ? { owner: input.owner } : {}),
    sla_due: addDays(opened, cfg.sla[input.severity] ?? 0),
    status: 'open',
    ...(input.introduced ? { introduced: input.introduced } : {}),
    detected: input.detected ?? opened,
    ...(input.catchable_at_review === undefined ? {} : { catchable_at_review: input.catchable_at_review }),
    ...(input.dc ? { dc: input.dc } : {}),
  };
  validate(f, 'new finding');
  appendFinding(file, f);
  return f;
}

// ---- what a commit says it closes (read by `land`)

export interface CommitInfo {
  sha: string;
  subject: string;
  body: string;
}

/** Commits of `base..tip`, oldest first, with their full messages (trailers live in the body). */
export function branchCommits(cwd: string, base: string, tip = 'HEAD'): CommitInfo[] {
  return git(cwd, 'log', '--reverse', '--format=%H%x1f%s%x1f%b%x1e', `${base}..${tip}`)
    .split('\x1e')
    .map((r) => r.replace(/^\n/, ''))
    .filter((r) => r.trim())
    .map((r) => {
      const [sha = '', subject = '', body = ''] = r.split('\x1f');
      return { sha, subject, body };
    });
}

/**
 * Finding ids a commit claims to close: `Closes: AUD-a, AUD-b` lines anywhere in the message (a trailer, or the
 * subject's own line) and the `fix(AUD-x):` subject form. Whether they exist and are open is for the caller to check
 * against the ledger: a typo must not count as closure.
 */
export function closingIds(c: Pick<CommitInfo, 'subject' | 'body'>): string[] {
  const ids = new Set<string>();
  for (const m of `${c.subject}\n${c.body}`.matchAll(/^Closes:[ \t]*(.+)$/gim)) for (const t of (m[1] as string).split(/[\s,]+/)) if (/^[A-Za-z][\w.-]*$/.test(t)) ids.add(t);
  const scoped = /^fix\((AUD-[\w.-]+)\)[!:]/.exec(c.subject);
  if (scoped?.[1]) ids.add(scoped[1]);
  return [...ids];
}

/** A `refactor:` / `refactor(scope):` commit: paying structure down counts toward the closure quota. */
export const isRefactor = (subject: string): boolean => /^refactor(\([^)]*\))?!?:/i.test(subject);

// ---- CLI

function render(f: Finding, today: string): string {
  const due = f.status === 'open' ? (f.sla_due < today ? `OVERDUE ${daysOverdue(f, today)}d` : `due ${f.sla_due}`) : `${f.status} ${f.closed ?? ''}`.trim();
  return `${f.id.padEnd(34)} ${f.severity.padEnd(6)} ${due.padEnd(16)} ${(f.owner ?? '(no owner)').padEnd(14)} ${f.title}  [${f.file}${f.line ? `:${f.line}` : ''}]`;
}

type Options = NonNullable<ParseArgsConfig['options']>;

/** Runs one command and returns the exit code; `out` is where lines go (tests pass a collector). */
export function main(argv: string[], out: (line: string) => void = console.log, cwd: string = process.cwd()): number {
  const [cmd, ...rest] = argv;
  const root = toplevel(cwd);
  const cfg = findingsConfig(root);
  const file = join(root, cfg.file);
  // `--today` exists so loops and tests can pin the clock
  type Values = Record<string, string | boolean | undefined>;
  const parse = (options: Options) => {
    const r = parseArgs({ args: rest, allowPositionals: true, strict: true, options: { today: { type: 'string' }, ...options } });
    return { values: r.values as Values, positionals: r.positionals };
  };
  const dayOf = (v: Values) => (typeof v.today === 'string' ? v.today : isoDay());
  const str = (v: unknown) => (typeof v === 'string' ? v : undefined);
  try {
    switch (cmd) {
      case 'add': {
        const { values: v } = parse({
          severity: { type: 'string' }, title: { type: 'string' }, file: { type: 'string' }, line: { type: 'string' }, source: { type: 'string' },
          owner: { type: 'string' }, dc: { type: 'string' }, id: { type: 'string' }, introduced: { type: 'string' }, opened: { type: 'string' },
          detected: { type: 'string' }, 'catchable-at-review': { type: 'boolean' },
        });
        if (!v.severity || !v.title || !v.file) throw new FindingsError('add needs --severity, --title and --file');
        const f = addFinding(file, cfg, {
          severity: v.severity as Severity, title: str(v.title) as string, file: str(v.file) as string, source: str(v.source) as Source | undefined, owner: str(v.owner),
          dc: str(v.dc), id: str(v.id), introduced: str(v.introduced), opened: str(v.opened), detected: str(v.detected),
          ...(v.line ? { line: Number(v.line) } : {}), ...(v['catchable-at-review'] ? { catchable_at_review: true } : {}),
        }, dayOf(v));
        out(`added ${f.id} (${f.severity}, due ${f.sla_due})${f.severity === 'high' && !f.owner ? `; a high finding needs an owner: findings assign ${f.id} --owner <name>` : ''}`);
        return 0;
      }
      case 'assign': {
        const { values: v, positionals } = parse({ owner: { type: 'string' } });
        if (!positionals[0] || !v.owner) throw new FindingsError('usage: assign <id> --owner <name>');
        out(`assigned ${assignFinding(file, positionals[0], str(v.owner) as string).id} to ${v.owner}`);
        return 0;
      }
      case 'close': {
        const { values: v, positionals } = parse({ by: { type: 'string' }, reason: { type: 'string' } });
        if (!positionals[0]) throw new FindingsError('usage: close <id> [--by <sha>] [--reason "<why>"]');
        const f = closeFinding(file, positionals[0], { by: str(v.by), reason: str(v.reason), today: dayOf(v) });
        out(`closed ${f.id} (open since ${f.opened})`);
        return 0;
      }
      case 'accept': {
        const { values: v, positionals } = parse({ reason: { type: 'string' } });
        if (!positionals[0] || !v.reason) throw new FindingsError('usage: accept <id> --reason "<why>"');
        const f = acceptFinding(file, positionals[0], { reason: str(v.reason) as string, today: dayOf(v) });
        out(`accepted ${f.id}: ${f.reason}`);
        return 0;
      }
      case 'list': {
        const { values: v } = parse({ open: { type: 'boolean' }, overdue: { type: 'boolean' }, closed: { type: 'boolean' } });
        const day = dayOf(v);
        const all = loadFindings(file);
        const shown = v.overdue ? overdue(all, day) : v.open ? openFindings(all) : v.closed ? all.filter((f) => f.status !== 'open') : all;
        for (const f of shown) out(render(f, day));
        if (!shown.length) out('no findings');
        return 0;
      }
      case 'check': {
        const { values: v } = parse({});
        const day = dayOf(v);
        const all = loadFindings(file);
        const mediums = overdue(all, day, 'medium');
        if (mediums.length) out(`warning: ${mediums.length} open MEDIUM past the SLA: ${mediums.map((f) => `${f.id} (${daysOverdue(f, day)} day(s) overdue)`).join(', ')}`);
        const highs = overdue(all, day, 'high');
        if (highs.length) {
          out(`findings: ${highs.length} open HIGH past the SLA: ${highs.map((f) => `${f.id} (${daysOverdue(f, day)} day(s) overdue${f.owner ? `, owner ${f.owner}` : ''})`).join(', ')}`);
          return 1;
        }
        out(`findings: no open HIGH past its SLA (${headline(stats(all, { today: day }))})`);
        return 0;
      }
      case 'stats': {
        const { values: v } = parse({ since: { type: 'string' } });
        const s = stats(loadFindings(file), { today: dayOf(v), sinceDays: v.since ? Number(v.since) : undefined });
        out(`open: ${s.open.high} high · ${s.open.medium} medium · ${s.open.low} low (${s.open.total})`);
        out(`overdue: ${s.overdue} · median open age: ${s.median_open_age_days ?? '-'} day(s) · accepted risks: ${s.accepted}`);
        out(`last ${s.window_days} days: opened ${s.opened_in_window} · closed ${s.closed_in_window} · closure ratio ${s.closure_ratio ?? '-'}`);
        out(headline(s));
        return 0;
      }
      default:
        out('usage: findings <add|assign|close|accept|list|check|stats> (see the header of findings.ts)');
        return cmd ? 2 : 0;
    }
  } catch (e) {
    const code = String((e as { code?: unknown }).code ?? '');
    if (e instanceof FindingsError || code.startsWith('ERR_PARSE_ARGS')) {
      console.error(`findings: ${(e as Error).message}`);
      return 1;
    }
    throw e;
  }
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
