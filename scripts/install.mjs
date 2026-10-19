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
 *   node scripts/install.mjs --check             report problems with an earlier install; exit 1 on any
 *
 * Every run is a dry run until you add --yes. The ledger of what this script
 * created lives at ~/.watchdog-kit-install.json; the script refuses to touch
 * any path that is not in the ledger, so a skill or agent you put there
 * yourself is never overwritten or removed. Set HOME to install elsewhere.
 * A copy install records a sha256 per installed file; a re-run refreshes
 * files that are unchanged since install but newer in the checkout, and
 * reports and keeps files edited by hand since install.
 */

import {
  existsSync, lstatSync, readlinkSync, readdirSync, readFileSync, writeFileSync,
  mkdirSync, symlinkSync, cpSync, rmSync, unlinkSync, statSync, renameSync,
} from 'node:fs';
import { createHash } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { dirname, join } from 'node:path';
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
  check: args.has('--check'),
  yes: args.has('--yes'),
  help: args.has('--help') || args.has('-h'),
};
for (const a of args) {
  if (!['--claude', '--codex', '--all', '--copy', '--uninstall', '--check', '--yes', '--help', '-h'].includes(a)) {
    console.error(`unknown argument ${a}`);
    process.exit(2);
  }
}
if (flags.help || (!flags.uninstall && !flags.check && !flags.claude && !flags.codex)) {
  console.log(readFileSync(fileURLToPath(import.meta.url), 'utf8').split('\n').slice(1, 21).filter((l) => !/^\s*\/?\*+\/?\s*$/.test(l)).map((l) => l.replace(/^ \*\s?/, '')).join('\n'));
  process.exit(flags.help ? 0 : 2);
}

function readLedger() {
  if (!existsSync(ledgerPath)) return { version: 1, kit, entries: [] };
  const l = JSON.parse(readFileSync(ledgerPath, 'utf8'));
  if (!Array.isArray(l.entries)) throw new Error(`${ledgerPath} is not a ledger this script wrote`);
  return l;
}
/** Write to a temporary file beside the ledger, then rename, so a crash never leaves half a ledger. */
function writeLedger(l) {
  const tmp = `${ledgerPath}.${process.pid}.tmp`;
  writeFileSync(tmp, JSON.stringify(l, null, 2) + '\n');
  renameSync(tmp, ledgerPath);
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
  // copy: a directory carries a marker file; a single file is owned while it
  // is a plain file, and its content is judged by compareCopy against the
  // hash recorded at install time
  if (entry.type === 'dir') return existsSync(join(entry.target, MARKER)) ? 'owned' : 'replaced';
  return !isSymlink(entry.target) && statSync(entry.target).isFile() ? 'owned' : 'replaced';
}
function isSymlink(p) {
  try { return lstatSync(p).isSymbolicLink(); } catch { return false; }
}

function sha256(p) {
  return createHash('sha256').update(readFileSync(p)).digest('hex');
}
function walkInto(dir, prefix, out, top) {
  for (const name of readdirSync(dir).sort()) {
    const p = join(dir, name);
    const rel = prefix ? `${prefix}/${name}` : name;
    if (top && name === MARKER) continue;
    if (top && name === 'kit' && isSymlink(p)) {
      // the source's `kit` link becomes real copies of KIT_PARTS (materialiseKitLink)
      for (const part of KIT_PARTS) {
        const src = join(kit, part);
        if (!existsSync(src)) continue;
        if (statSync(src).isDirectory()) walkInto(src, `kit/${part}`, out, false);
        else out.set(`kit/${part}`, src);
      }
      continue;
    }
    if (statSync(p).isDirectory()) walkInto(p, rel, out, false);
    else out.set(rel, p);
  }
  return out;
}
/** relative path -> absolute path of every file a copy install writes (source) or holds (target). */
function manifest(path, type) {
  if (type === 'file') return existsSync(path) ? new Map([['', path]]) : new Map();
  return existsSync(path) ? walkInto(path, '', new Map(), true) : new Map();
}
function hashes(path, type) {
  return Object.fromEntries([...manifest(path, type)].map(([rel, p]) => [rel, sha256(p)]));
}

/**
 * The vendor-core comparison, per installed file: baseline is the hash the
 * ledger recorded at install, current is the installed file now, source is
 * the checkout now. current = source is up to date; current = baseline (or
 * absent) with a different source is stale and refreshed; anything else was
 * edited by hand and is kept. A file the user added is left alone.
 */
function compareCopy(entry) {
  const base = entry.files || {};
  const src = hashes(entry.source, entry.type);
  const cur = hashes(entry.target, entry.type);
  const out = { stale: [], edited: [], files: {} };
  for (const rel of new Set([...Object.keys(src), ...Object.keys(cur), ...Object.keys(base)])) {
    const s = src[rel] ?? null;
    const c = cur[rel] ?? null;
    const b = base[rel] ?? null;
    if (c === s) { if (s) out.files[rel] = s; continue; }
    if (c === null || (b !== null && c === b)) { out.stale.push(rel); if (s) out.files[rel] = s; continue; }
    if (b === null && s === null) continue;
    out.edited.push(rel);
    if (b) out.files[rel] = b;
  }
  return out;
}
const filePath = (entry, rel) => (rel ? join(entry.target, rel) : entry.target);
const tilde = (p) => p.replace(home, '~');
const sideFlag = (target) => (target.startsWith(join(home, '.claude')) ? '--claude' : '--codex');

function refreshCopy(entry, stale) {
  const src = manifest(entry.source, entry.type);
  for (const rel of stale) {
    const to = filePath(entry, rel);
    if (src.has(rel)) {
      mkdirSync(dirname(to), { recursive: true });
      cpSync(src.get(rel), to);
    } else if (existsSync(to)) {
      unlinkSync(to);
    }
  }
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
        if (kind === 'copy') {
          const cmp = compareCopy(existing);
          for (const rel of cmp.edited) {
            actions.push({ op: 'edited', item, path: filePath(existing, rel), note: 'changed by hand since install; kept. Delete it and re-run to take the kit\'s copy' });
          }
          if (cmp.stale.length) actions.push({ op: 'refresh', item, entry: existing, cmp, note: `${cmp.stale.length} file(s) newer in the kit` });
          else if (!cmp.edited.length) actions.push({ op: 'keep', item, note: `already installed (${kind})` });
          if (!cmp.stale.length) actions.push({ op: 'record', item, entry: existing, cmp });
          continue;
        }
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
    if (a.op === 'record') continue;
    console.log(`${a.op.padEnd(7)} ${tilde(a.path || a.item.target)}${a.note ? '  (' + a.note + ')' : ''}`);
  }
  if (!flags.yes) {
    console.log(`\ndry run: ${actions.filter((a) => ['create', 'replace', 'refresh'].includes(a.op)).length} change(s), ${refused} refused. Add --yes to apply.`);
    return refused ? 1 : 0;
  }

  for (const a of actions) {
    if (a.op === 'refresh' || a.op === 'record') {
      if (a.op === 'refresh') refreshCopy(a.entry, a.cmp.stale);
      byTarget.set(a.entry.target, { ...a.entry, files: a.cmp.files });
      continue;
    }
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
    const entry = { target: item.target, source: item.source, type: item.type, kind: a.kind, at: new Date().toISOString() };
    if (a.kind === 'copy') entry.files = hashes(item.target, item.type);
    byTarget.set(item.target, entry);
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
    let state = owned(e);
    // a single copied file edited by hand since install is not removed
    if (state === 'owned' && e.kind === 'copy' && e.type === 'file' && compareCopy(e).edited.length) state = 'replaced';
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

/**
 * --check: dry, exit 1 on any problem, one line per problem naming the fix.
 * Covers the ledger, every owned path, the skills' $KIT, copied files that
 * are stale or edited, and the Codex agent mirrors in this checkout.
 */
function doctor() {
  const problems = [];
  const say = (path, problem, fix) => problems.push(`${tilde(path)}  ${problem}; ${fix}`);
  let ledger = null;
  if (!existsSync(ledgerPath)) {
    say(ledgerPath, 'no ledger', 'run node scripts/install.mjs --all --yes (add --copy for a copy install)');
  } else {
    try { ledger = readLedger(); } catch (err) {
      say(ledgerPath, `not readable (${String(err.message).split('\n')[0]})`, 'move it aside and re-run node scripts/install.mjs --all --yes');
    }
  }
  for (const e of ledger?.entries || []) {
    const again = `re-run node scripts/install.mjs ${sideFlag(e.target)}${e.kind === 'copy' ? ' --copy' : ''} --yes`;
    const state = owned(e);
    if (state === 'missing') { say(e.target, 'in the ledger but gone', again); continue; }
    if (state === 'replaced') { say(e.target, 'no longer what the installer created', 'remove it by hand, then ' + again); continue; }
    if (!existsSync(e.source)) { say(e.target, `its checkout ${tilde(e.source)} is gone`, 'clone the kit back there, or uninstall and install from the new checkout'); continue; }
    if (e.kind === 'symlink' && !existsSync(e.target)) { say(e.target, 'symlink does not resolve', again); continue; }
    if (e.type === 'dir' && isSymlink(join(e.source, 'kit'))) {
      const link = join(e.target, 'kit');
      const need = e.kind === 'symlink' ? ['core'] : KIT_PARTS.filter((p) => existsSync(join(kit, p)));
      const gone = need.filter((p) => !existsSync(join(link, p)));
      if (gone.length) say(link, `$KIT is missing ${gone.join(', ')}`, again);
      e.goneParts = gone.map((p) => `kit/${p}`);
    }
    if (e.kind === 'copy') {
      const cmp = compareCopy(e);
      const underGone = (rel) => (e.goneParts || []).some((p) => rel === p || rel.startsWith(`${p}/`));
      for (const rel of cmp.stale.filter((r) => !underGone(r))) say(filePath(e, rel), 'stale copy, newer in the kit', again);
      for (const rel of cmp.edited) say(filePath(e, rel), 'edited by hand since install', `keep it, or delete it and ${again}`);
    }
  }
  const sync = spawnSync(process.execPath, [join(kit, 'scripts', 'sync-codex-agents.mjs'), '--check'], { encoding: 'utf8' });
  if (sync.status !== 0) {
    const stale = (sync.stdout || '').split('\n').filter((l) => l.startsWith('STALE ')).map((l) => l.slice(6));
    if (!stale.length) stale.push(join(kit, 'codex', 'agents'));
    for (const f of stale) say(f, 'Codex agent mirror out of step with agents/*.md', 'run node scripts/sync-codex-agents.mjs');
  }
  for (const p of problems) console.log(`problem ${p}`);
  console.log(problems.length ? `\n${problems.length} problem(s)` : `ok: ${ledger.entries.length} installed path(s), nothing to fix`);
  return problems.length ? 1 : 0;
}

process.exit(flags.check ? doctor() : flags.uninstall ? uninstall() : install());
