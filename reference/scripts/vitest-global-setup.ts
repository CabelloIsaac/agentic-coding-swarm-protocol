import { tmpdir } from 'node:os';
import { sweepTestTmp } from './test-tmp.ts';

// Collect the temp files of interrupted runs before creating new ones (see test-tmp.ts)
export default function setup(): void {
  const { removed } = sweepTestTmp(tmpdir());
  if (removed) console.log(`[test-tmp] ${removed} temp entries from earlier runs deleted from ${tmpdir()}`);
}
