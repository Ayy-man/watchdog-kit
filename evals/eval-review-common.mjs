#!/usr/bin/env node
/**
 * evals/eval-review-common.mjs: the run side of a model review
 * (core/review-common.js): the key is the watchdog's own and never the
 * shared one, failed calls are classified, backoff doubles to a cap, the
 * model_unavailable finding is in the contract shape, and a model finding's
 * id carries the scope and the entities its evidence points at.
 *
 *   node evals/eval-review-common.mjs
 */

import { assert, check, done, SCOPE } from './lib/harness.mjs';
import { buildFindingId } from '../core/scope.js';
import { classifyModelError, findingKey, inBackoff, kindProperty, modelUnavailableFinding, nextRetry, noKeyError, RETRY_BASE_MS, RETRY_MAX_MS, watchdogApiKey } from '../core/review-common.js';

await check('watchdogApiKey uses its own key and never the shared one', () => {
  assert.deepEqual(watchdogApiKey({ WATCHDOG_OPENROUTER_API_KEY: ' k1 ', OPENROUTER_API_KEY: 'shared' }), { key: 'k1', name: 'WATCHDOG_OPENROUTER_API_KEY' });
  assert.deepEqual(watchdogApiKey({ OPENROUTER_API_KEY: 'shared' }), { key: null, name: null }, 'a shared key alone is no key');
  assert.deepEqual(watchdogApiKey({ MY_KEY: 'x' }, { keyName: 'MY_KEY' }), { key: 'x', name: 'MY_KEY' });
  assert.equal(classifyModelError(noKeyError()).kind, 'no_key');
});

await check('classifyModelError: global failures stop the sweep\'s calls, per-call ones back the subject off', () => {
  const g = (err) => classifyModelError(err).global;
  assert.equal(g(new Error('request failed: 401 unauthorised')), true);
  assert.equal(classifyModelError(new Error('request failed: 402')).kind, 'credit');
  assert.equal(classifyModelError(new Error('request failed: 429')).kind, 'rate_limit');
  assert.equal(classifyModelError(new Error('request failed: 503')).kind, 'provider');
  assert.equal(classifyModelError(new Error('fetch failed')).kind, 'network');
  const t = new Error('x'); t.name = 'TimeoutError';
  assert.deepEqual(classifyModelError(t), { kind: 'timeout', global: false, label: 'timed out' });
  assert.deepEqual(classifyModelError(new SyntaxError('Unexpected token')), { kind: 'bad_answer', global: false, label: 'unreadable answer' });
});

await check('backoff doubles from 30 minutes to a 12 hour cap and holds until next_at', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  const r1 = nextRetry(null, { now, error: 'boom' });
  assert.equal(r1.failures, 1);
  assert.equal(Date.parse(r1.next_at) - now.getTime(), RETRY_BASE_MS);
  let r = r1;
  for (let i = 0; i < 8; i += 1) r = nextRetry(r, { now, error: 'boom' });
  assert.equal(Date.parse(r.next_at) - now.getTime(), RETRY_MAX_MS);
  assert.equal(inBackoff(r1, new Date('2026-10-18T09:10:00Z')), true);
  assert.equal(inBackoff(r1, new Date('2026-10-18T09:31:00Z')), false);
  assert.equal(inBackoff(null, now), false);
});

await check('modelUnavailableFinding is in the contract shape, high when nothing went through', () => {
  const f = modelUnavailableFinding({ what: 'Tour review', checkId: 'tour_review', notReviewed: [{ id: 't1', label: 'Sat 24 Oct', reason: 'no API key' }], globalError: { kind: 'no_key', label: 'no API key' } });
  assert.equal(f.kind, 'model_unavailable');
  assert.deepEqual(f.subject, { type: 'system', id: 'tour_review' });
  assert.equal(f.severity, 'high');
  assert.match(f.title, /1 not reviewed \(no API key\)/);
  assert.match(f.detail, /No model API key is set/);
  assert.equal(f.evidence[0].value, 'no_key');
  assert.equal(f.evidence[2].id, 't1');
  const some = modelUnavailableFinding({ what: 'Tour review', checkId: 'tour_review', notReviewed: [{ id: 't1', label: 'x', reason: 'timed out' }], reviewed: 3, keyName: 'WATCHDOG_OPENROUTER_API_KEY' });
  assert.equal(some.severity, 'medium');
  assert.match(some.detail, /The calls used WATCHDOG_OPENROUTER_API_KEY/);
});

await check('findingKey builds a scoped id from the entities the evidence points at, stable across rewording', () => {
  const packet = { stops: [{ id: 's1' }, { id: 's2' }], bookings: [{ id: 'b1' }] };
  const opts = { scope: SCOPE, checkId: 'tour_review', packet, listTypes: { stops: 'stop', bookings: 'booking' }, typeRank: ['stop', 'booking'] };
  const a = findingKey({ ...opts, kind: 'venue_not_asked', refs: ['stops[1].status', 'bookings[0].pax'] });
  assert.equal(a.id, buildFindingId(SCOPE, 'tour_review', 'venue_not_asked', { subject: { type: 'stop', id: 's2' }, entities: [{ type: 'stop', id: 's2' }] }));
  assert.ok(a.id.startsWith('kit-eval/-/development:tour_review:venue_not_asked:stop-s2:'), 'the readable slug is kept');
  assert.deepEqual(a.subject, { type: 'stop', id: 's2' });
  const b = findingKey({ ...opts, kind: 'venue_not_asked', refs: ['stops[1].requested_at'] });
  assert.equal(b.id, a.id, 'another field of the same stop');
  const two = findingKey({ ...opts, kind: 'capacity', refs: ['stops[1].x', 'stops[0].y'] });
  assert.equal(two.id, buildFindingId(SCOPE, 'tour_review', 'capacity', { subject: { type: 'stop', id: 's1' }, entities: [{ type: 'stop', id: 's1' }, { type: 'stop', id: 's2' }] }));
  assert.ok(two.id.startsWith('kit-eval/-/development:tour_review:capacity:stop-s1+stop-s2:'));
  const none = findingKey({ ...opts, kind: 'other', refs: ['tour.date'], root: { type: 'tour', id: 'tour-1' } });
  assert.equal(none.id, buildFindingId(SCOPE, 'tour_review', 'other', { subject: { type: 'tour', id: 'tour-1' }, entities: [{ type: 'tour', id: 'tour-1' }] }));
  const many = findingKey({ ...opts, kind: 'capacity', refs: Array.from({ length: 30 }, (_, i) => `stops[${i % 2}].f${i}`), packet: { stops: Array.from({ length: 2 }, (_, i) => ({ id: `a-very-long-stop-identifier-${i}-0123456789abcdef` })) } });
  assert.ok(many.id.length < 220 && /more-/.test(many.id), many.id);
  assert.deepEqual(kindProperty(['a', 'b']).enum, ['a', 'b']);
});

await check('long_entity_lists_keep_their_id_in_any_order: lookalike entities stay two, and citation order never changes the id', () => {
  const ids = Array.from({ length: 6 }, (_, i) => `a-very-long-stop-identifier-${i}-0123456789abcdef`);
  const packet = { stops: [...ids.map((id) => ({ id })), { id: 'x y' }, { id: 'x_y' }] };
  const opts = { scope: SCOPE, checkId: 'tour_review', packet, listTypes: { stops: 'stop' }, typeRank: ['stop'], kind: 'capacity' };
  const forward = findingKey({ ...opts, refs: ids.map((_, i) => `stops[${i}].pax`) });
  const backward = findingKey({ ...opts, refs: ids.map((_, i) => `stops[${ids.length - 1 - i}].pax`) });
  assert.match(forward.id, /more-/, 'long enough to be cut');
  assert.equal(backward.id, forward.id);
  const pair = findingKey({ ...opts, refs: ['stops[6].pax', 'stops[7].pax'] });
  assert.equal(pair.entities.length, 2, '"x y" and "x_y" share a slug but are two stops');
  const one = findingKey({ ...opts, refs: ['stops[6].pax'] });
  const other = findingKey({ ...opts, refs: ['stops[7].pax'] });
  assert.notEqual(one.id, other.id, 'and two findings');
});

done();
