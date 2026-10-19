-- core/sql/0003_job_runs.sql
--
-- job_runs: every scheduled job writes a row when it starts and closes it
-- when it ends (core/job-run.js, core/cron-run.js), so a job that silently
-- stopped running is a missing row a job_missed check can see, not a guess.
-- The watchdog sweep itself is one of these jobs: `watchdog.sweep` for a cron
-- run and `watchdog.sweep.manual` for a hand-started one, with its receipt
-- under summary.receipt.
--
-- A client with an existing job_runs table of this shape keeps it. Not
-- applied by the kit.

create table if not exists job_runs (
  id           uuid primary key default gen_random_uuid(),
  job          text not null,
  started_at   timestamptz not null default now(),
  finished_at  timestamptz,
  ok           boolean,
  summary      jsonb,
  error        text
);

create index if not exists job_runs_job_started
  on job_runs (job, started_at desc);

alter table job_runs enable row level security;

-- RLS placeholder: see 0001_watchdog_findings.sql.
