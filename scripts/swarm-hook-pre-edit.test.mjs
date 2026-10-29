// Self-test of the plugin's PreToolUse (Edit/Write) hook: hooks/swarm-hook.sh gate, with hooks.preEdit (INTEGRATION.md §3).
// Run: node --test 'scripts/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
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
const input = (file) => JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: file } });
const run = (dir, file = '/repo/db/migrations/002.sql') =>
  spawnSync('sh', [HOOK, 'gate'], { input: input(file), encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });

describe('swarm-hook.sh gate + hooks.preEdit', () => {
  it('runs hooks.preEdit with the hook JSON on stdin and passes its stdout back', () => {
    const dir = project({ hooks: { preEdit: 'cat > received.json; echo \'{"hookSpecificOutput":{"hookEventName":"PreToolUse","additionalContext":"leased"}}\'' } });
    const r = run(dir);
    assert.equal(r.status, 0);
    assert.equal(readFileSync(join(dir, 'received.json'), 'utf8'), input('/repo/db/migrations/002.sql'));
    assert.equal(JSON.parse(r.stdout).hookSpecificOutput.additionalContext, 'leased');
  });

  it('passes on exit 2 with its stderr: that is how the edit gets refused', () => {
    const dir = project({ hooks: { preEdit: 'cat >/dev/null; echo "held by feature" >&2; exit 2' } });
    const r = run(dir);
    assert.equal(r.status, 2);
    assert.match(r.stderr, /held by feature/);
  });

  it('any other failure never blocks', () => {
    for (const code of [1, 3, 127]) {
      const dir = project({ hooks: { preEdit: `cat >/dev/null; exit ${code}` } });
      assert.equal(run(dir).status, 0, `exit ${code} must not block an edit`);
    }
  });

  it('the quality-gate warning still fires, and preEdit still runs after it', () => {
    const dir = project({ hooks: { preEdit: 'cat >/dev/null; touch ran' } });
    const r = run(dir, '/repo/vitest.config.ts');
    assert.equal(r.status, 0);
    assert.match(r.stderr, /you are touching a quality gate/);
    assert.ok(readFileSync(join(dir, 'ran'), 'utf8') === '');
  });

  it('without swarm.json, or without a file path, nothing runs', () => {
    const r = run(project());
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    const dir = project({ hooks: { preEdit: 'exit 2' } });
    const noFile = spawnSync('sh', [HOOK, 'gate'], { input: '{"tool_input":{}}', encoding: 'utf8', env: { ...process.env, CLAUDE_PROJECT_DIR: dir } });
    assert.equal(noFile.status, 0);
  });
});
