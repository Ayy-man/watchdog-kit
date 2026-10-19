/**
 * evals/lib/fake-postgrest.mjs: a small in-memory stand-in for the
 * supabase-js query builder, for evals that need reads to actually filter.
 *
 * Copied from the reference build, 19 Oct 2026. Changed for kit 0.2.0, each
 * because an eval needed the real behaviour:
 *   - range(a, b) skips the first `a` rows (it used to ignore `a`), so a
 *     check that pages with range reads the page it asked for;
 *   - comparisons (gt, gte, lt, lte, the or() forms, and order) compare two
 *     numbers as numbers and everything else by code unit, one rule for all
 *     of them, so keyset paging (`order('id')` then `gt('id', last)`) agrees
 *     with itself and generation 10 is newer than generation 9;
 *   - `maxRows` ({ maxRows: n }) caps every read the way PostgREST's
 *     max-rows does, so a server cap below the page a caller asked for can
 *     be simulated;
 *   - `beforeWrite(table, op, payload)`, when given, runs before each write, so an
 *     eval can land a competing write between a fence read and the write.
 *
 * Tables are arrays of plain rows. Embedded relations are whatever nested
 * objects the row already carries (an order_items row carries `orders: { date }`),
 * and a filter on 'orders.date' reads that nested value. Supported: select, eq,
 * neq, in, gte, lte, gt, lt, is, like, ilike, not(col, 'in'|'is'|'like', v), a
 * simple or('a.eq.x,b.not.is.null,c.lt.<iso>,d.ilike.*x'), order, limit, single,
 * maybeSingle, insert, update, upsert, delete. Every write is recorded on
 * `client.writes`, and `unique` ({ table: 'column' | ['col', ...] }) makes a
 * duplicate insert fail with 23505.
 *
 * As PostgREST does:
 *   - upsert(row, { onConflict: 'a,b', ignoreDuplicates }) updates the row
 *     whose conflict columns match (the primary key `id` when onConflict is
 *     not given) and inserts otherwise; ignoreDuplicates leaves a matching
 *     row untouched and returns nothing for it.
 *   - select('a, b, rel ( x )') returns only those columns. An embed
 *     (`rel ( ... )`, `rel!hint ( ... )`) is passed through as the nested
 *     object the row carries; `alias:col` renames; '*' or no argument returns
 *     the whole row. A column the row does not carry is left out (seed rows
 *     are rarely complete). { count: 'exact' } sets `count`; head: true
 *     returns no rows.
 *   - single() and maybeSingle() refuse more than one row with PGRST116,
 *     as PostgREST's singular response does (and, for a write, nothing is
 *     changed: PostgREST rolls the statement back). maybeSingle() with no
 *     row is { data: null, error: null }; single() with none is left as
 *     before (null data, no error), which evals have long relied on.
 *
 * Nothing here talks to a network or a database.
 */

function read(row, path) {
  // 'payload->>venueId' reads a JSON field, as PostgREST does; '.' walks an embed.
  const parts = String(path).split(/->>|->|\./);
  const value = parts.reduce((v, key) => (v == null ? undefined : v[key]), row);
  return String(path).includes('->>') && value != null ? String(value) : value;
}

/** One ordering for every comparison: numbers as numbers (a numeric string against a number too), else code units. */
function compare(a, b) {
  const na = typeof a === 'number' ? a : (typeof b === 'number' && a !== '' && Number.isFinite(Number(a)) ? Number(a) : null);
  const nb = typeof b === 'number' ? b : (typeof a === 'number' && b !== '' && Number.isFinite(Number(b)) ? Number(b) : null);
  if (na != null && nb != null) return na < nb ? -1 : na > nb ? 1 : 0;
  const x = String(a);
  const y = String(b);
  return x < y ? -1 : x > y ? 1 : 0;
}

function likeToRegex(pattern, flags = '') {
  const source = String(pattern)
    .replace(/[.+?^${}()|[\]\\]/g, '\\$&')
    .replace(/%/g, '.*')
    .replace(/_/g, '.');
  return new RegExp(`^${source}$`, flags);
}

function parseList(value) {
  return String(value).replace(/^\(|\)$/g, '').split(',').map((v) => v.trim().replace(/^"|"$/g, ''));
}

function orClause(expression) {
  const parts = String(expression).split(',').map((part) => part.trim());
  return (row) => parts.some((part) => {
    const [col, op, ...rest] = part.split('.');
    const value = rest.join('.');
    const have = read(row, col);
    if (op === 'eq') return String(have) === value;
    if (op === 'neq') return String(have) !== value;
    if (op === 'not' && rest[0] === 'is' && rest[1] === 'null') return have != null;
    if (op === 'is' && value === 'null') return have == null;
    if (op === 'lt') return have != null && compare(have, value) < 0;
    if (op === 'lte') return have != null && compare(have, value) <= 0;
    if (op === 'gt') return have != null && compare(have, value) > 0;
    if (op === 'gte') return have != null && compare(have, value) >= 0;
    if (op === 'like') return have != null && likeToRegex(value.replace(/\*/g, '%')).test(String(have));
    if (op === 'ilike') return have != null && likeToRegex(value.replace(/\*/g, '%'), 'i').test(String(have));
    throw new Error(`fake-postgrest: unsupported or() clause ${part}`);
  });
}

/** Split a select list on its top-level commas. */
function splitColumns(columns) {
  const out = [];
  let depth = 0;
  let token = '';
  for (const c of String(columns)) {
    if (c === '(') depth++;
    if (c === ')') depth--;
    if (c === ',' && depth === 0) { out.push(token); token = ''; continue; }
    token += c;
  }
  out.push(token);
  return out.map((t) => t.replace(/\s+/g, ' ').trim()).filter(Boolean);
}

/** A projector for a select list, or null for the whole row. */
export function projector(columns) {
  if (columns == null) return null;
  const tokens = splitColumns(columns);
  if (!tokens.length || tokens.includes('*')) return null;
  const fields = tokens.map((token) => {
    // 'col', 'alias:col', 'rel ( ... )', 'alias:rel!hint ( ... )', 'col::text'
    const head = token.replace(/\(.*$/s, '').trim();
    const aliased = /^([A-Za-z_][\w]*)\s*:(?!:)\s*(.+)$/.exec(head);
    const source = aliased ? aliased[2] : head;
    const name = source.replace(/::\w+$/, '').replace(/!.*$/, '').trim();
    return { key: aliased ? aliased[1] : name, name };
  });
  return (row) => {
    if (row == null) return row;
    const out = {};
    for (const { key, name } of fields) {
      if (Object.prototype.hasOwnProperty.call(row, name)) out[key] = row[name];
    }
    return out;
  };
}

export function fakePostgrest(tables = {}, { unique = {}, maxRows = null, beforeWrite = null } = {}) {
  const data = Object.fromEntries(Object.entries(tables).map(([name, rows]) => [name, rows.map((r) => ({ ...r }))]));
  const writes = [];
  let seq = 0;

  function from(table) {
    const predicates = [];
    let op = 'select';
    let payload = null;
    let options = {};
    let orderBy = null;
    let limitTo = null;
    let offset = 0;
    let project = null;
    let countWanted = false;
    let head = false;

    const rows = () => (data[table] ??= []);
    const matching = () => {
      let out = rows().filter((row) => predicates.every((p) => p(row)));
      if (orderBy) {
        const { col, ascending } = orderBy;
        out = [...out].sort((a, b) => compare(read(a, col) ?? '', read(b, col) ?? '') * (ascending ? 1 : -1));
      }
      if (offset) out = out.slice(offset);
      if (limitTo != null) out = out.slice(0, limitTo);
      return out;
    };
    const manyRows = (n) => ({
      data: null,
      error: {
        code: 'PGRST116',
        message: 'JSON object requested, multiple (or no) rows returned',
        details: `The result contains ${n} rows`,
        hint: null,
      },
    });
    const shape = (list, one, total = list.length) => {
      const projected = project ? list.map(project) : list;
      const result = { data: head ? null : (one ? (projected[0] ?? null) : projected), error: null };
      if (countWanted) result.count = total;
      return result;
    };

    async function run(one) {
      if (beforeWrite && op !== 'select') await beforeWrite(table, op, payload);
      // PostgREST's singular response: more than one row is an error, and a
      // write that would touch several is rolled back.
      if (one && (op === 'update' || op === 'delete' || op === 'select')) {
        const n = matching().length;
        if (n > 1) return manyRows(n);
      }
      if (one && (op === 'insert' || op === 'upsert') && Array.isArray(payload) && payload.length > 1) {
        return manyRows(payload.length);
      }
      if (op === 'insert' || op === 'upsert') {
        const given = Array.isArray(payload) ? payload : [payload];
        const conflictCols = op === 'upsert'
          ? String(options?.onConflict ?? 'id').split(',').map((c) => c.trim()).filter(Boolean)
          : null;
        const toInsert = [];
        const toUpdate = [];
        const returned = [];
        for (const r of given) {
          const existing = conflictCols && conflictCols.every((c) => r[c] != null)
            ? rows().find((row) => conflictCols.every((c) => row[c] === r[c]))
            : null;
          if (existing) {
            if (!options?.ignoreDuplicates) { toUpdate.push([existing, r]); returned.push(existing); }
            continue;
          }
          const row = { id: r.id ?? `${table}_${++seq}`, ...r };
          toInsert.push(row);
          returned.push(row);
        }
        // `unique` maps a table to the columns a unique index holds, so a
        // replayed insert fails the way Postgres fails it (23505).
        for (const col of [].concat(unique[table] ?? [])) {
          if (toInsert.some((r) => r[col] != null && rows().some((existing) => existing[col] === r[col]))) {
            return { data: null, error: { code: '23505', message: `duplicate key value violates unique constraint on ${col}` } };
          }
        }
        for (const [existing, patch] of toUpdate) {
          Object.assign(existing, patch, { id: existing.id });
          writes.push({ table, op, row: existing, updated: true });
        }
        rows().push(...toInsert);
        for (const row of toInsert) writes.push({ table, op, row });
        return shape(returned, one);
      }
      if (op === 'update') {
        const hit = matching();
        for (const row of hit) {
          Object.assign(row, payload);
          writes.push({ table, op, id: row.id, patch: payload });
        }
        return shape(hit, one);
      }
      if (op === 'delete') {
        const hit = matching();
        data[table] = rows().filter((row) => !hit.includes(row));
        for (const row of hit) writes.push({ table, op, id: row.id });
        return shape(hit, one);
      }
      const found = matching();
      return shape(op === 'select' && Number.isFinite(maxRows) ? found.slice(0, maxRows) : found, one, found.length);
    }

    const chain = {
      select(columns, opts = {}) {
        project = projector(columns);
        countWanted = Boolean(opts?.count);
        head = Boolean(opts?.head);
        return chain;
      },
      insert(row) { op = 'insert'; payload = row; return chain; },
      upsert(row, opts = {}) { op = 'upsert'; payload = row; options = opts ?? {}; return chain; },
      update(patch) { op = 'update'; payload = patch; return chain; },
      delete() { op = 'delete'; return chain; },
      eq(col, val) { predicates.push((r) => read(r, col) === val); return chain; },
      neq(col, val) { predicates.push((r) => read(r, col) !== val); return chain; },
      in(col, vals) { predicates.push((r) => vals.includes(read(r, col))); return chain; },
      gte(col, val) { predicates.push((r) => read(r, col) != null && compare(read(r, col), val) >= 0); return chain; },
      lte(col, val) { predicates.push((r) => read(r, col) != null && compare(read(r, col), val) <= 0); return chain; },
      gt(col, val) { predicates.push((r) => read(r, col) != null && compare(read(r, col), val) > 0); return chain; },
      lt(col, val) { predicates.push((r) => read(r, col) != null && compare(read(r, col), val) < 0); return chain; },
      is(col, val) { predicates.push((r) => (val === null ? read(r, col) == null : read(r, col) === val)); return chain; },
      like(col, pattern) { const re = likeToRegex(pattern); predicates.push((r) => re.test(String(read(r, col) ?? ''))); return chain; },
      ilike(col, pattern) {
        const re = likeToRegex(String(pattern).replace(/\\(.)/g, '$1'), 'i');
        predicates.push((r) => re.test(String(read(r, col) ?? '')));
        return chain;
      },
      not(col, operator, value) {
        if (operator === 'in') { const list = parseList(value); predicates.push((r) => !list.includes(String(read(r, col)))); }
        else if (operator === 'is' && value === null) predicates.push((r) => read(r, col) != null);
        else if (operator === 'like') { const re = likeToRegex(value); predicates.push((r) => !re.test(String(read(r, col) ?? ''))); }
        else throw new Error(`fake-postgrest: unsupported not(${operator})`);
        return chain;
      },
      filter(col, op, val) {
        if (op === 'eq') predicates.push((r) => String(read(r, col) ?? '') === String(val));
        else throw new Error(`fake-postgrest: unsupported filter(${op})`);
        return chain;
      },
      or(expression) { predicates.push(orClause(expression)); return chain; },
      order(col, { ascending = true } = {}) { orderBy = { col, ascending }; return chain; },
      limit(n) { limitTo = n; return chain; },
      range(a, b) { offset = a; limitTo = b - a + 1; return chain; },
      async single() { return run(true); },
      async maybeSingle() { return run(true); },
      then(resolve, reject) { return run(false).then(resolve, reject); },
    };
    return chain;
  }

  return { from, data, writes };
}
