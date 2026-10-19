# Failure taxonomy

Every catchable incident goes into one cluster, and each cluster becomes one check. The cluster names what the data shows, not what the operator felt; two incidents with the same symptom but different signals belong in different clusters. The last two shapes cut across the others and are the ones a row-based check misses.

## Clusters

**outcome-should-exist-by-now.** An obligation is past due plus grace and the outcome row (a sent message, a created record, a write-back) does not exist. Signal: the subject, the obligation's `dueAt`, the absence. The finding lands on the subject, kind `no_outcome_past_due`. Examples: a reply owed and not sent, an order with no booking after 30 minutes, a job that has not run in its slot.

**job-ran-wrong.** The heartbeat says the job ran, and it did not do its work. Two signals: `job_stuck`, a run started and not finished past the job's declared `max_runtime` (a hung run, or a slot that began while the previous one was still going); `job_did_nothing`, a run finished `ok` with a summary count below the `work_floor` computed from the app's own data for that slot (reminders were due and the run sent none). Both land on the job as subject. A job with no computable floor gets only the stuck check, said plainly in its description.

**sent-not-delivered.** The outbound row reached provider acceptance but the delivery door never fired within its window. Signal: the attempt row at `accepted` or `sent`, the delivery column empty after N minutes, on a channel whose `deliveryDoor` is a real signal. A channel marked `none` can never be in this cluster; its strongest proof is acceptance, and a finding here would be a false alarm by construction.

**webhook-received-not-applied.** The receipt exists, the status says processed, and the change it carried is not on the subject. Signal: receipt id, the subject's field that should have changed, its unchanged value past grace. Includes "matched but held for review and forgotten" and "applied to the wrong subject" when a referential check can show it.

**inbound-silent.** Nothing has arrived on a door that normally receives, for longer than the door's own quiet pattern allows. Signal: the last receipt time against a baseline of the same hours on recent days, per scope. This is absence against baseline (below) applied to an inbound door.

**send-burst.** More sends than the rule allows: several to one recipient in minutes, any send while a pause switch is on, the same payload hash twice in one conversation in a short window. Signal: the attempt rows grouped by recipient or conversation, the gate's value at the time. Legitimate repeats (stop, help, confirmation) are listed as exceptions in the check, not learned.

**settings-drift.** A switch, gate or setting no longer reads what the operation runs on. Signal: the settings row against an expected map held in code, read every sweep. A settings read that throws is reported as unknown, never as "paused", because a check that treats an unreadable gate as off has silenced itself.

**provider-credit.** A provider is refusing, a credential has lapsed, a credit balance is below the floor, or a model provider is unreachable. Signal: a provider status read, the last successful call time, a balance endpoint. Report-only and cheap; a balance read is the only egress these checks make.

**money-mismatch.** Two records that should agree about money do not: a charge with no order, an order's seats against the amount paid, a voucher's value against its order, a paid order with no invoice after the write-back window. Signal: both rows, both values, the difference.

## Shapes that cut across clusters

**No row past due.** The missed work left no row at all: a reminder table that only gets a row when a run lands inside its grace window, a follow-up that is scheduled in memory, a job that never started. The check cannot select for a bad row; it must compute the obligation from the subject and the step table, then look for the absence. The finding is "owed by `dueAt`, nothing recorded by `dueAt + grace`". Coverage must list the subjects it computed obligations for, because the silence of a check that never computed them is not coverage.

**Absence against baseline.** Ingress died before any row was written: a webhook for an unknown location that returned 404, an unmatched receipt with no tenant, a provider that stopped posting. No row can be `failed`. The check builds a baseline per scope (receipts in the same hours over the last N days), compares the current window, and raises when the drop is beyond what quiet hours explain. It reports its baseline in the evidence so a human can see whether the drop is a holiday or a fault. A scope with too little history for a baseline is `unknown`, said plainly.

## Naming

A check id is `snake_case`, names the failure not the table (`reply_owed_not_sent`, not `check_webhook_events`), and is listed in `docs/incidents/README.md` before any incident may cite it.
