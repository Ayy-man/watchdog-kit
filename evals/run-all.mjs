#!/usr/bin/env node
/**
 * evals/run-all.mjs: run every kit eval with plain node, offline, and exit
 * non-zero when any fails.
 *
 *   node evals/run-all.mjs
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
console.log('\n== evals ==');
for (const r of results) console.log(`${r.ok ? 'ok  ' : 'FAIL'} ${r.file}`);
const failed = results.filter((r) => !r.ok).length;
console.log(`${results.length - failed} of ${results.length} eval files passed`);
process.exit(failed ? 1 : 0);
