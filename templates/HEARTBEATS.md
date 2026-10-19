# Heartbeats: {client}

Written by the heartbeats phase. Every scheduled job has one primary proof source that it ran, every door has a check that reconciles identities, and the role the watchdog reads through can read only what the egress policy approved.

## Wrapper

A heartbeat failure never changes the business response. The handler's response and error pass through untouched, and a failure to write the heartbeat goes to the observation error sink and is never thrown into the handler. {Confirm this holds for each wrapped route, and name the sink.}

## Jobs

One row per scheduled job, including the sweep itself. A job with no proof from any source is finding 0.

| Job | Schedule | Primary proof source | Wrapped or mapped | Max runtime | Work floor | What the source cannot establish |
|---|---|---|---|---|---|---|
| `{job name}` | {cron expression, zone} | {job_runs / existing receipts table / scheduler run history} | {wrapped / mapped} | {minutes} | {summary count expected on a slot with work, or "not computable from data"} | {what a finished run does not prove} |
| `watchdog.sweep` | {every 30 minutes} | `job_runs` | wrapped | {minutes} | not applicable | {a finished sweep does not prove every source was read} |

Sweep route: {path}. Manual trigger: {path}, token-gated, logged as `watchdog.sweep.manual`. Self check: {registered as the first check; the stale alarm is computed by the page from `job_runs` and by the hub from the projection}.

Migrations applied, in order, each applied one file at a time: {0001 findings, 0002 reviews, 0003 job runs, 0004 sweeps, 0005 silences, 0006 alert sends, with the client's file names and how each was applied}.

`0007_finding_id_v2.sql` is an upgrade template for installations on ids older than 0.2 and is never applied on a new build.

## Parity

Schedule parity eval: {script, result}. Contract drift eval: {script, result, how doors were enumerated}. Existing topology test extended instead of a second one: {yes / no, which}.

## Doors

One row per door check. The check reconciles identities, never a count against a count.

| Door | Check | Adapter | Proof it reads | Reconciles against | Status now |
|---|---|---|---|---|---|
| `{door id}` | `door_{id}` | `lib/watchdog/doors/{id}.js` | {row + column + value} | {provider event id against receipt id} | {proven / failed / unknown / unsupported} |

Offline evals per check: {fires on a planted gap, quiet on healthy data, partial on a truncated page, results}.

## Role

| Thing | Value |
|---|---|
| Reader role | `{watchdog_reader}` |
| Writer (own tables only) | {role or credential name, held separately from the reader} |
| Approved views | {v_wd_...} |
| Migration file | {path} |
| Forbidden-write test | {script, result, exact error for each attempt} |

Reads app data through a SELECT-only role; writes only the watchdog's own tables through a separate writer. {Blocked items and what is needed, or "none".}
