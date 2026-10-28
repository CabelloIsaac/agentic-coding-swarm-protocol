/**
 * Documentation is part of the change: fails if the docs cite something that does not exist, or if structure appears
 * undocumented. Adapt DOCS, the path prefixes and the structure checks to your repo.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');
const md = (dir: string): string[] =>
  readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(ROOT, dir, f);
    return statSync(p).isDirectory() ? md(relative(ROOT, p)) : f.endsWith('.md') ? [relative(ROOT, p)] : [];
  });
const DOCS = [...md('docs'), 'CLAUDE.md', 'README.md'];
const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
/** Strips code blocks: whatever sits inside ``` is an example, not a reference. */
const prose = (s: string) => s.replace(/```[\s\S]*?```/g, '');

describe('the documentation cites things that exist', () => {
  it('relative links resolve', () => {
    const broken = DOCS.flatMap((d) =>
      [...prose(read(d)).matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)]
        .map((m) => m[1] ?? '')
        .filter((l) => !/^[a-z]+:/.test(l))
        .filter((l) => !existsSync(join(ROOT, dirname(d), l)))
        .map((l) => `${d} → ${l}`),
    );
    expect(broken).toEqual([]);
  });

  it('repo paths in backticks exist', () => {
    const missing = DOCS.flatMap((d) =>
      [...prose(read(d)).matchAll(/`((?:src|docs|scripts|openspec)\/[^`\s*<>{}]+)`/g)]
        .map((m) => m[1] ?? '')
        .filter((p) => !existsSync(join(ROOT, p)))
        .map((p) => `${d} → ${p}`),
    );
    expect(missing).toEqual([]);
  });
});

describe('new structure is documented', () => {
  it('every module in src/ appears in docs/architecture.md', () => {
    const arch = read('docs/architecture.md');
    const modules = readdirSync(join(ROOT, 'src')).filter((f) => statSync(join(ROOT, 'src', f)).isDirectory());
    expect(modules.filter((m) => !arch.includes(`src/${m}`))).toEqual([]);
  });

  it('the ADR index lists every numbered ADR', () => {
    const index = read('docs/adr/README.md');
    const adrs = readdirSync(join(ROOT, 'docs/adr')).filter((f) => /^\d{4}-.*\.md$/.test(f) && !f.startsWith('0000'));
    expect(adrs.filter((a) => !index.includes(a))).toEqual([]);
  });

  it('docs/README.md links every guide in docs/extending/', () => {
    const index = read('docs/README.md');
    const guides = existsSync(join(ROOT, 'docs/extending')) ? readdirSync(join(ROOT, 'docs/extending')).filter((f) => f.endsWith('.md')) : [];
    expect(guides.filter((g) => !index.includes(g))).toEqual([]);
  });
});
