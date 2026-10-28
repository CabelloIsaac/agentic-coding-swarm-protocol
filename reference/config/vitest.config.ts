import { defineConfig } from 'vitest/config';
import SlowFirstSequencer from './test/sequencer.ts';

export default defineConfig({
  test: {
    // Each test file has its own TMPDIR (inherited by the child processes of end-to-end tests) and a startup sweep
    // removes what dead workers left (scripts/test-tmp.ts); `cleanup-tmp.ts` catches what children create.
    globalSetup: ['./scripts/vitest-global-setup.ts'],
    setupFiles: ['./scripts/vitest-setup.ts', './test/cleanup-tmp.ts'],
    // Slow files (end-to-end, app builds) first: without history they would otherwise start last and stretch the suite
    sequence: { sequencer: SlowFirstSequencer },
    // End-to-end tests run complete flows: leave room for loaded machines. Coverage instrumentation makes them ~3x slower.
    testTimeout: process.argv.includes('--coverage') ? 60_000 : 20_000,
    hookTimeout: process.argv.includes('--coverage') ? 60_000 : 10_000,
    coverage: {
      provider: 'v8',
      include: ['src/**/*.ts', 'apps/*/src/**/*.ts'],
      exclude: ['**/*.test.ts'],
      reporter: ['text-summary', 'html', 'json-summary'],
      reportOnFailure: true,
      // Floor set just below what was measured: it blocks regressions. It only ever goes up.
      thresholds: { lines: 86, statements: 86, functions: 86, branches: 79 },
    },
    include: ['src/**/*.test.ts', 'apps/**/*.test.ts', 'scripts/**/*.test.ts', 'test/**/*.test.ts'],
  },
});
