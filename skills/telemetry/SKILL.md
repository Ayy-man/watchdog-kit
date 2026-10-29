---
name: telemetry
description: Put telemetry on the build in the current repo, end to end. Scans the code for every service, installs PostHog in whichever account you choose (tags, identify, privacy, proxy, replay masking, n8n and GHL events, billing gate), then plans and builds the client-facing page that proves the build is doing what was promised, per role, and hands Custodian builds on to the Watchdog. Stops for approval at the plan and at the billing limits. Invoke it in a client repo as /telemetry in Claude Code or $telemetry in Codex; it resumes from .telemetry/, and you can drop notes or new requirements in at any time.
argument-hint: "[--status | --install | --plan | --build | --change \"new requirement\"]"
---

# telemetry

You are putting telemetry on a client build: the data that shows what the build does, and the page a client opens to see it working. Both serve one job, the same on every build: prove to each person who opens the page that the build is doing what we promised, and tell them what, if anything, they need to do.

This is one skill with layers, run in order, each finishing before the next starts:

1. **Scan** the build and map every service it touches.
2. **Install** PostHog, in the account and region you pick, so the data exists and is trustworthy.
3. **Plan the page** with the build, and stop for approval.
4. **Build the page** from the plan.
5. **Hand on to the Watchdog**, on Custodian builds only.

The data comes first because a page planned without knowing what the build sends is a mockup, and the page comes before the Watchdog because the Watchdog reads the same events and its page becomes this page's Health tab.

`$SKILL` below is the directory holding this SKILL.md (`${CLAUDE_SKILL_DIR}` in Claude Code; in Codex, the directory of the file you opened). The references:

- `references/install.md`: the PostHog install, step by step, with everything the first build taught us.
- `references/thinking.md`: the ten steps for thinking a page through. The core of layers 3 and 4.
- `references/examples/`: four finished page plans for builds that differ on every axis.
- `references/panel-library.md`, `references/rules.md`, `references/design.md`: for choosing panels, the rules every page keeps, and how to design it.
- `templates/`: `SERVICES.md`, `SETUP.md` and `PAGE-PLAN.md`, kept inside the skill so they install with it.

## State

Everything this skill writes in the client repo lives in `.telemetry/`:

- `SERVICES.md`: the services map from the scan.
- `SETUP.md`: the install log for this build, including the billing confirmation.
- `PAGE-PLAN.md`: the page plan, its approval, its changes and what was built.
- `inbox/`: anything the human drops in (notes, a spec, a call transcript, screenshots). Create it on the first run and tell the human it is there.

On every run, read `.telemetry/` first and continue from where it stands. With `--status`, say which layer is done, which is next and what it is waiting on, and stop. With `--install`, `--plan` or `--build`, run that layer only, after checking the ones before it are done.

## First run

Read the repo's own `AGENTS.md`, `CLAUDE.md` and contributing notes before anything else, and follow them over anything here: its package manager, branch and commit rules, how it runs migrations, what it forbids. Then ask, in one message:

> 1. **Which tier is this build on?** Telemetry only (PostHog and the client page), or Custodian (the same, then a Watchdog that watches for silent failures and gives the page its Health tab).
> 2. **Who signs off?** The account owner who approves the plan, the billing limits and session replay. If that is not you, name them; I will stop and wait for them at each of those three points.
> 3. **Whose client is it?** Ours directly, or a partner's (name the partner). A partner's client's page carries none of our name or marks, and the partner's own accounts count as internal.

PostHog itself (whose account, new or existing project, region, timezone) is asked at the start of layer 2, every time, because it differs per build.

Record the answers at the top of SERVICES.md. If the repo already has `.watchdog/`, it is Custodian; say so instead of asking that part.

The person running this skill is often a developer, not the account owner. The three sign-offs are the owner's, and a developer recording their own approval is not an approval: write "waiting on {owner}" and stop. On the first run, add `.telemetry/inbox/` to the repo's `.gitignore`, because what gets dropped there (proposals, call notes, baselines) is internal and the client may be able to see the repo.

On timing: telemetry goes on at the start of the client testing window, so testing sessions are recorded and the time-per-job trend has a starting point before go-live. The Watchdog goes on near the end of the lifecycle, once the build is stable. If you are being run earlier or later than that, say so and carry on.

## Layer 1: scan

Read the code, not the human, for what the build touches: the package list, `.env.example` (variable names only, never values), integration and webhook code, job runners and crons, outbound sends, AI calls, the schema, roles and auth, and the build docs. On a build that will get a Watchdog, use the same door mapping its survey uses, so nothing is mapped twice.

Write SERVICES.md from the template: every service with where you found it, what it does in this build, how its events will reach PostHog, and whether to connect it. n8n and GoHighLevel connect by default when found. Everything else (Stripe, Twilio, Xero, Supabase and the rest) is offered as connect or skip. Add a "+ Other" line for anything the human knows about that the code did not show. Show the human the map; answers to connect or skip can come back in one batch.

## Layer 2: install

Follow `references/install.md` in order: the repo's own rules (package manager, which env file is local, what deploys production, migrations), the account questions, the project and its settings, the wizard and its hand-off, the layer on top (tags on every path, identify, internal users, AI privacy mode, `after()`, the reverse proxy), the section for each app's stack, replay masking before replay, the events from n8n, GoHighLevel and scheduled jobs, and verification against real data. Log every step and surprise in SETUP.md as you go.

Stop at the billing gate. The install is not done until the human confirms a billing limit is set on every paid PostHog product this build turned on.

## Layer 3: plan the page

1. **Gather.** The code, the vault for this client if you can reach it (proposal, scope, `/baseline` answers, call notes, earlier builds; a developer without vault access works from what the owner drops into `.telemetry/inbox/`, and asks for it rather than guessing the scope), SERVICES.md and SETUP.md, the PostHog project (event names and 30-day volumes, now that data is flowing), and everything in `.telemetry/inbox/`. Note the source of every fact.
2. **Think it through.** Read all four plans in `references/examples/` first. Then work the ten steps in `references/thinking.md` in order; do not skip ahead to panels. Where the evidence does not settle an answer, write your best guess and mark it as an open question rather than stopping to ask.
3. **Write PAGE-PLAN.md** from the template, every section filled.
4. **Self-check** against the list at the end of `references/thinking.md`, and fix what fails.
5. **Stop.** Present the plan in this shape and wait:
   > **The plan for {client}'s page is ready: `.telemetry/PAGE-PLAN.md`.**
   > One paragraph: who gets the page, what each of them sees first, and the headline outcome.
   > The open questions, numbered, each with your best guess, so the human can answer "yes to all" or correct one.
   > What building it needs that does not exist yet (events, a role, a cost rate), and who adds it.

   Record the approval in the plan's status line with the account owner's name and the date, in their words or a link to where they said it. Nothing in layer 4 starts without it.

## Layer 4: build the page

1. **Data first.** Add the events and properties the plan lists, in the files and workflows it names, through the same tagging as layer 2. Write role-scoped queries so that a figure a role must not see never reaches that role's data. Verify each new event lands with a real query before building a panel on it.
2. **Design.** Follow `references/design.md`.
3. **Build** the tabs and panels in the plan's order, per role. For Health cards, apply the role, evidence, visible-action and grouping rules in `references/rules.md` to both check definitions and actual retained instances. Record a dated before/after replay and its limits under `## Built`; no current instances means fixture verification, not production proof. Keep the data shaping in a pure module with tests that use a fixed `now`, so the comparisons, the absent states and the role scoping can be tested offline.
4. **Check** every rule in `references/rules.md` against the built page, then run the client's own build and tests through its own scripts. Look at the page as each role, at phone width for any role that lives on a phone, and in its empty, stale and erroring states.
5. **Record** what was built, and anything that differs from the plan and why, under `## Built` in PAGE-PLAN.md. Tell the human what is ready to look at and as which roles. Merging and deploying are theirs.

Until the Watchdog exists, the Health tab carries the silence and freshness checks from the plan's step 7, and on a telemetry-only build it also offers the Watchdog as its switched-off state.

## Layer 5: hand on to the Watchdog

Custodian builds only. Tell the human the next step is `/watchdog-build` (or `$watchdog-build`), which surveys the build, writes the doors contract and builds the checks. It will find `.telemetry/` and use SERVICES.md, the events from layer 2 and the plan's Health checks as inputs, and its findings page, built by `watchdog-page` from its approved canvas, replaces this page's interim Health tab. When that page exists, link it into the Health tab and record the switch under `## Built`.

## When something new arrives

With `--change "..."`, a new file in `.telemetry/inbox/`, or the human telling you something in chat: quote it under `## Changes` in PAGE-PLAN.md with the date and who said it. Re-run only the steps it touches, show the difference (panels added, moved or dropped; events now needed; a role's view changed; a service to connect) and get approval again before rebuilding. If the change conflicts with a rule, say so and propose the closest thing that keeps it; never quietly follow it and never quietly refuse it.

## What this skill never does

- Designs before the plan is approved, or marks the install done before the billing limits are confirmed.
- Turns on session replay before the masking is deployed.
- Shows a figure without a comparison on a summary, an estimate without saying it is one, or zero where the honest answer is "not known yet".
- Shows green while a feed it depends on has gone quiet.
- Sends prompts or AI outputs to PostHog, or puts the builder's own name, colours or marks on a partner client's page.
- Reads `.env` values, pastes keys into chat, merges, deploys, or pushes to a branch that deploys production. All work goes on a branch with a pull request.
- Forwards logs or traces to PostHog without first checking they carry no prompts, replies or personal data.
- Writes prices, margins, partner fees or internal notes into anything the client can see: the page, its queries, event properties, or committed files under `.telemetry/`.
