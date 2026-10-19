#!/usr/bin/env node
/**
 * evals/eval-job-run.mjs: job heartbeats (core/job-run.js) and the scheduled
 * route wrapper (core/cron-run.js).
 *
 * Asserts the wrapper contract: a run opens a job_runs row and closes it with
 * ok, a trimmed summary or the error text; a heartbeat the database refuses
 * never breaks, changes or delays the job, and the failure is recorded
 * through the observation sink; only a real scheduled call is recorded; an
 * early exit records summary.skipped with its reason.
 *
 *   node evals/eval-job-run.mjs
 */

import { fakePostgrest } from './lib/fake-postgrest.mjs';
import { assert, check, done } from './lib/harness.mjs';
import { withJobRun, recordJobRun, startJobRun, finishJobRun, trimSummary } from '../core/job-run.js';
import { DEFAULT_MANUAL_HEADER, isOkRun, runCronJob, isScheduledCronCall, responseSummary } from '../core/cron-run.js';

const fakeClient = () => fakePostgrest({ job_runs: [] });

/** A client whose every job_runs write fails, the way a missing table or an outage would. */
function brokenClient() {
  const fail = { data: null, error: { message: 'relation "job_runs" does not exist' } };
  const builder = {
    insert: () => builder, update: () => builder, select: () => builder, eq: () => builder,
    single: async () => fail, then: (resolve) => resolve(fail),
  };
  return { from: () => builder };
}

/** A client that throws synchronously, worse than an error result. */
const throwingClient = () => ({ from: () => { throw new Error('client exploded'); } });

const SECRET = 'eval-cron-secret';
const env = { CRON_SECRET: SECRET };
const cronRequest = (extra = {}) => new Request('https://example.invalid/api/x', { headers: { authorization: `Bearer ${SECRET}`, ...extra } });

// Observation failures go to a sink we can inspect; nothing reaches console.
let observed = [];
const sink = (job, stage, err) => { observed.push({ job, stage, message: String(err?.message ?? err) }); };

// ── withJobRun ───────────────────────────────────────────────────────────────

await check('a successful run opens one row and closes it ok with the trimmed result', async () => {
  const client = fakeClient();
  const startedAt = new Date('2026-10-18T07:00:00Z');
  let calls = 0;
  const clock = () => (calls++ === 0 ? startedAt : new Date('2026-10-18T07:00:05Z'));
  const result = await withJobRun(client, 'eval.job', async () => ({
    sent: 3, rows: [{ phone: '+447700900001' }, { phone: '+447700900002' }], note: 'x'.repeat(1000),
  }), { clock });
  assert.equal(result.sent, 3, 'the job result is returned unchanged');
  assert.equal(result.rows.length, 2);
  const [row] = client.data.job_runs;
  assert.equal(client.data.job_runs.length, 1);
  assert.equal(row.job, 'eval.job');
  assert.equal(row.started_at, '2026-10-18T07:00:00.000Z');
  assert.equal(row.finished_at, '2026-10-18T07:00:05.000Z');
  assert.equal(row.ok, true);
  assert.equal(row.error, null);
  assert.equal(row.summary.sent, 3);
  assert.equal(row.summary.rows, 2, 'an array becomes its length, so no row data is kept');
  assert.ok(!JSON.stringify(row.summary).includes('+44'), 'no phone numbers in the summary');
  assert.ok(row.summary.note.length < 400, 'long strings are cut');
});

await check('a throwing run closes the row ok false with the error, and rethrows', async () => {
  const client = fakeClient();
  await assert.rejects(withJobRun(client, 'eval.job', async () => { throw new Error('provider refused'); }), /provider refused/);
  const [row] = client.data.job_runs;
  assert.equal(row.ok, false);
  assert.match(row.error, /provider refused/);
  assert.ok(row.finished_at);
});

await check('a result with ok: false records ok false without throwing', async () => {
  const client = fakeClient();
  const result = await withJobRun(client, 'eval.job', async () => ({ ok: false, reason: 'flag off' }));
  assert.equal(result.ok, false);
  assert.equal(client.data.job_runs[0].ok, false);
  assert.equal(client.data.job_runs[0].error, null);
});

await check('a heartbeat the database refuses never breaks the job; the failure is recorded separately', async () => {
  observed = [];
  let ran = 0;
  const result = await withJobRun(brokenClient(), 'eval.job', async () => { ran += 1; return { sent: 1 }; }, { onObservationError: sink });
  assert.equal(ran, 1, 'the job ran once');
  assert.deepEqual(result, { sent: 1 });
  assert.deepEqual(observed.map((o) => o.stage), ['start', 'finish']);
  assert.match(observed[0].message, /job_runs/);
});

await check('a client that throws outright never breaks the job either, and the job\'s own error is the one that surfaces', async () => {
  observed = [];
  const result = await withJobRun(throwingClient(), 'eval.job', async () => 'done', { onObservationError: sink });
  assert.equal(result, 'done');
  await assert.rejects(withJobRun(throwingClient(), 'eval.job', async () => { throw new Error('the job failed'); }, { onObservationError: sink }), /the job failed/);
  assert.equal(observed.length, 4);
});

await check('a sink that itself throws is swallowed too', async () => {
  const result = await withJobRun(brokenClient(), 'eval.job', async () => 'done', { onObservationError: () => { throw new Error('sink broke'); } });
  assert.equal(result, 'done');
});

await check('a failed start insert still leaves one complete row', async () => {
  const client = fakeClient();
  let inserts = 0;
  const flaky = {
    from(table) {
      const q = client.from(table);
      const insert = q.insert.bind(q);
      q.insert = (row) => {
        inserts += 1;
        if (inserts === 1) {
          const fail = { data: null, error: { message: 'timeout' } };
          const b = { select: () => b, single: async () => fail };
          return b;
        }
        return insert(row);
      };
      return q;
    },
  };
  await withJobRun(flaky, 'eval.job', async () => ({ sent: 2 }), { onObservationError: sink });
  assert.equal(client.data.job_runs.length, 1);
  assert.equal(client.data.job_runs[0].ok, true);
  assert.ok(client.data.job_runs[0].started_at && client.data.job_runs[0].finished_at);
});

await check('recordJobRun writes one complete row and never throws', async () => {
  const client = fakeClient();
  await recordJobRun(client, 'eval.oneshot', {
    ok: true, summary: { skipped: 'not_local_08' },
    startedAt: new Date('2026-10-18T07:00:00Z'), finishedAt: new Date('2026-10-18T07:00:01Z'),
  });
  const [row] = client.data.job_runs;
  assert.equal(row.job, 'eval.oneshot');
  assert.equal(row.summary.skipped, 'not_local_08');
  await recordJobRun(brokenClient(), 'eval.oneshot', { ok: true, onObservationError: sink });
  await recordJobRun(throwingClient(), 'eval.oneshot', { ok: true, onObservationError: sink });
});

await check('startJobRun returns the id and finishJobRun closes that row, keeping a receipt whole beside the trimmed counts', async () => {
  const client = fakeClient();
  const id = await startJobRun(client, 'eval.split');
  assert.ok(id);
  await finishJobRun(client, 'eval.split', id, { ok: true, summary: { n: 2, list: [1, 2] }, receipt: { checks: [{ id: 'a', covered: [{ label: '2 tours' }] }] } });
  assert.equal(client.data.job_runs.length, 1);
  const { summary } = client.data.job_runs[0];
  assert.equal(summary.n, 2);
  assert.equal(summary.list, 2, 'the summary itself is still trimmed');
  assert.deepEqual(summary.receipt.checks[0].covered, [{ label: '2 tours' }], 'the receipt is not');
});

await check('trimSummary keeps counts and reasons, drops deep rows', () => {
  const out = trimSummary({ a: 1, list: [1, 2, 3], nested: { b: 'x', deeper: { c: 1 }, items: [1] }, fn: () => 1 });
  assert.deepEqual(out, { a: 1, list: 3, nested: { b: 'x', items: 1 } });
  assert.equal(trimSummary(null), null);
  assert.deepEqual(trimSummary([1, 2]), { count: 2 });
  assert.deepEqual(trimSummary('text'), { value: 'text' });
});

// ── runCronJob ───────────────────────────────────────────────────────────────

await check('only a valid Bearer with no manual header counts as a scheduled call', () => {
  assert.equal(isScheduledCronCall(cronRequest(), env), true);
  assert.equal(isScheduledCronCall(cronRequest({ 'x-watchdog-token': 't' }), env), false, 'the manual force path is not scheduled');
  assert.equal(isScheduledCronCall(cronRequest({ 'x-force': 't' }), env, { manualHeader: 'x-force' }), false, 'the header name is a parameter');
  assert.equal(isScheduledCronCall(new Request('https://e.invalid', { headers: { authorization: 'Bearer wrong' } }), env), false);
  assert.equal(isScheduledCronCall(new Request('https://e.invalid'), env), false);
  assert.equal(isScheduledCronCall(cronRequest(), {}), false, 'no secret, never scheduled');
  assert.equal(isScheduledCronCall({}, env), false, 'a bare object is not scheduled');
});

await check('a scheduled call is recorded and its Response returned untouched', async () => {
  const client = fakeClient();
  const response = Response.json({ ok: true, reminded: [1, 2], swept: [{ id: 't1' }] }, { status: 200 });
  const out = await runCronJob('venues.confirm-requests', cronRequest(), async () => response, { client, env });
  assert.equal(out, response, 'same Response object');
  assert.deepEqual(await out.json(), { ok: true, reminded: [1, 2], swept: [{ id: 't1' }] }, 'body still readable by the caller');
  const [row] = client.data.job_runs;
  assert.equal(row.job, 'venues.confirm-requests');
  assert.equal(row.ok, true);
  assert.equal(row.summary.status, 200);
  assert.equal(row.summary.reminded, 2);
  assert.equal(row.summary.skipped, undefined, 'a working run is not skipped');
});

await check('an early exit records summary.skipped with the reason; a 503 that names a skip is ok; another 503 fails', async () => {
  const client = fakeClient();
  await runCronJob('j', cronRequest(), async () => Response.json({ skipped: 'not_local_08', localHour: 7 }), { client, env });
  assert.equal(client.data.job_runs[0].ok, true);
  assert.equal(client.data.job_runs[0].summary.skipped, 'not_local_08');
  const paused = fakeClient();
  await runCronJob('j', cronRequest(), async () => Response.json({ error: 'paused', skipped: 'sends_paused' }, { status: 503 }), { client: paused, env });
  assert.equal(paused.data.job_runs[0].ok, true);
  assert.equal(paused.data.job_runs[0].summary.status, 503);
  const other = fakeClient();
  await runCronJob('j', cronRequest(), async () => Response.json({ error: 'down' }, { status: 503 }), { client: other, env });
  assert.equal(other.data.job_runs[0].ok, false);
});

await check('quiet hours and skipped: true with a reason both read as skipped; a numeric skipped is a count', async () => {
  const quiet = await responseSummary(Response.json({ processed: 0, skipped: 0, quietHours: true }));
  assert.equal(quiet.skipped, 'quiet_hours');
  assert.equal(quiet.skippedCount, 0);
  const guide = await responseSummary(Response.json({ skipped: true, reason: 'quiet_hours', moved: [] }));
  assert.equal(guide.skipped, 'quiet_hours');
  const busy = await responseSummary(Response.json({ processed: 4, sent: 3, skipped: 1 }));
  assert.equal(busy.skipped, undefined);
  assert.equal(busy.skippedCount, 1);
});

await check('an error Response, an ok: false body, and a handler that throws are recorded ok false; the throw propagates', async () => {
  const c1 = fakeClient();
  const out = await runCronJob('j', cronRequest(), async () => Response.json({ error: 'boom' }, { status: 500 }), { client: c1, env });
  assert.equal(out.status, 500);
  assert.equal(c1.data.job_runs[0].ok, false);
  const c2 = fakeClient();
  await runCronJob('j', cronRequest(), async () => Response.json({ ok: false }), { client: c2, env });
  assert.equal(c2.data.job_runs[0].ok, false);
  const c3 = fakeClient();
  await assert.rejects(runCronJob('j', cronRequest(), async () => { throw new Error('unhandled'); }, { client: c3, env }), /unhandled/);
  assert.equal(c3.data.job_runs[0].ok, false);
  assert.match(c3.data.job_runs[0].error, /unhandled/);
});

await check('an unauthenticated or manual call writes nothing; no client means no heartbeat; a factory that throws is recorded, not thrown', async () => {
  const client = fakeClient();
  let ran = 0;
  await runCronJob('j', new Request('https://e.invalid'), async () => { ran += 1; return Response.json({ error: 'Unauthorised' }, { status: 401 }); }, { client, env });
  await runCronJob('j', cronRequest({ 'x-watchdog-token': 't' }), async () => { ran += 1; return Response.json({ ok: true }); }, { client, env });
  assert.equal(ran, 2, 'the handler still runs');
  assert.equal(client.data.job_runs.length, 0, 'no rows');
  const out = await runCronJob('j', cronRequest(), async () => { ran += 1; return Response.json({ ok: true }); }, { env });
  assert.equal(out.status, 200);
  observed = [];
  const out2 = await runCronJob('j', cronRequest(), async () => Response.json({ ok: true }), { env, clientFactory: () => { throw new Error('no driver'); }, onObservationError: sink });
  assert.equal(out2.status, 200);
  assert.deepEqual(observed.map((o) => o.stage), ['client']);
  const built = fakeClient();
  await runCronJob('j', cronRequest(), async () => Response.json({ ok: true }), { env, clientFactory: () => built });
  assert.equal(built.data.job_runs.length, 1, 'a factory-built client records');
});

await check('a non-JSON body still records the status', async () => {
  const client = fakeClient();
  await runCronJob('j', cronRequest(), async () => new Response('plain text', { status: 200 }), { client, env });
  assert.equal(client.data.job_runs[0].summary.status, 200);
  assert.equal(client.data.job_runs[0].ok, true);
});

await check('finish_reports_zero_rows: closing a heartbeat whose row is gone is an observation failure, not silence', async () => {
  const client = fakeClient();
  const id = await startJobRun(client, 'eval.gone');
  client.data.job_runs.length = 0; // pruned while the job ran
  observed = [];
  await finishJobRun(client, 'eval.gone', id, { ok: true, onObservationError: sink });
  assert.deepEqual(observed.map((o) => o.stage), ['finish']);
  assert.match(observed[0].message, /no job_runs row/);
});

await check('non_response_handler_is_ok_with_a_note: a handler that returns no Response ran without throwing, so it is ok', async () => {
  const client = fakeClient();
  const out = await runCronJob('j', cronRequest(), async () => undefined, { client, env });
  assert.equal(out, undefined, 'the return value is passed back untouched');
  const [row] = client.data.job_runs;
  assert.equal(row.ok, true);
  assert.match(row.summary.note, /not a Response/);
  assert.equal(isOkRun({ sent: 3 }, {}), true, 'a plain object too');
  assert.equal(isOkRun(new Response('x', { status: 500 }), {}), false, 'a real 500 still fails');
});

await check('manual_header_is_client_neutral: the default manual header is the kit\'s own name', () => {
  assert.equal(DEFAULT_MANUAL_HEADER, 'x-watchdog-token');
  assert.equal(isScheduledCronCall(cronRequest({ 'x-watchdog-token': 't' }), env), false);
});

done();
