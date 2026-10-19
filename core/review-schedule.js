/**
 * core/review-schedule.js: when the model reviews may spend.
 *
 * The rule checks run every sweep and cost nothing. The model reviews are
 * the expensive part, so they run in review slots: a few wall-clock times a
 * day in the client's time zone, read from a setting (default 07:30 and
 * 19:30, chosen for the reference build from 45 days of its operator's activity; a client
 * picks its own). A subject is looked at once per slot: from a slot's start
 * until it has been reviewed, any sweep may review it, so a slot that runs
 * out of time carries on in the next sweep. Between slots a subject is
 * reviewed early only when a rule check has just flagged it.
 *
 * Pure; the slots and the IANA time zone are passed in. The zone defaults to
 * UTC so no client inherits another's clock by accident.
 */

import { dateAdd, wallToDate, zoneParts } from './wall-time.js';

export const SLOTS_KEY = 'watchdog_review_slots';
export const DEFAULT_SLOTS = ['07:30', '19:30'];
export const DEFAULT_TIME_ZONE = 'UTC';

/** Valid 'HH:MM' slots, sorted and unique; the defaults for anything unreadable or empty. */
export function parseSlots(value, defaults = DEFAULT_SLOTS) {
  const list = Array.isArray(value) ? value : (typeof value === 'string' ? value.split(',') : []);
  const ok = [...new Set(list
    .map((s) => String(s ?? '').trim())
    .filter((s) => /^([01]\d|2[0-3]):[0-5]\d$/.test(s)))].sort();
  return ok.length ? ok : [...defaults];
}

/** The start of the most recent slot at or before `now`, as a Date. */
export function latestSlotStart(now, slots = DEFAULT_SLOTS, timeZone = DEFAULT_TIME_ZONE) {
  const today = zoneParts(now, timeZone).date;
  let best = null;
  for (const day of [today, dateAdd(today, -1)]) {
    for (const slot of slots) {
      const at = wallToDate(day, slot, timeZone);
      if (at && at.getTime() <= now.getTime() && (!best || at > best)) best = at;
    }
  }
  return best;
}

/** The start of the next slot after `now`, as a Date. */
export function nextSlotStart(now, slots = DEFAULT_SLOTS, timeZone = DEFAULT_TIME_ZONE) {
  const today = zoneParts(now, timeZone).date;
  let best = null;
  for (const day of [today, dateAdd(today, 1)]) {
    for (const slot of slots) {
      const at = wallToDate(day, slot, timeZone);
      if (at && at.getTime() > now.getTime() && (!best || at < best)) best = at;
    }
  }
  return best;
}

/** True when a review at `reviewedAt` already covers the current slot. */
export function reviewedThisSlot(reviewedAt, now, slots = DEFAULT_SLOTS, timeZone = DEFAULT_TIME_ZONE) {
  const at = Date.parse(reviewedAt ?? '');
  const start = latestSlotStart(now, slots, timeZone);
  return Number.isFinite(at) && Boolean(start) && at >= start.getTime();
}
