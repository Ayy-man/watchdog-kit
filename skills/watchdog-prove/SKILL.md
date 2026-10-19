---
name: watchdog-prove
description: Observe one real scheduled sweep on the deployed revision, confirm migration state, role access, the contract level and hub freshness, prove the stale alarm from production rows with a moved clock, and mark REPORT.md operational with the sweep id. No human stop at report-only; at report-and-tell it has one, where the human confirms the real alert arrived. Loaded by watchdog-build during a build; not for use on its own.
---

# watchdog-prove

You are proving the watchdog runs where it will live, not where it was built. Everything before this was measured on fixtures, disposable databases or hand-started runs; the only evidence that the deployed revision sweeps on schedule is a sweep nobody started. Read `../watchdog-build/references/shared-contract.md` first, then `.watchdog/EVAL.md`, `.watchdog/HEARTBEATS.md`, `.watchdog/PAGE.md` and `.watchdog/CONTRACT.md`. The human has merged and deployed, and you observe. This phase cannot start until the orchestrator has recorded `d8.deployed` (the deployed revision) in the journal; you do not record it yourself. Report-only, as the contract defines it, is what you are proving. Every production read below uses a credential the human has provided and named (the variables under `## Role` in `HEARTBEATS.md`, or one they give you for this phase); you never read `.env` values to find one.

## 1. Confirm which revision is live

Read the deployed revision from the host (a deployment listing with the commit SHA, or a version endpoint) and compare it with the merged commit. Deployments can carry no git metadata, so if the host cannot say, use a route that returns the build's commit, and if there is none, record the uncertainty rather than assume. Everything below is attributed to this revision.

## 2. Observe one scheduled sweep

Wait for the next cron slot. Do not start a sweep by hand: a manual run proves the code, not the schedule, and the two are recorded under different job names for that reason. When the slot passes, read `job_runs` for the sweep's heartbeat and `watchdog_sweeps` for its generation, then the receipt: sources read with rows and truncation, per-check coverage and timing, which checks ran in a review slot, the model key name, and the findings written. Confirm the sweep's `trigger` is `cron`. Record the sweep id, its start and finish, and the receipt summary under `## Proof` in `.watchdog/REPORT.md`.

## 3. Confirm migration state and role access

Read the applied migrations from the client's own migration ledger, the table its migration tool records applied versions in (named in `MAPPING.md`, or found in that tool's config; it belongs to the client, not to the kit), with a read-only credential the human provides for it. Confirm every watchdog migration (findings, reviews, job runs, sweeps, silences, alert sends, the roles and views) is in it. If no credential is given, record the ledger check as blocked with what is needed rather than inferring it from the sweep working. Connect as `watchdog_reader` through its recorded variable and run the forbidden-write test against production, whose probes all must fail and so leave nothing behind: the insert must fail with the exact error recorded in `EVAL.md`. Confirm the sweep's receipt names the reader role as the connection it used.

## 4. Prove the contract level

At report-only, prove the runtime cannot send: list the deployed environment's variable names and confirm no `WATCHDOG_ALERT_*` credential is set, confirm neither the reader nor the writer holds a grant on any notification table, and show on one finding from the observed sweep that `meta.alerts` reads "no route can send at report-only" with the rendered preview beside it. Record the three facts and the finding id under `## Alerts`. At report-and-tell (only when the journal holds the `alert_activation_authorised` entry and the sender was provisioned in its own change), confirm one real alert went for a finding from the observed sweep: the `alert_sends` row with `status: proven` and the provider id or the notification row, and then stop: this is the phase's one human stop, because only the person the alert went to can say it arrived. Ask them to confirm arrival and the state they want the route left in, record both answers with who gave them and when, and only then continue.

## 5. Hub projection

Where the projection was built, call `/api/watchdog/summary` with the token and confirm the sweep id matches the observed sweep and `finished` is within one cadence of now; then confirm the hub's own view of this installation shows the same sweep id. Where none was built, write "no hub" under `## Hub`.

## 6. Prove the stale alarm

The watchdog's own failure to run must be visible, and most hosts run crons only on production, so do not disable anything. Prove it in two reads. First, the offline eval for `$KIT/core/self-check.js` already shows a skipped slot becomes `sweep_missed` and that `staleAlarm` fires with no finished sweep in two cadences; record its result. Second, against production rows read through the core's read-only wrapper over the writer (the reader has no grant on the watchdog's own tables), run the page model's stale computation (`staleAlarm` over the real `job_runs` rows for `watchdog.sweep`) once with the real `now`, which must read fresh, and once with `now` moved three cadences past the last finished sweep, which must read stale and name the last sweep id; then confirm the hub's silence rule for this installation uses the same threshold. Record both results, the sweep id and the threshold. Nothing is switched off and no row is written.

## 7. Mark the report operational

Write `.watchdog/REPORT.md` from `$KIT/templates/REPORT.md`: `Status: operational, proven on sweep <sweep id> at <time> on revision <sha>`, the doors table with each door's status as it stands, `## Unsupported and unknown` copied from the contract with what instrumenting each would take, the contract level with its proof, the alert routes and their state, the hub projection state, the stale-alarm proof, and the gates table from `EVAL.md` with `real_sweep_observed` now carrying the sweep id. Stop. Say what you observed, with the sweep id, the receipt summary, the contract-level proof and the stale-alarm finding id, and list any door still unknown or unsupported so the human knows what the watchdog cannot see on day one.
