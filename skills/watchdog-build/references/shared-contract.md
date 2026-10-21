# Shared contract

Every phase skill reads this file and nothing about the other phases. It holds the vocabulary, the schemas every artefact must satisfy, the invariants a check or adapter may not break, the `.watchdog/` file shapes, and the gates the build is judged against. The TypeScript in `$KIT/core/contracts/door.d.ts` and `$KIT/core/contracts/finding.d.ts` is authoritative where the two disagree.

## Where the kit's files are

Paths written as `$KIT/...` are inside the kit itself (its `core/`, `templates/`, `evals/lib/`, `scripts/`), not the client repo. `$KIT` is the `kit` directory beside `watchdog-build/SKILL.md`: a link to the kit root in a checkout, a real copy after a copy install. From any installed phase skill it is `../watchdog-build/kit`, resolved from the directory of the SKILL.md being read (Claude Code gives that directory as `${CLAUDE_SKILL_DIR}`; elsewhere take it from the path you opened). Paths without the prefix are in the client repo. Check `$KIT/core/VERSION` exists before the first use; if it does not, the install is incomplete and the build stops there.

## Vocabulary

These words mean one thing each, everywhere in the kit and in every prompt it generates.

- **door**: a boundary event of the client app. Inbound (a webhook, inbound mail), outbound (a provider call), or internal (a cron).
- **proof**: the signal that a door fired. A row, a receipt, a provider id, a heartbeat.
- **proof-of-proof**: the test that the proof is trustworthy. Reconcile identities against the provider, not counts.
- **obligation**: what an event owes, to whom, by when, with what exceptions. Written independently of the sender's code.
- **end state**: what should be true between two doors. The model's territory; code owns the doors.
- **adjudicated on live**: every finding from a dry run against production is judged by a human. Real faults stay open with an owner. Only a confirmed false alarm changes a check.
- **report-only**: the watchdog reads app data through a SELECT-only role; writes only the watchdog's own tables through a separate writer; a forbidden write is a test that must fail, and at this level the runtime holds nothing it could send with.
- **finding 0**: a door with no proof. It blocks any claim of coverage.

Door status words are fixed: **proven**, **failed**, **unknown**, **unsupported**. Unknown is a real answer and is shown, never hidden behind a boolean. Finding severities are `high`, `medium`, `low`. Verdicts are `correct`, `false_alarm`, `unsure`.

## Schemas

### Scope

Every id the watchdog writes starts with a scope, because two tenants or two installations can hold the same provider id. `installation` names one deployment of one app, `tenant` is the tenant inside a multi-tenant app or `null`, and `environment` is where the evidence came from; evidence from a preview deployment is never filed under production. The scope key is `installation/tenant/environment` with `-` for no tenant (`$KIT/core/scope.js`).

```json
{ "installation": "acme-prod", "tenant": "t_42", "environment": "production" }
```

### Door (DoorAdapter)

One module per door, written in code because a column map cannot say which join proves a turn completed or that a refused attempt is deleted. It declares its `id`, `direction` (`in | out | internal`), the `scopes` its events attach to, `listEvents(scope, window, cursor)` returning a `Page` whose `truncated` flag is honest, `proofOf(event)` returning a `Proof`, an optional `proofOfProof`, `owes(event)` returning obligations, `deliveryDoor` (`'none'` or a signal, per channel), `failureErasesEvidence`, an optional `verifyRecipient`, and `reads` (the tables or views it touches, for the receipt and the SELECT-only role).

```json
{ "id": "sms_outbound", "direction": "out", "scopes": ["conversation", "tenant"],
  "deliveryDoor": { "signal": "messages.delivered_at", "channels": { "sms": "none", "whatsapp": "messages.delivered_at" } },
  "failureErasesEvidence": true, "reads": ["outbound_send_attempts", "messages"] }
```

### Proof

Never a boolean. `status` is one of the four status words, `evidence` lists the rows or receipts that established it as refs a finding can quote, `reason` explains a failed, unknown or unsupported result in plain words, and `at` is the receipt's event time when known.

```json
{ "status": "unknown", "evidence": [{ "source": "outbound_send_attempts", "id": "osa_9f1", "field": "status", "value": "indeterminate" }],
  "reason": "Attempt is indeterminate: retry forbidden, settle by hand with evidence.", "at": null }
```

### Obligation

What an event owes, from the obligation table and never from the sender's predicates. `kind` is a stable kind from that table, `dueAt` is a UTC instant computed in code, `graceMs` is the slack before it reads as overdue, and `subject` is where the outcome should land.

```json
{ "kind": "reminder_24h", "dueAt": "2026-10-23T09:00:00.000Z", "graceMs": 21600000, "subject": { "type": "appointment", "id": "apt_771" } }
```

### Finding

`id` is built in code as `${scopeKey}:${checkId}:${kind}:${sortedEntityRefs}`; a slug a model wrote is display-only. `kind` comes from the client's fixed kind enum. `evidence` is a list of EvidenceRefs only; bookkeeping (verdict context, resolved reason) lives in `meta`. `wouldDo` and `wouldSay` are inert and never sent.

```json
{ "id": "acme-prod/t_42/production:reminder_missing:no_row_past_due:appointment-apt_771",
  "scope": { "installation": "acme-prod", "tenant": "t_42", "environment": "production" },
  "checkId": "reminder_missing", "kind": "no_row_past_due", "subject": { "type": "appointment", "id": "apt_771" },
  "severity": "high", "title": "24h reminder for appointment apt_771 is 7 hours overdue with no row",
  "detail": "Due 09:00 UTC with 6h grace; booking_reminders holds no row for step 24h.",
  "wouldDo": "Raise a missed-reminder task for the tenant", "wouldSay": null,
  "evidence": [{ "source": "appointments", "id": "apt_771", "field": "starts_at", "value": "2026-10-24T09:00:00Z" }] }
```

### Coverage

What a run positively examined. A check that cannot fill this in resolves nothing. `examined` lists subjects or intervals, `complete` is true only when every source page was read to the end, `freshAsOf` is the newest observation read, `policyVersion` names the obligation table version judged against, and `sources` records rows and truncation per source.

```json
{ "scope": { "installation": "acme-prod", "tenant": "t_42", "environment": "production" },
  "examined": [{ "type": "appointment", "id": "apt_771" }, { "from": "2026-10-17T00:00:00Z", "to": "2026-10-19T00:00:00Z" }],
  "complete": true, "freshAsOf": "2026-10-19T07:31:02Z", "policyVersion": "obligations@2026-10-19",
  "sources": [{ "name": "appointments", "rows": 212, "truncated": false }] }
```

## Invariants

Each of these is a rule a check, adapter, packet or page must keep. An eval that cannot show the rule holds does not pass.

- **Tenant scope on every id.** Finding, review and sweep ids start with the scope key. Evidence from one environment is never filed under another.
- **Only fresh positive coverage resolves.** An open finding resolves only when a later run with `coverage.complete` positively examined its subject, with `freshAsOf` newer than the finding's last evidence, and did not report it. A rejected model answer, a truncated page, a cached observation, a thrown check, a skipped or partial run, or a run on another generation resolves nothing.
- **Ids built in code.** Never from model text. A reworded finding keeps its id; the entities come from what its evidence points at.
- **Quotes must exist in the packet.** A model finding is accepted only when every evidence ref resolves in the packet it saw and the quote equals the value there (whole value, or a verbatim part of a long text). Anything else is dropped and counted as `rejected`.
- **Timing computed in code.** Every due instant, grace and overdue flag is in the packet's derived block. The model never does calendar maths and a timing finding is raised only where code already says overdue.
- **Stable-facts hash.** A packet is hashed on its stable facts so an unchanged subject is not sent to the model again; its stored findings are replayed instead.
- **Volatile inputs excluded.** Relative wording ("in 2 hours"), `now`, today's date and ages are added at prompt build time, never stored in the packet or the hash.
- **Only what can still be acted on.** A finding names something a person can still change. A subject whose end has passed (a tour, an appointment, an event, an order that has shipped) leaves every review packet the moment its end instant passes, computed in code, and the broad review drops anything about a message on one. An obligation that falls due after the end (a follow-up send, an invoice) is a rule check on that obligation, never a model retrospective on the finished subject. The reference build's first live day raised 76 findings, a third of them post-mortems on tours that had already run.
- **One problem, one finding.** A model review drops any kind a rule check already raises (a fixed `RULE_OWNED_KINDS` map per review), and the broad review drops a finding whose evidence all sits on a subject a subject review covers. A model answer that is dropped, for any reason, is kept on its review row (`raw.rejected`) and counted in the receipt; it is never shown as a finding, because "the model guessed and code refused it" is the watchdog's working, not the operator's problem.
- **A card reads in ten seconds, plain by default.** A finding card names its subject as the operator knows it (the tour, booking or customer by name, with its date and how far off it is) above the title, and its fact rows carry plain labels: a model finding's evidence is labelled from the packet it was judged against when the finding is written ('Neon Cactus: seat time', never `stops[1].seat_time`), and a rule finding shows only the facts a person acts on, with ids, hashes and sweep bookkeeping hidden and money, durations and times formatted. Everything hidden is one switch away in a page-level dev mode (exact refs and quotes, every stored key, check id, model and confidence, the trace link), which the trace page always uses. The reference build's first cards showed eleven rows of packet paths and UUIDs; the operator could not tell which venue a time belonged to, so the verdict buttons measured nothing.
- **Rule findings saved before model runs.** The sweep commits every rule check first, then runs model checks inside a time budget, so a killed sweep keeps its rule findings.
- **A failed settings read never counts as paused.** For a check, a gate that cannot be read is treated as on, not off, and a check that cannot read a setting says `unknown` rather than assuming the quiet case. The one reversal is an alert route under report-and-tell, where an unreadable setting reads as off, because an alert sent by mistake is the mistake.
- **Unknown is a real answer.** A door with no authoritative signal is `unknown` or `unsupported`, listed in the contract and the report, and never counted as coverage. A door with no proof at all is finding 0.
- **Report-only.** Checks run on a SELECT-only role over approved views; the read-only client throws on any write; a forbidden-write test must fail. A model check may write to one table of its own and nothing else. The deployed runtime holds no notification credential, no grant on any app table and no hub-write capability, so no setting can make it send: alerts exist as previews on the finding and the hub pulls a projection. That is a capability boundary, proven by what the runtime is not given, and the database test does not cover it; the report-and-tell gates do.
- **Two contract levels.** Report-only is the level every build ships at. Report-and-tell is the same code with a separately provisioned sender (credentials, the notification-table grant), added in a change of its own after the `alert_payload_bounded`, `alert_send_idempotent` and `alert_activation_authorised` gates pass; route settings are then operational controls, never the proof of either level.
- **Own key, own budget.** Model calls use the watchdog's own API key, never the app's shared one, and spend only in review slots within a cap recorded in the journal.

## Existing monitoring

A client often already has something watching it: an external uptime probe on a health route, an error tracker with cron check-ins, a job-receipts table or health dashboard it built itself, a stored provider status webhook, a scheduler with its own run history. The rule for all of them: an existing system is a **source** when the watchdog reads its records. It is never a door merely because it observes one. The webhook the app receives, the call the app makes and the job the app schedules stay the doors, whether their proof comes from the existing system or from new instrumentation. The watchdog's own observation reads are recorded as sources and receipts, never added as doors of their own, or every read-back would need a read-back.

The survey records every existing system under `## Existing monitoring` in MAPPING.md, including the ones left alone: the decision (read as source, or leave alone, with the reason), the doors and checks it supports, the exact claim its records establish and what they do not, its observation times and limits, and who owns its notifications. Reuse its proof only for what it establishes: a green health probe proves the route answered, not that a job ran or an obligation was met; an error-free interval proves nothing completed; a provider-wide status incident is context, not the outcome of one client operation; reading the same observation through two interfaces is not proof-of-proof.

An existing alert is evidence that another detector reported a fault, which may itself be wrong, and says nothing about whether anyone was notified. It never resolves a finding, never stands in for business recovery, never changes a verdict and never removes an incident from the eval. Matching a finding to an existing incident is bookkeeping kept in `meta`, separate from the evidence that established the finding. While report-only, the watchdog changes nothing in the existing system: it creates no incidents there, acknowledges or resolves none, and alters no alert rule.

## Artefact files under `.watchdog/`

| File | Written by | Must contain |
|---|---|---|
| `STATE.md` | `scripts/state-from-journal.mjs` and `scripts/journal-append.mjs`, both through `scripts/journal-lib.mjs`; nothing else | A phase table with status, artefacts, decisions, blocked reason; regenerated from the journal after every append, never edited by hand |
| `journal.jsonl` | the orchestrator, only through `scripts/journal-append.mjs` (created by its `init`) | One line per append, shape below |
| `MAPPING.md` | survey | Stack detected; existing monitoring decisions; per source a column map and a semantic contract (attempts vs completions, event time vs observed time, pagination order and cap, deletion on failure) |
| `CONTRACT.md` | survey | The doors table with the fixed status words and no empty proof cell; Obligations; Unsupported and unknown; Shared external ids |
| `EGRESS.md` | survey | Sections `Pseudonym`, `Fields`, `Retention` |
| `incident-sample.jsonl` | survey | About 20 incident rows, same row shape as `docs/incidents/incidents.jsonl` |
| `explainer.html`, `CANVAS.md` | explain | The one-screen explainer, and the page design brief with sections `Box and doors`, `Tokens`, `Parts`, `Keyboard path`, `Empty, erroring and unknown states` |
| `docs/incidents/incidents.jsonl`, `docs/incidents/holdout.json` | incidents | Rows with `id, found_by, kind, root_cause, watchdog{check, catchable, why}, existing_detection[{source, status, detected_at, notified_at, evidence}]`; a holdout object with `frozen_at` and `cases`, each case an id that exists with as-of inputs and a detection deadline (or `replayable: false` and a reason), and `adjudicated_by` and `adjudicated_at`; the phase leaves those three null and the orchestrator fills them from the human's answers before hashing. The validator enforces, here and in `incident-sample.jsonl`: `watchdog.catchable` is `yes`, `partly` or `no`; `watchdog.check` is a check id or `null` (before checks exist, a provisional name or `null`); `existing_detection` status is `yes`, `no` or `unknown`, and `no` needs evidence that the detector's history was complete |
| `HEARTBEATS.md` | heartbeats | Sections `Wrapper`, `Jobs`, `Parity`, `Doors`, `Role` |
| `OBLIGATIONS.md` | checks | The obligation table with its version and time zone, written from the business rules before the sender's code is read, plus the disagreements found afterwards |
| `CHECKS.md` | checks | Sections `Obligations`, `Clusters`, `Checks`, `Evals`, `Live dry run`, `Adjudication` |
| `REVIEW.md` | review | Sections `Packets`, `Grounding`, `Slots`, `Models`, `Bake-off`, `Decision` |
| `PAGE.md` | page | Sections `Page`, `Trace`, `Verdicts`, `Alerts`, `Hub` |
| `EVAL.md` | eval | Every gate below with a value; `Existing monitoring comparison`; `Unsupported and unknown` listing every unknown or unsupported door in `CONTRACT.md` |
| `REPORT.md` | prove | `Status: operational` with the sweep id, plus `Unsupported and unknown` listing every unknown or unsupported door in `CONTRACT.md` |

Two format rules hold in every `.watchdog/` markdown file: braced text outside a fenced code block or an inline code span reads as a template placeholder and fails validation, and a pipe inside a table cell splits the row, so write enum lists with commas and "or".

### Journal entry

One JSON object per line, appended by `journal-append.mjs` and never edited in place. The last line for a phase is the current one. `started`, `finished` and each decision's `at` are ISO 8601 timestamps with a zone (`Z` or an offset); `finished` is `null` while the run is open.

```json
{ "phase": 0, "skill": "watchdog-survey",
  "started": "2026-10-19T09:00:00Z", "finished": "2026-10-19T11:20:00Z",
  "artefacts": [{ "path": ".watchdog/CONTRACT.md", "sha256": "ab12..." }],
  "inputs": [{ "path": ".watchdog/CONTRACT.md", "sha256": "ab12..." }], "decisions_rev": "9f3e...",
  "decisions": [{ "id": "d0.caps", "kind": "authorisation", "outcome": "approved", "answer": "USD 20 a day, 5000 rows a day", "by": "owner", "at": "2026-10-19T12:00:00Z", "pre": false }],
  "blocked": null }
```

The first line of the journal is a `meta` entry written by `init`: `{ "meta": true, "mode": "step", "kit_rev": "<git rev or core/VERSION>", "at": "..." }`; `--mode` appends another. `inputs` is captured at `started` from the upstream artefacts in the dependency table below, and `decisions_rev` with `decisions_read` record the decisions that existed at that moment; `finished` recomputes them, and a changed input or a changed or vanished decision fails the phase and names the earliest phase it invalidates. A decision recorded after `started` is not drift, which is what lets run-ahead mode build while approvals wait.

### Decisions

Every human stop is a decision with a fixed id, so a script can tell whether it has been made and a skill can ask for it by name. The catalogue:

| id | phase | kind | outcome | may be answered early |
|---|---|---|---|---|
| `d0.scopes`, `d0.egress`, `d0.caps` | 0 | authorisation | approved or rejected | no: nothing reads production, a provider, host logs or an error tracker, and nothing spends, until all three are approved |
| `d1.explainer`, `d1.canvas` | 1 | approval | approved or rejected | no; gates phase 6 |
| `d2.holdout` | 2 | verdicts | answered (the count adjudicated) | no; gates phase 7 |
| `d3.credential` | 3 | credential | answered (a variable name, never a value) | yes, and only when the phase asks |
| `d4.verdicts` | 4 | verdicts | answered (the count adjudicated) | no; gates phase 5's bake-off and phase 7 |
| `d5.key` | 5 | credential | answered (a variable name) | yes |
| `d5.cap`, `d5.slots` | 5 | choice | answered | yes |
| `d5.model` | 5 | choice | answered | yes, as "the bake-off winner", the one decision a rule may resolve, recorded `by: rule:d5.model` from the EVAL numbers |
| `d7.eval` | 7 | authorisation | approved or rejected | no: it approves the concrete reads, writes and cost table the phase presents |
| `d7.merge` | 7 | authorisation | approved or rejected | no, and recording it never merges; the merge is the human's act |
| `d8.deployed` | 8 | credential | answered (the deployed revision) | no; phase 8 cannot start without it |

An authorisation or approval counts only as `approved` with a human `by`; `rejected` is recorded and sends the phase back. Verdicts are human: a `by` starting `rule:` is invalid on every id but `d5.model`. A decision answered before its phase ran carries `pre: true` and is valid only on the ids marked above.

### Dependencies and parallel phases

| Phase | Needs artefacts from | Needs decisions | Writes |
|---|---|---|---|
| 1 explain | 0 | `d0.*` | `.watchdog/explainer.html`, `.watchdog/CANVAS.md` |
| 2 incidents | 0 | `d0.*` | `.watchdog/incident-shards/`, `docs/incidents/`, `scripts/eval-incidents-schema.mjs` |
| 3 heartbeats | 0 | `d0.*` | `lib/watchdog/` core, db and jobs, migrations, the package manifest and lockfile |
| 4 checks | 2, 3 | `d0.*` | `lib/watchdog/checks/`, `.watchdog/OBLIGATIONS.md`, `.watchdog/CHECKS.md`, check evals |
| 5 review | 4 | `d0.*`; `d4.verdicts` before the bake-off; `d5.key`, else the checks raise `model_unavailable` | `lib/watchdog/review/`, `.watchdog/REVIEW.md`, the bake-off section of `EVAL.md` |
| 6 page | 4, 5 | `d0.*`, `d1.explainer`, `d1.canvas` | the page route, `.watchdog/PAGE.md` |
| 7 eval | 2, 4, 5, 6 | `d0.*`, `d2.holdout`, `d4.verdicts`, `d7.eval` | `.watchdog/EVAL.md`, `REPORT.md` |
| 8 prove | 7 and the human's deploy | `d7.merge` recorded | `.watchdog/REPORT.md` |

Two upstream files are read but not hashed as inputs, because the human writes adjudication into them after the next phase has started: phase 4 does not hash the holdout, and phase 5 does not hash `CHECKS.md`. Phases whose artefact inputs are all finished and whose write sets are disjoint may run at the same time as separate subagents: 1, 2 and 3 once phase 0 is approved. The orchestrator is the only journal writer. A phase whose decisions are pending but whose artefact inputs exist may build in run-ahead mode (4 after 2 and 3) and waits only where the table says a decision gates it (6 waits for `d1.*`).

### Modes

`mode` is `step` (stop and ask at every checkpoint) or `run-ahead` (answer now what may be answered early, build everything whose artefact inputs exist, queue every other decision and list them in phase order on `--status`). The mode changes when questions are asked, never which decisions exist or who makes them.

`blocked` is `null` or `{ "reason": "...", "needs": "..." }`. A phase is done only when `started` and `finished` are valid timestamps, `blocked` is null, the entry records every artefact the validator requires for that phase, every recorded artefact reads back from disk with the sha256 the entry holds (the read-back result), the inputs and the other phases' decisions it read at `started` are unchanged, every decision id the catalogue gives the phase (`d3.credential` only once asked) has a valid latest entry with outcome `approved` or `answered`, a non-empty answer, a human `by` and a valid `at`, and the artefacts pass the content checks: required sections present and not empty, and no template placeholder such as `{client}` left outside a fenced code block. A `rejected` outcome reads "sent back: <id> rejected"; an unknown id, a missing outcome, an id-less decision on a phase with catalogue ids, or `pre: true` on an id that may not be answered early is invalid. `scripts/journal-lib.mjs` is the one implementation of this rule; the validator and STATE.md both use it, and the validator lists every failure with its fix.

## Gates

These are the pass conditions the build is judged against. Each must appear in `EVAL.md` with a measured value; a gate without a value is a listed next step, not a pass.

| Gate id | Passes when |
|---|---|
| `doors_no_unknowns_hidden` | Every door in `CONTRACT.md` has one of the four status words, and every unknown or unsupported door is listed in `EVAL.md` under `## Unsupported and unknown` (phase 7); phase 8 re-checks the same list against `REPORT.md` |
| `holdout_recall_by_severity` | Replay on the frozen holdout reports recall per severity (high, medium, low), each against the threshold the human set at adjudication |
| `live_findings_adjudicated` | Every finding from the live dry runs carries a human verdict; real faults have an owner |
| `model_eval_all_cases_counted` | The bake-off counts every case (planted, held-out real, healthy), with no case dropped or retried out of the tally |
| `own_key_own_budget` | Model calls use only the watchdog's own key and stayed within the journal's cap |
| `forbidden_write_fails` | The forbidden-write test against the SELECT-only role fails as it must |
| `real_sweep_observed` | One scheduled sweep on the deployed revision was observed end to end, with its receipt and sweep id recorded |
| `alert_payload_bounded` | report-and-tell only: an offline eval shows every rendered alert carries only the finding id, kind, severity, scope key and links |
| `alert_send_idempotent` | report-and-tell only: an offline eval shows a crash between acceptance and proof does not duplicate on retry, and an older generation is never resent after a newer claim |
| `alert_activation_authorised` | report-and-tell only: the journal holds the human's authorisation of the sender's credentials and grants, the route list and its caps, before they are provisioned |
