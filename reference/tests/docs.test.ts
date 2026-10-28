/**
 * Documentation is part of the architecture: this test fails if the docs cite things that no longer exist, or if new
 * structure (module, integration, ledger kind, command, invariant, guide, ADR) appears undocumented.
 * How to fix a failure: update the document named in the message; do not relax the test.
 *
 * The concrete folders and indexes are in the table below; the checks are generic.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, normalize, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────────── RULES (edit these) ─────────────────────────────
const ROOT = resolve(import.meta.dirname, '..');

/** Documents to check: every .md under these folders plus these files. */
const DOC_FOLDERS = ['docs'];
const DOC_FILES = ['CLAUDE.md', 'README.md'];
/** Documents whose `functionName()` mentions must exist in code. */
const FUNCTION_DOCS = (f: string) => f.startsWith('docs/') || f === 'CLAUDE.md';
/** Top-level folders whose backticked paths are checked (`src/storage/x.ts`). */
const PATH_ROOTS = ['src', 'packages', 'apps', 'registry', 'templates', 'docs'];
/** Where code lives, for the `name()` check. */
const CODE_FOLDERS = ['src', 'apps'];
/** Generic method names that are not project functions. */
const FUNCTION_STOP_LIST = ['push', 'map', 'filter', 'parse', 'safeParse', 'create', 'get', 'set', 'has', 'add', 'run', 'call', 'stringify', 'fetch', 'next', 'describe', 'random'];
/** Architecture docs: the main one plus one per product area, so branches do not collide on one file. */
const ARCH_FILES = ['docs/architecture.md'];
const ARCH_FOLDERS = ['docs/architecture'];
/** Structure that must be mentioned in the architecture docs. */
const MUST_BE_IN_ARCH = {
  /** Every folder directly under this one is a module. */
  moduleRoot: 'src',
  /** Names of registered integrations, ledger kinds, etc. — return them from the code or list them here. */
  names: [] as string[],
};
/** Every command found by this regex in these files must appear in the README. */
const COMMANDS = { files: ['apps/cli/src/commands'], regex: /\.command\('([a-z:-]+)/g, mustAppearIn: 'README.md' };
/** Invariant table: rows look like `| INV-01 |`; every INV id cited in the architecture test must have a row. */
const INVARIANTS = { testFile: 'test/architecture.test.ts', minDocumented: 1 };
/** Index files that must link every file of a folder. */
const INDEXES = [
  { index: 'docs/README.md', folder: 'docs/extending', pattern: /\.md$/, linkPrefix: 'extending/' },
  { index: 'docs/adr/README.md', folder: 'docs/adr', pattern: /^\d{4}-.*\.md$/, linkPrefix: '' },
];

// ───────────────────────────── MECHANISMS ─────────────────────────────
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const mdFiles = (dir: string): string[] =>
  !existsSync(join(ROOT, dir))
    ? []
    : readdirSync(join(ROOT, dir)).flatMap((f) => {
        const rel = `${dir}/${f}`;
        return statSync(join(ROOT, rel)).isDirectory() ? mdFiles(rel) : f.endsWith('.md') ? [rel] : [];
      });
const DOCS = [...DOC_FOLDERS.flatMap(mdFiles), ...DOC_FILES.filter((f) => existsSync(join(ROOT, f)))];
/** Text without fenced code blocks (examples are not real links). */
const prose = (md: string) => md.replace(/```[\s\S]*?```/g, '');
const ARCH = [...ARCH_FILES.map(read), ...ARCH_FOLDERS.flatMap(mdFiles).map(read)].join('\n');

describe('docs: valid references', () => {
  it('relative links point to existing files', () => {
    const broken: string[] = [];
    for (const f of DOCS) {
      for (const m of prose(read(f)).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
        const target = m[1] ?? '';
        if (/^(https?:|mailto:|\/)/.test(target)) continue;
        if (!existsSync(normalize(join(ROOT, dirname(f), target)))) broken.push(`${f} → ${target}`);
      }
    }
    expect(broken).toEqual([]);
  });

  it('repo paths cited in backticks exist', () => {
    const missing: string[] = [];
    const re = new RegExp(`\`((?:${PATH_ROOTS.join('|')})/[A-Za-z0-9_./\\-[\\]]+)\``, 'g');
    for (const f of DOCS) {
      for (const m of prose(read(f)).matchAll(re)) {
        const p = (m[1] ?? '').replace(/\/$/, '');
        // Patterns with wildcards or placeholders (<tenant>, *, …) are not concrete paths
        if (/[<>*…]/.test(p) || p.includes('...')) continue;
        if (!existsSync(join(ROOT, p))) missing.push(`${f} → ${p}`);
      }
    }
    expect(missing).toEqual([]);
  });

  it('functions cited as `name()` exist in the code', () => {
    const walk = (dir: string): string[] =>
      !existsSync(join(ROOT, dir))
        ? []
        : readdirSync(join(ROOT, dir)).flatMap((f) => {
            if (['node_modules', '.next'].includes(f)) return [];
            const rel = `${dir}/${f}`;
            return statSync(join(ROOT, rel)).isDirectory() ? walk(rel) : /\.(ts|tsx)$/.test(f) ? [read(rel)] : [];
          });
    const code = CODE_FOLDERS.flatMap(walk).join('\n');
    const missing = new Set<string>();
    for (const f of DOCS.filter(FUNCTION_DOCS)) {
      for (const m of prose(read(f)).matchAll(/`(?:[A-Za-z_$][\w$]*\.)*([a-z_$][\w$]*)\([^`]*\)`/g)) {
        const name = m[1] ?? '';
        if (FUNCTION_STOP_LIST.includes(name)) continue;
        if (!new RegExp(`\\b${name}\\b`).test(code)) missing.add(`${f} → ${name}()`);
      }
    }
    expect([...missing]).toEqual([]);
  });
});

describe('docs: cover the real structure', () => {
  it('every module folder appears in the architecture docs', () => {
    const root = MUST_BE_IN_ARCH.moduleRoot;
    const modules = readdirSync(join(ROOT, root)).filter((f) => statSync(join(ROOT, root, f)).isDirectory());
    expect(modules.filter((m) => !ARCH.includes(`${m}/`))).toEqual([]);
  });

  it('every registered integration, ledger kind or other named structure is documented', () => {
    expect(MUST_BE_IN_ARCH.names.filter((n) => !ARCH.includes(n))).toEqual([]);
  });

  it('every CLI command appears in the README', () => {
    const readme = read(COMMANDS.mustAppearIn);
    const commands = COMMANDS.files.flatMap((dir) => readdirSync(join(ROOT, dir)).flatMap((f) => [...read(`${dir}/${f}`).matchAll(COMMANDS.regex)].map((m) => m[1] ?? '')));
    expect(commands.filter((c) => !readme.includes(c))).toEqual([]);
  });

  it('every INV-xx tested has a row in the invariant table', () => {
    const documented = new Set([...ARCH.matchAll(/\| (INV-\d{2}) \|/g)].map((m) => m[1]));
    const tested = new Set([...read(INVARIANTS.testFile).matchAll(/INV-(\d{2})(?:\/(\d{2}))?/g)].flatMap((m) => [`INV-${m[1]}`, ...(m[2] ? [`INV-${m[2]}`] : [])]));
    expect([...tested].filter((i) => !documented.has(i))).toEqual([]);
    expect(documented.size).toBeGreaterThanOrEqual(INVARIANTS.minDocumented);
  });

  it.each(INDEXES)('$index links every file of $folder', ({ index, folder, pattern, linkPrefix }) => {
    const text = read(index);
    const files = readdirSync(join(ROOT, folder)).filter((f) => pattern.test(f));
    expect(files.filter((f) => !text.includes(`${linkPrefix}${f}`))).toEqual([]);
  });
});
