// Self-test of the plugin's PostToolUse (Edit/Write) hook: hooks/swarm-hook.sh post-edit (INTEGRATION.md §3).
// Run: node --test 'scripts/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const HOOK = join(ROOT, 'hooks/swarm-hook.sh');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

const project = (manifest) => {
  const d = mkdtempSync(join(tmpdir(), 'swarm-hook-'));
  dirs.push(d);
  if (manifest) writeFileSync(join(d, 'swarm.json'), JSON.stringify(manifest));
  return d;
};
const INPUT = JSON.stringify({ hook_event_name: 'PostToolUse', tool_name: 'Edit', tool_input: { file_path: '/repo/src/a.ts' } });
const run = (dir, input = INPUT) =>
  spawnSync('sh', [HOOK, 'post-edit'], { input, encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

describe('swarm-hook.sh post-edit', () => {
  it('runs hooks.postEdit in the project root with the hook JSON on stdin, and passes its stdout back', () => {
    const dir = project({ hooks: { postEdit: 'cat > received.json; echo \'{"hookSpecificOutput":{"hookEventName":"PostToolUse","additionalContext":"hi"}}\'' } });
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(readFileSync(join(dir, 'received.json'), 'utf8'), INPUT);
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, 'hi');
  });

  it('never blocks: a failing command still exits 0', () => {
    const dir = project({ hooks: { postEdit: 'cat >/dev/null; echo boom >&2; exit 2' } });
    assert.equal(run(dir).status, 0);
  });

  it('does nothing without swarm.json or without hooks.postEdit', () => {
    for (const dir of [project(), project({ hooks: { sessionStart: 'touch ran' } })]) {
      const r = run(dir);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.equal(existsSync(join(dir, 'ran')), false);
    }
  });
});
