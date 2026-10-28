#!/usr/bin/env node
// Fails if a Markdown file links to a relative path that does not exist, cites a repo path in backticks that does
// not exist, or a skill references a missing file through ${CLAUDE_SKILL_DIR}. Code fences are ignored.
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const SKIP = new Set(['.git', 'node_modules']);
// `scripts/dev/…` names the adopting project's own tooling, not a file in this repo.
const CITED = /`((?:templates|reference|manual|checklists|skills|agents|hooks|scripts(?!\/dev\/))\/[^`\s*<>]+)`/g;

const walk = (dir) =>
  readdirSync(dir).flatMap((name) => {
    if (SKIP.has(name)) return [];
    const path = join(dir, name);
    return statSync(path).isDirectory() ? walk(path) : name.endsWith('.md') ? [path] : [];
  });

const problems = [];
for (const file of walk(ROOT)) {
  const text = readFileSync(file, 'utf8').replace(/```[\s\S]*?```/g, '');
  const rel = relative(ROOT, file);
  for (const [, link] of text.matchAll(/\]\(([^)#\s]+)(?:#[^)]*)?\)/g)) {
    if (/^[a-z]+:/i.test(link) || link.startsWith('<')) continue;
    if (!existsSync(join(dirname(file), link))) problems.push(`${rel}: broken link → ${link}`);
  }
  for (const [, path] of text.matchAll(CITED)) {
    if (!existsSync(join(ROOT, path.replace(/\/$/, '')))) problems.push(`${rel}: missing path → ${path}`);
  }
  for (const [, path] of text.matchAll(/\$\{CLAUDE_SKILL_DIR\}\/([^`\s)]+)/g)) {
    if (!existsSync(join(dirname(file), path))) problems.push(`${rel}: missing skill file → ${path}`);
  }
}

if (problems.length) {
  console.error(problems.join('\n'));
  console.error(`\n✗ ${problems.length} problem(s)`);
  process.exit(1);
}
console.log('✓ all links and cited paths resolve');
