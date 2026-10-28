/**
 * Architecture invariants as tests (see docs/architecture.md § Invariants).
 * Do not fix a failure by adding an exception without updating the document: either the code changes, or the
 * invariant changes through an ADR. Exception lists only shrink (there is a test for stale entries).
 */
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { describe, expect, it } from 'vitest';

const ROOT = join(import.meta.dirname, '..');

function files(dir: string, ext = /\.tsx?$/): string[] {
  return readdirSync(join(ROOT, dir)).flatMap((f) => {
    const p = join(ROOT, dir, f);
    if (statSync(p).isDirectory()) return f === 'node_modules' ? [] : files(relative(ROOT, p), ext);
    return ext.test(f) && !f.endsWith('.test.ts') ? [relative(ROOT, p)] : [];
  });
}

const read = (f: string) => readFileSync(join(ROOT, f), 'utf8');
const imports = (src: string) => [...src.matchAll(/(?:from|import\()\s*['"]([^'"]+)['"]/g)].map((m) => m[1] ?? '');

/** Exceptions to INV-01, each with its reason. Only shrinks. */
const FS_ALLOWED: Record<string, string> = {
  // 'src/config/load.ts': 'reads the configuration before the repository exists',
};

describe('INV-01 · only src/storage touches the filesystem', () => {
  it('nothing outside src/storage imports node:fs', () => {
    const offenders = files('src')
      .filter((f) => !f.startsWith('src/storage/') && !(f in FS_ALLOWED))
      .filter((f) => imports(read(f)).some((i) => i === 'fs' || i === 'node:fs' || i === 'fs/promises' || i === 'node:fs/promises'));
    expect(offenders).toEqual([]);
  });

  it('the exception list has no stale entries', () => {
    const stale = Object.keys(FS_ALLOWED).filter((f) => !imports(read(f)).some((i) => i.includes('fs')));
    expect(stale).toEqual([]);
  });
});

describe('INV-02 · the LLM SDK is imported only in src/llm', () => {
  it('nothing outside src/llm imports @anthropic-ai/sdk', () => {
    const offenders = files('src').filter((f) => !f.startsWith('src/llm/') && imports(read(f)).some((i) => i.startsWith('@anthropic-ai/sdk')));
    expect(offenders).toEqual([]);
  });
});

describe('INV-03 · the domain does not fetch directly', () => {
  it('src/domain reaches the outside only through the gateway', () => {
    const offenders = files('src/domain').filter((f) => /\bfetch\(/.test(read(f)));
    expect(offenders).toEqual([]);
  });
});

describe('Playground quarantine', () => {
  it('nothing in the system imports from playground/', () => {
    const offenders = files('src').filter((f) => imports(read(f)).some((i) => i.includes('playground/')));
    expect(offenders).toEqual([]);
  });
});
