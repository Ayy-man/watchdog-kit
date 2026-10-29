# Checks: {client}

Written by the checks phase. One deterministic check per incident cluster, each read-only on the SELECT-only role, deterministic for a given `now`, bounded, and tested offline before it touches production. Policy version judged against: obligations@{date}.

## Obligations

Table at `.watchdog/OBLIGATIONS.md`, version {obligations@date}. Disagreements between the table and the sender's code, each awaiting the human's "app bug or unwritten rule":

| Event | Table says | Code does | Reads as | Decision |
|---|---|---|---|---|
| `{event}` | {rule} | {code} | {app bug / unwritten rule} | {decision} |

## Clusters

| Cluster | Incidents | Check | Shape |
|---|---|---|---|
| outcome-should-exist-by-now | {INC-...} | {reply_owed_not_sent} | {row / no row past due} |
| sent-not-delivered | | | |
| webhook-received-not-applied | | | |
| inbound-silent | | | absence against baseline |
| send-burst | | | |
| settings-drift | | | |
| provider-credit | | | |
| money-mismatch | | | |

Incidents in no cluster, with why: {list}. Incidents with `catchable: no`: {count}, listed in the incident log.

## Checks

| Check | Severity | Reads | Thresholds (with the incident that set each) | Unknown when | Incidents claimed |
|---|---|---|---|---|---|
| `{check_id}` | high | {views} | {OVERDUE_GRACE 6h (INC-014)} | {adapter says indeterminate} | {INC-...} |

## Operator decisions

| Check / kind | Owner | Obligation and applicable product / scope | Evidence that settles or contradicts it, including manual completion | Useful next step | Shared action identity, if any |
|---|---|---|---|---|---|
| {check_id / kind} | {role, never inferred from subject type} | {work owed, recipient, deadline} | {authoritative fields and limits of missing proof} | {visible step: what to check, decide or correct, and where, with the subject named} | {scope, subject/event, obligation, occurrence; no text-only matching} |

## Evals

| Run | Where | Result | Receipt |
|---|---|---|---|
| Offline (fake harness) | `scripts/eval-watchdog-*.mjs` | {n pass / n fail} | {output path} |
| Conformance (disposable Postgres, real migrations and RLS, reader role) | {script} | {pass / fail, what was read, forbidden-write result} | |
| Live dry run (production, reader role, within read cap) | sweep {id} | {findings per check} | {receipt path} |

## Live dry run

Receipt summary: sources read, rows, truncated sources, per-check timing, checks that reported partial or unknown.

Findings, one row each, evidence attached in the trace:

| Finding id | Check | Severity | Subject | Verdict | Owner |
|---|---|---|---|---|---|
| {id} | `{check_id}` | {severity} | {subject} | {correct / false alarm / unsure} | {name, for real faults} |

## Adjudication

Every live finding judged by {name} on {date}. Real faults stay open with an owner; only a confirmed false alarm changes a check.

Threshold changes, each with the finding that caused it:

| Check | Constant | Was | Now | Because of | By, when |
|---|---|---|---|---|---|
| `{check_id}` | {CONSTANT} | {old} | {new} | {finding id} | {name, date} |

Checks that fired on healthy production state and were left as they are, with why: {list}.
