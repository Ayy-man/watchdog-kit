#!/usr/bin/env node
/**
 * evals/eval-readonly-client.mjs: the SELECT-only client (core/readonly-client.js).
 * Every write throws WatchdogWriteRefused before the builder runs; reads pass
 * through and are counted; a scoped writer allows only its own tables.
 *
 *   node evals/eval-readonly-client.mjs
 */

import { fakePostgrest } from './lib/fake-postgrest.mjs';
import { assert, check, done } from './lib/harness.mjs';
import { readOnlyClient, scopedWriteClient, WatchdogWriteRefused } from '../core/readonly-client.js';
import { createLedger } from '../core/coverage.js';

const seed = () => fakePostgrest({ bookings: [{ id: 'b1', status: 'confirmed' }, { id: 'b2', status: 'cancelled' }], watchdog_reviews: [] });

await check('insert, update, upsert and delete throw WatchdogWriteRefused and change nothing', async () => {
  const db = seed();
  const read = readOnlyClient(db);
  for (const [method, args] of [['insert', [{ id: 'b3' }]], ['update', [{ status: 'x' }]], ['upsert', [{ id: 'b1', status: 'x' }]], ['delete', []]]) {
    assert.throws(() => read.from('bookings')[method](...args), (err) => err instanceof WatchdogWriteRefused && err.table === 'bookings' && err.method === method && err.code === 'watchdog_write_refused');
  }
  assert.throws(() => read.from('bookings').select('id').eq('id', 'b1').update({ status: 'x' }), WatchdogWriteRefused, 'after a filter too');
  assert.equal(db.writes.length, 0);
  assert.equal(db.data.bookings[0].status, 'confirmed');
});

await check('a write refused inside an async check surfaces as a rejection the sweep turns into check_error', async () => {
  const read = readOnlyClient(seed());
  await assert.rejects(async () => { await read.from('bookings').update({ status: 'x' }).eq('id', 'b1'); }, WatchdogWriteRefused);
});

await check('rpc throws too', () => {
  const db = { ...seed(), rpc: async () => ({ data: 1, error: null }) };
  assert.throws(() => readOnlyClient(db).rpc('do_something'), WatchdogWriteRefused);
});

await check('reads pass through, filter, and are counted into the ledgers', async () => {
  const ledger = createLedger();
  const read = readOnlyClient(seed(), [ledger]);
  const { data } = await read.from('bookings').select('id').eq('status', 'confirmed');
  assert.deepEqual(data, [{ id: 'b1' }]);
  const one = await read.from('bookings').select('id, status').eq('id', 'b2').maybeSingle();
  assert.equal(one.data.status, 'cancelled');
  assert.deepEqual(ledger.counts(), { bookings: 2 });
});

await check('a scoped writer allows its own table and refuses every other', async () => {
  const db = seed();
  const store = scopedWriteClient(db, ['watchdog_reviews']);
  await store.from('watchdog_reviews').upsert({ id: 'r1', packet_hash: 'h' });
  assert.equal(db.data.watchdog_reviews.length, 1);
  assert.throws(() => store.from('bookings').update({ status: 'x' }), WatchdogWriteRefused);
  assert.throws(() => scopedWriteClient(db, []), TypeError);
});

await check('a client with no from() is refused outright', () => {
  assert.throws(() => readOnlyClient({}), TypeError);
});

// ── 0.2.0: the client exposes from() only ────────────────────────────────────

/** A client shaped like a full PostgREST client library: every one of these reaches the database or a provider without from(). */
function fullClient() {
  const db = seed();
  return {
    db,
    client: {
      from: db.from,
      rpc: async () => ({ data: 1, error: null }),
      schema: () => ({ from: db.from }),
      rest: { from: db.from },
      storage: { from: () => ({ upload: async () => ({ data: {}, error: null }), remove: async () => ({}) }) },
      functions: { invoke: async () => ({ data: {}, error: null }) },
      auth: { admin: { deleteUser: async () => ({}) } },
      channel: () => ({ send: async () => 'ok', subscribe: () => ({}) }),
    },
  };
}

for (const [name, attempt] of [
  ['rpc', (read) => read.rpc('do_something')],
  ['schema', (read) => read.schema('other').from('bookings').insert({ id: 'b9' })],
  ['rest', (read) => read.rest.from('bookings').delete()],
  ['storage', (read) => read.storage.from('bucket').remove(['x'])],
  ['functions', (read) => read.functions.invoke('send-email')],
  ['auth', (read) => read.auth.admin.deleteUser('u1')],
  ['channel', (read) => read.channel('room').send({ type: 'broadcast' })],
]) {
  await check(`readonly_client_refuses_${name}: ${name} is not reachable through the read-only client`, async () => {
    const { db, client } = fullClient();
    const read = readOnlyClient(client);
    assert.throws(() => attempt(read), (err) => err instanceof WatchdogWriteRefused && err.method === name, name);
    assert.equal(db.writes.length, 0);
  });
}

await check('readonly_client_exposes_from_only: unknown properties throw, the client is not a thenable, and from() still reads', async () => {
  const { client } = fullClient();
  const read = readOnlyClient(client);
  assert.throws(() => read.anythingElse, WatchdogWriteRefused);
  assert.equal(read.then, undefined, 'awaiting the client itself does not throw');
  assert.equal(await read, read);
  assert.deepEqual(Object.keys(read), []);
  assert.throws(() => { read.from = () => null; }, WatchdogWriteRefused, 'from() cannot be swapped');
  const { data } = await read.from('bookings').select('id').eq('id', 'b1');
  assert.deepEqual(data, [{ id: 'b1' }]);
});

done();
