-- core/sql/0002_watchdog_reviews.sql
--
-- watchdog_reviews: one row per subject the model has reviewed, keyed on the
-- scope and the subject so a subject is sent to the model again only when its
-- packet changed (packet_hash). raw holds the accepted findings, the rejected
-- ones with the reason, the model's ok_notes and the retry backoff, so a sweep
-- that skips an unchanged subject can replay its findings without a model
-- call. Token counts and the estimated cost are kept per review so the spend
-- can be totalled.
--
-- The model check writes this table and nothing else (core/readonly-client.js
-- scopedWriteClient). Not applied by the kit.

create table if not exists watchdog_reviews (
  installation      text not null,
  tenant            text not null default '',               -- '' for a single-tenant app (part of the key, so not null)
  environment       text not null check (environment in ('production', 'preview', 'development')),
  check_id          text not null,
  subject_type      text not null,
  subject_id        text not null,
  packet_hash       text not null,
  reviewed_at       timestamptz not null default now(),
  next_due_at       timestamptz,
  model_slug        text,
  prompt_tokens     integer,
  completion_tokens integer,
  cost_gbp          numeric,
  findings_count    integer,
  raw               jsonb,
  primary key (installation, tenant, environment, check_id, subject_type, subject_id)
);

create index if not exists watchdog_reviews_reviewed_at
  on watchdog_reviews (installation, environment, reviewed_at desc);

alter table watchdog_reviews enable row level security;

-- RLS placeholder: see 0001_watchdog_findings.sql.
