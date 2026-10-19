---
name: watchdog-checks
description: Write the obligation table from the business rules, cluster the incident log into the failure taxonomy, build one deterministic check per cluster with offline evals, a conformance run on disposable Postgres and a live dry run, then stop for the human to adjudicate every live finding. Loaded by watchdog-build during a build; not for use on its own.
---

# watchdog-checks

You are writing the deterministic checks: the code that owns the doors. Each check sits on the read side of report-only, as the contract defines it, returns findings with evidence and honest coverage, and never sends, writes anything, or calls a model; the sweep in `lib/watchdog/core/run.js` is what writes the findings, through the writer. Read `../watchdog-build/references/shared-contract.md` first, then `.watchdog/CONTRACT.md`, `.watchdog/MAPPING.md`, `.watchdog/EGRESS.md`, `docs/incidents/incidents.jsonl` and `docs/incidents/holdout.json`.

## 1. Write the obligation table before reading the sender

Fill `$KIT/templates/OBLIGATIONS.md` into `.watchdog/OBLIGATIONS.md` from the business rules, the operator's own words in the incident log, and the contract's Obligations section, without opening the code that sends. The sender's predicate is the thing most likely to be wrong, so a check that reads it inherits the bug it is meant to catch. For each event: what it owes, to whom, by when (as a rule code can compute to a UTC instant), the grace before overdue, the exceptions (paused, opted out, suppressed, already done by hand), and where the policy comes from. Version the table (`obligations@<date>`); every Coverage record names the version it judged against.

Only after the table is written, read the sender and list every place it disagrees with the table under `## Disagreements`. Each one is either a bug in the app or a rule the operator never wrote down, and the human decides which at the stop.

## 2. Cluster the incidents into the taxonomy

Read `references/failure-taxonomy.md`. Put every incident with `catchable: yes` or `partly` into one cluster, and write the clusters under `## Clusters` in `.watchdog/CHECKS.md` (template `$KIT/templates/CHECKS.md`) with the incident ids in each. The two shapes that matter most are the ones a row-based check misses: "no row past due", where the missed work left nothing behind and the finding is computed from the obligation and the absence, and "absence against baseline", where ingress died before any row was written and only a per-scope drop against the recent rate can show it. An incident that fits no cluster gets a new cluster, named, not forced into the nearest.

## 3. One check per cluster

Build each check from `references/check-template.md`, which is consistent with `Check`, `CheckResult` and `Coverage` in `$KIT/core/contracts/finding.d.ts`. One file per check in `lib/watchdog/checks/<check_id>.js`, registered in `lib/watchdog/checks/index.js`, which the sweep route imports for its check list, because a check file that is not listed does nothing. If the sweep route still passes an inline list, change it to import the registry, with the self check kept first.

Dispatch the `check-writer` subagent once per cluster, in parallel where clusters share no files. Each brief carries the cluster with its incident ids and rows, the obligation table version, the absolute path of the shared contract (resolve `../watchdog-build/references/shared-contract.md` from this skill's directory; a relative path resolves against wherever the subagent starts), the absolute path of `$KIT`, the vendored core path `lib/watchdog/core/`, and `.watchdog/CONTRACT.md`. Where your agent cannot dispatch subagents, read `$KIT/agents/check-writer.md` and follow it yourself, one cluster at a time. Run every returned eval yourself before registering the check; the exit code is the evidence, the subagent's summary is not. Whoever writes it, each check:

- reads through `ctx.read` only, the read client the core hands every check: the reader connection from `lib/watchdog/db.js` wrapped by `lib/watchdog/core/readonly-client.js`, so any write throws before it reaches the network and the role behind it refuses one anyway; it reads in a few bounded queries, with the page order and cap from `MAPPING.md`, newest first where a backlog over the cap must drop the oldest rather than today's;
- computes every due instant in code, in the client's zone, from the obligation table;
- builds each finding's subject from the rows and leaves the id to the core;
- carries evidence as refs (source, id, field, value) a human can check in the trace;
- fills `wouldDo` and `wouldSay` with the exact action and words it would use, inert;
- calls `coverage.examined(...)` for every subject it positively looked at, so the sweep (`lib/watchdog/core/run.js`) may resolve a finding it no longer sees; a check that reads a table has not examined every subject in it;
- says `unknown` where the adapter says unknown; a door with `deliveryDoor: 'none'` never gets a "not delivered" finding; an absent row on a door with `failureErasesEvidence` is reported as unknown with the reason;
- names the incident ids it claims to catch in `incidents`, which the replay eval will test.

Thresholds (how long before overdue, how many sends make a burst) go in named constants at the top with the incident that set them, so a later change is a diff with a reason.

Where `MAPPING.md` approved an existing monitoring source, a check may read it for evidence, through its read adapter, with the source, scope, observation time and read cost recorded in the receipt. An existing alert never suppresses a finding or satisfies an obligation, and a check that only reports an existing detector's result says so in its description. Alert matching is separate bookkeeping: a failed read of optional matching data leaves the match unknown and the check complete; a failed read of a source the business result depends on makes the check partial. Add offline cases for a stale observation retrieved again, fresh app rows beside stale required evidence, the same external id in two scopes, a fault that returns after recovery, and an external incident closed while the fault remains. None of them may resolve a finding without fresh positive coverage.

## 4. Offline eval, then conformance, then live

Three runs, in this order, each recorded under `## Evals`:

1. **Offline** against the fake harness (`$KIT/evals/lib/harness.mjs`, `fake-postgrest.mjs`): one eval per check that replays each incident the check claims, asserts the finding lands on the expected subject with the expected kind, asserts a healthy fixture stays silent, asserts a truncated page reports partial and resolves nothing, and asserts that any write throws. No network.
2. **Conformance** against a disposable Postgres: a throwaway container (`docker run --rm -e POSTGRES_PASSWORD=<any> -p 54329:5432 postgres:<the client's major version>`) or a new, empty database on a local Postgres, never a shared or hosted one. Apply the client's real migrations in order, including any row-level security policies they define (Postgres does not require them; apply what the migrations hold and add nothing), then the watchdog migrations, seed it from the offline fixtures, give the two roles throwaway local passwords, and run the whole sweep with the reader and writer pointed at it. On the data-API path recorded under `## Role` in `HEARTBEATS.md`, put the platform's local stack or a PostgREST container in front of it so the same routing client runs; where neither is available, check the grants with plain SQL as each role (`set role watchdog_reader`) and say the builder path was not exercised. Confirm every check reads what it expects through the approved views, nothing reads an unapproved column, the writer touched only the watchdog's tables, and the forbidden-write test still fails. Where neither Docker nor a local Postgres is available, record conformance as not run with that reason; do not substitute the live database.
3. **Live dry run** against production through the manual trigger (`watchdog.sweep.manual`), within the live-read cap in the journal, reading app data through the reader and writing only the watchdog's own tables (`watchdog_findings`, `watchdog_sweeps`, `job_runs`) through the writer. That write is the point of the run, since the findings are what the human adjudicates; it inserts nothing into the app's tables and sends nothing. This is the build's first live read, so before it runs, say its measured size (sources, queries, expected rows) beside the rows-per-day cap phase 0 approved; the cap may be lowered here, never raised, and a run that would exceed it is narrowed rather than run. Record the receipt: sources read, rows, truncation, per-check timing, findings per check, and the reads spent against the cap.

A check that fires on today's healthy production state is a false alarm, not a feature; note it, but do not change the threshold yet.

## 5. Stop for adjudication

Write `.watchdog/CHECKS.md` and `.watchdog/OBLIGATIONS.md` and stop. Say what you wrote: checks by cluster, incidents covered and not covered, and the three eval results.

### Checkpoint: d4.verdicts
Evidence: the live findings per check in `.watchdog/CHECKS.md`, each with its evidence attached, and the obligation disagreements from `.watchdog/OBLIGATIONS.md`. The rule from the contract is fixed: a real fault stays open with a named owner, only a confirmed false alarm changes a check, and every threshold change is logged under `## Adjudication` with the finding id that caused it and the old and new values. Each obligation disagreement is answered as "app bug" or "unwritten rule", since the answer changes either the app or the check.

---
What is your verdict on each live finding (correct, false alarm or unsure) and each disagreement?
1. Every finding and disagreement adjudicated (record the count)
2. Some adjudicated, the rest still open (record the count; the bake-off and the eval wait)
3. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 4 decision --id d4.verdicts --outcome answered --answer "..." --by "<who>"`
