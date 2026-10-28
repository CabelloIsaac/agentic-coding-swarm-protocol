/**
 * Deterministic metrics for the periodic repo audit (the audit skill reads the code; this is the repeatable part).
 *
 *   pnpm audit:repo                 print the metrics table and the difference from the last snapshot
 *   pnpm audit:repo --write         also save <audit dir>/<date>.metrics.json (the next run compares against it)
 *   pnpm audit:repo --deps          include `pnpm audit --prod` (network); everything else is local and takes seconds
 *   pnpm audit:repo --json          JSON output instead of the table
 *
 * It measures what the `verify` gates let through without failing: lint warnings and their trend, type escapes, big
 * files, TODOs, nearly-done or stalled spec changes, spec validation errors, undocumented environment variables,
 * secret patterns in versioned files and the age of the last audit. It runs no tests and spends no money.
 */
import { execFileSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';
import { toplevel } from './git.ts';

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

export function collect(cwd: string, opts: { deps?: boolean; today?: Date } = {}): Metrics {
  const today = opts.today ?? new Date();
  const files = sourceFiles(cwd).map((file) => ({ file, text: readFileSync(join(cwd, file), 'utf8') }));
  const big = files
    .map(({ file, text }) => ({ file, lines: text.split('\n').length }))
    .filter((f) => f.lines > BIG_FILE_LINES)
    .sort((a, b) => b.lines - a.lines);
  const all = changesProgress(cwd);
  const validate = specValidate(cwd);
  const versioned = run(cwd, 'git', ['ls-files', '--', '*.ts', '*.tsx', '*.js', '*.mjs', '*.json', '*.yaml', '*.yml', '*.md', '*.env*', '*.toml', '*.sh'])
    .split('\n')
    .filter((f) => f && !/\.(lock|snap)$/.test(f) && !/pnpm-lock/.test(f) && existsSync(join(cwd, f)));
  const envExample = existsSync(join(cwd, A.envExampleFile)) ? readFileSync(join(cwd, A.envExampleFile), 'utf8') : '';
  return {
    date: today.toISOString().slice(0, 10),
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

const delta = (now: number, before?: number) => (before === undefined ? '' : now === before ? '=' : now > before ? `+${now - before}` : `${now - before}`);

/** Markdown table with the difference column against the previous snapshot (ready to paste into the report). */
export function renderTable(m: Metrics, prev?: Metrics): string {
  const rows: [string, string, string][] = [];
  const num = (label: string, now: number, before?: number, note = '') => rows.push([label, `${now}${note}`, delta(now, before)]);
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
  const m = collect(cwd, { deps: argv.includes('--deps') });
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
