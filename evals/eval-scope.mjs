#!/usr/bin/env node
/**
 * evals/eval-scope.mjs: the Scope and the finding id (core/scope.js). Every
 * pair the 0.2.0 review showed colliding gets two ids; the readable slug is
 * kept; the scope key (also the sweep lease key) is injective; an id parses
 * back into its parts.
 *
 *   node evals/eval-scope.mjs
 */

import { assert, check, done, SCOPE } from './lib/harness.mjs';
import { buildFindingId, entityKey, findingIdV2, idHash, parseFindingId, sameScope, scopeKey } from '../core/scope.js';

const id = (subject, entities = [], { scope = SCOPE, checkId = 'chk', kind = 'k' } = {}) => buildFindingId(scope, checkId, kind, { subject, entities });
const S = (type, sid) => ({ type, id: sid });

await check('finding_ids_are_injective: every lookalike pair from the review gets two ids', () => {
  const pairs = [
    ['space vs underscore', id(S('lead', 'a b')), id(S('lead', 'a_b'))],
    ['two non-ASCII names', id(S('lead', '客户')), id(S('lead', '用户'))],
    ['a dash in the type vs the id', id(S('a-b', 'c')), id(S('a', 'b-c'))],
    ['a plus inside an id', id(S('x', '1'), [S('y', '2')]), id(S('x', '1+y-2'))],
    ['subject swapped with an entity', id(S('x', '1'), [S('y', '2')]), id(S('y', '2'), [S('x', '1')])],
    ['a colon in a kind', buildFindingId(SCOPE, 'chk', 'a:b', { subject: S('t', '1') }), buildFindingId(SCOPE, 'chk', 'a_b', { subject: S('t', '1') })],
    ['tenant null vs "-"', id(S('t', '1'), [], { scope: { installation: 'app', tenant: null, environment: 'production' } }), id(S('t', '1'), [], { scope: { installation: 'app', tenant: '-', environment: 'production' } })],
    ['installation "acme prod" vs "acme_prod"', id(S('t', '1'), [], { scope: { installation: 'acme prod', environment: 'production' } }), id(S('t', '1'), [], { scope: { installation: 'acme_prod', environment: 'production' } })],
  ];
  for (const [label, a, b] of pairs) assert.notEqual(a, b, label);
});

await check('the same problem keeps one id: entity order, a repeated entity, and the subject named again as an entity change nothing', () => {
  const a = id(S('stop', 's1'), [S('stop', 's2'), S('booking', 'b1')]);
  assert.equal(id(S('stop', 's1'), [S('booking', 'b1'), S('stop', 's2'), S('stop', 's2')]), a);
  assert.equal(id(S('stop', 's1'), [S('stop', 's1'), S('booking', 'b1'), S('stop', 's2')]), a);
});

await check('the readable slug is kept in front of the hash, and the id parses back', () => {
  const full = id(S('booking', 'b1'), [], { checkId: 'booking_no_tour', kind: 'no_tour' });
  assert.match(full, /^kit-eval\/-\/development:booking_no_tour:no_tour:booking-b1:[0-9a-f]{16}$/);
  const parts = parseFindingId(full);
  assert.deepEqual({ ...parts, hash: parts.hash.length }, { scopeKey: 'kit-eval/-/development', checkId: 'booking_no_tour', kind: 'no_tour', entityRefs: 'booking-b1', hash: 16 });
  assert.equal(parseFindingId('kit-eval/-/development:booking_no_tour:no_tour:booking-b1'), null, 'a 0.1 id is not a 0.2 id');
});

await check('scope keys are injective and readable: odd characters are percent-encoded, a literal "-" tenant is not the no-tenant marker', () => {
  assert.equal(scopeKey(SCOPE), 'kit-eval/-/development');
  assert.equal(scopeKey({ installation: 'acme prod', tenant: 't/1', environment: 'production' }), 'acme%20prod/t%2F1/production');
  assert.equal(scopeKey({ installation: 'app', tenant: '-', environment: 'production' }), 'app/%2D/production');
  assert.equal(scopeKey({ installation: 'a:b', tenant: '100%', environment: 'preview' }), 'a%3Ab/100%25/preview');
  const keys = ['acme prod', 'acme_prod', 'acme%20prod', 'acme/prod'].map((installation) => scopeKey({ installation, environment: 'production' }));
  assert.equal(new Set(keys).size, 4);
  assert.ok(keys.every((k) => k.split('/').length === 3), 'a "/" inside a part never adds a part');
});

await check('helpers: sameScope, entityKey and idHash', () => {
  assert.equal(sameScope(SCOPE, { ...SCOPE, tenant: '' }), true, 'an empty tenant is no tenant');
  assert.equal(sameScope(SCOPE, { ...SCOPE, tenant: 'x' }), false);
  assert.equal(sameScope(SCOPE, { installation: 'kit-eval', environment: 'staging' }), false, 'an invalid scope is never equal');
  assert.notEqual(entityKey(S('a', 'b c')), entityKey(S('a', 'b_c')));
  assert.equal(idHash('x'), idHash('x'));
  assert.match(idHash(''), /^[0-9a-f]{16}$/);
  assert.notEqual(idHash('客户'), idHash('用户'));
});

await check('finding_id_v2_migration_rule: a 0.1 subject-only id maps exactly; a multi-entity one cannot and returns null', () => {
  const row = { id: 'app/-/production:reply_missing:reply_missing:lead-lead-1', installation: 'app', tenant: null, environment: 'production', check_id: 'reply_missing', kind: 'reply_missing', subject_type: 'lead', subject_id: 'lead-1' };
  assert.equal(findingIdV2(row), buildFindingId({ installation: 'app', tenant: null, environment: 'production' }, 'reply_missing', 'reply_missing', { subject: { type: 'lead', id: 'lead-1' } }));
  assert.equal(findingIdV2({ ...row, id: 'app/-/production:tour_review:capacity:stop-s1+stop-s2', subject_type: 'stop', subject_id: 's1' }), null);
  const v2 = findingIdV2(row);
  assert.equal(findingIdV2({ ...row, id: v2 }), v2, 'an id already in the 0.2 shape is left as it is');
});

done();
