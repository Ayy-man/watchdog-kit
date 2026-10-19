/**
 * core/cron-run.js: the heartbeat wrapper for scheduled GET routes.
 *
 *   export async function GET(request) {
 *     return runCronJob('reminders.send', request, () => sweepGet(request), { client });
 *   }
 *
 * The wrapper contract, stated once: the handler's Response is returned
 * untouched, its error propagates untouched, and a heartbeat write failure
 * never changes either; observation failures are recorded separately through
 * `onObservationError` (core/job-run.js). The summary is read from a clone of
 * the JSON body, so the caller can still read it.
 *
 * Only a scheduled call is recorded: a request carrying the valid
 * `Authorization: Bearer <cronSecret>` and no manual-override header. Anything
 * else goes straight to the handler with no database write, so an
 * unauthenticated hit can never add rows.
 *
 * The kit does not import a database driver: pass `client`, or
 * `clientFactory(env)` that builds one (and may return null to skip the
 * heartbeat).
 */

import { timingSafeEqual } from 'node:crypto';
import { withJobRun, trimSummary, logObservationFailure } from './job-run.js';

/**
 * The header a manual force or dry-run path carries; such a call is not a
 * scheduled run. Generic since 0.2.0 (it was one client's header name); a
 * client whose manual path uses another header passes `manualHeader`.
 */
export const DEFAULT_MANUAL_HEADER = 'x-watchdog-token';

/** True when the request is a scheduled cron call. */
export function isScheduledCronCall(request, env = process.env, { manualHeader = DEFAULT_MANUAL_HEADER, secretName = 'CRON_SECRET' } = {}) {
  const headers = request?.headers;
  if (!headers || typeof headers.get !== 'function') return false;
  if (manualHeader && headers.get(manualHeader)) return false;
  const auth = headers.get('authorization') ?? '';
  const token = auth.startsWith('Bearer ') ? auth.slice(7) : '';
  const expected = env?.[secretName] ?? '';
  if (!token || !expected) return false;
  const a = Buffer.from(token);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

/** The reason a route gave for doing nothing, or null. */
export function defaultSkippedReason(body) {
  if (!body || typeof body !== 'object') return null;
  if (typeof body.skipped === 'string' && body.skipped) return body.skipped;
  if (body.skipped === true) return typeof body.reason === 'string' && body.reason ? body.reason : 'skipped';
  if (body.quietHours === true) return 'quiet_hours';
  return null;
}

async function readBody(response) {
  try {
    if (typeof response?.clone === 'function') return await response.clone().json();
    if (typeof response?.json === 'function') return await response.json();
  } catch {
    // A non-JSON body has nothing to summarise.
  }
  return null;
}

/**
 * Build the job_runs summary for a route Response: the status, the body's
 * counts and reasons trimmed by trimSummary, and `skipped` set to the reason
 * when the route exited early, so a skipped slot reads differently from a
 * missed one. A body whose `skipped` is a number keeps it as `skippedCount`.
 */
export async function responseSummary(response, skippedReason = defaultSkippedReason) {
  if (!isResponseLike(response)) {
    return { status: null, note: `handler returned ${response === null ? 'null' : typeof response}, not a Response` };
  }
  const body = await readBody(response);
  const trimmed = body && typeof body === 'object' && !Array.isArray(body) ? trimSummary(body) : {};
  if (trimmed && 'skipped' in trimmed && typeof trimmed.skipped === 'number') {
    trimmed.skippedCount = trimmed.skipped;
    delete trimmed.skipped;
  }
  const reason = skippedReason(body);
  return {
    status: response?.status ?? null,
    ...trimmed,
    ...(reason ? { skipped: reason } : {}),
  };
}

/** Something with a numeric HTTP status, the way a Response has. */
function isResponseLike(value) {
  return Boolean(value) && typeof value === 'object' && Number.isInteger(value.status);
}

/**
 * Whether a run counts as ok. A 2xx/3xx that does not say ok: false is ok. A
 * 503 that names why it skipped is a deliberate skip, not a failure, so it is
 * ok too and reads as skipped on its summary. A handler that returned no
 * Response at all (a route that returns undefined, or a plain object) ran
 * without throwing, so it is ok, with a note on its summary saying what it
 * returned (0.2.0; it used to read as a 500 failure).
 */
export function isOkRun(response, summary) {
  if (!isResponseLike(response)) return true;
  const status = response.status;
  if (status === 503 && typeof summary?.skipped === 'string' && summary.skipped) return true;
  return status < 400 && summary?.ok !== false;
}

/**
 * Run a scheduled route's handler inside a job_runs heartbeat.
 *
 * @param {string} job
 * @param {Request} request
 * @param {() => Promise<Response>} handler
 * @param {{
 *   skippedReason?: (body: object|null) => string|null,
 *   client?: object,
 *   clientFactory?: (env: object) => object|null,
 *   env?: object,
 *   manualHeader?: string,
 *   secretName?: string,
 *   onObservationError?: Function,
 * }} [opts]
 * @returns {Promise<Response>}
 */
export async function runCronJob(job, request, handler, {
  skippedReason = defaultSkippedReason, client, clientFactory, env = process.env,
  manualHeader = DEFAULT_MANUAL_HEADER, secretName = 'CRON_SECRET', onObservationError = logObservationFailure,
} = {}) {
  if (!isScheduledCronCall(request, env, { manualHeader, secretName })) return handler();
  let db = client ?? null;
  if (!db && typeof clientFactory === 'function') {
    try { db = clientFactory(env) ?? null; } catch (err) {
      try { onObservationError(job, 'client', err); } catch { /* not the job's problem */ }
      db = null;
    }
  }
  if (!db) return handler();
  return withJobRun(db, job, handler, {
    summarize: (response) => responseSummary(response, skippedReason),
    isOk: (response, summary) => isOkRun(response, summary),
    onObservationError,
  });
}
