# Incident log

`incidents.jsonl` holds one line per incident: something that went wrong in production, or would have, and who noticed. It is the watchdog's test set. Every incident it could catch becomes a replay case, and every incident a person found that the watchdog missed is a check not yet written.

This file records what happened and who saw it. What we changed belongs in {the changelog or gaps file}, linked from `fix` and `gap`.

## When to log

- {The operator}, a member of staff, a partner, a provider or a customer reports something wrong.
- We find something wrong in production ourselves, including a near miss we stopped in time.
- The watchdog raises a finding that turns out to be real.

Do not log feature requests, copy preferences or "can it also do X". Problems with no production consequence do not count either.

## How to log

Append one line to `incidents.jsonl` with the next `id`, then run:

```
node scripts/eval-incidents-schema.mjs
```

One incident per root cause. A second report of the same fault in one week goes into `symptom` on the first entry instead of a new line.

## Fields

| Field | Required | What goes in it |
|---|---|---|
| `id` | yes | `INC-NNN`, sequential, never reused |
| `reported` | yes | `YYYY-MM-DD` first noticed ({zone}) |
| `found_by` | yes | `operator`, `staff`, `partner`, `provider`, `customer`, `dev`, `watchdog`, `monitoring`, `unknown`; the first observer the evidence supports |
| `via` | yes | `chat`, `doc`, `call`, `email`, `monitoring`, `error_tracker` |
| `source` | yes | Where the report lives, in words |
| `kind` | yes | See kinds below |
| `area` | yes | {this client's areas: the parts of the app the operator would name} |
| `severity` | yes | `high`: a customer, partner, record or payment was or would have been affected. `medium`: the operator had to work around it. `low`: cosmetic or confusing |
| `title` | yes | One line, what went wrong |
| `symptom` | yes | What the reporter saw, in their words where possible |
| `impact` | yes | Who or what was affected, with counts |
| `root_cause` | yes | Why it happened. "Not recorded" rather than a guess |
| `fix` | yes | What changed, with a commit SHA where there is one. "Open" if unfixed |
| `gap` | no | A changelog or gaps reference, comma-separated if several, else `null` |
| `detect_delay` | yes | Fault start to someone noticing: "minutes", "same day", "~1 week", "before it fired" |
| `watchdog.check` | yes | The check that would catch it (list below), or `null` |
| `watchdog.catchable` | yes | `yes`, `partly` or `no` |
| `watchdog.why` | yes | The signal the check sees, or why nothing in the data could show it |
| `existing_detection` | yes | One record per system that already watched the app, empty list when none; each `status` one of `yes`, `no`, `unknown` (see the schema reference) |

### Kinds

- `missed`: something should have happened and did not.
- `lost_inbound`: a message or webhook arrived but was not applied or shown.
- `wrong_send`: a message went that should not have, went to the wrong place, went too often, or said the wrong thing.
- `wrong_data`: something was recorded wrongly.
- `outage`: the app, or a whole action, stopped working.
- `config`: a credential, connection or switch was in the wrong state.
- `ui`: a screen bug with no data consequence.

### Watchdog checks

The names the watchdog uses. Add a new name here when an incident needs a check that does not exist yet; the schema eval refuses a `watchdog.check` that is not listed.

| Check | Signal |
|---|---|
| `{check_id}` | {one line: the row, column and value, or the absence past a deadline} |

## The holdout

`holdout.json` freezes the human-adjudicated replay subset: for each case the incident id, `replayable`, the as-of inputs (a fixture under `fixtures/`, pseudonymised), `as_of`, `detect_by`, the expected check and subject, and who adjudicated it and when. `frozen_at` is set when adjudication completes; the file does not change afterwards without a new adjudication.

## Privacy

This file is committed, so it holds no customer names, email addresses or phone numbers. Use record references and partner names where the role matters; staff by first name only. The schema eval fails on any email address or phone number pattern.
