/**
 * core/self-check.js: the watchdog watching itself.
 *
 * Two different questions, because a sweep cannot report that it is not
 * running:
 *
 *   - `sweepSelfCheck` runs inside a sweep and looks back over the recent
 *     slots of the sweep job in `job_runs`. A slot with no run is a
 *     `sweep_missed` finding on that slot, so a cron that skipped is on the
 *     page with a verdict like anything else. It resolves by `left_scope`
 *     when the slot ages out of the lookback. It resolves as `recovered` only
 *     if a run for that slot turns up later (a row written late), which
 *     means the slot was not missed after all.
 *   - `staleAlarm` is pure and runs where the sweep does not: in the page
 *     model and in the hub's view of the projection. It answers "has a sweep
 *     finished successfully recently enough" from the same rows, so a dead
 *     watchdog is visible to a human and to the hub without any sweep's
 *     help. A sweep that finishes ok: false every time is dead too, so by
 *     default only ok runs count (0.2.0).
 *
 * Reviewed for 0.2.0 against the shared invariants:
 *   - a truncated page (the newest PAGE runs) used to make every older slot
 *     look missed, raising false findings; slots older than the oldest run
 *     read are now neither examined nor reported, and the run is incomplete;
 *   - each finding's evidence cites its own slot (it cited the job name, so
 *     every missed slot carried the same ref);
 *   - a cadence or lookback that is not a positive number is refused (a zero
 *     cadence looped for ever);
 *   - `job_runs` has no scope column, so in an installation that sweeps
 *     several scopes under one job name, another scope's run covers this
 *     scope's slot. Give each scope its own sweep job name before relying
 *     on this check there; the core does not yet do that for you.
 *
 * Plain relative imports only, so an offline eval can load this directly.
 */

import { JOB_RUNS_TABLE } from './job-run.js';

export const SWEEP_JOB = 'watchdog.sweep';
export const SWEEP_MISSED_KIND = 'sweep_missed';
export const STALE_ALARM_KIND = 'stale_alarm';
export const SLOT_SUBJECT_TYPE = 'job_slot';

const MINUTE = 60_000;
/** Rows read in one page; a window needing more is reported incomplete. */
const PAGE = 1000;

/** The slot starts (aligned to the cadence from the epoch) that fall in [from, to). */
export function slotsBetween(from, to, cadenceMs) {
  const out = [];
  let t = Math.ceil(from.getTime() / cadenceMs) * cadenceMs;
  for (; t < to.getTime(); t += cadenceMs) out.push(new Date(t));
  return out;
}

/** Which slots have a run that started within the grace either side. */
export function missedSlots(slots, runs, { graceMs }) {
  const starts = runs.map((r) => new Date(r.started_at).getTime()).filter((n) => Number.isFinite(n));
  return slots.filter((slot) => {
    const s = slot.getTime();
    return !starts.some((at) => at >= s - graceMs && at <= s + graceMs);
  });
}

/**
 * Pure: is the watchdog stale? True when no run of the sweep job has
 * finished ok within `multiplier` cadences of `now`, or none ever has. With
 * `requireOk: false` any finished run counts, as in 0.1. `lastFinishedAt` is
 * the last finish of any kind, `lastOkAt` the last ok one, so the page can
 * say "running but failing" apart from "not running".
 */
export function staleAlarm(runs, now, { cadenceMs, multiplier = 2, requireOk = true } = {}) {
  const finishedAt = (r) => (r?.finished_at ? new Date(r.finished_at).getTime() : NaN);
  const latest = (list) => {
    const ms = list.map(finishedAt).filter((n) => Number.isFinite(n));
    return ms.length ? new Date(Math.max(...ms)) : null;
  };
  const list = Array.isArray(runs) ? runs : [];
  const lastFinishedAt = latest(list);
  const lastOkAt = latest(list.filter((r) => r?.ok === true));
  const counted = requireOk ? lastOkAt : lastFinishedAt;
  const thresholdMs = cadenceMs * multiplier;
  const ageMs = counted ? now.getTime() - counted.getTime() : null;
  return {
    kind: STALE_ALARM_KIND,
    stale: counted === null || ageMs > thresholdMs,
    lastFinishedAt,
    lastOkAt,
    ageMs,
    thresholdMs,
  };
}

/**
 * The check. `cadenceMs` is the sweep schedule; `graceMs` how late a run may
 * start and still count for its slot; `lookbackMs` how far back slots are
 * examined (the window a `sweep_missed` finding stays in scope).
 */
export function sweepSelfCheck({
  job = SWEEP_JOB,
  cadenceMs = 30 * MINUTE,
  graceMs = 10 * MINUTE,
  lookbackMs = 24 * 60 * MINUTE,
  severity = 'medium',
} = {}) {
  for (const [name, v] of [['cadenceMs', cadenceMs], ['graceMs', graceMs], ['lookbackMs', lookbackMs]]) {
    if (!Number.isFinite(v) || v < 0 || (name !== 'graceMs' && v === 0)) throw new Error(`self-check: ${name} must be a positive number of milliseconds`);
  }
  if (!(graceMs < cadenceMs / 2)) throw new Error('self-check: graceMs must be under half the cadence or neighbouring slots share runs');
  return {
    id: 'watchdog_self',
    severity,
    incidents: [],
    model: false,
    async run({ read, now, coverage }) {
      const from = new Date(now.getTime() - lookbackMs);
      // The current slot may still be starting; examine slots whose grace has passed.
      const to = new Date(now.getTime() - graceMs);
      const { data, error } = await read
        .from(JOB_RUNS_TABLE)
        .select('started_at, finished_at, ok')
        .eq('job', job)
        .gte('started_at', new Date(from.getTime() - graceMs).toISOString())
        .order('started_at', { ascending: false })
        .limit(PAGE);
      if (error) throw new Error(`self-check: could not read ${JOB_RUNS_TABLE}: ${error.message ?? error}`);
      const runs = data ?? [];
      let slots = slotsBetween(from, to, cadenceMs);
      if (runs.length >= PAGE) {
        // The newest PAGE runs only: a slot before the oldest of them may
        // have had a run we did not read, so it is neither examined nor
        // reported as missed.
        coverage.incomplete(`${JOB_RUNS_TABLE} page for ${job} truncated at ${PAGE}`);
        const oldest = Math.min(...runs.map((r) => Date.parse(r.started_at)).filter(Number.isFinite));
        slots = slots.filter((slot) => slot.getTime() - graceMs >= oldest);
      }
      coverage.examined(...slots.map((s) => ({ type: SLOT_SUBJECT_TYPE, id: `${job}@${s.toISOString()}` })));
      coverage.freshAsOf(now);
      coverage.resolveReason((row) => {
        const id = String(row.subject_id ?? '');
        const at = id.slice(id.lastIndexOf('@') + 1);
        const ms = Date.parse(at);
        return id.includes('@') && Number.isFinite(ms) && ms < from.getTime() ? 'left_scope' : null;
      });
      return missedSlots(slots, runs, { graceMs }).map((slot) => ({
        kind: SWEEP_MISSED_KIND,
        subject: { type: SLOT_SUBJECT_TYPE, id: `${job}@${slot.toISOString()}` },
        title: `No ${job} run for the ${slot.toISOString()} slot`,
        detail: `Expected a run within ${Math.round(graceMs / MINUTE)} minutes of ${slot.toISOString()}; none started. ${runs.length} run(s) seen in the last ${Math.round(lookbackMs / MINUTE / 60)} hours.`,
        link: null,
        wouldDo: 'Tell the owner the watchdog skipped a slot',
        wouldSay: null,
        evidence: [{ source: JOB_RUNS_TABLE, id: `${job}@${slot.toISOString()}`, field: 'started_at', value: null }],
        evidenceAt: slot,
      }));
    },
  };
}
