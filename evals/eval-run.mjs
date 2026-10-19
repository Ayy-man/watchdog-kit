#!/usr/bin/env node
/**
 * evals/eval-run.mjs: one watchdog sweep (core/run.js).
 *
 * Replays sweeps over the in-memory client with injected fake checks and
 * asserts the lifecycle (new, refreshed, reopened, resolved), the scoped
 * finding ids, the resolution rule (complete coverage that examined the
 * subject and is fresher than its evidence; a throw, skip, partial, rejected
 * review, truncated page or stale data resolves nothing), the generation
 * fence (busy lease refused, stale generation write rejected), the two job
 * names, and that the checks' client refuses writes.
 *
 * Offline: evals/lib/fake-postgrest.mjs and a fetch that throws.
 *   node evals/eval-run.mjs
 */

import { fakePostgrest } from './lib/fake-postgrest.mjs';
import { assert, check, done, loud, quiet, SCOPE, SCOPE_KEY, T } from './lib/harness.mjs';
import { chunkForIn, IN_URL_CHARS, runWatchdog, resolutionDecision, SWEEP_JOB_CRON, SWEEP_JOB_MANUAL } from '../core/run.js';
import { claimSweep, releaseSweep, StaleGenerationError, SweepBusyError } from '../core/sweep-generation.js';
import { WatchdogWriteRefused } from '../core/readonly-client.js';
import { buildFindingId } from '../core/scope.js';

/** The id core/scope.js builds; `subject` is the readable `type-id` (split at the first `-`). */
const ID = (checkId, kind, subject, scope = SCOPE) => {
  const cut = subject.indexOf('-');
  return buildFindingId(scope, checkId, kind, { subject: { type: subject.slice(0, cut), id: subject.slice(cut + 1) } });
};
const byId = (client) => Object.fromEntries(client.data.watchdog_findings.map((r) => [r.id, r]));
const tables = () => ({ watchdog_findings: [], watchdog_sweeps: [], job_runs: [], bookings: [] });

/**
 * A fake check whose findings are whatever `state.subjects` holds this sweep.
 * It examines `state.universe` (default: its subjects) unless told otherwise.
 */
function fakeCheck(id, state, { severity = 'high', model = false, type = 'booking', kind = 'no_tour' } = {}) {
  return {
    id,
    severity,
    model,
    title: `Fake ${id}`,
    incidents: [],
    async run({ now, coverage }) {
      if (state.throws) throw new Error(state.throws);
      if (state.skipped) { coverage.skipped(state.skipped); return []; }
      if (state.partialReason) coverage.partial(state.partialReason);
      if (state.incomplete) coverage.incomplete(state.incomplete);
      const universe = state.universe ?? state.subjects;
      if (!state.noExamined) coverage.examined(...universe.map((s) => ({ type, id: s })));
      if (state.freshAsOf) coverage.freshAsOf(state.freshAsOf);
      if (state.resolveReason) coverage.resolveReason(state.resolveReason);
      const findings = state.subjects.map((s) => ({
        kind,
        subject: { type, id: s },
        title: `${s} is on no tour (${state.label ?? 'v1'})`,
        detail: `seen at ${now.toISOString()}`,
        link: `#/bookings/${s}`,
        wouldDo: 'Raise "Booking is on no tour"',
        wouldSay: null,
        evidence: [{ source: 'bookings', id: s, field: 'tour_id', value: null }, { source: 'label', id: s, value: state.label ?? 'v1' }],
        evidenceAt: state.evidenceAt ?? null,
      }));
      return state.returnPartial ? { findings, partial: state.returnPartial } : findings;
    },
  };
}

// ── Lifecycle ────────────────────────────────────────────────────────────────

const client = fakePostgrest(tables());
const a = { subjects: ['b1', 'b2'] };
const b = { subjects: ['t9'] };
const checks = [fakeCheck('booking_no_tour', a), fakeCheck('guide_missing', b, { severity: 'medium', type: 'tour', kind: 'guide_missing' })];

await check('sweep 1: every finding is new and open, under a scoped id', async () => {
  const out = await runWatchdog({ client, scope: SCOPE, now: T(9), checks });
  assert.equal(out.ok, true);
  assert.equal(out.generation, 1);
  assert.equal(out.new, 3);
  assert.equal(out.resolved, 0);
  const rows = byId(client);
  assert.deepEqual(Object.keys(rows).sort(), [
    ID('booking_no_tour', 'no_tour', 'booking-b1'), ID('booking_no_tour', 'no_tour', 'booking-b2'), ID('guide_missing', 'guide_missing', 'tour-t9'),
  ].sort());
  const b1 = rows[ID('booking_no_tour', 'no_tour', 'booking-b1')];
  assert.equal(b1.status, 'open');
  assert.equal(b1.installation, 'kit-eval');
  assert.equal(b1.tenant, null);
  assert.equal(b1.environment, 'development');
  assert.equal(b1.check_id, 'booking_no_tour');
  assert.equal(b1.kind, 'no_tour');
  assert.equal(b1.subject_type, 'booking');
  assert.equal(b1.subject_id, 'b1');
  assert.equal(b1.severity, 'high', 'the check default severity');
  assert.equal(rows[ID('guide_missing', 'guide_missing', 'tour-t9')].severity, 'medium');
  assert.equal(b1.first_seen_at, T(9).toISOString());
  assert.equal(b1.last_seen_at, T(9).toISOString());
  assert.equal(b1.last_evidence_at, T(9).toISOString(), 'evidence time defaults to the run');
  assert.equal(b1.reopened_count, 0);
  assert.equal(b1.resolved_at, null);
  assert.equal(b1.last_generation, 1);
  assert.deepEqual(b1.evidence, [{ source: 'bookings', id: 'b1', field: 'tour_id', value: null }, { source: 'label', id: 'b1', value: 'v1' }]);
  assert.deepEqual(b1.meta, { evidence_defaulted: true }, 'no evidenceAt given, so the stored evidence time is the sweep\'s, and says so');
  assert.equal(b1.last_run_id, out.runId);
});

await check('sweep 1 wrote one watchdog.sweep job_runs row with its counts and the generation', async () => {
  const runs = client.data.job_runs.filter((r) => r.job === SWEEP_JOB_CRON);
  assert.equal(runs.length, 1);
  const [run] = runs;
  assert.equal(run.ok, true);
  assert.equal(run.started_at, T(9).toISOString());
  assert.equal(run.summary.checks, 2);
  assert.equal(run.summary.new, 3);
  assert.equal(run.summary.generation, 1);
  assert.equal(run.summary.receipt.scope.installation, 'kit-eval');
  assert.equal(byId(client)[ID('booking_no_tour', 'no_tour', 'booking-b1')].last_run_id, run.id, 'findings point at the job_runs row');
  const sweep = client.data.watchdog_sweeps.find((r) => r.scope_key === SCOPE_KEY);
  assert.equal(sweep.generation, 1);
  assert.ok(sweep.released_at, 'the lease was released');
});

await check('sweep 2: a finding still seen is refreshed in place; one examined, fresh and no longer seen is resolved as recovered', async () => {
  a.subjects = ['b1'];
  a.universe = ['b1', 'b2'];
  a.label = 'v2';
  const out = await runWatchdog({ client, scope: SCOPE, now: T(9, 30), checks });
  assert.equal(out.generation, 2);
  assert.equal(out.new, 0);
  assert.equal(out.refreshed, 2, 'b1 and t9');
  assert.equal(out.resolved, 1, 'b2');
  const rows = byId(client);
  assert.equal(client.data.watchdog_findings.length, 3, 'still one row per problem');
  const b1 = rows[ID('booking_no_tour', 'no_tour', 'booking-b1')];
  assert.equal(b1.first_seen_at, T(9).toISOString(), 'first_seen_at kept');
  assert.equal(b1.last_seen_at, T(9, 30).toISOString());
  assert.match(b1.title, /v2/, 'title updated');
  assert.equal(b1.evidence[1].value, 'v2', 'evidence updated');
  assert.equal(b1.last_generation, 2);
  const b2 = rows[ID('booking_no_tour', 'no_tour', 'booking-b2')];
  assert.equal(b2.status, 'resolved');
  assert.equal(b2.resolved_at, T(9, 30).toISOString());
  assert.equal(b2.last_seen_at, T(9).toISOString(), 'a resolved finding keeps when it was last seen');
  assert.equal(b2.meta.resolved_reason, 'recovered');
  assert.equal(b2.meta.resolved_generation, 2);
  assert.match(b2.meta.resolved_note, /complete coverage/);
});

await check('sweep 3: a resolved finding that comes back is reopened, counted once', async () => {
  a.subjects = ['b1', 'b2'];
  const out = await runWatchdog({ client, scope: SCOPE, now: T(10), checks });
  assert.equal(out.reopened, 1);
  const b2 = byId(client)[ID('booking_no_tour', 'no_tour', 'booking-b2')];
  assert.equal(b2.status, 'open');
  assert.equal(b2.reopened_count, 1);
  assert.equal(b2.resolved_at, null);
  assert.equal(b2.meta.resolved_reason, undefined, 'reopening clears the resolution bookkeeping');
  assert.equal(b2.first_seen_at, T(9).toISOString(), 'first_seen_at kept across the reopen');
  await runWatchdog({ client, scope: SCOPE, now: T(10, 30), checks });
  assert.equal(byId(client)[ID('booking_no_tour', 'no_tour', 'booking-b2')].reopened_count, 1, 'staying open does not count again');
});

await check('a human verdict and its context survive refresh and reopen', async () => {
  const row = client.data.watchdog_findings.find((r) => r.id === ID('booking_no_tour', 'no_tour', 'booking-b2'));
  Object.assign(row, { verdict: 'correct', verdict_note: 'real', verdict_at: T(10).toISOString(), verdict_by: 'u1', meta: { verdict_context: { fingerprint: 'abc', reopened_count: 1 } } });
  a.subjects = ['b1'];
  await runWatchdog({ client, scope: SCOPE, now: T(11), checks });
  a.subjects = ['b1', 'b2'];
  await runWatchdog({ client, scope: SCOPE, now: T(11, 30), checks });
  const b2 = byId(client)[ID('booking_no_tour', 'no_tour', 'booking-b2')];
  assert.equal(b2.reopened_count, 2);
  assert.equal(b2.verdict, 'correct');
  assert.equal(b2.verdict_note, 'real');
  assert.deepEqual(b2.meta.verdict_context, { fingerprint: 'abc', reopened_count: 1 }, 'carried across the rewrite');
});

await check('other meta bookkeeping (an existing-monitoring match) survives refresh, resolution bookkeeping does not', async () => {
  const row = client.data.watchdog_findings.find((r) => r.id === ID('booking_no_tour', 'no_tour', 'booking-b2'));
  row.meta = { ...row.meta, existing_monitoring: { system: 'uptime', incident: 'inc-9' }, resolved_reason: 'stale', resolved_note: 'x', resolved_run_id: 'r0' };
  await runWatchdog({ client, scope: SCOPE, now: T(11, 45), checks });
  const b2 = byId(client)[ID('booking_no_tour', 'no_tour', 'booking-b2')];
  assert.deepEqual(b2.meta.existing_monitoring, { system: 'uptime', incident: 'inc-9' }, 'kept across the rewrite');
  assert.deepEqual(b2.meta.verdict_context, { fingerprint: 'abc', reopened_count: 1 });
  assert.equal(b2.meta.resolved_reason, undefined);
  assert.equal(b2.meta.resolved_note, undefined);
  assert.equal(b2.meta.resolved_run_id, undefined);
});

await check('a throwing check becomes one check_error finding and resolves none of its own', async () => {
  a.throws = 'column bookings.tour_id does not exist';
  quiet();
  let out;
  try {
    out = await runWatchdog({ client, scope: SCOPE, now: T(12), checks });
  } finally {
    loud();
  }
  assert.equal(out.ok, true, 'the sweep itself still completes');
  assert.equal(out.checksFailed, 1);
  assert.deepEqual(out.failedChecks, ['booking_no_tour']);
  assert.ok(out.notResolved.some((n) => /booking_no_tour \(threw\)/.test(n)), out.notResolved.join(','));
  const rows = byId(client);
  const sys = rows[ID('booking_no_tour', 'check_error', 'system-booking_no_tour')];
  assert.ok(sys, 'error finding exists');
  assert.equal(sys.subject_type, 'system');
  assert.equal(sys.status, 'open');
  assert.match(sys.detail, /column bookings\.tour_id does not exist/);
  assert.equal(rows[ID('booking_no_tour', 'no_tour', 'booking-b1')].status, 'open', 'a check that threw saw nothing, so it resolves nothing');
  assert.equal(rows[ID('booking_no_tour', 'no_tour', 'booking-b2')].status, 'open');
  assert.equal(rows[ID('guide_missing', 'guide_missing', 'tour-t9')].last_seen_at, T(12).toISOString(), 'the other check still ran');
  const run = client.data.job_runs.filter((r) => r.job === SWEEP_JOB_CRON).at(-1);
  assert.equal(run.ok, true);
  assert.equal(run.summary.failedChecks, 'booking_no_tour');
});

await check('once the check runs cleanly again its check_error finding resolves', async () => {
  a.throws = null;
  const out = await runWatchdog({ client, scope: SCOPE, now: T(12, 30), checks });
  assert.equal(out.checksFailed, 0);
  assert.equal(byId(client)[ID('booking_no_tour', 'check_error', 'system-booking_no_tour')].status, 'resolved');
});

await check('a check that returns a non-list, or has no run(), is a check_error finding too', async () => {
  const c2 = fakePostgrest(tables());
  quiet();
  let out;
  try {
    out = await runWatchdog({
      client: c2, scope: SCOPE, now: T(13),
      checks: [{ id: 'returns_null', severity: 'low', run: async () => null }, { id: 'no_run', severity: 'low' }],
    });
  } finally {
    loud();
  }
  assert.equal(out.checksFailed, 2);
  const rows = byId(c2);
  assert.equal(rows[ID('returns_null', 'check_error', 'system-returns_null')].subject_type, 'system');
  assert.equal(rows[ID('no_run', 'check_error', 'system-no_run')].subject_type, 'system');
});

await check('malformed findings are dropped and reported; the same problem twice collapses to one row', async () => {
  const c3 = fakePostgrest(tables());
  const out = await runWatchdog({
    client: c3, scope: SCOPE, now: T(14),
    checks: [{
      id: 'send_failed', severity: 'high',
      run: async () => [
        { kind: 'send_failed', subject: { type: 'comms', id: 'c1' }, title: 'first' },
        { kind: 'send_failed', subject: { type: 'comms', id: 'c1' }, title: 'second' },
        { kind: 'send_failed', subject: { type: 'comms' }, title: 'no subject id' },
        { subject: { type: 'comms', id: 'c3' }, title: 'no kind' },
        { kind: 'send_failed', subject: { type: 'comms', id: 'c2' }, title: 'odd severity', severity: 'extreme' },
      ],
    }],
  });
  const rows = byId(c3);
  assert.equal(rows[ID('send_failed', 'send_failed', 'comms-c1')].title, 'second');
  assert.equal(rows[ID('send_failed', 'send_failed', 'comms-c2')].severity, 'high', 'an unknown severity falls back to the check default');
  assert.match(rows[ID('send_failed', 'check_error', 'system-send_failed')].detail, /no subject\.id.*no kind/);
  assert.equal(out.checksFailed, 0, 'the good findings still count');
});

await check('an empty check list writes a sweep row and no findings', async () => {
  const c4 = fakePostgrest(tables());
  const out = await runWatchdog({ client: c4, scope: SCOPE, now: T(15), checks: [] });
  assert.equal(out.seen, 0);
  assert.equal(c4.data.watchdog_findings.length, 0);
  assert.equal(c4.data.job_runs.length, 1);
  assert.equal(c4.data.job_runs[0].ok, true);
});

// ── The resolution rule ──────────────────────────────────────────────────────

await check('skipped, partial (returned or reported) and incomplete coverage resolve nothing; a clean complete run does', async () => {
  const c6 = fakePostgrest(tables());
  const st = { subjects: ['x1', 'x2'] };
  const flaky = fakeCheck('flaky', st, { severity: 'medium', type: 'tour', kind: 'flaky' });
  await runWatchdog({ client: c6, scope: SCOPE, now: T(9), checks: [flaky] });
  st.subjects = ['x1'];
  st.universe = ['x1', 'x2'];
  st.skipped = 'switched off';
  const off = await runWatchdog({ client: c6, scope: SCOPE, now: T(9, 30), checks: [flaky] });
  assert.equal(off.resolved, 0, 'switched off is not "nothing wrong"');
  assert.deepEqual(off.notResolved, ['flaky (skipped) x2'], 'both x1 and x2 stay open: a skipped check reported nothing');
  st.skipped = null;
  st.partialReason = 'could not read 1 of 2 tours';
  const part = await runWatchdog({ client: c6, scope: SCOPE, now: T(10), checks: [flaky] });
  assert.equal(part.resolved, 0, 'a partial run did not look at x2');
  assert.deepEqual(part.notResolved, ['flaky (partial)']);
  st.partialReason = null;
  st.returnPartial = { reason: 'model answer rejected', skipped: [{ type: 'tour', id: 'x2' }] };
  const rejected = await runWatchdog({ client: c6, scope: SCOPE, now: T(10, 15), checks: [flaky] });
  assert.equal(rejected.resolved, 0, 'a rejected review cannot resolve');
  assert.deepEqual(rejected.notResolved, ['flaky (partial)']);
  st.returnPartial = null;
  st.incomplete = 'provider list cut short';
  const inc = await runWatchdog({ client: c6, scope: SCOPE, now: T(10, 20), checks: [flaky] });
  assert.equal(inc.resolved, 0);
  assert.match(inc.notResolved[0], /incomplete \(provider list cut short\)/);
  st.incomplete = null;
  const clean = await runWatchdog({ client: c6, scope: SCOPE, now: T(10, 30), checks: [flaky] });
  assert.equal(clean.resolved, 1);
  assert.equal(byId(c6)[ID('flaky', 'flaky', 'tour-x2')].meta.resolved_reason, 'recovered');
});

await check('a subject the run did not positively examine stays open, even on a clean complete run', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['y1', 'y2'] };
  const chk = fakeCheck('scoped', st, { type: 'tour', kind: 'k' });
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  st.subjects = ['y1'];
  st.universe = ['y1'];
  const out = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 0);
  assert.deepEqual(out.notResolved, ['scoped (subject not examined)']);
  assert.equal(byId(c)[ID('scoped', 'k', 'tour-y2')].status, 'open');
});

await check('an interval that holds the finding\'s last evidence counts as examining it', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['z1'], evidenceAt: T(8, 15) };
  const chk = {
    id: 'window', severity: 'low',
    async run({ coverage }) {
      if (st.window) coverage.examinedInterval(...st.window);
      return st.subjects.map((s) => ({ kind: 'k', subject: { type: 'event', id: s }, title: s, evidenceAt: st.evidenceAt }));
    },
  };
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  assert.equal(byId(c)[ID('window', 'k', 'event-z1')].last_evidence_at, T(8, 15).toISOString());
  st.subjects = [];
  st.window = [T(8, 30), T(9, 30)];
  let out = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 0, 'the window started after the evidence');
  st.window = [T(8), T(10)];
  out = await runWatchdog({ client: c, scope: SCOPE, now: T(10), checks: [chk] });
  assert.equal(out.resolved, 1);
});

await check('coverage that is not fresher than the finding\'s evidence cannot resolve it', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['f1'] };
  const chk = fakeCheck('fresh', st, { kind: 'k' });
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  st.subjects = [];
  st.universe = ['f1'];
  st.freshAsOf = T(8, 59);
  let out = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 0);
  assert.match(out.notResolved[0], /not fresher/);
  st.freshAsOf = T(9, 1);
  out = await runWatchdog({ client: c, scope: SCOPE, now: T(10), checks: [chk] });
  assert.equal(out.resolved, 1);
});

await check('a page at the PostgREST cap is truncated: the run is incomplete and resolves nothing; an exact count that matches lifts it', async () => {
  const c = fakePostgrest({ ...tables(), bookings: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] });
  const st = { subjects: ['b9'], countExact: false };
  const chk = {
    id: 'reader', severity: 'low',
    async run({ read, coverage }) {
      const { data } = st.countExact
        ? await read.from('bookings').select('id', { count: 'exact' })
        : await read.from('bookings').select('id');
      coverage.examinedRows('booking', data);
      coverage.examined({ type: 'booking', id: 'b9' });
      return st.subjects.map((s) => ({ kind: 'k', subject: { type: 'booking', id: s }, title: s }));
    },
  };
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [chk], pageCap: 3 });
  st.subjects = [];
  let out = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk], pageCap: 3 });
  assert.equal(out.resolved, 0);
  assert.match(out.notResolved[0], /incomplete \(bookings page truncated\)/);
  assert.equal(out.receipt.truncated, true);
  assert.deepEqual(out.receipt.sources.find((s) => s.name === 'bookings').truncated, true);
  out = await runWatchdog({ client: c, scope: SCOPE, now: T(10), checks: [chk], pageCap: 4 });
  assert.equal(out.resolved, 1, 'a page under the cap is the whole table');
  // Reopen it, then prove an exact count equal to the page lifts the cap.
  st.subjects = ['b9'];
  await runWatchdog({ client: c, scope: SCOPE, now: T(10, 30), checks: [chk], pageCap: 3 });
  st.subjects = [];
  st.countExact = true;
  out = await runWatchdog({ client: c, scope: SCOPE, now: T(11), checks: [chk], pageCap: 3 });
  assert.equal(out.resolved, 1, 'count 3 of 3 rows: not truncated');
});

await check('a check can say why a finding resolved (left_scope); an unknown reason reads as recovered', async () => {
  const c7 = fakePostgrest(tables());
  const st = { subjects: ['t1', 't2'], resolveReason: (row) => (row.subject_id === 't1' ? 'left_scope' : 'something else') };
  const chk = fakeCheck('scoped', st, { severity: 'low', type: 'tour', kind: 'k' });
  await runWatchdog({ client: c7, scope: SCOPE, now: T(9), checks: [chk] });
  st.subjects = [];
  st.universe = ['t1', 't2'];
  await runWatchdog({ client: c7, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(byId(c7)[ID('scoped', 'k', 'tour-t1')].meta.resolved_reason, 'left_scope');
  assert.equal(byId(c7)[ID('scoped', 'k', 'tour-t2')].meta.resolved_reason, 'recovered');
});

await check('a subject the check says left its scope resolves as left_scope without being examined; any other unexamined subject stays open', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['w1', 'w2'] };
  const chk = fakeCheck('windowed', st, { type: 'tour', kind: 'k' });
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  st.subjects = [];
  st.universe = [];
  st.resolveReason = (row) => (row.subject_id === 'w1' ? 'left_scope' : 'recovered');
  const out = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 1);
  assert.equal(byId(c)[ID('windowed', 'k', 'tour-w1')].meta.resolved_reason, 'left_scope');
  assert.equal(byId(c)[ID('windowed', 'k', 'tour-w2')].status, 'open', 'recovered needs the subject examined');
  assert.deepEqual(out.notResolved, ['windowed (subject not examined)']);
  st.skipped = 'off';
  st.subjects = ['w1'];
  await runWatchdog({ client: c, scope: SCOPE, now: T(10), checks: [chk] });
  st.skipped = null;
  st.subjects = [];
  st.incomplete = 'page cut';
  const cut = await runWatchdog({ client: c, scope: SCOPE, now: T(10, 30), checks: [chk] });
  assert.equal(cut.resolved, 0, 'left_scope still needs complete coverage');
});

await check('resolutionDecision, stated once, is exported for the page and the client\'s own evals', () => {
  const row = { subject_type: 'booking', subject_id: 'b1', last_evidence_at: T(9).toISOString() };
  const cov = (extra) => ({ complete: true, examined: [{ type: 'booking', id: 'b1' }], freshAsOf: T(10), words: {}, incompleteWhy: [], ...extra });
  assert.equal(resolutionDecision({ failed: true }, row).why, 'threw');
  assert.equal(resolutionDecision({ coverage: null }, row).why, 'no coverage');
  assert.equal(resolutionDecision({ coverage: cov({ complete: false, incompleteWhy: ['x'] }) }, row).why, 'incomplete (x)');
  assert.equal(resolutionDecision({ coverage: cov({ examined: [] }) }, row).why, 'subject not examined');
  assert.match(resolutionDecision({ coverage: cov({ freshAsOf: T(9) }) }, row).why, /not fresher/);
  assert.deepEqual(resolutionDecision({ coverage: cov() }, row), { ok: true, why: null, reason: 'recovered' });
});

// ── Scope ────────────────────────────────────────────────────────────────────

await check('two tenants with the same subject id get separate rows, and one tenant\'s sweep never resolves the other\'s', async () => {
  const c = fakePostgrest(tables());
  const acme = { installation: 'app', tenant: 'acme', environment: 'production' };
  const beta = { installation: 'app', tenant: 'beta', environment: 'production' };
  const st = { subjects: ['lead-1'] };
  const chk = fakeCheck('reply_missing', st, { type: 'lead', kind: 'reply_missing' });
  await runWatchdog({ client: c, scope: acme, now: T(9), checks: [chk] });
  await runWatchdog({ client: c, scope: beta, now: T(9), checks: [chk] });
  const acmeId = ID('reply_missing', 'reply_missing', 'lead-lead-1', acme);
  const betaId = ID('reply_missing', 'reply_missing', 'lead-lead-1', beta);
  assert.deepEqual(Object.keys(byId(c)).sort(), [acmeId, betaId].sort());
  assert.ok(acmeId.startsWith('app/acme/production:reply_missing:reply_missing:lead-lead-1:'), acmeId);
  st.subjects = [];
  st.universe = ['lead-1'];
  const out = await runWatchdog({ client: c, scope: acme, now: T(10), checks: [chk] });
  assert.equal(out.resolved, 1);
  assert.equal(byId(c)[acmeId].status, 'resolved');
  assert.equal(byId(c)[betaId].status, 'open');
  assert.equal(c.data.watchdog_sweeps.length, 2, 'one generation row per scope');
  assert.equal(out.open, 0, 'the open count is per scope');
});

await check('a preview environment never files under production', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['b1'] };
  await runWatchdog({ client: c, scope: { installation: 'app', tenant: null, environment: 'preview' }, now: T(9), checks: [fakeCheck('x', st)] });
  assert.equal(c.data.watchdog_findings[0].environment, 'preview');
  assert.equal(c.data.watchdog_findings[0].id, ID('x', 'no_tour', 'booking-b1', { installation: 'app', tenant: null, environment: 'preview' }));
  assert.ok(c.data.watchdog_findings[0].id.startsWith('app/-/preview:x:no_tour:booking-b1:'));
  await assert.rejects(runWatchdog({ client: c, scope: { installation: 'app', environment: 'staging' }, now: T(9), checks: [] }), /not production, preview or development/);
});

// ── Generation fence ─────────────────────────────────────────────────────────

await check('a live lease refuses a second sweep (SweepBusyError) and records it; an expired one is taken over; force takes a live one', async () => {
  const c = fakePostgrest(tables());
  c.data.watchdog_sweeps.push({ scope_key: SCOPE_KEY, installation: 'kit-eval', tenant: null, environment: 'development', generation: 7, lease_until: T(9, 5).toISOString() });
  await assert.rejects(runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [] }), SweepBusyError);
  const [busyRun] = c.data.job_runs;
  assert.equal(busyRun.ok, false);
  assert.match(busyRun.summary.busy, /generation 7/);
  assert.equal(c.data.watchdog_sweeps[0].generation, 7, 'nothing claimed');
  const later = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 6), checks: [] });
  assert.equal(later.generation, 8, 'an expired lease is taken over');
  c.data.watchdog_sweeps[0].lease_until = T(23).toISOString();
  const forced = await runWatchdog({ client: c, scope: SCOPE, now: T(9, 7), checks: [], trigger: 'manual', force: true });
  assert.equal(forced.generation, 9);
});

await check('a write on a generation that is no longer current is rejected and nothing is saved', async () => {
  const c = fakePostgrest(tables());
  const st = { subjects: ['b1'] };
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [fakeCheck('x', st)] });
  assert.equal(c.data.watchdog_findings.length, 1);
  const writesBefore = c.writes.length;
  const usurper = {
    id: 'usurper', severity: 'low',
    async run({ coverage, generation }) {
      assert.equal(generation, 2, 'the check sees its own generation');
      // Another sweep claims the scope while this one is still running.
      await claimSweep(c, { scope: SCOPE, trigger: 'manual', now: T(9, 30), force: true });
      coverage.examined({ type: 'booking', id: 'b1' });
      return [];
    },
  };
  st.subjects = ['b1', 'b2'];
  await assert.rejects(runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [fakeCheck('x', st), usurper] }), StaleGenerationError);
  const findingWrites = c.writes.slice(writesBefore).filter((w) => w.table === 'watchdog_findings');
  assert.equal(findingWrites.length, 0, 'no finding was written on the stale generation');
  assert.equal(c.data.watchdog_findings.length, 1, 'b2 was never inserted');
  assert.equal(c.data.watchdog_findings[0].status, 'open', 'b1 was not resolved by the usurped sweep');
  const run = c.data.job_runs.at(-1);
  assert.equal(run.ok, false);
  assert.match(run.error, /generation 2 is no longer current/);
  assert.equal(c.data.watchdog_sweeps[0].generation, 3, 'the usurper\'s claim stands');
});

await check('manual and cron runs record distinct job names', async () => {
  const c = fakePostgrest(tables());
  await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [], trigger: 'cron' });
  await runWatchdog({ client: c, scope: SCOPE, now: T(9, 1), checks: [], trigger: 'manual', startedBy: 'u1' });
  assert.deepEqual(c.data.job_runs.map((r) => r.job), [SWEEP_JOB_CRON, SWEEP_JOB_MANUAL]);
  assert.equal(c.data.job_runs[1].summary.receipt.startedBy, 'u1');
  assert.equal(c.data.job_runs[1].summary.trigger, 'manual');
});

// ── Phases, budget, read-only ────────────────────────────────────────────────

await check('rule findings are committed before any model check runs, and model checks get the budget and the flagged list', async () => {
  const c8 = fakePostgrest(tables());
  let sawRule = null;
  let budget = null;
  let budgetMs = null;
  let flagged = null;
  const model = {
    id: 'model_check', model: true, severity: 'medium', title: 'Model',
    async run({ read, budget: b, budgetMs: ms, flagged: f }) {
      budget = b;
      budgetMs = ms;
      flagged = f;
      const { data } = await read.from('watchdog_findings').select('id');
      sawRule = (data ?? []).map((r) => r.id);
      throw new Error('killed mid-review');
    },
  };
  let ms = 1_000_000;
  quiet();
  try {
    await runWatchdog({ client: c8, scope: SCOPE, now: T(9), clock: () => (ms += 10), checks: [model, fakeCheck('booking_no_tour', { subjects: ['b7'] })] });
  } finally { loud(); }
  assert.deepEqual(sawRule, [ID('booking_no_tour', 'no_tour', 'booking-b7')], 'the rule finding was already saved when the model check started');
  assert.equal(budget.startBy - 1_000_010, 200_000);
  assert.equal(budget.finishBy - 1_000_010, 285_000);
  assert.ok(budgetMs > 284_000 && budgetMs <= 285_000, `budgetMs ${budgetMs}`);
  assert.equal(flagged.length, 1);
  assert.equal(flagged[0].id, ID('booking_no_tour', 'no_tour', 'booking-b7'));
  const receipt = c8.data.job_runs[0].summary.receipt;
  assert.deepEqual(receipt.checks.map((x) => x.id), ['model_check', 'booking_no_tour'], 'the receipt keeps the list order');
  assert.equal(receipt.checks[1].coverage.complete, true);
  assert.equal(receipt.checks[0].coverage, null, 'a check that threw has no coverage');
});

await check('a check that writes through its client is refused and becomes a check_error, not a write', async () => {
  const c = fakePostgrest({ ...tables(), bookings: [{ id: 'b1' }] });
  let caught = null;
  const naughty = {
    id: 'naughty', severity: 'low',
    async run({ read }) {
      try {
        await read.from('bookings').update({ status: 'x' }).eq('id', 'b1');
      } catch (err) { caught = err; throw err; }
      return [];
    },
  };
  quiet();
  let out;
  try { out = await runWatchdog({ client: c, scope: SCOPE, now: T(9), checks: [naughty] }); } finally { loud(); }
  assert.ok(caught instanceof WatchdogWriteRefused);
  assert.equal(out.checksFailed, 1);
  assert.match(byId(c)[ID('naughty', 'check_error', 'system-naughty')].detail, /write refused/);
  assert.equal(c.data.bookings[0].status, undefined, 'the row is untouched');
  assert.ok(!c.writes.some((w) => w.table === 'bookings'));
});

await check('a database error while saving closes the sweep row ok false, releases the lease and throws', async () => {
  const c5 = fakePostgrest(tables());
  const broken = {
    from(table) {
      const q = c5.from(table);
      if (table === 'watchdog_findings') q.upsert = () => ({ select: async () => ({ data: null, error: { message: 'permission denied' } }) });
      return q;
    },
  };
  await assert.rejects(
    runWatchdog({ client: broken, scope: SCOPE, now: T(16), checks: [fakeCheck('booking_no_tour', { subjects: ['b1'] })] }),
    /permission denied/,
  );
  const [run] = c5.data.job_runs;
  assert.equal(run.ok, false);
  assert.match(run.error, /permission denied/);
  assert.equal(c5.data.watchdog_sweeps[0].lease_until, c5.data.watchdog_sweeps[0].released_at);
});

// ── 0.2.0: invariants the review found unproven ──────────────────────────────

/** Run a sweep with console.error quiet; returns the summary or throws. */
async function sweep(opts) {
  quiet();
  try { return await runWatchdog(opts); } finally { loud(); }
}

/** A rule check over `events` rows ({ id, at }) that reports every row it reads and examines a 24 hour window. */
function eventsCheck(id = 'events_stuck', { returnCoverage = null } = {}) {
  return {
    id, severity: 'high',
    async run({ read, now, coverage }) {
      const { data } = await read.from('events').select('id, at');
      const rows = data ?? []; // the mistake the fence must survive: null read as empty
      coverage.examinedInterval(new Date(now.getTime() - 24 * 3600_000), now);
      const findings = rows.map((r) => ({ kind: 'stuck', subject: { type: 'event', id: r.id }, title: `${r.id} stuck`, evidenceAt: r.at }));
      return returnCoverage ? { findings, coverage: returnCoverage(now) } : findings;
    },
  };
}

await check('failed_read_resolves_nothing: a check whose read errors and treats null as empty does not resolve its findings', async () => {
  const c = fakePostgrest({ ...tables(), events: [{ id: 'e1', at: T(8).toISOString() }] });
  const st = { fail: false };
  const client = {
    from(table) {
      if (table !== 'events' || !st.fail) return c.from(table);
      const res = { data: null, error: { message: 'canceling statement due to statement timeout' } };
      const b = { select: () => b, then: (ok, bad) => Promise.resolve(res).then(ok, bad) };
      return b;
    },
  };
  await sweep({ client, scope: SCOPE, now: T(9), checks: [eventsCheck()] });
  st.fail = true;
  const out = await sweep({ client, scope: SCOPE, now: T(9, 30), checks: [eventsCheck()] });
  assert.equal(out.resolved, 0, out.notResolved.join(','));
  assert.match(out.notResolved.join(','), /events read failed/);
  assert.equal(byId(c)[ID('events_stuck', 'stuck', 'event-e1')].status, 'open');
  assert.equal(out.receipt.sources.find((x) => x.name === 'events').readFailed, true);
});

await check('returned_coverage_cannot_override_incompleteness: a check that called incomplete() or read a truncated page cannot return complete: true and resolve', async () => {
  const c = fakePostgrest({ ...tables(), bookings: [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }] });
  const st = { report: true, mode: 'incomplete' };
  const chk = {
    id: 'override', severity: 'high',
    async run({ read, now, coverage }) {
      if (st.mode === 'incomplete') coverage.incomplete('provider list cut short');
      else await read.from('bookings').select('id');
      const findings = st.report ? [{ kind: 'k', subject: { type: 'booking', id: 'b9' }, title: 'b9' }] : [];
      return { findings, coverage: { complete: true, freshAsOf: now, sources: [{ name: 'api', rows: 1 }], examined: [{ type: 'booking', id: 'b9' }] } };
    },
  };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [chk], pageCap: 3 });
  st.report = false;
  let out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk], pageCap: 3 });
  assert.equal(out.resolved, 0, 'incomplete() stands');
  assert.match(out.notResolved[0], /provider list cut short/);
  st.mode = 'truncated';
  out = await sweep({ client: c, scope: SCOPE, now: T(10), checks: [chk], pageCap: 3 });
  assert.equal(out.resolved, 0, 'the ledger truncation stands');
  assert.match(out.notResolved[0], /bookings page truncated/);
});

await check('dropped_malformed_finding_resolves_nothing: a check that reports a subject badly does not resolve that subject', async () => {
  const c = fakePostgrest(tables());
  const st = { title: 'b1 is on no tour' };
  const chk = {
    id: 'sloppy', severity: 'high',
    async run({ coverage }) {
      coverage.examined({ type: 'booking', id: 'b1' });
      return [{ kind: 'no_tour', subject: { type: 'booking', id: 'b1' }, title: st.title }];
    },
  };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  st.title = '';
  const out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 0);
  assert.deepEqual(out.notResolved, ['sloppy (partial)']);
  assert.equal(byId(c)[ID('sloppy', 'no_tour', 'booking-b1')].status, 'open', 'the check still saw the problem');
  assert.equal(byId(c)[ID('sloppy', 'check_error', 'system-sloppy')].status, 'open', 'and the drop is on the page');
  assert.match(out.receipt.checks[0].partial.join(','), /1 malformed finding dropped/);
});

await check('interval_never_resolves_defaulted_evidence: a finding with no evidenceAt is not held by a window it merely overlaps', async () => {
  const c = fakePostgrest({ ...tables(), events: [{ id: 'e1' }] });
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [eventsCheck()] });
  const row = byId(c)[ID('events_stuck', 'stuck', 'event-e1')];
  assert.equal(row.last_evidence_at, T(9).toISOString(), 'the sweep time stood in for the event time');
  assert.equal(row.meta.evidence_defaulted, true);
  c.data.events = [];
  const out = await sweep({ client: c, scope: SCOPE, now: T(10), checks: [eventsCheck()] });
  assert.equal(out.resolved, 0, 'the window [T-24h, T) holds 09:00, but 09:00 is when a sweep saw it, not when it happened');
  assert.match(out.notResolved[0], /evidence time defaulted/);
  // With the event time given explicitly, the same window does resolve it.
  const c2 = fakePostgrest({ ...tables(), events: [{ id: 'e1', at: T(8).toISOString() }] });
  await sweep({ client: c2, scope: SCOPE, now: T(9), checks: [eventsCheck()] });
  assert.equal(byId(c2)[ID('events_stuck', 'stuck', 'event-e1')].meta.evidence_defaulted, undefined);
  c2.data.events = [];
  assert.equal((await sweep({ client: c2, scope: SCOPE, now: T(10), checks: [eventsCheck()] })).resolved, 1);
});

await check('stale_refresh_is_refused: a newer sweep that wrote the row between the fence read and the write wins, and the stale sweep throws', async () => {
  let armed = false;
  const c = fakePostgrest(tables(), {
    beforeWrite: async (table, op) => {
      if (!armed || table !== 'watchdog_findings' || (op !== 'update' && op !== 'upsert')) return;
      armed = false;
      // Another sweep claims the scope and writes the row in the gap.
      await claimSweep(c, { scope: SCOPE, trigger: 'manual', now: T(9, 31), force: true });
      Object.assign(c.data.watchdog_findings.find((r) => r.subject_id === 'b1'), { title: 'newer sweep', last_generation: 3, last_seen_at: T(9, 31).toISOString() });
    },
  });
  const st = { subjects: ['b1'] };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [fakeCheck('x', st)] });
  st.label = 'stale';
  armed = true;
  quiet();
  try {
    await assert.rejects(runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [fakeCheck('x', st)] }), StaleGenerationError);
  } finally { loud(); }
  const row = byId(c)[ID('x', 'no_tour', 'booking-b1')];
  assert.equal(row.title, 'newer sweep', 'the newer sweep\'s row was not overwritten');
  assert.equal(row.last_generation, 3);
  assert.equal(row.first_seen_at, T(9).toISOString());
});

await check('stale_resolve_is_refused: a stale sweep cannot resolve a finding a newer sweep has just refreshed', async () => {
  let armed = false;
  const c = fakePostgrest(tables(), {
    beforeWrite: async (table, op, payload) => {
      if (!armed || table !== 'watchdog_findings' || op !== 'update' || payload?.status !== 'resolved') return;
      armed = false;
      await claimSweep(c, { scope: SCOPE, trigger: 'manual', now: T(9, 31), force: true });
      Object.assign(c.data.watchdog_findings.find((r) => r.subject_id === 'b2'), { last_generation: 3, last_seen_at: T(9, 31).toISOString() });
    },
  });
  const st = { subjects: ['b1', 'b2'] };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [fakeCheck('x', st)] });
  st.subjects = ['b1'];
  st.universe = ['b1', 'b2'];
  armed = true;
  quiet();
  try {
    await assert.rejects(runWatchdog({ client: c, scope: SCOPE, now: T(9, 30), checks: [fakeCheck('x', st)] }), StaleGenerationError);
  } finally { loud(); }
  const b2 = byId(c)[ID('x', 'no_tour', 'booking-b2')];
  assert.equal(b2.status, 'open', 'no flap: the newer sweep saw it');
  assert.equal(b2.reopened_count, 0);
});

await check('finding_ids_are_injective: lookalike slugs in one sweep are two rows, and lookalike scopes never share a row or a lease', async () => {
  const c = fakePostgrest(tables());
  const chk = {
    id: 'lookalike', severity: 'low',
    async run() {
      return [
        { kind: 'k', subject: { type: 'lead', id: 'a b' }, title: 'space' },
        { kind: 'k', subject: { type: 'lead', id: 'a_b' }, title: 'underscore' },
        { kind: 'k', subject: { type: 'lead', id: '客户' }, title: 'customer' },
        { kind: 'k', subject: { type: 'lead', id: '用户' }, title: 'user' },
        { kind: 'k', subject: { type: 'x', id: '1' }, entities: [{ type: 'y', id: '2' }], title: 'x names y' },
        { kind: 'k', subject: { type: 'y', id: '2' }, entities: [{ type: 'x', id: '1' }], title: 'y names x' },
      ];
    },
  };
  const out = await sweep({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  assert.equal(out.new, 6);
  assert.equal(new Set(c.data.watchdog_findings.map((r) => r.title)).size, 6, 'no problem overwrote another');
  const st = { subjects: ['b1'] };
  for (const scope of [
    { installation: 'acme prod', tenant: null, environment: 'production' },
    { installation: 'acme_prod', tenant: null, environment: 'production' },
    { installation: 'acme_prod', tenant: '-', environment: 'production' },
  ]) await sweep({ client: c, scope, now: T(9), checks: [fakeCheck('dup_scope', st)] });
  assert.equal(c.data.watchdog_findings.filter((r) => r.check_id === 'dup_scope').length, 3, 'three scopes, three rows');
  assert.equal(c.data.watchdog_sweeps.length, 4, 'and four leases (the eval scope plus three)');
  assert.ok(c.data.watchdog_sweeps.every((r) => r.generation === 1), 'no scope bumped another\'s generation');
});

await check('check_writes_one_own_table: a check may write one table of its own, shared with other model checks, never a kit table or a table a check reads', async () => {
  const store = { id: 'store_check', severity: 'low', writes: ['check_store'], async run({ read }) { await read.from('check_store').upsert({ id: 's1' }); return []; } };
  const c = fakePostgrest({ ...tables(), check_store: [] });
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [store] });
  assert.equal(c.data.check_store.length, 1, 'its own table');
  const shared = fakePostgrest({ ...tables(), check_store: [] });
  await sweep({ client: shared, scope: SCOPE, now: T(9), checks: [store, { ...store, id: 'store_two' }] });
  assert.equal(shared.data.check_store.length, 1, 'two model checks may share one review table, keyed by check id');
  for (const [label, list] of [
    ['a kit table', [{ id: 'evil', severity: 'low', writes: ['watchdog_sweeps'], run: async ({ read }) => { await read.from('watchdog_sweeps').update({ generation: 99 }).eq('scope_key', SCOPE_KEY); return []; } }]],
    ['findings', [{ id: 'evil', severity: 'low', writes: ['watchdog_findings'], run: async () => [] }]],
    ['two tables', [{ id: 'evil', severity: 'low', writes: ['a_store', 'b_store'], run: async () => [] }]],
    ['a table a check reads', [{ ...store, id: 'store_three', writes: ['bookings'] }, { id: 'reader_check', severity: 'low', reads: ['bookings'], run: async () => [] }]],
  ]) {
    const c2 = fakePostgrest(tables());
    c2.data.watchdog_sweeps.push({ scope_key: SCOPE_KEY, installation: 'kit-eval', tenant: null, environment: 'development', generation: 5, lease_until: T(8).toISOString() });
    await assert.rejects(sweep({ client: c2, scope: SCOPE, now: T(9), checks: list }), /refused the check list/, label);
    assert.equal(c2.data.watchdog_sweeps[0].generation, 5, `${label}: nothing claimed, nothing moved`);
    assert.equal(c2.data.job_runs.at(-1).ok, false, `${label}: the refusal is on record`);
  }
});

await check('coverage_scope_must_equal_sweep_scope: coverage that names another scope resolves nothing', async () => {
  const c = fakePostgrest(tables());
  const st = { report: true };
  const chk = {
    id: 'scope_liar', severity: 'high',
    async run({ now }) {
      return {
        findings: st.report ? [{ kind: 'k', subject: { type: 'lead', id: 'l1' }, title: 'l1' }] : [],
        coverage: { scope: { installation: 'other', tenant: 'zzz', environment: 'production' }, complete: true, freshAsOf: now, examined: [{ type: 'lead', id: 'l1' }] },
      };
    },
  };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  st.report = false;
  const out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 0);
  assert.deepEqual(out.notResolved, ['scope_liar (coverage for another scope)']);
});

await check('check_ids_unique_and_valid: a duplicate, missing or malformed check id refuses the sweep before anything is claimed', async () => {
  const ok = { severity: 'low', run: async () => [] };
  for (const [label, list] of [
    ['duplicate', [{ ...ok, id: 'dup', run: async () => { throw new Error('boom'); } }, { ...ok, id: 'dup' }]],
    ['missing', [{ ...ok }]],
    ['not a string', [{ ...ok, id: 7 }]],
    ['a quote', [{ ...ok, id: 'bad"id' }]],
    ['upper case and dash', [{ ...ok, id: 'Bad-Id' }]],
    ['not an object', [null]],
  ]) {
    const c = fakePostgrest(tables());
    await assert.rejects(sweep({ client: c, scope: SCOPE, now: T(9), checks: list }), TypeError, label);
    assert.equal(c.data.watchdog_sweeps.length, 0, `${label}: no lease claimed`);
    assert.equal(c.data.watchdog_findings.length, 0, `${label}: nothing written`);
  }
});

await check('hung_check_times_out: a check that never settles becomes a check_error at the hard stop and the sweep still finishes', async () => {
  const c = fakePostgrest(tables());
  const hung = { id: 'hung', severity: 'low', run: () => new Promise(() => {}) };
  let guardTimer;
  const guard = new Promise((_, reject) => { guardTimer = setTimeout(() => { loud(); reject(new Error('the sweep itself hung')); }, 3000); });
  const out = await Promise.race([sweep({ client: c, scope: SCOPE, now: T(9), checks: [hung, fakeCheck('after_hung', { subjects: ['b1'] })], hardStopMs: 50 }), guard])
    .finally(() => clearTimeout(guardTimer));
  assert.deepEqual(out.failedChecks, ['hung', 'after_hung'], 'the hard stop had passed, so the next check timed out at once');
  assert.match(byId(c)[ID('hung', 'check_error', 'system-hung')].detail, /did not finish within/);
  assert.equal(byId(c)[ID('after_hung', 'no_tour', 'booking-b1')], undefined);
  assert.deepEqual(out.notResolved, [], 'nothing was open to resolve, and a timed out check could not have');
  assert.equal(c.data.job_runs[0].ok, true, 'the job_runs row closed');
  assert.ok(c.data.watchdog_sweeps[0].released_at, 'the lease was released');
});

await check('model_check_skipped_after_start_budget: a model check is not started once the start budget has passed, and resolves nothing', async () => {
  const c = fakePostgrest(tables());
  let ran = 0;
  const st = { report: true };
  const model = {
    id: 'model_review', model: true, severity: 'medium',
    async run({ coverage }) {
      ran += 1;
      coverage.examined({ type: 'tour', id: 't1' });
      return st.report ? [{ kind: 'k', subject: { type: 'tour', id: 't1' }, title: 't1' }] : [];
    },
  };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [model] });
  assert.equal(ran, 1);
  st.report = false;
  let ms = 0;
  const out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [model], clock: () => (ms += 1000), modelStartBudgetMs: 500 });
  assert.equal(ran, 1, 'not started');
  assert.equal(out.resolved, 0);
  assert.deepEqual(out.notResolved, ['model_review (skipped)']);
  assert.deepEqual(out.receipt.skipped, ['model_review']);
  assert.equal(out.checksFailed, 0, 'skipped is not failed');
  assert.equal(byId(c)[ID('model_review', 'k', 'tour-t1')].status, 'open');
});

await check('open_findings_beyond_the_server_cap_all_resolve: the open read pages past max-rows', async () => {
  const c = fakePostgrest(tables(), { maxRows: 3 });
  const st = { subjects: ['o1', 'o2', 'o3', 'o4', 'o5', 'o6', 'o7'] };
  const chk = fakeCheck('many', st);
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [chk] });
  assert.equal(c.data.watchdog_findings.length, 7);
  const again = await sweep({ client: c, scope: SCOPE, now: T(9, 15), checks: [chk] });
  assert.equal(again.refreshed, 7, 'every existing row was found, so none was treated as new');
  st.universe = st.subjects;
  st.subjects = [];
  const out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [chk] });
  assert.equal(out.resolved, 7, 'not just the first page of 3');
});

await check('in_lists_fit_in_a_url: every in() list the sweep sends stays under the encoded length limit', async () => {
  const c = fakePostgrest(tables());
  let longest = 0;
  const client = {
    from(table) {
      const q = c.from(table);
      const inner = q.in.bind(q);
      q.in = (col, vals) => { longest = Math.max(longest, encodeURIComponent(vals.map((v) => `"${v}"`).join(',')).length); return inner(col, vals); };
      return q;
    },
  };
  const st = { subjects: Array.from({ length: 60 }, (_, i) => `${'long-provider-identifier-'.repeat(10)}${i}`) };
  const out = await sweep({ client, scope: SCOPE, now: T(9), checks: [fakeCheck('long_ids', st)] });
  assert.equal(out.new, 60);
  assert.ok(longest > 0 && longest <= IN_URL_CHARS, `longest in() list ${longest} characters`);
  assert.deepEqual(chunkForIn(['a', 'b'], { maxChars: 6000 }), [['a', 'b']]);
  assert.equal(chunkForIn(Array.from({ length: 10 }, () => 'x'.repeat(100)), { maxChars: 300 }).length, 5);
});

await check('meta_survives_concurrent_writes: a verdict written during a refresh, or between the open read and a resolve, is kept', async () => {
  let armed = false;
  const verdict = { fingerprint: 'judged', reopened_count: 0 };
  const c = fakePostgrest(tables(), {
    beforeWrite: async (table, op, payload) => {
      const rows = [].concat(payload ?? []);
      if (!armed || table !== 'watchdog_findings' || (op !== 'update' && op !== 'upsert') || !rows.some((r) => r?.status === 'open')) return;
      armed = false;
      const row = c.data.watchdog_findings.find((r) => r.subject_id === 'b1');
      row.meta = { ...row.meta, verdict_context: verdict };
    },
  });
  const st = { subjects: ['b1', 'b2'] };
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [fakeCheck('x', st)] });
  armed = true;
  await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [fakeCheck('x', st)] });
  assert.deepEqual(byId(c)[ID('x', 'no_tour', 'booking-b1')].meta.verdict_context, verdict, 'a refresh sends no meta, so it overwrote nothing');

  // Now a verdict lands on b2 after the sweep read its open rows but before it resolves b2.
  let injected = false;
  const client = {
    from(table) {
      const q = c.from(table);
      if (table !== 'watchdog_findings') return q;
      const select = q.select.bind(q);
      q.select = (cols, o) => {
        const r = select(cols, o);
        if (!injected && String(cols).includes('last_evidence_at')) {
          const then = r.then.bind(r);
          r.then = (ok, bad) => then((res) => {
            injected = true;
            const row = c.data.watchdog_findings.find((x) => x.subject_id === 'b2');
            row.meta = { ...row.meta, verdict_context: verdict };
            return ok ? ok(res) : res;
          }, bad);
        }
        return r;
      };
      return q;
    },
  };
  st.subjects = ['b1'];
  st.universe = ['b1', 'b2'];
  const out = await sweep({ client, scope: SCOPE, now: T(10), checks: [fakeCheck('x', st)] });
  assert.equal(out.resolved, 1);
  const b2 = byId(c)[ID('x', 'no_tour', 'booking-b2')];
  assert.equal(b2.status, 'resolved');
  assert.deepEqual(b2.meta.verdict_context, verdict, 'the resolve re-read meta and added only its own keys');
  assert.equal(b2.meta.resolved_reason, 'recovered');
});

await check('receipt_names_the_page_cap: the cap the sweep judged truncation against is on the receipt with its caveat', async () => {
  const c = fakePostgrest(tables());
  let out = await sweep({ client: c, scope: SCOPE, now: T(9), checks: [] });
  assert.deepEqual(out.receipt.pageCap.assumed, 1000);
  assert.equal(out.receipt.pageCap.given, false);
  assert.match(out.receipt.pageCap.note, /not detectable/);
  out = await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks: [], pageCap: 500 });
  assert.equal(out.receipt.pageCap.assumed, 500);
  assert.equal(out.receipt.pageCap.given, true);
});

await check('first_claim_race_is_busy: two first-ever claims both insert, and the loser gets SweepBusyError', async () => {
  let armed = true;
  const c = fakePostgrest(tables(), {
    unique: { watchdog_sweeps: 'scope_key' },
    beforeWrite: async (table, op) => {
      if (!armed || table !== 'watchdog_sweeps' || op !== 'insert') return;
      armed = false;
      c.data.watchdog_sweeps.push({ scope_key: SCOPE_KEY, installation: 'kit-eval', tenant: null, environment: 'development', generation: 1, lease_until: T(9, 10).toISOString() });
    },
  });
  await assert.rejects(sweep({ client: c, scope: SCOPE, now: T(9), checks: [] }), SweepBusyError);
  assert.match(c.data.job_runs[0].summary.busy, /generation 1/);
});

await check('release_is_checked_and_timed: a refused release is reported, and released_at is the release time, not the start', async () => {
  const c = fakePostgrest(tables());
  let ms = 0;
  await sweep({ client: c, scope: SCOPE, now: T(9), checks: [fakeCheck('x', { subjects: ['b1'] })], clock: () => (ms += 1000) });
  const row = c.data.watchdog_sweeps[0];
  assert.ok(Date.parse(row.released_at) > T(9).getTime(), `released_at ${row.released_at} is after the start`);
  assert.equal(row.lease_until, row.released_at);
  assert.equal(c.data.job_runs[0].finished_at, row.released_at, 'the heartbeat closes at the same instant');
  const errors = [];
  const refusing = { from: () => { const b = { update: () => b, eq: () => b, select: () => b, then: (ok) => Promise.resolve({ data: null, error: { message: 'permission denied' } }).then(ok) }; return b; } };
  assert.equal(await releaseSweep(refusing, SCOPE, 1, { now: T(9), onError: (e) => errors.push(e.message) }), false);
  assert.match(errors[0], /permission denied/);
  const usurped = fakePostgrest({ watchdog_sweeps: [{ scope_key: SCOPE_KEY, generation: 4 }] });
  assert.equal(await releaseSweep(usurped, SCOPE, 3, { now: T(9), onError: (e) => errors.push(e.message) }), false);
  assert.match(errors[1], /no longer holds the lease/);
});

await check('the sweep never writes any table but watchdog_findings, watchdog_sweeps and job_runs, on a sweep that takes every path', async () => {
  // A fresh client, so the write log holds this test's sweeps only: new,
  // refreshed, reopened and resolved findings, a check that throws, a model
  // check, and a check with its own store (whose writes are its table's).
  const c = fakePostgrest({ ...tables(), check_store: [], bookings: [{ id: 'b1' }] });
  const st = { subjects: ['b1', 'b2'] };
  const thrower = { id: 'thrower', severity: 'low', run: async () => { throw new Error('boom'); } };
  const model = { id: 'model_path', model: true, severity: 'low', writes: ['check_store'], async run({ read }) { await read.from('bookings').select('id'); await read.from('check_store').upsert({ id: 'r1' }); return []; } };
  const checks = [fakeCheck('paths', st), thrower, model];
  await sweep({ client: c, scope: SCOPE, now: T(9), checks });
  st.subjects = ['b1'];
  st.universe = ['b1', 'b2'];
  await sweep({ client: c, scope: SCOPE, now: T(9, 30), checks });
  st.subjects = ['b1', 'b2'];
  const last = await sweep({ client: c, scope: SCOPE, now: T(10), checks });
  assert.equal(last.reopened, 1, 'the reopen path ran');
  const written = new Set(c.writes.map((w) => w.table));
  assert.deepEqual([...written].sort(), ['check_store', 'job_runs', 'watchdog_findings', 'watchdog_sweeps']);
  assert.ok(c.writes.filter((w) => w.table === 'check_store').length === 3, 'only the model check, through its own scoped writer');
  assert.ok(!c.writes.some((w) => w.table === 'bookings'));
});

done();
