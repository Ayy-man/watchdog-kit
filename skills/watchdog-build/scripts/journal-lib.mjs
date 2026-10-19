/**
 * journal-lib.mjs: the one definition of "phase done", shared by
 * validate-phase.mjs, state-from-journal.mjs and journal-append.mjs, so that
 * STATE.md can never say done while validation fails. Plain node, no
 * dependencies.
 *
 * A phase is done when its last journal entry has ISO started and finished
 * times, is not blocked, records every required artefact, every recorded
 * artefact reads back from disk with the sha256 the entry holds (the read-back
 * result), a phase with a human stop carries an answered decision with by and
 * an ISO at, and the artefacts pass the content checks below.
 */
import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';

export const PHASES = [
  [0, 'watchdog-survey'], [1, 'watchdog-explain'], [2, 'watchdog-incidents'], [3, 'watchdog-heartbeats'],
  [4, 'watchdog-checks'], [5, 'watchdog-review'], [6, 'watchdog-page'], [7, 'watchdog-eval'], [8, 'watchdog-prove'],
];
export const SKILL_OF = Object.fromEntries(PHASES);
export const STOP_PHASES = new Set([0, 1, 2, 4, 5, 7]);
export const STATUS_WORDS = ['proven', 'failed', 'unknown', 'unsupported'];
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

/** Lines numbered as an editor numbers them, blank lines included. */
export function readJournal(root) {
  const path = journalPath(root);
  if (!existsSync(path)) return { exists: false, entries: [] };
  const entries = [];
  readFileSync(path, 'utf8').split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let e;
    try { e = JSON.parse(l); } catch (err) { fail(`journal line ${i + 1} is not JSON (${err.message}); fix or remove that line in ${path}`); }
    if (!e || typeof e !== 'object' || !Number.isInteger(e.phase)) fail(`journal line ${i + 1} has no integer "phase"`);
    entries.push({ ...e, _line: i + 1 });
  });
  return { exists: true, entries };
}

export const currentEntry = (entries, phase) => entries.filter((e) => e.phase === phase).at(-1);

export function sha256(root, path) {
  const full = resolve(root, path);
  return existsSync(full) ? createHash('sha256').update(readFileSync(full)).digest('hex') : null;
}

const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}(:\d{2}(\.\d+)?)?(Z|[+-]\d{2}:\d{2})$/;
export const isIso = (v) => typeof v === 'string' && ISO.test(v) && !Number.isNaN(Date.parse(v));

/** Journal-level checks: everything except artefact content. Returns { status, detail }. */
export function journalStatus(root, phase, entry) {
  if (!entry) return { status: 'not started', detail: `no journal entry for phase ${phase}` };
  const at = `journal line ${entry._line}`;
  if (entry.blocked) return { status: 'blocked', detail: `phase ${phase} is blocked: ${entry.blocked.reason ?? 'no reason given'}` };
  if (!isIso(entry.started)) return { status: 'invalid', detail: `${at}: started "${entry.started}" is not an ISO 8601 timestamp` };
  if (entry.finished == null) return { status: 'in progress', detail: `phase ${phase} has no finished time` };
  if (!isIso(entry.finished)) return { status: 'invalid', detail: `${at}: finished "${entry.finished}" is not an ISO 8601 timestamp` };
  const decisions = entry.decisions ?? [];
  for (const d of decisions) {
    if (d?.at != null && !isIso(d.at)) return { status: 'invalid', detail: `${at}: decision "${d.question}" has at "${d.at}", not an ISO 8601 timestamp` };
  }
  const artefacts = Array.isArray(entry.artefacts) ? entry.artefacts : [];
  if (artefacts.length === 0) return { status: 'invalid', detail: `phase ${phase} recorded no artefacts` };
  const recorded = new Set(artefacts.map((a) => a.path));
  const missing = REQUIRED[phase].filter((p) => !recorded.has(p));
  if (missing.length) return { status: 'invalid', detail: `phase ${phase} must record ${missing.join(', ')} in its artefacts` };
  for (const a of artefacts) {
    const actual = sha256(root, a.path);
    const remedy = `re-run the phase, or if the human's answer caused the edit, record it with \`journal-append.mjs ${phase} decision --artefact ${a.path} --decision <json>\``;
    if (actual === null) return { status: 'stale', detail: `artefact missing on disk: ${a.path}; ${remedy}` };
    if (actual !== a.sha256) return { status: 'stale', detail: `sha256 mismatch for ${a.path} (journal ${a.sha256.slice(0, 12)}, disk ${actual.slice(0, 12)}): it changed after the journal recorded it; ${remedy}` };
  }
  if (STOP_PHASES.has(phase)) {
    const answered = decisions.some((d) => d && String(d.answer ?? '').trim() && d.by && isIso(d.at));
    if (!answered) return { status: 'awaiting decision', detail: `phase ${phase} has a human stop but no recorded decision with answer, by and at` };
  }
  return { status: 'ok', detail: '' };
}

/** The shared predicate. Returns { done, status, detail }. */
export function phaseStatus(root, phase, entry) {
  const j = journalStatus(root, phase, entry);
  // Content is checked as soon as the run is finished, not only after the human answers, so a
  // copied template fails at "finished" instead of being put to the human. Before the answer, the
  // fields only the answer can fill (the holdout's adjudication) are not yet required.
  if (j.status !== 'ok' && j.status !== 'awaiting decision') return { done: false, ...j };
  try { checkContent(root, phase, { beforeDecision: j.status === 'awaiting decision' }); } catch (err) {
    if (err instanceof PhaseError) return { done: false, status: 'invalid', detail: err.message };
    throw err;
  }
  if (j.status !== 'ok') return { done: false, ...j };
  return { done: true, status: 'done', detail: '' };
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

function noPlaceholders(root, path) {
  for (const { l, n } of proseLines(text(root, path))) {
    // An inline code span is code, not prose: a JSON shape in backticks is fine.
    const m = l.replace(/`[^`\n]*`/g, '').match(PLACEHOLDER);
    if (m) fail(`${path} line ${n} still holds the template placeholder ${m[0]}; fill it or remove the line`);
  }
}

function requireSections(root, path) {
  const lines = proseLines(text(root, path));
  for (const name of SECTIONS[path] ?? []) {
    // Sections are level 2 to 4, so a title such as "# Checks: acme" is not taken for "## Checks".
    const re = new RegExp(`^(#{2,4})\\s+${name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\b(?!\\s*:)`, 'i');
    const i = lines.findIndex(({ l }) => re.test(l));
    if (i < 0) fail(`${path} is missing a "${name}" section`);
    const level = lines[i].l.match(re)[1].length;
    const body = [];
    for (let j = i + 1; j < lines.length; j++) {
      const h = lines[j].l.match(/^(#{1,6})\s/);
      if (h && h[1].length <= level) break;
      body.push(lines[j].l);
    }
    const content = body.join('\n').replace(/<!--[\s\S]*?-->/g, '').split('\n')
      .filter((l) => l.trim() && !/^#{1,6}\s/.test(l));
    if (content.length === 0) fail(`${path}: the "${name}" section is empty`);
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
function checkUnknownsListed(root, path) {
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
    if (!new RegExp(`(^|[^\\w-])${esc(door)}($|[^\\w-])`).test(section)) fail(`${path}: door "${door}" is ${status} in CONTRACT.md but not listed under "Unsupported and unknown"`);
  }
}

function checkIncidents(root, path) {
  const ids = new Set();
  text(root, path).split('\n').forEach((l, i) => {
    if (!l.trim()) return;
    let row; try { row = JSON.parse(l); } catch { fail(`${path} line ${i + 1} is not JSON`); }
    const where = `${path} line ${i + 1} (${row.id ?? '?'})`;
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
    ids.add(row.id);
  });
  return ids;
}

function checkHoldout(root, path, ids, beforeDecision) {
  let h; try { h = JSON.parse(text(root, path)); } catch { fail(`${path} is not JSON`); }
  if (!h || Array.isArray(h) || !Array.isArray(h.cases)) fail(`${path} must be an object with "frozen_at" and "cases"`);
  if (h.cases.length === 0) fail(`${path} lists no cases`);
  if (!beforeDecision && !isIso(h.frozen_at)) fail(`${path}: frozen_at is not an ISO 8601 timestamp; the orchestrator sets it when it writes the human's adjudication`);
  for (const c of h.cases) {
    if (!ids.has(c.id)) fail(`${path}: case ${c.id} is not in incidents.jsonl`);
    if (!beforeDecision && !c.adjudicated_by) fail(`${path}: case ${c.id} has no adjudicated_by`);
    if (!beforeDecision && !isIso(c.adjudicated_at)) fail(`${path}: case ${c.id} adjudicated_at is not an ISO 8601 timestamp`);
    if (c.replayable === false) { if (!c.reason) fail(`${path}: unreplayable case ${c.id} gives no reason`); continue; }
    if (!c.as_of || !c.detect_by) fail(`${path}: case ${c.id} needs as_of and detect_by`);
  }
}

function checkEval(root, path) {
  const body = text(root, path);
  for (const gate of GATES) {
    const line = body.split('\n').find((l) => l.includes(gate) && l.trim().startsWith('|'));
    if (!line) fail(`${path} has no table row for gate ${gate}`);
    const value = line.split('|').map((c) => c.trim()).filter(Boolean)[1] ?? '';
    if (!value || /^(tbd|todo|\?|-|n\/a)$/i.test(value) || PLACEHOLDER.test(value)) fail(`${path}: gate ${gate} has no value`);
  }
}

export function checkContent(root, phase, { beforeDecision = false } = {}) {
  for (const path of REQUIRED[phase]) {
    if (path.endsWith('.md')) { noPlaceholders(root, path); requireSections(root, path); }
  }
  if (phase === 0) { checkContract(root, '.watchdog/CONTRACT.md'); checkIncidents(root, '.watchdog/incident-sample.jsonl'); }
  if (phase === 2) checkHoldout(root, 'docs/incidents/holdout.json', checkIncidents(root, 'docs/incidents/incidents.jsonl'), beforeDecision);
  if (phase === 7) { checkEval(root, '.watchdog/EVAL.md'); checkUnknownsListed(root, '.watchdog/EVAL.md'); }
  if (phase === 8) checkUnknownsListed(root, '.watchdog/REPORT.md');
  if (phase === 8 && !/^Status:\s*operational\b.*\bsweep\b/im.test(text(root, '.watchdog/REPORT.md'))) fail('.watchdog/REPORT.md is not marked "Status: operational" with a sweep id');
}

// ---- STATE.md ---------------------------------------------------------------

/** STATE.md is generated here and nowhere else. */
export function writeState(root, entries) {
  mkdirSync(resolve(root, '.watchdog'), { recursive: true });
  const cell = (s) => String(s ?? '').replace(/\|/g, '\\|').replace(/\n/g, ' ');
  const statuses = PHASES.map(([phase]) => phaseStatus(root, phase, currentEntry(entries, phase)));
  const rows = PHASES.map(([phase, skill], i) => {
    const entry = currentEntry(entries, phase);
    const s = statuses[i];
    const status = ['done', 'not started', 'in progress'].includes(s.status) ? s.status : `${s.status}: ${s.detail}`;
    const artefacts = (entry?.artefacts ?? []).map((a) => `\`${a.path}\``).join(', ');
    const decisions = (entry?.decisions ?? []).map((d) => `${d.question} ${d.answer} (${d.by}, ${d.at})`).join('; ');
    const blocked = entry?.blocked ? `${entry.blocked.reason}${entry.blocked.needs ? `; needs ${entry.blocked.needs}` : ''}` : '';
    const when = entry ? `${entry.started ?? ''}${entry.finished ? ` to ${entry.finished}` : ''}` : '';
    return `| ${phase} | ${skill} | ${cell(status)} | ${cell(when)} | ${cell(artefacts)} | ${cell(decisions)} | ${cell(blocked)} |`;
  });
  const firstOpen = statuses.findIndex((s) => !s.done);
  const caps = entries.flatMap((e) => (e.decisions ?? []).filter((d) => /cap|budget|spend/i.test(d.question ?? '')))
    .map((d) => `- ${d.question} ${d.answer} (${d.by}, ${d.at})`);
  const out = `# Watchdog build state

Generated from \`.watchdog/journal.jsonl\` at ${new Date().toISOString()}. Do not edit; the journal is the record, and this file is rewritten after every journal append.

Current phase: ${firstOpen < 0 ? 'all phases done' : `${PHASES[firstOpen][0]} (${PHASES[firstOpen][1]})`}

| # | Skill | Status | When | Artefacts | Decisions | Blocked |
|---|---|---|---|---|---|---|
${rows.join('\n')}

## Spend caps carried forward

${caps.length ? caps.join('\n') : 'None recorded yet.'}
`;
  writeFileSync(resolve(root, '.watchdog/STATE.md'), out);
  return { firstOpen: firstOpen < 0 ? null : PHASES[firstOpen][0], statuses };
}
