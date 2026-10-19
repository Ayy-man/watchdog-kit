-- core/sql/0006_alert_sends.sql
--
-- alert_sends: the proof rows of the alert door (skills/watchdog-page,
-- references/alert-routes.md). Every send is claimed before the attempt and
-- proven after it, so a crash between the provider accepting a message and the
-- proof being written leaves a `claimed` row a retry can see, and the retry
-- reuses the same dedupe key instead of sending twice.
--
--   claim:  insert (finding_id, route, generation, attempt) with status 'claimed'
--           and claimed_at; the unique key refuses a second claim of the same
--           attempt, and a claim for an older generation than one already
--           claimed for that finding and route is refused by the sender.
--   prove:  update the same row to 'proven' with provider_id and proven_at, or
--           to 'failed' or 'unknown' with error. 'unknown' means the provider
--           may have accepted it; it is settled by hand, never retried blindly.
--
-- At report-only this table exists and stays empty: nothing in the deployed
-- runtime holds a credential to send with. The sender writes it only under
-- report-and-tell, through the watchdog's writer, never through the reader.
--
-- Not applied by the kit. The client vendors it under its own migration
-- tooling, after 0001 to 0005, and fills in the row-level policy, if its
-- database uses one, for its roles.

create table if not exists alert_sends (
  id            uuid primary key default gen_random_uuid(),
  installation  text not null,
  tenant        text,                                       -- null for a single-tenant app
  environment   text not null check (environment in ('production', 'preview', 'development')),
  finding_id    text not null,                              -- a watchdog_findings.id
  route         text not null,                              -- owner_email | chat_webhook | in_app, from the route list
  generation    bigint not null,                            -- the SweepGeneration whose finding is being alerted
  attempt       integer not null default 1,
  status        text not null default 'claimed'
                  check (status in ('claimed', 'proven', 'failed', 'unknown')),
  provider_id   text,                                       -- the provider's message id, or the notification row id for in_app
  claimed_at    timestamptz not null default now(),
  proven_at     timestamptz,
  error         text,
  unique (finding_id, route, generation, attempt)
);

create index if not exists alert_sends_scope_claimed
  on alert_sends (installation, environment, tenant, route, claimed_at desc);

-- Postgres has no row-level security by default; where the client's database
-- uses it, enable it here and add a policy for the roles that read the page.
-- alter table alert_sends enable row level security;
