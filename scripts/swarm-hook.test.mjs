// Self-test of the plugin's gate hook (hooks/swarm-hook.sh gate) as Claude Code runs it: PreToolUse JSON on stdin,
// CLAUDE_PROJECT_DIR pointing at a throw-away project. Run: node --test 'scripts/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { existsSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const HOOK = join(ROOT, 'hooks/swarm-hook.sh');
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A project directory, with a swarm.json when `manifest` is given. */
function project(manifest) {
  const d = mkdtempSync(join(tmpdir(), 'swarm-hook-'));
  dirs.push(d);
  if (manifest) writeFileSync(join(d, 'swarm.json'), JSON.stringify({ protocol: 'swarm', version: '0.4.0', level: 0, ...manifest }));
  return d;
}
const gate = (dir, file) =>
  spawnSync('sh', [HOOK, 'gate'], {
    input: JSON.stringify({ hook_event_name: 'PreToolUse', tool_name: 'Edit', tool_input: { file_path: join(dir, file) } }),
    env: { ...process.env, CLAUDE_PROJECT_DIR: dir },
    encoding: 'utf8',
  });
const decision = (r) => JSON.parse(r.stdout).hookSpecificOutput;

describe('swarm-hook gate', () => {
  it('warns on stderr and decides nothing by default (no swarm.json, or no hooks.gateEdit)', () => {
    for (const dir of [project(), project({ hooks: { sessionStart: 'true' } })]) {
      const r = gate(dir, 'vitest.config.ts');
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
      assert.match(r.stderr, /quality gate .*vitest\.config\.ts/);
    }
  });

  it('stays silent on a file that is not a gate, whatever the mode', () => {
    const r = gate(project({ hooks: { gateEdit: 'block' } }), 'src/app.ts');
    assert.equal(r.status, 0);
    assert.equal(r.stdout, '');
    assert.equal(r.stderr, '');
  });

  it('hooks.gateEdit "block" denies the edit through the PreToolUse decision and still exits 0', () => {
    const r = gate(project({ hooks: { gateEdit: 'block' } }), 'quality-ratchets.json');
    assert.equal(r.status, 0);
    const out = decision(r);
    assert.equal(out.hookEventName, 'PreToolUse');
    assert.equal(out.permissionDecision, 'deny');
    assert.match(out.permissionDecisionReason, /quality-ratchets\.json is a quality gate/);
  });

  it('hooks.gateEdit "ask" hands the decision to the person', () => {
    const r = gate(project({ hooks: { gateEdit: 'ask' } }), 'swarm.json');
    assert.equal(r.status, 0);
    assert.equal(decision(r).permissionDecision, 'ask');
  });

  it('applies the mode to the extra globs in gates', () => {
    const r = gate(project({ gates: ['*/policies/*'], hooks: { gateEdit: 'block' } }), 'policies/limits.yaml');
    assert.equal(decision(r).permissionDecision, 'deny');
  });

  it('keeps the JSON valid for a path with quotes or backslashes', () => {
    const r = gate(project({ hooks: { gateEdit: 'block' } }), 'we"ird\\dir/biome.json');
    assert.match(decision(r).permissionDecisionReason, /we"ird\\dir\/biome\.json/);
  });

  it('treats an unknown value as "warn"', () => {
    const r = gate(project({ hooks: { gateEdit: 'yes' } }), 'biome.json');
    assert.equal(r.stdout, '');
    assert.match(r.stderr, /quality gate/);
  });

  it('a gate decision answers alone: hooks.preEdit does not run, so stdout stays one JSON', () => {
    for (const mode of ['block', 'ask']) {
      const dir = project({ hooks: { gateEdit: mode, preEdit: 'cat >/dev/null; touch ran; echo \'{"x":1}\'' } });
      const r = gate(dir, 'biome.json');
      assert.equal(r.status, 0);
      assert.equal(decision(r).permissionDecision, mode === 'block' ? 'deny' : 'ask');
      assert.equal(existsSync(join(dir, 'ran')), false);
    }
  });
});
