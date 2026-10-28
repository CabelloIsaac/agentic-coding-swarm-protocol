/**
 * Documentation is part of the change: fails if the docs cite something that does not exist, or if structure appears
 * undocumented. Bidirectional where it matters: the invariant table and the tests name the same ids, and every index
 * lists every file of its folder. Adapt the RULES block to your repo; the mechanisms below are generic.
 * How to fix a failure: update the document named in the message; do not relax the test.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────────── RULES (edit these) ─────────────────────────────
const ROOT = join(import.meta.dirname, '..');
/** Documents checked: every .md under these folders plus these files. */
const DOC_FOLDERS = ['docs'];
const DOC_FILES = ['CLAUDE.md', 'README.md'];
/** Top-level folders whose backticked paths must exist (`src/storage/x.ts`). */
const PATH_ROOTS = ['src', 'docs', 'scripts', 'openspec'];
/** Architecture docs, and the folder whose sub-folders are modules that must be named there. */
const ARCH_FILES = ['docs/architecture.md'];
const MODULE_ROOT = 'src';
/** Folders whose sub-folders with a `package.json` are packages or apps that must be named in the architecture docs. */
const PACKAGE_ROOTS = ['packages', 'apps'];
/** CLI commands found by `regex` in these folders must appear in the README. */
const COMMANDS = { folders: ['src/cli/commands'], regex: /\.command\('([a-z:-]+)/g, readme: 'README.md' };
/** Indexes that must list every file of a folder: the ADR index and the extension-guide index. */
const INDEXES = [
  { index: 'docs/adr/README.md', folder: 'docs/adr', pattern: /^\d{4}-.*\.md$/, prefix: '' },
  { index: 'docs/README.md', folder: 'docs/extending', pattern: /\.md$/, prefix: 'extending/' },
];
/**
 * Invariant table rows look like `| INV-01 |`. `testFiles` are searched for ids (the architecture test first);
 * `notTested` maps ids enforced some other way to the reason. `digits` is the one canonical zero padding.
 */
const INVARIANTS = { prefix: 'INV', digits: 2, testFiles: ['test/architecture.test.ts'], notTested: {} as Record<string, string> };
/**
 * Rules name their mechanism: in `file`, every bullet under a `## ` heading (continuation lines included) ends with
 * `(enforced: <path>, …)` or `(preference)`, and every enforced path exists (`path#fragment` checks the path).
 * `exemptSections` are headings whose bullets are not rules (an index of links, say).
 */
const RULE_MARKERS = { file: 'CLAUDE.md', exemptSections: [] as string[] };

// ───────────────────────────── MECHANISMS ─────────────────────────────
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const exists = (f: string) => existsSync(join(ROOT, f));
const dirs = (d: string) => (exists(d) ? readdirSync(join(ROOT, d)).filter((f) => statSync(join(ROOT, d, f)).isDirectory()) : []);
const files = (d: string, pattern: RegExp) => (exists(d) ? readdirSync(join(ROOT, d)).filter((f) => pattern.test(f)) : []);
const md = (dir: string): string[] =>
  !exists(dir)
    ? []
    : readdirSync(join(ROOT, dir)).flatMap((f) => {
        const p = join(ROOT, dir, f);
        return statSync(p).isDirectory() ? md(relative(ROOT, p)) : f.endsWith('.md') ? [relative(ROOT, p)] : [];
      });
const DOCS = [...DOC_FOLDERS.flatMap(md), ...DOC_FILES.filter(exists)];
/** Strips code blocks: whatever sits inside ``` is an example, not a reference. */
const prose = (s: string) => s.replace(/```[\s\S]*?```/g, '');
const ARCH = ARCH_FILES.filter(exists).map(read).join('\n');
const { prefix: P, digits: D } = INVARIANTS;
const tableIds = () => [...new Set([...ARCH.matchAll(new RegExp(`\\| (${P}-\\d{${D}}) \\|`, 'g'))].map((m) => m[1] ?? ''))];
/** Ids a suite cites, including the `INV-06/07` shorthand for one test covering two invariants. */
const testedIds = (f: string) =>
  [...read(f).matchAll(new RegExp(`${P}-(\\d{${D}})(?:/(\\d{${D}}))?(?!\\d)`, 'g'))].flatMap((m) => [`${P}-${m[1]}`, ...(m[2] ? [`${P}-${m[2]}`] : [])]);

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

describe('rules name their mechanism', () => {
  const rules = exists(RULE_MARKERS.file) ? ruleBullets(read(RULE_MARKERS.file)) : [];

  it(`every rule in ${RULE_MARKERS.file} ends with (enforced: <path>) or (preference)`, () => {
    expect(rules.filter((r) => !RULE_MARKER.test(r.text)).map((r) => `${r.section} → ${r.text.slice(0, 80)}`)).toEqual([]);
  });

  it('every enforced: target exists', () => {
    const targets = rules.flatMap((r) => (RULE_MARKER.exec(r.text)?.[1] ?? '').split(',').map((t) => t.trim().replace(/`/g, '').split('#')[0] ?? '').filter(Boolean));
    expect(targets.filter((t) => !exists(t))).toEqual([]);
  });
});

describe('the documentation cites things that exist', () => {
  it('relative links resolve', () => {
    const broken = DOCS.flatMap((d) =>
      [...prose(read(d)).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
        .map((m) => m[1] ?? '')
        .filter((l) => !/^[a-z]+:/.test(l) && !l.startsWith('/'))
        .filter((l) => !existsSync(join(ROOT, dirname(d), l)))
        .map((l) => `${d} → ${l}`),
    );
    expect(broken).toEqual([]);
  });

  it('repo paths in backticks exist', () => {
    const re = new RegExp(`\`((?:${PATH_ROOTS.join('|')})/[^\`\\s*<>{}]+)\``, 'g');
    const missing = DOCS.flatMap((d) =>
      [...prose(read(d)).matchAll(re)]
        .map((m) => (m[1] ?? '').replace(/\/$/, ''))
        .filter((p) => !p.includes('...') && !exists(p))
        .map((p) => `${d} → ${p}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('new structure is documented', () => {
  it(`every module in ${MODULE_ROOT}/ appears in the architecture docs`, () => {
    expect(dirs(MODULE_ROOT).filter((m) => !ARCH.includes(`${MODULE_ROOT}/${m}`))).toEqual([]);
  });

  it('every package or app is named in the architecture docs', () => {
    const undocumented = PACKAGE_ROOTS.flatMap((root) =>
      dirs(root)
        .filter((d) => exists(`${root}/${d}/package.json`))
        .filter((d) => {
          const name = (JSON.parse(read(`${root}/${d}/package.json`)) as { name?: string }).name;
          return !ARCH.includes(`${root}/${d}`) && !(name && ARCH.includes(name));
        })
        .map((d) => `${root}/${d}`),
    );
    expect(undocumented).toEqual([]);
  });

  it('every CLI command appears in the README', () => {
    const readme = read(COMMANDS.readme);
    const commands = COMMANDS.folders.flatMap((d) => files(d, /\.tsx?$/).flatMap((f) => [...read(`${d}/${f}`).matchAll(COMMANDS.regex)].map((m) => m[1] ?? '')));
    expect(commands.filter((c) => !readme.includes(c))).toEqual([]);
  });

  it.each(INDEXES)('$index lists every file of $folder', ({ index, folder, pattern, prefix }) => {
    const text = exists(index) ? read(index) : '';
    expect(files(folder, pattern).filter((f) => !text.includes(`${prefix}${f}`))).toEqual([]);
  });
});

describe('invariants: the table and the tests agree', () => {
  const testFiles = INVARIANTS.testFiles.filter(exists);

  it('every tested id has a row in the invariant table', () => {
    const table = new Set(tableIds());
    expect([...new Set(testFiles.flatMap(testedIds))].filter((i) => !table.has(i))).toEqual([]);
  });

  it('every id in the table has a test, or a stated reason in notTested', () => {
    const tested = new Set(testFiles.flatMap(testedIds));
    const table = tableIds();
    expect(table.filter((i) => !tested.has(i) && !INVARIANTS.notTested[i])).toEqual([]);
    // Stale reasons (the id is now tested, or left the table) fail too: the exception list only shrinks
    expect(Object.keys(INVARIANTS.notTested).filter((i) => tested.has(i) || !table.includes(i))).toEqual([]);
  });

  it('prose uses one numbering (no unpadded or re-padded ids, e.g. INV-1 for INV-01)', () => {
    const canonical = new RegExp(`^${P}-\\d{${D}}$`);
    const wrong = [...DOCS, ...testFiles].flatMap((f) =>
      [...prose(read(f)).matchAll(new RegExp(`\\b${P}-\\d+\\b`, 'g'))].map((m) => m[0]).filter((id) => !canonical.test(id)).map((id) => `${f} → ${id}`),
    );
    expect(wrong).toEqual([]);
  });
});
