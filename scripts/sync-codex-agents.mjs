#!/usr/bin/env node
/**
 * scripts/sync-codex-agents.mjs: regenerate codex/agents/<name>.toml from
 * agents/<name>.md so the Codex mirrors never drift from the Claude
 * subagents. The markdown is the source; the TOML is derived.
 *
 *   node scripts/sync-codex-agents.mjs          write the TOML files
 *   node scripts/sync-codex-agents.mjs --check  exit 1 if any TOML is stale
 */

import { readdirSync, readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { dirname, join, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(dirname(fileURLToPath(import.meta.url)));
const srcDir = join(root, 'agents');
const outDir = join(root, 'codex', 'agents');
const check = process.argv.includes('--check');

function parseFrontmatter(text) {
  const m = text.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!m) throw new Error('no frontmatter');
  const meta = {};
  for (const line of m[1].split('\n')) {
    const i = line.indexOf(':');
    if (i < 0) continue;
    meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  return { meta, body: m[2].trim() };
}

function tomlString(s) {
  return JSON.stringify(s);
}

function tomlMultiline(s) {
  // TOML basic multi-line string: escape backslashes and any run of three quotes.
  const escaped = s.replace(/\\/g, '\\\\').replace(/"""/g, '""\\"');
  return `"""\n${escaped}\n"""`;
}

mkdirSync(outDir, { recursive: true });
let stale = 0;
for (const file of readdirSync(srcDir).filter((f) => f.endsWith('.md')).sort()) {
  const { meta, body } = parseFrontmatter(readFileSync(join(srcDir, file), 'utf8'));
  if (!meta.name || !meta.description) throw new Error(`${file}: name and description are required`);
  const toml =
    `name = ${tomlString(meta.name)}\n` +
    `description = ${tomlString(meta.description)}\n` +
    `developer_instructions = ${tomlMultiline(body)}\n`;
  const out = join(outDir, `${basename(file, '.md')}.toml`);
  const current = existsSync(out) ? readFileSync(out, 'utf8') : null;
  if (current === toml) {
    console.log(`ok    ${out}`);
    continue;
  }
  if (check) {
    console.log(`STALE ${out}`);
    stale += 1;
    continue;
  }
  writeFileSync(out, toml);
  console.log(`wrote ${out}`);
}
if (check && stale) {
  console.log(`${stale} stale; run node scripts/sync-codex-agents.mjs`);
  process.exit(1);
}
