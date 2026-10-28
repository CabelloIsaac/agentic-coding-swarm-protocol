/**
 * Order of the test files: slow ones first. Without vitest history (a fresh worktree has none) files are ordered by
 * size, and a tiny file that compiles two apps and takes minutes would start almost last and stretch every
 * `pnpm land` with a single busy worker.
 */
import { BaseSequencer, type TestSpecification } from 'vitest/node';
import { config } from '../scripts/dev-flow.config.ts';

/** Files that start servers or full runs: always first, in the order vitest gives them. */
export const isSlowFirst = (moduleId: string) => config.slowFirstPattern.test(moduleId);

export function slowFirst<T extends { moduleId: string }>(files: T[]): T[] {
  return [...files.filter((f) => isSlowFirst(f.moduleId)), ...files.filter((f) => !isSlowFirst(f.moduleId))];
}

export default class SlowFirstSequencer extends BaseSequencer {
  override async sort(files: TestSpecification[]): Promise<TestSpecification[]> {
    return slowFirst(await super.sort(files));
  }
}
