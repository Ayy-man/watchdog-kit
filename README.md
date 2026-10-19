# Watchdog Kit

Point a coding agent (Claude Code or Codex) at a client repo and it builds that app's production watchdog: a contract of doors, deterministic checks, a grounded model review, a report-only findings page with human verdicts, and an eval against the client's own incident history. Report-only is enforced, not promised.

This repo is the kit itself. The phase order, the gates and the reasoning behind each are in `skills/watchdog-build/SKILL.md` and its shared contract, `skills/watchdog-build/references/shared-contract.md`.

## Supported stacks

The kit assumes four things about the client app: it is a Node or TypeScript app, its data is in Postgres (the core queries it through a PostgREST-style builder, either a hosted platform's data API or a thin adapter over a direct connection), its jobs run on a cron-style scheduler (a host's cron config, a task runner, `pg_cron`, a CI schedule), and its routes are Fetch-style handlers that take a `Request` and return a `Response`. The survey checks each assumption against the repo and records anything outside them as `unsupported` with what it would take to cover, rather than building on a guess.

## Install

Get a checkout and install it for the local user:

```
git clone <the kit's repository URL> ~/watchdog-kit
cd ~/watchdog-kit
node scripts/install.mjs --all          # dry run: lists what it would create
node scripts/install.mjs --all --yes    # symlinks skills and agents into Claude Code and Codex
```

The default install symlinks, so moving or deleting the checkout breaks it; add `--copy` for a copy that stands alone, and `--uninstall --yes` removes exactly what an earlier run created.

As a Claude Code plugin: `/plugin marketplace add <path or owner/repo>`, then `/plugin install watchdog-kit@watchdog-kit-local`.

Next, in a client repo, run the build skill: `/watchdog-build` after a user install, `/watchdog-kit:watchdog-build` after a plugin install, or `$watchdog-build` in Codex. It starts at the survey and resumes from `.watchdog/` when a build is already under way.

## Layout

```
core/            the generic runtime, vendored into each client as lib/watchdog/core/ with a version stamp
  contracts/     the interfaces every client adapter and check must satisfy (start here)
skills/          Agent Skills standard: SKILL.md + references/ + scripts/; read unchanged by Claude Code and Codex
templates/       the files a run writes into .watchdog/ in the client repo
agents/          Claude subagent definitions; codex/agents/ holds the TOML equivalents
scripts/         install and vendoring helpers
```

## Vocabulary

These words mean one thing each, everywhere in this repo and in every prompt it generates.

- **door**: a boundary event of the client app. Inbound (a webhook, inbound mail), outbound (a provider call), or internal (a cron).
- **proof**: the signal that a door fired. A row, a receipt, a provider id, a heartbeat.
- **proof-of-proof**: the test that the proof is trustworthy. Reconcile identities against the provider, not counts.
- **obligation**: what an event owes, to whom, by when, with what exceptions. Written independently of the sender's code.
- **end state**: what should be true between two doors. The model's territory; code owns the doors.
- **adjudicated on live**: every finding from a dry run against production is judged by a human. Real faults stay open with an owner. Only a confirmed false alarm changes a check.
- **report-only**: the watchdog reads app data through a SELECT-only role; writes only the watchdog's own tables through a separate writer. A forbidden write is a test that must fail, and nothing it deploys can send.
- **finding 0**: a door with no proof. It blocks any claim of coverage.
- **sweep**: one run of the watchdog over its scopes, every rule check first and then the model checks, recorded as a `watchdog_sweeps` row. It is scheduled every 30 minutes; a hand-started one is logged as `watchdog.sweep.manual`.
- **generation**: the number a sweep claims when it starts. Every finding write is fenced on it, so an older sweep never overwrites a newer one's rows, and a run on another generation resolves nothing.
- **receipt**: what a sweep records about its own reading: sources, rows, truncation, per-check coverage and timing, reads and spend.
- **packet**: the bounded, pseudonymised bundle of one subject's rows and messages that a model check reads, with every due time already computed in code.
- **review slot**: a local time of day at which model checks may spend. A subject is reviewed once per slot, or at once when a rule check has just flagged it.
- **bake-off**: the counted comparison of shortlisted models on planted, held-out real and healthy packets, with every case in the tally.
- **heartbeat**: the record that a scheduled job ran, a `job_runs` row opened at start and closed at the end, or an existing record that already proves it.
- **wrapper**: `runCronJob`, which writes a job's heartbeat around its handler and never changes the handler's response or error.
- **hub**: an optional central view across installations. It pulls each installation's summary projection; the watchdog never posts to it.
- **report-and-tell**: the second contract level, the same code plus a separately provisioned alert sender, added in its own authorised change after the alert gates pass.

## Status

19 Oct 2026: core 0.2.1 extracted from the first installation and checked against a multi-tenant installation; nine skills, agents, installer and vendoring in place. The first installation now runs on the vendored core.
