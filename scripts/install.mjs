#!/usr/bin/env node
/**
 * scripts/install.mjs: put the kit's skills and agents where Claude Code and
 * Codex look for them, by symlink (default) or by copy, and take them out
 * again. Plain node, no dependencies.
 *
 *   node scripts/install.mjs --claude            skills/* -> ~/.claude/skills/, agents/*.md -> ~/.claude/agents/
 *   node scripts/install.mjs --codex             skills/* -> ~/.codex/skills/ and ~/.agents/skills/, codex/agents/*.toml -> ~/.codex/agents/
 *   node scripts/install.mjs --all               both
 *   node scripts/install.mjs --all --copy        copy instead of symlink
 *   node scripts/install.mjs --uninstall         remove exactly what an earlier run created
 *
 * Every run is a dry run until you add --yes. The ledger of what this script
 * created lives at ~/.watchdog-kit-install.json; the script refuses to touch
 * any path that is not in the ledger, so a skill or agent you put there
 * yourself is never overwritten or removed. Set HOME to install elsewhere.
 */

import {
  existsSync, lstatSync, readlinkSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, symlinkSync, cpSync, rmSync, unlinkSync, statSync,
} from 'node:fs';
import { dirname, join, resolve, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { homedir } from 'node:os';

const kit = dirname(dirname(fileURLToPath(import.meta.url)));
const home = process.env.HOME || homedir();
const ledgerPath = join(home, '.watchdog-kit-install.json');
const MARKER = '.watchdog-kit-installed';

const args = new Set(process.argv.slice(2));
const flags = {
  claude: args.has('--claude') || args.has('--all'),
  codex: args.has('--codex') || args.has('--all'),
  copy: args.has('--copy'),
  uninstall: args.has('--uninstall'),
  yes: args.has('--yes'),
  help: args.has('--help') || args.has('-h'),
};
for (const a of args) {
  if (!['--claude', '--codex', '--all', '--copy', '--uninstall', '--yes', '--help', '-h'].includes(a)) {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (flags.help || (!flags.uninstall && !flags.claude && !flags.codex)) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 17).filter((l) => !/^\s*\/?\*+\/?\s*$/.test(l)).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
  process.exit(flags.help ? 0 : 2);
}

function readLedger() {
  if (!existsSync(ledgerPath)) return { version: 1, kit, entries: [] };
  const l = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (!Array.isArray(l.entries)) throw new Error(`${ledgerPath} is not a ledger this script wrote`);
  return l;
}
function writeLedger(l) {
  writeFileSync(ledgerPath, JSON.stringify(l, null, 2) + '\n');
}

function listDirs(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => !n.startsWith('.') && statSync(join(dir, n)).isDirectory()).sort();
}
function listFiles(dir, ext) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).filter((n) => n.endsWith(ext)).sort();
}

/** Build the plan: every (source, target) this run would create. */
function plan() {
  const items = [];
  const skills = listDirs(join(kit, 'skills')).map((n) => ({ name: n, source: join(kit, 'skills', n), type: 'dir' }));
  if (flags.claude) {
    for (const s of skills) items.push({ ...s, target: join(home, '.claude', 'skills', s.name) });
    for (const f of listFiles(join(kit, 'agents'), '.md')) {
      items.push({ name: f, source: join(kit, 'agents', f), type: 'file', target: join(home, '.claude', 'agents', f) });
    }
  }
  if (flags.codex) {
    for (const s of skills) {
      items.push({ ...s, target: join(home, '.codex', 'skills', s.name) });
      items.push({ ...s, target: join(home, '.agents', 'skills', s.name) });
    }
    for (const f of listFiles(join(kit, 'codex', 'agents'), '.toml')) {
      items.push({ name: f, source: join(kit, 'codex', 'agents', f), type: 'file', target: join(home, '.codex', 'agents', f) });
    }
  }
  return items;
}

/** Is `target` something this script created and still owns? */
function owned(entry) {
  if (!existsSync(entry.target) && !isSymlink(entry.target)) return 'missing';
  if (entry.kind === 'symlink') {
    if (!isSymlink(entry.target)) return 'replaced';
    return readlinkSync(entry.target) === entry.source ? 'owned' : 'replaced';
  }
  // copy: a directory carries a marker file; a single file is matched by content
  if (entry.type === 'dir') return existsSync(join(entry.target, MARKER)) ? 'owned' : 'replaced';
  try {
    return readFileSync(entry.target, 'utf8') === readFileSync(entry.source, 'utf8') ? 'owned' : 'replaced';
  } catch {
    return 'replaced';
  }
}
function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function install() {
  const ledger = readLedger();
  const byTarget = new Map(ledger.entries.map((e) => [e.target, e]));
  const kind = flags.copy ? 'copy' : 'symlink';
  const actions = [];
  let refused = 0;
  for (const item of plan()) {
    const existing = byTarget.get(item.target);
    const present = existsSync(item.target) || isSymlink(item.target);
    if (existing) {
      const state = owned(existing);
      if (state === 'owned' && existing.kind === kind && existing.source === item.source) {
        actions.push({ op: 'keep', item, note: `already installed (${kind})` });
        continue;
      }
      if (state === 'replaced') {
        actions.push({ op: 'refuse', item, note: 'in the ledger but no longer what this script created; remove it by hand or fix the ledger' });
        refused += 1;
        continue;
      }
      actions.push({ op: 'replace', item, kind, note: `re-create as ${kind}` });
      continue;
    }
    if (present) {
      actions.push({ op: 'refuse', item, note: 'exists and was not created by this script' });
      refused += 1;
      continue;
    }
    actions.push({ op: 'create', item, kind });
  }

  for (const a of actions) {
    const rel = a.item.target.replace(home, '~');
    console.log(`${a.op.padEnd(7)} ${rel}${a.note ? '  (' + a.note + ')' : ''}`);
  }
  if (!flags.yes) {
    console.log(`\ndry run: ${actions.filter((a) => a.op !== 'keep' && a.op !== 'refuse').length} change(s), ${refused} refused. Add --yes to apply.`);
    return refused ? 1 : 0;
  }

  for (const a of actions) {
    if (a.op !== 'create' && a.op !== 'replace') continue;
    const { item } = a;
    mkdirSync(dirname(item.target), { recursive: true });
    if (a.op === 'replace') removePath(item.target);
    if (a.kind === 'symlink') {
      symlinkSync(item.source, item.target, item.type === 'dir' ? 'dir' : 'file');
    } else if (item.type === 'dir') {
      cpSync(item.source, item.target, { recursive: true });
      materialiseKitLink(item.target);
      writeFileSync(join(item.target, MARKER), `installed from ${item.source}\n`);
    } else {
      cpSync(item.source, item.target);
    }
    byTarget.set(item.target, { target: item.target, source: item.source, type: item.type, kind: a.kind, at: new Date().toISOString() });
  }
  ledger.kit = kit;
  ledger.entries = [...byTarget.values()];
  writeLedger(ledger);
  console.log(`\napplied. ledger: ${ledgerPath.replace(home, '~')}`);
  return refused ? 1 : 0;
}

/**
 * A copied skill cannot follow the `kit` link inside watchdog-build (it
 * points at `../..` of the kit checkout), so a copy install replaces it with
 * real copies of the parts the phase skills read through `$KIT`.
 */
const KIT_PARTS = ['core', 'templates', 'evals', 'scripts', 'agents', 'codex', 'VERSION', 'README.md', 'AGENTS.md'];
function materialiseKitLink(target) {
  const link = join(target, 'kit');
  if (!isSymlink(link)) return;
  unlinkSync(link);
  mkdirSync(link);
  for (const part of KIT_PARTS) {
    const src = join(kit, part);
    if (!existsSync(src)) continue;
    cpSync(src, join(link, part), { recursive: true });
  }
}

function removePath(p) {
  if (isSymlink(p)) unlinkSync(p);
  else rmSync(p, { recursive: true, force: true });
}

function uninstall() {
  const ledger = readLedger();
  if (ledger.entries.length === 0) {
    console.log(`nothing to remove: ${ledgerPath.replace(home, '~')} is empty or absent`);
    return 0;
  }
  const keep = [];
  const actions = [];
  for (const e of ledger.entries) {
    const state = owned(e);
    if (state === 'owned') actions.push({ op: 'remove', e });
    else if (state === 'missing') actions.push({ op: 'forget', e, note: 'already gone' });
    else { actions.push({ op: 'refuse', e, note: 'no longer what this script created; left in place and kept in the ledger' }); keep.push(e); }
  }
  for (const a of actions) console.log(`${a.op.padEnd(7)} ${a.e.target.replace(home, '~')}${a.note ? '  (' + a.note + ')' : ''}`);
  if (!flags.yes) {
    console.log(`\ndry run: ${actions.filter((a) => a.op === 'remove').length} removal(s). Add --yes to apply.`);
    return 0;
  }
  for (const a of actions) if (a.op === 'remove') removePath(a.e.target);
  ledger.entries = keep;
  if (keep.length === 0) { if (existsSync(ledgerPath)) unlinkSync(ledgerPath); console.log(`\nremoved; ledger deleted`); }
  else { writeLedger(ledger); console.log(`\nremoved; ${keep.length} refused entries kept in the ledger`); }
  return 0;
}

process.exit(flags.uninstall ? uninstall() : install());
