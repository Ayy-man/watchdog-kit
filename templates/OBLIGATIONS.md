# Obligations: {client}

Version: obligations@{YYYY-MM-DD}
Time zone: {IANA zone the rules are written in}
Sources: {the operator's words in incidents, a policy doc, the contract's Obligations section}

An obligation is what an event owes, to whom, by when, with what exceptions, written from the business rules and never from the sender's code. The due rule must be one that code can turn into a UTC instant; the model never computes it. Every Coverage record names the version it judged against.

## Table

| Event | Owes (kind) | To | Due rule | Grace | Exceptions (column = value) | Subject type | Policy source |
|---|---|---|---|---|---|---|---|
| `{message.received}` on an open conversation | `{reply}` | {the sender} | {15 minutes after received_at} | {10 minutes} | {conversation.paused = true; identity.opted_out = true; a human reply exists} | `{conversation}` | {operator, INC-004} |
| `{appointment.booked}` | `{reminder_24h}` | {the attendee} | {starts_at minus 24h, not before booked_at + 1h} | {6 hours} | {status = cancelled; booked inside 24h} | `{appointment}` | {step table} |
| `{order.paid}` | `{invoice_writeback}` | {the ledger} | {30 minutes after paid_at} | {30 minutes} | {order refunded within the window} | `{order}` | {finance rule} |

Rules for filling it:

- **Due rule** is arithmetic on a recorded timestamp, in the stated zone, with any quiet hours written in ("first run after 07:00 local"). If the rule needs a value that is not in the data, say which, and the obligation is unsupported until it is.
- **Grace** is how late is still fine: the sweep cadence plus the job's own slack, not a guess at how long the operator would tolerate.
- **Exceptions** are the states in which nothing is owed. Each must be a column and a value the check can read; "the operator decided not to" is not an exception unless a row says so.
- **Subject type** is the scope type from the contract the outcome should land on.
- **Policy source** names who or what said so, so a disagreement with the sender's code can be settled.

## Disagreements

Read the sender only after the table is written. Each line is an app bug or an unwritten rule; the human decides at the stop.

| Event | Table says | Code does | Reads as | Decision |
|---|---|---|---|---|
| `{event}` | {rule in the table} | {what the sender does} | {app bug / unwritten rule} | {human's decision} |

## Not owed

Events that owe nothing, listed so their silence is not read as a gap: status webhooks, read receipts, internal crons that only reconcile.

| Event | Why nothing is owed |
|---|---|
| `{status webhook}` | {reconciles only; owes no outcome} |
