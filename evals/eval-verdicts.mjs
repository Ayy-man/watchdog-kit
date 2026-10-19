#!/usr/bin/env node
/**
 * evals/eval-verdicts.mjs: a verdict belongs to the finding as judged
 * (core/verdicts.js). The fingerprint ignores clock wording and bookkeeping,
 * changes with scope, title, severity or evidence, and a reopen makes the
 * verdict stale.
 *
 *   node evals/eval-verdicts.mjs
 */

import { assert, check, done } from './lib/harness.mjs';
import { currentVerdict, findingFingerprint, isSystemFinding, isVerdictStale, verdictContext, withCurrentVerdict } from '../core/verdicts.js';

const base = {
  installation: 'app', tenant: 'acme', environment: 'production', kind: 'reply_missing', subject_type: 'lead', subject_id: 'l1',
  title: 'Lead l1 waited 3 hours for a reply', severity: 'high', reopened_count: 0,
  evidence: [{ source: 'events', id: 'e1', field: 'replied_at', value: null }],
  meta: {},
};

await check('the fingerprint ignores clock wording and bookkeeping, and changes with what matters', () => {
  const fp = findingFingerprint(base);
  assert.equal(findingFingerprint({ ...base, title: 'Lead l1 waited 5 hours for a reply' }), fp, 'a duration in the title');
  assert.equal(findingFingerprint({ ...base, meta: { resolved_reason: 'recovered', verdict_context: { x: 1 } } }), fp, 'meta is not part of it');
  assert.equal(findingFingerprint({ ...base, evidence: [{ ...base.evidence[0], age_minutes: 50 }] }), fp, 'a volatile evidence key');
  assert.equal(findingFingerprint({ ...base, evidence: [...base.evidence, { source: 'events', id: 'e1', field: 'age_minutes', value: 50 }] }), fp, 'a ref whose field is volatile');
  assert.equal(findingFingerprint({ ...base, evidence: [...base.evidence, { source: 'review', id: 'r1', field: 'reviewed_at', value: '2026-10-18T09:00:00Z' }] }), fp, 'a bookkeeping ref');
  assert.notEqual(findingFingerprint({ ...base, evidence: [...base.evidence, { source: 'events', id: 'e1', field: 'status', value: 'failed' }] }), fp, 'a ref that carries a fact');
  assert.notEqual(findingFingerprint({ ...base, title: 'Lead l1 was never replied to' }), fp);
  assert.notEqual(findingFingerprint({ ...base, severity: 'low' }), fp);
  assert.notEqual(findingFingerprint({ ...base, evidence: [{ source: 'events', id: 'e2', field: 'replied_at', value: null }] }), fp);
  assert.notEqual(findingFingerprint({ ...base, tenant: 'beta' }), fp, 'another tenant is another finding');
  assert.notEqual(findingFingerprint({ ...base, environment: 'preview' }), fp);
  assert.equal(findingFingerprint({ ...base, scope: { installation: 'app', tenant: 'acme', environment: 'production' } }), fp, 'a Scope object reads the same as the columns');
});

await check('verdictContext, staleness on change or reopen, currentVerdict and withCurrentVerdict', () => {
  const ctx = verdictContext(base, new Date('2026-10-18T09:00:00Z'));
  assert.equal(ctx.fingerprint, findingFingerprint(base));
  assert.equal(ctx.reopened_count, 0);
  assert.equal(ctx.at, '2026-10-18T09:00:00.000Z');
  const judged = { ...base, verdict: 'false_alarm', verdict_note: 'expected', verdict_at: ctx.at, verdict_by: 'u1', meta: { verdict_context: ctx } };
  assert.equal(isVerdictStale(judged), false);
  assert.equal(currentVerdict(judged), 'false_alarm');
  assert.equal(withCurrentVerdict(judged), judged, 'unchanged object when current');
  const reopened = { ...judged, reopened_count: 1 };
  assert.equal(isVerdictStale(reopened), true);
  assert.equal(currentVerdict(reopened), null);
  const changed = { ...judged, severity: 'low' };
  assert.equal(isVerdictStale(changed), true);
  const shown = withCurrentVerdict(changed);
  assert.equal(shown.verdict, null);
  assert.equal(shown.verdict_note, null);
  assert.deepEqual(shown.stale_verdict, { verdict: 'false_alarm', note: 'expected', at: ctx.at, by: 'u1', context: ctx });
  assert.deepEqual(shown.meta, {}, 'the old context goes with the old verdict');
  assert.equal(isVerdictStale({ ...judged, meta: {} }), false, 'a verdict with no context stands');
  assert.equal(isVerdictStale({ ...base }), false, 'no verdict, nothing stale');
});

await check('system findings are recognised by kind or subject type', () => {
  assert.equal(isSystemFinding({ kind: 'check_error', subject_type: 'system' }), true);
  assert.equal(isSystemFinding({ kind: 'model_unavailable', subject_type: 'system' }), true);
  assert.equal(isSystemFinding({ kind: 'reply_missing', subject_type: 'system' }), true);
  assert.equal(isSystemFinding({ kind: 'reply_missing', subject_type: 'lead' }), false);
});

await check('volatile_fields_are_whole_words: messageMs, coverageHours, storageMs and member_since are facts; ages and counts since are not', () => {
  const withRef = (field, value) => ({ ...base, evidence: [...base.evidence, { source: 'events', id: 'e1', field, value }] });
  const fp = findingFingerprint(base);
  for (const field of ['messageMs', 'coverageHours', 'storageMs', 'member_since', 'usage', 'Age', 'pageMs']) {
    assert.notEqual(findingFingerprint(withRef(field, 5)), fp, `${field} is a fact and must count`);
  }
  for (const field of ['age', 'age_minutes', 'ageMinutes', 'queue_age_ms', 'minutes_since_send', 'minutesSince', 'hoursAgo', 'hours_ago', 'now']) {
    assert.equal(findingFingerprint(withRef(field, 5)), fp, `${field} only moves with the clock`);
  }
});

await check('fingerprint_ignores_evidence_order: the same refs cited in another order keep the verdict', () => {
  const refs = [
    { source: 'events', id: 'e1', field: 'replied_at', value: null },
    { source: 'events', id: 'e2', field: 'status', value: 'failed' },
    { source: 'leads', id: 'l1', field: 'owner', value: 'u1' },
  ];
  const a = findingFingerprint({ ...base, evidence: refs });
  const b = findingFingerprint({ ...base, evidence: [refs[2], refs[0], refs[1]] });
  assert.equal(a, b);
  const judged = { ...base, evidence: refs, verdict: 'correct', meta: { verdict_context: verdictContext({ ...base, evidence: refs }) } };
  assert.equal(isVerdictStale({ ...judged, evidence: [refs[1], refs[2], refs[0]] }), false);
  assert.notEqual(findingFingerprint({ ...base, evidence: refs.slice(0, 2) }), a, 'a ref removed still changes it');
});

done();
