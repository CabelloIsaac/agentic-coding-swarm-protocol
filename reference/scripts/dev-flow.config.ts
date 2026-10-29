/**
 * The single place for every project-specific constant of the dev-flow tooling. Scripts and tests import `config`;
 * nothing else in this folder hard-codes a branch, a prefix, a path or a command. Adopting the tooling means editing
 * this file, not the scripts.
 *
 * Pure data and types: this file imports nothing from this folder, so it can be loaded from anywhere without import cycles.
 *
 * `DEV_FLOW_CONFIG=<path to a JSON file>` is merged over these defaults when the module loads (plain objects are merged
 * key by key; arrays and scalars are replaced). The self-tests use it to point the scripts at a throw-away repo. JSON
 * has no regular expressions, so the `RegExp` keys keep their defaults.
 */
import { readFileSync } from 'node:fs';

export interface VerifyStep {
  name: string;
  cmd: string;
  /** Serial steps run after the parallel ones and one at a time: test suites load the machine. */
  serial?: boolean;
  /** Maximum time; when exceeded the step's whole process group is killed. */
  timeoutMs?: number;
}

/** A step of the quick tier, selected from the changed files. `{{integrationBranch}}` is substituted in `cmd`. */
export interface QuickRule {
  name: string;
  cmd: string;
  /** Include the step only if some changed file matches. Omit to always include it. */
  whenChanged?: RegExp;
  /** Append the changed files matching this pattern to `cmd` as quoted arguments (e.g. lint only what changed);
   *  the step is skipped when none match. */
  appendChanged?: RegExp;
  serial?: boolean;
  /** Put the step first (cheap steps that fail fast). */
  first?: boolean;
}

export interface OptionalSuite {
  name: string;
  /** Environment variable that enables the suite. */
  envVar: string;
  /** Hint shown when the suite is skipped. */
  hint: string;
}

/** When `land` requires a review receipt (INTEGRATION.md L2.7). */
export type ReviewMode = 'always' | 'sensitive' | 'off';

export interface ReviewConfig {
  mode: ReviewMode;
  /** Globs (`**`, `*`, `?`; no `/` = basename at any depth) whose change makes a review mandatory in `sensitive` mode. */
  sensitive: string[];
}

export interface Config {
  /** Used in lock and log file names, temp dirs and messages. */
  projectName: string;
  /** Prefix of the project's environment variables. */
  envPrefix: string;
  integrationBranch: string;
  remote: string;

  installCommand: string;
  /** Quieter install used by `wt setup` in a fresh worktree. */
  setupInstallCommand: string[];
  lockfile: string;
  /** Marker file the package manager writes in node_modules; older than the lockfile means dependencies are stale. */
  installMarker: string;

  /** Land: attempts before giving up when the integration branch keeps moving during verification. */
  landMaxAttempts: number;
  /** A land lock without a readable pid is considered abandoned after this long. */
  staleLockMinutes: number;
  /** Git config key (`git config --bool <key> true`) that marks the one clone allowed to publish. */
  publisherFlag: string;
  /** Where hooks versioned in the repo live; `wt setup` points `core.hooksPath` at it. */
  hooksDir: string;

  verify: {
    /** Where full logs are written, relative to the repo root. */
    logDir: string;
    stepTimeoutMinutes: number;
    killGraceMs: number;
    tailLines: number;
    /** Temp entries `<tmpPrefix>*` older than this are swept before every run. */
    tmpMaxAgeMinutes: number;
    full: VerifyStep[];
    quick: QuickRule[];
    /** Suites that only run with an external resource; the summary says whether they were included or skipped. */
    optionalSuites: OptionalSuite[];
    /** Files a framework regenerates on start but that are no longer versioned: without them `tsc` fails on a clean checkout. */
    ensureFiles: { path: string; content: string }[];
  };

  /** Temp directories created by this project's tools and tests start with this; sweeps only touch `<tmpPrefix>*`. */
  tmpPrefix: string;
  /** Environment variables that may point at a temporary project root; the test setup deletes those roots. */
  tmpRootEnvVars: string[];
  /** Loose temp roots (`<tmpPrefix><label>-XXXXXX`) older than this belong to no live run. */
  looseTmpMaxAgeHours: number;
  /** Test files that start servers or full runs: the sequencer puts them first. */
  slowFirstPattern: RegExp;

  /** Commands (exact name) that `wt reap` may stop when they are orphaned. */
  devToolPattern: string;
  /** Same idea, matched on the first three words of the command line (catches `node …/vitest`). */
  devToolArgsPattern: string;
  /** The agent process: never stopped by any tool. */
  agentProcess: { command: string; argsPattern: string };
  /** Deterministic ports per worktree: `portBase + hash(name) % portRange * services.length`, one per service. */
  portBase: number;
  portRange: number;
  portServices: string[];
  /** Worktree env file written by `wt setup`. */
  worktreeEnvFile: string;
  /** Folder (relative to the main checkout) that holds the session worktrees. */
  worktreeContainer: string;
  /** Dev servers that warn when there are too many or one is huge. */
  heavyServer: { command: string; maxCount: number; maxRssKb: number };
  memory: { swapWarnPct: number; mergedWorktreesWarn: number; indexerWarnKb: number };

  adrDir: string;
  adrIndexMarkers: { start: string; end: string };
  /** Label of the status line in an ADR (`- Status: Accepted`). */
  adrStatusLabel: string;
  adrDefaultStatus: string;

  /** Versioned files that dev servers rewrite on start: restoring them never loses anyone's work. */
  generatedFiles: RegExp;

  /** Spec-driven changes (OpenSpec layout) and the roadmap that orders them. */
  specsDir: string;
  roadmapFile: string;
  changesDir: string;

  audit: {
    dir: string;
    maxAgeDays: number;
    bigFileLines: number;
    /** A change with this fraction of its tasks done (and at least 5 tasks) is flagged as nearly done. */
    nearDoneRatio: number;
    /** Environment variables that never need documenting in the env example file. */
    envIgnore: RegExp;
    envExampleFile: string;
    vitestConfigFile: string;
    coverageSummaryFile: string;
    /** Command that writes the lint report as JSON (Biome shape: `{ diagnostics: [{ category, severity }] }`). */
    lintJsonCmd: string[];
    /** Named in the reminder printed when the last audit is stale. */
    auditHint: string;
  };

  /**
   * Quality ratchets (`ratchets.ts`): debt metrics that may only improve. `file` is checked by verify and tightened by
   * land, which commits it with `commitMessage` on top of the verified SHA; that commit may contain only this file.
   */
  ratchets: { file: string; commitMessage: string };

  // >>> 0.4.0 formatter and dependency gate (begin) >>>
  /**
   * The formatter in `verify`. `check` runs on the whole repo in the full tier and must exit non-zero when something is
   * unformatted; `quickCheck` gets the changed files appended (quick tier). Other stacks: `prettier --check .`,
   * `ruff format --check .`, `test -z "$(gofmt -l .)"`, `cargo fmt --check`.
   */
  format: { check: string; quickCheck: string };
  /** The dependency gate (`deps-audit.ts`): the audit command prints JSON; `failOn` severities block unless allowlisted. */
  deps: { command: string; failOn: string[]; allowlistFile: string };
  // <<< 0.4.0 formatter and dependency gate (end) <<<

  // >>> 0.4.0 closure: findings, mutation smoke, WIP limit (begin) >>>
  /** Findings ledger (`findings.ts`): ledger path, days to close by severity, closure quota, hot-file threshold. */
  findings?: {
    file: string;
    sla: { high: number; medium: number; low: number };
    closureEvery: number;
    hotFiles: { fixes: number; days: number };
  };
  /** Mutation smoke (`mutation-smoke.ts`): which changed files get mutated, how their tests are found and run. */
  mutation?: Partial<{
    include: string; testPattern: string; resolve: 'sibling' | 'sibling+grep'; command: string;
    timeoutSec: number; mode: 'warn' | 'fail'; max: number; maxTotal: number; maxLines: number;
  }>;
  /** WIP limit (`roadmap.ts`): active changes allowed and days without a ticked task before a change is stale. */
  roadmap?: Partial<{ maxActive: number; staleDays: number }>;
  // <<< 0.4.0 closure: findings, mutation smoke, WIP limit (end) <<<

  /**
   * Leases (`leases.ts`): minutes without a renewal before a lease is dead, and the exclusive zones. The `leases` block
   * of `swarm.json` on the integration branch, when present, wins (like `review`).
   */
  leases?: Partial<{ ttlMinutes: number; exclusive: string[] }>;

  /** Sandbox folder for throw-away experiments; nothing in the product may import from it. */
  playgroundDir: string;

  /** Paths that must be git-ignored (checked by `gitignore.test.ts`): caches that sneak into `wip:` commits. */
  mustBeGitignored: string[];

  /** Review gate of `land`. The `review` block of `swarm.json` on the integration branch, when present, wins. */
  review: ReviewConfig;
}

const defaults: Config = {
  projectName: 'myproject',
  envPrefix: 'MYPROJECT_',
  integrationBranch: 'main',
  remote: 'origin',

  installCommand: 'pnpm install --frozen-lockfile --prefer-offline',
  setupInstallCommand: ['pnpm', 'install', '--frozen-lockfile', '--silent'],
  lockfile: 'pnpm-lock.yaml',
  installMarker: 'node_modules/.modules.yaml',

  landMaxAttempts: 3,
  staleLockMinutes: 45,
  publisherFlag: 'myproject.publisher',
  hooksDir: '.githooks',

  verify: {
    logDir: 'tmp/verify',
    stepTimeoutMinutes: 30,
    killGraceMs: 3000,
    tailLines: 40,
    tmpMaxAgeMinutes: 60,
    // Tests use half the cores: with several sessions on the machine, a runner with every worker loses its own RPC
    // channel (onTaskUpdate timeouts).
    full: [
      { name: 'lint', cmd: 'pnpm -s lint' },
      // >>> 0.4.0 formatter (begin) >>>
      { name: 'format', cmd: 'pnpm -s biome format .' },
      // <<< 0.4.0 formatter (end) <<<
      { name: 'typecheck', cmd: 'pnpm -s typecheck' },
      { name: 'tsc app-a', cmd: 'npx tsc --noEmit -p apps/app-a' },
      { name: 'tsc app-b', cmd: 'npx tsc --noEmit -p apps/app-b' },
      // Domain contract validators, a first-class category of the gate: the project's own data (registries, tenant
      // configs, fixtures) checked against its schemas and cross-references. Specs (openspec) are one more validator.
      { name: 'validators', cmd: 'pnpm -s validate:registry && pnpm -s validate:config' },
      // A MODIFIED delta that omits scenarios breaks `openspec archive` once nobody remembers the change
      { name: 'openspec', cmd: 'pnpm -s exec openspec validate --all --no-interactive' },
      { name: 'tests + coverage', cmd: 'pnpm -s test:coverage --maxWorkers=50%', serial: true },
      // After the tests: the coverage ratchet reads the summary they just wrote. A rule without a mechanism erodes
      // (file size, coverage gap and lint budget all drifted with every gate green before this step existed).
      { name: 'ratchets', cmd: 'node scripts/dev/ratchets.ts', serial: true },
      // >>> 0.4.0 mutation smoke (begin) >>>
      // Related tests of the changed files must be able to fail; `--mode warn` until the survivors it reports are fixed
      { name: 'mutation smoke', cmd: 'node scripts/dev/mutation-smoke.ts --mode warn', serial: true },
      // <<< 0.4.0 mutation smoke (end) <<<
      // >>> 0.4.0 dependency gate (begin) >>>
      // Needs the network (the audit database); a known high/critical vulnerability does not wait for a convenient moment
      { name: 'deps', cmd: 'node scripts/dev/deps-audit.ts', serial: true },
      // <<< 0.4.0 dependency gate (end) <<<
    ],
    // Import-graph test selection misses tests that read YAML or templates without importing them: the quick tier
    // never closes a task.
    quick: [
      { name: 'lint', cmd: 'pnpm -s exec biome lint --no-errors-on-unmatched', appendChanged: /^(src|packages|apps|scripts)\/.*\.tsx?$/, first: true },
      { name: 'typecheck', cmd: 'pnpm -s typecheck' },
      // Only the file-size ratchet, only on changed files: coverage and the lint budget need the full run
      { name: 'file size', cmd: 'node scripts/dev/ratchets.ts --size-only', appendChanged: /\.(ts|tsx)$/, first: true },
      // >>> 0.4.0 silent errors and formatter (begin) >>>
      // Per file only: the recorded total is judged by the full run
      { name: 'silent errors', cmd: 'node scripts/dev/ratchets.ts --silent-only', appendChanged: /\.(ts|tsx|js|jsx|mjs|cjs)$/, first: true },
      { name: 'format', cmd: 'pnpm -s biome format --no-errors-on-unmatched', appendChanged: /\.(ts|tsx|js|jsx|mjs|cjs)$/, first: true },
      // <<< 0.4.0 silent errors and formatter (end) <<<
      { name: 'structural rules', cmd: 'pnpm -s test:arch', serial: true },
      { name: 'tsc app-a', cmd: 'npx tsc --noEmit -p apps/app-a', whenChanged: /^apps\/app-a\// },
      { name: 'tsc app-b', cmd: 'npx tsc --noEmit -p apps/app-b', whenChanged: /^apps\/app-b\// },
      { name: 'validators', cmd: 'pnpm -s validate:registry && pnpm -s validate:config', whenChanged: /^(registry|config)\// },
      { name: 'openspec', cmd: 'pnpm -s exec openspec validate --all --no-interactive', whenChanged: /^openspec\// },
      { name: 'affected tests', cmd: 'pnpm -s exec vitest run --changed {{integrationBranch}} --passWithNoTests', serial: true },
    ],
    optionalSuites: [{ name: 'database', envVar: 'MYPROJECT_TEST_DATABASE_URL', hint: '`pnpm dev:db` starts a test database' }],
    ensureFiles: [{ path: 'apps/app-a/next-env.d.ts', content: '/// <reference types="next" />\n/// <reference types="next/image-types/global" />\n' }],
  },

  tmpPrefix: 'myproject-',
  tmpRootEnvVars: ['MYPROJECT_ROOT', 'MYPROJECT_GLOBAL_ROOT'],
  looseTmpMaxAgeHours: 6,
  slowFirstPattern: /(\/scripts\/demo\.test\.ts|\.e2e\.test\.ts)$/,

  devToolPattern: 'node|tsx|vitest|next|next-server|esbuild',
  devToolArgsPattern: 'vitest|next|tsx',
  agentProcess: { command: 'claude', argsPattern: '@anthropic-ai/claude-code|/claude-code/' },
  portBase: 3200,
  portRange: 400,
  portServices: ['APP_A', 'APP_B'],
  worktreeEnvFile: '.claude/worktree.env',
  worktreeContainer: '.claude/worktrees',
  heavyServer: { command: 'next-server', maxCount: 3, maxRssKb: 3 * 1024 * 1024 },
  memory: { swapWarnPct: 75, mergedWorktreesWarn: 10, indexerWarnKb: 4 * 1024 * 1024 },

  adrDir: 'docs/adr',
  adrIndexMarkers: { start: '<!-- generated:adr-index -->', end: '<!-- /generated:adr-index -->' },
  adrStatusLabel: 'Status',
  adrDefaultStatus: 'Proposed',

  generatedFiles: /^apps\/[^/]+\/(tsconfig\.json|next-env\.d\.ts)$/,

  specsDir: 'openspec',
  roadmapFile: 'openspec/roadmap.yaml',
  changesDir: 'openspec/changes',

  audit: {
    dir: 'docs/audits',
    maxAgeDays: 14,
    bigFileLines: 500,
    nearDoneRatio: 0.9,
    envIgnore: /^(NODE_ENV|NODE_OPTIONS|CI|HOME|PATH|PORT|TMPDIR|VITEST|VITEST_.*|NEXT_.*|TZ|FORCE_COLOR|MYPROJECT_TEST_.*|GITHUB_.*|CLAUDE_.*|DEBUG|SHELL|USER)$/,
    envExampleFile: '.env.example',
    vitestConfigFile: 'vitest.config.ts',
    coverageSummaryFile: 'coverage/coverage-summary.json',
    lintJsonCmd: ['npx', 'biome', 'lint', '--reporter=json', '--max-diagnostics=10000'],
    auditHint: 'run the audit skill and `pnpm audit:repo`',
  },

  ratchets: { file: 'quality-ratchets.json', commitMessage: 'chore: tighten quality ratchets' },

  // >>> 0.4.0 formatter and dependency gate (begin) >>>
  format: { check: 'pnpm -s biome format .', quickCheck: 'pnpm -s biome format --no-errors-on-unmatched' },
  deps: { command: 'pnpm audit --prod --json', failOn: ['critical', 'high'], allowlistFile: 'deps-allowlist.json' },
  // <<< 0.4.0 formatter and dependency gate (end) <<<

  // >>> 0.4.0 closure: findings, mutation smoke, WIP limit (begin) >>>
  findings: { file: 'docs/audits/findings.jsonl', sla: { high: 2, medium: 14, low: 60 }, closureEvery: 3, hotFiles: { fixes: 3, days: 30 } },
  mutation: { command: 'pnpm vitest run {files}', mode: 'warn' },
  roadmap: { maxActive: 12, staleDays: 14 },
  // <<< 0.4.0 closure: findings, mutation smoke, WIP limit (end) <<<

  // Exclusive zones: contracts and schemas whose change invalidates other sessions' work. Keep the list short.
  leases: { ttlMinutes: 30, exclusive: ['**/migrations/**', '*.sql', 'src/shared/types/**', 'src/**/contracts/**'] },

  playgroundDir: 'playground',

  mustBeGitignored: ['tmp/generation-cache/example/abc.json'],

  // Paths where a defect costs money, data or trust, plus the gates themselves: a change touching any of them does not
  // land without a passing review receipt. Mirrors the `review` block of templates/swarm.json, for this layout.
  review: {
    mode: 'sensitive',
    sensitive: [
      '**/auth/**',
      '**/*auth*.*',
      '**/session*/**',
      '**/payments/**',
      '**/billing/**',
      '**/migrations/**',
      '*.sql',
      '.github/**',
      '.githooks/**',
      '.claude/**',
      'swarm.json',
      'scripts/dev/**',
      '**/vitest.config.*',
      '**/architecture.test.*',
      '**/docs.test.*',
      'biome.json',
      'quality-ratchets.json',
      'pnpm-lock.yaml',
    ],
  },
};

type Plain = Record<string, unknown>;
const isPlain = (v: unknown): v is Plain => typeof v === 'object' && v !== null && !Array.isArray(v) && !(v instanceof RegExp);

function merge(base: Plain, over: Plain): Plain {
  const out: Plain = { ...base };
  for (const [key, value] of Object.entries(over)) {
    const current = out[key];
    out[key] = isPlain(current) && isPlain(value) ? merge(current, value) : value;
  }
  return out;
}

function withOverride(base: Config, file: string | undefined): Config {
  if (!file) return base;
  const over: unknown = JSON.parse(readFileSync(file, 'utf8'));
  if (!isPlain(over)) throw new Error(`DEV_FLOW_CONFIG ${file} must hold a JSON object`);
  return merge(base as unknown as Plain, over) as unknown as Config;
}

export const config: Config = withOverride(defaults, process.env.DEV_FLOW_CONFIG);

/** Name of the environment variable that replaces the verification command (only for the land script's own tests). */
export const landVerifyEnv = `${config.envPrefix}LAND_VERIFY`;
