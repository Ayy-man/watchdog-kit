# Findings page: {client}

Written by the page phase. The page is where every finding is judged, and precision is measured from the verdicts given here. It reads the watchdog tables only and never joins into app tables. Every alert route is off.

## Page

| Route or component | Purpose | Role allowed | Built from canvas part |
|---|---|---|---|
| `{/watchdog}` | {findings column, uptime strip, checks rail} | {owner, admin} | {part name in CANVAS.md} |

Data shaping module: `{lib/watchdog/page-model.js}`. Page-model evals and build: {commands, results}. Time zone shown: {IANA zone}.

## Card audit

Snapshot and coverage: {as-of, permitted sources, pagination completeness, missing history; no production mutations}. Check definitions reviewed: {count}. Current findings observed: {count, or unavailable}. Operator cards: {before} to {after} on the same input; canonical findings retained: {count}; developer-only: {count}; hidden: {count}.

| Check / finding class | Owner and obligation | Scope and counterevidence | Disposition and exact merge target | Why / visible next step |
|---|---|---|---|---|
| {id or class; no current instance when absent} | {role, work owed} | {where the rule applies and what settles it} | {keep / route / cut / merge / reword / hide unchanged} | {reason and action} |

{Before and after title, description, visible next step and decision-bearing facts for changed cards; sensitive material stays out of committed artefacts. Every reduction is accounted for without deleting or adjudicating findings. Source correction, replay correction and presentation correction are recorded separately. Opposing-case evals from the attention-policy reference: commands and results. Age policy and persistence, if enabled: implementation and tests, or explicitly not enabled.}

## Trace

Route: `{/watchdog/<id>}`. {Inputs, decision and what went out, each showing the stored value and never a recomputed one; where the packet as sent is loaded on demand.}

## Verdicts

Verdict route: {path}. Keys: Correct, False alarm, Unsure, with an optional reason. {The route refuses any field other than the verdict columns and the verdict context; system findings stay out of the totals; keyboard path as in the canvas.}

## Alerts

No route can send at report-only; activation is a separate authorised change.

| Alert kind | Mapped from finding kinds | Setting | Default state | Cap per day | Repeat interval |
|---|---|---|---|---|---|
| `{alert kind}` | {finding kinds} | {setting name} | off | {n} | {hours} |

Payload carries only: finding id, kind, severity, scope key and links. Offline evals for payload bound and send idempotence: {results}. Existing monitoring deduplication: {rule, or "no existing monitoring systems"}.

## Hub

{Decision: no hub requested, nothing built / projection route `GET /api/watchdog/summary`, bearer token variable name, schema eval result.}
