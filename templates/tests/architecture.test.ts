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

/**
 * Exceptions to "no silent catch" (file → how many it may still have). Only shrinks: a count goes down when you fix
 * one, and a new silent catch fails the test instead of raising a number. The same rule, counted by the same idiom,
 * lives in `scripts/dev/ratchets.ts` (`silentErrors`); this copy is standalone on purpose, so the architecture test
 * keeps working where the ratchets file is not adopted yet. Record today's counts when adopting.
 */
const SILENT_CATCH_ALLOWED: Record<string, number> = {
  // 'src/jobs/worker.ts': 2,
};
const SILENT_CATCH_DIRS = ['src'];

/**
 * Silent = a `catch` block (or `.catch(() => <literal>)`) that does not log, rethrow or use the error. Limits of this
 * regex version: it does not mask comments or strings (a `catch {}` inside a string counts), it takes the body up to
 * the first `}` (a nested block ends it early, which only hides some cases), and a call of any kind in the body counts
 * as "handled" (it does not judge what the call does). A catch that logs or rethrows a typed error is accepted.
 */
function silentCatches(src: string): number {
  const block = [...src.matchAll(/\bcatch\s*(?:\(([^()]*)\))?\s*\{([^}]*)\}/g)].filter((m) => {
    const body = (m[2] ?? '').replace(/\/\/.*|\/\*[\s\S]*?\*\//g, '').trim();
    if (/[\w$)\]>]\s*\(|\bthrow\b/.test(body.replace(/\b(?:else\s+if|if|for|while|switch|return|typeof|await|void)\s*\(/g, '('))) return false;
    const binding = /^\s*([\w$]+)/.exec(m[1] ?? '')?.[1];
    if (binding && new RegExp(`\\b${binding}\\b`).test(body)) return false;
    return /^(?:(?:return(?:\s+(?:undefined|null|true|false|-?\d+|''|""|\[\]|\{\}))?|continue|break)\s*;?\s*)*$/.test(body);
  }).length;
  const promise = (src.match(/\.catch\(\s*(?:noop|(?:\(\s*\w*\s*\)|\w+)\s*=>\s*(?:undefined|null|false|true|-?\d+|''|""|\[\]|\{\}|\(\{\}\)))\s*\)/g) ?? []).length;
  return block + promise;
}

describe('No silent catch (errors are never swallowed without a trace)', () => {
  const counts = SILENT_CATCH_DIRS.flatMap((d) => files(d)).map((f) => [f, silentCatches(read(f))] as const);

  it('no file has more silent catches than its allow-list entry (log with context, rethrow typed, or return a Result)', () => {
    const offenders = counts.filter(([f, n]) => n > (SILENT_CATCH_ALLOWED[f] ?? 0)).map(([f, n]) => `${f}: ${n} (allowed ${SILENT_CATCH_ALLOWED[f] ?? 0})`);
    expect(offenders).toEqual([]);
  });

  it('the allow-list has no stale entries', () => {
    const stale = Object.entries(SILENT_CATCH_ALLOWED).filter(([f, n]) => (counts.find(([g]) => g === f)?.[1] ?? 0) < n).map(([f]) => f);
    expect(stale).toEqual([]);
  });
});

describe('Playground quarantine', () => {
  it('nothing in the system imports from playground/', () => {
    const offenders = files('src').filter((f) => imports(read(f)).some((i) => i.includes('playground/')));
    expect(offenders).toEqual([]);
  });
});
