# Page plan: {client}

Status: {draft | approved by {name} on {date}}

{One paragraph: what the build does, what the client bought it for, who opens the page and what each of them needs from it, and the one or two decisions that shape the page most.}

## 1. Evidence

Every fact the plan rests on, with where it came from. Sources: Code (with a path), Vault (with a note name), Proposal, Call, Baseline, PostHog, Dropped in (with the file in `.telemetry/inbox/`), Asked.

| Source | What it says | What it changed |
|---|---|---|
| {source} | {the fact} | {the decision it led to} |

## 2. Decisions, step by step

| Step | Decision | Why |
|---|---|---|
| 1. Promise | {headline outcome, in the client's order} | |
| 2. Roles | {who gets the page and the one question each brings} | |
| 3. Units | {each unit of work, its states, timestamps that exist and that must be added} | |
| 4. Measured or estimated | {for each headline figure} | |
| 5. Comparisons | {for each headline figure} | |
| 6. Volume and zero | {visual form, and what an empty screen means} | |
| 7. Silent failures | {what could fail without an error} | |
| 8. Panels | See section 4 | |
| 9. Data | See section 7 | |
| 10. Look | {design system, references, phone behaviour} | |

## 3. Role matrix

Full: sees it. Own: only their own slice. Count: totals without money. No: not in their data.

| Panel | {role} | {role} |
|---|---|---|
| {panel} | {Full / Own / Count / No} | |

## 4. Tabs and panels, by role

### {Role}: "{the one question they bring}"

Summary, in order:
1. {panel}: {why it earns its place}

Detail:
1. {panel}: {why}

Health: {Watchdog page / this skill's Health tab / switched-off state}

## 5. Considered and left out

| Panel | Why not |
|---|---|
| {panel} | {reason} |

## 6. Health checks

| Check | Catches | Protects | Owner and visible next step | Applicability and completion proof |
|---|---|---|---|---|
| {check} | {silence / staleness / sent not confirmed / stuck / error} | {the promise it protects} | {role, decision and where} | {product/scope, manual completion, what missing evidence cannot prove} |

## 7. Data to add

| Event | Sent from | Properties | Role-scoped |
|---|---|---|---|
| {event} | {file or workflow} | {properties, plus client_slug, app, environment} | {how} |

## 8. Open questions

1. {question}. Best guess: {answer}.

## Changes

{Date, who said it, the requirement quoted, the steps it touched, and what changed in the plan.}

## Built

{After half two: what was built, where, as which roles to look at it, and anything that differs from the plan and why.}
