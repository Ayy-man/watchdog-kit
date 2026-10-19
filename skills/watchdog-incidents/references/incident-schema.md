# Incident log schema

Ported from the first installation's incident README, generalised so a client declares its own areas and check names. `docs/incidents/incidents.jsonl` holds one line per incident: something that went wrong in production, or would have, and who noticed. It is the watchdog's test set. Every incident a check could catch becomes a replay case, and every incident a person found that the watchdog missed is a check not yet written.

It records what happened and who saw it. What we changed belongs in the changelog or gaps file, linked from `fix` and `gap`.

## When to log

- The operator, a member of staff, a partner, a provider or a customer reports something wrong.
- The team finds something wrong in production, including a near miss stopped in time.
- The watchdog raises a finding that turns out to be real.

Do not log feature requests, copy preferences or "can it also do X". Problems with no production consequence do not count.

## How to log

Append one line with the next `id`, then run `node scripts/eval-incidents-schema.mjs`. One incident per root cause; a second report of the same fault in one week goes into `symptom` on the first entry.

## Fields

| Field | Required | What goes in it |
|---|---|---|
| `id` | yes | `INC-NNN`, sequential, never reused |
| `reported` | yes | `YYYY-MM-DD` first noticed, in the client's time zone |
| `found_by` | yes | `operator`, `staff`, `partner`, `provider`, `customer`, `dev`, `watchdog`, `monitoring`, `unknown`; the first observer the evidence supports |
| `via` | yes | `chat`, `doc`, `call`, `email`, `monitoring`, `error_tracker` |
| `source` | yes | Where the report lives, in words: a chat group, a doc tab, a commit, a session date |
| `kind` | yes | See kinds below |
| `area` | yes | From the client's area enum, declared in the README (the parts of the app the operator would name: bookings, messaging, billing, scheduling, auth, ui, and so on) |
| `severity` | yes | `high`: a customer, partner, record or payment was or would have been affected. `medium`: the operator had to work around it. `low`: cosmetic or confusing |
| `title` | yes | One line, what went wrong |
| `symptom` | yes | What the reporter saw, in their words where possible |
| `impact` | yes | Who or what was affected, with counts |
| `root_cause` | yes | Why it happened. "Not recorded" rather than a guess |
| `fix` | yes | What changed, with a commit SHA where there is one. "Open" if unfixed |
| `gap` | no | A gaps or changelog reference, comma-separated if several, else `null` |
| `detect_delay` | yes | Time from the fault starting to someone noticing: "minutes", "same day", "~1 week", "before it fired" |
| `watchdog.check` | yes | The check id that would catch it (from the README's check list), or `null` |
| `watchdog.catchable` | yes | `yes`, `partly`, `no` |
| `watchdog.why` | yes | The signal the check sees (row, column, value, or the absence past a deadline), or why nothing in the data could show it |
| `existing_detection` | yes | One record per system that already watched the app (an empty list when none exists); the shape below, each `status` one of `yes`, `no`, `unknown` |

### Existing detection

`existing_detection` is a list with one record per system named under `## Existing monitoring` in `MAPPING.md`, each saying whether that system detected the incident, separately from whether the watchdog could. One system's clean history says nothing about another's, so a claim of an additional catch is always relative to the sources listed. A detection is a recorded detector result naming the fault, not raw data someone could have read it from. A notification is recorded separately and needs delivery evidence. Missing history is `unknown`, never `no`; `no` needs evidence that the detector's history was complete for the interval and held nothing matching.

```json
[{ "source": "uptime-probe", "status": "unknown", "detected_at": null, "notified_at": null, "evidence": [] }]
```

`source` names the system; times are UTC instants or null; `evidence` holds EvidenceRefs. `found_by` keeps the original observer; an incident is never relabelled as found by the watchdog because a replay catches it.

## Kinds

- `missed`: something should have happened and did not (a record not created, a message not sent, a job never run).
- `lost_inbound`: a message or webhook arrived but was not applied or shown.
- `wrong_send`: a message went that should not have, went to the wrong place, went too often, or said the wrong thing.
- `wrong_data`: something was recorded wrongly.
- `outage`: the app, or a whole action, stopped working.
- `config`: a credential, connection or switch was in the wrong state.
- `ui`: a screen bug with no data consequence.

## Checks

The README in the client repo lists the check ids the watchdog uses, one row per check with its one-line signal. Add a new name there when an incident needs a check that does not exist yet; the schema eval refuses a `watchdog.check` that is not listed.

## Privacy

The file is committed. No customer names, email addresses or phone numbers. Use record references, account or partner names where the role matters, and first names only for staff. The schema eval fails on any email address or phone number pattern in any field.

## The holdout

`docs/incidents/holdout.json` freezes the human-adjudicated replay subset:

```json
{ "frozen_at": null, "cases": [
  { "id": "INC-014", "replayable": true,
    "as_of": "2026-09-03T08:05:00Z",
    "inputs": { "fixture": "docs/incidents/fixtures/INC-014.json" },
    "detect_by": "2026-09-03T12:00:00Z",
    "expect": { "check": "reply_owed_not_sent", "subject": { "type": "conversation", "id": "cv_18a" } },
    "adjudicated_by": null, "adjudicated_at": null, "note": "" },
  { "id": "INC-021", "replayable": false, "reason": "Rows were deleted on refusal; no fixture can be rebuilt.",
    "adjudicated_by": null, "adjudicated_at": null }
] }
```

`as_of` is the instant the data state in `inputs` is taken from; `detect_by` is the latest sweep at which a finding still counts as a catch; `expect` names the check and subject a catch must land on. `frozen_at` is set when adjudication completes, and the file does not change afterwards without a new adjudication.
