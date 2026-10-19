---
name: watchdog-build
description: Build a report-only production watchdog for the client app in the current repo, phase by phase, from the doors contract through to a proven deployed sweep. Invoke it in a client repo as /watchdog-build in Claude Code or $watchdog-build in Codex; it resumes from .watchdog/ if a build is already under way.
disable-model-invocation: true
argument-hint: "[--phase N] [--status]"
---

# watchdog-build

You are the orchestrator. You never do a phase's work yourself; you decide which phase runs next, load that phase's skill, and check its artefact before moving on. Every phase skill is written without knowledge of what follows it, so that the agent running it does that phase's legwork instead of rushing toward the finish. You are the only file that knows the order.

Read `references/shared-contract.md` first and keep it in mind for every phase: it holds the vocabulary, the schemas every artefact must satisfy, and the invariants. Phase skills see the contract too; what they do not see is each other.

## Paths

`$BUILD` below is the absolute path of the directory holding this SKILL.md. In Claude Code it is `${CLAUDE_SKILL_DIR}`. Where that variable is unset (Codex, which invokes this skill as `$watchdog-build` and has no Skill tool, or Claude Code reading this file from a checkout), take the directory of the SKILL.md you opened (for a Codex install, `~/.codex/skills/watchdog-build`) and write it out in full. Resolve it once and use the absolute form everywhere, because the scripts run with the client repo root as the working directory and a relative path would resolve inside the client.

- `node $BUILD/scripts/journal-append.mjs`: the only writer of `.watchdog/journal.jsonl`. It hashes the artefacts, appends the entry and regenerates STATE.md.
- `node $BUILD/scripts/state-from-journal.mjs`: regenerates `.watchdog/STATE.md` on its own, after a hand edit of the journal or an artefact.
- `node $BUILD/scripts/validate-phase.mjs <phase>`: applies the "phase done" predicate and the artefact's content checks, and names the first failure.
- `$BUILD/references/shared-contract.md`: the contract, passed by this absolute path to every subagent you dispatch.
- `$BUILD/../watchdog-<name>/SKILL.md`: each phase skill.

## First run

If `.watchdog/journal.jsonl` does not exist, this is a first run. Run `node $BUILD/scripts/journal-append.mjs init` from the repo root. It creates `.watchdog/`, an empty journal, `.watchdog/inbox/` (where the human may drop chat exports and client notes for the incidents phase) and a STATE.md showing phase 0 as current. Tell the human about the inbox now, since phase 2 reads it and they may want time to fill it. Then go straight to step 3 with phase 0; there is nothing to validate yet.

## How a run goes

1. **Read the state.** Read `.watchdog/STATE.md` and the journal it is built from. Trust the journal, not the markdown: STATE.md is a view, and the contract's journal-entry rule decides whether a phase is done.
2. **Validate the latest done phase**, if there is one: `node $BUILD/scripts/validate-phase.mjs <phase>`. A failed validation sends you back into that phase, never forward.
3. **Run the next phase.** Append `node $BUILD/scripts/journal-append.mjs <phase> started`. Load the phase's skill: with the Skill tool where the host has one, otherwise by reading `$BUILD/../watchdog-<name>/SKILL.md` and following it. Let it run to its stop. Do not summarise the later phases to it and do not pass it hints about what comes next.
4. **Close the phase.** When it stops, append `node $BUILD/scripts/journal-append.mjs <phase> finished`, adding `--artefact <path>` for any file the phase wrote beyond the ones the validator requires (code, evals, migrations), so the read-back covers them. Then dispatch the verifier (below). A phase with a human stop now shows "awaiting decision"; present the stop, and when the human answers, record it with `node $BUILD/scripts/journal-append.mjs <phase> decision --decision '{"question":"...","answer":"...","by":"<who>"}'` (`at` defaults to now). Then validate the phase and continue only on a pass.
5. **Flags.** With `--status`, run `state-from-journal.mjs`, print the phase table from STATE.md and stop. With `--phase N`, run that phase only after confirming its preconditions in the journal; `started` warns when an earlier phase is not done.

A stop in the middle of a phase (phase 5 asks for the key and a confirmation of the model cap before its bake-off) is recorded the same way with `decision` while the run is still open, and the phase resumes once the journal holds the answer.

## The phases

| # | Skill | Produces | Stop |
|---|---|---|---|
| 0 | `watchdog-survey` | `.watchdog/MAPPING.md`, `CONTRACT.md`, `EGRESS.md`, `incident-sample.jsonl` | Human approves scopes, egress policy and spend limits |
| 1 | `watchdog-explain` | `.watchdog/explainer.html`, `.watchdog/CANVAS.md` | Human approves both |
| 2 | `watchdog-incidents` | `docs/incidents/incidents.jsonl`, `docs/incidents/holdout.json` | Human adjudicates the holdout |
| 3 | `watchdog-heartbeats` | Heartbeats, the sweep route, parity and drift evals, door adapters and door checks, the reader and writer roles; `.watchdog/HEARTBEATS.md` | none unless a credential is needed |
| 4 | `watchdog-checks` | `lib/watchdog/checks/*`, evals, conformance run, live dry run; `.watchdog/OBLIGATIONS.md`, `CHECKS.md` | Human adjudicates every live finding |
| 5 | `watchdog-review` | Packet builder, review checks, model shortlist and bake-off; `.watchdog/REVIEW.md` | Two stops: human supplies the key and confirms the cap before the bake-off; human picks model and slots after it |
| 6 | `watchdog-page` | `/watchdog` page and trace, verdicts, alert previews, hub projection; `.watchdog/PAGE.md` | none |
| 7 | `watchdog-eval` | `.watchdog/EVAL.md` against the gates | Human authorises the eval; human authorises merge |
| 8 | `watchdog-prove` | `.watchdog/REPORT.md` marked operational, with the sweep id it was proven on | none |

The artefact paths are the ones `scripts/journal-lib.mjs` requires; if a phase skill writes somewhere else, the validator, not the skill, is wrong, and both get fixed together. The validator also fails an artefact that still holds a template placeholder such as `{client}`, or a required section with nothing under it, because a copied template that passes would be a claim of work nobody did.

Phase 3 is the first that changes code. Before it runs, confirm the journal holds the approval from phase 0: the agent has not been authorised to write into the repo until a human has approved the scopes and the egress policy, because the first code change creates the SELECT-only role and the egress policy decides what that role may see.

Phase 0's approval sets both spend caps, one for live reads of production and one for paid model calls, and the journal carries them forward. A later phase spends within them without asking again and may only lower them; the phase that first spends against a cap (phase 4 for live reads, phase 5 for model calls) states the measured size of that spend when it does.

## The verifier

After every phase closes, before you present its stop, dispatch the `verifier` subagent by name (installed for Claude Code from `agents/verifier.md` and for Codex from `codex/agents/verifier.toml`). Its brief names the phase number and skill, the absolute paths of the artefacts the journal entry recorded, the absolute path of the shared contract (`$BUILD/references/shared-contract.md`), and the absolute path of the phase's SKILL.md, whose stop section holds the acceptance criteria. Pass absolute paths because the verifier starts in the client repo and cannot find the kit from there. Its verdict goes to the human with the stop. A `fail` sends the phase back to run again; an `unverified` criterion is shown, not waved through. At a phase with a human stop, the brief tells the verifier to judge every criterion except the decision, which cannot exist yet, and `validate-phase.mjs` reporting "awaiting decision" at that point is expected, not a defect. If the host cannot dispatch the verifier, say so at the stop, because the human is then approving without an independent read.

## Adjudicating the holdout

Phase 2 leaves every holdout case with `adjudicated_by`, `adjudicated_at` and the file's `frozen_at` set to null. At its stop you put each case to the human. When they answer, you, not the phase agent, write their answers into `docs/incidents/holdout.json`: drop or amend the cases they asked to change, set `adjudicated_by` and an ISO `adjudicated_at` on every case, and set `frozen_at`. Only then record the decision with `journal-append.mjs 2 decision`, which re-hashes the file, and put the recall threshold per severity they set into the answer, since phase 7 judges the replay against it. The order matters: hashing before the write-back would record a sha256 the frozen file no longer has, and validation would call the holdout stale. After that the file changes only through a new adjudication.

`decision` re-hashes every artefact the entry recorded and names any that changed. Use it only for changes the human's answer made; any other edit to a closed artefact means the phase runs again.

## Between phase 7 and phase 8

Phase 7 ends with a merge authorisation. Then wait. The human merges and deploys; you do not. Phase 8 can only observe a scheduled sweep on the deployed revision, so starting it before the deploy would prove the old code. Ask the human to tell you when the merge is deployed and which revision is live, record that as a phase 7 decision (`"question": "Merged and deployed?"`, the answer naming the revision), and start phase 8 only once the journal holds it.

## Stops

A stop is a question with the evidence attached, not a status update. Present the artefact and the verifier's verdict, say what decision is needed and what each answer changes, and wait. Record the answer in the journal with who gave it and when. The build does not continue on silence.

## When something fails

A phase that cannot finish records `node $BUILD/scripts/journal-append.mjs <phase> blocked --reason "..." --needs "..."`. Do not skip it and do not mark it done with caveats. A phase whose inputs changed since it ran (a new approved scope, a changed egress policy) is invalidated along with every phase after it; say so and start again from the earliest invalidated phase. A journal line that is not JSON stops every script with its line number; fix that line by hand, then run `state-from-journal.mjs`.

## What you do not do

You do not deploy. Pushing the client's main branch is the human's act in every client this kit has been built for. You do not read `.env` values; the survey records variable names only. You do not create test data in production and you do not send anything. You do not write `.watchdog/STATE.md` yourself; the scripts generate it from the journal.
