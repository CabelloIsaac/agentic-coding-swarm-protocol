#!/usr/bin/env node
// Free structural check of the eval suite (`claude plugin eval` costs model calls; this costs nothing): every case
// loads (known frontmatter keys, at least one grader, known grader types with their required options, regexes that
// compile, scaffold scripts that exist), case names are unique, and every core skill keeps its trigger coverage
// (at least 3 positive and 2 negative prompts). Format: https://code.claude.com/docs/en/plugin-evals
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, join, relative } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const EVALS = join(ROOT, 'evals');
const CORE = ['verify', 'review', 'debug', 'tdd', 'worktree', 'change', 'extend', 'land', 'playbook'];
const PROMPT_KEYS = new Set(['schema_version', 'name', 'description', 'tags', 'plugins', 'runs', 'expected_outcome', 'model', 'max_turns', 'timeout_seconds', 'allowed_tools', 'append_system_prompt', 'env']);
const REQUIRED = { regex: ['pattern'], tool_used: ['tool'], tool_order: ['before', 'after'], file_exists: ['path'], llm: [], baseline: ['baseline_file'] };
const COMMON = new Set(['type', 'weight', 'arm']);
const OPTIONS = { regex: ['pattern', 'flags', 'match', 'target'], tool_used: ['tool', 'input_match', 'min', 'max'], tool_order: ['before', 'after'], file_exists: ['path', 'exists'], llm: ['criteria', 'focus'], baseline: ['baseline_file', 'criteria'] };

/** `---` frontmatter as flat `key → raw value` plus the body. Enough for this suite's one-line values. */
function frontmatter(text) {
  const m = /^---\n([\s\S]*?)\n---\n?([\s\S]*)$/.exec(text);
  if (!m) return { keys: {}, body: text };
  const keys = {};
  for (const line of m[1].split('\n')) {
    const kv = /^([a-z_]+):\s*(.*)$/.exec(line);
    if (kv) keys[kv[1]] = kv[2];
  }
  return { keys, body: m[2].trim() };
}

const unquote = (v) => (/^'.*'$/.test(v) ? v.slice(1, -1).replaceAll("''", "'") : /^".*"$/.test(v) ? JSON.parse(v) : v);
const list = (v) => (v ?? '').replace(/^\[|\]$/g, '').split(',').map((s) => s.trim()).filter(Boolean);

const problems = [];
const names = new Map();
const coverage = Object.fromEntries(CORE.map((s) => [s, { positive: 0, negative: 0 }]));

const dirs = (dir) => readdirSync(dir).filter((n) => n !== 'results' && statSync(join(dir, n)).isDirectory()).map((n) => join(dir, n));
function walk(dir) {
  const isCase = existsSync(join(dir, 'prompt.md')) || existsSync(join(dir, 'case.yaml'));
  if (isCase) return checkCase(dir);
  for (const d of dirs(dir)) walk(d);
}

function checkCase(dir) {
  const rel = relative(ROOT, dir);
  const name = basename(dir);
  if (names.has(name)) problems.push(`${rel}: case name also used by ${names.get(name)}`);
  names.set(name, rel);
  let tags = [];
  if (existsSync(join(dir, 'prompt.md'))) {
    const { keys, body } = frontmatter(readFileSync(join(dir, 'prompt.md'), 'utf8'));
    for (const k of Object.keys(keys)) if (!PROMPT_KEYS.has(k)) problems.push(`${rel}/prompt.md: unknown frontmatter key ${k}`);
    if (!body) problems.push(`${rel}/prompt.md: empty prompt`);
    tags = list(keys.tags);
  }
  if (existsSync(join(dir, 'case.yaml'))) {
    const yaml = readFileSync(join(dir, 'case.yaml'), 'utf8');
    if (!/^schema_version: "1\.1"$/m.test(yaml)) problems.push(`${rel}/case.yaml: needs schema_version: "1.1"`);
    if (!new RegExp(`^name: ${name}$`, 'm').test(yaml)) problems.push(`${rel}/case.yaml: name must be ${name}`);
    const script = /^\s+scaffold_script:\s*(\S+)$/m.exec(yaml)?.[1];
    if (script && !existsSync(join(dir, script))) problems.push(`${rel}/case.yaml: missing scaffold ${script}`);
  }
  const graderDir = join(dir, 'graders');
  const graders = existsSync(graderDir) ? readdirSync(graderDir).filter((f) => f.endsWith('.md')) : [];
  if (!graders.length) problems.push(`${rel}: no grader`);
  for (const g of graders) {
    const { keys, body } = frontmatter(readFileSync(join(graderDir, g), 'utf8'));
    const where = `${rel}/graders/${g}`;
    const type = keys.type;
    if (!(type in REQUIRED)) {
      problems.push(`${where}: unknown type ${type}`);
      continue;
    }
    for (const k of REQUIRED[type]) if (!(k in keys)) problems.push(`${where}: ${type} needs ${k}`);
    for (const k of Object.keys(keys)) if (!COMMON.has(k) && !OPTIONS[type].includes(k)) problems.push(`${where}: ${type} does not take ${k}`);
    if (type === 'llm' && !body && !keys.criteria) problems.push(`${where}: llm grader without criteria`);
    for (const k of ['pattern', 'input_match']) {
      if (!(k in keys)) continue;
      try {
        new RegExp(unquote(keys[k]));
      } catch (e) {
        problems.push(`${where}: ${k} does not compile (${e.message})`);
      }
    }
  }
  if (tags.includes('trigger')) {
    const skill = tags.find((t) => CORE.includes(t));
    if (!skill) problems.push(`${rel}: trigger case without a core skill tag`);
    else if (tags.includes('positive')) coverage[skill].positive++;
    else if (tags.includes('negative')) coverage[skill].negative++;
    else problems.push(`${rel}: trigger case must be tagged positive or negative`);
  }
}

if (!existsSync(EVALS)) problems.push('evals/ is missing');
else walk(EVALS);
for (const [skill, c] of Object.entries(coverage)) {
  if (!existsSync(join(ROOT, 'skills', skill, 'SKILL.md'))) problems.push(`skill ${skill} has trigger cases but no skills/${skill}/SKILL.md`);
  if (c.positive < 3 || c.negative < 2) problems.push(`skill ${skill}: ${c.positive} positive / ${c.negative} negative trigger cases (need 3 / 2)`);
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${problems.length} problem(s) in the eval suite`);
  process.exit(1);
}
console.log(`✓ ${names.size} eval cases load; trigger coverage ok for ${CORE.length} skills`);
