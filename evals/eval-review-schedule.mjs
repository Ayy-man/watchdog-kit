#!/usr/bin/env node
/**
 * evals/eval-review-schedule.mjs: the model review slots
 * (core/review-schedule.js) in a given time zone, with the London clock-change
 * cases kept for Europe/London and the same shape checked in UTC,
 * America/New_York, a 30-minute-offset zone (Asia/Kolkata, and Australia/
 * Adelaide across its clock changes) and a slot that falls inside a
 * spring-forward gap.
 *
 *   node evals/eval-review-schedule.mjs
 */

import { assert, check, done } from './lib/harness.mjs';
import { DEFAULT_SLOTS, latestSlotStart, nextSlotStart, parseSlots, reviewedThisSlot } from '../core/review-schedule.js';
import { isValidTimeZone, wallToDate, zoneParts } from '../core/wall-time.js';

const iso = (d) => d?.toISOString() ?? null;
const LDN = 'Europe/London';

await check('slots: valid HH:MM only, sorted, unique; defaults for junk or empty', () => {
  assert.deepEqual(parseSlots(['19:30', '07:30', '07:30']), ['07:30', '19:30']);
  assert.deepEqual(parseSlots('12:00, 06:15'), ['06:15', '12:00']);
  assert.deepEqual(parseSlots(['25:00', 'noon', null]), DEFAULT_SLOTS);
  assert.deepEqual(parseSlots(null), DEFAULT_SLOTS);
  assert.deepEqual(parseSlots([], ['09:00']), ['09:00'], 'a client passes its own defaults');
});

await check('BST: 10:00 London belongs to the 07:30 slot (06:30 UTC); next is 19:30 (18:30 UTC)', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  assert.equal(iso(latestSlotStart(now, DEFAULT_SLOTS, LDN)), '2026-10-18T06:30:00.000Z');
  assert.equal(iso(nextSlotStart(now, DEFAULT_SLOTS, LDN)), '2026-10-18T18:30:00.000Z');
});

await check('before the first slot of the day, the latest slot is yesterday evening', () => {
  const now = new Date('2026-10-18T05:00:00Z'); // 06:00 London
  assert.equal(iso(latestSlotStart(now, DEFAULT_SLOTS, LDN)), '2026-10-17T18:30:00.000Z');
});

await check('clocks go back on Sun 25 Oct 2026: 07:30 London is 07:30 UTC from that day', () => {
  assert.equal(iso(latestSlotStart(new Date('2026-10-24T09:00:00Z'), DEFAULT_SLOTS, LDN)), '2026-10-24T06:30:00.000Z');
  assert.equal(iso(latestSlotStart(new Date('2026-10-25T09:00:00Z'), DEFAULT_SLOTS, LDN)), '2026-10-25T07:30:00.000Z');
  assert.equal(iso(nextSlotStart(new Date('2026-10-25T07:00:00Z'), DEFAULT_SLOTS, LDN)), '2026-10-25T07:30:00.000Z', 'not an hour early');
});

await check('clocks go forward on Sun 29 Mar 2026: 07:30 London is 06:30 UTC from that day', () => {
  assert.equal(iso(latestSlotStart(new Date('2026-03-28T09:00:00Z'), DEFAULT_SLOTS, LDN)), '2026-03-28T07:30:00.000Z');
  assert.equal(iso(latestSlotStart(new Date('2026-03-29T09:00:00Z'), DEFAULT_SLOTS, LDN)), '2026-03-29T06:30:00.000Z');
});

await check('a review covers the slot it was made in, and no later one', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  assert.equal(reviewedThisSlot('2026-10-18T06:45:00Z', now, DEFAULT_SLOTS, LDN), true);
  assert.equal(reviewedThisSlot('2026-10-18T06:00:00Z', now, DEFAULT_SLOTS, LDN), false, 'before the 07:30 slot');
  assert.equal(reviewedThisSlot(null, now, DEFAULT_SLOTS, LDN), false);
  assert.equal(reviewedThisSlot('2026-10-18T06:45:00Z', new Date('2026-10-18T18:30:00Z'), DEFAULT_SLOTS, LDN), false, 'the evening slot needs its own');
});

await check('the zone is a parameter: UTC by default, and America/New_York across its November clock change', () => {
  const now = new Date('2026-10-18T09:00:00Z');
  assert.equal(iso(latestSlotStart(now)), '2026-10-18T07:30:00.000Z', 'UTC by default');
  const NY = 'America/New_York';
  // 1 Nov 2026 clocks go back in New York: 07:30 is 11:30 UTC before, 12:30 UTC after.
  assert.equal(iso(latestSlotStart(new Date('2026-10-31T15:00:00Z'), DEFAULT_SLOTS, NY)), '2026-10-31T11:30:00.000Z');
  assert.equal(iso(latestSlotStart(new Date('2026-11-01T15:00:00Z'), DEFAULT_SLOTS, NY)), '2026-11-01T12:30:00.000Z');
  assert.equal(iso(nextSlotStart(new Date('2026-11-01T12:00:00Z'), DEFAULT_SLOTS, NY)), '2026-11-01T12:30:00.000Z');
});

await check('wall-time helpers: parts, wall to instant either side of a change, and zone validation', () => {
  assert.deepEqual(zoneParts('2026-10-18T09:00:00Z', LDN), { date: '2026-10-18', hour: 10, minute: 0, second: 0 });
  assert.equal(iso(wallToDate('2026-10-25', '00:30', LDN)), '2026-10-24T23:30:00.000Z', 'still BST before 02:00');
  assert.equal(iso(wallToDate('2026-10-25', '03:00', LDN)), '2026-10-25T03:00:00.000Z', 'GMT after');
  assert.equal(wallToDate('nonsense', '03:00', LDN), null);
  assert.equal(isValidTimeZone('Europe/London'), true);
  assert.equal(isValidTimeZone('Mars/Olympus'), false);
});

/** Every slot start a scan from `from` to `to` in 10 minute steps sees, checking it never moves backwards. */
function scanSlots(from, to, slots, zone) {
  const seen = [];
  let prev = null;
  for (let t = from.getTime(); t <= to.getTime(); t += 10 * 60_000) {
    const at = latestSlotStart(new Date(t), slots, zone);
    assert.ok(at && at.getTime() <= t, `latest slot at ${new Date(t).toISOString()} is not in the future`);
    if (prev) assert.ok(at.getTime() >= prev.getTime(), `no backward move at ${new Date(t).toISOString()}`);
    if (!prev || at.getTime() !== prev.getTime()) seen.push(at.toISOString());
    prev = at;
  }
  return seen;
}

await check('half_hour_offset_zones: 07:30 in Kolkata (UTC+5:30) is 02:00 UTC, and Adelaide moves by an hour across its April change', () => {
  const KOL = 'Asia/Kolkata';
  assert.equal(iso(latestSlotStart(new Date('2026-10-18T03:00:00Z'), DEFAULT_SLOTS, KOL)), '2026-10-18T02:00:00.000Z');
  assert.equal(iso(nextSlotStart(new Date('2026-10-18T03:00:00Z'), DEFAULT_SLOTS, KOL)), '2026-10-18T14:00:00.000Z');
  assert.equal(iso(latestSlotStart(new Date('2026-10-18T01:59:00Z'), DEFAULT_SLOTS, KOL)), '2026-10-17T14:00:00.000Z', 'a minute early is still yesterday evening');
  const ADL = 'Australia/Adelaide';
  // Adelaide leaves daylight time on Sun 5 Apr 2026: UTC+10:30 before, UTC+9:30 after.
  assert.equal(iso(latestSlotStart(new Date('2026-04-04T00:00:00Z'), DEFAULT_SLOTS, ADL)), '2026-04-03T21:00:00.000Z');
  assert.equal(iso(latestSlotStart(new Date('2026-04-06T00:00:00Z'), DEFAULT_SLOTS, ADL)), '2026-04-05T22:00:00.000Z');
  const seen = scanSlots(new Date('2026-04-03T00:00:00Z'), new Date('2026-04-07T00:00:00Z'), DEFAULT_SLOTS, ADL);
  assert.deepEqual(seen, [
    '2026-04-02T21:00:00.000Z', // the slot already in force when the scan starts
    '2026-04-03T09:00:00.000Z', '2026-04-03T21:00:00.000Z',
    '2026-04-04T09:00:00.000Z', '2026-04-04T22:00:00.000Z', // 07:30 on the 5th, now UTC+9:30
    '2026-04-05T10:00:00.000Z', '2026-04-05T22:00:00.000Z',
    '2026-04-06T10:00:00.000Z', '2026-04-06T22:00:00.000Z',
  ], 'two slots a day, none doubled or skipped, an hour later in UTC after the change');
});

await check('slot_in_a_spring_forward_gap_fires_once: 01:30 London on 29 Mar 2026 does not exist and still fires exactly once that day', () => {
  const seen = scanSlots(new Date('2026-03-28T12:00:00Z'), new Date('2026-03-30T12:00:00Z'), ['01:30'], LDN);
  const day = seen.filter((x) => x.startsWith('2026-03-29'));
  assert.equal(day.length, 1, `one 29 Mar slot, got ${day.join(', ')}`);
  assert.ok(['2026-03-29T00:30:00.000Z', '2026-03-29T01:30:00.000Z'].includes(day[0]), `shifted to one side of the gap: ${day[0]}`);
  assert.deepEqual(seen.filter((x) => !x.startsWith('2026-03-29')), ['2026-03-28T01:30:00.000Z', '2026-03-30T00:30:00.000Z'], 'the days either side are ordinary');
  assert.equal(reviewedThisSlot(day[0], new Date('2026-03-29T09:00:00Z'), ['01:30'], LDN), true, 'a review at the shifted start covers the day');
});

done();
