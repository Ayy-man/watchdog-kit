#!/usr/bin/env node
/**
 * evals/run-all.mjs: run every kit eval with plain node, offline, then the
 * Codex mirror check, and exit non-zero when any fails. Given a reference
 * build's repo, also check its vendored core against the kit's core/.
 *
 *   node evals/run-all.mjs
 *   node evals/run-all.mjs <reference build repo>
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const evals = readdirSync(here).filter((f) => /^eval-.*\.mjs$/.test(f)).sort();
const results = [];
for (const file of evals) {
  const out = spawnSync(process.execPath, [join(here, file)], { stdio: 'inherit' });
  results.push({ file, ok: out.status === 0 });
}
const scripts = join(dirname(here), 'scripts');
const extra = [['sync-codex-agents.mjs', '--check']];
const reference = process.argv[2];
if (reference) extra.push(['vendor-core.mjs', reference, '--check']);
for (const [script, ...args] of extra) {
  const out = spawnSync(process.execPath, [join(scripts, script), ...args], { stdio: 'inherit' });
  results.push({ file: `scripts/${script} ${args.join(' ')}`, ok: out.status === 0 });
}
console.log('\n== evals ==');
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} eval files passed`);
process.exit(failed ? 1 : 0);
