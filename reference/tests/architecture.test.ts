/**
 * Architecture tests: they turn the invariants of your architecture document into automatic checks. If one fails, do
 * NOT "fix" it by adding an exception without updating the invariant and its justification in the architecture doc.
 *
 * Layout of this file
 *   1. RULES (top, the only part you edit): tables of concrete rules with example entries. Replace the examples with
 *      your own folders and names. Every path in a rule must exist: a rule that points at nothing fails loudly
 *      (a check that matches zero files "passes" and protects nothing).
 *   2. MECHANISMS (below): generic checks driven by the tables — forbidden patterns with an allowlist that needs
 *      reasons and fails when an entry goes stale, an import-graph boundary with a classification of every file,
 *      "registry equals code" in both directions, block-scoped required calls, append-only and schema_version checks.
 *
 * Exception lists are tables of `file → reason`, plus a test that fails on stale entries: lists only shrink.
 */
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

// ───────────────────────────────────────────── 1. RULES ─────────────────────────────────────────────

/** Repo root, relative to this file (tests live in `<root>/test/`). */
const ROOT = resolve(import.meta.dirname, '..');

/** Every source file under these folders is scanned by the rules below (tests and generated folders are skipped). */
const SOURCE_ROOTS = ['src', 'apps'];
const SKIP_DIRS = ['node_modules', '.next', 'dist', 'coverage', 'schemas-json'];

/** Imports of a package specifier or of a built-in module. */
const importOf = (pkg: string) => new RegExp(`from ['"](?:node:)?${pkg}(?:/[^'"]*)?['"]|require\\(['"](?:node:)?${pkg}['"]\\)|import\\(['"](?:node:)?${pkg}(?:/[^'"]*)?['"]\\)`);
/** Strips comments, for rules whose pattern may legitimately appear in prose. */
const stripComments = (src: string) => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');

interface PatternRule {
  id: string;
  /** Why the rule exists: shown when it fails, and the sentence to put in the architecture doc. */
  why: string;
  /** What is forbidden. */
  pattern: RegExp;
  /** Folders (or files) to scan. */
  scope: string[];
  /** Folders where the pattern is allowed. */
  allowedPrefixes?: string[];
  /** Individual files where it is allowed, each with a reason. Fails when an entry stops matching (stale). */
  allowlist?: Record<string, string>;
  /** Ignore matches inside comments. */
  ignoreComments?: boolean;
}

const PATTERN_RULES: PatternRule[] = [
  {
    id: 'storage-only-touches-the-filesystem',
    why: 'Only src/storage reads or writes persistent state; everything else goes through the repository interfaces.',
    pattern: importOf('fs(?:/promises)?'),
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/storage/'],
    allowlist: {
      'src/schemas/export.ts': 'build-time: exports JSON Schema files, not runtime state',
      'apps/cli/src/commands/preview.ts': 'static server of the local preview',
    },
  },
  {
    id: 'db-driver-confined-to-storage',
    why: 'Nobody outside storage builds a database backend; the driver and its adapter are imported only there.',
    pattern: new RegExp(`${importOf('pg').source}|from ['"][^'"]*storage/postgres/`),
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/storage/'],
  },
  {
    id: 'llm-sdk-confined-to-llm-folder',
    why: 'The model vendor SDK is imported only in src/llm, so every call goes through one gateway (budget, logging, replay).',
    pattern: importOf('@anthropic-ai/sdk'),
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/llm/'],
  },
  {
    id: 'domain-never-calls-the-network-directly',
    why: 'Domain code reaches the outside world only through the integrations gateway (ctx.integrations), never fetch or an SDK.',
    pattern: /\bfetch\(/,
    scope: ['src/domain'],
    ignoreComments: true,
  },
  {
    id: 'no-hand-built-backends',
    why: 'Ledgers and stores are requested from the repository, never constructed by hand outside storage.',
    pattern: /new (Pg[A-Z]\w*|Ledger|ObjectStore)\(/,
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/storage/'],
    ignoreComments: true,
  },
  {
    id: 'ledgers-are-not-read-as-text',
    why: 'With a database backend a ledger is not a file: it is read through the port, never with readText on a .jsonl.',
    pattern: /readText\([^)]*(\.jsonl|LEDGERS\b)/,
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/storage/'],
  },
  {
    id: 'deletes-only-in-storage',
    why: 'Deleting data is a versioned, reversible operation owned by the storage layer; nothing else unlinks files.',
    pattern: /\b(rmSync|unlinkSync|rmdirSync)\b/,
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/storage/'],
    allowlist: { 'src/storage/scratch.ts': 'operational scratch space, not tenant data' },
  },
  {
    id: 'destructive-operations-are-not-agent-tools',
    why: 'Restoring or purging versions is a human decision: the agent-facing layers never call it.',
    pattern: /restoreFile|\bpurgeFile\b/,
    scope: ['src/domain', 'src/kernel', 'src/llm'],
  },
  {
    id: 'sandbox-is-outside-the-system',
    why: 'The playground (throw-away experiments) is never imported or read by product code.',
    pattern: /['"`][^'"`\n]*\bplayground\b/,
    scope: [...SOURCE_ROOTS, 'scripts'],
    allowlist: { 'scripts/playground.ts': 'the command that creates experiment folders may name it' },
    ignoreComments: true,
  },
  {
    id: 'restricted-model-hidden-from-the-agent',
    why: 'The test-oracle model is invisible to the agent: only the tools that own it may name its folder.',
    pattern: /['"`]restricted-model\//,
    scope: SOURCE_ROOTS,
    allowedPrefixes: ['src/oracle/'],
    allowlist: { 'src/results/source.ts': 'only asks whether the seed exists' },
    ignoreComments: true,
  },
];

/** A folder whose files must never be imported (relatively) from the listed folders. */
const ISOLATED_DIRS: Array<{ id: string; dir: string; notImportedBy: string[]; why: string }> = [
  { id: 'feedback-is-team-memory', dir: 'feedback', notImportedBy: ['src/kernel', 'src/domain'], why: 'Team feedback is read by people, never by the runtime to decide.' },
];

/** `package.json` dependency rules (dependency-direction between packages). */
const PACKAGE_RULES: Array<{ id: string; pkgJson: string; mustNotDependOn: string[] }> = [
  { id: 'core-does-not-depend-on-integrations', pkgJson: 'package.json', mustNotDependOn: ['@myproject/integrations'] },
];

/**
 * Block-scoped required calls. The file is split into blocks at `blockStart`; every block whose effect is not in
 * `skipEffects` and whose name is not in `exceptNames` must contain one of `requiresAnyOf`.
 */
const BLOCK_RULES: Array<{
  id: string;
  file: string;
  blockStart: string;
  nameRegex: RegExp;
  effectRegex: RegExp;
  skipEffects: string[];
  exceptNames: string[];
  requiresAnyOf: string[];
  /** Guards against a vacuous pass: the file must contain at least this many blocks. */
  minBlocks: number;
}> = [
  {
    id: 'every-write-goes-through-the-pipeline',
    file: 'src/domain/website/tools.ts',
    blockStart: 'defineTool({',
    nameRegex: /name: '([a-z_]+)'/,
    effectRegex: /effect: '([a-z_]+)'/,
    skipEffects: ['read'],
    exceptNames: ['delete_draft'],
    requiresAnyOf: ['writeWithPipeline(', 'writeConfigWithPipeline('],
    minBlocks: 5,
  },
];

/** Files that must (not) match a pattern: structural guarantees that live in code, SQL or config. */
const REQUIRED_PATTERNS: Array<{ id: string; file: string; mustMatch?: RegExp[]; mustNotMatch?: RegExp[]; why: string }> = [
  {
    id: 'ledger-immutable-in-the-database',
    file: 'src/storage/postgres/migrations/0001_initial.sql',
    mustMatch: [/create trigger ledger_events_immutable\s+before update or delete on ledger_events/i, /create trigger ledger_events_no_truncate\s+before truncate on ledger_events/i],
    why: 'Append-only must hold in the database too, not only in the application layer.',
  },
  {
    id: 'completed-means-verified',
    file: 'src/kernel/executor.ts',
    mustMatch: [/acc\.failed\.length \? \{ result: 'fail'[^\n]*: \{ result: 'pass'/],
    why: 'The executor marks `pass` only after the acceptance criteria were evaluated and none failed.',
  },
];

/** Registry = code, in both directions. The registry is JSON (`{ entries: [{ name, domain, effect, implemented }] }`); convert YAML first or add a parser. */
const REGISTRY = {
  file: 'registry/registry.json',
  implementationDirs: ['src/domain/tools'],
  blockStart: 'defineTool({',
  fields: { name: /name: '([a-z_]+)'/, domain: /domain: '([a-z_]+)'/, effect: /effect: '([a-z_]+)'/, description: /description:\s*['"`]([^'"`]*)/ },
  /** The description reaches the LLM as the tool definition: too short means unusable. */
  minDescriptionLength: 20,
};

/** Append-only logs expose no update or delete, and every record schema carries the required fields. */
const APPEND_ONLY = {
  classFile: 'src/storage/ledger.ts',
  className: 'Ledger',
  allowedMethods: ['all', 'append', 'current', 'get', 'query'],
  schemaFiles: ['src/schemas/ledgers.ts'],
  requiredFields: ['schema_version', 'id', 'tenant_id', 'created_at'],
};

/**
 * Layer boundary: the kernel may import kernel code and shared schemas, never domain code. `classifiedFolders` hold
 * a mix, so every file in their top level must be listed as kernel or domain (a new file forces a decision).
 */
const LAYERS = {
  sourceRoot: 'src/',
  kernelDirs: ['src/storage/', 'src/llm/', 'src/clock/'],
  kernelFiles: ['src/ids.ts', 'src/log.ts', 'src/kernel/registry.ts', 'src/kernel/executor.ts', 'src/kernel/policy.ts'],
  domainFiles: ['src/kernel/index.ts', 'src/kernel/report.ts'],
  /** Importable from the kernel as shared contracts. */
  sharedDirs: ['src/schemas/'],
  classifiedFolders: ['src/kernel'],
  /** Existing debt: [kernel file, domain module it imports, reason]. Only ever shrinks. */
  exceptions: [['src/kernel/executor.ts', 'src/domain/pages.ts', 'detects stale actions on pages (target version)']] as Array<[string, string, string]>,
};

/** Files that must never mention a string (e.g. tool configs must not include the sandbox). */
const CONFIG_FORBID = { files: ['tsconfig.json', 'biome.json', 'vitest.config.ts', 'pnpm-workspace.yaml'], pattern: /playground/ };

// ─────────────────────────────────────────── 2. MECHANISMS ───────────────────────────────────────────

const rel = (p: string) => relative(ROOT, p).split('\\').join('/');
const read = (relPath: string) => readFileSync(join(ROOT, relPath), 'utf8');
const exists = (relPath: string) => existsSync(join(ROOT, relPath));

/** Source files (no tests, no declaration files) under a folder or a single file, relative to ROOT. */
function sources(path: string): string[] {
  const abs = join(ROOT, path);
  if (!existsSync(abs)) return [];
  if (statSync(abs).isFile()) return [path];
  const out: string[] = [];
  const walk = (d: string) => {
    for (const f of readdirSync(d)) {
      if (SKIP_DIRS.includes(f)) continue;
      const p = join(d, f);
      if (statSync(p).isDirectory()) walk(p);
      else if (/\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) && !/\.d\.ts$/.test(f)) out.push(rel(p));
    }
  };
  walk(abs);
  return out;
}
const all = (paths: string[]) => [...new Set(paths.flatMap(sources))];

describe('sanity: configured paths exist', () => {
  it('every scope, file and folder named by a rule exists (no vacuous passes)', () => {
    const named = [
      ...SOURCE_ROOTS,
      ...PATTERN_RULES.flatMap((r) => [...r.scope, ...(r.allowedPrefixes ?? []), ...Object.keys(r.allowlist ?? {})]),
      ...BLOCK_RULES.map((r) => r.file),
      ...REQUIRED_PATTERNS.map((r) => r.file),
      ...REGISTRY.implementationDirs,
      REGISTRY.file,
      APPEND_ONLY.classFile,
      ...APPEND_ONLY.schemaFiles,
      ...LAYERS.kernelDirs,
      ...LAYERS.kernelFiles,
      ...LAYERS.domainFiles,
      ...LAYERS.classifiedFolders,
    ];
    expect(named.filter((p) => !exists(p))).toEqual([]);
  });
});

describe.each(PATTERN_RULES)('rule: $id', (rule) => {
  const scan = () =>
    all(rule.scope).filter((f) => {
      const text = read(f);
      return rule.pattern.test(rule.ignoreComments ? stripComments(text) : text);
    });
  const allowed = (f: string) => (rule.allowedPrefixes ?? []).some((p) => f.startsWith(p)) || f in (rule.allowlist ?? {});

  it(`holds: ${rule.why}`, () => {
    expect(scan().filter((f) => !allowed(f)), `${rule.why} Do not add an exception without updating the architecture doc.`).toEqual([]);
  });

  it('has no stale allowlist entries (the debt is paid: remove the entry)', () => {
    const hits = new Set(scan());
    expect(Object.keys(rule.allowlist ?? {}).filter((f) => !hits.has(f))).toEqual([]);
  });

  it('every allowlist entry carries a reason', () => {
    expect(Object.entries(rule.allowlist ?? {}).filter(([, why]) => why.trim().length < 10).map(([f]) => f)).toEqual([]);
  });
});

describe('isolated folders are never imported by the listed layers', () => {
  // `../feedback/x.ts`, `../../feedback/index.ts`, `./feedback`
  const importsDir = (src: string, dir: string) => new RegExp(`from ['"](?:\\.\\.?/)+(?:\\.\\./)*${dir}(?:/[^'"]*)?['"]`).test(src);

  it('the detector sees relative imports of the folder and ignores the rest', () => {
    expect(importsDir("import { x } from '../feedback/store.ts';", 'feedback')).toBe(true);
    expect(importsDir("import { x } from '../../feedback/index.ts';", 'feedback')).toBe(true);
    expect(importsDir("import { x } from '../storage/json-store.ts';", 'feedback')).toBe(false);
  });

  for (const rule of ISOLATED_DIRS) {
    it(`${rule.id}: ${rule.why}`, () => {
      expect(all(rule.notImportedBy).filter((f) => importsDir(read(f), rule.dir))).toEqual([]);
    });
  }
});

describe('dependency direction between packages', () => {
  for (const rule of PACKAGE_RULES) {
    it(rule.id, () => {
      const pkg = JSON.parse(read(rule.pkgJson)) as { dependencies?: Record<string, string>; peerDependencies?: Record<string, string> };
      const declared = { ...pkg.dependencies, ...pkg.peerDependencies };
      for (const name of rule.mustNotDependOn) expect(declared).not.toHaveProperty(name);
    });
  }
});

describe('layer boundary: the kernel imports only kernel and shared schemas', () => {
  const kernelFiles = new Set(LAYERS.kernelFiles);
  const domainFiles = new Set(LAYERS.domainFiles);
  const isKernel = (f: string) => kernelFiles.has(f) || LAYERS.kernelDirs.some((d) => f.startsWith(d));
  const isAllowedTarget = (f: string) => isKernel(f) || LAYERS.sharedDirs.some((d) => f.startsWith(d));
  const relativeImports = (file: string) =>
    [...read(file).matchAll(/from ['"](\.\.?\/[^'"]+)['"]/g)].map((m) => rel(resolve(join(ROOT, file, '..'), m[1] ?? '')));

  /** (kernel → domain) pairs not in the exception list, and exceptions that no longer exist. */
  function checkBoundary(exceptions: Array<[string, string, string]>) {
    const found = sources(LAYERS.sourceRoot.replace(/\/$/, ''))
      .filter(isKernel)
      .flatMap((f) => relativeImports(f).filter((t) => t.startsWith(LAYERS.sourceRoot) && !isAllowedTarget(t)).map((t) => `${f} → ${t}`));
    const allowed = new Set(exceptions.map(([f, t]) => `${f} → ${t}`));
    return { violations: found.filter((p) => !allowed.has(p)), stale: [...allowed].filter((p) => !found.includes(p)) };
  }

  it('every file at the top of a classified folder is declared kernel or domain', () => {
    const files = LAYERS.classifiedFolders.flatMap((d) => readdirSync(join(ROOT, d)).map((f) => `${d}/${f}`));
    const unclassified = files.filter((f) => /\.ts$/.test(f) && !/\.test\.ts$/.test(f) && !kernelFiles.has(f) && !domainFiles.has(f));
    expect(unclassified, 'add the file to LAYERS.kernelFiles or LAYERS.domainFiles').toEqual([]);
  });

  it('kernel imports nothing from the domain, except the listed exceptions', () => {
    expect(checkBoundary(LAYERS.exceptions).violations, 'kernel imports domain: move it to the domain or inject it').toEqual([]);
  });

  it('the exception list has no pairs that no longer exist', () => {
    expect(checkBoundary(LAYERS.exceptions).stale, 'remove the exception: the debt is paid').toEqual([]);
    // The stale detector itself works: a fictitious pair is reported
    expect(checkBoundary([...LAYERS.exceptions, ['src/kernel/policy.ts', 'src/domain/nowhere.ts', 'fictitious']]).stale).toEqual(['src/kernel/policy.ts → src/domain/nowhere.ts']);
  });

  it('every exception carries a reason', () => {
    expect(LAYERS.exceptions.filter(([, , why]) => why.trim().length < 10)).toEqual([]);
  });
});

describe('block-scoped required calls', () => {
  for (const rule of BLOCK_RULES) {
    it(rule.id, () => {
      const blocks = read(rule.file).split(rule.blockStart).slice(1);
      expect(blocks.length, `${rule.file}: fewer blocks than expected, the rule may be matching nothing`).toBeGreaterThanOrEqual(rule.minBlocks);
      const offenders = blocks
        .map((b) => ({ name: rule.nameRegex.exec(b)?.[1], effect: rule.effectRegex.exec(b)?.[1], ok: rule.requiresAnyOf.some((c) => b.includes(c)) }))
        .filter((b) => !rule.skipEffects.includes(b.effect ?? '') && !rule.exceptNames.includes(b.name ?? '') && !b.ok)
        .map((b) => b.name);
      expect(offenders).toEqual([]);
    });
  }
});

describe('required patterns in code, SQL and config', () => {
  for (const rule of REQUIRED_PATTERNS) {
    it(`${rule.id}: ${rule.why}`, () => {
      const text = read(rule.file);
      for (const re of rule.mustMatch ?? []) expect(text, `${rule.file} must match ${re}`).toMatch(re);
      for (const re of rule.mustNotMatch ?? []) expect(text, `${rule.file} must not match ${re}`).not.toMatch(re);
    });
  }
});

describe('registry equals code, in both directions', () => {
  interface Entry {
    name: string;
    domain: string;
    effect: string;
    implemented: boolean;
  }
  const entries = () => (JSON.parse(read(REGISTRY.file)) as { entries: Entry[] }).entries;
  const implementations = () =>
    all(REGISTRY.implementationDirs).flatMap((f) =>
      read(f)
        .split(REGISTRY.blockStart)
        .slice(1)
        .map((b) => ({
          file: f,
          name: REGISTRY.fields.name.exec(b)?.[1],
          domain: REGISTRY.fields.domain.exec(b)?.[1],
          effect: REGISTRY.fields.effect.exec(b)?.[1],
          description: REGISTRY.fields.description.exec(b)?.[1] ?? '',
        })),
    );

  it('every implementation is registered with the same domain and effect', () => {
    const byName = new Map(entries().map((e) => [e.name, e]));
    const mismatches = implementations()
      .filter((i) => {
        const e = i.name ? byName.get(i.name) : undefined;
        return !e || e.domain !== i.domain || e.effect !== i.effect;
      })
      .map((i) => `${i.name} (${i.file})`);
    expect(mismatches).toEqual([]);
  });

  it('every entry marked implemented has an implementation, and vice versa', () => {
    const impl = new Set(implementations().map((i) => i.name));
    const mismatches = entries()
      .filter((e) => e.implemented !== impl.has(e.name))
      .map((e) => `${e.name}: implemented=${e.implemented}, in code=${impl.has(e.name)}`);
    expect(mismatches).toEqual([]);
  });

  it('every implementation has a description long enough to be a usable tool definition', () => {
    expect(implementations().filter((i) => i.description.trim().length < REGISTRY.minDescriptionLength).map((i) => i.name)).toEqual([]);
  });
});

describe('append-only logs are versioned and cannot be modified', () => {
  it(`${APPEND_ONLY.className} exposes no operation that modifies or deletes`, () => {
    const text = read(APPEND_ONLY.classFile);
    const start = text.indexOf(`class ${APPEND_ONLY.className}`);
    expect(start, `class ${APPEND_ONLY.className} not found in ${APPEND_ONLY.classFile}`).toBeGreaterThanOrEqual(0);
    const body = text.slice(start).split(/\n}\n/)[0] ?? '';
    const methods = [...body.matchAll(/^ {2}(?:(?:public|async|static)\s+)*([a-zA-Z_]\w*)\(/gm)].map((m) => m[1] ?? '').filter((m) => m !== 'constructor');
    expect([...new Set(methods)].sort()).toEqual([...APPEND_ONLY.allowedMethods].sort());
  });

  it('every record schema requires schema_version and the other mandatory fields', () => {
    for (const file of APPEND_ONLY.schemaFiles) {
      const text = read(file);
      for (const field of APPEND_ONLY.requiredFields) expect(text, `${file}: ${field}`).toMatch(new RegExp(`\\b${field}\\b`));
    }
  });
});

describe('tool configs do not mention forbidden names', () => {
  it.each(CONFIG_FORBID.files)('%s', (file) => {
    if (exists(file)) expect(read(file), file).not.toMatch(CONFIG_FORBID.pattern);
  });
});
