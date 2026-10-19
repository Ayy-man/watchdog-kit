# Eval: {client}

Written by the eval phase. Every gate from the shared contract gets a measured value or is listed as a next step; nothing passes by assertion. Spend cap from the journal: {amount} per day for model calls, {n} rows per sweep for live reads.

## Plan

Presented to {name} on {date}; authorised at {time}.

| Run | Reads | Writes | Key | Model calls | Est. cost | Wall time |
|---|---|---|---|---|---|---|
| Holdout replay | fixtures only | nothing | none | 0 | 0 | {min} |
| Bake-off | fixtures and held-out packets | `watchdog_reviews` (eval rows, tagged) | `WATCHDOG_{PROVIDER}_API_KEY` | {n} at ~{tokens} each | {amount} | {min} |
| Live dry run | production, reader role | `watchdog_findings`, `watchdog_sweeps`, `job_runs`, through the separate writer | none | 0 | 0 | {min} |
| Forbidden-write test | production, reader role | attempts that must fail | none | 0 | 0 | {min} |

## Holdout replay

Holdout frozen at {time} by {name}; {n} cases, {n} unreplayable (listed below, excluded from the denominator).

| Severity | Cases | Caught by deadline | Recall | Threshold |
|---|---|---|---|---|
| high | | | | |
| medium | | | | |
| low | | | | |

Misses, each with the check that should have caught it and why it did not (from the receipt):

| Case | Expected check | What happened |
|---|---|---|

Unreplayable: {ids with reasons}.

## Existing monitoring comparison

Existing detection and notification times are historical evidence; watchdog times are replay results. Unknown existing detection is shown as unknown and is not a miss.

| Case | Existing detection by deadline | Existing detected at | Notification delivered at | Watchdog first finding (replayed) | Independent finding by deadline | Evidence |
|---|---|---|---|---|---|---|
| {id} | {yes / no / unknown} | {UTC / unknown} | {UTC / unknown} | {UTC / missed} | {yes / no} | {refs} |

| Severity | Replayable cases | Configured watchdog catches | Independent catches | Catches that need an existing detector's result | Existing detection unknown |
|---|---|---|---|---|---|
| high | | | | | |
| medium | | | | | |
| low | | | | | |

Additional catches: {independent catches where existing detection by the deadline is evidenced no}. Replayed timing comparisons: {cases and differences, or unavailable with the reason}.

## Bake-off

Model: {slug}, key `{name}`, policy version {prompt@date}. Every case counted; an errored call is a row.

| Case set | Cases | Raised and grounded | Raised and rejected | Missed | False alarm | Errors | Cost | p50 latency |
|---|---|---|---|---|---|---|---|---|
| planted | | | | | | | | |
| held-out real | | | | | | | | |
| healthy | | | | | | | | |

Shared-key calls seen in receipts: {0}. Spend against cap: {amount} of {cap}.

## Live dry run

Sweep {id}, {time}, trigger manual, reader role. Receipt: {sources, rows, truncated}.

| Check | Findings | With verdict | Real faults | With owner | Partial or unknown |
|---|---|---|---|---|---|

## Precision per check

| Check | Correct | False alarm | Unsure | Precision | Floor | Proposed action |
|---|---|---|---|---|---|---|
| {check id} | | | | {n/n, or too few verdicts} | {0.7} | {none / retune: {evidence} / mute until {date}} |

## Forbidden-write test

| Attempt | Result | Exact error |
|---|---|---|
| insert into {app table} | must fail | |
| update {app table} | must fail | |
| rpc or stored-procedure call, where the database exposes one: {name} | must fail | |
| select {unapproved column} | must fail | |

## Gates

| Gate | Value | Threshold | Pass | Evidence |
|---|---|---|---|---|
| `doors_no_unknowns_hidden` | {n doors, n unknown or unsupported, all listed in this file under Unsupported and unknown} | all listed | | |
| `holdout_recall_by_severity` | {high x / medium y / low z} | {set at adjudication} | | |
| `live_findings_adjudicated` | {n without verdict, n faults without owner} | 0 and 0 | | |
| `model_eval_all_cases_counted` | {tally = case count} | equal | | |
| `own_key_own_budget` | {shared-key calls, spend} | 0, under cap | | |
| `forbidden_write_fails` | {4 of 4 failed} | all fail | | |
| `real_sweep_observed` | next step: needs a deployed revision and one scheduled slot | sweep id | | |
| `alert_payload_bounded` | {offline eval result; or not at this level} | report-and-tell only | | |
| `alert_send_idempotent` | {offline eval result; or not at this level} | report-and-tell only | | |
| `alert_activation_authorised` | {journal entry; or not at this level} | report-and-tell only | | |

## Unsupported and unknown

Every door in `CONTRACT.md` whose status is unknown or unsupported, copied here so the phase 7 gate compares the contract to this list. Phase 8 re-checks the same list against `REPORT.md`.

| Door or channel | Status | Why | To instrument it |
|---|---|---|---|
| {door id} | {unknown / unsupported} | {reason} | {what it would take} |

## Next steps

{Anything above without a value, with what it needs.}
