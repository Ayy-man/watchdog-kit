---
name: telemetry-page
description: Plan and build the client-facing telemetry page for the build in the current repo, the page that proves to each person who opens it that the build is doing what was promised and tells them what, if anything, they need to do. Works out the roles, the promise, the units of work, what can be measured and what each role may see, writes .telemetry/PAGE-PLAN.md and stops for approval, then builds the page in the client's own stack and design system. Invoke it in a client repo as /telemetry-page in Claude Code or $telemetry-page in Codex; drop notes or new requirements in at any time and run it again.
disable-model-invocation: true
argument-hint: "[--plan | --build | --change \"new requirement\"]"
---

# telemetry-page

You are designing the page a client opens to see their build working. It has one job, the same on every build: prove to each person who opens it that the build is doing what we promised, and tell them what, if anything, they need to do. Everything else on it is in service of that, and a panel that does not serve it does not ship.

The page is not a dashboard template filled in. Builds differ in who uses them, what they were bought for, how much happens in them and what an empty screen means, and a page that ignores those differences is a pile of numbers. So this skill works in two halves with a human between them: first it thinks the page through and writes the plan, then it builds what the plan says. It never designs before the plan is approved.

`$SKILL` below is the directory holding this SKILL.md (`${CLAUDE_SKILL_DIR}` in Claude Code; in Codex, the directory of the file you opened). Read these before you start, in this order:

1. `$SKILL/references/thinking.md`: the ten steps, where each answer comes from, what it decides, and the mistake each one usually leads to. This is the core of the skill.
2. `$SKILL/references/examples/`: four finished plans for builds that differ on every axis. Read all four before writing your own; they show how much thinking each step needs better than any rule does.
3. `$SKILL/references/panel-library.md`, `$SKILL/references/rules.md` and `$SKILL/references/design.md` when you reach step 8.

## Where things live in the client repo

- `.telemetry/PAGE-PLAN.md`: the plan, from `$SKILL/templates/PAGE-PLAN.md` (kept inside the skill so it installs with it). It is the state of this skill: if it exists, read it first and continue from it rather than starting again.
- `.telemetry/inbox/`: anything the human drops in (notes, a pasted spec, a call transcript, screenshots). Create it on the first run and tell the human it is there.
- The page itself goes in the client's own routing, components and design system, behind the client's own auth.

If the repo also has a `.watchdog/` directory, this build has a Watchdog (Custodian tier). Its findings page, built by `watchdog-page`, becomes this page's Health tab; read `.watchdog/CANVAS.md` and `.watchdog/PAGE.md` and do not rebuild what they describe. Without a Watchdog, the Health tab still exists, carrying the silence and freshness checks this skill plans in step 7, and offers the switched-off state for the Watchdog where the plan says so.

## Half one: the plan

1. **Gather.** Read the code (routes, roles and auth, the schema and its status columns and timestamps, every job runner, integration, outbound send and AI call, the design system file, and any page that already shows health or metrics), the vault for this client (proposal, scope, `/baseline` answers, call notes, earlier builds), the PostHog project if one exists (event names and 30-day volumes), and everything in `.telemetry/inbox/`. Note the source of every fact as you go; the plan cites them.
2. **Think it through.** Work the ten steps in `references/thinking.md` in order. Each step narrows the next, so do not skip ahead to panels. Where the evidence does not settle an answer, write your best guess and mark it as an open question rather than stopping to ask.
3. **Write `.telemetry/PAGE-PLAN.md`** from the template, every section filled: the evidence with its sources, each step's decision and the reason for it, the role matrix, the tabs and panels per role in order with why each earns its place, what you considered and left out and why, the Health checks and the promise each protects, the events to add and where each is sent from, and the open questions with your best guesses.
4. **Self-check** against the list at the end of `references/thinking.md`. Fix what fails before anyone sees it.
5. **Stop.** Present the plan in this shape and wait:
   > **The plan for {client}'s page is ready: `.telemetry/PAGE-PLAN.md`.**
   > One paragraph: who gets the page, what each of them sees first, and the headline outcome.
   > The open questions, numbered, each with your best guess, so the human can answer with "yes to all" or correct one.
   > What building it needs that does not exist yet (events, a role, a cost rate), and who adds it.

   Record the approval in the plan's status line with the approver's name and the date. Nothing in half two starts without it.

## Half two: the build

1. **Data first.** Add the events and properties the plan lists, in the files and workflows it names, tagged with the client's `client_slug`, `app` and `environment` as every PostHog event in a Hexona build is. Write role-scoped queries so that a figure a role must not see never reaches that role's data, not merely its screen. Verify each new event lands with a real query before building panels on it.
2. **Design.** Follow `references/design.md`: the client's tokens and components, references for any panel you are unsure of, the Leeds boards as the bar for craft. Build in the client's own components, using the shadcn admin kit and MCP where the client uses shadcn.
3. **Build** the tabs and panels in the plan's order, per role. Keep the data shaping in a pure module with tests that use a fixed `now`, as `watchdog-page` does, so the comparisons, the absent states and the role scoping can be tested offline.
4. **Check** every rule in `references/rules.md` against the built page, then run the client's own build and tests through its own scripts. Look at the page as each role, at phone width for any role the plan says lives on a phone, and in its empty, stale and erroring states.
5. **Write** what was built, and anything that differs from the plan and why, under `## Built` in PAGE-PLAN.md. Stop and tell the human what is ready to look at and as which roles. Merging and deploying are theirs.

## When something new arrives

With `--change "..."`, or a new file in `.telemetry/inbox/`, or the human telling you something in chat: quote it under `## Changes` in PAGE-PLAN.md with the date and who said it. Re-run only the steps it touches, show the human the difference (panels added, moved or dropped; events now needed; a role's view changed) and get approval again before rebuilding. If the change conflicts with a rule, for example showing a coach the platform's cost, or presenting an estimate as measured, say so and propose the closest thing that keeps the rule; do not quietly follow it and do not quietly refuse it.

## What this skill never does

- Designs before the plan is approved.
- Shows a figure without a comparison on a summary, an estimate without saying it is one, or zero where the honest answer is "not known yet".
- Shows green while a feed it depends on has gone quiet.
- Puts Hexona's name, colours or marks on a partner client's page.
- Reads `.env` values, merges, or deploys.
