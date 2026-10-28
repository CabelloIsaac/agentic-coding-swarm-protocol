/**
 * Deterministic metrics for the periodic repo audit (the audit skill reads the code; this is the repeatable part).
 *
 *   pnpm audit:repo                 print the metrics table and the difference from the last snapshot
 *   pnpm audit:repo --write         also save <audit dir>/<date>.metrics.json (the next run compares against it)
 *   pnpm audit:repo --deps          include `pnpm audit --prod` (network); everything else is local and takes seconds
 *   pnpm audit:repo --json          JSON output instead of the table
 *   pnpm audit:repo --write --findings <file.json>
 *                                   also store the report's findings with their detection data (see `FindingRecord`):
 *                                   median detection latency, escape rate and rules found eroding go in the snapshot
 *
 * It measures what the `verify` gates let through without failing: lint warnings and their trend, type escapes, big
 * files, TODOs, nearly-done or stalled spec changes, spec validation errors, undocumented environment variables,
 * secret patterns in versioned files and the age of the last audit. It runs no tests and spends no money.
 *
 * Noise: the `any`, `@ts-ignore`, TODO and big-file counts skip the playground and this script's own source (its
 * regexes match themselves); in the reference project those two inflated `any` by 6 and TODO by 17 in one audit.
 * Closure first: the findings ledger (`findings.ts`) is summarised at the top of the table (open by severity, overdue,
 * median open age, opened and closed in 14 days, closure ratio, accepted risks) because an audit that finds more than
 * the team closes has not improved anything; hot files (many `fix` commits in a file that is also over the size
 * limit) follow, since a file that keeps being repaired is the cheapest refactor target. Detection comes after.
 * Rules: the bullets of CLAUDE.md are counted by marker (`enforced:` / `preference` / unmarked), so a rule nothing
 * enforces stays visible.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { config } from './dev-flow.config.ts';
import { type Finding, type Stats, findingsConfig, isoDay, loadFindings, stats as findingsStats } from './findings.ts';
import { commonDir, toplevel } from './git.ts';
import { countLines } from './ratchets.ts';

const A = config.audit;
export const AUDITS_DIR = A.dir;
export const AUDIT_MAX_AGE_DAYS = A.maxAgeDays;
const BIG_FILE_LINES = A.bigFileLines;
const NEAR_DONE_RATIO = A.nearDoneRatio;

export interface ChangeProgress {
  id: string;
  done: number;
  total: number;
}

/**
 * One finding of the report, as the audit skill writes it to the `--findings` file. `introduced` is the commit that
 * introduced the defect (`git log -S`, `git blame`, `git log -L`) or "unknown"; `detected` the date of the audit that
 * first reported it (carried-over findings keep theirs); `catchable_at_review` whether a per-change diff review with
 * the defect-class catalog would have caught it; `rule` the CLAUDE.md rule it erodes, if any.
 */
export interface FindingRecord {
  id: string;
  severity: 'high' | 'medium' | 'low';
  introduced: string;
  detected: string;
  catchable_at_review: boolean;
  rule?: string;
}

export interface Detection {
  findings: (FindingRecord & { latency_days?: number })[];
  /** Findings first detected in this audit; the figures below are over these only, so nothing counts twice. */
  new: number;
  median_latency_days?: number;
  /** New findings a per-change review could have caught, over all new findings (0–1). */
  escape_rate?: number;
}

/** The ledger's numbers at snapshot time (what `findings stats` prints, over the last 14 days). */
export interface Closure {
  open: Stats['open'];
  overdue: number;
  median_open_age_days?: number;
  opened_14d: number;
  closed_14d: number;
  closure_ratio?: number;
  accepted: number;
}

/** A file repaired again and again that is also too big: `fixes` commits starting with `fix` in the window. */
export interface HotFile {
  file: string;
  fixes: number;
  lines: number;
}

export interface Metrics {
  date: string;
  commit: string;
  lint: { errors: number; warnings: number; infos: number; rules: Record<string, number> };
  escapes: { any: number; as_unknown_as: number; ts_ignore: number; ts_expect_error: number; biome_ignore: number; biome_ignore_without_reason: number };
  big_files: { count: number; top: { file: string; lines: number }[] };
  todos: number;
  specs: { active: number; near_done: ChangeProgress[]; not_started: string[]; validate_errors: number; validate_warnings: number };
  env_undocumented: string[];
  secret_hits: string[];
  adr_drafts: string[];
  coverage: { thresholds: Record<string, number>; measured?: Record<string, number> };
  deps?: Record<string, number>;
  last_audit_days?: number;
  rules?: { total: number; enforced: number; preference: number; unmarked: number; eroding?: string[] };
  detection?: Detection;
  closure?: Closure;
  hot_files?: HotFile[];
  /** Land-log entries since the previous snapshot (all of them without one): what the workflow let through. */
  land?: LandActivity;
}

export interface LandActivity {
  landed: number;
  conflict: number;
  review_bypassed: number;
  /** Lands let through `--override-findings` (the SLA or closure-quota gate would have refused them). */
  findings_overridden: number;
  /** Date of the previous snapshot the counts start from; absent when there was none. */
  since?: string;
}

/**
 * Counts `landed`, `conflict` and `review-bypassed` entries of the land log. A bypass (`land --no-review`) is only
 * visible there, so the audit has to read it or it never reaches anyone. Entries of the snapshot's own day count too:
 * double-counting one afternoon is better than losing a bypass that happened after the snapshot was taken.
 */
export function landActivity(lines: string[], since?: string): LandActivity {
  const out: LandActivity = { landed: 0, conflict: 0, review_bypassed: 0, findings_overridden: 0, ...(since ? { since } : {}) };
  for (const line of lines) {
    let e: { at?: unknown; result?: unknown };
    try {
      e = JSON.parse(line) as { at?: unknown; result?: unknown };
    } catch {
      continue;
    }
    if (since && !(typeof e.at === 'string' && e.at.slice(0, 10) >= since)) continue;
    if (e.result === 'landed') out.landed++;
    else if (e.result === 'conflict') out.conflict++;
    else if (e.result === 'review-bypassed') out.review_bypassed++;
    else if (e.result === 'findings-overridden') out.findings_overridden++;
  }
  return out;
}

function readLandLog(cwd: string): string[] | undefined {
  try {
    const file = join(commonDir(cwd), `${config.projectName}-land-log.jsonl`);
    return existsSync(file) ? readFileSync(file, 'utf8').split('\n').filter(Boolean) : undefined;
  } catch {
    return undefined;
  }
}

export function closureMetrics(list: Finding[], today: string = isoDay()): Closure {
  const s = findingsStats(list, { today, sinceDays: 14 });
  return {
    open: s.open,
    overdue: s.overdue,
    ...(s.median_open_age_days === undefined ? {} : { median_open_age_days: s.median_open_age_days }),
    opened_14d: s.opened_in_window,
    closed_14d: s.closed_in_window,
    ...(s.closure_ratio === undefined ? {} : { closure_ratio: s.closure_ratio }),
    accepted: s.accepted,
  };
}

/** Files named by each commit whose subject starts with `fix` (`git log --name-only` output with `\x01<subject>` headers). */
export function fixCounts(log: string): Map<string, number> {
  const counts = new Map<string, number>();
  for (const block of log.split('\x01').slice(1)) {
    const [subject = '', ...files] = block.split('\n');
    if (!/^fix\b/i.test(subject)) continue;
    for (const f of new Set(files.filter(Boolean))) counts.set(f, (counts.get(f) ?? 0) + 1);
  }
  return counts;
}

/** Hot files: at least `fixes` fix commits in the last `days` days AND currently over `max` lines (it still exists). */
export function hotFiles(cwd: string, opts: { fixes: number; days: number; max: number }): HotFile[] {
  const log = run(cwd, 'git', ['log', `--since=${opts.days}.days.ago`, '--name-only', '--format=%x01%s']);
  const hot: HotFile[] = [];
  for (const [file, fixes] of fixCounts(log)) {
    if (fixes < opts.fixes || !existsSync(join(cwd, file))) continue;
    const lines = countLines(readFileSync(join(cwd, file), 'utf8'));
    if (lines > opts.max) hot.push({ file, fixes, lines });
  }
  return hot.sort((a, b) => b.fixes - a.fixes || b.lines - a.lines || a.file.localeCompare(b.file));
}

/** The file-size limit the ratchets enforce (`fileSize.max`), else the audit's own threshold. */
function sizeLimit(cwd: string): number {
  try {
    const max = (JSON.parse(readFileSync(join(cwd, config.ratchets.file), 'utf8')) as { fileSize?: { max?: unknown } }).fileSize?.max;
    if (typeof max === 'number') return max;
  } catch {
    // no ratchets file yet: fall back to the default below
  }
  return 500;
}

const run = (cwd: string, cmd: string, args: string[]): string => {
  try {
    return execFileSync(cmd, args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'], maxBuffer: 64 * 1024 * 1024 });
  } catch (e) {
    // lint / spec validation / dependency audit exit non-zero when they have findings: the output is still valid
    const out = (e as { stdout?: string | Buffer }).stdout;
    return out ? String(out) : '';
  }
};

/** Folders and files whose code is not the product: counting them measures noise. */
export function isMetricNoise(file: string, self = selfPath()): boolean {
  return file.startsWith(`${config.playgroundDir}/`) || file === self;
}

function selfPath(): string {
  try {
    return relative(toplevel(import.meta.dirname), import.meta.filename);
  } catch {
    return '';
  }
}

/** Versioned source files, without tests or generated ones. */
export function sourceFiles(cwd: string): string[] {
  return run(cwd, 'git', ['ls-files', '--', '*.ts', '*.tsx'])
    .split('\n')
    .filter((f) => f && !/\.test\.tsx?$/.test(f) && !/(^|\/)(node_modules|\.next|dist|coverage)\//.test(f) && !/\.d\.ts$/.test(f));
}

export function countEscapes(sources: { file: string; text: string }[]): Metrics['escapes'] {
  const c = { any: 0, as_unknown_as: 0, ts_ignore: 0, ts_expect_error: 0, biome_ignore: 0, biome_ignore_without_reason: 0 };
  for (const { text } of sources) {
    c.any += (text.match(/(?::\s*any\b|<any>|\bas any\b|\bany\[\])/g) ?? []).length;
    c.as_unknown_as += (text.match(/\bas unknown as\b/g) ?? []).length;
    c.ts_ignore += (text.match(/@ts-ignore/g) ?? []).length;
    c.ts_expect_error += (text.match(/@ts-expect-error/g) ?? []).length;
    // Format: `biome-ignore lint/<rule>: <reason>`; without the reason after the colon it counts as unjustified
    for (const m of text.matchAll(/biome-ignore\s+[^\s:]+:?[ \t]*(\S.*)?$/gm)) {
      c.biome_ignore++;
      if (!m[1]) c.biome_ignore_without_reason++;
    }
  }
  return c;
}

export function parseTasks(md: string): { done: number; total: number } {
  const done = (md.match(/^\s*- \[[xX]\]/gm) ?? []).length;
  const open = (md.match(/^\s*- \[ \]/gm) ?? []).length;
  return { done, total: done + open };
}

export function changesProgress(cwd: string): ChangeProgress[] {
  const dir = join(cwd, config.changesDir);
  if (!existsSync(dir)) return [];
  return readdirSync(dir, { withFileTypes: true })
    .filter((d) => d.isDirectory() && d.name !== 'archive')
    .map((d) => {
      const tasks = join(dir, d.name, 'tasks.md');
      const p = existsSync(tasks) ? parseTasks(readFileSync(tasks, 'utf8')) : { done: 0, total: 0 };
      return { id: d.name, ...p };
    })
    .sort((a, b) => a.id.localeCompare(b.id));
}

export function classifyChanges(all: ChangeProgress[]): Pick<Metrics['specs'], 'near_done' | 'not_started'> {
  return {
    near_done: all.filter((c) => c.total >= 5 && c.done < c.total && c.done / c.total >= NEAR_DONE_RATIO),
    not_started: all.filter((c) => c.total > 0 && c.done === 0).map((c) => c.id),
  };
}

/** `process.env.X` variables in code that are not in the env example file (those of Node, the framework and tests do not count). */
export function undocumentedEnv(sources: { text: string }[], envExample: string): string[] {
  const known = new Set([...envExample.matchAll(/^\s*#?\s*([A-Z][A-Z0-9_]+)=/gm)].map((m) => m[1] as string));
  const used = new Set<string>();
  for (const { text } of sources) for (const m of text.matchAll(/process\.env\.([A-Z][A-Z0-9_]+)/g)) used.add(m[1] as string);
  return [...used].filter((v) => !known.has(v) && !A.envIgnore.test(v)).sort();
}

const SECRET_PATTERNS: [string, RegExp][] = [
  ['anthropic', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['aws', /\bAKIA[0-9A-Z]{16}\b/],
  ['slack', /xox[abp]-[0-9A-Za-z-]{10,}/],
  ['github', /\bgh[pous]_[A-Za-z0-9]{30,}/],
  ['facebook graph', /\bEAA[A-Za-z0-9]{40,}/],
  ['private key', /-----BEGIN (RSA |EC |OPENSSH )?PRIVATE KEY-----/],
];

/** Versioned paths containing a secret pattern (the path only, never the value). */
export function secretHits(files: { file: string; text: string }[]): string[] {
  const hits: string[] = [];
  for (const { file, text } of files) for (const [name, re] of SECRET_PATTERNS) if (re.test(text)) hits.push(`${file} (${name})`);
  return hits;
}

export function daysSince(dates: string[], today = new Date()): number | undefined {
  const last = dates.filter((d) => /^\d{4}-\d{2}-\d{2}/.test(d)).sort().at(-1);
  if (!last) return undefined;
  return Math.floor((today.getTime() - new Date(last.slice(0, 10)).getTime()) / 86_400_000);
}

export function lastAuditDays(cwd: string, today = new Date()): number | undefined {
  const dir = join(cwd, AUDITS_DIR);
  if (!existsSync(dir)) return undefined;
  return daysSince(readdirSync(dir).filter((f) => f.endsWith('.md')), today);
}

/** Reminder for `wt setup`: only when the repo already has the audits folder (it has adopted the process). */
export function auditReminder(cwd: string, today = new Date()): string | undefined {
  if (!existsSync(join(cwd, AUDITS_DIR))) return undefined;
  const days = lastAuditDays(cwd, today);
  if (days === undefined) return `no repo audit recorded in ${AUDITS_DIR}: one is due (${A.auditHint})`;
  return days > AUDIT_MAX_AGE_DAYS ? `last repo audit was ${days} days ago (> ${AUDIT_MAX_AGE_DAYS}): one is due (${A.auditHint})` : undefined;
}

function lintMetrics(cwd: string): Metrics['lint'] {
  const [cmd, ...args] = A.lintJsonCmd;
  const out = run(cwd, cmd as string, args);
  const m: Metrics['lint'] = { errors: 0, warnings: 0, infos: 0, rules: {} };
  if (!out.trim()) return m;
  const parsed = JSON.parse(out) as { diagnostics: { category?: string; severity: string }[] };
  for (const d of parsed.diagnostics) {
    if (d.severity === 'error') m.errors++;
    else if (d.severity === 'warning') m.warnings++;
    else m.infos++;
    const rule = d.category ?? 'unknown';
    m.rules[rule] = (m.rules[rule] ?? 0) + 1;
  }
  m.rules = Object.fromEntries(Object.entries(m.rules).sort((a, b) => b[1] - a[1]));
  return m;
}

function specValidate(cwd: string): { errors: number; warnings: number } {
  const out = run(cwd, 'npx', ['openspec', 'validate', '--all', '--json']);
  let errors = 0;
  let warnings = 0;
  try {
    const parsed = JSON.parse(out) as { items: { issues: { level: string }[] }[] };
    for (const it of parsed.items) for (const i of it.issues) if (i.level === 'ERROR') errors++; else warnings++;
  } catch {
    // unparseable output is reported as -1 so a broken validator is visible instead of looking like zero errors
    errors = -1;
  }
  return { errors, warnings };
}

function coverageMetrics(cwd: string): Metrics['coverage'] {
  const cfg = readFileSync(join(cwd, A.vitestConfigFile), 'utf8');
  const thresholds: Record<string, number> = {};
  for (const m of cfg.matchAll(/\b(lines|statements|functions|branches):\s*(\d+)/g)) thresholds[m[1] as string] = Number(m[2]);
  const summary = join(cwd, A.coverageSummaryFile);
  if (!existsSync(summary)) return { thresholds };
  const total = (JSON.parse(readFileSync(summary, 'utf8')) as { total: Record<string, { pct: number }> }).total;
  const measured = Object.fromEntries(Object.entries(total).map(([k, v]) => [k, v.pct]));
  return { thresholds, measured };
}

function depsAudit(cwd: string): Record<string, number> | undefined {
  const out = run(cwd, 'pnpm', ['audit', '--prod', '--json']);
  try {
    const parsed = JSON.parse(out) as { metadata?: { vulnerabilities?: Record<string, number> } };
    return parsed.metadata?.vulnerabilities;
  } catch {
    return undefined;
  }
}

/** CLAUDE.md bullets by marker: `(enforced: <path>, …)`, `(preference)` or none (the docs test rejects none). */
export function countRules(md: string): NonNullable<Metrics['rules']> {
  const bullets: string[] = [];
  let inSection = false;
  let current: number | undefined;
  for (const line of md.replace(/```[\s\S]*?```/g, '').split('\n')) {
    if (line.startsWith('## ')) {
      inSection = true;
      current = undefined;
    } else if (inSection && /^[-*] /.test(line)) current = bullets.push(line.slice(2).trim()) - 1;
    else if (current !== undefined && /^\s+\S/.test(line)) bullets[current] += ` ${line.trim()}`;
    else current = undefined;
  }
  const enforced = bullets.filter((b) => /\(enforced: [^()]+\)$/.test(b)).length;
  const preference = bullets.filter((b) => /\(preference\)$/.test(b)).length;
  return { total: bullets.length, enforced, preference, unmarked: bullets.length - enforced - preference };
}

const median = (xs: number[]): number | undefined => {
  if (!xs.length) return undefined;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : ((s[mid - 1] as number) + (s[mid] as number)) / 2;
};

/** Days from the commit that introduced each finding to the audit that detected it; median and escape rate over the new ones. */
export function detection(findings: FindingRecord[], date: string, commitDate: (sha: string) => string | undefined): Detection {
  const withLatency = findings.map((f): Detection['findings'][number] => {
    const since = f.introduced && f.introduced !== 'unknown' ? commitDate(f.introduced) : undefined;
    const latency = since ? Math.round((new Date(f.detected).getTime() - new Date(since.slice(0, 10)).getTime()) / 86_400_000) : undefined;
    return latency === undefined ? { ...f } : { ...f, latency_days: latency };
  });
  const fresh = withLatency.filter((f) => f.detected === date);
  const latencies = fresh.flatMap((f) => (f.latency_days === undefined ? [] : [f.latency_days]));
  return {
    findings: withLatency,
    new: fresh.length,
    median_latency_days: median(latencies),
    escape_rate: fresh.length ? Math.round((fresh.filter((f) => f.catchable_at_review).length / fresh.length) * 100) / 100 : undefined,
  };
}

/** Reads the skill's findings file (an array, or `{ findings: [...] }`) and adds the detection data to the metrics. */
export function withFindings(cwd: string, m: Metrics, file: string): Metrics {
  const raw = JSON.parse(readFileSync(file, 'utf8')) as FindingRecord[] | { findings: FindingRecord[] };
  const findings = (Array.isArray(raw) ? raw : raw.findings).map((f) => ({ ...f, detected: f.detected || m.date, introduced: f.introduced || 'unknown' }));
  const commitDate = (sha: string) => {
    const out = run(cwd, 'git', ['show', '-s', '--format=%cI', sha]).trim();
    return /^\d{4}-\d{2}-\d{2}/.test(out) ? out : undefined;
  };
  const eroding = [...new Set(findings.flatMap((f) => (f.rule ? [f.rule] : [])))];
  return { ...m, detection: detection(findings, m.date, commitDate), ...(m.rules ? { rules: { ...m.rules, eroding } } : {}) };
}

export function collect(cwd: string, opts: { deps?: boolean; today?: Date } = {}): Metrics {
  const today = opts.today ?? new Date();
  const sources = sourceFiles(cwd).map((file) => ({ file, text: readFileSync(join(cwd, file), 'utf8') }));
  // The product's code only: the playground and this script's own regexes are not debt
  const files = sources.filter((f) => !isMetricNoise(f.file));
  const big = files
    // Counted like the file-size ratchet, so the audit and the gate agree on what is over the limit
    .map(({ file, text }) => ({ file, lines: countLines(text) }))
    .filter((f) => f.lines > BIG_FILE_LINES)
    .sort((a, b) => b.lines - a.lines);
  const all = changesProgress(cwd);
  const validate = specValidate(cwd);
  const versioned = run(cwd, 'git', ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.mjs', '*.json', '*.yaml', '*.yml', '*.md', '*.env*', '*.toml', '*.sh'])
    .split('\n')
    .filter((f) => f && !/\.(lock|snap)$/.test(f) && !/pnpm-lock/.test(f) && existsSync(join(cwd, f)));
  const envExample = existsSync(join(cwd, A.envExampleFile)) ? readFileSync(join(cwd, A.envExampleFile), 'utf8') : '';
  const date = today.toISOString().slice(0, 10);
  const landLines = readLandLog(cwd);
  const fc = findingsConfig(cwd);
  const ledger = join(cwd, fc.file);
  return {
    date,
    commit: run(cwd, 'git', ['rev-parse', '--short', 'HEAD']).trim(),
    lint: lintMetrics(cwd),
    escapes: countEscapes(files),
    big_files: { count: big.length, top: big.slice(0, 12) },
    todos: files.reduce((n, { text }) => n + (text.match(/\b(TODO|FIXME|HACK|XXX)\b/g) ?? []).length, 0),
    specs: { active: all.length, ...classifyChanges(all), validate_errors: validate.errors, validate_warnings: validate.warnings },
    env_undocumented: undocumentedEnv(files, envExample),
    secret_hits: secretHits(versioned.map((file) => ({ file, text: readFileSync(join(cwd, file), 'utf8') }))),
    adr_drafts: existsSync(join(cwd, config.adrDir)) ? readdirSync(join(cwd, config.adrDir)).filter((f) => f.startsWith('draft-')) : [],
    coverage: coverageMetrics(cwd),
    ...(opts.deps ? { deps: depsAudit(cwd) } : {}),
    last_audit_days: lastAuditDays(cwd, today),
    ...(existsSync(ledger) ? { closure: closureMetrics(loadFindings(ledger), date) } : {}),
    hot_files: hotFiles(cwd, { ...fc.hotFiles, max: sizeLimit(cwd) }),
    ...(landLines ? { land: landActivity(landLines, previousSnapshot(cwd, date)?.date) } : {}),
    ...(existsSync(join(cwd, 'CLAUDE.md')) ? { rules: countRules(readFileSync(join(cwd, 'CLAUDE.md'), 'utf8')) } : {}),
  };
}

export function previousSnapshot(cwd: string, before: string): Metrics | undefined {
  const dir = join(cwd, AUDITS_DIR);
  if (!existsSync(dir)) return undefined;
  const f = readdirSync(dir)
    .filter((n) => n.endsWith('.metrics.json') && n.slice(0, 10) < before)
    .sort()
    .at(-1);
  return f ? (JSON.parse(readFileSync(join(dir, f), 'utf8')) as Metrics) : undefined;
}

/** Direction of travel against the previous snapshot: ↑ rose, ↓ fell, = unchanged (whether that is good depends on the metric). */
const arrow = (now: number, before?: number) => (before === undefined ? '' : now === before ? '=' : now > before ? `↑ +${Math.round((now - before) * 100) / 100}` : `↓ ${Math.round((now - before) * 100) / 100}`);

const delta = (now: number, before?: number) => (before === undefined ? '' : now === before ? '=' : now > before ? `+${now - before}` : `${now - before}`);

/** Markdown table with the difference column against the previous snapshot (ready to paste into the report). */
export function renderTable(m: Metrics, prev?: Metrics): string {
  const rows: [string, string, string][] = [];
  const num = (label: string, now: number, before?: number, note = '') => rows.push([label, `${now}${note}`, delta(now, before)]);
  // Closure first: how many findings are open and for how long matters more than how many were found
  const arrowed = (label: string, now: number, before?: number, note = '') => rows.push([label, `${now}${note}`, arrow(now, before)]);
  if (m.closure) {
    const c = m.closure;
    const pc = prev?.closure;
    arrowed('**Closure** · open findings', c.open.total, pc?.open.total, ` (${c.open.high} high · ${c.open.medium} medium · ${c.open.low} low)`);
    arrowed('Closure · overdue (past SLA)', c.overdue, pc?.overdue);
    rows.push(['Closure · median open age (days)', c.median_open_age_days === undefined ? '-' : `${c.median_open_age_days}`, c.median_open_age_days === undefined || pc?.median_open_age_days === undefined ? '' : arrow(c.median_open_age_days, pc.median_open_age_days)]);
    arrowed('Closure · opened, last 14 days', c.opened_14d, pc?.opened_14d);
    arrowed('Closure · closed, last 14 days', c.closed_14d, pc?.closed_14d);
    rows.push(['Closure · ratio (closed / opened)', c.closure_ratio === undefined ? '-' : `${c.closure_ratio}`, c.closure_ratio === undefined || pc?.closure_ratio === undefined ? '' : arrow(c.closure_ratio, pc.closure_ratio)]);
    arrowed('Closure · accepted risks', c.accepted, pc?.accepted);
  }
  if (m.hot_files) {
    arrowed('Hot files (repeated `fix` + over the size limit)', m.hot_files.length, prev?.hot_files?.length);
    for (const h of m.hot_files) rows.push([`  ${h.file}`, `${h.fixes} fixes · ${h.lines} lines`, '']);
  }
  if (m.detection) {
    const d = m.detection;
    const pd = prev?.detection;
    rows.push(['Detection · new findings', `${d.new}`, delta(d.new, pd?.new)]);
    rows.push(['Detection · median latency (days)', d.median_latency_days === undefined ? 'unknown' : `${d.median_latency_days}`, d.median_latency_days === undefined ? '' : delta(d.median_latency_days, pd?.median_latency_days)]);
    rows.push(['Detection · escape rate (catchable at review)', d.escape_rate === undefined ? '—' : `${Math.round(d.escape_rate * 100)} %`, d.escape_rate === undefined || pd?.escape_rate === undefined ? '' : delta(Math.round(d.escape_rate * 100), Math.round(pd.escape_rate * 100))]);
  }
  num('Lint · errors', m.lint.errors, prev?.lint.errors);
  num('Lint · warnings', m.lint.warnings, prev?.lint.warnings);
  for (const [rule, n] of Object.entries(m.lint.rules).slice(0, 4)) num(`  ${rule.replace(/^lint\//, '')}`, n, prev?.lint.rules[rule]);
  num('`any`', m.escapes.any, prev?.escapes.any);
  num('`as unknown as`', m.escapes.as_unknown_as, prev?.escapes.as_unknown_as);
  num('`@ts-ignore` / `@ts-expect-error`', m.escapes.ts_ignore + m.escapes.ts_expect_error, prev ? prev.escapes.ts_ignore + prev.escapes.ts_expect_error : undefined);
  num('`biome-ignore` without a reason', m.escapes.biome_ignore_without_reason, prev?.escapes.biome_ignore_without_reason, ` of ${m.escapes.biome_ignore}`);
  num(`Files > ${BIG_FILE_LINES} lines`, m.big_files.count, prev?.big_files.count, m.big_files.top[0] ? ` (largest: ${m.big_files.top[0].file} ${m.big_files.top[0].lines})` : '');
  num('TODO / FIXME / HACK', m.todos, prev?.todos);
  num('Active changes', m.specs.active, prev?.specs.active);
  num(`  nearly done (≥ ${Math.round(NEAR_DONE_RATIO * 100)} %)`, m.specs.near_done.length, prev?.specs.near_done.length, m.specs.near_done.length ? `: ${m.specs.near_done.map((c) => `${c.id} ${c.done}/${c.total}`).join(', ')}` : '');
  num('  not started (0 tasks done)', m.specs.not_started.length, prev?.specs.not_started.length, m.specs.not_started.length ? `: ${m.specs.not_started.join(', ')}` : '');
  num('Spec validation · errors', m.specs.validate_errors, prev?.specs.validate_errors);
  num('Spec validation · warnings', m.specs.validate_warnings, prev?.specs.validate_warnings);
  num('Env vars missing from the env example', m.env_undocumented.length, prev?.env_undocumented.length, m.env_undocumented.length ? `: ${m.env_undocumented.join(', ')}` : '');
  num('Secret patterns in versioned files', m.secret_hits.length, prev?.secret_hits.length, m.secret_hits.length ? `: ${m.secret_hits.join(', ')}` : '');
  num('Draft ADRs', m.adr_drafts.length, prev?.adr_drafts.length, m.adr_drafts.length ? `: ${m.adr_drafts.join(', ')}` : '');
  const th = Object.entries(m.coverage.thresholds).map(([k, v]) => `${k} ${v}`).join(', ');
  const me = m.coverage.measured ? Object.entries(m.coverage.measured).map(([k, v]) => `${k} ${v}`).join(', ') : 'not measured (pnpm test:coverage)';
  rows.push(['Coverage · floor / measured', `${th} / ${me}`, '']);
  if (m.deps) rows.push(['`pnpm audit --prod`', Object.entries(m.deps).map(([k, v]) => `${k} ${v}`).join(', ') || '0', '']);
  rows.push(['Last audit', m.last_audit_days === undefined ? 'none recorded' : `${m.last_audit_days} days ago`, '']);
  if (m.land) {
    const l = m.land;
    const pl = prev?.land;
    const since = l.since ? ` (since ${l.since})` : '';
    num(`Land log · landed${since}`, l.landed, pl?.landed);
    num('Land log · rebase conflicts', l.conflict, pl?.conflict);
    num('Land log · review bypasses (`--no-review`)', l.review_bypassed, pl?.review_bypassed);
    num('Land log · findings gates overridden (`--override-findings`)', l.findings_overridden, pl?.findings_overridden);
  }
  if (m.rules) {
    num('CLAUDE.md rules marked `preference`', m.rules.preference, prev?.rules?.preference, ` of ${m.rules.total}`);
    num('CLAUDE.md rules without a marker', m.rules.unmarked, prev?.rules?.unmarked);
    if (m.rules.eroding?.length) rows.push(['Rules found eroding', m.rules.eroding.join('; '), '']);
  }
  const header = `| Metric | ${m.date} · ${m.commit} | Δ vs ${prev ? `${prev.date} · ${prev.commit}` : '—'} |\n|---|---|---|`;
  return [header, ...rows.map((r) => `| ${r.join(' | ')} |`)].join('\n');
}

export function writeSnapshot(cwd: string, m: Metrics): string {
  const dir = join(cwd, AUDITS_DIR);
  mkdirSync(dir, { recursive: true });
  const path = join(dir, `${m.date}.metrics.json`);
  writeFileSync(path, `${JSON.stringify(m, null, 2)}\n`);
  return path;
}

async function main(argv: string[]): Promise<void> {
  const cwd = toplevel(process.cwd());
  const findingsAt = argv.indexOf('--findings');
  const findingsFile = findingsAt >= 0 ? argv[findingsAt + 1] : undefined;
  if (findingsAt >= 0 && !findingsFile) throw new Error('--findings needs a JSON file');
  const collected = collect(cwd, { deps: argv.includes('--deps') });
  const m = findingsFile ? withFindings(cwd, collected, resolve(process.cwd(), findingsFile)) : collected;
  const prev = previousSnapshot(cwd, m.date);
  if (argv.includes('--json')) console.log(JSON.stringify({ metrics: m, previous: prev?.date }, null, 2));
  else console.log(renderTable(m, prev));
  if (argv.includes('--write')) console.log(`\nSnapshot saved to ${writeSnapshot(cwd, m)}`);
}

if (import.meta.main) {
  main(process.argv.slice(2)).catch((e) => {
    console.error(e instanceof Error ? e.message : e);
    process.exit(1);
  });
}
