/**
 * Global vitest setup: deletes the temporary `<tmpPrefix>*` roots that tests create.
 * It intercepts `fs.mkdtempSync` to record every `<tmpPrefix>*` folder created in the temp directory and deletes them
 * when each test file ends (and on process exit, in case the worker dies). It also sweeps the root that the
 * configured environment variables point at when it is a temporary `<tmpPrefix>*` folder (helpers that create a fresh
 * root per test reassign the variable without going through mkdtempSync).
 * This way no new test can leave garbage in $TMPDIR without anyone noticing.
 */
import fs, { rmSync } from 'node:fs';
import { syncBuiltinESMExports } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, resolve } from 'node:path';
import { afterAll, afterEach } from 'vitest';
import { config } from '../scripts/dev-flow.config.ts';

const created = new Set<string>();
const ROOT_VARS: readonly string[] = config.tmpRootEnvVars;

/** The top-level `<tmpPrefix>*` folder under the temp directory that contains `path`, or null. */
function tmpTop(path: string | undefined): string | null {
  if (!path) return null;
  const base = resolve(tmpdir());
  let p = resolve(path);
  while (dirname(p) !== p && dirname(p) !== base) p = dirname(p);
  return dirname(p) === base && p.slice(base.length + 1).startsWith(config.tmpPrefix) ? p : null;
}

/** Records the current root (helpers change the variable on every test without going through mkdtempSync). */
function record(): void {
  for (const key of ROOT_VARS) {
    const top = tmpTop(process.env[key]);
    if (top) created.add(top);
  }
}

function sweep(): void {
  record();
  for (const dir of created) rmSync(dir, { recursive: true, force: true });
  created.clear();
}

const g = globalThis as { __devFlowTmpPatched?: boolean };
if (!g.__devFlowTmpPatched) {
  g.__devFlowTmpPatched = true;
  const original = fs.mkdtempSync;
  // biome-ignore lint/suspicious/noExplicitAny: mkdtempSync has overloads; the arguments are only forwarded
  fs.mkdtempSync = ((...args: any[]) => {
    // biome-ignore lint/suspicious/noExplicitAny: same as above
    const dir = (original as any)(...args) as string | Buffer;
    const top = tmpTop(typeof dir === 'string' ? dir : dir.toString());
    if (top) created.add(top);
    return dir;
  }) as typeof fs.mkdtempSync;
  syncBuiltinESMExports();
  // Record every root assigned to the variables, not only the last one (helpers reassign them several times)
  process.env = new Proxy(process.env, {
    set(target, key, value) {
      target[key as string] = value;
      if (ROOT_VARS.includes(key as string)) {
        const top = tmpTop(String(value));
        if (top) created.add(top);
      }
      return true;
    },
  });
  process.on('exit', sweep);
}

afterEach(record);
afterAll(sweep);
