# core changelog

## 0.2.6 (25 Oct 2026)

From the reference build's first sweep after a credit outage: a second review of one tour did not repeat five findings whose facts had not changed, and the sweep closed them. A review that stays silent is not evidence a problem went away.

- `coverage.keepOpen(fn)`: a check may hold open a finding it examined and did not report; `resolutionDecision` then leaves it open (`held open: <why>` in `notResolved`). A `left_scope` subject is never held.
- `grounding.stillQuoted(packet, refs, quotes)`: true while every quoted value is still at its ref; a long quote whose list item moved may be found at exactly one other item, a short value (a status) never is.
- `watchdog-review`: every model check passes `keepOpen` holding a finding while `stillQuoted`, unless today's refusals would drop it or the same sweep raised a finding of the same kind about the same entity (a reworded replacement). Eval cases for each.
- `watchdog-review`: a packet field compared with what a party was sent must be the value the app would send now, computed as the send computes it, never a stored seed that goes stale. The reference build compared a stored seat time with the arrival time in each venue request and raised five false alarms; on live every venue had been told exactly the time the send resolves.

## 0.2.5 (21 Oct 2026)

From an adversarial review of 0.2.3 and 0.2.4 (10 points, 9 accepted).

- `EvidenceRef.label` (display only): kept by `run.js` normalisation, left out of the verdict fingerprint (`verdicts.js`), with eval cases. 0.2.3 told builders to store `evidence.labels`, which core dropped.
- Imported history is waived per obligation, never wholesale; `MAPPING.md` lists waived and still-owed obligations per import.
- Alert-only refusal counts notification rows only; a finding that an alert is wrong is kept.
- Rule ownership of a model kind is scoped to the rule's coverage; one condition, one owning check; grouping only for one fix and one verdict meaning, membership in the fingerprint.
- An id rule change is a transition with a verdict-carrying map, not a rewrite on replay.
- A reply proves delivery only on the same channel, from the same recipient identity, after the send.
- The developer tab is decided by a declared owner per check, never by `subject_type: 'system'`.
- `watchdog-eval` 4a: mandatory both-direction cases for every refusal and dedup rule. `prompt-rules.md` no longer asks the model to review past subjects.

## 0.2.4 (21 Oct 2026)

From the reference build's third-day queue: 121 to review, of which 52 had resolved, about 25 repeated each other and 12 were noise. No core module changes shape.

- Invariant **imported history is not an obligation**: survey records imports under `## Imported history`; checks exclude imported rows through `lib/watchdog/migrated.js` with an imported trap per eval.
- Invariant **an alert the app already shows is not a finding**: alert-only model findings are refused.
- **One problem, one card** extended across checks: whole-subject kinds keyed on the subject, payment and reply kinds rule-owned, same-fix findings grouped, refusals and ids reapplied on replay.
- Invariant **a reply proves delivery**.
- Invariant **the review queue is open findings an operator can act on**: resolved-unjudged out of To review; a For the developer tab.

## 0.2.3 (21 Oct 2026)

Contract and skill changes from the reference build's finding cards, which showed packet paths, UUIDs and sweep bookkeeping where an operator needed names. No core module changes shape.

- Invariant **a card reads in ten seconds, plain by default**: context line naming the subject, plain fact rows, a page-level dev mode for refs, quotes, ids and the trace.
- `watchdog-review` stores `evidence.labels` built in code from the packet, and the subject's name and date, on every model finding.
- `watchdog-page`, `page-anatomy.md` and the `CANVAS.md` template carry both modes; the page-model eval checks that no plain row's value is an id.
- Uptime strip: bars of one height coloured by sweep outcome, new-finding counts above, the open trend in words; legend only for states that occurred; the precision row says what its total counts.

## 0.2.2 (20 Oct 2026)

Contract and skill changes from the reference build's first full live day (76 findings, most of them noise). No core module changes shape.

- Invariant **only what can still be acted on**: a finished subject leaves every review packet when its end instant passes; post-end obligations are rule checks.
- Invariant **one problem, one finding**: model reviews refuse rule-owned kinds; the broad review refuses what a subject review covers or what sits on a finished subject; dropped answers stay on the review row and in the receipt, never as findings.
- `watchdog-review` skill, `prompt-rules.md` and the `REVIEW.md` template carry both, with a required test that a subject which ended earlier today is out.

## 0.2.1 (19 Oct 2026)

- `run.js` check validation: two checks may share one own table (the reviews table is keyed on check id). The first client's two model checks both write `watchdog_reviews` and 0.2.0 refused the whole list. Kit tables and read tables are still refused.

## 0.2.0 (19 Oct 2026)

From the core review of 19 Oct 2026 (6 high, 12 medium, 7 low) and a review of `self-check.js` against the same invariants. Every change has an eval case named after the invariant it proves; each was run against the 0.1.3 core and fails there, except where noted.

**Finding ids change shape. Existing `watchdog_findings` rows need an id migration** before a 0.2.0 sweep runs against them, or every open problem is filed again under a new id and the 0.1 rows can resolve as `recovered`, losing their verdicts. `core/sql/0007_finding_id_v2.sql` is a template migration with the rewrite rule in its comments (the kit does not run it), and `scope.js` `findingIdV2(row)` computes the new id for a row that can be rebuilt. `watchdog_sweeps.scope_key` changes only for a scope with a character the key now encodes; the migration keeps its generation.

### High: a finding resolved when it should not, or a stale sweep won

- `coverage.js`: a read that resolves with an error or no data, or rejects, is a failed source; the coverage is incomplete (`<table> read failed`) and the receipt marks the source `readFailed`. Eval: `failed_read_resolves_nothing` (coverage and run).
- `coverage.js` `normaliseCoverage`: a returned Coverage can only narrow the recorder's. `complete` is the AND of both and of every source; sources and reasons are unioned; `freshAsOf` is the older. Eval: `returned_coverage_cannot_override_incompleteness` (coverage and run).
- `run.js`: a dropped malformed finding makes the check's run partial, so nothing it was silent about resolves. Eval: `dropped_malformed_finding_resolves_nothing`.
- `run.js`: a finding with no `evidenceAt` is stored with `meta.evidence_defaulted: true`, and interval coverage never matches it; only examining its subject resolves it. Eval: `interval_never_resolves_defaulted_evidence`.
- `run.js`: every reconcile write is conditional on the row's `last_generation` not being newer than the sweep's. New rows are inserted with `ignoreDuplicates`, existing rows are updated one by one under the condition, resolves add it to their `status = 'open'` guard, and a write refused by a newer sweep throws `StaleGenerationError`. `first_seen_at` is never rewritten. DECISIONS.md records the per-row compare as accepted, replacing its 0.1 rejection. Evals: `stale_refresh_is_refused`, `stale_resolve_is_refused`.
- `scope.js`: finding ids are injective: the readable slug plus `:` and 16 hex of FNV-1a 64 over the raw tuple (scope with tenant null kept as null, check id, kind, subject, sorted other entities). The scope key percent-encodes any character outside `[A-Za-z0-9_.@#+~-]`, and a tenant literally `-` is `%2D`. New exports: `idHash`, `entityKey`, `findingIdTuple`, `sameScope`, `findingIdV2`, `FINDING_ID_VERSION`; `parseFindingId` returns five parts and null for a 0.1 id. `grounding.js` de-duplicates entities by exact identity, not slug. Evals: `finding_ids_are_injective` (scope and run), `finding_id_v2_migration_rule`.

### Medium

- `run.js`: `writes` is at most one table, never a kit table, another check's table or a table any check lists in `reads`; a bad list refuses the sweep before the lease is claimed and is recorded on its `job_runs` row. Eval: `check_writes_one_own_table`.
- `readonly-client.js`: the client exposes `from()` only; `rpc`, `schema`, `rest`, `storage`, `functions`, `auth`, `channel` and any other property throw `WatchdogWriteRefused`. Evals: `readonly_client_refuses_<name>` for each (rpc was already refused in 0.1.3, so that case passes there too), `readonly_client_exposes_from_only`.
- `run.js` `resolutionDecision(result, row, scope)`: coverage for another scope resolves nothing. Eval: `coverage_scope_must_equal_sweep_scope`.
- `run.js` `validateChecks`: a duplicate, missing, non-string or malformed check id (`/^[a-z][a-z0-9_]*$/`) refuses the sweep at start. Eval: `check_ids_unique_and_valid`.
- `coverage.js`: `freshAsOf(at, { source })` keeps the newest observation per named source and the record takes the oldest of them; the receipt shows `coverage.freshness` per source. An unnamed call is unchanged. Eval: `fresh_as_of_takes_the_stalest_named_source`.
- `run.js`: each check is raced against the time left before the hard stop (or its own `timeoutMs`); a check that loses is a `check_error` and the sweep still closes. A model check is not started once the model start budget has passed; it is recorded as skipped (`receipt.skipped`, `summary.checksSkipped`) and resolves nothing. Evals: `hung_check_times_out`, `model_check_skipped_after_start_budget`.
- `coverage.js`: only `count: 'exact'` lifts truncation. Eval: `estimated_count_does_not_lift_truncation`.
- `run.js`: the sweep reads its findings in pages ordered by id, each after the last id seen, until an empty page, so open findings past the server cap are all evaluated. Eval: `open_findings_beyond_the_server_cap_all_resolve`.
- `run.js` `chunkForIn`: `in` lists are split by URL-encoded length (`IN_URL_CHARS`, 6000), not by count. Eval: `in_lists_fit_in_a_url`.
- `run.js`: a refresh sends `meta` only when it must clear the resolution keys or the `evidence_defaulted` flag changed; a resolve re-reads `meta` just before its conditional update and adds only its own keys. The window that remains is in DECISIONS.md. Eval: `meta_survives_concurrent_writes`.
- `coverage.js`: a range sequence can complete: a page that continues a cut sequence and comes back short (or empty) clears the table's truncated flag; a page equal to its range stays truncated. Eval: `range_sequence_completes`.
- `run.js`: the receipt records `pageCap: { assumed, given, note }`, noting a server cap below it is not detectable. `RECEIPT_VERSION` is 3. Eval: `receipt_names_the_page_cap`.

### Low

- `sweep-generation.js`: a first-ever claim that loses the insert race (23505) is `SweepBusyError`. Eval: `first_claim_race_is_busy`.
- `sweep-generation.js` `releaseSweep`: checks the returned error and a release that matched no row, reports both through `onError`, and returns whether it released. `run.js` releases, and closes the heartbeat, at the sweep's `now` plus the elapsed time on its clock, not at its start. Eval: `release_is_checked_and_timed`.
- `verdicts.js`: volatile field names are matched as whole words, case-sensitively; `messageMs`, `coverageHours`, `storageMs` and `member_since` count again. Eval: `volatile_fields_are_whole_words`.
- `verdicts.js`: the fingerprint sorts evidence refs, so citation order does not stale a verdict. Eval: `fingerprint_ignores_evidence_order`.
- `review-common.js` `findingKey`: entities are de-duplicated by exact identity and sorted before the length test and the `more-<hash>` hash, which is of the exact identities. Eval: `long_entity_lists_keep_their_id_in_any_order`.
- `contracts/finding.d.ts`: `entities`, `evidenceAt`, nullable `detail`, `link`, `wouldDo` and `wouldSay`; `FindingInput`; `CheckResult.coverage` optional and a bare array accepted; `Check.title`, `writes`, `reads`, `timeoutMs`; `CoverageRecorder`; `CheckContext.budget`, `coverage`, `generation`, `runId`; `failed` on a source.
- `cron-run.js`: `DEFAULT_MANUAL_HEADER` is `x-watchdog-token`; a handler that returns no Response is ok with a note. `job-run.js` `finishJobRun` reports an update that matched no row. Evals: `manual_header_is_client_neutral`, `non_response_handler_is_ok_with_a_note`, `finish_reports_zero_rows`.

### self-check.js

- A truncated `job_runs` page no longer reports every slot older than the oldest run read as missed; those slots are neither examined nor reported. Eval: `self_check_truncated_page_raises_no_false_misses`.
- Each finding's evidence cites its own slot, in the EvidenceRef shape. Eval: `self_check_evidence_cites_its_slot`.
- A negative grace, or a cadence or lookback that is not a positive number, is refused. Eval: `self_check_refuses_nonsense_timing`.
- `staleAlarm` counts only ok runs by default and returns `lastOkAt` beside `lastFinishedAt`. Eval: `stale_alarm_needs_an_ok_run`.
- `left_scope` parses the slot after the last `@`, and the header no longer says a missed slot can never recover (a late run row does recover it).
- Left open: `job_runs` has no scope column, so in an installation sweeping several scopes under one job name another scope's run covers this scope's slot. Written in the header.

### Evals

- `evals/lib/fake-postgrest.mjs`: `range(a, b)` honours its offset; one comparison rule for `gt`/`gte`/`lt`/`lte`, the `or()` forms and `order` (numbers as numbers, else code units); a `maxRows` server cap; a `beforeWrite(table, op, payload)` hook.
- `evals/lib/harness.mjs`: a FAIL line is always printed, even after `quiet()`; `eval-self-check.mjs` quietened the whole file and hid its own failures.
- `eval-run.mjs`: the "never writes any table but its own" case runs its own sweeps over every path on a fresh client; it read the shared client's write log from earlier cases.
- `eval-self-check.mjs`: the truncated-page case asserted nothing (it read a receipt from `watchdog_sweeps`, which has none); replaced.
- `eval-review-schedule.mjs`: `half_hour_offset_zones` (Kolkata, and Adelaide across its April change) and `slot_in_a_spring_forward_gap_fires_once`. Both pass on 0.1.3: the review found no schedule defect, and these widen the eval.
- Evals that hard-coded ids build them with `buildFindingId`. New file `eval-scope.mjs`.

## 0.1.3 (19 Oct 2026)

- `self-check.js`: the watchdog watching itself. `sweepSelfCheck` runs inside a sweep and raises `sweep_missed` on each recent slot with no run (resolves only by `left_scope` when the slot ages out); `staleAlarm` is pure and runs in the page model and the hub, where a dead sweep cannot hide it. Eval: `evals/eval-self-check.mjs`.

## 0.1.2 (19 Oct 2026)

Existing monitoring: the survey may now read a client's existing monitor as a source, and the page may match findings to its incidents, so the sweep has to keep that bookkeeping.

- `run.js` reconcile: refreshing or reopening an open finding now carries every key of `meta` across the rewrite (the verdict context, `existing_monitoring`, alert state) and clears only the resolution record (`resolved_reason`, `resolved_generation`, `resolved_note`, `resolved_run_id`). Before, everything but the verdict context was dropped on every sweep.
- `contracts/door.d.ts`: a door without an authoritative proof-of-proof is no longer called finding 0; its proof stands for what it establishes and the reconciliation is `unknown` or `unsupported`. Finding 0 stays reserved for a door with no proof.

## 0.1.1 (19 Oct 2026)

Two changes found while vendoring the core back into the first client.

- `run.js` `resolutionDecision`: a finding whose subject the check did not examine still resolves when the check's `resolveReason(row)` answers `left_scope`, on a complete run fresher than the finding's evidence. Without it every finding about an event that had passed, an item that was confirmed or a job slot older than the lookback stayed open for ever. `recovered` still needs the subject examined.
- `verdicts.js`: the fingerprint leaves out an EvidenceRef whose `field` is a volatile key (an age, `reviewed_at`, `model_slug`, the bookkeeping keys), as it already left those keys out of an evidence object.

## 0.1.0 (19 Oct 2026)

First extraction of the generic runtime from the reference build (`lib/watchdog/*`, `lib/jobs/job-run.js`, `lib/jobs/cron-run.js`, `scripts/lib/fake-postgrest.mjs` and the run, receipt, review-schedule and job-run evals), against `core/contracts/finding.d.ts` and `door.d.ts`.

### Extracted

- `run.js`: the two-phase sweep (rule checks committed before model checks), the lifecycle (new, refreshed, reopened, resolved), the check_error finding for a check that throws or returns rubbish, the time budget handed to model checks, the receipt stored under `job_runs.summary.receipt`.
- `coverage.js`: the counting client, per-check and sweep-wide ledgers, the receipt's per-source rows.
- `review-common.js`: own-key-only API key, model error classification, retry backoff, the single model_unavailable finding, the finding id built in code from evidence.
- `grounding.js` (from `packet.js` and `checks/tour_review.js`): parseRef, formatRef, resolveRef, quoteOf, normaliseQuote, quoteMatches, locateQuote, hasPII, scrubText, the index-correction rule, checkFinding and checkReview.
- `review-schedule.js` and `wall-time.js` (from `london-time.js`): slots, latest and next slot start, reviewedThisSlot, wall-clock conversion either side of a clock change.
- `verdicts.js`: fingerprint, verdict context, staleness, withCurrentVerdict.
- `job-run.js` and `cron-run.js`: heartbeats, trimSummary, safeReceipt, withJobRun, the scheduled-route wrapper.
- `evals/lib/fake-postgrest.mjs`: copied unchanged apart from its header.

### Changed from the reference build

- Every finding, review and sweep is keyed on a Scope (`scope.js`): id is `${scopeKey}:${checkId}:${kind}:${entityRefs}`; rows carry `installation`, `tenant`, `environment`; every read and the open count are filtered by scope.
- A finding is `{ kind, subject, entities?, evidence: EvidenceRef[], evidenceAt? }` rather than `{ subjectType, subjectId, evidence: object }`. The evidence column is the ref list; sweep and verdict bookkeeping moved to a `meta` jsonb.
- Resolution needs a Coverage record (`coverage.js` `createCoverage`): complete, positively examined the subject or an interval holding its last evidence, fresher than that evidence. "Ran cleanly" no longer resolves anything. The decision is `resolutionDecision`, exported. A resolved reason is one of `recovered`, `cancelled`, `left_scope`.
- The counting client marks a page at the PostgREST cap (default 1000) or at the asked-for limit as truncated unless an exact count proves otherwise; a truncated source makes coverage incomplete.
- A SweepGeneration (`sweep-generation.js`, table `watchdog_sweeps`) is claimed before phase 1 and checked before every reconcile write; a stale write throws `StaleGenerationError` and saves nothing; a live lease refuses a second sweep unless forced.
- Checks run on a read-only client (`readonly-client.js`): insert, update, upsert, delete and rpc throw `WatchdogWriteRefused`. A check that must store its own reviews declares `writes: [table]` and gets a scoped writer.
- Manual and cron sweeps record distinct job names (`watchdog.sweep`, `watchdog.sweep.manual`).
- `cron-run.js` no longer builds a Supabase client itself; it takes `client` or `clientFactory`. Observation failures go through `onObservationError`.
- `review-schedule.js` takes an IANA time zone (default UTC); the London clock-change evals are kept against `Europe/London`.
- `grounding.js` is subject-agnostic: `listTypes`, `typeRank`, `kinds`, `keyTypes`, an `entityOf` hook and `root` are passed in. `asData` wraps inbound text as data for a prompt.
- `review-common.js`: `findingKey` takes the Scope and returns the full id plus subject and entities; `kindProperty(kinds)` replaces the fixed list; `modelUnavailableFinding` is in the contract shape.
- `verdicts.js`: the fingerprint includes the scope; staleness reads `meta.verdict_context`; system findings are recognised by kind or subject type.

### Left out (client-specific)

Tour and ops packets, prompts, PROBLEM_KINDS, EXPECTED_SETTINGS, the n8n check and snapshots, the page model, the receipt's fixed SOURCES list and TABLE_WORDS, name scrubbing from database rows, the client's schedule of cron jobs.
