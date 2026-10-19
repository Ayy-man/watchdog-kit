/**
 * core/coverage.js: what a check actually read, as the structured Coverage
 * record in contracts/finding.d.ts, plus the sweep receipt helpers.
 *
 * Why: in the reference build a check resolved its open findings whenever it "ran
 * cleanly", which let a check that read a short page, or never looked at a
 * subject, resolve a real problem. Here a check resolves nothing unless its
 * Coverage says it read every page to the end (`complete`), positively
 * examined the subject, and read fresher data than the finding's last
 * evidence. Coverage is collected two ways, both optional for the check:
 *
 *   1. Automatically. The counting client (`countingClient`) counts the
 *      distinct rows each select returned, per table, and notices when a page
 *      came back at the PostgREST cap (1000 rows by default) or at the limit
 *      the check asked for: that page is `truncated` unless an explicit
 *      `count` proves the table held no more. A truncated source makes the
 *      coverage incomplete.
 *   2. In the check's own words, through the `coverage` recorder its run()
 *      receives: what it examined (subjects or time intervals), how fresh the
 *      data was, the policy version it judged against, extra sources that are
 *      not table rows, idle / skipped / partial, and why a dropped finding
 *      resolved.
 *
 * A check may also return its own Coverage object; the recorder's record is
 * the fallback. A check that returns neither resolves nothing. A returned
 * object can only narrow what the recorder knows (0.2.0): it can never make a
 * record complete that the ledger or the recorder marked incomplete, partial,
 * truncated or failed, never move freshAsOf later, and never change scope
 * unnoticed (core/run.js refuses coverage for another scope).
 *
 * A read that came back with an error (or rejected) is recorded as a failed
 * source and makes the coverage incomplete, because a check that treats a
 * null `data` as an empty table would otherwise "examine" everything and
 * resolve every finding.
 */

import { normaliseScope } from './scope.js';

/**
 * PostgREST's default max-rows; a page this long may be a cut, not the end.
 * Pass the project's real max-rows as `pageCap`: a server cap BELOW the one
 * given here cannot be detected from a response (a 500-row page under a
 * 1000 cap reads as the whole table), so the receipt records the cap the
 * sweep assumed (`receipt.pageCap`) for a human to check against the project.
 */
export const DEFAULT_PAGE_CAP = 1000;
const WRITE_METHODS = new Set(['insert', 'upsert', 'update', 'delete']);
const TEXT_CHARS = 300;

export function shortText(value, max = TEXT_CHARS) {
  if (value == null) return null;
  const s = String(value).replace(/\s+/g, ' ').trim();
  return s.length > max ? `${s.slice(0, max - 1)}…` : s;
}

/** A row's identity for distinct counting; rows with none count once each. */
function rowKey(row, fallback) {
  if (row && typeof row === 'object') {
    for (const k of ['id', 'key']) if (row[k] != null) return String(row[k]);
  }
  return `#${fallback}`;
}

/**
 * A ledger of rows read: table to a Set of row keys, whether a page of that
 * table came back truncated, and whether a read of it failed. One per check,
 * plus the sweep-wide union.
 *
 * Truncation follows a range sequence (0.2.0): a page cut at its limit marks
 * the table truncated and remembers where the next page must start; a later
 * `range(start, ...)` page for the same table that starts exactly there and
 * comes back shorter than its range ends the sequence and clears the flag. A
 * page exactly as long as its range stays truncated, because only a short (or
 * empty) page proves the end. The check must keep its filters and order the
 * same across pages; the ledger cannot see a filter change.
 */
export function createLedger() {
  let anon = 0;
  const tables = new Map();
  const truncated = new Set();
  const nextStart = new Map();
  const failed = new Map();
  const entry = (table) => tables.get(table) ?? tables.set(table, new Set()).get(table);
  return {
    add(table, data, { truncated: cut = false, rangeFrom = null } = {}) {
      const rows = Array.isArray(data) ? data : (data && typeof data === 'object' ? [data] : []);
      const set = entry(table);
      for (const row of rows) set.add(rowKey(row, (anon += 1)));
      if (cut) {
        truncated.add(table);
        nextStart.set(table, (Number.isFinite(rangeFrom) ? rangeFrom : 0) + rows.length);
      } else if (Number.isFinite(rangeFrom) && truncated.has(table) && nextStart.get(table) === rangeFrom) {
        truncated.delete(table);
        nextStart.delete(table);
      }
    },
    /** A read of `table` returned an error or rejected: the table was not read, whatever the check did next. */
    fail(table, message) {
      entry(table);
      if (!failed.has(table)) failed.set(table, shortText(message, 160) ?? 'error');
    },
    counts() {
      return Object.fromEntries([...tables].map(([t, set]) => [t, set.size]));
    },
    keys(table) {
      return tables.get(table) ?? new Set();
    },
    tables() {
      return [...tables.keys()];
    },
    isTruncated(table) {
      return truncated.has(table);
    },
    isFailed(table) {
      return failed.has(table);
    },
    /** One source row per table read, in the Coverage shape; `failed` carries the error text when a read failed. */
    sources() {
      return [...tables].map(([name, set]) => ({
        name, rows: set.size, truncated: truncated.has(name), ...(failed.has(name) ? { failed: failed.get(name) } : {}),
      }));
    },
  };
}

/**
 * Is a page that came back `rows` long a cut rather than the end?
 *
 * Truncated when the page is as long as the cap, or as long as the limit the
 * check asked for (more than one row), and no exact count says the table
 * held exactly that many. `limit(1)` is left alone: that is "the latest
 * row", a complete read of what was asked for.
 *
 * `count` must be an exact count (`select(cols, { count: 'exact' })`); the
 * counting client passes nothing else, because a `planned` or `estimated`
 * count is a guess and a guess below the page would hide a cut.
 */
export function pageTruncated({ rows, cap = DEFAULT_PAGE_CAP, limit = null, count = null, head = false }) {
  if (head || !Number.isFinite(rows) || rows <= 0) return false;
  if (Number.isFinite(count) && count != null) return count > rows;
  const ceiling = limit != null && limit > 1 ? Math.min(limit, cap) : cap;
  return rows >= ceiling;
}

/**
 * Wrap a query builder so the rows it resolves to are added to `ledgers`,
 * with the page's truncation worked out from the limit the builder was given
 * and the exact count the response carried. Every method call is passed to
 * the real builder (bound to it) and an object it returns is wrapped again.
 * A builder that was told to write records nothing. A read that resolves
 * with an error, or rejects, is recorded as a failed read of the table.
 */
function wrapBuilder(target, table, ledgers, cap, state = { write: false, limit: null, rangeFrom: null, head: false, single: false, countExact: false }) {
  if (target == null || (typeof target !== 'object' && typeof target !== 'function')) return target;
  const fail = (message) => { if (!state.write) for (const l of ledgers) l.fail(table, message); };
  const record = (res) => {
    if (state.write) return res;
    if (!res || res.error) { fail(res?.error?.message ?? res?.error?.code ?? 'no response'); return res; }
    if (res.data == null && !state.head && !state.single) { fail('no data'); return res; }
    const rows = Array.isArray(res.data) ? res.data.length : (res.data == null ? 0 : 1);
    const count = state.countExact && Number.isFinite(res.count) ? res.count : null;
    const cut = !state.single && pageTruncated({ rows, cap, limit: state.limit, count, head: state.head });
    for (const l of ledgers) l.add(table, res.data, { truncated: cut, rangeFrom: state.rangeFrom });
    return res;
  };
  const rejected = (err) => { fail(err?.message ?? String(err)); throw err; };
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== 'function') return value;
      if (prop === 'then') {
        return (onFulfilled, onRejected) => value.call(obj, (res) => {
          record(res);
          return onFulfilled ? onFulfilled(res) : res;
        }, (err) => {
          fail(err?.message ?? String(err));
          if (onRejected) return onRejected(err);
          throw err;
        });
      }
      return (...args) => {
        if (WRITE_METHODS.has(prop)) state.write = true;
        if (prop === 'limit' && Number.isFinite(Number(args[0]))) state.limit = Number(args[0]);
        if (prop === 'range' && Number.isFinite(Number(args[0])) && Number.isFinite(Number(args[1]))) {
          state.rangeFrom = Number(args[0]);
          state.limit = Number(args[1]) - Number(args[0]) + 1;
        }
        if (prop === 'select' && args[1] && typeof args[1] === 'object') {
          if (args[1].head) state.head = true;
          // Only an exact count proves where a table ends (core/DECISIONS.md).
          state.countExact = args[1].count === 'exact';
        }
        if (prop === 'single' || prop === 'maybeSingle') state.single = true;
        const out = value.apply(obj, args);
        // A real promise (a fake's `single`, say) is recorded as it settles;
        // a builder, which is only thenable, is wrapped to keep counting.
        if (out instanceof Promise) return out.then(record, rejected);
        return out && (typeof out === 'object' || typeof out === 'function') ? wrapBuilder(out, table, ledgers, cap, state) : out;
      };
    },
  });
}

/**
 * A client whose `from(table)` reads are counted into `ledgers`. Everything
 * else on the client is passed through untouched; the read-only wrapper
 * (core/readonly-client.js) is what refuses writes.
 *
 * @param {object} client
 * @param {Array<ReturnType<typeof createLedger>>} ledgers
 * @param {{ pageCap?: number }} [opts]  the source's max-rows (DEFAULT_PAGE_CAP)
 */
export function countingClient(client, ledgers, { pageCap = DEFAULT_PAGE_CAP } = {}) {
  if (!client || typeof client.from !== 'function') return client;
  return new Proxy(client, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (prop === 'from' && typeof value === 'function') {
        return (table, ...rest) => wrapBuilder(value.call(obj, table, ...rest), String(table), ledgers, pageCap);
      }
      return typeof value === 'function' ? value.bind(obj) : value;
    },
  });
}

function toDate(value) {
  const d = value instanceof Date ? value : new Date(value);
  return Number.isFinite(d.getTime()) ? d : null;
}

/**
 * The `coverage` recorder a check's run() receives, and the Coverage record
 * it produces when the check does not return one of its own.
 *
 *   coverage.examined({ type: 'booking', id: 'b1' })
 *   coverage.examinedRows('booking', rows)          // each row's id
 *   coverage.examinedInterval(from, to)             // a time window it read fully
 *   coverage.freshAsOf(date)                        // newest observedAt it read
 *   coverage.freshAsOf(date, { source: 'provider' })  // per source: the record takes the oldest
 *   coverage.policyVersion('obligations@3')
 *   coverage.source('provider-api', 12, { truncated: false })
 *   coverage.covered('186 bookings', { scope: 'next 72 hours' })  // receipt words
 *   coverage.idle('outside working hours')          // nothing to do, by design
 *   coverage.skipped('switched off')                // its job was not done
 *   coverage.partial('could not reach the model for 1 of 4', [subjectRef])
 *   coverage.incomplete('why')                      // sets complete false
 *   coverage.resolveReason((row) => 'left_scope')   // why a dropped finding resolved
 *   coverage.review({ ... })                        // model review figures
 *
 * `finish({ ledger, now })` folds in the counting ledger: its sources are
 * added, a truncated or failed table makes the record incomplete, and
 * freshAsOf defaults to `now` (the read happened then).
 *
 * Freshness across sources (0.2.0): `freshAsOf(at)` with no source keeps the
 * newest such observation, as before. `freshAsOf(at, { source })` keeps the
 * newest observation per named source, and the record's freshAsOf is the
 * OLDEST of those (and of the unnamed one, if any). A check that read a live
 * table and a cache six hours old is only as fresh as the cache; taking the
 * newest would let the stale source pass the fresher-than-evidence test.
 * The receipt lists each source's freshness (`freshness`).
 */
export function createCoverage({ scope, policyVersion = 'unversioned', now = new Date() } = {}) {
  const s = normaliseScope(scope);
  const out = {
    examined: [], sources: [], freshAsOf: null, freshBySource: new Map(), policyVersion, complete: true, incompleteWhy: [],
    covered: [], idle: null, skipped: null, partial: [], review: null, resolveReason: null,
  };
  const recorder = {
    examined(...refs) {
      for (const r of refs.flat()) if (r && typeof r === 'object' && r.type != null && r.id != null) out.examined.push({ type: String(r.type), id: String(r.id) });
      return recorder;
    },
    examinedRows(type, rows, idKey = 'id') {
      for (const row of Array.isArray(rows) ? rows : []) if (row && row[idKey] != null) out.examined.push({ type: String(type), id: String(row[idKey]) });
      return recorder;
    },
    examinedInterval(from, to) {
      const a = toDate(from);
      const b = toDate(to);
      if (a && b && a <= b) out.examined.push({ from: a, to: b });
      return recorder;
    },
    freshAsOf(at, { source = null } = {}) {
      const d = toDate(at);
      if (!d) return recorder;
      if (source != null && String(source).trim()) {
        const name = String(source).trim();
        const prior = out.freshBySource.get(name);
        if (!prior || d > prior) out.freshBySource.set(name, d);
      } else if (!out.freshAsOf || d > out.freshAsOf) {
        out.freshAsOf = d;
      }
      return recorder;
    },
    policyVersion(v) { if (v != null && String(v).trim()) out.policyVersion = String(v).trim(); return recorder; },
    source(name, rows, { truncated = false, scope: words = null } = {}) {
      out.sources.push({ name: String(name), rows: Number(rows) || 0, truncated: Boolean(truncated), scope: shortText(words, 120) });
      if (truncated) { out.complete = false; out.incompleteWhy.push(`${name} truncated`); }
      return recorder;
    },
    covered(label, { n = null, scope: words = null } = {}) {
      const text = shortText(label, 120);
      if (text) out.covered.push({ label: text, n: Number.isFinite(Number(n)) && n != null ? Number(n) : null, scope: shortText(words, 120) });
      return recorder;
    },
    idle(reason) { out.idle = shortText(reason, 160); return recorder; },
    skipped(reason) { out.skipped = shortText(reason, 160); out.complete = false; out.incompleteWhy.push('skipped'); return recorder; },
    partial(reason, skipped = []) {
      const t = shortText(reason);
      if (t) out.partial.push({ reason: t, skipped: Array.isArray(skipped) ? skipped.slice(0, 100) : [] });
      out.complete = false;
      out.incompleteWhy.push('partial');
      return recorder;
    },
    incomplete(reason) { out.complete = false; out.incompleteWhy.push(shortText(reason, 160) ?? 'incomplete'); return recorder; },
    resolveReason(fn) { out.resolveReason = typeof fn === 'function' ? fn : null; return recorder; },
    review(stats) {
      try { out.review = stats && typeof stats === 'object' ? JSON.parse(JSON.stringify(stats)) : null; } catch { out.review = null; }
      return recorder;
    },
    /** The Coverage record (finding.d.ts) plus the receipt words. */
    finish({ ledger = null } = {}) {
      const sources = [...out.sources];
      let complete = out.complete;
      const why = [...out.incompleteWhy];
      if (ledger) {
        for (const src of ledger.sources()) {
          sources.push(src);
          if (src.failed) { complete = false; why.push(`${src.name} read failed`); }
          if (src.truncated) { complete = false; why.push(`${src.name} page truncated`); }
        }
      }
      const freshness = Object.fromEntries([...out.freshBySource].map(([k, d]) => [k, d.toISOString()]));
      const candidates = [...out.freshBySource.values(), ...(out.freshAsOf ? [out.freshAsOf] : [])];
      const freshAsOf = candidates.length ? new Date(Math.min(...candidates.map((d) => d.getTime()))) : now;
      return {
        scope: s,
        examined: out.examined.map((e) => ('from' in e ? { from: e.from, to: e.to } : { ...e })),
        complete,
        incompleteWhy: why,
        freshAsOf,
        freshness,
        policyVersion: out.policyVersion,
        sources,
        words: { covered: out.covered, idle: out.idle, skipped: out.skipped, partial: out.partial, review: out.review },
        resolveReason: out.resolveReason,
      };
    },
    /** What was collected so far, for the receipt. */
    collected: out,
  };
  return recorder;
}

/**
 * Coerce whatever a check returned as `coverage` into a Coverage record with
 * every field present, or null when it is unusable (then the check resolves
 * nothing). The returned record supplies what the recorder does not know
 * (examined subjects, policy version, extra sources), but it can only narrow
 * the recorder's record, never widen it:
 *
 *   - complete is the recorder's AND the returned value AND no truncated or
 *     failed source in either list, so `complete: true` cannot override an
 *     `incomplete()`, `partial()`, `skipped()` or a truncated page;
 *   - sources and incompleteWhy are the union of both;
 *   - freshAsOf is the older of the two;
 *   - scope is the returned one when given, and core/run.js refuses it when
 *     it is not the sweep's scope.
 */
export function normaliseCoverage(given, fallback) {
  if (given == null) return fallback ?? null;
  if (typeof given !== 'object') return null;
  const base = fallback ?? {};
  const examined = Array.isArray(given.examined) ? given.examined : base.examined ?? [];
  const givenSources = (Array.isArray(given.sources) ? given.sources : [])
    .map((x) => ({ name: String(x?.name ?? 'unknown'), rows: Number(x?.rows) || 0, truncated: Boolean(x?.truncated), ...(x?.failed ? { failed: shortText(x.failed, 160) } : {}) }));
  const sources = [...(base.sources ?? []), ...givenSources];
  const givenTruncated = givenSources.filter((x) => x.truncated).map((x) => `${x.name} truncated`);
  const givenFailed = givenSources.filter((x) => x.failed).map((x) => `${x.name} read failed`);
  const givenFresh = toDate(given.freshAsOf);
  const baseFresh = base.freshAsOf instanceof Date ? base.freshAsOf : toDate(base.freshAsOf);
  const freshAsOf = givenFresh && baseFresh ? (givenFresh < baseFresh ? givenFresh : baseFresh) : (givenFresh ?? baseFresh ?? null);
  if (!freshAsOf) return null;
  const baseComplete = base.complete !== false;
  const givenComplete = given.complete !== false;
  const why = [
    ...(base.incompleteWhy ?? []),
    ...(!givenComplete ? ['the check returned complete: false'] : []),
    ...givenTruncated,
    ...givenFailed,
  ];
  return {
    scope: given.scope ? normaliseScope(given.scope) : base.scope,
    examined: examined
      .map((e) => (e && 'from' in e ? { from: toDate(e.from), to: toDate(e.to) } : (e && e.type != null && e.id != null ? { type: String(e.type), id: String(e.id) } : null)))
      .filter((e) => e && (!('from' in e) || (e.from && e.to))),
    complete: baseComplete && givenComplete && !sources.some((x) => x.truncated || x.failed),
    incompleteWhy: [...new Set(why)],
    freshAsOf,
    freshness: base.freshness ?? {},
    policyVersion: given.policyVersion != null ? String(given.policyVersion) : base.policyVersion ?? 'unversioned',
    sources,
    words: base.words ?? { covered: [], idle: null, skipped: null, partial: [], review: null },
    resolveReason: base.resolveReason ?? null,
  };
}

/**
 * True when a Coverage record positively examined the subject, or an interval
 * holding `at`. Pass `at` only when it is the finding's real evidence time:
 * core/run.js passes null for a row whose evidence time was defaulted to a
 * sweep's `now`, so an interval can never claim a finding it never saw.
 */
export function coverageExamined(coverage, subject, at = null) {
  const atMs = at instanceof Date ? at.getTime() : Date.parse(at ?? '');
  for (const e of coverage?.examined ?? []) {
    if ('from' in e) {
      if (Number.isFinite(atMs) && e.from.getTime() <= atMs && atMs < e.to.getTime()) return true;
      continue;
    }
    if (e.type === subject?.type && e.id === String(subject?.id)) return true;
  }
  return false;
}

/**
 * The receipt's per-source rows across every check: distinct rows read per
 * table (the sweep ledger), extra sources a check declared, which checks read
 * each, whether any page truncated, and whether a check that read it threw.
 */
export function buildSources(checkResults, sweepLedger) {
  const names = new Set(sweepLedger.tables());
  for (const c of checkResults) for (const s of c.coverage?.sources ?? []) names.add(s.name);
  return [...names].sort().map((name) => {
    const fromLedger = sweepLedger.keys(name).size;
    let n = fromLedger;
    let truncated = sweepLedger.isTruncated(name);
    let readFailed = typeof sweepLedger.isFailed === 'function' && sweepLedger.isFailed(name);
    const by = [];
    const failedBy = [];
    for (const c of checkResults) {
      const declared = (c.coverage?.sources ?? []).filter((s) => s.name === name);
      const readHere = Object.prototype.hasOwnProperty.call(c.reads ?? {}, name);
      if (!declared.length && !readHere) continue;
      for (const d of declared) { if (!fromLedger) n = Math.max(n, d.rows); if (d.truncated) truncated = true; if (d.failed) readFailed = true; }
      by.push(c.id);
      if (!c.ok) failedBy.push(c.id);
    }
    return { name, rows: n, truncated, ...(readFailed ? { readFailed: true } : {}), by, failedBy, ok: failedBy.length === 0 && !readFailed };
  });
}
