/**
 * Mutation smoke: a cheap check that the tests of the files a change touched can fail at all.
 *
 *   node mutation-smoke.ts [--base <ref>] [--files a.ts b.ts] [--mode warn|fail] [--max <n>] [--max-total <n>]
 *
 * THIS IS A SMOKE, NOT MUTATION TESTING. Stryker, mutmut, go-mutesting or cargo-mutants do it properly: every
 * mutant of every operator, a score, equivalent-mutant handling. This script applies at most a handful of the most
 * telling mutations, one at a time, to each source file changed against the integration branch, and runs only the
 * tests related to that file. It exists because of an incident: a capability computed `pending_review` and still
 * returned `evaluation: pass`; its test asserted `status`, not `evaluation`, so it stayed green. A sample of eight
 * tests found six that would have survived a broken implementation, and the two that would not were the dangerous
 * ones. Coverage cannot see this (the line ran); a flipped `true` can.
 *
 * Per file: (1) the related tests run once unmodified (a red baseline means no verdict); (2) up to `max` mutations
 * are applied one at a time (write the mutated file, run the tests, restore the original); a mutation SURVIVES when
 * the tests still exit 0. Operators, first occurrence of each, comments and string contents skipped:
 *   true<->false · >= to > · <= to < · === to !== (== to != outside TS/JS) · && to || · || to && · the first
 *   single-line `return <expr>` to `return undefined` (TS/JS only; other languages get the literal and operator ones).
 * A survivor is a question, not a verdict: some mutants are equivalent (a boundary the inputs never reach). All
 * mutants surviving, or no related test at all, means the change is not proven; that is what `--mode fail` rejects.
 *
 * Bounded on purpose: files over `maxLines` are skipped, `--max-total` caps mutations over the whole run, and a
 * test run is killed after `timeoutSec` (a mutant that hangs the tests counts as killed). The original file is
 * restored in a `finally`, on SIGINT/SIGTERM and on process exit; a copy also sits in the OS temp folder until
 * the file is back, so even a SIGKILL leaves something to recover from.
 *
 * Config (`mutation` block of dev-flow.config.ts, all optional, see `MutationConfig`). No dependencies beyond `node:*`.
 */
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, dirname, extname, join } from 'node:path';
import { config } from './dev-flow.config.ts';

export type MutationMode = 'warn' | 'fail';

export interface MutationConfig {
  /** Regular expression (source) of the source files to mutate. */
  include: string;
  /** Regular expression (source) that marks a test file; test files are never mutated. */
  testPattern: string;
  /** `sibling`: only `<name>.test.<ext>` next to the file; `sibling+grep` also every test file that mentions the module. */
  resolve: 'sibling' | 'sibling+grep';
  /** Test command; `{files}` is replaced by the related test files. */
  command: string;
  timeoutSec: number;
  mode: MutationMode;
  /** Mutations per file. */
  max: number;
  /** Mutations over the whole run. */
  maxTotal: number;
  /** Files longer than this are skipped. */
  maxLines: number;
}

export const DEFAULTS: MutationConfig = {
  include: '\\.(ts|tsx|js|mjs|py|go|rs)$',
  testPattern: '(\\.(test|spec)\\.[a-z]+$|_test\\.(go|py)$|(^|/)test_[^/]*\\.py$|(^|/)(tests?|__tests__)/)',
  resolve: 'sibling+grep',
  command: 'pnpm vitest run {files}',
  timeoutSec: 120,
  mode: 'warn',
  max: 4,
  maxTotal: 24,
  maxLines: 2000,
};

export interface Mutation {
  line: number;
  description: string;
  /** The whole file with the mutation applied. */
  mutated: string;
}

const isJs = (ext: string) => ['.ts', '.tsx', '.js', '.mjs'].includes(ext);

/** True when `index` of `line` is inside a string literal (an open, unescaped quote before it). */
function inString(line: string, index: number): boolean {
  let open: string | undefined;
  for (let i = 0; i < index; i++) {
    const c = line[i] as string;
    if (open) {
      if (c === '\\') i++;
      else if (c === open) open = undefined;
    } else if (c === '"' || c === "'" || c === '`') open = c;
  }
  return open !== undefined;
}

const isComment = (line: string, ext: string) => {
  const t = line.trimStart();
  return ext === '.py' ? t.startsWith('#') : t.startsWith('//') || t.startsWith('/*') || t.startsWith('*');
};

interface Operator {
  verb: string;
  re: RegExp;
  to: (match: string) => string;
}

const FLIP: Record<string, string> = { true: 'false', false: 'true', True: 'False', False: 'True' };

/** Order matters: `candidates` keeps the first `max`, so the most telling operators go first. */
function operators(ext: string): Operator[] {
  const js = isJs(ext);
  const py = ext === '.py';
  return [
    { verb: 'flipped', re: py ? /\b(True|False)\b/ : /\b(true|false)\b/, to: (m) => FLIP[m] as string },
    { verb: 'replaced', re: />=/, to: () => '>' },
    { verb: 'replaced', re: /<=/, to: () => '<' },
    js ? { verb: 'replaced', re: /(?<![!=])===(?!=)/, to: () => '!==' } : { verb: 'replaced', re: /(?<![!=<>])==(?!=)/, to: () => '!=' },
    py ? { verb: 'replaced', re: /\sand\s/, to: () => ' or ' } : { verb: 'replaced', re: /&&/, to: () => '||' },
    py ? { verb: 'replaced', re: /\sor\s/, to: () => ' and ' } : { verb: 'replaced', re: /\|\|/, to: () => '&&' },
  ];
}

/** Up to `max` mutations of `src`, one per operator (its first occurrence outside comments and strings). */
export function candidates(src: string, ext: string, max: number): Mutation[] {
  const lines = src.split('\n');
  const out: Mutation[] = [];
  const withLine = (i: number, text: string) => [...lines.slice(0, i), text, ...lines.slice(i + 1)].join('\n');
  for (const op of operators(ext)) {
    let done = false;
    for (let i = 0; i < lines.length && !done; i++) {
      const line = lines[i] as string;
      if (isComment(line, ext)) continue;
      const re = new RegExp(op.re.source, 'g');
      for (let m = re.exec(line); m; m = re.exec(line)) {
        if (inString(line, m.index)) continue;
        const to = op.to(m[0]);
        out.push({ line: i + 1, description: `${op.verb} ${m[0].trim()} → ${to.trim()}`, mutated: withLine(i, line.slice(0, m.index) + to + line.slice(m.index + m[0].length)) });
        done = true;
        break;
      }
    }
  }
  if (isJs(ext)) {
    for (let i = 0; i < lines.length; i++) {
      const line = lines[i] as string;
      const m = /^(\s*)return\s+(?!undefined\b)([^;]+?);?\s*$/.exec(line);
      // a `return` that opens a multi-line expression is not safe to cut in half
      if (!m || isComment(line, ext) || /[({[,+&|?:]$/.test(m[2] as string)) continue;
      out.push({ line: i + 1, description: 'replaced the returned value → undefined', mutated: withLine(i, `${m[1]}return undefined;`) });
      break;
    }
  }
  return out.slice(0, max);
}

const git = (cwd: string, ...args: string[]) => {
  const r = spawnSync('git', args, { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'pipe'] });
  return r.status === 0 ? r.stdout.trimEnd() : undefined;
};

/** Source files changed since the merge base with `base`, minus tests. */
export function changedSources(cwd: string, base: string, include: RegExp, testRe: RegExp): string[] {
  const mb = git(cwd, 'merge-base', base, 'HEAD') ?? base;
  const names = git(cwd, 'diff', '--name-only', '--diff-filter=AM', `${mb}..HEAD`) ?? '';
  return names.split('\n').filter((f) => f && include.test(f) && !testRe.test(f));
}

export const trackedFiles = (cwd: string) => (git(cwd, 'ls-files') ?? '').split('\n').filter(Boolean);

/** Tests related to `file`: its siblings (`x.test.ts`, `x_test.go`, `test_x.py`) and, in grep mode, tests naming the module. */
export function relatedTests(cwd: string, file: string, all: string[], testRe: RegExp, mode: MutationConfig['resolve']): string[] {
  const name = basename(file, extname(file));
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const dir = dirname(file);
  const siblingRe = new RegExp(`^(${escaped}\\.(test|spec)\\.[a-z]+|${escaped}_test\\.[a-z]+|test_${escaped}\\.py)$`);
  const tests = all.filter((t) => testRe.test(t));
  const found = new Set(tests.filter((t) => dirname(t) === dir && siblingRe.test(basename(t))));
  if (mode === 'sibling+grep') {
    const mention = new RegExp(`(^|[/'"])${escaped}(\\.[a-z]+)?['"]`, 'm');
    for (const t of tests) {
      if (found.has(t) || found.size >= 10) continue;
      try {
        if (mention.test(readFileSync(join(cwd, t), 'utf8'))) found.add(t);
      } catch {
        // deleted or unreadable: not related
      }
    }
  }
  return [...found].sort();
}

const quote = (s: string) => `'${s.replace(/'/g, `'\\''`)}'`;

export interface TestRun {
  ok: boolean;
  interrupted: boolean;
}

export function runTests(cwd: string, command: string, files: string[], timeoutSec: number): TestRun {
  // A timeout kills the run and leaves a non-zero status: a mutant that hangs the tests counts as killed.
  const r = spawnSync(command.replace('{files}', files.map(quote).join(' ')), { cwd, shell: true, stdio: 'ignore', timeout: timeoutSec * 1000, killSignal: 'SIGKILL' });
  return { ok: r.status === 0, interrupted: r.signal === 'SIGINT' || r.signal === 'SIGTERM' };
}

/** Originals not yet put back; the exit and signal handlers restore them whatever stopped the run. */
const pending = new Map<string, string>();
function restoreAll(): void {
  for (const [path, original] of pending) {
    writeFileSync(path, original);
    pending.delete(path);
  }
}
process.on('exit', restoreAll);
for (const sig of ['SIGINT', 'SIGTERM'] as const) {
  process.on(sig, () => {
    restoreAll();
    process.exit(130);
  });
}

export interface FileReport {
  file: string;
  status: 'tested' | 'untested' | 'baseline-red' | 'too-large' | 'no-mutations' | 'budget';
  tests: string[];
  total: number;
  survivors: string[];
}

/** Runs the mutations of one file. `runner` is injectable so a test can simulate a crash mid-run. */
export function smokeFile(cwd: string, file: string, tests: string[], cfg: MutationConfig, budget: number, runner = runTests): FileReport {
  const path = join(cwd, file);
  const original = readFileSync(path, 'utf8');
  const base: FileReport = { file, status: 'tested', tests, total: 0, survivors: [] };
  if (original.split('\n').length > cfg.maxLines) return { ...base, status: 'too-large' };
  if (tests.length === 0) return { ...base, status: 'untested' };
  if (budget <= 0) return { ...base, status: 'budget' };
  if (!runner(cwd, cfg.command, tests, cfg.timeoutSec).ok) return { ...base, status: 'baseline-red' };
  const mutations = candidates(original, extname(file), Math.min(cfg.max, budget));
  if (mutations.length === 0) return { ...base, status: 'no-mutations' };
  // A copy outside the tree: if even the handlers cannot run (SIGKILL), the original is recoverable from here.
  const backupDir = mkdtempSync(join(tmpdir(), 'mutation-smoke-'));
  copyFileSync(path, join(backupDir, basename(file)));
  pending.set(path, original);
  try {
    for (const m of mutations) {
      writeFileSync(path, m.mutated);
      const r = runner(cwd, cfg.command, tests, cfg.timeoutSec);
      if (r.interrupted) throw new Error('interrupted');
      base.total++;
      if (r.ok) base.survivors.push(`line ${m.line}: ${m.description} survived`);
    }
  } finally {
    writeFileSync(path, original);
    pending.delete(path);
    rmSync(backupDir, { recursive: true, force: true });
  }
  return base;
}

/** A change is "not proven" when nothing related can fail, or everything we tried survived. */
export function notProven(r: FileReport): boolean {
  return r.status === 'untested' || r.status === 'baseline-red' || (r.status === 'tested' && r.total > 0 && r.survivors.length === r.total);
}

export function render(reports: FileReport[]): string {
  const lines: string[] = [];
  for (const r of reports) {
    if (r.status === 'tested') {
      const mark = r.total > 0 && r.survivors.length === r.total ? '✗' : r.survivors.length ? '!' : '✓';
      lines.push(`${mark} ${r.file}: ${r.total} mutations, ${r.survivors.length} survived`);
      for (const s of r.survivors) lines.push(`    ${s}`);
    } else if (r.status === 'untested') lines.push(`✗ ${r.file}: untested (no related test found)`);
    else if (r.status === 'baseline-red') lines.push(`✗ ${r.file}: its related tests fail before any mutation (${r.tests.join(', ')}); no verdict`);
    else if (r.status === 'too-large') lines.push(`- ${r.file}: skipped (too large)`);
    else if (r.status === 'budget') lines.push(`- ${r.file}: skipped (mutation budget used up; raise --max-total)`);
    else lines.push(`- ${r.file}: no mutable operator found`);
  }
  return lines.join('\n');
}

function parseArgs(argv: string[], cfg: MutationConfig) {
  const opts = { base: config.integrationBranch, files: undefined as string[] | undefined, mode: cfg.mode, max: cfg.max, maxTotal: cfg.maxTotal };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--base') opts.base = argv[++i] ?? opts.base;
    else if (a === '--mode') {
      const v = argv[++i];
      if (v !== 'warn' && v !== 'fail') throw new Error('--mode takes warn or fail');
      opts.mode = v;
    } else if (a === '--max') opts.max = Number(argv[++i]);
    else if (a === '--max-total') opts.maxTotal = Number(argv[++i]);
    else if (a === '--files') {
      opts.files = [];
      while (argv[i + 1] && !argv[i + 1]?.startsWith('--')) opts.files.push(argv[++i] as string);
    } else throw new Error(`unknown argument ${a}`);
  }
  return opts;
}

if (import.meta.main) {
  const cwd = process.cwd();
  const cfg: MutationConfig = { ...DEFAULTS, ...(config.mutation ?? {}) };
  const opts = parseArgs(process.argv.slice(2), cfg);
  const testRe = new RegExp(cfg.testPattern);
  const files = (opts.files ?? changedSources(cwd, opts.base, new RegExp(cfg.include), testRe)).filter((f) => !testRe.test(f));
  const all = trackedFiles(cwd);
  let budget = opts.maxTotal;
  const reports: FileReport[] = [];
  for (const file of files) {
    const rep = smokeFile(cwd, file, relatedTests(cwd, file, all, testRe, cfg.resolve), { ...cfg, max: opts.max }, budget);
    budget -= rep.total;
    reports.push(rep);
  }
  if (reports.length === 0) console.log('mutation smoke: no changed source files');
  else console.log(`mutation smoke (${opts.mode}; a smoke, not mutation testing)\n${render(reports)}`);
  const bad = reports.filter(notProven);
  if (bad.length) console.log(`\n${bad.length} file(s) not proven by their tests: ${bad.map((r) => r.file).join(', ')}`);
  process.exit(opts.mode === 'fail' && bad.length ? 1 : 0);
}
