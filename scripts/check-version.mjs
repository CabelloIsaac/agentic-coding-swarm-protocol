#!/usr/bin/env node
// Fails if the places that state the protocol version disagree. `.claude-plugin/plugin.json` is the source
// (MAINTAINING.md §3); the template `templates/swarm.json`, the first released `CHANGELOG.md` entry, the README
// "Status" line and the INTEGRATION.md examples must all say the same x.y.z. A marketplace entry may omit `version`
// (plugin.json wins at install time and `claude plugin validate` warns when both are set); if it sets one, it must match.
// Run: node scripts/check-version.mjs [--repo <dir>]
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';

const SEMVER = /\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?/;

/** Every place that states a version, as `[label, value | undefined]`, read from the repository at `root`. */
export function collect(root) {
  const read = (p) => (existsSync(join(root, p)) ? readFileSync(join(root, p), 'utf8') : undefined);
  const json = (p) => {
    const t = read(p);
    return t === undefined ? undefined : JSON.parse(t);
  };
  const found = [];
  found.push(['.claude-plugin/plugin.json', json('.claude-plugin/plugin.json')?.version]);
  found.push(['templates/swarm.json', json('templates/swarm.json')?.version]);
  const market = json('.claude-plugin/marketplace.json');
  const plugin = json('.claude-plugin/plugin.json');
  const entry = market?.plugins?.find((p) => p.name === plugin?.name);
  if (entry?.version !== undefined) found.push(['.claude-plugin/marketplace.json (plugin entry)', entry.version]);
  // First released entry: "## [x.y.z] — date". `## [Unreleased]` is skipped on purpose.
  const changelog = read('CHANGELOG.md') ?? '';
  found.push(['CHANGELOG.md (latest release)', new RegExp(`^## \\[(${SEMVER.source})\\]`, 'm').exec(changelog)?.[1]]);
  // README: the first backticked vX.Y.Z after "## Status".
  const status = (read('README.md') ?? '').split(/^## Status\s*$/m)[1] ?? '';
  found.push(['README.md (Status)', new RegExp(`\`v(${SEMVER.source})\``).exec(status)?.[1]]);
  // INTEGRATION.md: the manifest example and every "protocol x.y.z" sample output.
  const integration = read('INTEGRATION.md') ?? '';
  found.push(['INTEGRATION.md (swarm.json example)', new RegExp(`"version": "(${SEMVER.source})"`).exec(integration)?.[1]]);
  for (const [, v] of integration.matchAll(new RegExp(`· protocol (${SEMVER.source})`, 'g'))) found.push(['INTEGRATION.md (sample output)', v]);
  return found;
}

/** Problems as strings; empty when every place agrees with plugin.json. */
export function check(root) {
  const found = collect(root);
  const expected = found[0][1];
  if (!expected) return ['.claude-plugin/plugin.json has no version'];
  return found.filter(([, v]) => v !== expected).map(([label, v]) => `${label}: ${v ?? 'no version found'} ≠ plugin.json ${expected}`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const i = process.argv.indexOf('--repo');
  const root = i > 0 ? process.argv[i + 1] : join(dirname(new URL(import.meta.url).pathname), '..');
  const problems = check(root);
  if (problems.length) {
    console.error(problems.join('\n'));
    console.error(`\n✗ ${problems.length} version mismatch(es): bump every place listed in MAINTAINING.md §3`);
    process.exit(1);
  }
  const found = collect(root);
  console.log(`✓ version ${found[0][1]} agrees in ${found.length} places`);
}
