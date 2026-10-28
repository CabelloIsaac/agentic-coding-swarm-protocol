import { mkdtempSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll } from 'vitest';
import { TEST_TMP_PREFIX } from './test-tmp.ts';

// Each test file writes its temp files into a directory of its own that is deleted when it finishes (see test-tmp.ts).
// `os.tmpdir()` reads TMPDIR on every call, so changing it before the test file is imported is enough; child
// processes spawned by end-to-end tests inherit it.
const base = tmpdir();
const dir = mkdtempSync(join(base, `${TEST_TMP_PREFIX}${process.pid}-`));
process.env.TMPDIR = dir;

afterAll(() => {
  // The worker is reused for other files: restore TMPDIR before deleting
  process.env.TMPDIR = base;
  rmSync(dir, { recursive: true, force: true, maxRetries: 3 });
});
