# Egress policy: {client}

What may leave the database into a finding, a packet, a page, an alert or a hub report. Written by the survey phase, approved by a human before any code is written, because the SELECT-only role and the approved views are built from this file: anything not listed here is unreadable to the watchdog.

Approved by: not yet approved. Version: egress@{YYYY-MM-DD}.

## Pseudonym

How people are referred to outside the database.

| Who | In findings and packets | In the page | In alerts and hub |
|---|---|---|---|
| Customers | {first name only / opaque id} | {same} | {record reference only} |
| Staff | {first name} | {first name} | {first name} |
| Partners | {name, since the role matters} | {name} | {name} |
| Email addresses | never | never | never |
| Phone numbers | never | never | never |

Applied in SQL in the approved views where possible, and by `scrubText` in code for free text. Inbound text is wrapped as data before it reaches a prompt.

## Fields

One row per approved source; a column not listed is not in the view.

| Source | View name | Columns allowed | Quote allowed | Reason |
|---|---|---|---|---|
| {messages} | {v_wd_messages} | {id, conversation_id, direction, status, provider_message_id, sent_at, delivered_at} | {body: first 140 characters, only when a finding rests on its content} | {the reply-unapplied check needs the text to show what was missed} |
| {appointments} | {v_wd_appointments} | {id, tenant_id, starts_at, booked_at, status, external_id} | no | |

Provider read-backs (`verifyRecipient` and the like) are listed here too, with the provider endpoint, what it returns and why the watchdog needs it; none is allowed unless listed. Reads of an existing monitoring system follow the same rule: list the read operation, the fields it returns, the scope, the credential variable name, the read cap and the retention, plus any external incident id or link the findings page will show. A SELECT-only database role does not constrain an external API, so the adapter for such a source exposes only the listed operations.

| Provider call | Endpoint | Returns | Allowed | Reason |
|---|---|---|---|---|

## Retention

| What | Kept for | Then |
|---|---|---|
| `watchdog_findings` | {90 days after resolution} | {deleted by the sweep's prune} |
| `watchdog_reviews` (packets as sent) | {14 days} | {packet body cleared, hash and findings kept} |
| `job_runs`, or the existing receipt table that proves runs | {14 days} | {pruned by the sweep; an existing table is the app's, and the watchdog prunes nothing in it} |
| `watchdog_sweeps` receipts | {30 days} | {pruned} |
| Alert proof rows | {90 days} | {pruned} |
| Hub reports | {aggregate only; retention set by the hub} | |

## Who may read the page

{roles}, through the app's own auth. The page reads the watchdog tables only; it never joins into app tables.
