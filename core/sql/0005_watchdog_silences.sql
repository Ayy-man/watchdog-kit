-- core/sql/0005_watchdog_silences.sql
--
-- watchdog_silences: a person's decision that a finding, or every finding of
-- a kind, should not be shown until a date. Who silenced it and why are
-- required, because a silence with no reason is how a real fault is hidden.
-- A silence never resolves a finding: the row stays open and keeps being
-- refreshed; the page folds it away. Exactly one of finding_id and kind is
-- set.
--
-- The core does not read this table yet (core/DECISIONS.md); the page does.
-- Not applied by the kit.

create table if not exists watchdog_silences (
  id            uuid primary key default gen_random_uuid(),
  installation  text not null,
  tenant        text,
  environment   text not null check (environment in ('production', 'preview', 'development')),
  finding_id    text,                                       -- a watchdog_findings.id
  kind          text,                                       -- or every finding of this kind in the scope
  author        text not null,
  reason        text not null,
  until         timestamptz not null,
  created_at    timestamptz not null default now(),
  check ((finding_id is not null) <> (kind is not null))
);

create index if not exists watchdog_silences_scope_until
  on watchdog_silences (installation, environment, tenant, until desc);

alter table watchdog_silences enable row level security;

-- RLS placeholder: see 0001_watchdog_findings.sql.
