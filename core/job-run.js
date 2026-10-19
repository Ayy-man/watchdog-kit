/**
 * core/job-run.js: job heartbeats in `job_runs` (core/sql/0003_job_runs.sql).
 *
 * Every scheduled job writes a row when it starts and closes it when it ends,
 * so a job that silently stopped running shows up as a missing row that a
 * `job_missed` check can see, instead of a guess.
 *
 * The wrapper contract, stated once: a heartbeat is bookkeeping. A failure to
 * write one never changes the business handler's response, never throws into
 * it and never delays its error; it is recorded separately through
 * `onObservationError` (default: one console.error line) so an operator can
 * see that observation, not the job, failed.
 *
 * Plain relative imports only, so an offline eval can load this directly.
 */

export const JOB_RUNS_TABLE = 'job_runs';

/** Longest error text kept on a row. */
const MAX_ERROR_CHARS = 2000;
/** Longest string kept inside a summary. */
const MAX_STRING_CHARS = 300;
/** Keys kept on a summary object. */
const MAX_KEYS = 30;
/** Largest `receipt` kept beside a summary, as JSON text. */
export const MAX_RECEIPT_CHARS = 64_000;

/** The default observation-failure sink. Replace per call with `onObservationError`. */
export function logObservationFailure(job, stage, err) {
  console.error(`[job-run] ${job}: could not write the ${stage} heartbeat: ${err?.message ?? err}`);
}

function errorText(err) {
  const text = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return text.length > MAX_ERROR_CHARS ? `${text.slice(0, MAX_ERROR_CHARS)}…` : text;
}

/**
 * Shrink a job's return value to something small enough for `summary`:
 * scalars kept (long strings cut), arrays replaced by their length, nested
 * objects trimmed one level further down and then dropped. The point is
 * counts and reasons, never the rows a job touched, which can carry phone
 * numbers and email addresses.
 *
 * @param {unknown} value
 * @param {number} [depth]
 * @returns {object|null}
 */
export function trimSummary(value, depth = 0) {
  if (value === undefined || value === null) return null;
  if (typeof value !== 'object') return { value: trimScalar(value) };
  if (Array.isArray(value)) return { count: value.length };
  const out = {};
  let kept = 0;
  for (const [key, raw] of Object.entries(value)) {
    if (kept >= MAX_KEYS) { out._truncated = true; break; }
    if (raw === undefined || typeof raw === 'function') continue;
    if (raw === null || typeof raw !== 'object') out[key] = trimScalar(raw);
    else if (Array.isArray(raw)) out[key] = raw.length;
    else if (raw instanceof Date) out[key] = raw.toISOString();
    else if (depth < 1) out[key] = trimSummary(raw, depth + 1);
    else continue;
    kept += 1;
  }
  return out;
}

function trimScalar(value) {
  if (typeof value === 'string' && value.length > MAX_STRING_CHARS) return `${value.slice(0, MAX_STRING_CHARS)}…`;
  if (typeof value === 'bigint') return value.toString();
  return value;
}

/**
 * A structured receipt a job vouches for (counts, labels and short error
 * text, never the rows it read), stored whole under `summary.receipt`.
 * JSON-safe or dropped; one larger than MAX_RECEIPT_CHARS is replaced by
 * `{ truncated: true, chars }`.
 */
export function safeReceipt(receipt) {
  if (receipt == null || typeof receipt !== 'object') return null;
  let json;
  try {
    json = JSON.stringify(receipt);
  } catch {
    return { unserialisable: true };
  }
  if (json.length > MAX_RECEIPT_CHARS) return { truncated: true, chars: json.length };
  return JSON.parse(json);
}

/**
 * Open a heartbeat. Returns the row id, or null when the insert failed
 * (recorded through onObservationError).
 *
 * @param {object} client
 * @param {string} job     stable job name
 * @param {{ now?: Date, onObservationError?: Function }} [opts]
 * @returns {Promise<string|null>}
 */
export async function startJobRun(client, job, { now = new Date(), onObservationError = logObservationFailure } = {}) {
  try {
    const { data, error } = await client
      .from(JOB_RUNS_TABLE)
      .insert({ job, started_at: now.toISOString() })
      .select('id')
      .single();
    if (error) throw error;
    return data?.id ?? null;
  } catch (err) {
    try { onObservationError(job, 'start', err); } catch { /* a sink that throws is not the job's problem */ }
    return null;
  }
}

/**
 * Close a heartbeat opened by startJobRun. With no id (the start insert
 * failed) it writes the whole row in one go instead, so the run is still on
 * record. Never throws.
 *
 * @param {object} client
 * @param {string} job
 * @param {string|null} id
 * @param {{ ok: boolean, summary?: unknown, receipt?: object, error?: unknown, startedAt?: Date, now?: Date, onObservationError?: Function }} outcome
 */
export async function finishJobRun(client, job, id, {
  ok, summary = null, receipt = null, error = null, startedAt, now = new Date(), onObservationError = logObservationFailure,
}) {
  let trimmed = summary == null ? null : trimSummary(summary);
  const kept = safeReceipt(receipt);
  if (kept) trimmed = { ...(trimmed ?? {}), receipt: kept };
  const patch = {
    finished_at: now.toISOString(),
    ok: Boolean(ok),
    summary: trimmed,
    error: error == null ? null : errorText(error),
  };
  try {
    if (id) {
      const { data, error: updateError } = await client.from(JOB_RUNS_TABLE).update(patch).eq('id', id).select('id');
      if (updateError) throw updateError;
      // An update that matched nothing (the row was pruned, or the id is
      // wrong) leaves the run open for ever; say so rather than pass silently.
      if (Array.isArray(data) && data.length === 0) throw new Error(`no ${JOB_RUNS_TABLE} row ${id} to close; the run is not on record as finished`);
    } else {
      const { error: insertError } = await client
        .from(JOB_RUNS_TABLE)
        .insert({ job, started_at: (startedAt ?? now).toISOString(), ...patch });
      if (insertError) throw insertError;
    }
  } catch (err) {
    try { onObservationError(job, 'finish', err); } catch { /* see above */ }
  }
}

/**
 * Record one complete run in a single insert, for routes where wrapping the
 * work is awkward. Never throws.
 */
export async function recordJobRun(client, job, { ok, summary = null, error = null, startedAt, finishedAt = new Date(), onObservationError } = {}) {
  await finishJobRun(client, job, null, { ok, summary, error, startedAt: startedAt ?? finishedAt, now: finishedAt, onObservationError });
}

/**
 * Run `fn` inside a heartbeat. The row is opened before `fn` starts and closed
 * when it settles: `ok` true with the trimmed return value as `summary`, or
 * `ok` false with the error text, after which the error is rethrown so the job
 * fails exactly as it would have without the heartbeat.
 *
 * @template T
 * @param {object} client
 * @param {string} job
 * @param {() => Promise<T>} fn
 * @param {{
 *   summarize?: (result: T) => unknown | Promise<unknown>,
 *   isOk?: (result: T, summary: unknown) => boolean,
 *   clock?: () => Date,
 *   onObservationError?: (job: string, stage: string, err: unknown) => void,
 * }} [opts]
 * @returns {Promise<T>}
 */
export async function withJobRun(client, job, fn, { summarize, isOk, clock = () => new Date(), onObservationError = logObservationFailure } = {}) {
  const startedAt = clock();
  const id = client ? await startJobRun(client, job, { now: startedAt, onObservationError }) : null;
  let result;
  try {
    result = await fn();
  } catch (err) {
    if (client) await finishJobRun(client, job, id, { ok: false, error: err, startedAt, now: clock(), onObservationError });
    throw err;
  }
  if (client) {
    let summary = result;
    let ok = true;
    try {
      summary = summarize ? await summarize(result) : result;
      ok = isOk ? Boolean(isOk(result, summary)) : !(summary && typeof summary === 'object' && summary.ok === false);
    } catch (err) {
      try { onObservationError(job, 'summarise', err); } catch { /* see above */ }
      summary = null;
    }
    await finishJobRun(client, job, id, { ok, summary, startedAt, now: clock(), onObservationError });
  }
  return result;
}
