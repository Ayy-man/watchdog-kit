/**
 * journal-lib.mjs: the one definition of "phase done", shared by
 * validate-phase.mjs, state-from-journal.mjs and journal-append.mjs, so that
 * STATE.md can never say done while validation fails. Plain node, no
 * dependencies.
 *
 * A phase is done when its last journal entry has ISO started and finished
 * times, is not blocked, records every required artefact, every recorded
 * artefact reads back from disk with the sha256 the entry holds (the read-back
 * result), the upstream inputs and decisions it read at "started" are
 * unchanged, every decision id the catalogue gives the phase is approved or
 * answered by a human with an ISO at, and the artefacts pass the content
 * checks below. Every failure is collected, not only the first.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

export const PHASES = [
  [0, 'watchdog-survey'], [1, 'watchdog-explain'], [2, 'watchdog-incidents'], [3, 'watchdog-heartbeats'],
  [4, 'watchdog-checks'], [5, 'watchdog-review'], [6, 'watchdog-page'], [7, 'watchdog-eval'], [8, 'watchdog-prove'],
];
export const SKILL_OF = Object.fromEntries(PHASES);
export const STATUS_WORDS = ['proven', 'failed', 'unknown', 'unsupported'];
export const MODES = ['step', 'run-ahead'];
const GATES = ['doors_no_unknowns_hidden', 'holdout_recall_by_severity', 'live_findings_adjudicated',
  'model_eval_all_cases_counted', 'own_key_own_budget', 'forbidden_write_fails', 'real_sweep_observed'];
export const REQUIRED = {
  0: ['.watchdog/MAPPING.md', '.watchdog/CONTRACT.md', '.watchdog/EGRESS.md', '.watchdog/incident-sample.jsonl'],
  1: ['.watchdog/explainer.html', '.watchdog/CANVAS.md'],
  2: ['docs/incidents/incidents.jsonl', 'docs/incidents/holdout.json'],
  3: ['.watchdog/HEARTBEATS.md'],
  4: ['.watchdog/OBLIGATIONS.md', '.watchdog/CHECKS.md'],
  5: ['.watchdog/REVIEW.md'],
  6: ['.watchdog/PAGE.md'],
  7: ['.watchdog/EVAL.md'],
  8: ['.watchdog/REPORT.md'],
};
const SECTIONS = {
  '.watchdog/MAPPING.md': ['Stack', 'Existing monitoring', 'Sources'],
  '.watchdog/CONTRACT.md': ['Obligations', 'Unsupported and unknown', 'Shared external ids'],
  '.watchdog/EGRESS.md': ['Pseudonym', 'Fields', 'Retention'],
  '.watchdog/CANVAS.md': ['Box and doors', 'Tokens', 'Parts', 'Keyboard path', 'Empty, erroring and unknown states'],
  '.watchdog/HEARTBEATS.md': ['Wrapper', 'Jobs', 'Parity', 'Doors', 'Role'],
  '.watchdog/CHECKS.md': ['Obligations', 'Clusters', 'Checks', 'Evals', 'Live dry run', 'Adjudication'],
  '.watchdog/REVIEW.md': ['Packets', 'Grounding', 'Slots', 'Models', 'Bake-off', 'Decision'],
  '.watchdog/PAGE.md': ['Page', 'Trace', 'Verdicts', 'Alerts', 'Hub'],
  '.watchdog/EVAL.md': ['Existing monitoring comparison', 'Unsupported and unknown'],
  '.watchdog/REPORT.md': ['Unsupported and unknown'],
};

// ---- decision catalogue (shared-contract.md, "Decisions") -------------------
// pre: may be answered before its phase runs (recorded with pre: true).
// optional: only required once the phase asks for it.
// rule: the one `by` a rule may record instead of a human.
// varName: the answer is an environment variable name, never its value.
// beforeStart: recorded before the phase starts, and the phase cannot start without it.
export const DECISIONS = {
  'd0.scopes': { phase: 0, kind: 'authorisation' },
  'd0.egress': { phase: 0, kind: 'authorisation' },
  'd0.caps': { phase: 0, kind: 'authorisation' },
  'd1.explainer': { phase: 1, kind: 'approval' },
  'd1.canvas': { phase: 1, kind: 'approval' },
  'd2.holdout': { phase: 2, kind: 'verdicts' },
  'd3.credential': { phase: 3, kind: 'credential', pre: true, optional: true, varName: true },
  'd4.verdicts': { phase: 4, kind: 'verdicts' },
  'd5.key': { phase: 5, kind: 'credential', pre: true, varName: true },
  'd5.cap': { phase: 5, kind: 'choice', pre: true },
  'd5.model': { phase: 5, kind: 'choice', pre: true, rule: 'rule:d5.model' },
  'd5.slots': { phase: 5, kind: 'choice', pre: true },
  'd7.eval': { phase: 7, kind: 'authorisation' },
  'd7.merge': { phase: 7, kind: 'authorisation' },
  'd8.deployed': { phase: 8, kind: 'credential', beforeStart: true },
};
export const D0 = ['d0.scopes', 'd0.egress', 'd0.caps'];
const APPROVAL_KINDS = new Set(['authorisation', 'approval']);
export const outcomesOf = (id) => (APPROVAL_KINDS.has(DECISIONS[id].kind) ? ['approved', 'rejected'] : ['answered']);
export const idsOf = (phase) => Object.keys(DECISIONS).filter((id) => DECISIONS[id].phase === phase);
export const requiredIds = (phase) => idsOf(phase).filter((id) => !DECISIONS[id].optional);
export const STOP_PHASES = new Set(PHASES.map(([p]) => p).filter((p) => requiredIds(p).length));

// ---- dependencies (shared-contract.md, "Dependencies and parallel phases") --
/** Phases whose artefacts a phase reads; their files are hashed into `inputs` at "started". */
export const DEPS = { 0: [], 1: [0], 2: [0], 3: [0], 4: [2, 3], 5: [4], 6: [4, 5], 7: [2, 4, 5, 6], 8: [7] };
/**
 * Upstream files a phase does not read, so the human's later write into them
 * is not drift: phase 4 starts before the holdout is adjudicated, and phase 5
 * starts before the live findings are adjudicated into CHECKS.md.
 */
const NOT_READ = { 4: ['docs/incidents/holdout.json'], 5: ['.watchdog/CHECKS.md'] };
/** Decisions a phase waits for besides d0.*; "started" warns while they are not resolved. */
export const WAITS_FOR = { 5: ['d4.verdicts'], 6: ['d1.explainer', 'd1.canvas'], 7: ['d2.holdout', 'd4.verdicts'], 8: ['d7.merge'] };

/** A content or journal problem; message is what the human reads. */
export class PhaseError extends Error {}
const fail = (msg) => { throw new PhaseError(msg); };

/**
 * The repo root from the command line: `--repo <root>` or the positional
 * argument at `index`, else the working directory. Returns { root, rest }
 * where rest is argv with --repo and its value removed.
 */
export function parseRoot(argv, index) {
  const rest = [];
  let repo;
  for (let i = 0; i < argv.length; i++) {
    if (argv[i] === '--repo') { repo = argv[++i]; if (repo === undefined) throw new PhaseError('--repo needs a path'); }
    else if (argv[i].startsWith('--repo=')) repo = argv[i].slice(7);
    else rest.push(argv[i]);
  }
  if (repo === undefined && index !== undefined && rest[index] !== undefined) {
    if (rest[index].startsWith('-')) throw new PhaseError(`unknown option ${rest[index]}`);
    repo = rest[index];
  }
  return { root: resolve(repo ?? process.cwd()), rest };
}

export const journalPath = (root) => resolve(root, '.watchdog/journal.jsonl');

/**
 * Lines numbered as an editor numbers them, blank lines included. Phase
 * entries go to `entries`; `{ "meta": true }` lines (mode, kit_rev) to `meta`.
 */
export function readJournal(root) {
  const path = journalPath(root);
  if (!existsSync(path)) return { exists: false, entries: [], meta: [] };
  const entries = [];
  const meta = [];
  readFileSync(path, 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let e;
    try { e = JSON.parse(l); } catch (err) { fail(`journal line ${i + 1} is not JSON (${err.message}); fix or remove that line in ${path}`); }
    if (e && typeof e === 'object' && e.meta === true) { meta.push({ ...e, _line: i + 1 }); return; }
    if (!e || typeof e !== 'object' || !Number.isInteger(e.phase)) fail(`journal line ${i + 1} has no integer "phase"`);
    entries.push({ ...e, _line: i + 1 });
  });
  return { exists: true, entries, meta };
}

export const currentEntry = (entries, phase) => entries.filter((e) => e.phase === phase).at(-1);
export const modeOf = (meta) => meta.at(-1)?.mode ?? 'step';
export const pinnedRev = (meta) => meta.find((m) => m.kit_rev)?.kit_rev ?? null;

export function sha256(root, path) {
  const full = resolve(root, path);
  return existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null;
}
const shaOf = (value) => createHash('sha256').update(JSON.stringify(value)).digest('hex');

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const isIso = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));

// ---- kit revision -----------------------------------------------------------

/** The running kit's revision: the checkout's git HEAD, else core/VERSION, else null. */
export function kitRev() {
  const kit = resolve(dirname(fileURLToPath(import.meta.url)), '..', 'kit');
  let real;
  try { real = realpathSync(kit); } catch { return null; }
  try {
    const top = execFileSync('git', ['-C', real, 'rev-parse', '--show-toplevel'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
    if (realpathSync(top) === real) return execFileSync('git', ['-C', real, 'rev-parse', 'HEAD'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] }).trim();
  } catch { /* not a checkout */ }
  const version = resolve(real, 'core/VERSION');
  return existsSync(version) ? `VERSION ${readFileSync(version, 'utf8').trim()}` : null;
}

/** One warning line when the running kit differs from the one init pinned, else null. */
export function kitRevWarning(meta) {
  const pinned = pinnedRev(meta);
  const now = kitRev();
  if (!pinned || !now || pinned === now) return null;
  const fix = pinned.startsWith('VERSION ') ? 'reinstall the pinned kit version' : `run \`git -C ${resolve(dirname(fileURLToPath(import.meta.url)), '..', 'kit')} checkout ${pinned}\``;
  return `warning, the kit is at ${now} but this build was pinned to ${pinned} at init; ${fix} to finish the build with the kit it started on`;
}

// ---- decisions --------------------------------------------------------------

const recordCmd = (phase, id) => `\`journal-append.mjs ${phase} decision --id ${id} --outcome ${outcomesOf(id).join('|')} --answer <text> --by <who>\``;

/** Why one decision is invalid for `phase`, or null when it is valid. */
export function decisionProblem(d, phase) {
  const ids = idsOf(phase);
  if (!d || typeof d !== 'object') return 'a decision is not a JSON object';
  if (d.id == null) {
    if (ids.length) return `decision "${d.question ?? d.answer ?? '?'}" needs id (one of ${ids.join(', ')})`;
    // A phase with no catalogue ids keeps the old { question, answer, by, at } shape.
    if (!String(d.answer ?? '').trim() || !String(d.by ?? '').trim()) return `decision "${d.question ?? '?'}" needs a non-empty answer and by`;
    return isIso(d.at) ? null : `decision "${d.question ?? '?'}" has at "${d.at}", not an ISO 8601 timestamp`;
  }
  const c = DECISIONS[d.id];
  if (!c) return `unknown decision id "${d.id}" (phase ${phase} takes ${ids.join(', ') || 'none'})`;
  if (c.phase !== phase) return `${d.id} belongs to phase ${c.phase}, not phase ${phase}`;
  const outcomes = outcomesOf(d.id);
  if (d.outcome == null || d.outcome === '') return `${d.id} has no outcome (one of ${outcomes.join(', ')})`;
  if (!outcomes.includes(d.outcome)) return `${d.id} outcome "${d.outcome}" is not one of ${outcomes.join(', ')}`;
  if (!String(d.answer ?? '').trim()) return `${d.id} has an empty answer`;
  const by = String(d.by ?? '').trim();
  if (!by) return `${d.id} has no "by"`;
  if (by.startsWith('rule:') && by !== c.rule) return `${d.id} by "${by}" is not a person; only d5.model may be recorded by rule:d5.model`;
  if (!isIso(d.at)) return `${d.id} has at "${d.at}", not an ISO 8601 timestamp`;
  if (d.pre === true && !c.pre) return `${d.id} cannot be answered before its phase runs (pre: true)`;
  if (c.varName && !/^[A-Z][A-Z0-9_]*$/.test(String(d.answer).trim())) return `${d.id} answer must be an environment variable name such as WATCHDOG_API_KEY, never its value`;
  return null;
}

/** The last decision recorded for each catalogue id on one entry. */
export function latestDecisions(entry) {
  const out = new Map();
  for (const d of Array.isArray(entry?.decisions) ? entry.decisions : []) if (d && DECISIONS[d.id]) out.set(d.id, d);
  return out;
}

const resolved = (d, phase) => d && !decisionProblem(d, phase) && d.outcome !== 'rejected';

/** The latest valid decision for `id` in the journal (on its phase's current entry), or undefined. */
export function decisionOf(entries, id) {
  const d = latestDecisions(currentEntry(entries, DECISIONS[id].phase)).get(id);
  return d && !decisionProblem(d, DECISIONS[id].phase) ? d : undefined;
}
export const isResolved = (entries, id) => resolved(decisionOf(entries, id), DECISIONS[id].phase);

// ---- input capture at "started" ---------------------------------------------

/** Upstream artefact paths the phase reads, from the dependency table and the upstream entries. */
export function inputPaths(entries, phase) {
  const skip = new Set(NOT_READ[phase] ?? []);
  const paths = DEPS[phase].flatMap((dep) => [...REQUIRED[dep], ...(currentEntry(entries, dep)?.artefacts ?? []).map((a) => a.path)]);
  return [...new Set(paths)].filter((p) => !skip.has(p));
}

/** The decisions of other phases, latest per id in catalogue order, each hashed. */
function decisionSnapshot(entries, phase) {
  const read = {};
  const list = [];
  for (const id of Object.keys(DECISIONS)) {
    if (DECISIONS[id].phase === phase) continue;
    const d = latestDecisions(currentEntry(entries, DECISIONS[id].phase)).get(id);
    if (!d) continue;
    const { _line, ...clean } = d;
    read[id] = shaOf(clean);
    list.push(clean);
  }
  return { read, rev: shaOf(list) };
}

/** What "started" records: { inputs, decisions_rev, decisions_read }. */
export function captureInputs(root, entries, phase) {
  const inputs = inputPaths(entries, phase).map((path) => ({ path, sha256: sha256(root, path) })).filter((i) => i.sha256);
  const { read, rev } = decisionSnapshot(entries, phase);
  return { inputs, decisions_rev: rev, decisions_read: read };
}

/** Problems for inputs or read decisions that changed since the entry started. */
function driftProblems(root, phase, entry, entries) {
  const out = [];
  const now = decisionSnapshot(entries, phase).read;
  const drifted = [];
  for (const i of Array.isArray(entry.inputs) ? entry.inputs : []) {
    const disk = sha256(root, i.path);
    if (disk === i.sha256) continue;
    const owner = DEPS[phase].find((dep) => [...REQUIRED[dep], ...(currentEntry(entries, dep)?.artefacts ?? []).map((a) => a.path)].includes(i.path));
    const recorded = (currentEntry(entries, owner)?.artefacts ?? []).find((a) => a.path === i.path)?.sha256;
    // An upstream file edited without a journal record invalidates its owner; one the owner re-recorded invalidates the readers.
    const first = owner !== undefined && recorded !== disk ? owner : earliestReader(entries, phase, (e) => (e.inputs ?? []).some((x) => x.path === i.path && x.sha256 !== disk));
    drifted.push({ what: `${i.path}${disk === null ? ' (now missing)' : ''}${owner !== undefined ? ` from phase ${owner}` : ''}`, first });
  }
  for (const [id, sha] of Object.entries(entry.decisions_read ?? {})) {
    if (now[id] === sha) continue;
    const first = earliestReader(entries, phase, (e) => e.decisions_read && id in e.decisions_read && e.decisions_read[id] !== now[id]);
    drifted.push({ what: `decision ${id}${now[id] ? ' (re-recorded)' : ' (no longer recorded)'}`, first });
  }
  if (drifted.length) {
    const first = Math.min(...drifted.map((d) => d.first));
    for (const d of drifted) {
      out.push({ kind: 'stale', msg: `phase ${phase} input changed since it started: ${d.what}; earliest invalidated phase ${first}`, fix: `re-run from phase ${first}: \`journal-append.mjs ${first} started\`` });
    }
  }
  return out;
}

/** The earliest phase up to `phase` whose current entry read the changed thing. */
function earliestReader(entries, phase, readIt) {
  for (const [p] of PHASES) {
    if (p >= phase) break;
    const e = currentEntry(entries, p);
    if (e && readIt(e)) return p;
  }
  return phase;
}

// ---- the predicate ----------------------------------------------------------

const PRIORITY = ['invalid', 'stale', 'sent back', 'awaiting decision'];

/** Journal-level checks: everything except artefact content. Returns { status, detail, problems }. */
export function journalStatus(root, phase, entry, entries = []) {
  const one = (status, msg, fix) => ({ status, detail: msg, problems: [{ kind: status, msg, fix }] });
  if (!entry) return one('not started', `no journal entry for phase ${phase}`, `run the phase: \`journal-append.mjs ${phase} started\``);
  if (entry.blocked) return one('blocked', `phase ${phase} is blocked: ${entry.blocked.reason ?? 'no reason given'}${entry.blocked.needs ? `; needs ${entry.blocked.needs}` : ''}`, `provide what it needs, then \`journal-append.mjs ${phase} started\``);
  if (entry.started == null) {
    const early = (entry.decisions ?? []).map((d) => d?.id).filter(Boolean);
    return one('not started', `phase ${phase} has not started${early.length ? ` (answered early: ${early.join(', ')})` : ''}`, `run the phase: \`journal-append.mjs ${phase} started\``);
  }
  const at = `journal line ${entry._line}`;
  if (!isIso(entry.started)) return one('invalid', `${at}: started "${entry.started}" is not an ISO 8601 timestamp`, `re-run the phase: \`journal-append.mjs ${phase} started\``);
  if (entry.finished == null) return one('in progress', `phase ${phase} has no finished time`, `close the run: \`journal-append.mjs ${phase} finished\``);

  const problems = [];
  const add = (kind, msg, fix) => problems.push({ kind, msg, fix });
  const rerun = `re-run the phase: \`journal-append.mjs ${phase} started\``;
  if (!isIso(entry.finished)) add('invalid', `${at}: finished "${entry.finished}" is not an ISO 8601 timestamp`, rerun);

  const decisions = Array.isArray(entry.decisions) ? entry.decisions : [];
  for (const d of decisions) if (!d || !DECISIONS[d.id]) { const p = decisionProblem(d, phase); if (p) add('invalid', `${at}: ${p}`, rerun); }
  const latest = latestDecisions(entry);
  for (const [id, d] of latest) { const p = decisionProblem(d, phase); if (p) add('invalid', `${at}: ${p}`, `record it again: ${recordCmd(phase, id)}`); }

  const artefacts = Array.isArray(entry.artefacts) ? entry.artefacts : [];
  if (artefacts.length === 0) add('invalid', `phase ${phase} recorded no artefacts`, rerun);
  const recorded = new Set(artefacts.map((a) => a.path));
  const missing = REQUIRED[phase].filter((p) => !recorded.has(p));
  if (missing.length && artefacts.length) add('invalid', `phase ${phase} must record ${missing.join(', ')} in its artefacts`, rerun);
  for (const a of artefacts) {
    const actual = sha256(root, a.path);
    const remedy = `re-run the phase, or if the human's answer caused the edit, \`journal-append.mjs ${phase} decision --artefact ${a.path} --id <id> ...\``;
    if (actual === null) add('stale', `artefact missing on disk: ${a.path}`, remedy);
    else if (actual !== a.sha256) add('stale', `sha256 mismatch for ${a.path} (journal ${String(a.sha256).slice(0, 12)}, disk ${actual.slice(0, 12)}): it changed after the journal recorded it`, remedy);
  }
  problems.push(...driftProblems(root, phase, entry, entries));

  const waiting = [];
  for (const id of requiredIds(phase)) {
    const d = latest.get(id);
    if (d && decisionProblem(d, phase)) continue; // already reported as invalid
    if (!d) waiting.push(id);
    else if (d.outcome === 'rejected') add('sent back', `sent back: ${id} rejected`, `revise and re-run the phase: \`journal-append.mjs ${phase} started\``);
  }
  if (waiting.length) add('awaiting decision', `phase ${phase} awaits ${waiting.join(', ')}`, waiting.map((id) => recordCmd(phase, id)).join('; '));

  const status = PRIORITY.find((k) => problems.some((p) => p.kind === k)) ?? 'ok';
  return { status, detail: problems.find((p) => p.kind === status)?.msg ?? '', problems, waiting };
}

/** The shared predicate. Returns { done, status, detail, problems }. */
export function phaseStatus(root, phase, entry, entries = []) {
  const j = journalStatus(root, phase, entry, entries);
  if (!['ok', 'invalid', 'stale', 'sent back', 'awaiting decision'].includes(j.status)) return { done: false, ...j };
  // Content is checked as soon as the run is finished, not only after the human answers, so a
  // copied template fails at "finished" instead of being put to the human. Before every answer is
  // in, the fields only the answer can fill (the holdout's adjudication) are not yet required.
  const beforeDecision = j.problems.some((p) => p.kind === 'awaiting decision' || p.kind === 'sent back');
  const fix = `fix the file, then \`journal-append.mjs ${phase} finished\` (after \`journal-append.mjs ${phase} started\` if the run is closed)`;
  const content = checkContent(root, phase, { beforeDecision }).map((msg) => ({ kind: 'invalid', msg, fix }));
  const problems = [...content, ...j.problems];
  // Order: invalid first, then the journal's own order.
  problems.sort((a, b) => PRIORITY.indexOf(a.kind) - PRIORITY.indexOf(b.kind));
  const status = PRIORITY.find((k) => problems.some((p) => p.kind === k)) ?? 'ok';
  if (status === 'ok') return { done: true, status: 'done', detail: '', problems: [] };
  return { done: false, status, detail: problems[0].msg, problems, waiting: j.waiting };
}

// ---- content checks -------------------------------------------------------

const text = (root, path) => readFileSync(resolve(root, path), 'utf8');

/** Lines outside fenced code blocks, with their 1-based line numbers. */
function proseLines(body) {
  let fenced = false;
  return body.split('\n').map((l, i) => ({ l, n: i + 1 })).filter(({ l }) => {
    if (/^\s*(```|~~~)/.test(l)) { fenced = !fenced; return false; }
    return !fenced;
  });
}

// A template placeholder: braces round text with no quote in it, so JSON
// objects and ${...} template literals are not mistaken for one. A literal
// brace in prose belongs in a fenced code block or an inline code span.
const PLACEHOLDER = /(?<!\$)\{[^{}"\n]*[^\s{}"][^{}"\n]*\}/;

function noPlaceholders(root, path, report) {
  for (const { l, n } of proseLines(text(root, path))) {
    // An inline code span is code, not prose: a JSON shape in backticks is fine.
    const m = l.replace(/`[^`\n]*`/g, '').match(PLACEHOLDER);
    if (m) report(`${path} line ${n} still holds the template placeholder ${m[0]}; fill it or remove the line`);
  }
}

function requireSections(root, path, report) {
  const lines = proseLines(text(root, path));
  for (const name of SECTIONS[path] ?? []) {
    // Sections are level 2 to 4, so a title such as "# Checks: acme" is not taken for "## Checks".
    const re = new RegExp(`^(#{2,4})\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\s*:)`, 'i');
    const i = lines.findIndex(({ l }) => re.test(l));
    if (i < 0) { report(`${path} is missing a "${name}" section`); continue; }
    const level = lines[i].l.match(re)[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].l.match(/^(#{1,6})\s/);
      if (h && h[1].length <= level) break;
      body.push(lines[j].l);
    }
    const content = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
      .filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
    if (content.length === 0) report(`${path}: the "${name}" section is empty`);
  }
}

function checkContract(root, path) {
  const lines = text(root, path).split('\n');
  const header = lines.findIndex((l) => /^\|\s*Door\s*\|/i.test(l));
  if (header < 0) fail(`${path} has no doors table`);
  const cols = lines[header].split('|').map((c) => c.trim().toLowerCase());
  const col = (name) => { const i = cols.findIndex((c) => c.startsWith(name)); if (i < 0) fail(`${path} doors table has no "${name}" column`); return i; };
  const proofCol = col('proof it fired'); const ppCol = col('proof-of-proof');
  // A Status column is optional; without one the proof cell must open with the status word ("proven: row + column").
  const statusCol = cols.findIndex((c) => c === 'status');
  const doors = [];
  for (let i = header + 2; i < lines.length && lines[i].trim().startsWith('|'); i++) {
    const cells = lines[i].split('|').map((c) => c.trim());
    if (cells.length < cols.length) continue;
    const door = cells[1];
    cells.forEach((c, k) => { if (PLACEHOLDER.test(c)) fail(`${path} line ${i + 1}: door "${door}" column "${cols[k]}" still holds a template placeholder`); });
    if (!cells[proofCol]) fail(`${path}: door "${door}" has an empty proof cell`);
    if (!cells[ppCol]) fail(`${path}: door "${door}" has an empty proof-of-proof cell`);
    const status = (statusCol >= 0 ? cells[statusCol] : cells[proofCol].split(/[:\s]/)[0]).toLowerCase();
    if (!STATUS_WORDS.includes(status)) fail(`${path}: door "${door}" status "${status}" is not one of ${STATUS_WORDS.join(', ')}`);
    doors.push({ door: door.replace(/`/g, ''), status });
  }
  if (doors.length === 0) fail(`${path} doors table has no rows`);
  return doors;
}

/** The doors_no_unknowns_hidden gate: every unknown or unsupported door in the contract is listed in the artefact's "Unsupported and unknown" section. */
function checkUnknownsListed(root, path, report) {
  if (!existsSync(resolve(root, '.watchdog/CONTRACT.md'))) fail(`${path}: .watchdog/CONTRACT.md is missing, so the unknown doors cannot be compared`);
  const hidden = checkContract(root, '.watchdog/CONTRACT.md').filter((d) => d.status === 'unknown' || d.status === 'unsupported');
  const lines = proseLines(text(root, path)).map(({ l }) => l);
  const start = lines.findIndex((l) => /^#{2,4}\s+Unsupported and unknown\b/i.test(l));
  const level = start < 0 ? 2 : lines[start].match(/^#+/)[0].length;
  const body = [];
  for (let j = start + 1; start >= 0 && j < lines.length; j++) { const h = lines[j].match(/^(#{1,6})\s/); if (h && h[1].length <= level) break; body.push(lines[j]); }
  const section = body.join('\n');
  const esc = (x) => x.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  for (const { door, status } of hidden) {
    if (!new RegExp(`(^|[^\\w-])${esc(door)}($|[^\\w-])`).test(section)) report(`${path}: door "${door}" is ${status} in CONTRACT.md but not listed under "Unsupported and unknown"`);
  }
}

function checkIncidents(root, path, report) {
  const ids = new Set();
  text(root, path).split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let row;
    try { row = JSON.parse(l); } catch { report(`${path} line ${i + 1} is not JSON`); return; }
    const where = `${path} line ${i + 1} (${row?.id ?? '?'})`;
    try {
      for (const f of ['id', 'found_by', 'kind', 'root_cause']) if (!row[f]) fail(`${where} lacks "${f}"`);
      const w = row.watchdog;
      if (!w || typeof w !== 'object') fail(`${where} lacks "watchdog"`);
      if (!('check' in w)) fail(`${where}: watchdog.check must be a check id or null`);
      if (!['yes', 'partly', 'no'].includes(w.catchable)) fail(`${where}: watchdog.catchable must be yes, partly or no`);
      if (!w.why) fail(`${where}: watchdog.why is empty`);
      if (!Array.isArray(row.existing_detection)) fail(`${where}: existing_detection must be a list (empty when no existing monitoring)`);
      for (const d of row.existing_detection) {
        if (!d.source) fail(`${where}: existing_detection record has no source`);
        if (!['yes', 'no', 'unknown'].includes(d.status)) fail(`${where}: existing_detection.status for ${d.source} must be yes, no or unknown`);
        if (d.status === 'no' && !(Array.isArray(d.evidence) && d.evidence.length)) fail(`${where}: existing_detection "no" for ${d.source} needs evidence of complete history`);
      }
      if (ids.has(row.id)) fail(`${path}: duplicate id ${row.id}`);
    } catch (err) { if (err instanceof PhaseError) report(err.message); else throw err; }
    if (row?.id) ids.add(row.id);
  });
  return ids;
}

function checkHoldout(root, path, ids, beforeDecision, report) {
  let h; try { h = JSON.parse(text(root, path)); } catch (err) { if (err.code === 'ENOENT') throw err; fail(`${path} is not JSON`); }
  if (!h || Array.isArray(h) || !Array.isArray(h.cases)) fail(`${path} must be an object with "frozen_at" and "cases"`);
  if (h.cases.length === 0) fail(`${path} lists no cases`);
  if (!beforeDecision && !isIso(h.frozen_at)) report(`${path}: frozen_at is not an ISO 8601 timestamp; the orchestrator sets it when it writes the human's adjudication`);
  for (const c of h.cases) {
    if (!ids.has(c.id)) report(`${path}: case ${c.id} is not in incidents.jsonl`);
    if (!beforeDecision && !c.adjudicated_by) report(`${path}: case ${c.id} has no adjudicated_by`);
    if (!beforeDecision && !isIso(c.adjudicated_at)) report(`${path}: case ${c.id} adjudicated_at is not an ISO 8601 timestamp`);
    if (c.replayable === false) { if (!c.reason) report(`${path}: unreplayable case ${c.id} gives no reason`); continue; }
    if (!c.as_of || !c.detect_by) report(`${path}: case ${c.id} needs as_of and detect_by`);
  }
}

function checkEval(root, path, report) {
  const body = text(root, path);
  for (const gate of GATES) {
    const line = body.split('\n').find((l) => l.includes(gate) && l.trim().startsWith('|'));
    if (!line) { report(`${path} has no table row for gate ${gate}`); continue; }
    const value = line.split('|').map((c) => c.trim()).filter(Boolean)[1] ?? '';
    if (!value || /^(tbd|todo|\?|-|n\/a)$/i.test(value) || PLACEHOLDER.test(value)) report(`${path}: gate ${gate} has no value`);
  }
}

/** Every content failure for the phase, as messages. A missing file is reported by the journal checks, not here. */
export function checkContent(root, phase, { beforeDecision = false } = {}) {
  const out = [];
  const report = (msg) => out.push(msg);
  const unit = (fn) => {
    try { fn(); } catch (err) {
      if (err instanceof PhaseError) report(err.message);
      else if (err?.code !== 'ENOENT') throw err;
    }
  };
  for (const path of REQUIRED[phase]) {
    if (path.endsWith('.md')) { unit(() => noPlaceholders(root, path, report)); unit(() => requireSections(root, path, report)); }
  }
  if (phase === 0) { unit(() => checkContract(root, '.watchdog/CONTRACT.md')); unit(() => checkIncidents(root, '.watchdog/incident-sample.jsonl', report)); }
  if (phase === 2) {
    unit(() => {
      const ids = checkIncidents(root, 'docs/incidents/incidents.jsonl', report);
      unit(() => checkHoldout(root, 'docs/incidents/holdout.json', ids, beforeDecision, report));
    });
  }
  if (phase === 7) { unit(() => checkEval(root, '.watchdog/EVAL.md', report)); unit(() => checkUnknownsListed(root, '.watchdog/EVAL.md', report)); }
  if (phase === 8) {
    unit(() => checkUnknownsListed(root, '.watchdog/REPORT.md', report));
    unit(() => { if (!/^Status:\s*operational\b.*\bsweep\b/im.test(text(root, '.watchdog/REPORT.md'))) fail('.watchdog/REPORT.md is not marked "Status: operational" with a sweep id'); });
  }
  return out;
}

// ---- STATE.md ---------------------------------------------------------------

const when = (iso) => {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return String(iso);
  return `${d.toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' })} UTC`;
};

/** A count to show beside a pending id, where one can be read from disk. */
function countFor(root, id) {
  if (id !== 'd2.holdout') return '';
  try { const n = JSON.parse(text(root, 'docs/incidents/holdout.json')).cases.length; return ` (${n} case${n === 1 ? '' : 's'})`; } catch { return ''; }
}

const listOf = (xs) => (xs.length > 1 ? `${xs.slice(0, -1).join(', ')} and ${xs.at(-1)}` : String(xs[0]));

/** The first line of STATE.md and --status. */
export function orientation(root, entries, meta, statuses) {
  const mode = modeOf(meta) === 'run-ahead' ? 'run ahead' : 'step by step';
  const firstOpen = statuses.findIndex((s) => !s.done);
  const pendingOf = (i) => (['awaiting decision', 'sent back'].includes(statuses[i].status) ? statuses[i].waiting ?? [] : []);
  const head = firstOpen < 0 ? PHASES.length - 1 : firstOpen;
  let state;
  let label = `Phase ${PHASES[head][0]}`;
  if (firstOpen < 0) state = 'done';
  else {
    const s = statuses[firstOpen];
    const entry = currentEntry(entries, PHASES[firstOpen][0]);
    if (s.status === 'awaiting decision') state = `awaiting your decision: ${pendingOf(firstOpen).map((id) => `${id}${countFor(root, id)}`).join(', ')}`;
    else if (s.status === 'in progress') {
      // Parallel runs (1, 2 and 3 under run-ahead) are all named, with the earliest start.
      const open = PHASES.filter((_, i) => statuses[i].status === 'in progress').map(([p]) => p);
      const starts = open.map((p) => currentEntry(entries, p).started).sort((x, y) => Date.parse(x) - Date.parse(y));
      if (open.length > 1) label = `Phases ${listOf(open)}`;
      state = `running since ${when(starts[0] ?? entry.started)}`;
    }
    else if (s.status === 'blocked') state = `blocked, needs ${entry.blocked?.needs ?? entry.blocked?.reason ?? 'an answer'}`;
    else if (s.status === 'sent back') state = s.detail;
    else if (s.status === 'not started') state = 'not started';
    else state = `blocked, needs a fix: ${s.detail}`;
  }
  const later = statuses.flatMap((_, i) => (i === firstOpen ? [] : pendingOf(i).map((id) => `${id}${countFor(root, id)}`)));
  // When the first unfinished phase is not itself running, runs open behind it (run-ahead) are still named.
  const behind = firstOpen < 0 || statuses[firstOpen].status === 'in progress' ? []
    : PHASES.filter((_, i) => statuses[i].status === 'in progress').map(([p]) => p);
  const running = behind.length ? ` Running: ${listOf(behind)}.` : '';
  return `${label} of ${PHASES.length}, ${state}.${running} Mode: ${mode}. Pending after that: ${later.length ? later.join(', ') : 'none'}.`;
}

/** STATE.md is generated here and nowhere else. */
export function writeState(root, entries, meta = []) {
  mkdirSync(resolve(root, '.watchdog'), { recursive: true });
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const statuses = PHASES.map(([phase]) => phaseStatus(root, phase, currentEntry(entries, phase), entries));
  const rows = PHASES.map(([phase, skill], i) => {
    const entry = currentEntry(entries, phase);
    const s = statuses[i];
    const status = ['done', 'not started', 'in progress'].includes(s.status) ? s.status : s.status === 'sent back' ? s.detail : `${s.status}: ${s.detail}`;
    const artefacts = (entry?.artefacts ?? []).map((a) => `\`${a.path}\``).join(', ');
    const decisions = (entry?.decisions ?? []).map((d) => `${d.id ?? d.question} ${d.outcome ? `${d.outcome}: ` : ''}${d.answer} (${d.by}, ${d.at}${d.pre ? ', early' : ''})`).join('; ');
    const blocked = entry?.blocked ? `${entry.blocked.reason}${entry.blocked.needs ? `; needs ${entry.blocked.needs}` : ''}` : '';
    const span = entry?.started ? `${entry.started}${entry.finished ? ` to ${entry.finished}` : ''}` : '';
    return `| ${phase} | ${skill} | ${cell(status)} | ${cell(span)} | ${cell(artefacts)} | ${cell(decisions)} | ${cell(blocked)} |`;
  });
  const firstOpen = statuses.findIndex((s) => !s.done);
  const caps = entries.flatMap((e) => (e === currentEntry(entries, e.phase) ? e.decisions ?? [] : [])
    .filter((d) => ['d0.caps', 'd5.cap'].includes(d?.id) || (!d?.id && /cap|budget|spend/i.test(d?.question ?? ''))))
    .map((d) => `- ${d.id ?? d.question} ${d.answer} (${d.by}, ${d.at})`);
  const line = orientation(root, entries, meta, statuses);
  const out = `${line}

# Watchdog build state

Generated from \`.watchdog/journal.jsonl\` at ${new Date().toISOString()}. Do not edit; the journal is the record, and this file is rewritten after every journal append.

Current phase: ${firstOpen < 0 ? 'all phases done' : `${PHASES[firstOpen][0]} (${PHASES[firstOpen][1]})`}

| # | Skill | Status | When | Artefacts | Decisions | Blocked |
|---|---|---|---|---|---|---|
${rows.join('\n')}

## Spend caps carried forward

${caps.length ? caps.join('\n') : 'None recorded yet.'}
`;
  writeFileSync(resolve(root, '.watchdog/STATE.md'), out);
  return { firstOpen: firstOpen < 0 ? null : PHASES[firstOpen][0], statuses, orientation: line };
}
