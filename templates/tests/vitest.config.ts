import { defineConfig } from 'vitest/config';
import { SlowFirstSequencer } from './test/sequencer.ts';

const coverage = process.argv.includes('--coverage');

export default defineConfig({
  test: {
    // Temp-file cleanup: a sweep at startup (dead workers) and a dedicated TMPDIR per file.
    globalSetup: ['./scripts/dev/vitest-global-setup.ts'],
    setupFiles: ['./scripts/dev/vitest-setup.ts'],
    // e2e and demo tests first: a fresh worktree has no timing history, and the slowest one used to start last.
    sequence: { sequencer: SlowFirstSequencer },
    testTimeout: coverage ? 60_000 : 20_000,
    hookTimeout: coverage ? 60_000 : 10_000,
    // A forgotten .only cannot be integrated.
    allowOnly: !process.env.CI,
    include: ['src/**/*.test.ts', 'scripts/**/*.test.ts'],
    coverage: {
      provider: 'v8',
      reportOnFailure: true,
      reporter: ['text-summary', 'html', 'json-summary'],
      include: ['src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      // Floor just below what was measured on <date> (<x>% lines, <y>% branches): blocks regressions.
      // If your change raises coverage, raise the floor in the same commit. It never goes down.
      thresholds: { lines: 80, statements: 80, functions: 80, branches: 70 },
    },
  },
});
