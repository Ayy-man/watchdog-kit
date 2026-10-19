/**
 * core/review-common.js: what the model reviews share on the run side: which
 * API key they use (their own, never a shared one), how a failed model call
 * is classified, the per-subject retry backoff, the one "model unavailable"
 * finding, the kind enum helpers, and the finding id built in code from the
 * evidence a finding cites, with the Scope in it.
 *
 * Pure apart from reading process.env when no env is passed.
 */

import { createHash } from 'node:crypto';
import { entitiesOfRefs } from './grounding.js';
import { buildFindingId, entityKey, entityRef } from './scope.js';

// ── The key ──────────────────────────────────────────────────────────────────

export const WATCHDOG_KEY_NAME = 'WATCHDOG_OPENROUTER_API_KEY';
export const SHARED_KEY_NAME = 'OPENROUTER_API_KEY';

/**
 * The model API key the watchdog uses: its own, and never the app's shared
 * one. The shared key's credit is what the client's live features run on, so
 * a watchdog that fell back to it could starve them; with no watchdog key
 * the model checks raise model_unavailable and spend nothing. `name` is what
 * the receipt records; the value never leaves here except into the request
 * header.
 *
 * @param {object} [env]
 * @param {{ keyName?: string }} [opts]
 * @returns {{ key: string|null, name: string|null }}
 */
export function watchdogApiKey(env = process.env, { keyName = WATCHDOG_KEY_NAME } = {}) {
  const own = String(env?.[keyName] ?? '').trim();
  if (own) return { key: own, name: keyName };
  return { key: null, name: null };
}

/** The error a model call throws when there is no key at all. */
export function noKeyError({ keyName = WATCHDOG_KEY_NAME, sharedKeyName = SHARED_KEY_NAME } = {}) {
  const err = new Error(`No model API key: ${keyName} is not set (the shared ${sharedKeyName} is never used)`);
  err.code = 'no_key';
  return err;
}

// ── Classifying a failed call ────────────────────────────────────────────────

/**
 * What a failed model call means for the sweep.
 *   global: true  the model cannot be reached for anyone this sweep (no key,
 *                 rejected key, no credit, rate limit, provider down,
 *                 network): stop calling, and do not hold it against a subject.
 *   global: false something about this one call (a timeout, an unreadable
 *                 answer): the subject backs off and the next one is tried.
 */
export function classifyModelError(err) {
  const message = String(err?.message ?? err ?? '');
  const name = String(err?.name ?? '');
  if (err?.code === 'no_key' || /No model API key|No OpenRouter key|Missing .*API_KEY/i.test(message)) {
    return { kind: 'no_key', global: true, label: 'no API key' };
  }
  const status = /request failed: (\d{3})/i.exec(message)?.[1];
  if (status === '401' || status === '403') return { kind: 'auth', global: true, label: `key rejected (${status})` };
  if (status === '402') return { kind: 'credit', global: true, label: 'out of credit (402)' };
  if (status === '429') return { kind: 'rate_limit', global: true, label: 'rate limited (429)' };
  if (status && status.startsWith('5')) return { kind: 'provider', global: true, label: `provider error (${status})` };
  if (name === 'TimeoutError' || name === 'AbortError' || /timed? ?out|aborted/i.test(message)) {
    return { kind: 'timeout', global: false, label: 'timed out' };
  }
  if (/fetch failed|ECONN|ENOTFOUND|EAI_AGAIN|network/i.test(message)) return { kind: 'network', global: true, label: 'network error' };
  return { kind: 'bad_answer', global: false, label: 'unreadable answer' };
}

// ── Backoff ──────────────────────────────────────────────────────────────────

export const RETRY_BASE_MS = 30 * 60_000;
export const RETRY_MAX_MS = 12 * 60 * 60_000;

/** The retry state after one more failure, kept beside the stored review. */
export function nextRetry(prior, { now, error }) {
  const failures = (Number(prior?.failures) || 0) + 1;
  const waitMs = Math.min(RETRY_MAX_MS, RETRY_BASE_MS * 2 ** (failures - 1));
  return {
    failures,
    last_at: now.toISOString(),
    next_at: new Date(now.getTime() + waitMs).toISOString(),
    last_error: String(error ?? '').slice(0, 300),
  };
}

/** True while a subject's retry wait has not passed. */
export function inBackoff(retry, now) {
  const at = Date.parse(retry?.next_at ?? '');
  return Number.isFinite(at) && at > now.getTime();
}

// ── The one "model unavailable" finding ──────────────────────────────────────

export const MODEL_UNAVAILABLE_KIND = 'model_unavailable';

/**
 * One system finding for every review the model could not do this sweep,
 * in the contract's Finding shape (kind, subject, evidence refs).
 * `notReviewed` is [{ id, label, reason }]. High when the model could not be
 * reached for anyone; medium when some reviews went through.
 */
export function modelUnavailableFinding({ what, checkId, notReviewed, reviewed = 0, globalError = null, keyName = null, link = null }) {
  const n = notReviewed.length;
  const severity = globalError || reviewed === 0 ? 'high' : 'medium';
  const reason = globalError ? globalError.label : 'some calls failed';
  const list = notReviewed.slice(0, 12).map((t) => `${t.label} (${t.reason})`).join('; ');
  return {
    kind: MODEL_UNAVAILABLE_KIND,
    subject: { type: 'system', id: checkId ?? what },
    severity,
    title: `${what} could not reach the model: ${n} not reviewed (${reason})`,
    detail:
      `${n} review${n === 1 ? '' : 's'} did not happen this sweep: ${list}${n > 12 ? ` and ${n - 12} more` : ''}. ` +
      `${reviewed} went through. Their last stored findings are still shown. ` +
      (keyName ? `The calls used ${keyName}.` : 'No model API key is set.'),
    link,
    wouldDo: 'Show on the watchdog page and message the developer to check the model API key, credit and model',
    wouldSay: null,
    evidence: [
      { source: 'model', id: checkId ?? what, field: 'reason', value: globalError?.kind ?? 'per_call' },
      { source: 'model', id: checkId ?? what, field: 'reviewed', value: reviewed },
      ...notReviewed.slice(0, 100).map((t) => ({ source: 'review', id: String(t.id), field: 'reason', value: String(t.reason ?? '') })),
    ],
  };
}

// ── Kinds and finding ids ────────────────────────────────────────────────────

/** The JSON schema property for `kind`, from the client's fixed list. */
export function kindProperty(kinds) {
  return {
    type: 'string',
    enum: kinds,
    description:
      'Which kind of problem this is, from the fixed list. Pick the closest; use other only when none fits. ' +
      'Together with the thing your evidence points at, this is how the same problem is recognised next time.',
  };
}

function shortHash(text) {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/**
 * The finding id for a model finding: `${scopeKey}:${checkId}:${kind}:${entityRefs}:${hash}`,
 * where the entities are the things its evidence points at, of the most
 * specific type present. A finding reworded on the next review, or citing a
 * different field of the same item, keeps the same id. Pure.
 *
 * @returns {{ id: string, subject: object, entities: object[] }}
 */
export function findingKey({ scope, checkId, kind, refs, packet, listTypes = {}, typeRank = [], keyTypes = {}, entityOf = null, root }) {
  let entities = entitiesOfRefs(packet, refs, { listTypes, typeRank, keyTypes, entityOf, ...(root ? { root } : {}) });
  if (!entities.length) entities = [root ?? { type: 'packet', id: 'packet' }];
  // Sorted and de-duplicated by exact identity before anything is measured
  // or hashed, so the same finding cited in another order keeps its id even
  // when its entity list is long enough to be cut (0.2.0).
  const unique = new Map();
  for (const e of entities) unique.set(entityKey(e), e);
  entities = [...unique.entries()]
    .sort(([ka, a], [kb, b]) => { const ra = entityRef(a); const rb = entityRef(b); return ra < rb ? -1 : ra > rb ? 1 : (ka < kb ? -1 : ka > kb ? 1 : 0); })
    .map(([, e]) => e);
  const part = entities.map(entityRef).join('+');
  // A very long entity list is cut to its first plus a hash, so the id stays
  // readable. The hash is of the exact identities, not the lossy slug.
  if (part.length > 80) entities = [entities[0], { type: 'more', id: `${entities.length - 1}-${shortHash(JSON.stringify(entities.map(entityKey)))}` }];
  return { id: buildFindingId(scope, checkId, kind, { subject: entities[0], entities }), subject: entities[0], entities };
}
