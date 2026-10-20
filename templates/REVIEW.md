# Model review: {client}

Written by the review phase. A model reads a packet built in code and may only raise findings whose evidence code can resolve and match. The model does no calendar maths and holds no key but the watchdog's own.

## Packets

One row per approved subject type.

| Packet | Subject | Related rows | Derived block (computed in code) | Pseudonyms applied |
|---|---|---|---|---|
| `{conversation}` | {conversation} | {messages in and out, appointments} | {due instants, overdue flags, already-done flags} | {first names, opaque ids} |

Finished subjects excluded: {how each subject's end instant is computed, and the test that a subject ended earlier today is out}.

Serialisation: {compact JSON}. Hash covers stable facts only: {list what is excluded, such as now and relative wording}.

## Grounding

Code holds the model's answer to the packet. {Resolve every ref, match every quote, confidence floor, text with email or phone dropped, timing findings accepted only where the derived line says overdue, finding id built from the evidence entities.}

Prompt policy version: {prompt@YYYY-MM-DD}. Dropped answers stay on the review row and in the receipt, never as findings: {confirm}. Rule-owned kinds refused: {the RULE_OWNED_KINDS map}. Broad review refuses what a subject review covers: {the rule}.

## Slots

Histogram of writes and inbound receipts by local hour over {45} days, zone {IANA zone}:

{histogram or table of hour against count}

Proposed slots: {07:30, 19:30}. Setting that holds them: {setting name and store}. A subject is reviewed once per slot, or at once when a rule check has just flagged it.

## Models

Prices and names move monthly, so each figure carries its date.

| Model | Provider | Input price | Output price | Context length | Source | As of |
|---|---|---|---|---|---|---|
| {slug} | {provider} | {per million tokens} | {per million tokens} | {tokens} | {url} | {date} |

## Bake-off

Key variable: `{WATCHDOG_PROVIDER_API_KEY}`. Spend cap from the journal: {amount}. Every case is counted and an errored call is a row.

| Model | Case set | Cases | Raised and grounded | Raised and rejected | Missed | False alarm | Errors | Cost | p50 latency |
|---|---|---|---|---|---|---|---|---|---|
| {slug} | planted | {n} | | | | | | | |
| {slug} | held-out real | {n} | | | | | | | |
| {slug} | healthy | {n} | | | | | | | |

Cost of the bake-off itself: {amount} of {cap}.

## Decision

Model chosen: {slug}, because {numbers from the table}. Estimated cost per day at observed packet sizes: {amount}. Slots chosen: {list}. Decided by {name} on {date}. Deployed key confirmed by {name} on {date}.
