/**
 * core/run.js: one watchdog sweep. Ported from the reference build's run.js
 * with the changes the contracts require (contracts/finding.d.ts).
 *
 * The sweep claims a SweepGeneration (core/sweep-generation.js), runs every
 * check, then reconciles `watchdog_findings`:
 *   - a finding seen for the first time is inserted, open;
 *   - one still open is refreshed (last_seen_at, title, detail, link,
 *     severity, evidence, would_do, would_say, last_evidence_at);
 *   - one that had been resolved and is seen again is reopened
 *     (reopened_count + 1, resolved_at cleared);
 *   - an open finding a check no longer reports is resolved only when that
 *     check's Coverage is complete, for this sweep's scope, positively
 *     examined the finding's subject (or an interval holding its real
 *     evidence time) and is fresher than that evidence, or when that check's
 *     `resolveReason(row)` answers `left_scope` for it on an equally complete
 *     and fresh run (a subject that fell out of the check's window cannot be
 *     examined). A check that threw, timed out, was skipped, reported itself
 *     partial, dropped a malformed finding, read a truncated page, had a read
 *     fail, or returned no coverage resolves nothing. Why a finding did or
 *     did not resolve is recorded (meta.resolved_reason, and the receipt's
 *     notResolved).
 *
 * Every finding id is built in core/scope.js, never from model text, and is
 * injective. Every write is fenced twice on the sweep's generation: a read of
 * the sweep row before each batch refuses a whole batch cheaply, and each
 * write is itself conditional on the row's `last_generation` not being newer
 * than this sweep's, so a sweep that lost its lease between the read and the
 * write cannot overwrite a newer sweep's row (StaleGenerationError).
 *
 * Rule checks run and are committed first; the model checks (`model: true`)
 * run after, inside a time budget, so a sweep killed mid-review keeps every
 * rule finding. Every check is raced against the time left before the hard
 * stop, and a model check is not started once the model start budget has
 * passed. A cron run and a manual run record distinct job names.
 *
 * A check that throws, or returns something unusable, becomes one
 * `check_error` finding on the system subject so a blind spot is visible and
 * clears itself once the check runs cleanly again. It never stops the other
 * checks. A list of checks that is itself wrong (a duplicate or invalid id, a
 * `writes` table that is not the check's own) refuses the whole sweep before
 * anything is claimed, because it is a deployment mistake, not a fault in
 * the client's operation.
 *
 * The sweep writes only watchdog_findings, watchdog_sweeps and job_runs. It
 * never sends, never notifies and never touches the client's own tables; the
 * checks run on a read-only client (core/readonly-client.js). Human verdicts
 * are never written here; meta (the verdict context, an existing-monitoring
 * match, alert state) is written only when the sweep must change it, so a
 * concurrent verdict is not overwritten by a plain refresh (core/verdicts.js,
 * core/DECISIONS.md).
 */

import { randomUUID } from 'node:crypto';
import { JOB_RUNS_TABLE, startJobRun, finishJobRun } from './job-run.js';
import { buildSources, coverageExamined, createCoverage, createLedger, DEFAULT_PAGE_CAP, normaliseCoverage, shortText } from './coverage.js';
import { readOnlyClient } from './readonly-client.js';
import { buildFindingId, normaliseScope, sameScope, scopeColumns } from './scope.js';
import { assertCurrentGeneration, claimSweep, releaseSweep, StaleGenerationError, SweepBusyError, SWEEPS_TABLE } from './sweep-generation.js';
import { VERDICT_CONTEXT_KEY } from './verdicts.js';

export const FINDINGS_TABLE = 'watchdog_findings';
export const SWEEP_JOB_CRON = 'watchdog.sweep';
export const SWEEP_JOB_MANUAL = 'watchdog.sweep.manual';
/** The job name a trigger records. */
export function sweepJobName(trigger) {
  return trigger === 'manual' ? SWEEP_JOB_MANUAL : SWEEP_JOB_CRON;
}

/** Model reviews start only in the first MODEL_START_BUDGET_MS of a sweep. */
export const MODEL_START_BUDGET_MS = 200_000;
/** And every check must end by SWEEP_HARD_STOP_MS, inside the route's maxDuration. */
export const SWEEP_HARD_STOP_MS = 285_000;

export const SEVERITIES = new Set(['high', 'medium', 'low']);
export const RESOLVE_REASONS = new Set(['recovered', 'cancelled', 'left_scope']);
export const CHECK_ERROR_KIND = 'check_error';
export const SYSTEM_SUBJECT_TYPE = 'system';
/** A check id: lower snake case, so it is safe in an id, a URL and an `in` list. */
export const CHECK_ID_PATTERN = /^[a-z][a-z0-9_]*$/;
/**
 * Tables no check may write, even with `writes`: the kit's own. A check that
 * could write watchdog_sweeps could move the generation, and one that could
 * write watchdog_findings could resolve its own findings.
 */
export const KIT_TABLES = new Set([FINDINGS_TABLE, SWEEPS_TABLE, JOB_RUNS_TABLE, 'watchdog_silences', 'alert_sends']);
/** Keys in `meta` the sweep writes. */
export const RESOLVED_REASON_KEY = 'resolved_reason';
export const RESOLVED_NOTE_KEY = 'resolved_note';
/** Set on a row whose last evidence time was the sweep's `now`, not an event time; interval coverage never matches it. */
export const EVIDENCE_DEFAULTED_KEY = 'evidence_defaulted';
const RESOLUTION_KEYS = [RESOLVED_REASON_KEY, RESOLVED_NOTE_KEY, 'resolved_run_id', 'resolved_generation'];
export { VERDICT_CONTEXT_KEY };
export const RECEIPT_VERSION = 3;

/** Rows per page when the sweep reads its own findings (keyset paging, read to an empty page). */
const FINDINGS_PAGE = 1000;
/** Rows per upsert request body. */
const WRITE_CHUNK = 100;
/** PostgREST puts `in` lists in the URL; keep each list's encoded length under this, well inside common gateway limits. */
export const IN_URL_CHARS = 6000;
const IN_MAX_VALUES = 100;

function chunk(list, size = WRITE_CHUNK) {
  const out = [];
  for (let i = 0; i < list.length; i += size) out.push(list.slice(i, i + size));
  return out;
}

/**
 * Split values for an `in` filter so each list's URL-encoded length stays
 * under `maxChars`. 100 ids of 140 characters made a 14 KB URL in 0.1,
 * over many gateways' limits; the length, not the count, is what matters.
 */
export function chunkForIn(values, { maxChars = IN_URL_CHARS, maxValues = IN_MAX_VALUES } = {}) {
  const out = [];
  let cur = [];
  let len = 0;
  for (const v of values) {
    // Quoted, comma-separated, each character possibly percent-encoded.
    const n = encodeURIComponent(`"${String(v)}"`).length + 3;
    if (cur.length && (len + n > maxChars || cur.length >= maxValues)) { out.push(cur); cur = []; len = 0; }
    cur.push(v);
    len += n;
  }
  if (cur.length) out.push(cur);
  return out;
}

function text(value, max) {
  if (value == null) return null;
  const s = String(value);
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value ?? NaN);
  return Number.isFinite(d.getTime()) ? d : null;
}

function obj(value) {
  return value && typeof value === 'object' && !Array.isArray(value) ? value : {};
}

/** JSON-safe value; anything that cannot be serialised is reported, not thrown. */
function safeJson(value, fallback) {
  try {
    const parsed = JSON.parse(JSON.stringify(value));
    return parsed === undefined ? fallback : parsed;
  } catch (err) {
    return { unserialisable: String(err?.message ?? err) };
  }
}

/** EvidenceRef list (door.d.ts): source and id required, field and value kept when present. */
function normaliseEvidence(evidence) {
  if (!Array.isArray(evidence)) return [];
  return evidence
    .filter((e) => e && typeof e === 'object' && e.source != null && e.id != null)
    .map((e) => ({
      source: text(e.source, 120),
      id: text(e.id, 200),
      ...(e.field != null ? { field: text(e.field, 120) } : {}),
      ...(e.label != null ? { label: text(e.label, 160) } : {}),
      ...(e.value !== undefined ? { value: typeof e.value === 'object' && e.value !== null ? safeJson(e.value, null) : (typeof e.value === 'string' ? text(e.value, 2000) : e.value) } : {}),
    }))
    .slice(0, 200);
}

function errorFinding(checkId, err, severity = 'medium') {
  const message = err instanceof Error ? `${err.name}: ${err.message}` : String(err);
  return {
    checkId,
    kind: CHECK_ERROR_KIND,
    subject: { type: SYSTEM_SUBJECT_TYPE, id: checkId },
    entities: [],
    severity,
    title: `Watchdog check ${checkId} failed to run`,
    detail: text(message, 1000),
    link: null,
    wouldDo: null,
    wouldSay: null,
    evidence: [{ source: 'check', id: checkId, field: 'error', value: text(message, 2000) }],
    evidenceAt: null,
  };
}

/** The error a check that ran past its time gets; it becomes that check's check_error finding. */
export class CheckTimeoutError extends Error {
  constructor(checkId, ms) {
    super(`check ${checkId} did not finish within ${Math.round(ms)} ms (the time left before the sweep's hard stop)`);
    this.name = 'CheckTimeoutError';
    this.code = 'watchdog_check_timeout';
  }
}

/**
 * Race a promise against `ms` of real time. The timer is cleared as soon as
 * the race settles; it is deliberately not unref'd, because a hung check may
 * be the only thing left on the event loop and the sweep must still wake up
 * to record it. The hung promise itself cannot be cancelled: it keeps running
 * on its read-only client after the sweep has moved on.
 */
function withTimeout(promise, ms, checkId) {
  if (!(ms > 0)) return Promise.reject(new CheckTimeoutError(checkId, 0));
  let timer;
  const timeout = new Promise((_, reject) => {
    timer = setTimeout(() => reject(new CheckTimeoutError(checkId, ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

/**
 * Refuse a check list that cannot be swept safely. Throws a TypeError naming
 * every problem. Pure.
 *
 *   - every check is an object with an id matching CHECK_ID_PATTERN, unique
 *     in the list (two checks with one id would share a result, and the
 *     clean one would resolve the other's findings);
 *   - `writes` names at most one table, a string, that is not a kit table,
 *     not another check's `writes` table and not in any check's `reads`
 *     (one table of its own and nothing else, shared-contract.md).
 */
export function validateChecks(checks) {
  const problems = [];
  const ids = new Set();
  const writers = new Map();
  const readTables = new Set();
  checks.forEach((c) => { for (const t of Array.isArray(c?.reads) ? c.reads : []) readTables.add(String(t)); });
  checks.forEach((c, i) => {
    if (!c || typeof c !== 'object') { problems.push(`check ${i} is not an object`); return; }
    if (typeof c.id !== 'string' || !CHECK_ID_PATTERN.test(c.id)) { problems.push(`check ${i} id ${JSON.stringify(c.id)} is not lower snake case`); return; }
    if (ids.has(c.id)) problems.push(`check id ${c.id} appears twice`);
    ids.add(c.id);
    if (c.writes == null) return;
    if (!Array.isArray(c.writes) || c.writes.length > 1 || c.writes.some((t) => typeof t !== 'string' || !t.trim())) {
      problems.push(`check ${c.id} writes must be a list of at most one table name`);
      return;
    }
    const [table] = c.writes;
    if (!table) return;
    if (KIT_TABLES.has(table)) problems.push(`check ${c.id} may not write the kit's own table ${table}`);
    if (readTables.has(table)) problems.push(`check ${c.id} may not write ${table}, which a check reads`);
    // Several model checks may share one review table: its key carries the
    // check id, so one check cannot touch another's rows.
    writers.set(table, c.id);
  });
  if (problems.length) throw new TypeError(`watchdog: refused the check list: ${problems.join('; ')}`);
}

/**
 * Validate one check's findings into normalised findings. A malformed
 * finding is dropped and reported as the check's error finding instead of
 * being written half-formed; `dropped` counts them, and core/run.js then
 * treats the run as partial, because the check saw a problem it failed to
 * describe and its silence about that subject is not evidence of recovery.
 */
export function normaliseFindings(check, list, scope) {
  if (!Array.isArray(list)) {
    return { findings: [errorFinding(check.id, new TypeError(`run() returned ${list === null ? 'null' : typeof list} findings, not a list`))], failed: true, dropped: 0 };
  }
  const byId = new Map();
  const problems = [];
  list.forEach((f, i) => {
    const kind = String(f?.kind ?? '').trim();
    const subjectType = String(f?.subject?.type ?? '').trim();
    const subjectId = f?.subject?.id == null ? '' : String(f.subject.id).trim();
    if (!kind || !subjectType || !subjectId || !f?.title) {
      problems.push(`finding ${i} has no ${!kind ? 'kind' : !subjectType ? 'subject.type' : !subjectId ? 'subject.id' : 'title'}`);
      return;
    }
    const severity = SEVERITIES.has(f.severity) ? f.severity : (SEVERITIES.has(check.severity) ? check.severity : 'medium');
    const entities = (Array.isArray(f.entities) ? f.entities : [])
      .filter((e) => e && e.type != null && e.id != null)
      .map((e) => ({ type: String(e.type), id: String(e.id) }));
    const finding = {
      checkId: check.id,
      kind,
      subject: { type: subjectType, id: subjectId },
      entities,
      severity,
      title: text(f.title, 500),
      detail: text(f.detail, 4000),
      link: text(f.link, 500),
      wouldDo: text(f.wouldDo, 2000),
      wouldSay: text(f.wouldSay, 4000),
      evidence: normaliseEvidence(f.evidence),
      evidenceAt: toDate(f.evidenceAt),
    };
    // Same problem twice in one run: the last one wins, as one row would.
    byId.set(buildFindingId(scope, check.id, kind, finding), finding);
  });
  const findings = [...byId.values()];
  if (problems.length) findings.push(errorFinding(check.id, new TypeError(problems.join('; '))));
  return { findings, failed: false, dropped: problems.length };
}

/**
 * Whether a check result may resolve one open finding it did not report, and
 * why not. The resolution rule from finding.d.ts, stated once. Pure.
 *
 * `scope` is the sweep's scope (or, when omitted, the row's scope columns):
 * coverage that names another scope resolves nothing. A row whose evidence
 * time was defaulted (meta.evidence_defaulted, or no last_evidence_at) is
 * never matched by an interval, only by its subject: its stored time is when
 * a sweep saw it, not when the event happened.
 *
 * @returns {{ ok: boolean, why: string|null, reason: string|null }}
 */
export function resolutionDecision(result, row, scope = null) {
  if (!result) return { ok: false, why: 'no result', reason: null };
  if (result.failed) return { ok: false, why: result.timedOut ? 'timed out' : 'threw', reason: null };
  const cov = result.coverage;
  if (!cov) return { ok: false, why: 'no coverage', reason: null };
  const target = scope ?? (row?.installation != null ? { installation: row.installation, tenant: row.tenant ?? null, environment: row.environment } : null);
  if (target && (!cov.scope || !sameScope(cov.scope, target))) return { ok: false, why: 'coverage for another scope', reason: null };
  if (cov.words?.skipped) return { ok: false, why: 'skipped', reason: null };
  if (cov.words?.partial?.length || result.partial) return { ok: false, why: 'partial', reason: null };
  if (!cov.complete) return { ok: false, why: `incomplete (${(cov.incompleteWhy ?? []).join(', ') || 'unspecified'})`, reason: null };
  const lastEvidence = toDate(row.last_evidence_at) ?? toDate(row.last_seen_at);
  if (!lastEvidence || !(cov.freshAsOf.getTime() > lastEvidence.getTime())) return { ok: false, why: 'not fresher than the finding\'s evidence', reason: null };
  const evidenceExplicit = toDate(row.last_evidence_at) != null && obj(row.meta)[EVIDENCE_DEFAULTED_KEY] !== true;
  let reason = null;
  try { reason = cov.resolveReason?.(row) ?? null; } catch { reason = null; }
  if (reason !== 'left_scope') {
    // Examined and not reported is not proof of recovery when the check says
    // the finding is still true (a model review that did not repeat it while
    // everything it quoted is unchanged).
    let hold = null;
    try { hold = cov.keepOpen?.(row) ?? null; } catch { hold = null; }
    if (hold) return { ok: false, why: `held open: ${String(hold).slice(0, 120)}`, reason: null };
  }
  if (!coverageExamined(cov, { type: row.subject_type, id: row.subject_id }, evidenceExplicit ? lastEvidence : null)) {
    // A subject the check says in code has left its scope cannot be examined
    // by definition; that explicit answer, on a complete and fresh run, is
    // enough. Any other unexamined subject stays open.
    if (reason === 'left_scope') return { ok: true, why: null, reason };
    const hadInterval = (cov.examined ?? []).some((e) => e && 'from' in e);
    return { ok: false, why: !evidenceExplicit && hadInterval ? 'subject not examined (evidence time defaulted, so no interval can hold it)' : 'subject not examined', reason: null };
  }
  return { ok: true, why: null, reason: RESOLVE_REASONS.has(reason) ? reason : 'recovered' };
}

/**
 * Read this scope's findings where `column` is in `values`, every row of
 * them: the `in` list is split by URL length and each part is read in pages
 * ordered by id, each page starting after the last id seen, until a page
 * comes back empty. Reading to an empty page, rather than to a short one, is
 * what makes it safe under a server max-rows below FINDINGS_PAGE. Before
 * 0.2.0 this read stopped at the server cap with no order, so past 1000 open
 * rows an arbitrary subset was never evaluated.
 */
async function selectFindings(client, scope, column, values, columns, { status } = {}) {
  const s = normaliseScope(scope);
  const rows = [];
  const cols = columns.split(',').map((c) => c.trim()).includes('id') ? columns : `id, ${columns}`;
  for (const part of chunkForIn(values)) {
    let after = null;
    for (;;) {
      let query = client.from(FINDINGS_TABLE).select(cols).in(column, part)
        .eq('installation', s.installation).eq('environment', s.environment);
      query = s.tenant == null ? query.is('tenant', null) : query.eq('tenant', s.tenant);
      if (status) query = query.eq('status', status);
      if (after != null) query = query.gt('id', after);
      const { data, error } = await query.order('id', { ascending: true }).limit(FINDINGS_PAGE);
      if (error) throw new Error(`watchdog: could not read findings: ${error.message}`);
      const page = Array.isArray(data) ? data : [];
      if (!page.length) break;
      const last = String(page[page.length - 1].id);
      if (after != null && last <= after) throw new Error('watchdog: findings did not page forward by id; refusing to guess what was missed');
      rows.push(...page);
      after = last;
    }
  }
  return rows;
}

/**
 * Run one sweep.
 *
 * @param {{
 *   client: object, scope: object, now?: Date, checks: Array<object>,
 *   trigger?: 'cron'|'manual', startedBy?: string|null, clock?: () => number,
 *   modelStartBudgetMs?: number, hardStopMs?: number, policyVersion?: string,
 *   pageCap?: number, leaseMs?: number, force?: boolean,
 * }} opts
 *   client: the writing client (reconcile, sweeps, job_runs); checks get a read-only wrapper of it.
 *   checks: each { id, severity, title?, incidents?, model?, writes?: [table], reads?: string[], timeoutMs?, run(ctx) }.
 *   pageCap: the project's max-rows, for truncation (default 1000; recorded on the receipt).
 *   force: take over a live lease (a hand-started run after a stuck one).
 * @returns {Promise<object>} the summary, with the receipt under `receipt`
 */
export async function runWatchdog({
  client, scope, now = new Date(), checks, trigger = 'cron', startedBy = null, clock = Date.now,
  modelStartBudgetMs = MODEL_START_BUDGET_MS, hardStopMs = SWEEP_HARD_STOP_MS, policyVersion = 'unversioned',
  pageCap, leaseMs, force = false,
} = {}) {
  if (!client) throw new Error('runWatchdog needs a writing database client.');
  if (!Array.isArray(checks)) throw new Error('runWatchdog needs a list of checks.');
  const s = normaliseScope(scope);
  const job = sweepJobName(trigger);
  const list = checks;

  const jobRunId = await startJobRun(client, job, { now });
  const runId = jobRunId ?? randomUUID();
  const summary = {
    ok: true, runId, job, trigger: trigger === 'manual' ? 'manual' : 'cron', generation: null, checks: list.length, checksFailed: 0, failedChecks: [],
    checksSkipped: [], seen: 0, new: 0, refreshed: 0, reopened: 0, resolved: 0, notResolved: [],
  };

  const sweepStartMs = clock();
  const sweepLedger = createLedger();
  const checkResults = [];
  const budget = { startBy: sweepStartMs + modelStartBudgetMs, finishBy: sweepStartMs + hardStopMs, clock };
  const nowIso = now.toISOString();
  const flagged = [];
  let generation = null;

  const runOne = async (check, index, extra = {}) => {
    const checkId = check.id;
    const ledger = createLedger();
    const coverage = createCoverage({ scope: s, policyVersion, now });
    const startMs = clock();
    let outcome;
    let record = null;
    let partial = null;
    let thrown = null;
    let skippedForBudget = false;
    try {
      if (typeof check?.run !== 'function') throw new TypeError('check has no run() function');
      if (check.model === true && clock() > budget.startBy) {
        // Past the model start budget: not started, so it examined nothing and resolves nothing.
        skippedForBudget = true;
        coverage.skipped('model start budget passed before this check could start');
        record = coverage.finish({ ledger });
        outcome = { findings: [], failed: false, dropped: 0 };
      } else {
        const read = readOnlyClient(client, [ledger, sweepLedger], { pageCap, allowWrites: Array.isArray(check.writes) ? check.writes : [] });
        const ctx = {
          read, now, scope: s, trigger: summary.trigger, budget, budgetMs: Math.max(0, budget.finishBy - clock()),
          flagged: extra.flagged ?? [], coverage, generation, runId,
        };
        const left = budget.finishBy - clock();
        const limitMs = Number.isFinite(check.timeoutMs) && check.timeoutMs > 0 ? Math.min(check.timeoutMs, left) : left;
        const output = await withTimeout(Promise.resolve().then(() => check.run(ctx)), limitMs, checkId);
        const auto = coverage.finish({ ledger });
        let findings;
        if (Array.isArray(output)) {
          findings = output;
          record = auto;
        } else if (output && typeof output === 'object') {
          findings = output.findings;
          record = normaliseCoverage(output.coverage, auto);
          if (output.partial && typeof output.partial === 'object') {
            partial = { reason: shortText(output.partial.reason) ?? 'partial', skipped: Array.isArray(output.partial.skipped) ? output.partial.skipped.slice(0, 100) : [] };
            if (record) { record.complete = false; record.incompleteWhy = [...(record.incompleteWhy ?? []), 'partial']; }
          }
        } else {
          findings = output;
        }
        outcome = normaliseFindings(check, findings, s);
        if (outcome.dropped && !outcome.failed) {
          // The check saw something it could not describe; nothing it was silent about may resolve.
          const why = `${outcome.dropped} malformed finding${outcome.dropped === 1 ? '' : 's'} dropped`;
          partial = partial ?? { reason: why, skipped: [] };
          if (record) { record.complete = false; record.incompleteWhy = [...(record.incompleteWhy ?? []), why]; }
        }
        // A check that ran has positively examined its own system subject, so
        // an earlier check_error finding can clear once it runs cleanly again.
        if (record && !outcome.failed) record.examined.push({ type: SYSTEM_SUBJECT_TYPE, id: checkId });
      }
    } catch (err) {
      console.error(`[watchdog] check ${checkId} threw: ${err?.message ?? err}`);
      thrown = err;
      outcome = { findings: [errorFinding(checkId, err)], failed: true, dropped: 0, timedOut: err instanceof CheckTimeoutError };
      record = null;
    }
    if (outcome.failed) {
      summary.checksFailed += 1;
      summary.failedChecks.push(checkId);
    }
    if (skippedForBudget) summary.checksSkipped.push(checkId);
    const errorText = outcome.failed
      ? shortText(thrown ? (thrown instanceof Error ? thrown.message : String(thrown)) : outcome.findings[0]?.detail, 300)
      : null;
    const words = record?.words ?? coverage.collected;
    checkResults.push({
      index,
      id: checkId,
      title: shortText(check?.title, 120),
      ms: Math.max(0, Math.round(clock() - startMs)),
      ok: !outcome.failed,
      error: errorText,
      findingsCount: outcome.failed ? 0 : outcome.findings.filter((f) => f.kind !== CHECK_ERROR_KIND).length,
      reads: ledger.counts(),
      coverage: record ? {
        complete: record.complete,
        incompleteWhy: record.incompleteWhy ?? [],
        examined: record.examined.length,
        freshAsOf: record.freshAsOf.toISOString(),
        freshness: record.freshness ?? {},
        policyVersion: record.policyVersion,
        sources: record.sources,
      } : null,
      covered: words.covered ?? [],
      idle: words.idle ?? null,
      skipped: words.skipped ?? null,
      partial: [...(words.partial ?? []).map((p) => (typeof p === 'string' ? p : p.reason)), ...(partial ? [partial.reason] : [])],
      review: words.review ?? null,
    });
    return {
      checkId, findings: outcome.findings, failed: outcome.failed, timedOut: Boolean(outcome.timedOut), coverage: record, partial, title: check?.title ?? checkId,
    };
  };

  /** Throw StaleGenerationError when a conditional write touched nothing because a newer sweep owns the row. */
  const staleOrGone = async (id) => {
    const { data, error } = await client.from(FINDINGS_TABLE).select('id, status, last_generation').eq('id', id).maybeSingle();
    if (error) throw new Error(`watchdog: could not read finding ${id}: ${error.message}`);
    if (data && Number(data.last_generation) > generation) throw new StaleGenerationError(s, generation, Number(data.last_generation));
    return data ?? null;
  };
  // The per-row fence: a write lands only where no newer sweep has written the row.
  const notNewer = () => `last_generation.is.null,last_generation.lte.${generation}`;

  // Reconcile one phase's findings: write what was seen, resolve what covered checks dropped.
  const reconcile = async (results, { collectFlagged = false } = {}) => {
    const seen = results.flatMap((r) => r.findings);
    const rows = seen.map((f) => ({ ...f, id: buildFindingId(s, f.checkId, f.kind, f) }));
    const existing = new Map(
      (await selectFindings(client, s, 'id', rows.map((r) => r.id), 'id, status, reopened_count, last_generation, meta'))
        .map((r) => [r.id, r]),
    );
    const defaulted = (f) => !f.evidenceAt;
    const common = (f) => ({
      severity: f.severity,
      status: 'open',
      title: f.title,
      detail: f.detail,
      link: f.link,
      would_do: f.wouldDo,
      would_say: f.wouldSay,
      evidence: f.evidence,
      last_seen_at: nowIso,
      last_evidence_at: (f.evidenceAt ?? now).toISOString(),
      resolved_at: null,
      last_run_id: runId,
      last_generation: generation,
    });

    // 1. New rows: insert, ignoring any a concurrent sweep inserted first;
    //    those become refreshes below, so first_seen_at is never rewritten.
    const inserts = rows.filter((f) => !existing.has(f.id));
    const insertedIds = new Set();
    for (const part of chunk(inserts)) {
      await assertCurrentGeneration(client, s, generation);
      const payload = part.map((f) => ({
        id: f.id,
        ...scopeColumns(s),
        check_id: f.checkId,
        kind: f.kind,
        subject_type: f.subject.type,
        subject_id: f.subject.id,
        ...common(f),
        meta: defaulted(f) ? { [EVIDENCE_DEFAULTED_KEY]: true } : {},
        first_seen_at: nowIso,
        reopened_count: 0,
      }));
      const { data, error } = await client.from(FINDINGS_TABLE).upsert(payload, { onConflict: 'id', ignoreDuplicates: true }).select('id');
      if (error) throw new Error(`watchdog: could not save findings: ${error.message}`);
      for (const r of Array.isArray(data) ? data : []) insertedIds.add(r.id);
    }
    const raced = inserts.filter((f) => !insertedIds.has(f.id)).map((f) => f.id);
    if (raced.length) {
      for (const r of await selectFindings(client, s, 'id', raced, 'id, status, reopened_count, last_generation, meta')) existing.set(r.id, r);
    }

    // 2. Existing rows: one conditional update each. Only what the sweep owns
    //    is sent; meta only when the resolution record must be cleared or
    //    the defaulted-evidence flag changed, so a verdict written in between
    //    survives a plain refresh.
    let updates = 0;
    for (const f of rows) {
      const isNew = insertedIds.has(f.id);
      const prior = existing.get(f.id);
      if (isNew || !prior) {
        if (isNew) summary.new += 1;
        if (isNew && collectFlagged && f.kind !== CHECK_ERROR_KIND) flagged.push({ ...f, id: f.id });
        continue;
      }
      if (updates % WRITE_CHUNK === 0) await assertCurrentGeneration(client, s, generation);
      updates += 1;
      const reopening = prior.status === 'resolved';
      const patch = common(f);
      if (reopening) patch.reopened_count = (Number(prior.reopened_count) || 0) + 1;
      const priorMeta = obj(prior.meta);
      const hasResolution = RESOLUTION_KEYS.some((k) => k in priorMeta);
      const flagChanged = (priorMeta[EVIDENCE_DEFAULTED_KEY] === true) !== defaulted(f);
      if (reopening || hasResolution || flagChanged) {
        const kept = Object.fromEntries(Object.entries(priorMeta).filter(([k]) => !RESOLUTION_KEYS.includes(k) && k !== EVIDENCE_DEFAULTED_KEY));
        patch.meta = { ...kept, ...(defaulted(f) ? { [EVIDENCE_DEFAULTED_KEY]: true } : {}) };
      }
      const { data, error } = await client.from(FINDINGS_TABLE).update(patch).eq('id', f.id).or(notNewer()).select('id');
      if (error) throw new Error(`watchdog: could not save findings: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) {
        await staleOrGone(f.id);
        throw new Error(`watchdog: finding ${f.id} disappeared while the sweep was writing it`);
      }
      if (reopening) summary.reopened += 1;
      else summary.refreshed += 1;
      if (reopening && collectFlagged && f.kind !== CHECK_ERROR_KIND) flagged.push({ ...f, id: f.id });
    }
    summary.seen += rows.length;

    // 3. Resolve what covered checks no longer report.
    const seenIds = new Set(rows.map((r) => r.id));
    const byCheck = new Map(results.map((r) => [r.checkId, r]));
    const open = await selectFindings(client, s, 'check_id', [...byCheck.keys()],
      'id, installation, tenant, environment, check_id, subject_type, subject_id, status, last_seen_at, last_evidence_at, meta', { status: 'open' });
    const notResolvedWhy = new Map();
    let resolves = 0;
    for (const row of open) {
      if (seenIds.has(row.id)) continue;
      const result = byCheck.get(row.check_id);
      const decision = resolutionDecision(result, row, s);
      if (!decision.ok) {
        const key = `${result?.checkId ?? row.check_id} (${decision.why})`;
        notResolvedWhy.set(key, (notResolvedWhy.get(key) ?? 0) + 1);
        continue;
      }
      if (resolves % WRITE_CHUNK === 0) await assertCurrentGeneration(client, s, generation);
      resolves += 1;
      // Re-read meta immediately before the write and add only the
      // resolution keys, so bookkeeping written since the open read is kept.
      const { data: cur, error: readError } = await client.from(FINDINGS_TABLE).select('id, status, last_generation, meta').eq('id', row.id).maybeSingle();
      if (readError) throw new Error(`watchdog: could not read finding ${row.id}: ${readError.message}`);
      if (!cur || cur.status !== 'open') continue;
      if (Number(cur.last_generation) > generation) throw new StaleGenerationError(s, generation, Number(cur.last_generation));
      const meta = {
        ...obj(cur.meta),
        [RESOLVED_REASON_KEY]: decision.reason,
        [RESOLVED_NOTE_KEY]: `${result.checkId} examined it with complete coverage as of ${result.coverage.freshAsOf.toISOString()} and no longer reports it`,
        resolved_run_id: runId,
        resolved_generation: generation,
      };
      const { data, error } = await client
        .from(FINDINGS_TABLE)
        .update({ status: 'resolved', resolved_at: nowIso, last_run_id: runId, last_generation: generation, meta })
        .eq('id', row.id)
        .eq('status', 'open')
        .or(notNewer())
        .select('id');
      if (error) throw new Error(`watchdog: could not resolve findings: ${error.message}`);
      if (!Array.isArray(data) || data.length === 0) {
        // Either a newer sweep refreshed it (stale: stop) or it is no longer open (nothing to do).
        await staleOrGone(row.id);
        continue;
      }
      summary.resolved += 1;
    }
    for (const [key, n] of notResolvedWhy) summary.notResolved.push(n > 1 ? `${key} x${n}` : key);
  };

  const finish = async (ok, err = null) => {
    checkResults.sort((a, b) => a.index - b.index);
    summary.ok = ok;
    const elapsed = Math.max(0, clock() - sweepStartMs);
    // The sweep's own `now` plus the time elapsed on its own clock: the real
    // release time in production, and still deterministic under an injected clock.
    const endAt = new Date(now.getTime() + elapsed);
    summary.receipt = buildReceipt({ summary, checkResults, sweepLedger, now, ms: elapsed, trigger: summary.trigger, startedBy, scope: s, error: err, pageCap });
    if (generation != null) await releaseSweep(client, s, generation, { now: endAt });
    await finishJobRun(client, job, jobRunId, { ok, summary: sweepSummary(summary), receipt: summary.receipt, error: err, startedAt: now, now: endAt });
  };

  try {
    validateChecks(list);
  } catch (err) {
    await finish(false, err);
    throw err;
  }

  try {
    const claim = await claimSweep(client, { scope: s, trigger, now, leaseMs, force });
    generation = claim.generation;
    summary.generation = generation;
  } catch (err) {
    if (err instanceof SweepBusyError) summary.busy = { generation: err.generation, leaseUntil: err.leaseUntil };
    await finish(false, err);
    throw err;
  }

  try {
    const indexed = list.map((check, index) => ({ check, index }));
    const phases = [indexed.filter(({ check }) => check.model !== true), indexed.filter(({ check }) => check.model === true)];
    for (const [n, phase] of phases.entries()) {
      if (!phase.length) continue;
      const results = [];
      for (const { check, index } of phase) results.push(await runOne(check, index, n === 1 ? { flagged } : {}));
      await reconcile(results, { collectFlagged: n === 0 });
    }

    // Everything open now in this scope, including what a check that threw left open.
    let openQuery = client.from(FINDINGS_TABLE).select('id', { count: 'exact', head: true })
      .eq('status', 'open').eq('installation', s.installation).eq('environment', s.environment);
    openQuery = s.tenant == null ? openQuery.is('tenant', null) : openQuery.eq('tenant', s.tenant);
    const openCount = await openQuery;
    summary.open = openCount?.error || !Number.isFinite(openCount?.count) ? summary.seen : openCount.count;
  } catch (err) {
    await finish(false, err);
    throw err;
  }

  await finish(true);
  return summary;
}

/**
 * The sweep receipt: what ran, what it read, what it found. Counts, labels
 * and short error text only, never the rows a check read.
 */
function buildReceipt({ summary, checkResults, sweepLedger, now, ms, trigger, startedBy, scope, error = null, pageCap }) {
  const sources = buildSources(checkResults, sweepLedger);
  const reviews = {};
  for (const c of checkResults) if (c.review) reviews[c.id] = c.review;
  return {
    version: RECEIPT_VERSION,
    scope,
    generation: summary.generation,
    trigger,
    startedBy: startedBy ?? null,
    startedAt: now.toISOString(),
    ms: Math.max(0, Math.round(ms)),
    sweepError: error ? shortText(error instanceof Error ? error.message : String(error), 300) : null,
    records: sources.reduce((n, s) => n + (s.rows ?? 0), 0),
    truncated: sources.some((s) => s.truncated),
    pageCap: {
      assumed: Number.isFinite(pageCap) && pageCap > 0 ? pageCap : DEFAULT_PAGE_CAP,
      given: Number.isFinite(pageCap) && pageCap > 0,
      note: 'Truncation is judged against this cap. A server max-rows below it is not detectable from a response; check the project setting.',
    },
    sources,
    checks: checkResults.map((c) => Object.fromEntries(Object.entries(c).filter(([k]) => k !== 'review' && k !== 'index'))),
    skipped: summary.checksSkipped,
    reviews,
    findings: {
      new: summary.new,
      reopened: summary.reopened,
      resolved: summary.resolved,
      open: summary.open ?? summary.seen,
      notResolved: summary.notResolved,
    },
  };
}

/** What goes in job_runs.summary: counts, plus the failed check ids as text. */
function sweepSummary(s) {
  return {
    open: s.open ?? s.seen,
    generation: s.generation,
    trigger: s.trigger,
    checks: s.checks,
    checksFailed: s.checksFailed,
    failedChecks: s.failedChecks.join(',') || null,
    checksSkipped: s.checksSkipped.join(',') || null,
    seen: s.seen,
    new: s.new,
    refreshed: s.refreshed,
    reopened: s.reopened,
    resolved: s.resolved,
    notResolved: s.notResolved?.join(',') || null,
    busy: s.busy ? `generation ${s.busy.generation} until ${s.busy.leaseUntil}` : null,
  };
}
