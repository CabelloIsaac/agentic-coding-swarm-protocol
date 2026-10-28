/**
 * Documentation is part of the architecture: this test fails if the docs cite things that no longer exist, or if new
 * structure (module, package, integration, ledger kind, command, invariant, guide, ADR) appears undocumented. Checks run
 * in both directions where it matters: the invariant table and the tests must name the same ids.
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
/** Every command found by this regex in these folders must appear in the README. */
const COMMANDS = { files: ['apps/cli/src/commands'], regex: /\.command\('([a-z:-]+)/g, mustAppearIn: 'README.md' };
/** Folders whose sub-folders with a `package.json` are packages or apps: each must be named in the architecture docs. */
const PACKAGE_ROOTS = ['packages', 'apps'];
/**
 * Invariants, checked in both directions: every id in the table (rows like `| INV-01 |`) has a test, and every id a
 * test cites has a row. `testFiles` are the suites searched for ids (the architecture test first); `notTested` lists
 * ids enforced some other way (review, a hook, the type system), each with its reason. `digits` is the canonical
 * zero padding: prose that cites `INV-1` or `INV-001` is a different numbering and fails.
 */
const INVARIANTS = {
  prefix: 'INV',
  digits: 2,
  architectureTest: 'test/architecture.test.ts',
  testFiles: ['test/architecture.test.ts'],
  notTested: {} as Record<string, string>,
  minDocumented: 1,
};
/**
 * Rules name their mechanism: in `file`, every bullet under a `## ` heading (continuation lines included) ends with
 * `(enforced: <path>, …)` or `(preference)`, and every enforced path exists (`path#fragment` checks the path). A rule
 * no mechanism enforces erodes silently; marking it a preference at least makes that visible (the audit counts them).
 * `exemptSections` are headings whose bullets are not rules (an index of links, say).
 */
const RULE_MARKERS = { file: 'CLAUDE.md', exemptSections: [] as string[] };
/** Index files that must link every file of a folder. */
const INDEXES = [
  { index: 'docs/README.md', folder: 'docs/extending', pattern: /\.md$/, linkPrefix: 'extending/' },
  { index: 'docs/adr/README.md', folder: 'docs/adr', pattern: /^\d{4}-.*\.md$/, linkPrefix: '' },
];

// ───────────────────────────── MECHANISMS ─────────────────────────────
const read = (rel: string) => readFileSync(join(ROOT, rel), 'utf8');
const dirs = (rel: string) => (existsSync(join(ROOT, rel)) ? readdirSync(join(ROOT, rel)).filter((f) => statSync(join(ROOT, rel, f)).isDirectory()) : []);
const INV_ID = new RegExp(`\\| (${INVARIANTS.prefix}-\\d{${INVARIANTS.digits}}) \\|`, 'g');
/** Ids a suite cites, including the `INV-06/07` shorthand for one test covering two invariants. */
const citedIds = (text: string) =>
  [...text.matchAll(new RegExp(`${INVARIANTS.prefix}-(\\d{${INVARIANTS.digits}})(?:/(\\d{${INVARIANTS.digits}}))?(?!\\d)`, 'g'))].flatMap((m) => [
    `${INVARIANTS.prefix}-${m[1]}`,
    ...(m[2] ? [`${INVARIANTS.prefix}-${m[2]}`] : []),
  ]);
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

/** Bullets of a rules file with their section; indented continuation lines are joined to their bullet. */
const ruleBullets = (text: string) => {
  const bullets: { section: string; text: string }[] = [];
  let section = '';
  let current: { section: string; text: string } | undefined;
  for (const line of prose(text).split('\n')) {
    if (line.startsWith('## ')) {
      section = line.slice(3).trim();
      current = undefined;
    } else if (/^[-*] /.test(line)) {
      current = { section, text: line.slice(2).trim() };
      bullets.push(current);
    } else if (current && /^\s+\S/.test(line)) current.text += ` ${line.trim()}`;
    else current = undefined;
  }
  return bullets.filter((b) => b.section && !RULE_MARKERS.exemptSections.includes(b.section));
};
const RULE_MARKER = /\((?:enforced: ([^()]+)|preference)\)$/;

describe('docs: rules name their mechanism', () => {
  const rules = existsSync(join(ROOT, RULE_MARKERS.file)) ? ruleBullets(read(RULE_MARKERS.file)) : [];

  it(`every rule in ${RULE_MARKERS.file} ends with (enforced: <path>) or (preference)`, () => {
    expect(rules.filter((r) => !RULE_MARKER.test(r.text)).map((r) => `${r.section} → ${r.text.slice(0, 80)}`)).toEqual([]);
  });

  it('every enforced: target exists', () => {
    const targets = rules.flatMap((r) => (RULE_MARKER.exec(r.text)?.[1] ?? '').split(',').map((t) => t.trim().replace(/`/g, '').split('#')[0] ?? '').filter(Boolean));
    expect(targets.filter((t) => !existsSync(join(ROOT, t)))).toEqual([]);
  });
});

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
    const commands = COMMANDS.files
      .filter((dir) => existsSync(join(ROOT, dir)))
      .flatMap((dir) => readdirSync(join(ROOT, dir)).flatMap((f) => [...read(`${dir}/${f}`).matchAll(COMMANDS.regex)].map((m) => m[1] ?? '')));
    expect(commands.filter((c) => !readme.includes(c))).toEqual([]);
  });

  it('every package or app is named in the architecture docs', () => {
    const pkgs = PACKAGE_ROOTS.flatMap((root) =>
      dirs(root)
        .filter((d) => existsSync(join(ROOT, root, d, 'package.json')))
        .map((d) => ({ path: `${root}/${d}`, name: (JSON.parse(read(`${root}/${d}/package.json`)) as { name?: string }).name ?? '' })),
    );
    expect(pkgs.filter((p) => !ARCH.includes(p.path) && !(p.name && ARCH.includes(p.name))).map((p) => p.path)).toEqual([]);
  });

  it('invariants: every tested id has a row in the table', () => {
    const documented = new Set([...ARCH.matchAll(INV_ID)].map((m) => m[1]));
    const tested = new Set(citedIds(read(INVARIANTS.architectureTest)));
    expect([...tested].filter((i) => !documented.has(i))).toEqual([]);
    expect(documented.size).toBeGreaterThanOrEqual(INVARIANTS.minDocumented);
  });

  it('invariants: every id in the table has a test (or a stated reason it has none)', () => {
    const documented = [...new Set([...ARCH.matchAll(INV_ID)].map((m) => m[1] ?? ''))];
    const tested = new Set(INVARIANTS.testFiles.flatMap((f) => citedIds(read(f))));
    expect(documented.filter((i) => !tested.has(i) && !INVARIANTS.notTested[i])).toEqual([]);
    // A reason for an id that is tested, or that left the table, is stale: the exception list only shrinks
    expect(Object.keys(INVARIANTS.notTested).filter((i) => tested.has(i) || !documented.includes(i))).toEqual([]);
  });

  it('invariant ids use one numbering everywhere (no unpadded or re-padded ids)', () => {
    const canonical = new RegExp(`^${INVARIANTS.prefix}-\\d{${INVARIANTS.digits}}$`);
    const cited = new RegExp(`\\b${INVARIANTS.prefix}-(\\d+)\\b`, 'g');
    const wrong = [...DOCS, ...INVARIANTS.testFiles].flatMap((f) =>
      [...prose(read(f)).matchAll(cited)].map((m) => m[0]).filter((id) => !canonical.test(id)).map((id) => `${f} → ${id}`),
    );
    expect(wrong).toEqual([]);
  });

  // Covers the ADR index (every ADR file listed) and the docs index (every extension guide linked)
  it.each(INDEXES)('$index links every file of $folder', ({ index, folder, pattern, linkPrefix }) => {
    const text = read(index);
    const files = existsSync(join(ROOT, folder)) ? readdirSync(join(ROOT, folder)).filter((f) => pattern.test(f)) : [];
    expect(files.filter((f) => !text.includes(`${linkPrefix}${f}`))).toEqual([]);
  });
});
