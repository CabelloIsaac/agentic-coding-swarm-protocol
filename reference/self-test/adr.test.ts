/**
 * Conflict-free ADRs: drafts get the next free number at integration time, their references are rewritten without
 * prefix collisions, the heading gets its number and the index is regenerated from the files.
 */
import assert from 'node:assert/strict';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, test } from 'node:test';
import { numberDraftAdrs, readAdrs, updateAdrIndex } from '../scripts/adr.ts';
import { commit, fixture } from './helpers.ts';

const INDEX = '# Decisions\n\nIntro kept as is.\n\n<!-- generated:adr-index -->\nstale content\n<!-- /generated:adr-index -->\n\nFooter kept as is.\n';
const read = (root: string, path: string) => readFileSync(join(root, path), 'utf8');

describe('adr', () => {
  test('drafts take max+1 in name order, references and headings are rewritten, the index is regenerated', (t) => {
    const fx = fixture(t);
    const root = fx.wt;
    commit(root, 'docs: drafts', {
      'docs/adr/README.md': INDEX,
      'docs/adr/0001-first.md': '# ADR-0001 — First\n\n- Status: Accepted\n',
      // A gap: the next number is max+1, not count+1
      'docs/adr/0005-fifth.md': '# ADR-0005 - Fifth\n\n- Status: Superseded by ADR-0001\n',
      'docs/adr/draft-cache.md': '# ADR-draft — Cache\n\n- Status: Accepted\n\nSee ADR-draft-cache-eviction.\n',
      'docs/adr/draft-cache-eviction.md': '# ADR-draft — Cache eviction\n\nRefines ADR-draft-cache ([link](draft-cache.md)).\n',
      'docs/architecture.md': 'Caching: ADR-draft-cache and ADR-draft-cache-eviction (docs/adr/draft-cache-eviction.md).\n',
      'src/cache.ts': '// Why: ADR-draft-cache\nexport const ttl = 60;\n',
      'notes.txt': 'ADR-draft-cache (not a text type the numbering rewrites)\n',
    });

    const done = numberDraftAdrs(root);
    // `draft-cache-eviction.md` sorts before `draft-cache.md` ('-' < '.')
    assert.deepEqual(done, [
      { from: 'draft-cache-eviction.md', to: '0006-cache-eviction.md', id: '0006' },
      { from: 'draft-cache.md', to: '0007-cache.md', id: '0007' },
    ]);
    assert.ok(!existsSync(join(root, 'docs/adr/draft-cache.md')));
    assert.equal(read(root, 'docs/adr/0007-cache.md'), '# ADR-0007 — Cache\n\n- Status: Accepted\n\nSee ADR-0006.\n');
    assert.equal(read(root, 'docs/adr/0006-cache-eviction.md'), '# ADR-0006 — Cache eviction\n\nRefines ADR-0007 ([link](0007-cache.md)).\n');
    assert.equal(read(root, 'docs/architecture.md'), 'Caching: ADR-0007 and ADR-0006 (docs/adr/0006-cache-eviction.md).\n');
    assert.equal(read(root, 'src/cache.ts'), '// Why: ADR-0007\nexport const ttl = 60;\n');
    assert.equal(read(root, 'notes.txt'), 'ADR-draft-cache (not a text type the numbering rewrites)\n');

    assert.equal(updateAdrIndex(root), true);
    assert.equal(
      read(root, 'docs/adr/README.md'),
      [
        '# Decisions\n\nIntro kept as is.\n',
        '<!-- generated:adr-index -->',
        '| ADR | Title | Status |',
        '|---|---|---|',
        '| [0001](0001-first.md) | First | Accepted |',
        '| [0005](0005-fifth.md) | Fifth | Superseded by ADR-0001 |',
        '| [0006](0006-cache-eviction.md) | Cache eviction | Proposed |',
        '| [0007](0007-cache.md) | Cache | Accepted |',
        '<!-- /generated:adr-index -->\n\nFooter kept as is.\n',
      ].join('\n'),
    );
    assert.equal(updateAdrIndex(root), false, 'a second run changes nothing');
  });

  test('no drafts: nothing is renamed; readAdrs ignores the README and drafts', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'docs: adrs', { 'docs/adr/README.md': INDEX, 'docs/adr/0001-first.md': '# ADR-0001 — First\n' });
    assert.deepEqual(numberDraftAdrs(fx.wt), []);
    assert.deepEqual(readAdrs(fx.wt), [{ number: '0001', file: '0001-first.md', title: 'First', status: 'Proposed' }]);
  });

  test('a project without ADRs is left alone (land calls this on every run)', (t) => {
    const fx = fixture(t);
    assert.deepEqual(numberDraftAdrs(fx.wt), []);
    assert.equal(updateAdrIndex(fx.wt), false);
  });

  test('an index without its markers is an error, not a silent rewrite', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'docs: index without markers', { 'docs/adr/README.md': '# Decisions\n' });
    assert.throws(() => updateAdrIndex(fx.wt), /does not have the markers/);
  });

  test('the CLI numbers and indexes in one go', (t) => {
    const fx = fixture(t);
    commit(fx.wt, 'docs: draft', { 'docs/adr/README.md': INDEX, 'docs/adr/draft-only.md': '# ADR-draft — Only\n' });
    const r = fx.run('adr', ['number']);
    assert.equal(r.status, 0, r.out);
    assert.equal(r.stdout, 'draft-only.md → 0001-only.md\n');
    assert.match(read(fx.wt, 'docs/adr/README.md'), /\| \[0001\]\(0001-only\.md\) \| Only \| Proposed \|/);
    assert.equal(fx.run('adr', ['bogus']).status, 2);
  });
});
