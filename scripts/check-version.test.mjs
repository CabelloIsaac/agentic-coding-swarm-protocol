// Self-test of scripts/check-version.mjs against copies of this repository's own version-bearing files.
// Run: node --test 'scripts/*.test.mjs'
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { after, describe, it } from 'node:test';
import { check } from './check-version.mjs';

const ROOT = join(dirname(new URL(import.meta.url).pathname), '..');
const SCRIPT = join(ROOT, 'scripts/check-version.mjs');
const FILES = ['.claude-plugin/plugin.json', '.claude-plugin/marketplace.json', 'templates/swarm.json', 'CHANGELOG.md', 'README.md', 'INTEGRATION.md'];
const dirs = [];
after(() => dirs.forEach((d) => rmSync(d, { recursive: true, force: true })));

/** A throw-away copy of the files the check reads. */
function copy() {
  const d = mkdtempSync(join(tmpdir(), 'swarm-version-'));
  dirs.push(d);
  for (const f of FILES) {
    mkdirSync(dirname(join(d, f)), { recursive: true });
    cpSync(join(ROOT, f), join(d, f));
  }
  return d;
}
const edit = (repo, f, fn) => writeFileSync(join(repo, f), fn(readFileSync(join(repo, f), 'utf8')));
const version = JSON.parse(readFileSync(join(ROOT, '.claude-plugin/plugin.json'), 'utf8')).version;
const run = (repo) => spawnSync(process.execPath, [SCRIPT, '--repo', repo], { encoding: 'utf8' });

describe('check-version', () => {
  it('passes on this repository as committed', () => {
    assert.deepEqual(check(ROOT), []);
    const r = run(ROOT);
    assert.equal(r.status, 0, r.stderr);
    assert.match(r.stdout, new RegExp(`version ${version.replaceAll('.', '\\.')} agrees`));
  });

  it('fails when the README Status line lags behind plugin.json', () => {
    const repo = copy();
    edit(repo, 'README.md', (t) => t.replace(`\`v${version}\``, '`v0.0.1`'));
    const r = run(repo);
    assert.equal(r.status, 1);
    assert.match(r.stderr, /README\.md \(Status\): 0\.0\.1/);
  });

  it('fails when the template swarm.json or the changelog disagree', () => {
    const repo = copy();
    edit(repo, 'templates/swarm.json', (t) => t.replace(`"version": "${version}"`, '"version": "9.9.9"'));
    edit(repo, 'CHANGELOG.md', (t) => t.replace(`## [${version}]`, '## [9.9.8]'));
    const problems = check(repo);
    assert.equal(problems.length, 2);
    assert.match(problems.join('\n'), /templates\/swarm\.json: 9\.9\.9/);
    assert.match(problems.join('\n'), /CHANGELOG\.md \(latest release\): 9\.9\.8/);
  });

  it('skips Unreleased and reads the first released changelog entry', () => {
    const repo = copy();
    edit(repo, 'CHANGELOG.md', (t) => t.replace(`## [${version}]`, `## [Unreleased]\n\n- something\n\n## [${version}]`));
    assert.deepEqual(check(repo), []);
  });

  it('accepts a marketplace entry without version and checks it when present', () => {
    const repo = copy();
    edit(repo, '.claude-plugin/marketplace.json', (t) => {
      const m = JSON.parse(t);
      m.plugins[0].version = '0.0.0';
      return JSON.stringify(m, null, 2);
    });
    assert.match(check(repo).join('\n'), /marketplace\.json \(plugin entry\): 0\.0\.0/);
  });
});
