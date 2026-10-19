-- core/sql/0007_finding_id_v2.sql
--
-- TEMPLATE. Not executed by the kit, and not safe to run unedited: the
-- mapping table it reads is filled by a one-off script the client writes
-- with core/scope.js. Read the whole file before vendoring it.
--
-- Why: kit 0.2.0 makes finding ids injective. A 0.1 id was
--   <scopeKey>:<check>:<kind>:<entity slug>
-- where the slug turned every odd character into `_`, so `a b` and `a_b`,
-- two non-ASCII names, a `-` or `+` inside an id, a subject swapped with an
-- entity, tenant null and tenant `-`, all shared one row. A 0.2 id is
--   <scopeKey>:<check>:<kind>:<entity slug>:<hash>
-- where <hash> is 16 hex characters of FNV-1a 64 over the raw tuple
-- (core/scope.js findingIdTuple), and the scope key percent-encodes any
-- character outside [A-Za-z0-9_.@#+~-] (a literal tenant `-` is `%2D`).
-- Until the rows are rewritten, a 0.2 sweep does not recognise a 0.1 row:
-- it files every open problem again under its new id, and the 0.1 rows can
-- be resolved (as `recovered`) by checks that examine their subject, which
-- would lose their verdicts and read as a recovery that did not happen.
--
-- The rewrite rule, per row:
--   1. A row whose 0.1 id ends in `:<entityRef(subject)>` (it named only its
--      subject) maps exactly: new id = buildFindingId(scope from the row's
--      columns, check_id, kind, { subject: { type: subject_type, id:
--      subject_id } }). core/scope.js findingIdV2(row) returns it.
--   2. A row whose 0.1 id named other entities too (a model finding citing
--      several items) cannot be rebuilt: the row does not store its
--      entities, and the 0.1 slug is lossy. findingIdV2(row) returns null.
--      Such a row is resolved here as superseded, with a note; if the
--      problem is still there, the next sweep raises it under its new id
--      and its verdict must be given again.
--   3. A watchdog_sweeps row whose scope has a character the 0.2 key encodes
--      differently gets its new scope_key, KEEPING its generation. Do not
--      delete and recreate it: every finding's last_generation would then be
--      newer than the restarted generation and every 0.2 write would be
--      refused as stale.
--   4. Rows whose last_evidence_at equals last_seen_at almost certainly had
--      their evidence time defaulted to a sweep's now (0.1 did not record
--      which), so they get meta.evidence_defaulted = true and are never
--      resolved by an interval (core/DECISIONS.md).
--
-- Steps:
--   a. Stop the sweep (disable its cron, or hold the lease: set
--      watchdog_sweeps.lease_until well into the future for each scope).
--   b. Create the mapping table below and fill it with a one-off script:
--      for every watchdog_findings row, insert (id, findingIdV2(row)); for
--      every watchdog_sweeps row, insert (scope_key, scopeKey(row's scope))
--      into the sweep map.
--   c. Run the transaction below.
--   d. Deploy kit 0.2.0, release the lease, re-enable the cron.

create table if not exists watchdog_finding_id_map (
  old_id  text primary key,
  new_id  text                    -- null: cannot be rebuilt (rule 2)
);

create table if not exists watchdog_sweep_key_map (
  old_key text primary key,
  new_key text not null
);

begin;

-- Rule 1: rewrite ids that map exactly, and every reference to them.
update watchdog_findings f
   set id = m.new_id
  from watchdog_finding_id_map m
 where f.id = m.old_id and m.new_id is not null and m.new_id <> m.old_id;

update watchdog_silences s
   set finding_id = m.new_id
  from watchdog_finding_id_map m
 where s.finding_id = m.old_id and m.new_id is not null;

-- alert_sends exists only once 0006 is applied; drop this statement if not.
update alert_sends a
   set finding_id = m.new_id
  from watchdog_finding_id_map m
 where a.finding_id = m.old_id and m.new_id is not null;

-- Rule 2: rows that cannot be rebuilt are resolved as superseded.
update watchdog_findings f
   set status = 'resolved',
       resolved_at = now(),
       meta = f.meta || jsonb_build_object(
         'resolved_reason', 'left_scope',
         'resolved_note', 'finding id v2 migration: entities not stored on the row, so the id could not be rebuilt; superseded by the next sweep')
  from watchdog_finding_id_map m
 where f.id = m.old_id and m.new_id is null and f.status = 'open';

-- Rule 3: new sweep keys, generation kept.
update watchdog_sweeps w
   set scope_key = k.new_key
  from watchdog_sweep_key_map k
 where w.scope_key = k.old_key and k.new_key <> k.old_key;

-- Rule 4: mark evidence times that were the sweep's own clock.
update watchdog_findings
   set meta = meta || '{"evidence_defaulted": true}'::jsonb
 where last_evidence_at = last_seen_at
   and not (meta ? 'evidence_defaulted');

commit;

-- Afterwards, every id should parse as a 0.2 id (five parts, 16 hex at the end):
--   select id from watchdog_findings where id !~ ':[0-9a-f]{16}$';
-- returns only rows resolved under rule 2. Then drop the two map tables.
