-- core/sql/0001_watchdog_findings.sql
--
-- watchdog_findings: one row per problem a check found, keyed on
-- `<scope>:<check>:<kind>:<entity refs>:<hash>` (core/scope.js; the hash of
-- the raw tuple since kit 0.2.0, see 0007_finding_id_v2.sql) so a problem
-- that stays open stays one row however many sweeps see it, and two tenants,
-- two installations or two lookalike ids never share a row.
--
-- Report-only: would_do and would_say record the action and the exact words
-- the watchdog would have used; nothing reads them to act.
--
-- evidence is the EvidenceRef list the finding rests on (contracts/door.d.ts);
-- meta is the sweep's and the verdict route's bookkeeping (verdict_context,
-- resolved_reason, resolved_note, resolved_run_id, resolved_generation,
-- evidence_defaulted). The sweep writes meta only when it must change it.
-- Human verdicts live in their own columns and are never written by the sweep.
--
-- Not applied by the kit. The client vendors it under its own migration
-- tooling and fills in the RLS policy for its roles.

create table if not exists watchdog_findings (
  id               text primary key,
  installation     text not null,
  tenant           text,                                   -- null for a single-tenant app
  environment      text not null check (environment in ('production', 'preview', 'development')),
  check_id         text not null,
  kind             text not null,                          -- from the client's fixed kind enum
  subject_type     text not null,                          -- a scope type the survey phase declared
  subject_id       text not null,
  severity         text not null check (severity in ('high', 'medium', 'low')),
  status           text not null default 'open' check (status in ('open', 'resolved')),
  title            text not null,
  detail           text,
  link             text,
  would_do         text,
  would_say        text,
  evidence         jsonb not null default '[]'::jsonb,     -- EvidenceRef[]
  meta             jsonb not null default '{}'::jsonb,
  first_seen_at    timestamptz not null default now(),
  last_seen_at     timestamptz not null default now(),
  last_evidence_at timestamptz not null default now(),     -- newest observation the finding rests on; resolution must be fresher
  resolved_at      timestamptz,
  reopened_count   integer not null default 0,
  last_run_id      uuid,
  last_generation  bigint,                                 -- the SweepGeneration that last wrote the row; every sweep write is conditional on it not being newer
  verdict          text check (verdict is null or verdict in ('correct', 'false_alarm', 'unsure')),
  verdict_note     text,
  verdict_at       timestamptz,
  verdict_by       text
);

create index if not exists watchdog_findings_scope_status
  on watchdog_findings (installation, environment, tenant, status, check_id, last_seen_at desc);

alter table watchdog_findings enable row level security;

-- RLS placeholder: the client decides who may read and judge findings.
-- Example for an app with an app_role() helper:
--   create policy "owner_admin_all_watchdog_findings" on watchdog_findings
--     for all using (app_role() in ('owner', 'admin'));
-- The sweep runs on a service role that bypasses RLS; the checks run on a
-- SELECT-only role that must have no grant on this table at all.
