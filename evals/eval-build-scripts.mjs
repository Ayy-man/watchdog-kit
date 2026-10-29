#!/usr/bin/env node
/**
 * evals/eval-build-scripts.mjs: the watchdog-build journal scripts
 * (journal-append, validate-phase, state-from-journal, all through
 * journal-lib's one "done" predicate), run as a human would run them against a
 * throwaway repo in a temp directory, never a client repo.
 *
 * Covers: init records mode and the kit pin without asking anything; --mode
 * appends a meta entry; a changed kit warns once; the d0.* gate; the per-phase
 * open-run refusal; the decision catalogue rules (ids, outcomes, rule: by,
 * pre, variable names, old shape); rejected sends a phase back; input and
 * decision drift at finished and in validate-phase; every failure printed at
 * once; the orientation line; a non-JSON line still a hard stop.
 *
 *   node evals/eval-build-scripts.mjs
 *   WATCHDOG_EVAL_TMP=<dir> node evals/eval-build-scripts.mjs   (temp repos under <dir>)
 */

import { spawnSync, execFileSync } from 'node:child_process';
import { appendFileSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { assert, check, done } from './lib/harness.mjs';

const kit = join(dirname(fileURLToPath(import.meta.url)), '..');
const scripts = join(kit, 'skills/watchdog-build/scripts');
const base = mkdtempSync(join(process.env.WATCHDOG_EVAL_TMP ?? tmpdir(), 'wd-build-'));
let n = 0;

/** A fresh empty repo; scripts always run from elsewhere with --repo, to prove they need no cwd. */
function repo() { const r = join(base, `repo-${++n}`); mkdirSync(r, { recursive: true }); return r; }
function run(root, script, ...args) {
  const out = spawnSync(process.execPath, [join(scripts, script), ...args, '--repo', root], { cwd: base, encoding: 'utf8' });
  return { code: out.status, out: out.stdout, err: out.stderr };
}
const ja = (root, ...a) => run(root, 'journal-append.mjs', ...a);
const ok = (r) => { assert.equal(r.code, 0, `expected exit 0, got ${r.code}\n${r.err}${r.out}`); return r; };
const no = (r, re) => { assert.equal(r.code, 1, `expected exit 1, got ${r.code}\n${r.err}${r.out}`); if (re) assert.match(r.err, re); return r; };
const lines = (root) => readFileSync(join(root, '.watchdog/journal.jsonl'), 'utf8').trim().split('\n').map((l) => JSON.parse(l));
const last = (root, phase) => lines(root).filter((e) => e.phase === phase).at(-1);
const put = (root, path, body) => { mkdirSync(dirname(join(root, path)), { recursive: true }); writeFileSync(join(root, path), body); };
const decide = (root, phase, id, outcome, answer = 'yes', ...more) => ja(root, String(phase), 'decision', '--id', id, '--outcome', outcome, '--answer', answer, '--by', 'owner', ...more);

const INCIDENT = (id) => JSON.stringify({ id, found_by: 'owner', kind: 'missed_send', root_cause: 'cron removed', watchdog: { check: null, catchable: 'yes', why: 'a send that never ran' }, existing_detection: [] });
const FILES = {
  0: {
    '.watchdog/MAPPING.md': '# Mapping\n\n## Stack\n\nNode.\n\n## Existing monitoring\n\nNone.\n\n## Sources\n\njob_runs.\n',
    '.watchdog/CONTRACT.md': '# Contract\n\n| Door | Status | Proof it fired | Proof-of-proof |\n|---|---|---|---|\n| nightly-send | proven | job_runs row | sweep receipt |\n\n## Obligations\n\nSend by 08:00.\n\n## Unsupported and unknown\n\nNone.\n\n## Shared external ids\n\nNone.\n',
    '.watchdog/EGRESS.md': '# Egress\n\n## Pseudonym\n\nFirst names.\n\n## Fields\n\nIds only.\n\n## Retention\n\n14 days.\n',
    '.watchdog/incident-sample.jsonl': `${INCIDENT('i1')}\n`,
  },
  1: {
    '.watchdog/explainer.html': '<!doctype html><title>Explainer</title>',
    '.watchdog/canvas.html': '<!doctype html><title>Watchdog page</title>',
    '.watchdog/CANVAS.md': '# Canvas\n\n## Box and doors\n\nOne box.\n\n## Tokens\n\nCream.\n\n## Parts\n\nList.\n\n## Keyboard path\n\nTab.\n\n## Empty, erroring and unknown states\n\nShown.\n',
  },
  2: {
    'docs/incidents/incidents.jsonl': `${INCIDENT('i1')}\n${INCIDENT('i2')}\n`,
    'docs/incidents/holdout.json': JSON.stringify({ frozen_at: null, cases: [
      { id: 'i1', as_of: '2026-10-01T00:00:00Z', detect_by: '2026-10-01T09:00:00Z', adjudicated_by: null, adjudicated_at: null },
      { id: 'i2', as_of: '2026-10-02T00:00:00Z', detect_by: '2026-10-02T09:00:00Z', adjudicated_by: null, adjudicated_at: null },
    ] }),
  },
  3: { '.watchdog/HEARTBEATS.md': '# Heartbeats\n\n## Wrapper\n\nx\n\n## Jobs\n\nx\n\n## Parity\n\nx\n\n## Doors\n\nx\n\n## Role\n\nx\n' },
};
const write = (root, phase) => { for (const [p, b] of Object.entries(FILES[phase])) put(root, p, b); };
const runPhase = (root, phase) => { ok(ja(root, String(phase), 'started')); write(root, phase); return ok(ja(root, String(phase), 'finished')); };
/** A repo with phase 0 finished and d0.* approved. */
function approved(mode = 'step') {
  const root = repo();
  ok(ja(root, 'init', '--mode', mode));
  runPhase(root, 0);
  for (const id of ['d0.scopes', 'd0.egress', 'd0.caps']) ok(decide(root, 0, id, 'approved', id === 'd0.caps' ? 'USD 5 a day, 1000 rows a day' : 'as surveyed'));
  return root;
}
const kitHead = () => { try { return execFileSync('git', ['-C', kit, 'rev-parse', 'HEAD'], { encoding: 'utf8' }).trim(); } catch { return null; } };

await check('init asks nothing, records mode (default step) and the kit revision in a first meta entry', () => {
  const root = repo();
  const r = ok(ja(root, 'init'));
  assert.doesNotMatch(r.out, /\?/);
  const [meta] = lines(root);
  assert.equal(meta.meta, true);
  assert.equal(meta.mode, 'step');
  const head = kitHead();
  assert.equal(meta.kit_rev, head ?? `VERSION ${readFileSync(join(kit, 'core/VERSION'), 'utf8').trim()}`);
  const r2 = repo();
  ok(ja(r2, 'init', '--mode', 'run-ahead'));
  assert.equal(lines(r2)[0].mode, 'run-ahead');
  no(ja(repo(), 'init', '--mode', 'sideways'), /--mode must be one of step, run-ahead/);
});

await check('--mode appends a meta entry and keeps the kit pin', () => {
  const root = repo();
  ok(ja(root, 'init'));
  ok(ja(root, '--mode', 'run-ahead'));
  const metas = lines(root).filter((e) => e.meta);
  assert.equal(metas.length, 2);
  assert.equal(metas[1].mode, 'run-ahead');
  assert.equal(metas[1].kit_rev, metas[0].kit_rev);
  assert.match(readFileSync(join(root, '.watchdog/STATE.md'), 'utf8').split('\n')[0], /Mode: run ahead\./);
});

await check('a kit revision other than the pinned one warns once per command, naming the fix', () => {
  const root = repo();
  ok(ja(root, 'init'));
  appendFileSync(join(root, '.watchdog/journal.jsonl'), '');
  const journal = join(root, '.watchdog/journal.jsonl');
  const body = readFileSync(journal, 'utf8').replace(/"kit_rev":"[^"]*"/, '"kit_rev":"0000000pinned"');
  writeFileSync(journal, body);
  const r = ok(ja(root, '0', 'started'));
  assert.equal(r.err.match(/pinned to 0000000pinned/g)?.length, 1, r.err);
  assert.match(r.err, /checkout 0000000pinned|reinstall/);
  assert.match(run(root, 'state-from-journal.mjs').err, /pinned to 0000000pinned/);
});

await check('phase 1 and later refuse to start until d0.scopes, d0.egress and d0.caps are approved', () => {
  const root = repo();
  ok(ja(root, 'init'));
  runPhase(root, 0);
  no(ja(root, '1', 'started'), /needs d0\.scopes, d0\.egress and d0\.caps approved first \(not approved: d0\.scopes, d0\.egress, d0\.caps\).*journal-append\.mjs 0 decision --id d0\.scopes --outcome approved/);
  ok(decide(root, 0, 'd0.scopes', 'approved'));
  ok(decide(root, 0, 'd0.egress', 'rejected', 'too wide'));
  no(ja(root, '3', 'started'), /not approved: d0\.egress, d0\.caps/);
  assert.equal(lines(root).filter((e) => e.phase === 3).length, 0, 'nothing appended');
});

await check('rejected is recorded and sends the phase back; approving every id makes it done', () => {
  const root = repo();
  ok(ja(root, 'init'));
  runPhase(root, 0);
  ok(decide(root, 0, 'd0.scopes', 'rejected', 'drop the payments view'));
  ok(decide(root, 0, 'd0.egress', 'approved'));
  ok(decide(root, 0, 'd0.caps', 'approved'));
  assert.equal(last(root, 0).decisions.find((d) => d.id === 'd0.scopes').outcome, 'rejected');
  no(run(root, 'validate-phase.mjs', '0'), /sent back: d0\.scopes rejected/);
  assert.match(readFileSync(join(root, '.watchdog/STATE.md'), 'utf8'), /\| 0 \| watchdog-survey \| sent back: d0\.scopes rejected \|/);
  ok(decide(root, 0, 'd0.scopes', 'approved', 'payments view dropped'));
  ok(run(root, 'validate-phase.mjs', '0'));
  const d = last(root, 0).decisions.at(-1);
  assert.deepEqual(Object.keys(d).sort(), ['answer', 'at', 'by', 'id', 'kind', 'outcome', 'pre']);
  assert.equal(d.kind, 'authorisation');
});

await check('a phase waits for every id the catalogue gives it, not just one answer', () => {
  const root = repo();
  ok(ja(root, 'init'));
  runPhase(root, 0);
  ok(decide(root, 0, 'd0.scopes', 'approved'));
  const r = no(run(root, 'validate-phase.mjs', '0'), /awaits d0\.egress, d0\.caps/);
  assert.match(r.err, /journal-append\.mjs 0 decision --id d0\.egress --outcome approved\|rejected/);
});

await check('decision validation: id, outcome, human by, pre, variable names, old shape', () => {
  const root = repo();
  ok(ja(root, 'init'));
  runPhase(root, 0);
  no(ja(root, '0', 'decision', '--decision', '{"question":"Approve?","answer":"Yes","by":"owner"}'), /needs id \(one of d0\.scopes, d0\.egress, d0\.caps\)/);
  no(ja(root, '0', 'decision', '--decision', '{"id":"d0.sopes","outcome":"approved","answer":"y","by":"owner"}'), /unknown decision id "d0\.sopes"/);
  no(ja(root, '0', 'decision', '--decision', '{"id":"d0.scopes","answer":"y","by":"owner"}'), /d0\.scopes has no outcome \(one of approved, rejected\)/);
  no(decide(root, 0, 'd0.scopes', 'answered'), /outcome "answered" is not one of approved, rejected/);
  no(ja(root, '0', 'decision', '--id', 'd0.scopes', '--outcome', 'approved', '--answer', 'y', '--by', 'rule:auto'), /not a person/);
  no(decide(root, 0, 'd0.caps', 'approved', 'y', '--pre'), /cannot be answered before its phase runs/);
  no(decide(root, 0, 'd5.cap', 'answered'), /d5\.cap belongs to phase 5/);
  no(decide(root, 0, 'd0.scopes', 'approved', 'y', '--at', 'yesterday'), /not an ISO 8601 timestamp/);
  no(decide(root, 5, 'd5.key', 'answered', 'sk-live-abc123', '--pre'), /environment variable name/);
  ok(ja(root, '5', 'decision', '--id', 'd5.model', '--outcome', 'answered', '--answer', 'bake-off winner', '--by', 'rule:d5.model', '--pre'));
  no(ja(root, '5', 'decision', '--id', 'd5.cap', '--outcome', 'answered', '--answer', 'GBP 2', '--by', 'rule:d5.model', '--pre'), /not a person/);
  ok(ja(root, '0', 'decision', '--decision', '{"id":"d0.scopes","outcome":"approved","answer":"as surveyed","by":"owner"}'));
  assert.equal(last(root, 0).decisions.at(-1).id, 'd0.scopes');
  // A hand-written old-shape decision in an existing journal reads back as invalid, with the reason.
  const e = { ...last(root, 0), decisions: [{ question: 'Approve scopes?', answer: 'Yes', by: 'owner', at: '2026-10-19T12:00:00Z' }] };
  appendFileSync(join(root, '.watchdog/journal.jsonl'), `${JSON.stringify(e)}\n`);
  no(run(root, 'validate-phase.mjs', '0'), /decision "Approve scopes\?" needs id \(one of d0\.scopes, d0\.egress, d0\.caps\)/);
});

await check('answers given early are carried into the run; only pre-answerable ids may be', () => {
  const root = approved('run-ahead');
  no(decide(root, 4, 'd4.verdicts', 'answered', '3', '--pre'), /cannot be answered before/);
  no(decide(root, 5, 'd5.cap', 'answered', 'GBP 2 a day'), /only a decision answered early \(--pre\)/);
  ok(decide(root, 5, 'd5.cap', 'answered', 'GBP 2 a day', '--pre'));
  ok(decide(root, 5, 'd5.slots', 'answered', '07:30 and 19:30', '--pre'));
  assert.match(readFileSync(join(root, '.watchdog/STATE.md'), 'utf8'), /\| 5 \| watchdog-review \| not started \|/);
  const r = ok(ja(root, '5', 'started'));
  assert.match(r.err, /reads artefacts from phases not finished: 4/);
  assert.match(r.err, /waits for d4\.verdicts/);
  assert.deepEqual(last(root, 5).decisions.map((d) => d.id), ['d5.cap', 'd5.slots']);
});

await check('one open run per phase; other phases may be open at the same time', () => {
  const root = approved('run-ahead');
  ok(ja(root, '1', 'started'));
  no(ja(root, '1', 'started'), /phase 1 already has an open run.*journal-append\.mjs 1 finished/);
  ok(ja(root, '2', 'started'));
  ok(ja(root, '3', 'started'));
  assert.equal(lines(root).filter((e) => e.phase === 1).length, 1);
  ok(ja(root, '1', 'blocked', '--reason', 'no design tokens', '--needs', 'the brand file'));
  ok(ja(root, '1', 'started'));
});

await check('started warns, without refusing, when an upstream phase is not finished', () => {
  const root = approved();
  const r = ok(ja(root, '4', 'started'));
  assert.match(r.err, /phase 4 reads artefacts from phases not finished: 2, 3/);
});

await check('started records the upstream inputs it reads and the decisions revision', () => {
  const root = approved();
  ok(ja(root, '1', 'started'));
  const e = last(root, 1);
  assert.deepEqual(e.inputs.map((i) => i.path).sort(), Object.keys(FILES[0]).sort());
  for (const i of e.inputs) assert.match(i.sha256, /^[0-9a-f]{64}$/);
  assert.match(e.decisions_rev, /^[0-9a-f]{64}$/);
  assert.deepEqual(Object.keys(e.decisions_read).sort(), ['d0.caps', 'd0.egress', 'd0.scopes']);
});

await check('an upstream file edited after started fails finished, naming the path and the earliest invalidated phase', () => {
  const root = approved();
  ok(ja(root, '1', 'started'));
  write(root, 1);
  put(root, '.watchdog/MAPPING.md', `${FILES[0]['.watchdog/MAPPING.md']}\nLate edit.\n`);
  const r = no(ja(root, '1', 'finished'), /input changed since it started: \.watchdog\/MAPPING\.md from phase 0; earliest invalidated phase 0/);
  assert.match(r.err, /journal-append\.mjs 0 started/);
  assert.equal(last(root, 1).finished, null, 'nothing appended');
  put(root, '.watchdog/MAPPING.md', FILES[0]['.watchdog/MAPPING.md']);
  ok(ja(root, '1', 'finished'));
});

await check('a decision re-recorded after started is drift; one recorded for the first time is not', () => {
  const root = approved('run-ahead');
  runPhase(root, 1);
  ok(ja(root, '2', 'started'));
  write(root, 2);
  ok(decide(root, 1, 'd1.explainer', 'approved'));
  ok(ja(root, '2', 'finished'));
  ok(ja(root, '3', 'started'));
  write(root, 3);
  ok(decide(root, 0, 'd0.caps', 'approved', 'USD 2 a day, 500 rows a day'));
  const r = no(ja(root, '3', 'finished'), /decision d0\.caps \(re-recorded\); earliest invalidated phase 1/);
  assert.match(r.err, /journal-append\.mjs 1 started/);
  // validate-phase applies the same comparison to a phase that already finished.
  no(run(root, 'validate-phase.mjs', '2'), /decision d0\.caps \(re-recorded\)/);
});

await check('validate-phase prints every failure with its fix and exits 1 once', () => {
  const root = approved();
  ok(run(root, 'validate-phase.mjs', '0'));
  put(root, '.watchdog/MAPPING.md', '# Mapping\n\n## Stack\n\nfor {client}\n\n## Existing monitoring\n\nNone.\n\n## Sources\n\nx\n');
  put(root, '.watchdog/EGRESS.md', '# Egress\n\n## Pseudonym\n\nx\n\n## Fields\n\nx\n');
  const r = no(run(root, 'validate-phase.mjs', '0'));
  for (const re of [/placeholder \{client\}/, /missing a "Retention" section/, /sha256 mismatch for \.watchdog\/MAPPING\.md/, /sha256 mismatch for \.watchdog\/EGRESS\.md/]) assert.match(r.err, re);
  assert.ok((r.err.match(/^ {2}fix: /gm) ?? []).length >= 4, r.err);
  assert.equal((r.err.match(/^validate-phase:/gm) ?? []).length, 1);
});

await check('a journal line that is not JSON is still a hard stop with its line number', () => {
  const root = approved();
  appendFileSync(join(root, '.watchdog/journal.jsonl'), '{not json\n');
  const at = readFileSync(join(root, '.watchdog/journal.jsonl'), 'utf8').trim().split('\n').length;
  no(run(root, 'validate-phase.mjs', '0'), new RegExp(`journal line ${at} is not JSON`));
  no(ja(root, '1', 'started'), new RegExp(`journal line ${at} is not JSON`));
  no(run(root, 'state-from-journal.mjs'), new RegExp(`journal line ${at} is not JSON`));
});

await check('the orientation line opens STATE.md and --status, and lists the decision queue in phase order', () => {
  const root = repo();
  ok(ja(root, 'init', '--mode', 'run-ahead'));
  const first = () => readFileSync(join(root, '.watchdog/STATE.md'), 'utf8').split('\n')[0];
  assert.equal(first(), 'Phase 0 of 9, not started. Mode: run ahead. Pending after that: none.');
  ok(ja(root, '0', 'started'));
  assert.match(first(), /^Phase 0 of 9, running since \d{1,2} [A-Z][a-z]{2} \d{4}, \d{2}:\d{2} UTC\. Mode: run ahead\. Pending after that: none\.$/);
  write(root, 0);
  ok(ja(root, '0', 'finished'));
  assert.equal(first(), 'Phase 0 of 9, awaiting your decision: d0.scopes, d0.egress, d0.caps. Mode: run ahead. Pending after that: none.');
  for (const id of ['d0.scopes', 'd0.egress', 'd0.caps']) ok(decide(root, 0, id, 'approved'));
  runPhase(root, 1);
  runPhase(root, 2);
  ok(ja(root, '3', 'blocked', '--reason', 'no migration tool', '--needs', 'the database URL variable name'));
  const status = ok(run(root, 'state-from-journal.mjs'));
  const line = 'Phase 1 of 9, awaiting your decision: d1.explainer, d1.canvas. Mode: run ahead. Pending after that: d2.holdout (2 cases).';
  assert.equal(first(), line);
  assert.equal(status.out.split('\n')[0], line);
  assert.match(readFileSync(join(root, '.watchdog/STATE.md'), 'utf8'), /\| # \| Skill \| Status \|/);
  ok(decide(root, 1, 'd1.explainer', 'approved'));
  ok(decide(root, 1, 'd1.canvas', 'approved'));
  assert.equal(first(), 'Phase 2 of 9, awaiting your decision: d2.holdout (2 cases). Mode: run ahead. Pending after that: none.');
  const h = JSON.parse(FILES[2]['docs/incidents/holdout.json']);
  h.frozen_at = '2026-10-19T12:00:00Z';
  for (const c of h.cases) Object.assign(c, { adjudicated_by: 'owner', adjudicated_at: '2026-10-19T12:00:00Z' });
  put(root, 'docs/incidents/holdout.json', JSON.stringify(h));
  ok(decide(root, 2, 'd2.holdout', 'answered', '2 cases; recall high 1.0', '--artefact', 'docs/incidents/holdout.json'));
  assert.equal(first(), 'Phase 3 of 9, blocked, needs the database URL variable name. Mode: run ahead. Pending after that: none.');
});

await check('the orientation line names every open run, with the earliest start', () => {
  const root = approved('run-ahead');
  const first = () => readFileSync(join(root, '.watchdog/STATE.md'), 'utf8').split('\n')[0];
  ok(ja(root, '1', 'started'));
  assert.match(first(), /^Phase 1 of 9, running since /);
  ok(ja(root, '2', 'started'));
  assert.match(first(), /^Phases 1 and 2 of 9, running since /);
  ok(ja(root, '3', 'started'));
  const since = new Date(last(root, 1).started).toLocaleString('en-GB', { timeZone: 'UTC', day: 'numeric', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  assert.equal(first(), `Phases 1, 2 and 3 of 9, running since ${since} UTC. Mode: run ahead. Pending after that: none.`);
});

await check('a phase awaiting a decision still names the runs open behind it', () => {
  const root = approved('run-ahead');
  const first = () => readFileSync(join(root, '.watchdog/STATE.md'), 'utf8').split('\n')[0];
  runPhase(root, 1);
  runPhase(root, 2);
  runPhase(root, 3);
  assert.equal(first(), 'Phase 1 of 9, awaiting your decision: d1.explainer, d1.canvas. Mode: run ahead. Pending after that: d2.holdout (2 cases).');
  ok(ja(root, '4', 'started'));
  assert.equal(first(), 'Phase 1 of 9, awaiting your decision: d1.explainer, d1.canvas. Running: 4. Mode: run ahead. Pending after that: d2.holdout (2 cases).');
  ok(ja(root, '5', 'started'));
  assert.equal(first(), 'Phase 1 of 9, awaiting your decision: d1.explainer, d1.canvas. Running: 4 and 5. Mode: run ahead. Pending after that: d2.holdout (2 cases).');
});

await check('phase 8 cannot start until d8.deployed is recorded', () => {
  const root = approved();
  no(ja(root, '8', 'started'), /cannot start until d8\.deployed is recorded/);
  ok(decide(root, 8, 'd8.deployed', 'answered', 'abc1234'));
  const r = ok(ja(root, '8', 'started'));
  assert.match(r.err, /waits for d7\.merge/);
  assert.equal(last(root, 8).decisions[0].id, 'd8.deployed');
});

rmSync(base, { recursive: true, force: true });
done();
