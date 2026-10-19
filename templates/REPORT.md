# Watchdog report: {client}

Status: {not yet operational | operational, proven on sweep {sweep id} at {time} on revision {sha}}

Contract level: {report-only | report-and-tell since {date}, authorised by {name}}. At report-only the watchdog reads on a SELECT-only role, writes only its own tables, holds nothing it could send with, and the hub pulls its projection. What it would do and say is recorded on each finding and never acted on.

## Doors

| Door | Direction | Status | Proof it fired | Proof-of-proof | Delivery door | Check |
|---|---|---|---|---|---|---|
| {door id} | in / out / internal | proven / failed / unknown / unsupported | {row + column + value} | {reconciled against} | {signal or none, per channel} | `{door_<id>}` |

## Unsupported and unknown

Doors or channels with no authoritative signal. They never count as coverage. For each, what it would take to instrument it.

| Door or channel | Status | Why | To instrument it |
|---|---|---|---|
| {door or channel} | {unknown / unsupported} | {reason} | {what it would take} |

## Proof

| What | Evidence |
|---|---|
| Deployed revision | {sha, how it was read} |
| Scheduled sweep observed | {sweep id, generation, trigger cron, started, finished} |
| Receipt summary | {sources, rows, truncated, checks run, model key name, model calls} |
| Migrations applied | {list from the ledger} |
| Reader role | {role name; forbidden-write test result against production with the exact error} |
| Contract level proven | {report-only: no alert credential names in the deployed env, no notification-table grant, finding id whose meta.alerts reads "no route can send"; report-and-tell: route, finding id, alert_sends proof and provider id, confirmed by whom} |
| Hub projection | {sweep id from /api/watchdog/summary and at the hub, finished time; or no hub} |
| Stale alarm | {offline eval result; production read: fresh at real now, stale at now plus three cadences, last sweep id, threshold; hub silence rule matches} |

## Alert routes

| Route | Setting | Can send at this level | State now | Cap per day | Repeat interval |
|---|---|---|---|---|---|

## Gates

| Gate | Value | Threshold | Pass | Evidence |
|---|---|---|---|---|
| `doors_no_unknowns_hidden` | | | | |
| `holdout_recall_by_severity` | | | | |
| `live_findings_adjudicated` | | | | |
| `model_eval_all_cases_counted` | | | | |
| `own_key_own_budget` | | | | |
| `forbidden_write_fails` | | | | |
| `real_sweep_observed` | | | | |
| `alert_payload_bounded` | | | | {report-and-tell only, else "not at this level"} |
| `alert_send_idempotent` | | | | {report-and-tell only} |
| `alert_activation_authorised` | | | | {report-and-tell only} |

## What the watchdog cannot see on day one

Plain words for the owner: the doors above marked unknown or unsupported, and the incident kinds in the log marked `catchable: no`.
