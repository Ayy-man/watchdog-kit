#!/usr/bin/env node
/**
 * evals/eval-coverage.mjs: the counting client and the Coverage record
 * (core/coverage.js). A page at the cap or at the asked-for limit surfaces as
 * truncated unless an exact count says otherwise; limit(1) and single() do
 * not; the recorder folds the ledger into a complete Coverage record.
 *
 *   node evals/eval-coverage.mjs
 */

import { fakePostgrest } from './lib/fake-postgrest.mjs';
import { assert, check, done, SCOPE, T } from './lib/harness.mjs';
import { buildSources, countingClient, coverageExamined, createCoverage, createLedger, normaliseCoverage, pageTruncated } from '../core/coverage.js';

const rows = [{ id: 'b1' }, { id: 'b2' }, { id: 'b3' }];

await check('pageTruncated: the cap, the asked-for limit, and an exact count', () => {
  assert.equal(pageTruncated({ rows: 1000 }), true, 'a page at the default cap');
  assert.equal(pageTruncated({ rows: 999 }), false);
  assert.equal(pageTruncated({ rows: 1000, count: 1000 }), false, 'an exact count equal to the page proves the end');
  assert.equal(pageTruncated({ rows: 1000, count: 1001 }), true, 'a count above the page proves a cut');
  assert.equal(pageTruncated({ rows: 400, limit: 400 }), true, 'the check asked for 400 and got 400');
  assert.equal(pageTruncated({ rows: 399, limit: 400 }), false);
  assert.equal(pageTruncated({ rows: 1, limit: 1 }), false, 'the latest row is a complete read');
  assert.equal(pageTruncated({ rows: 3, cap: 3 }), true);
  assert.equal(pageTruncated({ rows: 0 }), false);
  assert.equal(pageTruncated({ rows: 0, head: true, count: 5000 }), false, 'a head request reads nothing');
});

await check('counting client: distinct rows per table, truncation from the cap, limit and count', async () => {
  const ledger = createLedger();
  const db = fakePostgrest({ bookings: rows });
  const read = countingClient(db, [ledger], { pageCap: 3 });
  await read.from('bookings').select('id');
  assert.deepEqual(ledger.counts(), { bookings: 3 });
  assert.equal(ledger.isTruncated('bookings'), true, '3 rows at a cap of 3');

  const l2 = createLedger();
  await countingClient(db, [l2], { pageCap: 3 }).from('bookings').select('id', { count: 'exact' });
  assert.equal(l2.isTruncated('bookings'), false, 'count 3 of 3');

  const l3 = createLedger();
  const r3 = countingClient(db, [l3], { pageCap: 1000 });
  await r3.from('bookings').select('id').limit(2);
  assert.equal(l3.isTruncated('bookings'), true, 'limit 2 and got 2');
  await r3.from('bookings').select('id').eq('id', 'b1');
  assert.deepEqual(l3.counts(), { bookings: 2 }, 'b1 counted once across both reads (b3 was never read)');

  const l4 = createLedger();
  const r4 = countingClient(db, [l4], { pageCap: 1000 });
  await r4.from('bookings').select('id').order('id', { ascending: false }).limit(1);
  await r4.from('bookings').select('id').eq('id', 'b2').maybeSingle();
  assert.equal(l4.isTruncated('bookings'), false, 'limit(1) and maybeSingle are complete reads');
  assert.deepEqual(l4.counts(), { bookings: 2 });
  assert.deepEqual(l4.sources(), [{ name: 'bookings', rows: 2, truncated: false }]);
});

await check('counting client: a write through it is never counted (the read-only wrapper is what refuses it)', async () => {
  const ledger = createLedger();
  const db = fakePostgrest({ bookings: rows.map((r) => ({ ...r })) });
  await countingClient(db, [ledger]).from('bookings').update({ x: 1 }).eq('id', 'b1');
  assert.deepEqual(ledger.counts(), {});
});

await check('the recorder produces a complete Coverage record and folds the ledger in', () => {
  const ledger = createLedger();
  ledger.add('bookings', rows);
  ledger.add('tours', [{ id: 't1' }], { truncated: true });
  const cov = createCoverage({ scope: SCOPE, policyVersion: 'obligations@2', now: T(9) });
  cov.examined({ type: 'booking', id: 'b1' }, { type: 'booking', id: 'b2' }).examinedRows('tour', [{ id: 't1' }]);
  cov.examinedInterval(T(8), T(9)).freshAsOf(T(8, 45)).freshAsOf(T(8, 30)).source('provider', 12).covered('3 bookings', { scope: 'next 3 days' });
  const rec = cov.finish({ ledger });
  assert.deepEqual(rec.scope, SCOPE);
  assert.equal(rec.policyVersion, 'obligations@2');
  assert.equal(rec.freshAsOf.toISOString(), T(8, 45).toISOString(), 'the newest freshAsOf wins');
  assert.equal(rec.complete, false, 'the truncated tours page');
  assert.deepEqual(rec.incompleteWhy, ['tours page truncated']);
  assert.equal(rec.examined.length, 4);
  assert.deepEqual(rec.sources.map((s) => s.name), ['provider', 'bookings', 'tours']);
  assert.deepEqual(rec.words.covered, [{ label: '3 bookings', n: null, scope: 'next 3 days' }]);
  assert.equal(coverageExamined(rec, { type: 'booking', id: 'b2' }), true);
  assert.equal(coverageExamined(rec, { type: 'booking', id: 'b9' }), false);
  assert.equal(coverageExamined(rec, { type: 'x', id: 'y' }, T(8, 30)), true, 'inside the interval');
  assert.equal(coverageExamined(rec, { type: 'x', id: 'y' }, T(9)), false, 'the interval end is exclusive');

  const clean = createCoverage({ scope: SCOPE, now: T(9) }).finish({ ledger: createLedger() });
  assert.equal(clean.complete, true);
  assert.equal(clean.freshAsOf.toISOString(), T(9).toISOString(), 'defaults to the run');
  assert.equal(clean.policyVersion, 'unversioned');
});

await check('normaliseCoverage: a returned record wins field by field, a truncated source forces incomplete, no freshAsOf is unusable', () => {
  const base = createCoverage({ scope: SCOPE, now: T(9) }).finish({ ledger: createLedger() });
  const given = normaliseCoverage({ examined: [{ type: 'lead', id: 'l1' }, { from: T(8), to: T(9) }, { bad: true }], complete: true, policyVersion: 'p1' }, base);
  assert.equal(given.examined.length, 2);
  assert.equal(given.policyVersion, 'p1');
  assert.equal(given.freshAsOf.toISOString(), T(9).toISOString(), 'filled from the recorder');
  const cut = normaliseCoverage({ complete: true, sources: [{ name: 'api', rows: 100, truncated: true }] }, base);
  assert.equal(cut.complete, false);
  assert.equal(normaliseCoverage({ complete: true }, null), null, 'no freshAsOf anywhere');
  assert.equal(normaliseCoverage('nonsense', base), null);
  assert.equal(normaliseCoverage(undefined, base), base);
});

await check('buildSources merges ledger tables and declared sources, naming the checks that read each', () => {
  const sweep = createLedger();
  sweep.add('bookings', rows);
  const results = [
    { id: 'a', ok: true, reads: { bookings: 3 }, coverage: { sources: [{ name: 'bookings', rows: 3, truncated: false }, { name: 'provider', rows: 12, truncated: true }] } },
    { id: 'b', ok: false, reads: { bookings: 1 }, coverage: null },
  ];
  const sources = buildSources(results, sweep);
  assert.deepEqual(sources.map((s) => s.name), ['bookings', 'provider']);
  const bookings = sources.find((s) => s.name === 'bookings');
  assert.deepEqual(bookings, { name: 'bookings', rows: 3, truncated: false, by: ['a', 'b'], failedBy: ['b'], ok: false });
  const provider = sources.find((s) => s.name === 'provider');
  assert.equal(provider.rows, 12);
  assert.equal(provider.truncated, true);
});

// ── 0.2.0: invariants the review found unproven ──────────────────────────────

await check('failed_read_resolves_nothing: a read that errors or rejects is a failed source and the record is incomplete', async () => {
  const errored = { data: null, error: { message: 'canceling statement due to statement timeout' } };
  const erroring = { from: () => { const b = { select: () => b, eq: () => b, then: (ok) => Promise.resolve(errored).then(ok) }; return b; } };
  const ledger = createLedger();
  const { data } = await countingClient(erroring, [ledger]).from('events').select('id').eq('k', 'v');
  assert.equal(data, null, 'the check sees the null it would have treated as empty');
  const rec = createCoverage({ scope: SCOPE, now: T(9) }).finish({ ledger });
  assert.equal(rec.complete, false);
  assert.match(rec.incompleteWhy.join(','), /events read failed/);
  assert.match(rec.sources.find((x) => x.name === 'events').failed, /statement timeout/);

  const rejecting = { from: () => { const b = { select: () => b, then: (_ok, bad) => Promise.reject(new Error('fetch failed')).catch(bad) }; return b; } };
  const l2 = createLedger();
  await assert.rejects(async () => { await countingClient(rejecting, [l2]).from('events').select('id'); }, /fetch failed/);
  assert.equal(l2.isFailed('events'), true, 'a rejected read is failed too, even if the check swallows it');
});

await check('returned_coverage_cannot_override_incompleteness: complete: true does not lift incomplete(), partial(), skipped(), truncation or a failed read', () => {
  const base = (fn) => { const c = createCoverage({ scope: SCOPE, now: T(9) }); fn(c); return c; };
  const claim = { complete: true, sources: [{ name: 'api', rows: 1, truncated: false }], examined: [{ type: 'booking', id: 'b1' }] };
  for (const [label, fn] of [['incomplete', (c) => c.incomplete('provider cut')], ['partial', (c) => c.partial('1 of 4 failed')], ['skipped', (c) => c.skipped('off')]]) {
    const out = normaliseCoverage(claim, base(fn).finish({ ledger: createLedger() }));
    assert.equal(out.complete, false, label);
  }
  const cut = createLedger();
  cut.add('bookings', [{ id: 'b1' }], { truncated: true });
  const truncated = normaliseCoverage(claim, createCoverage({ scope: SCOPE, now: T(9) }).finish({ ledger: cut }));
  assert.equal(truncated.complete, false, 'a ledger truncation');
  assert.ok(truncated.sources.some((x) => x.name === 'bookings' && x.truncated), 'the ledger source is kept beside the returned ones');
  assert.ok(truncated.sources.some((x) => x.name === 'api'));
  assert.match(truncated.incompleteWhy.join(','), /bookings page truncated/);
  const failed = createLedger();
  failed.fail('events', 'timeout');
  assert.equal(normaliseCoverage(claim, createCoverage({ scope: SCOPE, now: T(9) }).finish({ ledger: failed })).complete, false, 'a failed read');
  const later = normaliseCoverage({ ...claim, freshAsOf: T(12) }, createCoverage({ scope: SCOPE, now: T(9) }).freshAsOf(T(8)).finish({ ledger: createLedger() }));
  assert.equal(later.freshAsOf.toISOString(), T(8).toISOString(), 'a returned freshAsOf cannot be later than the recorder\'s');
});

await check('estimated_count_does_not_lift_truncation: only count: exact proves the end of a table', async () => {
  const db = fakePostgrest({ bookings: rows });
  for (const count of ['planned', 'estimated']) {
    const l = createLedger();
    await countingClient(db, [l], { pageCap: 3 }).from('bookings').select('id', { count });
    assert.equal(l.isTruncated('bookings'), true, `count: ${count} at the cap`);
  }
  const exact = createLedger();
  await countingClient(db, [exact], { pageCap: 3 }).from('bookings').select('id', { count: 'exact' });
  assert.equal(exact.isTruncated('bookings'), false);
});

await check('range_sequence_completes: a short continuation page clears truncation; a page equal to its range stays truncated', async () => {
  const five = [1, 2, 3, 4, 5].map((n) => ({ id: `b${n}` }));
  const db = fakePostgrest({ bookings: five });
  const l = createLedger();
  const read = countingClient(db, [l]);
  await read.from('bookings').select('id').order('id').range(0, 2);
  assert.equal(l.isTruncated('bookings'), true, 'a full first page');
  await read.from('bookings').select('id').order('id').range(3, 5);
  assert.equal(l.isTruncated('bookings'), false, 'the second page was short: the table ended');
  assert.deepEqual(l.counts(), { bookings: 5 });

  const exactFit = createLedger();
  await countingClient(db, [exactFit]).from('bookings').select('id').order('id').range(0, 4);
  assert.equal(exactFit.isTruncated('bookings'), true, '5 rows for a range of 5 may not be the end');
  await countingClient(db, [exactFit]).from('bookings').select('id').order('id').range(5, 9);
  assert.equal(exactFit.isTruncated('bookings'), false, 'an empty continuation page proves the end');

  const unrelated = createLedger();
  const r2 = countingClient(db, [unrelated]);
  await r2.from('bookings').select('id').order('id').range(0, 2);
  await r2.from('bookings').select('id').eq('id', 'b1').range(0, 9);
  assert.equal(unrelated.isTruncated('bookings'), true, 'a short page that does not continue the sequence clears nothing');
});

await check('fresh_as_of_takes_the_stalest_named_source: a stale cache is not hidden by a fresh table, and each source is on the receipt', () => {
  const rec = createCoverage({ scope: SCOPE, now: T(9) })
    .freshAsOf(T(8, 59), { source: 'bookings' })
    .freshAsOf(T(5), { source: 'provider_cache' })
    .freshAsOf(T(5, 30), { source: 'provider_cache' })
    .finish({ ledger: createLedger() });
  assert.equal(rec.freshAsOf.toISOString(), T(5, 30).toISOString(), 'the oldest of the per-source newest observations');
  assert.deepEqual(rec.freshness, { bookings: T(8, 59).toISOString(), provider_cache: T(5, 30).toISOString() });
  const mixed = createCoverage({ scope: SCOPE, now: T(9) }).freshAsOf(T(8)).freshAsOf(T(7), { source: 'api' }).finish({ ledger: createLedger() });
  assert.equal(mixed.freshAsOf.toISOString(), T(7).toISOString(), 'an unnamed observation and a named one: the older');
});

done();
