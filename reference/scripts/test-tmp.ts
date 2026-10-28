/**
 * Temp files of the tests. End-to-end tests create roots with `mkdtempSync(tmpdir())` and copy fixtures into each one;
 * without cleanup, a full run leaves gigabytes in `$TMPDIR` and several parallel sessions fill the disk.
 *
 * - `vitest-setup.ts` (setupFiles) gives each test file its own `TMPDIR` and deletes it when done: it bounds the peak
 *   to the work in progress without touching the tests.
 * - `vitest-global-setup.ts` sweeps at startup whatever interrupted runs left behind (Ctrl-C, full disk, crash).
 */
import { readdirSync, rmSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { config } from './dev-flow.config.ts';

/** Per-test-file directory: `<tmpPrefix>vitest-<worker pid>-XXXXXX`. */
export const TEST_TMP_PREFIX = `${config.tmpPrefix}vitest-`;
/** Loose roots from before per-file dirs, or from the CLI: `<tmpPrefix><label>-XXXXXX`. */
const LOOSE_ROOT = new RegExp(`^${config.tmpPrefix.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}[a-z0-9-]+-[A-Za-z0-9]{6}$`, 'i');
/** A loose root this old belongs to no live run. */
export const LOOSE_MAX_AGE_MS = config.looseTmpMaxAgeHours * 60 * 60 * 1000;

export function pidAlive(pid: number): boolean {
  try {
    process.kill(pid, 0);
    return true;
  } catch (err) {
    // EPERM: it exists but belongs to another user
    return (err as NodeJS.ErrnoException).code === 'EPERM';
  }
}

/** What the sweep would delete in `base`: temp dirs of dead workers and expired loose roots. */
export function staleTestTmp(base: string, now = Date.now(), alive = pidAlive): string[] {
  const stale: string[] = [];
  const owner = new RegExp(`^${TEST_TMP_PREFIX.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(\\d+)-`);
  for (const name of readdirSync(base)) {
    if (!name.startsWith(config.tmpPrefix)) continue;
    const owned = name.startsWith(TEST_TMP_PREFIX) ? owner.exec(name) : null;
    if (owned) {
      if (!alive(Number(owned[1]))) stale.push(name);
    } else if (LOOSE_ROOT.test(name) && ageMs(join(base, name), now) > LOOSE_MAX_AGE_MS) {
      stale.push(name);
    }
  }
  return stale;
}

export function sweepTestTmp(base: string, now = Date.now(), alive = pidAlive): { removed: number } {
  const stale = staleTestTmp(base, now, alive);
  for (const name of stale) rmSync(join(base, name), { recursive: true, force: true, maxRetries: 3 });
  return { removed: stale.length };
}

function ageMs(path: string, now: number): number {
  try {
    return now - statSync(path).mtimeMs;
  } catch {
    return 0;
  }
}
