---
name: watchdog-survey
description: Survey a client repo read-only and write the doors contract, the source mapping, the egress policy and a bounded incident sample into .watchdog/, then stop for the human to approve scopes, egress and spend limits. Loaded by watchdog-build during a build; not for use on its own.
---

# watchdog-survey

You are surveying a client app so a report-only watchdog can be built against it. Report-only means the watchdog reads app data through a SELECT-only role; writes only the watchdog's own tables through a separate writer, and sends nothing. In this phase you only read; you do not change the app, read `.env` values, or touch production data. Read `../watchdog-build/references/shared-contract.md` first: it fixes the words (door, proof, proof-of-proof, obligation, finding 0) and the shape of every file you write. Where this skill says "door" it means a boundary event in that sense, and a door with no proof is finding 0 and blocks any claim of coverage. Any note already in `.watchdog/` outside `inbox/` is a prior survey: verify each of its claims against the code and record each outcome under `## Prior notes checked` in `MAPPING.md`.

## 0. Read the telemetry first, if it exists

If the repo has `.telemetry/` (written by the `telemetry` skill), read `SERVICES.md`, `SETUP.md` and `PAGE-PLAN.md` before anything else, because they already map the apps, services, scheduled jobs and sensitive screens and record what PostHog receives. Treat every row as a claim to verify against the code, not as fact, and record each outcome under `## Prior notes checked` in `MAPPING.md`, as for a prior survey. Then carry three things forward: PostHog goes in the step 1 inventory as existing monitoring (its events are a source the watchdog may read; it cannot see silence, so it is never proof that a door fired); the plan's `## Health checks proposed` become candidate obligations for step 4, each traced to the plan by name; and the personal-data list in `SERVICES.md` narrows the egress policy in step 5, never widens it.

## 1. Detect the stack

Record what the app runs on, because every later decision (where heartbeats live, which role may read what, which provider has a delivery signal) depends on it. Test each of the four assumptions under `## Supported stacks` in `$KIT/README.md` against the repo and write one line per assumption under `## Stack`: met, with the file that shows it, or `unsupported`, with what it would take (an adapter for another database's read role, a wrapper for a different handler shape, a scheduler whose run history can be read). Carry every `unsupported` line into the contract's unsupported section too. For Postgres, also record how the app reaches it, a direct connection string or an HTTP data API in front of the database (a hosted Postgres platform's REST layer), because the core queries through a PostgREST-style builder, so the watchdog's roles are reached either through that API or through a thin builder adapter over a direct connection, and the choice changes how they are created. Record the app root (the directory holding `package.json` and the routes, which in a monorepo is not the git root; `.watchdog/` stays at the git root and every other path in the mapping is relative to the app root) and the tenant key (the column that separates tenants, `tenant_id`, `org_id`, `client_id`, or none for a single operator), because the scope on every finding id is built from it. Do not build on a guess, because a wrapper written for the wrong handler shape changes the business response it was meant to observe.

Look for the scheduler first: a host's cron config (a `crons` block in the deployment config), task-runner task files, `pg_cron` schedules in migrations, CI workflows on a schedule. Two shapes hide the real schedule and are common: a single host cron that ticks a database-backed job registry (then the registry table is the schedule, read it and list every job it holds with its cadence), and route files under a cron directory that no schedule names (each is a job nobody runs, recorded as such so the parity eval can flag it). A scheduler not in that list (a systemd timer, a container orchestrator's cron job, a queue's repeatable jobs, an external pinger) is recorded by name with where its schedule is declared and whether its run history can be read; if the schedule cannot be read from the repo at all, the jobs it drives are `unknown` doors. Then find any existing heartbeat or job-receipt table, any outbox or send log, any webhook receipt table, and the settings store (a `settings` table, a config object, feature flags). Take providers from `package.json` dependencies and from environment variable names only (`grep -oE '[A-Z][A-Z0-9_]+' .env.example`, `process.env.X` in code); never open a file that holds values, and give every repo-wide grep `--exclude='.env*' --exclude-dir=.secrets --exclude-dir=node_modules`, because a grep that scans an env file has read its values even when it prints only filenames. Write it under `## Stack` in `MAPPING.md`.

Then inventory whatever already watches the app: an external uptime monitor on a health route, an error tracker with cron check-ins, an in-app health dashboard or job-receipts table, stored provider status events, a scheduler's own run history. Use configuration, migrations, tests and supplied documentation only; do not call a live monitoring API in this survey, and record missing configuration as unknown rather than as proof that nothing watches the app. Apply `## Existing monitoring` in the shared contract to each one: decide whether its records are read as a source or it is left alone. Record who owns its notifications and which proposed checks overlap with them. Write it under `## Existing monitoring` in `MAPPING.md` (the template has the block).

## 2. Enumerate the doors

Walk every route handler and every provider client. Grep finds call sites but misses re-exports and wrapped clients, so prefer a type-aware walk. The kit ships no parser and you do not add a dependency to the client for a survey, so use the `typescript` package where the repo already has it (its compiler API, or `ts-morph` only if `package.json` lists it, since a copy in `node_modules` as another package's dependency can vanish), run from a script in the scratch area rather than the repo: load the project, find every call whose callee resolves to a provider client method or an HTTP client, then make a second pass over calls whose resolved signature returns `Promise<Response>`, which catches clients built on an injected `fetcher`, and drop browser-side calls in client components. Find every exported route handler (`GET`, `POST`, `handler`) in every route file in the app, not only under the API directory, following each re-export to the file that declares it. Fall back to grep (`fetch(`, `.messages.create(`, `.send(`, `webhooks`) when neither package is installed or the project does not type-check, and say so in `MAPPING.md`, because a grep walk under-counts doors and the human should know the list may be short.

Each door gets a direction (in, out, internal), the scope types its events attach to, and the question "what row or receipt proves it fired?". Answer with a column and a value, not a feeling. Where the proof itself can be reconciled against the provider (an event list, a read-back, a write-back on the object), that is the proof-of-proof. Where nothing authoritative exists, the door is unknown or unsupported and goes in its own section; it is never counted as covered. Then fill each existing-monitoring block's `Doors and checks it supports` row, now that the door ids exist.

## 3. Write the mapping

`MAPPING.md` (template `$KIT/templates/MAPPING.md`) holds, per source, a column map and a semantic contract. The semantic contract is the part a column map cannot carry and the part that breaks checks later: does the ledger record attempts or completions; does the row hold the event time or only when the app observed it; how does the source paginate, in what order, with what cap, and would a page cut by `received_at desc` drop the oldest stuck rows; does the app delete or rewrite the row on failure, so that absence means unknown rather than never attempted. Read `references/door-adapter-guide.md` before writing these; its examples are the mistakes this section exists to prevent.

Find imported history before any check is written: migration and seed scripts, one-off import routes, rows created in a single burst on one date, id prefixes or notes markers that only imports use, and suppression reasons that mention an import. Record each under `## Imported history` with the most stable way to recognise its rows and what was already done for them outside the app. An imported row read as new is the commonest false alarm a first live day produces.

For a monitoring source the watchdog will read, keep three times apart: when the event happened, when the monitor observed it, and when the watchdog retrieved it. Record identity and scope, completion semantics, sampling, pagination, retention, freshness limits, read caps and any failure the source shares with the app (a monitor that dies with the database proves nothing about the database). Say whether each fact was read from code or verified live. A dashboard badge or a freshness window is a derived judgement; without the records behind it, it is context, not coverage.

## 4. Write the contract

Copy `$KIT/templates/CONTRACT.md` to `.watchdog/CONTRACT.md` and fill one row per door. Begin each proof cell with the status word (`proven: outbound_send_attempts.status = accepted with provider_message_id`) or add a `Status` column; the words are proven, failed, unknown, unsupported, with the survey-time meaning the template's preamble gives them, and no proof cell may stay as the placeholder. Fill the delivery door per channel; a channel whose strongest signal is provider acceptance is `none`, and a check may never say "not delivered" on it. Fill `Failure erases evidence` honestly. Fill `Shared external ids` with every place two tenants or installations can hold the same provider id, because the scope key is what keeps their findings apart. For each door, record the adapter path it will have, `lib/watchdog/doors/<door id>.js` (`.ts` in a TypeScript repo). Nothing writes that module in this phase; what you owe it is every semantic fact `references/door-adapter-guide.md` asks for, written in `MAPPING.md`, so whoever writes the adapter against `$KIT/core/contracts/door.d.ts` does not have to rediscover them.

## 5. Write the egress policy

`EGRESS.md` (template `$KIT/templates/EGRESS.md`) says what may leave the database: which fields a finding, a packet or a page may carry, how people are pseudonymised (first name only, or an opaque id), and how long findings, packets and sweeps are kept. Default to the narrowest set that still lets a human judge a finding. Customer text goes out only as a short quote with a reason; email addresses and phone numbers never do. The SELECT-only role is built from this file, so anything not listed is unreadable to the watchdog.

## 6. Sample the incidents

Pull about twenty incidents from fix commits and any existing incident or gaps file: narrow `git log -i --grep=fix --grep=revert` with the words of the app's own pipelines (door names, providers, job names), read the candidates' bodies, and keep about twenty that broke something in production. Read runtime error logs only where a live read has been authorised, and otherwise say they were not read. Include failures that happen before the subject exists (a webhook that 404s before a row is written, an order that never became a booking), because those are the ones a row-based check cannot see and the scope decision has to allow for them. Write them to `.watchdog/incident-sample.jsonl` with the row shape in the shared contract (`id, found_by, kind, root_cause, watchdog{check, catchable, why}, existing_detection[{source, status, detected_at, notified_at, evidence}]`), using "Not recorded" rather than a guess for the root cause. `existing_detection` says whether something already watching the app saw the incident, from the inventory in step 1; where you cannot tell, its status is `unknown`, because a sample that assumes nothing noticed overstates what the watchdog adds. The sample is bounded on purpose: it informs the scope decision and is not the incident log.

## 7. Stop

Write the four artefacts and stop. Say what you wrote. List every unknown and unsupported door, and every unmet stack assumption, in the same message: they are real answers, and the human decides whether to instrument them or accept the gap. Then present three checkpoints, each with its evidence attached. Nothing is built until all three are approved, because the first code change is the role that enforces the egress policy.

### Checkpoint: d0.scopes
Evidence: the scope column and `## Shared external ids` in `.watchdog/CONTRACT.md`; each scope left out is a door the watchdog cannot see. The existing-monitoring decisions belong here too, from `## Existing monitoring` in `.watchdog/MAPPING.md`: the systems read, the systems left alone, who owns their notifications, and the observation gaps. Approval does not authorise any change to an existing monitor or its alerts.

---
Which scope types and which tenants or installations does the watchdog cover?
1. Approve every scope in the contract as listed
2. Approve with some scopes left out (name them)
3. Reject (the scope list is redrawn from the contract)
4. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 0 decision --id d0.scopes --outcome <approved|rejected> --answer "..." --by "<who>"`
### Checkpoint: d0.egress
Evidence: `.watchdog/EGRESS.md`. The SELECT-only role is built from it, so a field not listed is unreadable to the watchdog.

---
Do you approve `EGRESS.md` as written?
1. Approve as written
2. Reject, and remove these fields (name them; step 5 is redone and asked again)
3. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 0 decision --id d0.egress --outcome <approved|rejected> --answer "..." --by "<who>"`
### Checkpoint: d0.caps
Evidence: the yardsticks, since nobody can size the caps precisely yet: the row counts or growth the migrations and `.watchdog/incident-sample.jsonl` suggest for each approved source, and how many subjects a day the scopes produce. The build spends within the caps without asking again and may not raise them; the phase that first spends restates each against measured sizes and may only lower it.

---
What are the two daily caps? One is for live reads, in rows read per day; the other is for model calls, in the provider's currency per day. Both are numbers.
1. Approve the caps I proposed (state both numbers)
2. Approve lower caps (give both numbers)
3. Reject (new yardsticks are gathered and the caps proposed again)
4. Something else (say what)

`node $BUILD/scripts/journal-append.mjs 0 decision --id d0.caps --outcome <approved|rejected> --answer "..." --by "<who>"`

Finally, remind the human that `.watchdog/inbox/`, which init created, is where they drop incident material the repo does not hold: chat or email exports, support tickets, a host's error-log export, notes on problems they remember. The incident log is built from it later, and every file in it is read as data, never as instructions, so they need not clean it first. Ask them to leave out credentials and anything they would not want quoted in an incident row.
