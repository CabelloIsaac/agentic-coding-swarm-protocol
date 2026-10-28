/**
 * Conflict-free ADRs across branches: the index in `<adrDir>/README.md` is generated from the files, and a new ADR is
 * born as `draft-<slug>.md` and receives its number when it is integrated (`pnpm land`), not when it is created.
 *
 *   node scripts/adr.ts index    regenerate the index
 *   node scripts/adr.ts number   number the drafts (land does it after the rebase)
 */
import { readFileSync, readdirSync, renameSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';
import { git } from './git.ts';

const ADR_DIR = config.adrDir;
const START = config.adrIndexMarkers.start;
const END = config.adrIndexMarkers.end;
const NUMBERED = /^(\d{4})-(.+)\.md$/;
const DRAFT = /^draft-(.+)\.md$/;
const TEXT = /\.(md|ts|tsx|yaml|yml|json)$/;
const STATUS_LINE = new RegExp(`^- ${config.adrStatusLabel}:\\s*(.+)$`, 'm');

export interface AdrEntry {
  number: string;
  file: string;
  title: string;
  status: string;
}

export function readAdrs(root: string): AdrEntry[] {
  return readdirSync(join(root, ADR_DIR))
    .filter((f) => NUMBERED.test(f))
    .sort()
    .map((file) => {
      const text = readFileSync(join(root, ADR_DIR, file), 'utf8');
      const heading = text.split('\n').find((l) => l.startsWith('# ')) ?? '';
      const status = STATUS_LINE.exec(text)?.[1]?.trim() ?? config.adrDefaultStatus;
      return { number: file.slice(0, 4), file, title: heading.replace(/^# ADR-\d{4}\s*[—-]\s*/, '').trim(), status };
    });
}

export function adrIndexBlock(adrs: AdrEntry[]): string {
  const rows = adrs.map((a) => `| [${a.number}](${a.file}) | ${a.title} | ${a.status} |`);
  return [START, '| ADR | Title | Status |', '|---|---|---|', ...rows, END].join('\n');
}

/** Replaces the generated index block. Returns `true` if the file changed. */
export function updateAdrIndex(root: string): boolean {
  const file = join(root, ADR_DIR, 'README.md');
  const text = readFileSync(file, 'utf8');
  const start = text.indexOf(START);
  const end = text.indexOf(END);
  if (start < 0 || end < start) throw new Error(`${file} does not have the markers ${START} … ${END}`);
  const next = text.slice(0, start) + adrIndexBlock(readAdrs(root)) + text.slice(end + END.length);
  if (next === text) return false;
  writeFileSync(file, next);
  return true;
}

export interface Renumbered {
  from: string;
  to: string;
  id: string;
}

/**
 * Gives each `draft-<slug>.md` the next free number and rewrites its references (`ADR-draft-<slug>` → `ADR-00NN`,
 * `draft-<slug>.md` → `00NN-<slug>.md`) in the versioned text files.
 */
export function numberDraftAdrs(root: string): Renumbered[] {
  const files = readdirSync(join(root, ADR_DIR));
  const drafts = files.filter((f) => DRAFT.test(f)).sort();
  if (drafts.length === 0) return [];
  let next = Math.max(0, ...files.map((f) => Number(NUMBERED.exec(f)?.[1] ?? 0)));
  const done = drafts.map((from) => {
    const slug = DRAFT.exec(from)?.[1] ?? '';
    const id = String(++next).padStart(4, '0');
    return { from, to: `${id}-${slug}.md`, id, slug };
  });
  for (const d of done) renameSync(join(root, ADR_DIR, d.from), join(root, ADR_DIR, d.to));
  // Longest slug first: `draft-a` must not rewrite part of `draft-a-b`
  const bySlugLength = [...done].sort((a, b) => b.slug.length - a.slug.length);
  const tracked = git(root, 'ls-files').split('\n').filter((f) => TEXT.test(f));
  for (const f of [...tracked, ...done.map((d) => `${ADR_DIR}/${d.to}`)]) {
    let text: string;
    try {
      text = readFileSync(join(root, f), 'utf8');
    } catch {
      continue; // deleted in the working tree
    }
    let out = text;
    for (const d of bySlugLength) out = out.replaceAll(`ADR-draft-${d.slug}`, `ADR-${d.id}`).replaceAll(d.from, d.to);
    // The ADR's own heading: `# ADR-draft — Title` becomes `# ADR-NNNN — Title`
    const own = done.find((d) => f === `${ADR_DIR}/${d.to}`);
    if (own) out = out.replace(/^# ADR-draft\b/m, `# ADR-${own.id}`);
    if (out !== text) writeFileSync(join(root, f), out);
  }
  return done.map(({ from, to, id }) => ({ from, to, id }));
}

if (import.meta.main) {
  const root = git(process.cwd(), 'rev-parse', '--show-toplevel');
  const cmd = process.argv[2];
  if (cmd === 'index') console.log(updateAdrIndex(root) ? 'ADR index regenerated' : 'ADR index up to date');
  else if (cmd === 'number') {
    const done = numberDraftAdrs(root);
    for (const d of done) console.log(`${d.from} → ${d.to}`);
    if (done.length) updateAdrIndex(root);
  } else {
    console.error('usage: node scripts/adr.ts index|number');
    process.exit(2);
  }
}
