/**
 * core/verdicts.js: a verdict belongs to the finding as it was when someone
 * judged it.
 *
 * The verdict route stores, beside the verdict columns,
 * meta.verdict_context = { fingerprint, reopened_count, at }: a hash of the
 * finding's scope, title, severity and evidence as judged, and how many times
 * it had reopened. The sweep carries that context across every rewrite
 * (core/run.js). When the finding has since changed or reopened, the verdict
 * no longer applies: the page shows it as to review again, with the old
 * verdict kept as `stale_verdict`. The verdict columns are never cleared.
 *
 * What does not count as a change: wording that only moves with the clock (a
 * duration in a title, an age in the evidence), the model's run details and
 * the sweep's own bookkeeping. In an EvidenceRef list that means a ref whose
 * `field` is such a key (`age_minutes`, `reviewed_at`, `model_slug`) is left
 * out of the fingerprint.
 *
 * A verdict given before contexts existed has none and stands as it is.
 *
 * Pure and browser-safe: no node:crypto, no I/O.
 */

export const VERDICT_CONTEXT_KEY = 'verdict_context';
export const VERDICTS = new Set(['correct', 'false_alarm', 'unsure']);

/**
 * System findings: the watchdog reporting on itself. They are not claims
 * about the operation, so they are left out of precision.
 */
export const SYSTEM_KINDS = new Set(['check_error', 'model_error', 'model_unavailable', 'rejected', 'packet_error']);

export function isSystemFinding(finding) {
  return SYSTEM_KINDS.has(String(finding?.kind ?? '')) || String(finding?.subject_type ?? '') === 'system';
}

/** Evidence keys that change between sweeps without the problem changing. */
const VOLATILE_KEYS = new Set([
  VERDICT_CONTEXT_KEY, 'resolved_reason', 'resolved_note', 'resolved_run_id', 'resolved_generation', 'ok_notes', 'packet_hash', 'model_slug',
  'reviewed_at', 'confidence', 'corrected_refs', 'latency_ms', 'slug',
]);
/**
 * Field names that only move with the clock, matched as whole words: an
 * `age`, `ago` or `now` word, an `age` with a unit (`age_minutes`,
 * `ageMinutes`, `queue_age_ms`), or a unit counted since or ago
 * (`minutes_since_send`, `hoursAgo`). Case-sensitive and anchored at a word
 * start (0.2.0): the 0.1 pattern had the `i` flag and an unanchored
 * `age(Minutes|Hours|Ms)$`, so `messageMs`, `coverageHours` and `storageMs`
 * were dropped from the fingerprint, and `_since$` dropped `member_since`, a
 * fact.
 */
const VOLATILE_KEY_PATTERN = /^(age|ago|now)$|(^|_)age(_(ms|seconds|minutes|hours|days)|Ms|Seconds|Minutes|Hours|Days)?$|^(ms|seconds|minutes|hours|days)(_since|_ago|Since|Ago)(_|$|[A-Z])|(^|_)(ms|seconds|minutes|hours|days)_ago$/;

/** An EvidenceRef whose `field` only moves with the clock, or is bookkeeping. */
function volatileRef(ref) {
  const field = ref && typeof ref === 'object' && !Array.isArray(ref) && typeof ref.field === 'string' ? ref.field : null;
  return field != null && (VOLATILE_KEYS.has(field) || VOLATILE_KEY_PATTERN.test(field));
}

function stable(value) {
  if (Array.isArray(value)) return value.filter((v) => !volatileRef(v)).map(stable);
  if (value && typeof value === 'object') {
    const out = {};
    for (const key of Object.keys(value).sort()) {
      if (VOLATILE_KEYS.has(key) || VOLATILE_KEY_PATTERN.test(key)) continue;
      out[key] = stable(value[key]);
    }
    return out;
  }
  return value;
}

/** A title with its clock-driven durations taken out. */
function stableTitle(title) {
  return String(title ?? '')
    .replace(/\b\d+\s+(minute|hour|day|week)s?\b/gi, '#')
    .replace(/\bunder a minute\b/gi, '#')
    .replace(/\s+/g, ' ')
    .trim();
}

function fnv1a(text, seed) {
  let h = seed >>> 0;
  for (let i = 0; i < text.length; i += 1) {
    h ^= text.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h.toString(16).padStart(8, '0');
}

/** The finding's scope as the fingerprint sees it: from a Scope object or from row columns. */
function scopeOf(finding) {
  const s = finding?.scope && typeof finding.scope === 'object' ? finding.scope : finding ?? {};
  return { installation: s.installation ?? null, tenant: s.tenant ?? null, environment: s.environment ?? null };
}

/**
 * The evidence as a set: refs sorted by source, id and field, then by the
 * whole ref, so a check that cites the same refs in another order does not
 * turn a verdict stale (0.2.0).
 */
function stableEvidence(evidence) {
  const list = stable(evidence ?? []);
  if (!Array.isArray(list)) return list;
  const key = (r) => (r && typeof r === 'object' ? JSON.stringify([String(r.source ?? ''), String(r.id ?? ''), String(r.field ?? ''), JSON.stringify(r)]) : JSON.stringify(['', '', '', JSON.stringify(r)]));
  return list.map((r) => [key(r), r]).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0)).map(([, r]) => r);
}

/** The finding as judged, reduced to what a verdict is about. Pure. */
export function findingFingerprint(finding) {
  const text = JSON.stringify({
    scope: scopeOf(finding),
    title: stableTitle(finding?.title),
    severity: finding?.severity ?? null,
    evidence: stableEvidence(finding?.evidence),
  });
  return `${fnv1a(text, 0x811c9dc5)}${fnv1a(text, 0x01000193)}`;
}

/** The context the verdict route stores with a verdict. Pure. */
export function verdictContext(finding, now = new Date()) {
  return {
    fingerprint: findingFingerprint(finding),
    reopened_count: Number(finding?.reopened_count) || 0,
    at: now.toISOString(),
  };
}

/** True when a stored verdict was given to a version of the finding that has since changed or reopened. Pure. */
export function isVerdictStale(finding) {
  if (!finding?.verdict) return false;
  const ctx = finding?.meta?.[VERDICT_CONTEXT_KEY];
  if (!ctx || typeof ctx !== 'object') return false;
  if ((Number(ctx.reopened_count) || 0) !== (Number(finding.reopened_count) || 0)) return true;
  return ctx.fingerprint !== findingFingerprint(finding);
}

/** The verdict that applies to the finding now, or null. Pure. */
export function currentVerdict(finding) {
  return finding?.verdict && !isVerdictStale(finding) ? finding.verdict : null;
}

/**
 * The finding as the page should see it: a stale verdict moves to
 * `stale_verdict` and the finding reads as not yet reviewed. Pure.
 */
export function withCurrentVerdict(finding) {
  if (!isVerdictStale(finding)) return finding;
  const { [VERDICT_CONTEXT_KEY]: oldContext, ...meta } = finding.meta ?? {};
  return {
    ...finding,
    meta,
    verdict: null,
    verdict_note: null,
    stale_verdict: {
      verdict: finding.verdict, note: finding.verdict_note ?? null, at: finding.verdict_at ?? null, by: finding.verdict_by ?? null,
      context: oldContext ?? null,
    },
  };
}
