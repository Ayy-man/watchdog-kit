-- core/sql/0004_watchdog_sweeps.sql
--
-- watchdog_sweeps: one row per scope holding the SweepGeneration
-- (contracts/finding.d.ts, core/sweep-generation.js). A sweep claims the next
-- generation before it runs its first check, by updating the row only where
-- its generation is still the one just read; every reconcile write carries
-- that generation, each batch is preceded by a read of this row, and each
-- write is itself conditional on watchdog_findings.last_generation not being
-- newer (kit 0.2.0), so a sweep that outlived its slot cannot write stale
-- resolutions over a fresher sweep's.
--
-- lease_until is how long the claim is honoured: a later claim while it is in
-- the future is refused (SweepBusyError) unless forced. Not applied by the kit.

create table if not exists watchdog_sweeps (
  scope_key     text primary key,                           -- core/scope.js scopeKey(): installation/tenant/environment, percent-encoded since 0.2.0
  installation  text not null,
  tenant        text,
  environment   text not null check (environment in ('production', 'preview', 'development')),
  generation    bigint not null default 0,                  -- monotonic per scope
  lease_until   timestamptz not null default now(),
  trigger       text check (trigger is null or trigger in ('cron', 'manual')),
  claimed_at    timestamptz,
  released_at   timestamptz
);

alter table watchdog_sweeps enable row level security;

-- RLS placeholder: only the sweep's service role touches this table.
