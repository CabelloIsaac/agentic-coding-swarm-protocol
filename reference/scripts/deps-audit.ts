/**
 * Dependency gate: a known vulnerability in a dependency is a defect with a clock on it, and it does not wait for a
 * convenient moment. In the reference project 21 known vulnerabilities sat open with every gate green, because nothing
 * ran the package manager's audit. This script runs it, normalizes the report and fails on `critical`/`high` unless the
 * advisory is in the allowlist with a reason, an owner and an expiry date. An expired entry fails again: an exception
 * is a loan, not a decision.
 *
 *   node deps-audit.ts            run `config.deps.command`, print one line per blocking advisory, exit 0/1
 *   node deps-audit.ts --json     the same as one JSON document on stdout ({ ok, blocking, allowed, notes })
 *
 * The full verify tier runs it as a serial step (`deps`). It needs the network (the audit database), so the quick
 * tier does not run it. If the command prints no JSON (offline, registry down) the gate FAILS: an audit that did not
 * run is not a clean audit.
 *
 * Config (`dev-flow.config.ts` → `deps`): `command` (default `pnpm audit --prod --json`), `failOn` (default
 * `['critical', 'high']`), `allowlistFile` (default `deps-allowlist.json`). Other stacks, same gate:
 *   npm      `npm audit --omit=dev --json`  → `{ vulnerabilities: { <pkg>: { severity, range, via: [{ source, url, title, severity }] } } }`
 *   pnpm     `pnpm audit --prod --json`     → `{ advisories: { <id>: { id, module_name, severity, title, vulnerable_versions, github_advisory_id } } }`
 *   pip      `pip-audit -f json`            → `{ dependencies: [{ name, version, vulns: [{ id, aliases, description }] }] }`
 *   cargo    `cargo audit --json`           → `{ vulnerabilities: { list: [{ advisory: { id, title, cvss? }, package: { name, version } }] } }`
 *   generic  anything else, through a wrapper that prints `{ vulnerabilities: [{ id, severity, package, title, range? }] }`
 * pip-audit and cargo-audit reports carry no severity: an advisory without one is treated as `high` (fail closed).
 *
 * The allowlist (`deps-allowlist.json`, template in templates/) maps an advisory id (GHSA-…, CVE-…, or the number the
 * package manager prints) or `package@range` (`lodash@<4.17.21`, exactly the range the report prints; `package@*` for
 * any) to `{ reason, expires: "YYYY-MM-DD", owner }`. Keys starting with `_`, and `//`, are ignored (JSON has no comments).
 *
 * No dependencies beyond `node:*`.
 */
import { execFileSync, spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';

export type Severity = 'critical' | 'high' | 'moderate' | 'low' | 'unknown';

export interface Advisory {
  /** Preferred id first (GHSA/CVE when the report has one); the others are aliases the allowlist may use. */
  ids: string[];
  severity: Severity;
  package: string;
  /** Vulnerable range as the report prints it, when it does. */
  range?: string;
  title: string;
}

export interface AllowEntry {
  reason: string;
  expires: string;
  owner: string;
}

export type Allowlist = Record<string, AllowEntry>;

export interface Verdict {
  advisory: Advisory;
  /** Why it blocks: no entry, an expired one or a malformed one. */
  why: string;
}

export interface Evaluation {
  blocking: Verdict[];
  /** Failing-severity advisories covered by a valid entry. */
  allowed: { advisory: Advisory; key: string; entry: AllowEntry }[];
  /** Entries that cover nothing any more (remove them). Informational. */
  notes: string[];
}

// ───────────────────────────── pure parts (tested) ─────────────────────────────

export function normalizeSeverity(raw: unknown): Severity {
  const s = String(raw ?? '').toLowerCase();
  if (s === 'critical' || s === 'high' || s === 'low') return s;
  if (s === 'moderate' || s === 'medium') return 'moderate';
  return 'unknown';
}

const unique = (xs: (string | undefined)[]) => [...new Set(xs.filter((x): x is string => Boolean(x)))];
const ghsa = (url: unknown) => /GHSA-[0-9a-z]{4}-[0-9a-z]{4}-[0-9a-z]{4}/i.exec(String(url ?? ''))?.[0];

type Json = Record<string, unknown>;
const obj = (v: unknown): Json => (typeof v === 'object' && v !== null && !Array.isArray(v) ? (v as Json) : {});
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);

/** Reads any of the supported shapes (see the header). Throws when the text is none of them. */
export function parseAudit(text: string): Advisory[] {
  const start = [text.indexOf('{'), text.indexOf('[')].filter((i) => i >= 0);
  if (!start.length) throw new Error('the audit command printed no JSON');
  const root = obj(JSON.parse(text.slice(Math.min(...start))));
  const out: Advisory[] = [];

  // generic: { vulnerabilities: [{ id, severity, package, title }] }
  if (Array.isArray(root.vulnerabilities)) {
    for (const v of root.vulnerabilities.map(obj))
      out.push({ ids: unique([String(v.id ?? ''), ...arr(v.aliases).map(String)]), severity: normalizeSeverity(v.severity), package: String(v.package ?? 'unknown'), range: v.range ? String(v.range) : undefined, title: String(v.title ?? '') });
    return out;
  }
  // pnpm (and npm 6): { advisories: { <id>: { … } } }
  if (root.advisories) {
    for (const a of Object.values(obj(root.advisories)).map(obj))
      out.push({ ids: unique([a.github_advisory_id as string | undefined, ...arr(a.cves).map(String), String(a.id ?? '')]), severity: normalizeSeverity(a.severity), package: String(a.module_name ?? 'unknown'), range: a.vulnerable_versions ? String(a.vulnerable_versions) : undefined, title: String(a.title ?? '') });
    return out;
  }
  // cargo audit: { vulnerabilities: { list: [{ advisory, package }] } }
  if ('list' in obj(root.vulnerabilities)) {
    for (const v of arr(obj(root.vulnerabilities).list).map(obj)) {
      const adv = obj(v.advisory);
      out.push({ ids: unique([String(adv.id ?? ''), ...arr(adv.aliases).map(String)]), severity: normalizeSeverity(adv.severity), package: String(obj(v.package).name ?? adv.package ?? 'unknown'), title: String(adv.title ?? '') });
    }
    return out;
  }
  // npm 7+: { vulnerabilities: { <pkg>: { severity, range, via: [string | { source, url, title, severity, range }] } } }
  if (root.vulnerabilities) {
    for (const [name, raw] of Object.entries(obj(root.vulnerabilities))) {
      const v = obj(raw);
      // `via` holds either the advisories themselves or the names of packages that carry them; only the former are advisories
      const direct = arr(v.via).filter((x) => typeof x === 'object' && x !== null).map(obj);
      for (const d of direct)
        out.push({ ids: unique([ghsa(d.url), d.source === undefined ? undefined : String(d.source)]), severity: normalizeSeverity(d.severity ?? v.severity), package: String(d.name ?? name), range: d.range ? String(d.range) : undefined, title: String(d.title ?? '') });
    }
    return out;
  }
  // pip-audit: { dependencies: [{ name, version, vulns: [{ id, aliases, description }] }] }
  if (Array.isArray(root.dependencies)) {
    for (const d of root.dependencies.map(obj))
      for (const v of arr(d.vulns).map(obj)) out.push({ ids: unique([String(v.id ?? ''), ...arr(v.aliases).map(String)]), severity: normalizeSeverity(v.severity), package: String(d.name ?? 'unknown'), title: String(v.description ?? '').slice(0, 120) });
    return out;
  }
  // A clean `npm audit` still prints `metadata`; a document with no known key is not a report
  if ('metadata' in root) return out;
  throw new Error('unrecognized audit report: expected npm/pnpm, pip-audit, cargo-audit or { vulnerabilities: [...] } JSON');
}

const keyed = (a: Advisory) => [...a.ids, `${a.package}@${a.range ?? '*'}`, `${a.package}@*`];

function validEntry(e: unknown): e is AllowEntry {
  const x = obj(e);
  return typeof x.reason === 'string' && x.reason.trim() !== '' && typeof x.owner === 'string' && x.owner.trim() !== '' && typeof x.expires === 'string' && /^\d{4}-\d{2}-\d{2}$/.test(x.expires) && !Number.isNaN(Date.parse(x.expires));
}

/** `now` is a `YYYY-MM-DD` date: an entry is valid through its `expires` day, inclusive. */
export function evaluate(advisories: Advisory[], allowlist: Allowlist, failOn: string[], now: string): Evaluation {
  const entries = Object.entries(allowlist).filter(([k]) => !k.startsWith('_') && k !== '//');
  const used = new Set<string>();
  const out: Evaluation = { blocking: [], allowed: [], notes: [] };
  for (const advisory of advisories) {
    // Unknown severity (pip-audit, cargo-audit) fails closed as `high`
    const severity = advisory.severity === 'unknown' ? 'high' : advisory.severity;
    if (!failOn.includes(severity)) continue;
    const hit = entries.find(([k]) => keyed(advisory).includes(k));
    if (!hit) {
      out.blocking.push({ advisory, why: 'no allowlist entry' });
      continue;
    }
    const [key, entry] = hit;
    used.add(key);
    if (!validEntry(entry)) out.blocking.push({ advisory, why: `allowlist entry invalid (${key}: needs reason, owner and expires YYYY-MM-DD)` });
    else if (entry.expires < now) out.blocking.push({ advisory, why: `allowlist entry expired ${entry.expires} (${key}, owner ${entry.owner}): fix the dependency or renew it with a new reason` });
    else out.allowed.push({ advisory, key, entry });
  }
  for (const [key] of entries) if (!used.has(key)) out.notes.push(`allowlist entry ${key} matches no blocking advisory: remove it`);
  return out;
}

export const describe = ({ advisory: a, why }: Verdict): string => `${a.severity === 'unknown' ? 'high?' : a.severity} ${a.ids[0] ?? 'no-id'} ${a.package}${a.range ? ` ${a.range}` : ''}: ${a.title || 'no title'} [${why}]`;

// ───────────────────────────── CLI ─────────────────────────────

const today = () => new Date().toISOString().slice(0, 10);

export function main(argv: string[], cwd = process.cwd(), log: (line: string) => void = console.log, now = today()): number {
  const json = argv.includes('--json');
  let root = cwd;
  try {
    root = execFileSync('git', ['rev-parse', '--show-toplevel'], { cwd, encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch {
    // not a git checkout: the working directory is the project
  }
  const { command, failOn, allowlistFile } = config.deps;
  const fail = (message: string) => {
    log(json ? JSON.stringify({ ok: false, error: message }) : `✗ deps: ${message}`);
    return 1;
  };

  // The exit code is ignored: audit tools exit non-zero precisely when they found something
  const r = spawnSync('sh', ['-c', command], { cwd: root, encoding: 'utf8', maxBuffer: 256 * 1024 * 1024, env: { ...process.env, FORCE_COLOR: '0', NO_COLOR: '1' } });
  let advisories: Advisory[];
  try {
    advisories = parseAudit(r.stdout ?? '');
  } catch (e) {
    const tail = (r.stderr ?? '').trim().split('\n').slice(-3).join(' | ');
    return fail(`${(e as Error).message} (\`${command}\`, exit ${r.status}${tail ? `; ${tail}` : ''}): an audit that did not run is not a clean audit`);
  }

  const path = join(root, allowlistFile);
  let allowlist: Allowlist = {};
  if (existsSync(path)) {
    try {
      allowlist = obj(JSON.parse(readFileSync(path, 'utf8'))) as Allowlist;
    } catch (e) {
      return fail(`${allowlistFile} is not valid JSON: ${(e as Error).message}`);
    }
  }

  const ev = evaluate(advisories, allowlist, failOn, now);
  if (json) {
    log(JSON.stringify({ ok: ev.blocking.length === 0, advisories: advisories.length, blocking: ev.blocking.map((v) => ({ ...v.advisory, why: v.why })), allowed: ev.allowed.map((a) => ({ ...a.advisory, key: a.key, ...a.entry })), notes: ev.notes }, null, 2));
    return ev.blocking.length ? 1 : 0;
  }
  for (const v of ev.blocking) log(`✗ deps: ${describe(v)}`);
  for (const a of ev.allowed) log(`  deps: allowed ${a.advisory.ids[0] ?? a.advisory.package} until ${a.entry.expires} (owner ${a.entry.owner}): ${a.entry.reason}`);
  for (const n of ev.notes) log(`  deps: ${n}`);
  const n = ev.blocking.length;
  log(n ? `✗ deps: ${n} blocking advisor${n === 1 ? 'y' : 'ies'} (fail on ${failOn.join(', ')})` : `✓ deps: ${advisories.length} advisor${advisories.length === 1 ? 'y' : 'ies'}, none blocking (fail on ${failOn.join(', ')})`);
  return n ? 1 : 0;
}

if (import.meta.main) process.exit(main(process.argv.slice(2)));
