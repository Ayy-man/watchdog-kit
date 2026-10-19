#!/usr/bin/env node
/**
 * journal-append.mjs: the only writer of .watchdog/journal.jsonl. Plain node,
 * no dependencies. Every command takes [--repo <root>] (default: cwd) and
 * regenerates .watchdog/STATE.md afterwards.
 *
 *   journal-append.mjs init
 *       First run: creates .watchdog/, .watchdog/inbox/ and an empty journal.
 *   journal-append.mjs <phase> started
 *       Opens a run of the phase. Warns when an earlier phase is not done.
 *   journal-append.mjs <phase> finished [--artefact <path>]... [--decision <json>]...
 *       Closes the open run: hashes the phase's required artefacts, any
 *       already recorded and any --artefact paths, and keeps the run's
 *       decisions. Refused when no run is open (append "started" first), so a
 *       second "finished" cannot silently drop the decisions of the first.
 *   journal-append.mjs <phase> decision --decision <json> [--decision <json>]... [--artefact <path>]...
 *       Records a human's answer on the current entry and re-hashes its
 *       artefacts, so an answer written into an artefact (the holdout
 *       adjudication) is hashed after it was written.
 *
 * "finished" and "decision" run the shared predicate on the entry before
 * writing it. If the phase would be invalid or stale, nothing is appended and
 * the command exits 1 with the reason first.
 *   journal-append.mjs <phase> blocked --reason <text> --needs <text>
 *
 * A decision is JSON: {"question": "...", "answer": "...", "by": "...", "at": "<ISO, default now>"}.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  PHASES, PhaseError, REQUIRED, SKILL_OF, currentEntry, isIso, journalPath, phaseStatus, readJournal, sha256, writeState,
} from './journal-lib.mjs';

const die = (msg) => { console.error(`journal-append: ${msg}`); process.exit(1); };
const USAGE = 'usage: journal-append.mjs init | <phase 0-8> <started|finished|decision|blocked> [--repo <root>] [--artefact <path>]... [--decision <json>]... [--reason <text> --needs <text>]';

const args = process.argv.slice(2);
const opts = { artefact: [], decision: [] };
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a.startsWith('--')) {
    const key = a.slice(2); const value = args[++i];
    if (value === undefined) die(`${a} needs a value\n${USAGE}`);
    if (key === 'artefact' || key === 'decision') opts[key].push(value);
    else if (['repo', 'reason', 'needs'].includes(key)) opts[key] = value;
    else die(`unknown option ${a}\n${USAGE}`);
  } else positional.push(a);
}
const root = resolve(opts.repo ?? process.cwd());
const now = new Date().toISOString();

function load() {
  try { return readJournal(root); } catch (err) { if (err instanceof PhaseError) die(err.message); throw err; }
}

function finish(entries) {
  const { firstOpen } = writeState(root, entries);
  console.log(`journal-append: STATE.md regenerated; current phase ${firstOpen ?? 'none, all done'}`);
}

if (positional[0] === 'init') {
  mkdirSync(resolve(root, '.watchdog/inbox'), { recursive: true });
  const created = !existsSync(journalPath(root));
  if (created) writeFileSync(journalPath(root), '');
  const { entries } = load();
  console.log(`journal-append: ${created ? 'created .watchdog/journal.jsonl and .watchdog/inbox/' : `journal already exists with ${entries.length} entries; left as it is`}`);
  finish(entries);
  process.exit(0);
}

const phase = Number(positional[0]);
const command = positional[1];
if (positional[0] === undefined || !Number.isInteger(phase) || !(phase in REQUIRED)) die(USAGE);
if (!['started', 'finished', 'decision', 'blocked'].includes(command)) die(USAGE);

const journal = load();
if (!journal.exists) die(`no journal at ${journalPath(root)}; run journal-append.mjs init first`);
const entries = journal.entries;
const current = currentEntry(entries, phase);
const strip = (e) => { if (!e) return e; const { _line, ...rest } = e; return rest; };
const openRun = current && !current.blocked && current.finished == null ? strip(current) : null;

const decisions = opts.decision.map((raw) => {
  let d; try { d = JSON.parse(raw); } catch { die(`--decision is not JSON: ${raw}`); }
  for (const f of ['question', 'answer', 'by']) if (!String(d?.[f] ?? '').trim()) die(`--decision needs a non-empty "${f}": ${raw}`);
  const at = d.at ?? now;
  if (!isIso(at)) die(`--decision "at" must be an ISO 8601 timestamp, got ${at}`);
  return { question: d.question, answer: d.answer, by: d.by, at };
});

function hash(paths) {
  const missing = paths.filter((p) => sha256(root, p) === null);
  if (missing.length) die(`artefacts missing on disk, nothing appended: ${missing.join(', ')}`);
  return paths.map((path) => ({ path, sha256: sha256(root, path) }));
}
const unique = (xs) => [...new Set(xs)];

let entry;
const notes = [];
if (command === 'started') {
  const behind = PHASES.filter(([p]) => p < phase && !phaseStatus(root, p, currentEntry(entries, p)).done).map(([p]) => p);
  if (behind.length) console.warn(`journal-append: warning, earlier phases not done: ${behind.join(', ')}; confirm this phase's preconditions before running it`);
  entry = { phase, skill: SKILL_OF[phase], started: now, finished: null, artefacts: [], decisions, blocked: null };
} else if (command === 'finished') {
  if (!openRun) {
    if (current && !current.blocked) die(`refused, nothing appended: phase ${phase} has no open run; its last entry (journal line ${current._line}) is already finished, and a second "finished" would drop its decisions. If the human's answer changed an artefact, record it with \`journal-append.mjs ${phase} decision --artefact <path> --decision <json>\`; to run the phase again, append \`journal-append.mjs ${phase} started\` first.`);
    die(`refused, nothing appended: phase ${phase} has no open run; append \`journal-append.mjs ${phase} started\` first.`);
  }
  const base = openRun;
  const paths = unique([...REQUIRED[phase], ...(base.artefacts ?? []).map((a) => a.path), ...opts.artefact]);
  entry = { ...base, finished: now, artefacts: hash(paths), decisions: [...(base.decisions ?? []), ...decisions], blocked: null };
} else if (command === 'decision') {
  if (!current) die(`phase ${phase} has no journal entry to record a decision on; append "started" first`);
  if (decisions.length === 0) die('decision needs at least one --decision');
  const base = strip(current);
  const before = new Map((base.artefacts ?? []).map((a) => [a.path, a.sha256]));
  const artefacts = base.finished == null && opts.artefact.length === 0 ? base.artefacts ?? []
    : hash(unique([...(base.artefacts ?? []).map((a) => a.path), ...opts.artefact]));
  for (const a of artefacts) if (before.has(a.path) && before.get(a.path) !== a.sha256) notes.push(`journal-append: ${a.path} changed since the last entry and is re-hashed`);
  entry = { ...base, artefacts, decisions: [...(base.decisions ?? []), ...decisions] };
} else {
  if (!opts.reason || !opts.needs) die('blocked needs --reason and --needs');
  const base = current ? strip(current) : { phase, skill: SKILL_OF[phase], started: now, artefacts: [], decisions: [] };
  entry = { ...base, finished: null, blocked: { reason: opts.reason, needs: opts.needs } };
}

if (command === 'finished' || command === 'decision') {
  const would = phaseStatus(root, phase, { ...entry, _line: 'to be appended' });
  if (would.status === 'invalid' || would.status === 'stale') die(`refused, nothing appended: ${would.detail}`);
}
for (const n of notes) console.log(n);

const path = journalPath(root);
const existing = readFileSync(path, 'utf8');
appendFileSync(path, `${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(entry)}\n`);
const after = load().entries;
const s = phaseStatus(root, phase, currentEntry(after, phase));
console.log(`journal-append: phase ${phase} ${command} appended; phase status now ${s.status}${s.detail ? ` (${s.detail})` : ''}`);
finish(after);
