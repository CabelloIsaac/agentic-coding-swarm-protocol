/**
 * Quality ratchets: debt metrics that may only improve. A rule written in CLAUDE.md ("files over 500 lines are split",
 * "the coverage floor only goes up") erodes unless a mechanism enforces it; in the reference project, between two
 * audits, lint warnings rose by 90, files over 500 lines went from 9 to 15 and the coverage floor sat 2.7 points below
 * what was measured for 19 days, with every gate green. This script turns those rules into checks.
 *
 *   node ratchets.ts                        check everything (the full verify tier runs it after the tests)
 *   node ratchets.ts --size-only [files…]   only the file-size ratchet, on the given files (the quick tier)
 *   node ratchets.ts --tighten              rewrite the file to the current values, only ever tightening (land runs it)
 *   node ratchets.ts --init [template]      record the current state in the file (shape: the template, the uncommitted
 *                                           file itself, or a built-in default); refused once the file is committed
 *   --file <path>                           another ratchets file (default: config.ratchets.file)
 *
 * The file (`quality-ratchets.json`, template in templates/) has three optional sections:
 *   fileSize      { max, include, exclude?, exceptions: { "<path>": <lines> } }   new files over max fail; an exception
 *                 that grew past its recorded size fails; recorded sizes only go down.
 *   coverage      { summary, floor | floorFrom, maxGap }   measured below the floor fails; measured more than maxGap
 *                 above it fails too ("raise the floor to X"). `floorFrom` reads the thresholds from the test runner
 *                 config instead, which then stays the single source (tighten does not touch it).
 *   lintWarnings  { command, budget, perRule? }   warnings counted from the linter's JSON output (Biome or ESLint).
 *
 * No dependencies beyond `node:*`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';

export const COVERAGE_KEYS = ['lines', 'statements', 'functions', 'branches'] as const;
export type CoverageKey = (typeof COVERAGE_KEYS)[number];
export type CoverageNumbers = Partial<Record<CoverageKey, number>>;

export interface FileSizeRatchet {
  max: number;
  include: string[];
  exclude?: string[];
  exceptions: Record<string, number>;
}

export interface CoverageRatchet {
  /** Path of the `json-summary` coverage report (Istanbul shape: `{ total: { lines: { pct } } }`). */
  summary: string;
  /** The floor kept in this file (tightened by `--tighten`). */
  floor?: CoverageNumbers;
  /** Or: the test runner config that holds `thresholds` (`lines: 86`); the ratchet reads it and never rewrites it. */
  floorFrom?: string;
  /** Measured may sit at most this many points above the floor. */
  maxGap: number;
}

export interface LintRatchet {
  /** Prints the lint report as JSON (Biome `--reporter=json`, ESLint `--format json`); its exit code is ignored. */
  command: string;
  budget: number;
  perRule?: Record<string, number>;
}

export interface Ratchets {
  fileSize?: FileSizeRatchet;
  coverage?: CoverageRatchet;
  lintWarnings?: LintRatchet;
  [other: string]: unknown;
}

/** What was measured now. A missing part (no coverage summary, no lint section) is `undefined` and is not judged. */
export interface Measured {
  files?: { path: string; lines: number }[];
  coverage?: CoverageNumbers;
  /** The floor read from `floorFrom`, when the file does not hold it. */
  externalFloor?: CoverageNumbers;
  lint?: { warnings: number; rules: Record<string, number> };
}

export interface Problem {
  ratchet: 'fileSize' | 'coverage' | 'lintWarnings';
  message: string;
}

// ───────────────────────────── pure parts (tested) ─────────────────────────────

/** Lines as `wc -l` counts them, plus a last line without a trailing newline. */
export function countLines(text: string): number {
  if (!text) return 0;
  const newlines = text.split('\n').length - 1;
  return text.endsWith('\n') ? newlines : newlines + 1;
}

/** Minimal glob: `**` (any depth, including none), `*` and `?` (within one segment) and `{a,b}`. */
export function globToRegExp(glob: string): RegExp {
  let re = '';
  let depth = 0;
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i] as string;
    if (c === '*') {
      if (glob[i + 1] === '*') {
        if (glob[i + 2] === '/') {
          re += '(?:.*/)?';
          i += 2;
        } else {
          re += '.*';
          i += 1;
        }
      } else re += '[^/]*';
    } else if (c === '?') re += '[^/]';
    else if (c === '{') {
      depth++;
      re += '(?:';
    } else if (c === '}' && depth > 0) {
      depth--;
      re += ')';
    } else if (c === ',' && depth > 0) re += '|';
    else re += c.replace(/[.+^$()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

export function matchesAny(path: string, globs: string[] = []): boolean {
  return globs.some((g) => globToRegExp(g).test(path));
}

/** Is the file under the file-size ratchet? */
export function inScope(r: FileSizeRatchet, path: string): boolean {
  return matchesAny(path, r.include) && !matchesAny(path, r.exclude);
}

export function checkFileSize(r: FileSizeRatchet, files: { path: string; lines: number }[]): Problem[] {
  const problems: Problem[] = [];
  for (const f of files) {
    if (!inScope(r, f.path) || f.lines <= r.max) continue;
    const recorded = r.exceptions[f.path];
    if (recorded === undefined)
      problems.push({ ratchet: 'fileSize', message: `${f.path} has ${f.lines} lines (max ${r.max}): split it by responsibility; a file never starts or grows above the max` });
    else if (f.lines > recorded)
      problems.push({ ratchet: 'fileSize', message: `${f.path} grew to ${f.lines} lines (recorded exception: ${recorded}): an exception may only shrink; move code out instead` });
  }
  return problems;
}

/** The floor tighten writes: half the allowed gap below what was measured, rounded down to one decimal. */
export function targetFloor(measured: number, maxGap: number): number {
  return Math.floor((measured - maxGap / 2) * 10 + 1e-9) / 10;
}

export function checkCoverage(r: CoverageRatchet, measured: CoverageNumbers, floor: CoverageNumbers): Problem[] {
  const problems: Problem[] = [];
  const where = r.floorFrom ? `in ${r.floorFrom}` : 'in the ratchets file (`--tighten` does it)';
  for (const k of COVERAGE_KEYS) {
    const m = measured[k];
    const f = floor[k];
    if (m === undefined || f === undefined) continue;
    if (m < f) problems.push({ ratchet: 'coverage', message: `coverage ${k} ${m} is below the floor ${f}: add tests (the floor never goes down)` });
    else if (m - f > r.maxGap + 1e-9)
      problems.push({ ratchet: 'coverage', message: `coverage ${k} ${m} is ${(m - f).toFixed(1)} points above the floor ${f} (max gap ${r.maxGap}): raise the floor to ${targetFloor(m, r.maxGap)} ${where}` });
  }
  return problems;
}

/** Biome (`{ diagnostics: [{ category, severity }] }`) or ESLint (`[{ messages: [{ ruleId, severity: 1|2 }] }]`). */
export function countLintWarnings(output: string): { warnings: number; rules: Record<string, number> } {
  const parsed = parseJsonLoose(output);
  const rules: Record<string, number> = {};
  const add = (rule: string) => (rules[rule] = (rules[rule] ?? 0) + 1);
  if (Array.isArray(parsed)) {
    for (const file of parsed as { messages?: { ruleId?: string | null; severity?: number }[] }[])
      for (const m of file.messages ?? []) if (m.severity === 1) add(m.ruleId ?? 'unknown');
  } else if (parsed && typeof parsed === 'object' && Array.isArray((parsed as { diagnostics?: unknown }).diagnostics)) {
    for (const d of (parsed as { diagnostics: { category?: string; severity?: string }[] }).diagnostics) if (d.severity === 'warning') add(d.category ?? 'unknown');
  } else {
    throw new Error('unrecognized lint report: expected Biome JSON ({ diagnostics }) or ESLint JSON ([{ messages }])');
  }
  const sorted = Object.fromEntries(Object.entries(rules).sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])));
  return { warnings: Object.values(rules).reduce((n, v) => n + v, 0), rules: sorted };
}

/** Linters may print a line before the JSON: parse from the first `{` or `[`. */
function parseJsonLoose(output: string): unknown {
  const text = output.trim();
  try {
    return JSON.parse(text);
  } catch {
    const starts = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
    if (!starts.length) throw new Error('the lint command printed no JSON');
    return JSON.parse(text.slice(Math.min(...starts)));
  }
}

export function checkLint(r: LintRatchet, lint: { warnings: number; rules: Record<string, number> }): Problem[] {
  const problems: Problem[] = [];
  if (lint.warnings > r.budget) problems.push({ ratchet: 'lintWarnings', message: `${lint.warnings} lint warnings, budget ${r.budget}: fix ${lint.warnings - r.budget} before integrating` });
  for (const [rule, budget] of Object.entries(r.perRule ?? {})) {
    const n = lint.rules[rule] ?? 0;
    if (n > budget) problems.push({ ratchet: 'lintWarnings', message: `${rule}: ${n} warnings, budget ${budget}` });
  }
  return problems;
}

export function check(r: Ratchets, m: Measured): Problem[] {
  return [
    ...(r.fileSize && m.files ? checkFileSize(r.fileSize, m.files) : []),
    ...(r.coverage && m.coverage ? checkCoverage(r.coverage, m.coverage, r.coverage.floor ?? m.externalFloor ?? {}) : []),
    ...(r.lintWarnings && m.lint ? checkLint(r.lintWarnings, m.lint) : []),
  ];
}

/**
 * The same file with every value moved to what was measured, only in the tightening direction: exceptions shrink or
 * disappear, the floor rises, budgets fall. Nothing is ever added or loosened, so a red check stays red. Sections
 * without a measurement are left as they are. Unknown keys are kept.
 */
export function tighten(r: Ratchets, m: Measured): { next: Ratchets; changes: string[] } {
  const changes: string[] = [];
  const next: Ratchets = { ...r };
  if (r.fileSize && m.files) {
    const lines = new Map(m.files.map((f) => [f.path, f.lines]));
    const exceptions: Record<string, number> = {};
    for (const [path, recorded] of Object.entries(r.fileSize.exceptions).sort((a, b) => a[0].localeCompare(b[0]))) {
      const now = lines.get(path);
      if (now === undefined || now <= r.fileSize.max) changes.push(`fileSize: ${path} no longer an exception (${now === undefined ? 'gone' : `${now} lines`})`);
      else if (now < recorded) {
        exceptions[path] = now;
        changes.push(`fileSize: ${path} ${recorded} → ${now}`);
      } else exceptions[path] = recorded;
    }
    next.fileSize = { ...r.fileSize, exceptions };
  }
  if (r.coverage?.floor && m.coverage) {
    const floor: CoverageNumbers = { ...r.coverage.floor };
    for (const k of COVERAGE_KEYS) {
      const measured = m.coverage[k];
      const old = floor[k];
      if (measured === undefined || old === undefined) continue;
      const target = targetFloor(measured, r.coverage.maxGap);
      if (target > old) {
        floor[k] = target;
        changes.push(`coverage ${k}: floor ${old} → ${target}`);
      }
    }
    next.coverage = { ...r.coverage, floor };
  }
  if (r.lintWarnings && m.lint) {
    const lint: LintRatchet = { ...r.lintWarnings };
    if (m.lint.warnings < lint.budget) {
      changes.push(`lintWarnings: budget ${lint.budget} → ${m.lint.warnings}`);
      lint.budget = m.lint.warnings;
    }
    if (lint.perRule) {
      const perRule: Record<string, number> = {};
      for (const [rule, budget] of Object.entries(lint.perRule)) {
        const now = m.lint.rules[rule] ?? 0;
        perRule[rule] = Math.min(budget, now);
        if (now < budget) changes.push(`lintWarnings: ${rule} ${budget} → ${now}`);
      }
      lint.perRule = perRule;
    }
    next.lintWarnings = lint;
  }
  return { next, changes };
}

/** First version of the file: today's state recorded as the starting point (the one time values are not tightened). */
export function initial(template: Ratchets, m: Measured): Ratchets {
  const next: Ratchets = { ...template };
  if (template.fileSize && m.files) {
    const fs = template.fileSize;
    const over = m.files.filter((f) => inScope(fs, f.path) && f.lines > fs.max).sort((a, b) => a.path.localeCompare(b.path));
    next.fileSize = { ...fs, exceptions: Object.fromEntries(over.map((f) => [f.path, f.lines])) };
  }
  if (template.coverage && m.coverage && !template.coverage.floorFrom) {
    const c = template.coverage;
    const floor: CoverageNumbers = {};
    for (const k of COVERAGE_KEYS) if (m.coverage[k] !== undefined) floor[k] = targetFloor(m.coverage[k] as number, c.maxGap);
    next.coverage = { ...c, floor };
  }
  if (template.lintWarnings && m.lint) next.lintWarnings = { ...template.lintWarnings, budget: m.lint.warnings, perRule: { ...m.lint.rules } };
  return next;
}

export function serialize(r: Ratchets): string {
  return `${JSON.stringify(r, null, 2)}\n`;
}

// ───────────────────────────── measurement (I/O) ─────────────────────────────

/** Versioned and untracked-but-not-ignored files: a new file counts before its first commit. */
export function repoFiles(root: string): string[] {
  const out = execFileSync('git', ['ls-files', '--cached', '--others', '--exclude-standard'], { cwd: root, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 });
  return [...new Set(out.split('\n').filter(Boolean))];
}

export function measureFiles(root: string, r: FileSizeRatchet, only?: string[]): { path: string; lines: number }[] {
  return (only ?? repoFiles(root))
    .filter((p) => inScope(r, p) && existsSync(join(root, p)))
    .map((path) => ({ path, lines: countLines(readFileSync(join(root, path), 'utf8')) }));
}

export function readCoverageSummary(file: string): CoverageNumbers | undefined {
  if (!existsSync(file)) return undefined;
  const total = (JSON.parse(readFileSync(file, 'utf8')) as { total?: Record<string, { pct?: number }> }).total ?? {};
  const out: CoverageNumbers = {};
  for (const k of COVERAGE_KEYS) {
    const pct = total[k]?.pct;
    if (typeof pct === 'number') out[k] = pct;
  }
  return out;
}

/** `thresholds: { lines: 86, … }` in a vitest (or similar) config, read as text: importing it would load the runner. */
export function readFloorFrom(file: string): CoverageNumbers {
  const text = readFileSync(file, 'utf8');
  const out: CoverageNumbers = {};
  for (const m of text.matchAll(/\b(lines|statements|functions|branches):\s*(\d+(?:\.\d+)?)/g)) out[m[1] as CoverageKey] = Number(m[2]);
  return out;
}

export function runLint(root: string, command: string): { warnings: number; rules: Record<string, number> } {
  // The exit code is ignored: linters exit non-zero on errors, and errors are the lint step's business, not this one
  const r = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  return countLintWarnings(r.stdout ?? '');
}

export interface MeasureOptions {
  /** Only these sections. */
  sections?: ('fileSize' | 'coverage' | 'lintWarnings')[];
  /** Restrict the file-size ratchet to these paths (quick tier). */
  files?: string[];
}

export function measure(root: string, r: Ratchets, opts: MeasureOptions = {}): Measured {
  const want = (s: 'fileSize' | 'coverage' | 'lintWarnings') => !opts.sections || opts.sections.includes(s);
  const m: Measured = {};
  if (r.fileSize && want('fileSize')) m.files = measureFiles(root, r.fileSize, opts.files);
  if (r.coverage && want('coverage')) {
    m.coverage = readCoverageSummary(join(root, r.coverage.summary));
    if (r.coverage.floorFrom) m.externalFloor = readFloorFrom(join(root, r.coverage.floorFrom));
  }
  if (r.lintWarnings && want('lintWarnings')) m.lint = runLint(root, r.lintWarnings.command);
  return m;
}

export function loadRatchets(file: string): Ratchets {
  return JSON.parse(readFileSync(file, 'utf8')) as Ratchets;
}

/** Tighten the file in place; returns what changed (empty: the file was not rewritten). Used by `land`. */
export function tightenFile(root: string, file = config.ratchets.file): string[] {
  const path = join(root, file);
  if (!existsSync(path)) return [];
  const r = loadRatchets(path);
  const { next, changes } = tighten(r, measure(root, r));
  if (changes.length) writeFileSync(path, serialize(next));
  return changes;
}

// ───────────────────────────── CLI ─────────────────────────────

function gitRoot(cwd: string): string {
  return execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8' }).trim();
}

function isTracked(root: string, file: string): boolean {
  return spawnSync('git', ['ls-files', '--error-unmatch', '--', file], { cwd: root, stdio: 'ignore' }).status === 0;
}

export function main(argv: string[], cwd = process.cwd(), log: (line: string) => void = console.log): number {
  const root = gitRoot(cwd);
  const fileAt = argv.indexOf('--file');
  const file = fileAt >= 0 ? (argv[fileAt + 1] ?? config.ratchets.file) : config.ratchets.file;
  const path = join(root, file);
  const positional = argv.filter((a, i) => !a.startsWith('--') && argv[i - 1] !== '--file');

  if (argv.includes('--init')) {
    // Recording today's state loosens by definition (every oversized file becomes an exception), so it is allowed
    // only while the file is not committed yet; afterwards the only way is --tighten
    if (isTracked(root, file)) {
      log(`✗ ratchets: ${file} is already committed; --tighten updates it, and it is never loosened`);
      return 1;
    }
    const template = positional[0] ? loadRatchets(join(root, positional[0])) : existsSync(path) ? loadRatchets(path) : DEFAULT_TEMPLATE;
    const next = initial(template, measure(root, template));
    writeFileSync(path, serialize(next));
    log(`✓ ratchets: ${file} written from the current state; commit it`);
    return 0;
  }
  if (!existsSync(path)) {
    log(`ratchets: no ${file} (node ratchets.ts --init creates it); nothing checked`);
    return 0;
  }
  const r = loadRatchets(path);

  if (argv.includes('--tighten')) {
    const changes = tightenFile(root, file);
    log(changes.length ? `✓ ratchets tightened:\n  ${changes.join('\n  ')}` : '✓ ratchets: nothing to tighten');
    return 0;
  }

  const sizeOnly = argv.includes('--size-only');
  const m = measure(root, r, sizeOnly ? { sections: ['fileSize'], files: positional.length ? positional : undefined } : {});
  const problems = check(r, m);
  if (!sizeOnly && r.coverage && !m.coverage) problems.push({ ratchet: 'coverage', message: `no coverage summary at ${r.coverage.summary}: run the tests with coverage (json-summary reporter) first` });
  for (const p of problems) log(`✗ ${p.ratchet}: ${p.message}`);
  const checked = sizeOnly ? 'fileSize' : (['fileSize', 'coverage', 'lintWarnings'] as const).filter((s) => r[s]).join(', ');
  log(problems.length ? `✗ ratchets: ${problems.length} problem(s)` : `✓ ratchets: ${checked} within bounds`);
  return problems.length ? 1 : 0;
}

/** Used by `--init` when no template path is given. */
const DEFAULT_TEMPLATE: Ratchets = {
  fileSize: { max: 500, include: ['**/*.{ts,tsx}'], exclude: ['**/*.test.{ts,tsx}', '**/*.d.ts', `${config.playgroundDir}/**`], exceptions: {} },
  coverage: { summary: config.audit.coverageSummaryFile, floor: {}, maxGap: 1 },
  lintWarnings: { command: config.audit.lintJsonCmd.join(' '), budget: 0 },
};

if (import.meta.main) process.exit(main(process.argv.slice(2)));
