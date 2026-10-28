import { spawnSync } from 'node:child_process';
import { describe, expect, it } from 'vitest';
import { config } from './dev-flow.config.ts';
import { toplevel } from './git.ts';

const ROOT = toplevel(import.meta.dirname);

describe('.gitignore of runtime caches', () => {
  // The `wip:` safety-net commit runs `git add -A`: a cache that is not ignored sneaks into every wip commit
  it.each(config.mustBeGitignored)('%s is ignored', (path) => {
    const r = spawnSync('git', ['check-ignore', '-q', path], { cwd: ROOT });
    expect(r.status).toBe(0);
  });
});
