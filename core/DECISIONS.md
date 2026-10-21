# core decisions

Semantics the contracts did not settle, with the alternative rejected. Each is a default a client may override where the module says so.

"The reference build" below is the first installation the core was extracted from; the kit names no client, so that phrase is the only name it gets.

## Finding id: entity refs are the subject plus named entities, never the evidence refs

`entityRefs` in `${scopeKey}:${checkId}:${kind}:${entityRefs}:${hash}` is the sorted, de-duplicated `type-id` list of the finding's `subject` plus any `entities` the check names. A rule check usually names only the subject; a model finding passes the things its evidence points at (`findingKey`), which is how the reference build kept a reworded finding on the same row.

Rejected: hashing the EvidenceRef list into the id. Evidence changes between sweeps (a value refreshed, a second ref added) without the problem changing, so that would split one open problem into several rows and break verdicts.

## Finding id: a readable slug plus a hash of the raw tuple (0.2.0)

The 0.1 id was the slug alone, and the slug is lossy: any character outside `[A-Za-z0-9_+\-#.@]` became `_`, `-` and `+` were both separators and allowed inside ids, and the subject was not told apart from the other entities. `a b` and `a_b`, two non-ASCII names, `x-1` naming `y-2` and `x` with id `1+y-2`, and x naming y against y naming x all shared a row; within a sweep the last one won silently, and across sweeps one problem's upsert moved another's row. The id now ends in `:` and 16 hex characters of FNV-1a 64 over the JSON of `[2, [installation, tenant, environment], checkId, kind, [subject.type, subject.id], sorted other entities]` (`findingIdTuple`). Tenant null stays `null` in the tuple, so it is never the same as a tenant called `-`. The subject is first and is removed from the entity list, so naming the subject again as an entity changes nothing, while swapping subject and entity does.

Rejected: percent-encoding every segment instead. It is injective too, but turns every id with a dash into `%2D` soup on the page and in a grep; the slug is for people and the hash is for the database.

Rejected: a cryptographic hash. The inputs are the client's own ids, not an adversary's; FNV-1a 64 is dependency-free and runs in the browser, where the page parses ids. 64 bits keeps an accidental collision out of reach for any realistic number of findings.

Rejected: a database check that `id` starts with the scope key. Computing the percent-encoded key in SQL is not portable across the clients' databases; `parseFindingId` and the eval do the same job in code.

## Scope key separator

`installation/tenant/environment`, with `-` for no tenant. Since 0.2.0 each part is percent-encoded outside `[A-Za-z0-9_.@#+~-]` (it was `_` substitution), and a tenant literally named `-` is written `%2D`. The scope key is also the `watchdog_sweeps` primary key, so under substitution `acme prod` and `acme_prod` shared one lease and one generation; encoding makes the key injective. `/` and `:` never appear inside a part, so `parseFindingId` can split on `:` safely.

Rejected: a hash of the scope. Readable ids are what the page, the incidents log and a grep rely on, and an ordinary installation name (`acme-prod`) encodes to itself.

## Coverage freshness defaults to the run's `now`

`freshAsOf` is the newest `observedAt` a check reports; a check that reports none gets the sweep's `now`, because the read happened then. A finding's `last_evidence_at` defaults the same way when the check gives no `evidenceAt`. Resolution requires `freshAsOf` strictly later than `last_evidence_at`, so a run at the same instant as the evidence cannot resolve it.

Rejected: refusing to resolve when no `observedAt` was reported. Most rule checks read live tables with no observation timestamp; that would make them unable to clear anything.

## Freshness across sources is the stalest named source (0.2.0)

`freshAsOf(at, { source })` keeps the newest observation per named source, and the record's `freshAsOf` is the oldest of those (and of the unnamed newest, if any). In 0.1 the record kept the newest of everything, so a live table read at 08:59 hid a cache last filled at 05:00 and the cached observation passed the fresher-than-evidence test, which the invariant forbids. The receipt shows each source's freshness under `coverage.freshness`. An unnamed `freshAsOf(at)` keeps its 0.1 meaning, so existing checks are unchanged.

Rejected: always taking the minimum, named or not. A check that reports `freshAsOf` once per row it read would then be as fresh as its oldest row, which is not what an unnamed call meant.

## A defaulted evidence time is never matched by an interval (0.2.0)

When a finding has no `evidenceAt`, `last_evidence_at` is the sweep's `now` and `meta.evidence_defaulted` is set. `resolutionDecision` passes no time to the interval test for such a row (or a row with no `last_evidence_at`), so it resolves only when its subject is examined. In 0.1 an event that aged out of a `[now - 24h, now)` window was resolved as `recovered`, because the window held the previous sweep's time, not the event's.

Rejected: refusing every finding without `evidenceAt`. A subject-examining check has no use for an event time, and requiring one would break every rule check that names its subject.

## A failed read makes the coverage incomplete (0.2.0)

The counting client records a read that resolved with an error, with no data, or that rejected, as a failed source; `finish()` then reports `complete: false` with `<table> read failed`, and the receipt marks the source `readFailed`. A check that treats `data: null` as an empty table would otherwise have examined everything and resolved every finding on a timeout.

Rejected: throwing from the counting client. The check may legitimately handle the error (retry, fall back) and still report what it found; only its silence is untrustworthy, as with truncation.

## A returned Coverage can only narrow the recorder's (0.2.0)

`normaliseCoverage` takes `complete` as the recorder's AND the returned value AND no truncated or failed source in either list; sources and reasons are the union; `freshAsOf` is the older of the two. In 0.1 a returned `{ complete: true, sources: [...] }` replaced the ledger's sources and the recorder's `incomplete()`, so it resolved findings on a truncated read. Coverage naming a scope other than the sweep's resolves nothing.

## A dropped malformed finding makes the run partial (0.2.0)

When `normaliseFindings` drops a finding (no kind, subject or title), the check's run is partial: it saw a problem it failed to describe, so its silence about that subject is not evidence of recovery. In 0.1 the predecessor of a badly formed finding resolved as `recovered` while the check still saw the problem.

## "Positively examined" is a listed subject or a containing interval; nothing is implied

A check must call `coverage.examined(...)`, `examinedRows(...)` or `examinedInterval(from, to)`; reading a table does not imply examining every subject in it. The one exception is the check itself: a check that returned without throwing has examined `{ type: 'system', id: <checkId> }`, so its own `check_error` finding can clear.

One more exception (0.1.1): a check's `coverage.resolveReason(row)` answering `left_scope` resolves the finding even though its subject is not in the examined list, provided the run was complete and fresher than the finding's evidence. A subject that fell out of the check's window (an event now in the past, an item that was confirmed, a job slot older than the lookback) cannot be positively examined, and leaving it open for ever would be the wrong answer; the check says so explicitly, in code, from the row's subject. `recovered` still needs the subject examined.

Rejected: deriving examined subjects from the counting ledger's row ids. The ledger does not know a row's subject type, and a filtered select (status = open) reads a subset the check would then wrongly claim to have examined in full.

## A page equal to the asked-for limit is truncated, except `limit(1)` and `single()`

The brief asked for the 1000-row cap to surface. A check that asked for 400 and got 400 is in the same position, so it is marked truncated too. `limit(1)`, `single()` and `maybeSingle()` are reads of "the one row", so they are not. An exact `count` equal to the page lifts the flag; a larger one confirms it. Since 0.2.0 only `count: 'exact'` counts: a `planned` or `estimated` count is a guess, and a guess below the page hid a cut.

Rejected: cap-only detection. It would let a check with its own smaller limit pass as complete.

## A range sequence can complete (0.2.0)

The 0.1 truncated flag was sticky per table, so a check that paged 1500 rows with `range(0, 999)` and `range(1000, 1999)` still read as truncated, and the paging the previous decision assumes was impossible. The ledger now remembers where a cut page ended; a `range(start, ...)` page that starts exactly there and comes back shorter than its range (or empty) clears the flag. A page exactly as long as its range stays truncated. The ledger cannot see a changed filter between pages, so a check that pages must keep its filters and order the same.

Rejected: letting a check declare "read to the end". A declaration is a promise; a short continuation page is evidence.

## The page cap is a parameter the receipt records (0.2.0)

`pageCap` defaults to PostgREST's 1000. A server max-rows below the cap given cannot be detected from a response (a 500-row page under a 1000 cap reads as the whole table), so the receipt carries `pageCap: { assumed, given, note }` for a human to check against the project setting. The sweep's own reads of its findings do not depend on it: they page by id until an empty page.

Rejected: making `pageCap` required. Most clients run on the default, and a required option that everyone sets to 1000 proves nothing; the receipt line is what gets it checked.

## Truncation sets `complete` false; it does not throw

A truncated read is recorded on the Coverage and the receipt (`truncated: true` per source and for the sweep) and the check resolves nothing. Its findings are still written.

Rejected: failing the check. The findings it did make are still true; only its silence is untrustworthy.

## Sweep lease: one row per scope, optimistic claim, released at the sweep's `now`

`watchdog_sweeps` has one row per scope key. The claim reads the row, then updates it only where `generation` still equals what was read; zero rows updated means another sweep moved it and the claim is refused. A live lease (`lease_until` in the future) refuses a new claim unless `force` is set; the default lease is 10 minutes. The release stamps `lease_until` with the sweep's own `now`, not the wall clock, so an injected clock in an eval behaves like production.

Rejected: `pg_advisory_lock` or a `SELECT ... FOR UPDATE`. PostgREST exposes neither, and the kit must not depend on a database function existing in the client.

Two first-ever claims both find no row and both insert; the loser's primary-key violation (23505) is a `SweepBusyError`, like any other lost claim. The lease is released at the release time: the sweep's `now` plus the time elapsed on its own clock, so production records when it really ended and an injected clock stays deterministic. A release the database refuses, or that matches no row because the lease was taken, is reported, not swallowed.

## Every reconcile write is conditional on the row's generation (0.2.0)

Accepted, replacing the 0.1 decision that rejected it. Each refresh is an update with `.or('last_generation.is.null,last_generation.lte.<generation>')`, each resolve adds the same filter to its `status = 'open'` guard, and new rows are inserted with `ignoreDuplicates` (a row a concurrent sweep inserted first becomes a refresh, so `first_seen_at` is never rewritten). An update that touches no row because a newer sweep owns it throws `StaleGenerationError`. The read of the sweep row before each batch stays, as the cheap whole-batch refusal.

Why now: 0.1 rejected the per-row compare because it "would partially apply a stale sweep". The review showed a partial stale sweep was already possible, across chunks and between the batch read and the write, and that the alternative was worse: the stale sweep's upsert overwrote the newer sweep's evidence, meta and `first_seen_at`, and its update resolved a finding the newer sweep had just refreshed, so it flapped and `reopened_count` rose. A stale sweep that stops part-way leaves rows the newer sweep will rewrite on its next pass; a stale sweep that overwrites leaves wrong rows. The cost is one request per existing finding instead of one per hundred.

Rejected: one SQL function taking the generation. It would make the whole reconcile atomic, but the kit must not depend on a database function existing in the client; revisit when the watchdog is allowed to act.

## The generation check is a read before each write batch, not a transaction

Between the read and the write a usurper can still slip in. Since 0.2.0 that usurper can no longer be overwritten: a row it has written carries a higher `last_generation` and refuses the stale write. What remains is a stale write to a row the usurper has not yet touched; it lands, and the usurper's later write of that row wins. Good enough for report-only; revisit before the watchdog is allowed to act.

## `meta` holds bookkeeping; `evidence` holds only EvidenceRefs

The reference build kept `verdict_context` and `resolved_reason` inside the free-form `evidence` object. With `evidence` now typed as a ref list, bookkeeping moved to `meta`. `verdicts.js` reads `meta.verdict_context` and ignores `meta` in the fingerprint.

## The sweep writes `meta` only when it must (0.2.0)

`meta` is shared: the verdict route, the existing-monitoring matcher and alert state write it too. In 0.1 the sweep read it once and wrote the whole object back on every refresh and resolve, so a verdict given while a sweep ran was lost. Now a refresh sends no `meta` at all unless it must clear the resolution keys (a reopen, or an open row still carrying them) or the `evidence_defaulted` flag changed. A resolve re-reads `meta` immediately before its conditional update and adds only the resolution keys.

The window that remains: a write to `meta` between that re-read and the update (one round trip), or between a reopening refresh's read and its update, is still overwritten. Closing it needs a server-side merge (`meta || patch`) in a database function, which the kit does not assume exists.

## A check may write one table of its own, and the client exposes `from()` only (0.2.0)

`writes` is at most one table, and never a kit table (`watchdog_findings`, `watchdog_sweeps`, `job_runs`, `watchdog_silences`, `alert_sends`), another check's `writes` table, or a table any check lists in `reads`. In 0.1 a check declaring `writes: ['watchdog_sweeps']` could set the generation to 99. A bad list, like a duplicate or malformed check id, refuses the whole sweep before the lease is claimed, with the refusal on its `job_runs` row: it is a deployment mistake, and running the other checks would let a duplicate id's clean twin resolve the broken one's findings.

The read-only client is an allow-list: `from()` and nothing else. In 0.1 it intercepted `from` and `rpc`, and `schema('x').from(t).insert(...)`, `rest.from(t).delete()`, `storage`, `functions`, `auth` and `channel` passed straight through. A deny-list can always miss the next property a driver adds.

Rejected: reporting a bad check list as a `check_error` and running the rest. The id the error finding would be filed under is the thing that is wrong.

Amended in 0.2.1: two checks may declare the same own table. The reviews table is keyed on the check id as well as the scope and subject, so sharing it cannot let one check touch another's rows, and a table per model check would multiply migrations for nothing. The refusals that matter stay: a kit table, a table any check reads, more than one table.

## Every check is raced against the time left; late model checks are skipped (0.2.0)

`check.run` is raced against the time left before the hard stop (or `check.timeoutMs`, if smaller); a check that loses becomes a `check_error` (`timed out`) and the sweep still releases its lease and closes its `job_runs` row. A model check is not started once the model start budget has passed: it is recorded as skipped and resolves nothing. In 0.1 the budget was advisory, so one hung check held the lease for its full ten minutes and left the heartbeat open.

The hung promise cannot be cancelled and keeps running on its read-only client after the sweep moves on; its scoped writer, if it has one, can still write its own table late. Acceptable at report-only.

## The sweep reads its own findings in id pages, to an empty page (0.2.0)

Open findings, and the rows matching the ids a phase saw, are read ordered by id, each page starting after the last id seen, until a page comes back empty. In 0.1 the read had no order and stopped at the server cap, so past 1000 open rows an arbitrary subset was never evaluated. Reading to an empty page rather than to a short one is what makes the read correct under a server max-rows below the page size. `in` lists are split by URL-encoded length (about 6 KB) rather than by count, because 100 ids of 140 characters made a 14 KB URL.

## The verdict fingerprint drops an EvidenceRef whose `field` is volatile

With evidence as a ref list, "an age in the evidence" is a ref such as `{ field: 'age_minutes', value: 300 }`. The fingerprint leaves out any ref whose `field` is in the volatile key set or matches the age pattern, as it already left out those keys of an evidence object, so a verdict on a finding whose only change is the clock, or the model's run details, still stands.

Rejected: hashing every ref. Vendoring into the first client showed a verdict on an undelivered-message finding going stale on every sweep because its age ref moved.

## Resolved reason is an enum in `meta.resolved_reason`, with a free-text `meta.resolved_note`

A check's `coverage.resolveReason(row)` may return `recovered`, `cancelled` or `left_scope`; anything else reads as `recovered`. The human-readable sentence goes in `resolved_note`.

Rejected: a `resolved_reason` column. The enum is small and only the page reads it; a column can be added later without changing the sweep.

## A bare array from a check is still accepted

A check may return a plain findings array (the reference shape) and gets the recorder's Coverage. It resolves nothing unless it also called `coverage.examined(...)`.

Rejected: refusing legacy-shaped checks. Vendoring into an existing client should not need every check rewritten on day one.

## `partial` on the result sets `complete` false

The contract has both `coverage.complete` and `result.partial`. The core treats `partial` as one more reason the coverage is incomplete and records its reason on the receipt; `resolutionDecision` reports `partial` before `incomplete` so the receipt says what happened.

## A finished subject is out of review, not down-weighted (0.2.2)

The reference build's tour review looked 14 days back so a tour stayed in for its post-tour send, and its first full day raised 76 findings, about a third of them about tours that had already run ("venues were told 8 guests and 7 came", "a sandwich mix-up on 10 Oct"). None could be acted on. Review now covers only subjects whose end instant has not passed, and the follow-up owed after an end is a rule check on that obligation.

Rejected: keeping a short look-back (2 days) for post-tour work. It still produced retrospectives, and the obligation it was there for already had a rule check. Rejected: ranking past-subject findings lower. A card nobody can act on costs the operator the same attention at any severity.

## Dropped model answers are not findings (0.2.2)

The reference build showed one low "review dropped N findings" card per subject. On its first live day that was six cards of the watchdog's own working. Dropped answers are kept on the review row and counted in the receipt, where the trace and the eval read them.

Rejected: keeping the card at low severity. The verdict buttons on it measure nothing about the client's operation.

## Grouped cards are allowed only for one fix and one verdict meaning (0.2.5)

The review that produced 0.2.5 asked for one finding per provider account in the reference build's "Stripe charges have no venue" card, so each account gets its own verdict. Kept as one card: every member needs the same act (name its venue), and "Correct" means the same for each. The card lists every account with its own state and membership is in the fingerprint, so an account joining or clearing re-queues it. Where members need different acts, or a verdict could be right for one and wrong for another, they stay separate findings.

## Imported rows are excluded by one helper, not by an age cut-off (0.2.4)

The reference build's operator asked whether findings older than two weeks should be hidden. Age was a symptom: the old findings were imported workbook bookings read as new, and the oldest real finding (a voucher unposted for 63 days) is the one most worth seeing. Imports are recognised by what they are (an id prefix, a marker), recorded at survey, and excluded per obligation.

Rejected: an age cut-off on findings. It hides the longest-standing real faults first. Rejected: deleting resolved findings to empty the queue. The queue now shows only open findings; resolved ones keep their history under Resolved.

## Plain cards, dev mode one switch away (0.2.3)

The reference build's cards printed each model ref against its quote (`stops[1].seat_time` 17:30, `comms[2].vars.arrival_time` 4:45pm) and every key a rule check stored, ids included. The operator could not say which venue a time belonged to, so nobody gave verdicts (one in 121 findings). Labels are built in code from the packet when the finding is written, and the raw view moved behind a dev mode switch rather than being deleted, because the engineer judging a false alarm needs the exact ref and quote.

Rejected: asking the model to write labels. Code cannot check a label against the packet the way it checks a quote, and a wrong venue name on a card is worse than a path. Rejected: a per-check card template. One hidden-keys list and one key-to-words map covered all 22 of the reference build's rule checks.

## Severity, kind and subject type are open strings

`severity` is checked against `high | medium | low`. `kind` and `subject.type` are any non-empty string: the client's kind enum is enforced where the model's answer is checked (`normaliseKind`), not at the sweep, because a rule check's kinds are its own code.

Rejected: a fixed subject type list in the core (the reference build had one). The door contract says scope types are declared by the survey phase.

## Silences are a table, not yet a rule

`watchdog_silences` is designed and written as SQL. The sweep does not read it: a silence must never resolve a finding, and a silenced-but-open finding is a page concern. The page folds silenced findings away and the precision figures exclude them. Wiring that in is a page change, not a core one.

## The stale alarm counts only ok runs (0.2.0)

`staleAlarm` is stale when no sweep has finished ok within the threshold. A sweep that finishes ok false every time (it cannot save findings) is as dead as one that never runs. `lastFinishedAt` and `lastOkAt` let the page say which. `requireOk: false` restores the 0.1 reading.

## Review schedule default zone is UTC

The reference build defaulted to Europe/London. The kit defaults to UTC so no client inherits another's clock; the client passes its zone. The London clock-change cases are kept as evals against the explicit zone.

## `watchdog_reviews` key includes the check id and tenant as `''`

The reference build keyed reviews on one subject id alone. With several model checks and several tenants, the key is `(installation, tenant, environment, check_id, subject_type, subject_id)`; `tenant` is `''` rather than null there because a null in a primary key is not allowed.

## `cron-run.js` takes a client or a factory

The kit does not import `@supabase/supabase-js`, so the route passes `client` or `clientFactory(env)`. A factory that throws is recorded through `onObservationError` and the handler still runs. The default manual header is `x-watchdog-token` (0.1 shipped one client's header name). A handler that returns something other than a Response ran without throwing, so the run is ok with a note on its summary; 0.1 recorded it as a 500. Closing a heartbeat whose row has gone is reported through `onObservationError`.

## `scrubText` takes names; it does not load them

The reference build loaded known names from its own tables inside the packet builder. The kit's `scrubText(text, { names })` is pure; the client's packet builder loads and passes the list.

## `asData` delimiters

`<<<DATA label>>>` ... `<<</DATA label>>>`, with any such marker inside the text defused by swapping its angle brackets for single guillemets, so inbound text cannot close the block early. `DATA_NOTE` is the sentence to put once in the system prompt.

Rejected: XML tags. Inbound email often contains real HTML, which would collide.
