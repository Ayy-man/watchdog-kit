/**
 * core/readonly-client.js: the SELECT-only client a check runs on.
 *
 * Why: report-only is enforced, not promised (README). A check is handed a
 * client whose every insert, update, upsert, delete and rpc throws
 * `WatchdogWriteRefused` before anything reaches the network, and whose
 * `from()` reads go through the counting client so coverage is recorded.
 * The database role behind it should be SELECT-only as well; this wrapper is
 * the layer that fails loudly in an offline eval.
 *
 * The client exposes `from()` and nothing else (0.2.0). A typical PostgREST
 * client library also carries `schema()`, `rest`, `storage`, `functions`,
 * `auth`, `channel` and `rpc`, and each of them reaches the database or a provider without
 * passing through `from()`: `read.schema('x').from('t').insert(...)` and
 * `read.rest.from('t').delete()` both wrote in the 0.1 wrapper, uncounted.
 * An allow-list cannot be bypassed by a property the wrapper did not know
 * about; any other property throws `WatchdogWriteRefused`.
 *
 * `scopedWriteClient` is the one exception the reference build needed: a model
 * check stores its reviews in a table of its own. It allows writes to the
 * tables named and refuses every other, so "three checks may write, each to
 * one table" is a list in code, not a convention.
 */

import { countingClient } from './coverage.js';

const WRITE_METHODS = new Set(['insert', 'upsert', 'update', 'delete']);

export class WatchdogWriteRefused extends Error {
  constructor(table, method) {
    super(`watchdog: write refused: ${method}${table === '(client)' ? '' : '()'} on ${table} (checks run on a read-only client that exposes from() only)`);
    this.name = 'WatchdogWriteRefused';
    this.code = 'watchdog_write_refused';
    this.table = table;
    this.method = method;
  }
}

/** Wrap one query builder so a write method throws and every other call is passed through, re-wrapped. */
function refuseWrites(target, table, allowed) {
  if (target == null || (typeof target !== 'object' && typeof target !== 'function')) return target;
  return new Proxy(target, {
    get(obj, prop) {
      const value = Reflect.get(obj, prop, obj);
      if (typeof value !== 'function') return value;
      if (prop === 'then') return value.bind(obj);
      if (WRITE_METHODS.has(prop) && !allowed.has(table)) {
        return () => { throw new WatchdogWriteRefused(table, String(prop)); };
      }
      return (...args) => {
        const out = value.apply(obj, args);
        if (out instanceof Promise) return out;
        return out && (typeof out === 'object' || typeof out === 'function') ? refuseWrites(out, table, allowed) : out;
      };
    },
  });
}

/**
 * A client that counts its reads (core/coverage.js) and refuses its writes.
 *
 * @param {object} client            a Supabase-style client (`from(table)` builders, `rpc`)
 * @param {Array<object>} [ledgers]  counting ledgers the reads land in
 * @param {{ pageCap?: number, allowWrites?: string[] }} [opts]
 *   allowWrites: tables a scoped writer may touch (scopedWriteClient uses it)
 */
export function readOnlyClient(client, ledgers = [], { pageCap, allowWrites = [] } = {}) {
  if (!client || typeof client.from !== 'function') throw new TypeError('readOnlyClient needs a client with from()');
  const allowed = new Set(allowWrites.map(String));
  const counted = countingClient(client, ledgers, pageCap ? { pageCap } : {});
  const wrapper = new Proxy(Object.create(null), {
    get(_obj, prop) {
      if (prop === 'from') {
        return (table, ...rest) => refuseWrites(counted.from(table, ...rest), String(table), allowed);
      }
      // Not a thenable, and nothing for inspection to find: `await read` or a
      // console.log of it must not throw.
      if (typeof prop === 'symbol' || prop === 'then' || prop === 'toJSON') return undefined;
      throw new WatchdogWriteRefused('(client)', String(prop));
    },
    set(_obj, prop) { throw new WatchdogWriteRefused('(client)', `set ${String(prop)}`); },
    has(_obj, prop) { return prop === 'from'; },
    ownKeys() { return []; },
    getOwnPropertyDescriptor() { return undefined; },
  });
  return wrapper;
}

/**
 * A client that may write only to the tables named (a check's own store,
 * such as a reviews table). Reads are counted as on the read-only client.
 */
export function scopedWriteClient(client, tables, ledgers = [], opts = {}) {
  const list = Array.isArray(tables) ? tables : [tables];
  if (!list.length) throw new TypeError('scopedWriteClient needs at least one table');
  return readOnlyClient(client, ledgers, { ...opts, allowWrites: list });
}
