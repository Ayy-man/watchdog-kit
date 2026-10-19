/**
 * core/sweep-generation.js: the SweepGeneration every reconcile write is
 * fenced on (contracts/finding.d.ts, core/sql/0004_watchdog_sweeps.sql).
 *
 * Why: two sweeps can overlap (a cron tick beside a hand-started run, or a
 * function that outlived its slot). Without a fence the slower one writes
 * stale resolutions over the fresher one's findings. One `watchdog_sweeps`
 * row per scope holds a monotonic `generation` and a `lease_until`. A sweep
 * claims the next generation before phase 1; every write it makes carries
 * that generation and is preceded by a check that the row still holds it. A
 * write on a generation that is no longer current throws
 * `StaleGenerationError` and nothing is saved.
 *
 * The claim is optimistic: the row is updated only where its generation is
 * still the one just read, and the update must touch exactly one row. Two
 * first-ever claims both find no row and both insert; the loser's insert hits
 * the primary key (23505) and is a SweepBusyError like any other lost claim.
 *
 * The read before each write batch is the cheap whole-batch refusal. It is
 * not the fence on its own: since 0.2.0 every reconcile write in core/run.js
 * is also conditional on the row's `last_generation` (core/DECISIONS.md).
 */

import { scopeColumns, scopeKey } from './scope.js';

export const SWEEPS_TABLE = 'watchdog_sweeps';
/** A sweep holds its lease this long unless it releases earlier. */
export const DEFAULT_LEASE_MS = 10 * 60_000;

export class StaleGenerationError extends Error {
  constructor(scope, generation, current) {
    super(`watchdog: sweep generation ${generation} is no longer current for ${scopeKey(scope)} (current ${current ?? 'unknown'}); write refused`);
    this.name = 'StaleGenerationError';
    this.code = 'watchdog_stale_generation';
    this.generation = generation;
    this.current = current ?? null;
  }
}

export class SweepBusyError extends Error {
  constructor(scope, row) {
    super(`watchdog: a sweep (generation ${row?.generation}) holds the lease for ${scopeKey(scope)} until ${row?.lease_until}`);
    this.name = 'SweepBusyError';
    this.code = 'watchdog_sweep_busy';
    this.generation = row?.generation ?? null;
    this.leaseUntil = row?.lease_until ?? null;
  }
}

async function readRow(client, key) {
  const { data, error } = await client.from(SWEEPS_TABLE).select('scope_key, generation, lease_until, trigger, claimed_at').eq('scope_key', key).maybeSingle();
  if (error) throw new Error(`watchdog: could not read ${SWEEPS_TABLE}: ${error.message}`);
  return data ?? null;
}

/**
 * Claim the next generation for a scope.
 *
 * @param {object} client
 * @param {{ scope: object, trigger: 'cron'|'manual', now?: Date, leaseMs?: number, force?: boolean }} opts
 *   force: take over a live lease (a hand-started run after a stuck one).
 * @returns {Promise<{ generation: number, claimedAt: Date, leaseUntil: Date, trigger: 'cron'|'manual' }>}
 * @throws {SweepBusyError} when another sweep's lease has not expired and `force` is not set
 */
export async function claimSweep(client, { scope, trigger = 'cron', now = new Date(), leaseMs = DEFAULT_LEASE_MS, force = false }) {
  const key = scopeKey(scope);
  const kind = trigger === 'manual' ? 'manual' : 'cron';
  const leaseUntil = new Date(now.getTime() + leaseMs);
  const row = await readRow(client, key);
  if (row && !force) {
    const until = Date.parse(row.lease_until ?? '');
    if (Number.isFinite(until) && until > now.getTime()) throw new SweepBusyError(scope, row);
  }
  const generation = (Number(row?.generation) || 0) + 1;
  const stamp = { generation, lease_until: leaseUntil.toISOString(), trigger: kind, claimed_at: now.toISOString(), released_at: null };
  if (!row) {
    const { error } = await client.from(SWEEPS_TABLE).insert({ scope_key: key, ...scopeColumns(scope), ...stamp });
    // Another sweep's first claim landed between our read and our insert.
    if (error?.code === '23505') throw new SweepBusyError(scope, (await readRow(client, key)) ?? { generation, lease_until: leaseUntil.toISOString() });
    if (error) throw new Error(`watchdog: could not claim a sweep: ${error.message}`);
  } else {
    const { data, error } = await client.from(SWEEPS_TABLE).update(stamp).eq('scope_key', key).eq('generation', row.generation).select('generation');
    if (error) throw new Error(`watchdog: could not claim a sweep: ${error.message}`);
    // Someone else moved the row between the read and the update: not ours.
    if (!Array.isArray(data) || data.length !== 1) throw new SweepBusyError(scope, await readRow(client, key));
  }
  return { generation, claimedAt: now, leaseUntil, trigger: kind };
}

/** The generation the row holds now, or null when there is no row. */
export async function currentGeneration(client, scope) {
  const row = await readRow(client, scopeKey(scope));
  return row ? Number(row.generation) : null;
}

/**
 * Throw unless `generation` is still the row's generation. Called before
 * every reconcile write (core/run.js).
 */
export async function assertCurrentGeneration(client, scope, generation) {
  const current = await currentGeneration(client, scope);
  if (current !== generation) throw new StaleGenerationError(scope, generation, current);
}

/**
 * Give the lease back, only when it is still ours. `now` is the release time
 * (core/run.js passes the sweep's start plus the elapsed time on its own
 * clock, so an injected clock behaves like production). Never throws: a
 * sweep that cannot release just lets the lease lapse, and the failure, a
 * returned error included, goes to `onError` (default one console.error line).
 *
 * @returns {Promise<boolean>} true when the row was released
 */
export async function releaseSweep(client, scope, generation, { now = new Date(), onError = null } = {}) {
  const report = (err) => {
    try {
      if (onError) onError(err);
      else console.error(`[watchdog] could not release the sweep lease: ${err?.message ?? err}`);
    } catch { /* a sink that throws is not the sweep's problem */ }
  };
  try {
    const { data, error } = await client.from(SWEEPS_TABLE)
      .update({ lease_until: now.toISOString(), released_at: now.toISOString() })
      .eq('scope_key', scopeKey(scope)).eq('generation', generation)
      .select('generation');
    if (error) { report(new Error(error.message ?? String(error))); return false; }
    if (Array.isArray(data) && data.length === 0) { report(new Error(`generation ${generation} no longer holds the lease; nothing released`)); return false; }
    return true;
  } catch (err) {
    report(err);
    return false;
  }
}
