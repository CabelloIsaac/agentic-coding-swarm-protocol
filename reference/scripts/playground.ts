// pnpm playground:new <slug>: creates <playgroundDir>/<YYYY-MM-DD>-<slug>/ with the four-section README that the
// playground rules ask for. It never overwrites an existing experiment.
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';
import { toplevel } from './git.ts';

const SLUG = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

export class PlaygroundError extends Error {}

/** Local date YYYY-MM-DD: the folder carries the day the experiment starts. */
export const playgroundDate = (d: Date) =>
  `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;

export function playgroundReadme(slug: string, date: string): string {
  return [
    `# ${slug} (${date})`,
    '',
    '## Question',
    '',
    '_What we want to find out._',
    '',
    '## What was tried',
    '',
    '_Libraries, versions, data (mock or replayed; nothing real from customers) and spending, if any._',
    '',
    '## Result',
    '',
    '## Conclusion',
    '',
    '_Discarded, or the change that takes it into the system._',
    '',
  ].join('\n');
}

/** Creates the experiment folder and returns its path. */
export function newPlayground(root: string, slug: string, date = new Date()): string {
  if (!SLUG.test(slug)) throw new PlaygroundError(`"${slug}" is not a valid name: lowercase letters, digits and hyphens (e.g. try-new-bundler)`);
  const day = playgroundDate(date);
  const dir = join(root, config.playgroundDir, `${day}-${slug}`);
  if (existsSync(dir)) throw new PlaygroundError(`${dir} already exists: pick another name or continue in that experiment`);
  mkdirSync(dir, { recursive: true });
  writeFileSync(join(dir, 'README.md'), playgroundReadme(slug, day));
  return dir;
}

if (import.meta.main) {
  const [cmd, slug] = process.argv.slice(2);
  if (cmd !== 'new' || !slug) {
    console.error('Usage: pnpm playground:new <slug>');
    process.exit(2);
  }
  try {
    const dir = newPlayground(toplevel(process.cwd()), slug);
    console.log(`✓ ${dir}\n  Fill in the README (Question, What was tried, Result, Conclusion). The rules are in ${config.playgroundDir}/README.md.`);
  } catch (e) {
    if (!(e instanceof PlaygroundError)) throw e;
    console.error(`✗ ${e.message}`);
    process.exit(1);
  }
}
