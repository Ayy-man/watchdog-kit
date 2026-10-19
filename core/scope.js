/**
 * core/scope.js: the Scope every finding, review and sweep is keyed on, and
 * the finding id built from it.
 *
 * Why: the two-tenant test showed two tenants (and two installations)
 * can hold the same provider id, so a finding keyed on `<check>:<subject>`
 * alone would merge one tenant's problem into another's row. Every id here
 * starts with the scope key, and the id is always built in code from the
 * subject the evidence points at, never from text a model wrote.
 *
 * Ids are injective (0.2.0). The readable slug is lossy on purpose (any odd
 * character becomes `_`, so a grep or the page can still read it), so it is
 * followed by a short hash of the raw tuple (scope, check id, kind, subject,
 * sorted entities). Two different problems therefore never share a row even
 * when their slugs collide (`a b` and `a_b`, two non-ASCII names, a `-` or a
 * `+` inside an id, a subject swapped with an entity). The scope key itself
 * is percent-encoded, because it is also the `watchdog_sweeps` key and two
 * installations must never share a lease.
 *
 * Pure and browser-safe: no node:crypto, no I/O, so the page can parse ids.
 */

/** The environments the contract allows (door.d.ts Scope.environment). */
export const ENVIRONMENTS = new Set(['production', 'preview', 'development']);

/** Version of the finding id shape; 2 since kit 0.2.0 (core/sql/0007_finding_id_v2.sql). */
export const FINDING_ID_VERSION = 2;

/** Characters kept inside one readable slug segment; anything else becomes `_`. */
const SEGMENT_SAFE = /[^A-Za-z0-9_+\-#.@]/g;
/** Characters kept literally in a scope key segment; everything else is percent-encoded. */
const SCOPE_SAFE = /^[A-Za-z0-9_.@#+~-]$/;
/** The tenant segment for a single-tenant app. A tenant literally named `-` is encoded, so the two never meet. */
const NO_TENANT = '-';

function segment(value, fallback) {
  const s = String(value ?? '').trim().replace(SEGMENT_SAFE, '_');
  return s || fallback;
}

/** Percent-encode every UTF-8 byte of a character outside SCOPE_SAFE, including `%`, `/` and `:`. */
function encodeScopeSegment(value) {
  let out = '';
  for (const ch of String(value)) {
    if (SCOPE_SAFE.test(ch)) { out += ch; continue; }
    for (const byte of new TextEncoder().encode(ch)) out += `%${byte.toString(16).toUpperCase().padStart(2, '0')}`;
  }
  return out;
}

/**
 * FNV-1a, 64 bit, over the UTF-8 bytes, as 16 hex characters. Not a
 * cryptographic hash: the inputs are the client's own ids, not an adversary's,
 * and 64 bits keeps an accidental collision out of reach for any realistic
 * number of findings. Dependency-free so it runs in a browser too.
 */
export function idHash(text) {
  let h = 0xcbf29ce484222325n;
  for (const byte of new TextEncoder().encode(String(text))) {
    h ^= BigInt(byte);
    h = (h * 0x100000001b3n) & 0xffffffffffffffffn;
  }
  return h.toString(16).padStart(16, '0');
}

/**
 * Validate and normalise a Scope. A missing tenant is null (single-tenant
 * app); an unknown environment is an error, because evidence from a preview
 * deployment must never be filed under production.
 *
 * @param {{ installation: string, tenant?: string|null, environment: string }} scope
 * @returns {{ installation: string, tenant: string|null, environment: string }}
 */
export function normaliseScope(scope) {
  const installation = String(scope?.installation ?? '').trim();
  if (!installation) throw new TypeError('scope.installation is required');
  const tenant = scope?.tenant == null || String(scope.tenant).trim() === '' ? null : String(scope.tenant).trim();
  const environment = String(scope?.environment ?? '').trim();
  if (!ENVIRONMENTS.has(environment)) throw new TypeError(`scope.environment "${environment}" is not production, preview or development`);
  return { installation, tenant, environment };
}

/**
 * The scope as one id segment: `installation/tenant/environment`, with `-`
 * for no tenant. Each part is percent-encoded outside `[A-Za-z0-9_.@#+~-]`
 * (so `/` and `:` never appear inside a part), and a tenant that is literally
 * `-` is written `%2D`. The key is therefore injective: `acme prod` and
 * `acme_prod` are two keys, and so are tenant null and tenant `-`.
 */
export function scopeKey(scope) {
  const s = normaliseScope(scope);
  const tenant = s.tenant == null ? NO_TENANT : (s.tenant === NO_TENANT ? '%2D' : encodeScopeSegment(s.tenant));
  return `${encodeScopeSegment(s.installation)}/${tenant}/${s.environment}`;
}

/** `type-id` for one SubjectRef: the readable form, lossy. */
export function entityRef(ref) {
  return `${segment(ref?.type, 'unknown')}-${segment(ref?.id, 'unknown')}`;
}

/** The exact identity of one SubjectRef, for de-duplicating and hashing. Injective. */
export function entityKey(ref) {
  return JSON.stringify([String(ref?.type ?? ''), String(ref?.id ?? '')]);
}

function refsOf(finding) {
  return [finding?.subject, ...(Array.isArray(finding?.entities) ? finding.entities : [])].filter((r) => r && typeof r === 'object');
}

/**
 * The sorted, de-duplicated readable entity refs of a finding: its subject
 * plus any extra entities it names (a model finding passes the things its
 * evidence points at). Never the evidence refs themselves, which change
 * between sweeps without the problem changing. This is the slug only; the id
 * hash is what tells two lookalike slugs apart.
 *
 * @param {{ subject: {type: string, id: string}, entities?: Array<{type: string, id: string}> }} finding
 */
export function entityRefsOf(finding) {
  return [...new Set(refsOf(finding).map(entityRef))].sort().join('+') || 'unknown-unknown';
}

/**
 * The raw tuple a finding id hashes: scope (tenant null kept as null, not
 * `-`), check id, kind, the subject, then the other entities sorted by their
 * exact identity with the subject removed. The subject comes first so a
 * finding about x that names y is not the finding about y that names x.
 */
export function findingIdTuple(scope, checkId, kind, finding) {
  const s = normaliseScope(scope);
  const subject = finding?.subject && typeof finding.subject === 'object' ? [String(finding.subject.type ?? ''), String(finding.subject.id ?? '')] : null;
  const subjectKey = subject ? JSON.stringify(subject) : null;
  const others = new Map();
  for (const e of Array.isArray(finding?.entities) ? finding.entities : []) {
    if (!e || typeof e !== 'object') continue;
    const k = entityKey(e);
    if (k !== subjectKey) others.set(k, JSON.parse(k));
  }
  const entities = [...others.keys()].sort().map((k) => others.get(k));
  return [FINDING_ID_VERSION, [s.installation, s.tenant, s.environment], String(checkId ?? ''), String(kind ?? ''), subject, entities];
}

/**
 * `${scopeKey}:${checkId}:${kind}:${entityRefs}:${hash}` (finding.d.ts).
 * Built here and nowhere else. The first four parts are for people; the hash
 * of `findingIdTuple` is what makes the id injective.
 */
export function buildFindingId(scope, checkId, kind, finding) {
  const hash = idHash(JSON.stringify(findingIdTuple(scope, checkId, kind, finding)));
  return `${scopeKey(scope)}:${segment(checkId, 'check')}:${segment(kind, 'other')}:${entityRefsOf(finding)}:${hash}`;
}

/** The five parts of a finding id, or null when it is not one of ours (a 0.1 id has no hash and returns null). */
export function parseFindingId(id) {
  const m = /^([^:]+):([^:]+):([^:]+):([^:]+):([0-9a-f]{16})$/.exec(String(id ?? ''));
  if (!m) return null;
  return { scopeKey: m[1], checkId: m[2], kind: m[3], entityRefs: m[4], hash: m[5] };
}

/**
 * The 0.2.0 id for a row written under the 0.1 id shape, or null when it
 * cannot be rebuilt. Used by the template migration
 * (core/sql/0007_finding_id_v2.sql); the kit never runs it.
 *
 * A row whose 0.1 id named only its subject (`...:${entityRef(subject)}`)
 * maps exactly: its subject columns are the whole tuple. A row whose id
 * named other entities too (a model finding) cannot, because the row does
 * not store its entities and the 0.1 slug is lossy; the migration resolves
 * those as superseded and the next sweep files the open ones under new ids.
 */
export function findingIdV2(row) {
  if (!row) return null;
  if (parseFindingId(row.id)) return String(row.id);
  const subject = { type: String(row.subject_type ?? ''), id: String(row.subject_id ?? '') };
  if (!subject.type || !subject.id || !String(row.id ?? '').endsWith(`:${entityRef(subject)}`)) return null;
  return buildFindingId({ installation: row.installation, tenant: row.tenant, environment: row.environment }, row.check_id, row.kind, { subject });
}

/** The scope columns a row carries, from a Scope. */
export function scopeColumns(scope) {
  const s = normaliseScope(scope);
  return { installation: s.installation, tenant: s.tenant, environment: s.environment };
}

/** True when a row's scope columns match the Scope. */
export function rowInScope(row, scope) {
  const s = normaliseScope(scope);
  return row?.installation === s.installation && (row?.tenant ?? null) === s.tenant && row?.environment === s.environment;
}

/** True when two Scopes are the same scope. A scope that does not normalise is never equal. */
export function sameScope(a, b) {
  try {
    const x = normaliseScope(a);
    const y = normaliseScope(b);
    return x.installation === y.installation && x.tenant === y.tenant && x.environment === y.environment;
  } catch {
    return false;
  }
}
