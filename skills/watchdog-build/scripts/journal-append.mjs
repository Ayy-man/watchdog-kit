#!/usr/bin/env node
/**
 * journal-append.mjs: the only writer of .watchdog/journal.jsonl. Plain node,
 * no dependencies. Every command takes [--repo <root>] (default: cwd) and
 * regenerates .watchdog/STATE.md afterwards.
 *
 *   journal-append.mjs init [--mode step|run-ahead]
 *       First run: creates .watchdog/, .watchdog/inbox/ and the journal, whose
 *       first line is a meta entry holding the mode (default step) and the
 *       kit revision the build is pinned to. Asks nothing.
 *   journal-append.mjs --mode step|run-ahead
 *       Changes the mode by appending a meta entry; the kit pin is kept.
 *   journal-append.mjs <phase> started
 *       Opens a run of the phase. Refused for phase 1 and later until d0.scopes,
 *       d0.egress and d0.caps are approved, for phase 8 until d8.deployed is
 *       answered, and while the same phase already has an open run. Warns when
 *       an upstream phase in the dependency table is not finished or a decision
 *       the phase waits for is not resolved. Records the upstream artefacts it
 *       reads (inputs) and the decisions recorded so far (decisions_rev), and
 *       carries forward decisions answered early.
 *   journal-append.mjs <phase> finished [--artefact <path>]... [--decision <json>]...
 *       Closes the open run: hashes the phase's required artefacts, any
 *       already recorded and any --artefact paths, keeps the run's decisions,
 *       and fails when an input or a read decision changed since "started".
 *   journal-append.mjs <phase> decision --id <id> --outcome <outcome> --answer <text> --by <who> [--pre] [--at <ISO>] [--artefact <path>]...
 *   journal-append.mjs <phase> decision --decision <json> [--decision <json>]... [--artefact <path>]...
 *       Records a human's answer on the current entry and re-hashes its
 *       artefacts, so an answer written into an artefact (the holdout
 *       adjudication) is hashed after it was written. A decision with --pre
 *       (or one the catalogue records before its phase starts) may be recorded
 *       before the phase has an entry.
 *   journal-append.mjs <phase> blocked --reason <text> --needs <text>
 *
 * "finished" and "decision" run the shared predicate on the entry before
 * writing it. If the phase would be invalid or stale, nothing is appended and
 * the command exits 1 with every reason.
 *
 * A decision is JSON: {"id": "d0.scopes", "outcome": "approved", "answer": "...", "by": "...", "at": "<ISO, default now>", "pre": false}.
 */
import { appendFileSync, existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  D0, DECISIONS, DEPS, MODES, PHASES, PhaseError, REQUIRED, SKILL_OF, WAITS_FOR, captureInputs, currentEntry,
  decisionOf, decisionProblem, idsOf, isResolved, journalPath, kitRev, kitRevWarning, modeOf, outcomesOf, phaseStatus,
  pinnedRev, readJournal, sha256, writeState,
} from './journal-lib.mjs';

const die = (msg) => { console.error(`journal-append: ${msg}`); process.exit(1); };
const USAGE = 'usage: journal-append.mjs init [--mode step|run-ahead] | --mode step|run-ahead | <phase 0-8> <started|finished|decision|blocked> [--repo <root>] [--artefact <path>]... [--id <id> --outcome <o> --answer <text> --by <who> [--pre] [--at <ISO>]] [--decision <json>]... [--reason <text> --needs <text>]';

const args = process.argv.slice(2);
const opts = { artefact: [], decision: [], pre: false };
const positional = [];
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--pre') { opts.pre = true; continue; }
  if (a.startsWith('--')) {
    const key = a.slice(2); const value = args[++i];
    if (value === undefined) die(`${a} needs a value\n${USAGE}`);
    if (key === 'artefact' || key === 'decision') opts[key].push(value);
    else if (['repo', 'reason', 'needs', 'mode', 'id', 'outcome', 'answer', 'by', 'at'].includes(key)) opts[key] = value;
    else die(`unknown option ${a}\n${USAGE}`);
  } else positional.push(a);
}
const root = resolve(opts.repo ?? process.cwd());
const now = new Date().toISOString();
if (opts.mode !== undefined && !MODES.includes(opts.mode)) die(`--mode must be one of ${MODES.join(', ')}, got ${opts.mode}`);

let warned = false;
function load() {
  let j;
  try { j = readJournal(root); } catch (err) { if (err instanceof PhaseError) die(err.message); throw err; }
  const w = !warned && kitRevWarning(j.meta);
  if (w) { console.warn(`journal-append: ${w}`); warned = true; }
  return j;
}

function append(line) {
  const path = journalPath(root);
  const existing = readFileSync(path, 'utf8');
  appendFileSync(path, `${existing && !existing.endsWith('\n') ? '\n' : ''}${JSON.stringify(line)}\n`);
}

function finish() {
  const j = load();
  const { firstOpen, orientation } = writeState(root, j.entries, j.meta);
  console.log(`journal-append: STATE.md regenerated; current phase ${firstOpen ?? 'none, all done'}\n${orientation}`);
}

if (positional[0] === 'init') {
  mkdirSync(resolve(root, '.watchdog/inbox'), { recursive: true });
  const created = !existsSync(journalPath(root));
  if (created) writeFileSync(journalPath(root), '');
  const { entries, meta } = load();
  if (meta.length === 0) append({ meta: true, mode: opts.mode ?? 'step', kit_rev: kitRev(), at: now });
  else if (opts.mode && opts.mode !== modeOf(meta)) die(`journal already exists; change the mode with \`journal-append.mjs --mode ${opts.mode}\``);
  console.log(`journal-append: ${created ? 'created .watchdog/journal.jsonl and .watchdog/inbox/' : `journal already exists with ${entries.length} entries; left as it is`}; mode ${opts.mode ?? modeOf(meta)}`);
  finish();
  process.exit(0);
}

if (positional.length === 0 && opts.mode) {
  const { exists, meta } = load();
  if (!exists) die(`no journal at ${journalPath(root)}; run \`journal-append.mjs init --mode ${opts.mode}\` first`);
  append({ meta: true, mode: opts.mode, kit_rev: pinnedRev(meta) ?? kitRev(), at: now });
  console.log(`journal-append: mode now ${opts.mode}`);
  finish();
  process.exit(0);
}

const phase = Number(positional[0]);
const command = positional[1];
if (positional[0] === undefined || !Number.isInteger(phase) || !(phase in REQUIRED)) die(USAGE);
if (!['started', 'finished', 'decision', 'blocked'].includes(command)) die(USAGE);

const journal = load();
if (!journal.exists) die(`no journal at ${journalPath(root)}; run \`journal-append.mjs init\` first`);
const entries = journal.entries;
const current = currentEntry(entries, phase);
const strip = (e) => { if (!e) return e; const { _line, ...rest } = e; return rest; };
const openRun = current && !current.blocked && current.started != null && current.finished == null ? strip(current) : null;

const fixFor = (id) => `\`journal-append.mjs ${phase} decision --id ${id} --outcome ${DECISIONS[id] ? outcomesOf(id).join('|') : '<outcome>'} --answer <text> --by <who>\``;
const rawDecisions = opts.decision.map((raw) => { try { return JSON.parse(raw); } catch { return die(`--decision is not JSON: ${raw}`); } });
if (opts.id !== undefined) rawDecisions.push({ id: opts.id, outcome: opts.outcome, answer: opts.answer, by: opts.by, at: opts.at, pre: opts.pre });
const decisions = rawDecisions.map((d) => {
  const full = d && typeof d === 'object'
    ? { ...d, ...(DECISIONS[d.id] ? { kind: DECISIONS[d.id].kind } : {}), at: d.at ?? now, ...(d.id ? { pre: d.pre === true } : {}) }
    : d;
  const p = decisionProblem(full, phase);
  if (p) die(`refused, nothing appended: ${p}; record it as ${fixFor(full?.id && idsOf(phase).includes(full.id) ? full.id : idsOf(phase)[0] ?? '<id>')}`);
  return full;
});

function hash(paths) {
  const missing = paths.filter((p) => sha256(root, p) === null);
  if (missing.length) die(`artefacts missing on disk, nothing appended: ${missing.join(', ')}; write them, then run \`journal-append.mjs ${phase} ${command}\` again`);
  return paths.map((path) => ({ path, sha256: sha256(root, path) }));
}
const unique = (xs) => [...new Set(xs)];

let entry;
const notes = [];
if (command === 'started') {
  if (openRun) die(`refused, nothing appended: phase ${phase} already has an open run (started ${current.started}, journal line ${current._line}); close it with \`journal-append.mjs ${phase} finished\`, or abandon it with \`journal-append.mjs ${phase} blocked --reason <text> --needs <text>\``);
  if (phase >= 1) {
    const missing = D0.filter((id) => decisionOf(entries, id)?.outcome !== 'approved');
    if (missing.length) die(`refused, nothing appended: phase ${phase} needs d0.scopes, d0.egress and d0.caps approved first (not approved: ${missing.join(', ')}); record each with \`journal-append.mjs 0 decision --id ${missing[0]} --outcome approved --answer <what was approved> --by <who>\``);
  }
  const carried = (current?.decisions ?? []).filter((d) => current.started == null || d?.pre === true || DECISIONS[d?.id]?.beforeStart);
  for (const id of idsOf(phase).filter((i) => DECISIONS[i].beforeStart)) {
    if (!carried.some((d) => d.id === id && !decisionProblem(d, phase))) die(`refused, nothing appended: phase ${phase} cannot start until ${id} is recorded; record it with ${fixFor(id)}`);
  }
  const behind = DEPS[phase].filter((p) => { const e = currentEntry(entries, p); return !e || e.blocked || e.finished == null; });
  if (behind.length) console.warn(`journal-append: warning, phase ${phase} reads artefacts from phases not finished: ${behind.join(', ')}; finish them first (\`journal-append.mjs ${behind[0]} finished\`)`);
  const waiting = (WAITS_FOR[phase] ?? []).filter((id) => !isResolved(entries, id));
  if (waiting.length) console.warn(`journal-append: warning, phase ${phase} waits for ${waiting.join(', ')}; build what does not need ${waiting.length > 1 ? 'them' : 'it'} and stop there until ${waiting.length > 1 ? 'they are' : 'it is'} recorded with \`journal-append.mjs ${DECISIONS[waiting[0]].phase} decision --id ${waiting[0]} ...\``);
  entry = { phase, skill: SKILL_OF[phase], started: now, finished: null, artefacts: [], ...captureInputs(root, entries, phase), decisions: [...carried, ...decisions], blocked: null };
} else if (command === 'finished') {
  if (!openRun) {
    if (current && !current.blocked && current.started != null) die(`refused, nothing appended: phase ${phase} has no open run; its last entry (journal line ${current._line}) is already finished, and a second "finished" would drop its decisions. If the human's answer changed an artefact, record it with \`journal-append.mjs ${phase} decision --artefact <path> --id <id> ...\`; to run the phase again, append \`journal-append.mjs ${phase} started\` first.`);
    die(`refused, nothing appended: phase ${phase} has no open run; append \`journal-append.mjs ${phase} started\` first.`);
  }
  const base = openRun;
  const paths = unique([...REQUIRED[phase], ...(base.artefacts ?? []).map((a) => a.path), ...opts.artefact]);
  entry = { ...base, finished: now, artefacts: hash(paths), decisions: [...(base.decisions ?? []), ...decisions], blocked: null };
} else if (command === 'decision') {
  if (decisions.length === 0) die(`decision needs --id <id> --outcome <o> --answer <text> --by <who>, or --decision <json>; ${phase} takes ${idsOf(phase).join(', ') || 'no catalogue ids'}`);
  const early = decisions.every((d) => d.pre === true || DECISIONS[d.id]?.beforeStart);
  if (!current || current.started == null) {
    if (!early) die(`phase ${phase} has not started, and only a decision answered early (--pre) can be recorded before it does; append \`journal-append.mjs ${phase} started\` first`);
    entry = { phase, skill: SKILL_OF[phase], started: null, finished: null, artefacts: [], decisions: [...(current?.decisions ?? []), ...decisions], blocked: null };
  } else {
    const base = strip(current);
    const before = new Map((base.artefacts ?? []).map((a) => [a.path, a.sha256]));
    const artefacts = base.finished == null && opts.artefact.length === 0 ? base.artefacts ?? []
      : hash(unique([...(base.artefacts ?? []).map((a) => a.path), ...opts.artefact]));
    for (const a of artefacts) if (before.has(a.path) && before.get(a.path) !== a.sha256) notes.push(`journal-append: ${a.path} changed since the last entry and is re-hashed`);
    entry = { ...base, artefacts, decisions: [...(base.decisions ?? []), ...decisions] };
  }
} else {
  if (!opts.reason || !opts.needs) die('blocked needs --reason and --needs');
  const base = current ? strip(current) : { phase, skill: SKILL_OF[phase], started: now, artefacts: [], decisions: [] };
  entry = { ...base, finished: null, blocked: { reason: opts.reason, needs: opts.needs } };
}

if (command === 'finished' || command === 'decision') {
  const would = phaseStatus(root, phase, { ...entry, _line: 'to be appended' }, entries);
  if (would.status === 'invalid' || would.status === 'stale') {
    const bad = would.problems.filter((p) => p.kind === 'invalid' || p.kind === 'stale');
    die(`refused, nothing appended:\n${bad.map((p) => `- ${p.msg}; fix: ${p.fix}`).join('\n')}`);
  }
}
for (const n of notes) console.log(n);

append(entry);
const after = load().entries;
const s = phaseStatus(root, phase, currentEntry(after, phase), after);
console.log(`journal-append: phase ${phase} ${command} appended; phase status now ${s.status}${s.detail ? ` (${s.detail})` : ''}`);
finish();
