# Source mapping: {client}

Written by the survey phase from code and migrations only; nothing verified against live data unless a row says so. Every source a door adapter or check reads gets a column map and a semantic contract. The semantic contract is the part a column map cannot carry and the part that breaks checks later.

## Stack

| Thing | What was found | Where |
|---|---|---|
| App root | {./ or the app's directory in a monorepo; other paths are relative to it} | {package.json} |
| Framework and runtime | {Next.js 15 / Express / ...} | {package.json} |
| Tenant key | {tenant_id / org_id / client_id / none} | {migration} |
| Database | {Postgres via Supabase / Prisma / ...} | {migrations dir} |
| Scheduler | {host cron config / task-runner tasks / pg_cron / CI schedule / database job registry behind a tick} and the job count | {file} |
| Existing heartbeat table | {job_receipts / none} | {migration} |
| Outbox or send log | {outbound_send_attempts / comms_log / none} | {migration} |
| Webhook receipt table | {webhook_events / none} | {migration} |
| Settings store | {settings table / config module / flags} | {file} |
| Providers (from dependencies and env variable names only) | {list} | {package.json, .env.example} |
| Time zone the business runs in | {IANA zone, or the per-tenant column that holds it and its default} | {where it is set} |
| Door enumeration method | {TypeScript compiler API / ts-morph / grep fallback} and what that under-counts | |

## Imported history

One row per migration, import or backfill that created rows the checks read. A check excludes imported rows only from the obligations listed as waived, through one helper (`lib/watchdog/migrated.js`); every other obligation still applies to them. If none was found, say what was inspected.

| Table | How to recognise an imported row | Imported on | Waived (met in the old system) | Still owed after the import | Source of the waiver |
|---|---|---|---|---|---|
| {bookings} | {id prefix / a marker column / a notes marker; prefer the most stable} | {date} | {deposit, invoice, confirmation} | {balance, reminders, post-event follow-up} | {operator's words, import script} |

## Existing monitoring

One block per system that already watches the app, including the ones left alone. If none was found, say what was inspected and what remains unknown.

{Systems found, or "none found; inspected {files, dashboards}; unknown: {what remains}".}

### {system}

| Decision or property | Recorded value |
|---|---|
| Category and where it is configured | {uptime probe / error tracker / cron monitor / job receipts / health dashboard / provider status webhook / scheduler run history; file or document} |
| Decision | {read as source / leave alone; reason} |
| Scope | {installation, tenant attribution, environment} |
| Doors and checks it supports | {ids, or none} |
| Claim its records establish | {what a record proves; what it does not} |
| Proof-of-proof | {identity reconciliation for the door it supports, or unknown / unsupported with the reason} |
| Source and access | {table, view or read endpoint; credential variable name only} |
| Timing and completeness | {event time, observation time, retrieval time, freshness limit, pagination, sampling, retention} |
| Read limits and shared failures | {caps, timeout, anything it shares with the app} |
| Existing notifications | {owner, condition covered, scope, route; or unknown} |
| Alert matching | {external incident identity and the exact fields a finding is matched on; or unavailable} |
| Verification | {code inspection / supplied evidence / verified live at {time}} |

A system read as a source also gets a block under Sources. A system left alone contributes no coverage.

## Sources

One block per table, view or external list a door or check reads.

{Sources listed below, one block each, naming the doors and checks that read them.}

### {source name}

Read by: {door ids and check ids}

| Column | Type | Meaning | Notes |
|---|---|---|---|
| {id} | {uuid} | {row id} | |
| {status} | {text} | {enum values and what each means} | {which values are terminal} |
| {provider_event_id} | {text} | {the provider's id; tenant folded in as a prefix?} | |
| {received_at} | {timestamptz} | {observed time or event time?} | |

Semantic contract:

- **Attempts or completions.** {Does a row mean the app tried, or that the thing happened? Which column or join proves completion?}
- **Event time or observed time.** {Which column holds when it happened in the world; which holds when the app saw it; are both present?}
- **Pagination.** {Index order the source is written for; the cap; what a page cut by another order would drop.}
- **Deletion or rewrite on failure.** {Does a refused or failed attempt delete or overwrite the row? If yes, absence is unknown, never "never attempted".}
- **Idempotency.** {Key and scope; whether two tenants can collide; who parses the prefix.}
- **Retention.** {How long rows live; whether a check can see 14 days back.}
- **Scope.** {How a row is attributed to a tenant or installation; rows with no tenant and what they mean.}

## Not mapped

Sources the watchdog will not read and why (out of scope, no egress approval, no proof signal).
