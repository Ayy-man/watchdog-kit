#!/usr/bin/env node
/**
 * evals/eval-self-check.mjs: the watchdog watching itself
 * (core/self-check.js): a skipped slot is a sweep_missed finding that
 * resolves only by leaving the lookback, and the stale alarm is a pure
 * function of job_runs the page and the hub can compute without a sweep.
 *
 *   node evals/eval-self-check.mjs
 */

import { fakePostgrest } from './lib/fake-postgrest.mjs';
import { assert, check, done, quiet, SCOPE, T } from './lib/harness.mjs';
import { buildFindingId } from '../core/scope.js';
import { runWatchdog } from '../core/run.js';
import { slotsBetween, missedSlots, staleAlarm, sweepSelfCheck, SWEEP_JOB } from '../core/self-check.js';

quiet();
const MIN = 60_000;
const run = (start, ok = true, minutes = 1) => ({
  id: `r-${start.toISOString()}`, job: SWEEP_JOB, started_at: start.toISOString(),
  finished_at: new Date(start.getTime() + minutes * MIN).toISOString(), ok, summary: null, error: null,
});
const tables = () => ({ watchdog_findings: [], watchdog_sweeps: [], job_runs: [], watchdog_reviews: [] });
const ID = (slot) => buildFindingId(SCOPE, 'watchdog_self', 'sweep_missed', { subject: { type: 'job_slot', id: `${SWEEP_JOB}@${slot.toISOString()}` } });

await check('slots are aligned to the cadence and half-open', async () => {
  const s = slotsBetween(T(9, 10), T(10, 30), 30 * MIN);
  assert.deepEqual(s.map((d) => d.toISOString()), [T(9, 30).toISOString(), T(10).toISOString()]);
  assert.deepEqual(slotsBetween(T(9), T(9), 30 * MIN), []);
});

await check('a run within the grace either side covers its slot and no other', async () => {
  const slots = slotsBetween(T(8, 50), T(10, 10), 30 * MIN); // 9:00, 9:30, 10:00
  const runs = [run(T(9, 4)), run(T(9, 59))];
  assert.deepEqual(missedSlots(slots, runs, { graceMs: 10 * MIN }).map((d) => d.toISOString()), [T(9, 30).toISOString()]);
  assert.deepEqual(missedSlots(slots, [run(T(9, 11))], { graceMs: 10 * MIN }).length, 3, 'eleven minutes late is a miss');
});

await check('the stale alarm is pure and counts only finished runs', async () => {
  const fresh = staleAlarm([run(T(9, 30))], T(10, 15), { cadenceMs: 30 * MIN });
  assert.equal(fresh.stale, false);
  assert.equal(fresh.ageMs, 44 * MIN);
  const old = staleAlarm([run(T(8))], T(10, 15), { cadenceMs: 30 * MIN });
  assert.equal(old.stale, true);
  assert.equal(old.thresholdMs, 60 * MIN);
  const unfinished = staleAlarm([{ started_at: T(10, 10).toISOString(), finished_at: null }], T(10, 15), { cadenceMs: 30 * MIN });
  assert.equal(unfinished.stale, true, 'a started but unfinished run is not a finished sweep');
  assert.equal(unfinished.lastFinishedAt, null);
  assert.equal(staleAlarm([], T(10), { cadenceMs: 30 * MIN }).stale, true, 'never ran is stale');
});

await check('a grace at or above half the cadence is refused', async () => {
  assert.throws(() => sweepSelfCheck({ cadenceMs: 30 * MIN, graceMs: 15 * MIN }), /half the cadence/);
});

const client = fakePostgrest(tables());
const chk = sweepSelfCheck({ cadenceMs: 30 * MIN, graceMs: 10 * MIN, lookbackMs: 3 * 60 * MIN });

await check('a skipped slot inside the lookback is one sweep_missed finding on that slot', async () => {
  // Sweeps at 7:00, 7:30, (8:00 missed), 8:30, 9:00, 9:30; now 9:45, examined slots 7:00..9:30 (9:30 grace passed at 9:40).
  for (const h of [[7, 0], [7, 30], [8, 30], [9, 0], [9, 30]]) client.data.job_runs.push(run(T(...h)));
  const out = await runWatchdog({ client, scope: SCOPE, now: T(9, 45), checks: [chk] });
  const rows = client.data.watchdog_findings;
  assert.equal(rows.length, 1, JSON.stringify(rows.map((r) => r.id)));
  assert.equal(rows[0].id, ID(T(8)));
  assert.equal(rows[0].status, 'open');
  assert.equal(rows[0].subject_type, 'job_slot');
  assert.equal(out.receipt.checks[0].coverage.complete, true);
});

await check('the finding cannot recover: the next sweep keeps it open', async () => {
  client.data.job_runs.push(run(T(10)));
  await runWatchdog({ client, scope: SCOPE, now: T(10, 15), checks: [chk] });
  const row = client.data.watchdog_findings.find((r) => r.id === ID(T(8)));
  assert.equal(row.status, 'open');
  assert.equal(row.reopened_count, 0);
});

await check('it resolves as left_scope once the slot leaves the lookback', async () => {
  for (const m of [30, 0]) client.data.job_runs.push(run(new Date(T(11).getTime() - m * MIN)));
  client.data.job_runs.push(run(T(11, 30)));
  await runWatchdog({ client, scope: SCOPE, now: T(11, 45), checks: [chk] }); // lookback from 8:45: the 8:00 slot is out
  const row = client.data.watchdog_findings.find((r) => r.id === ID(T(8)));
  assert.equal(row.status, 'resolved');
  assert.equal(row.meta.resolved_reason, 'left_scope');
});

await check('self_check_truncated_page_raises_no_false_misses: slots older than the oldest run read are neither reported nor examined', async () => {
  // 1000 runs, one a minute, ending at 09:30: the newest 1000 reach back to
  // about 16:51 the day before. With a 24 hour lookback the slots before
  // that would all look missed if the page were trusted.
  const c2 = fakePostgrest(tables());
  for (let i = 0; i < 1000; i++) c2.data.job_runs.push(run(new Date(T(9, 30).getTime() - i * MIN)));
  const wide = sweepSelfCheck({ cadenceMs: 30 * MIN, graceMs: 10 * MIN, lookbackMs: 24 * 60 * MIN });
  const out = await runWatchdog({ client: c2, scope: SCOPE, now: T(9, 45), checks: [wide] });
  const cov = out.receipt.checks[0].coverage;
  assert.equal(cov.complete, false, 'a truncated page is incomplete coverage');
  assert.match(cov.incompleteWhy.join(','), /truncated/);
  assert.equal(c2.data.watchdog_findings.length, 0, 'no slot was reported missed on rows the check never read');
  assert.ok(cov.examined > 0 && cov.examined < 48, `examined ${cov.examined} slots, only those the page reaches`);
});

await check('self_check_evidence_cites_its_slot: two missed slots carry different evidence', async () => {
  const c3 = fakePostgrest(tables());
  for (const h of [[7, 0], [8, 30], [9, 0], [9, 30]]) c3.data.job_runs.push(run(T(...h)));
  await runWatchdog({ client: c3, scope: SCOPE, now: T(9, 45), checks: [chk] });
  const rows = c3.data.watchdog_findings.filter((r) => r.kind === 'sweep_missed');
  assert.equal(rows.length, 2, '7:30 and 8:00');
  assert.deepEqual(rows.map((r) => r.evidence[0].id).sort(), [`${SWEEP_JOB}@${T(7, 30).toISOString()}`, `${SWEEP_JOB}@${T(8).toISOString()}`]);
  assert.ok(rows.every((r) => !('slot' in r.evidence[0])), 'evidence refs are in the EvidenceRef shape');
});

await check('self_check_refuses_nonsense_timing: a negative grace, or a cadence or lookback that is not a positive number, is refused', async () => {
  assert.throws(() => sweepSelfCheck({ cadenceMs: 30 * MIN, graceMs: -1 }), /graceMs/);
  assert.throws(() => sweepSelfCheck({ cadenceMs: 0, graceMs: 0 }), /cadenceMs/);
  assert.throws(() => sweepSelfCheck({ cadenceMs: 30 * MIN, graceMs: 0, lookbackMs: 0 }), /lookbackMs/);
  assert.throws(() => sweepSelfCheck({ cadenceMs: Number.NaN }), /cadenceMs/);
});

await check('stale_alarm_needs_an_ok_run: a sweep that finishes ok false every time is dead, and the alarm says which kind of dead', async () => {
  const failing = staleAlarm([run(T(10), false), run(T(10, 30), false)], T(10, 40), { cadenceMs: 30 * MIN });
  assert.equal(failing.stale, true);
  assert.equal(failing.lastFinishedAt.toISOString(), new Date(T(10, 30).getTime() + MIN).toISOString(), 'it is running');
  assert.equal(failing.lastOkAt, null, 'but never succeeds');
  const old = staleAlarm([run(T(10), false)], T(10, 40), { cadenceMs: 30 * MIN, requireOk: false });
  assert.equal(old.stale, false, 'the 0.1 reading on request');
  assert.equal(staleAlarm([run(T(10)), run(T(10, 30), false)], T(10, 40), { cadenceMs: 30 * MIN }).stale, false, 'one recent ok run is enough');
});

done();
