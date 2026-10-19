---
name: watchdog-eval
description: Lay out exactly what the eval will run and cost, wait for authorisation, run the holdout replay, the model bake-off on the watchdog key, a live dry run per check and the forbidden-write test, then write EVAL.md against every gate and stop for merge authorisation. Loaded by watchdog-build during a build; not for use on its own.
---

# watchdog-eval

You are measuring the watchdog against its own incident history and against the gates, so that a human can decide whether it merges. Nothing here is a pass by assertion: every gate gets a measured value or is written down as a next step. Read `../watchdog-build/references/shared-contract.md` first, in particular the Gates table and the invariants, then `docs/incidents/holdout.json`, `.watchdog/CHECKS.md`, `.watchdog/REVIEW.md`, `.watchdog/HEARTBEATS.md` and the journal's spend caps.

## 1. Lay out the plan and its cost, then wait

Before running anything, write the plan as a table in `.watchdog/EVAL.md` (template `$KIT/templates/EVAL.md`) under `## Plan`: each run, what it reads, what it writes, which key it uses, how many model calls at what packet size, the estimated cost in the provider's currency, and the wall time. The replay is free; the bake-off re-run is this phase's model spend, on top of what phase 5 already counted against the cap; the live dry runs read production on the SELECT-only role within the read cap. Then present the checkpoint below and wait. Nothing below runs on silence, because the bake-off spends real money and the dry runs read real data.

### Checkpoint: d7.eval
Evidence: `## Plan` in `.watchdog/EVAL.md`, with the concrete reads, writes and cost table, beside the spend caps in the journal. Approving authorises exactly what the table lists.

---
Do you authorise these runs?
1. Approve the plan as written
2. Approve with fewer runs or a lower cap (say which)
3. Reject (the plan is rewritten)
4. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 7 decision --id d7.eval --outcome <approved|rejected> --answer "..." --by "<who>"`

## 2. Replay the holdout

For each replayable case in `docs/incidents/holdout.json`, load its as-of inputs into the fake harness, run every check with `now` set to each sweep instant from `as_of` to `detect_by`, and record whether the expected check raised a finding on the expected subject at or before `detect_by`. A catch after the deadline is a miss. Compute recall per severity (high, medium, low) and list every miss with the check that should have caught it and why it did not, from the receipt. Unreplayable cases are listed beside the figures with their reason; they are not in the denominator and the gate line says how many were excluded, because a recall figure that silently drops the hard cases is not a figure.

Cases another system already caught stay in the denominator; dropping them would make recall depend on the competitor and hide regressions. Run the replay twice: once with every approved source readable at each instant, and once with the existing detectors' conclusions and alert states withheld while the raw receipts and run history stay. The first gives recall for the configured watchdog, the gate figure. The second gives independent recall on the same denominator, which separates a check that reasons from the data from one that reports another detector's result. For each case record existing detection by the deadline (`yes`, `no`, `unknown`, with its time where evidenced), the delivered notification time where proven, and the watchdog's first finding time, labelled replayed. A check whose description says it reports an existing detector's result is `dependent`: its catches count toward configured recall, are listed in the "needs an existing detector's result" column, and never count toward independent recall or additional catches. Claim an additional catch only against named sources: where every listed source's detection is evidenced `no` by the deadline and the independent replay catches it. An existing incident record on its own is never a watchdog catch, and `unknown` is shown as unknown, not as a miss.

## 3. Bake off on the watchdog key

Re-run the bake-off from `.watchdog/REVIEW.md` on the chosen model with the watchdog's own key, on the three case sets (planted, held-out real, healthy), through the grounding code, within the cap. Count every case: raised and grounded, raised and rejected, missed, false alarm on healthy, cost, latency. Confirm from the receipts that no call used the shared key. The `model_eval_all_cases_counted` gate fails if the tally does not add up to the case count, and `own_key_own_budget` fails on any shared-key call or any spend over the cap.

## 4. Live dry run per check

Run one sweep against production through the reader and the writer, and record the receipt per check: sources, rows, truncation, examined subjects, timing, findings. Every finding must already carry a verdict from the adjudication recorded in `.watchdog/CHECKS.md`, or receive one now; `live_findings_adjudicated` is the count of findings without a verdict, which must be zero, and the count of real faults without an owner, which must be zero.

## 5. The forbidden-write test

Run `scripts/eval-forbidden-write.mjs` as the SELECT-only role: an insert into an app table, an update, an rpc or stored-procedure call where the database exposes one, and a select on an unapproved column. Each must fail. Record the exact error for each, because the gate is that the failure happens, not that the code promises it.

## 5a. Precision per check

From every verdict given so far (the phase 4 adjudication and any since), compute precision per check and per model prompt version: correct over correct plus false alarm, with unsure shown beside it, never folded in. Write the table under `## Precision per check` in `EVAL.md`. A check below the floor the human set at adjudication (default 0.7, recorded in the journal) is listed with a proposed action, retune with the evidence that misled it or mute until a date, as a question for the human at the stop; the eval never applies either. A check with fewer than five verdicts shows "too few verdicts" rather than a figure, because a precision of 1.0 on two cases is not a measurement.

## 6. Write EVAL.md against every gate

Replace the plan's placeholder values with a table under `## Gates`: one row per gate id from the shared contract, with the measured value, the threshold the human set, pass or fail, and the evidence (receipt id, script output path). `doors_no_unknowns_hidden` is checked by comparing the contract's doors to the `## Unsupported and unknown` list in `EVAL.md` itself, which you write from the contract (REPORT.md does not exist until phase 8, which re-checks the same list against it); `real_sweep_observed` has no value yet and is written as the next step, with what it needs (a deployed revision and one scheduled slot). Anything else missing a value is a listed next step, not a blank.

## 7. Stop

Write `.watchdog/EVAL.md` and stop. Say what ran, what it cost against the cap, and the gate table. Name the failing or unmeasured gates first.

### Checkpoint: d7.merge
Evidence: the gate table in `.watchdog/EVAL.md`. Merging on a red gate is the human's call, made with the reason written down in the answer. Recording this never merges; the merge is the human's act.

---
Do you authorise merging the watchdog branch into the client's main branch?
1. Approve (name any red or unmeasured gate you are accepting, and why)
2. Reject (say which gate to fix first)
3. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 7 decision --id d7.merge --outcome <approved|rejected> --answer "..." --by "<who>"`
