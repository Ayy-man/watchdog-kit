---
name: watchdog-build
description: Build a report-only production watchdog for the client app in the current repo, phase by phase, from the doors contract through to a proven deployed sweep. Invoke it in a client repo as /watchdog-build in Claude Code or $watchdog-build in Codex; it resumes from .watchdog/ if a build is already under way.
disable-model-invocation: true
argument-hint: "[--phase N] [--status] [--mode step|run-ahead]"
---

# watchdog-build

You are the orchestrator. You never do a phase's work yourself; you decide which phase runs next, load that phase's skill, and check its artefact before moving on. Every phase skill is written without knowledge of what follows it, so that the agent running it does that phase's legwork instead of rushing toward the finish. You are the only file that knows the order.

Read `references/shared-contract.md` first and keep it in mind for every phase: it holds the vocabulary, the schemas every artefact must satisfy, and the invariants. Phase skills see the contract too; what they do not see is each other.

## Paths

`$BUILD` below is the absolute path of the directory holding this SKILL.md. In Claude Code it is `${CLAUDE_SKILL_DIR}`. Where that variable is unset (Codex, which invokes this skill as `$watchdog-build` and has no Skill tool, or Claude Code reading this file from a checkout), take the directory of the SKILL.md you opened (for a Codex install, `~/.codex/skills/watchdog-build`) and write it out in full. Resolve it once and use the absolute form everywhere, because the scripts run with the client repo root as the working directory and a relative path would resolve inside the client.

- `node $BUILD/scripts/journal-append.mjs`: the only writer of `.watchdog/journal.jsonl`. It hashes the artefacts, appends the entry and regenerates STATE.md.
- `node $BUILD/scripts/state-from-journal.mjs`: regenerates `.watchdog/STATE.md` on its own, after a hand edit of the journal or an artefact.
- `node $BUILD/scripts/validate-phase.mjs <phase>`: applies the "phase done" predicate, the artefact content checks and the input-drift check, and lists every failure with its remedy.
- `$BUILD/references/shared-contract.md`: the contract, passed by this absolute path to every subagent you dispatch.
- `$BUILD/../watchdog-<name>/SKILL.md`: each phase skill.

## First run

If `.watchdog/journal.jsonl` does not exist, this is a first run. Ask one question before anything else, in these words:

> **How do you want to work?**
> 1. **Step by step.** I stop and ask at every checkpoint. Pick this when you are at the keyboard.
> 2. **Run ahead.** You answer now whatever can be answered now (the model key's variable name, the spend cap, the review slot times, which model to keep after the bake-off), and I build everything that does not need a decision, queueing the questions that do. When you come back, `--status` lists them in order and you answer them in one sitting. Pick this when you are leaving. Three things wait for you either way: approving the survey before anything reads production, judging the findings (that is your judgement, not mine), and the merge.

Then run `node $BUILD/scripts/journal-append.mjs init --mode step|run-ahead` from the repo root. It creates `.watchdog/`, a journal holding the mode and the kit revision, `.watchdog/inbox/` (where the human may drop chat exports and client notes for the incidents phase) and a STATE.md showing phase 0 as current. Tell the human about the inbox now, since phase 2 reads it and they may want time to fill it. In run-ahead mode, ask the early-answerable decisions from the contract's catalogue now (`d5.key`, `d5.cap`, `d5.slots`, `d5.model`; `d3.credential` only if the survey later asks) and record each with `--pre`. Then go straight to step 3 with phase 0; there is nothing to validate yet.

## How a run goes

1. **Read the state.** Read `.watchdog/STATE.md` and the journal it is built from. Trust the journal, not the markdown: STATE.md is a view, and the contract's journal-entry rule decides whether a phase is done.
2. **Validate the latest done phase**, if there is one: `node $BUILD/scripts/validate-phase.mjs <phase>`. A failed validation sends you back into that phase, never forward.
3. **Run the next phase, or the next phases.** The contract's dependency table says what each phase needs. Phases whose artefact inputs are all finished and whose write sets are disjoint run at the same time, each as its own subagent: 1, 2 and 3 once phase 0 is approved. Everything else runs one at a time. For each, append `node $BUILD/scripts/journal-append.mjs <phase> started` (it refuses any phase after 0 until `d0.scopes`, `d0.egress` and `d0.caps` are approved, and refuses a phase whose run is already open). Load the phase's skill: with the Skill tool where the host has one, otherwise by reading `$BUILD/../watchdog-<name>/SKILL.md` and following it. Tell the human, in one line, that the phase runs in a subagent and prints nothing until it returns. Let it run to its stop. Do not summarise the later phases to it and do not pass it hints about what comes next.
4. **Close the phase.** When it stops, append `node $BUILD/scripts/journal-append.mjs <phase> finished`, adding `--artefact <path>` for any file the phase wrote beyond the ones the validator requires (code, evals, migrations), so the read-back covers them. Then dispatch the verifier (below). A phase with a human stop now shows "awaiting decision"; present the stop in the shape under Stops, and record each answer with `node $BUILD/scripts/journal-append.mjs <phase> decision --id <id> --outcome approved|rejected|answered --answer "..." --by "<who>"` (`at` defaults to now). Then validate the phase and continue only on a pass. In run-ahead mode, do not wait: queue the stop, and go on to any phase the dependency table allows with the decisions still pending (4 after 2 and 3; never 6 before `d1.*`, never 5's bake-off before `d4.verdicts`, never 7 before all of its decisions). When the human returns, present the queued stops in phase order, one after another.
5. **Flags.** With `--status`, run `state-from-journal.mjs`, print STATE.md (its first line says the phase, what it is waiting on and the mode) and stop. With `--phase N`, run that phase only after confirming its preconditions in the journal. With `--mode`, run `journal-append.mjs --mode <m>` and carry on.

A stop in the middle of a phase (phase 5 asks for the key and a confirmation of the model cap before its bake-off) is recorded the same way with `decision` while the run is still open, and the phase resumes once the journal holds the answer; a decision recorded early with `--pre` answers it without a stop.

## The phases

| # | Skill | Produces | Stop |
|---|---|---|---|
| 0 | `watchdog-survey` | `.watchdog/MAPPING.md`, `CONTRACT.md`, `EGRESS.md`, `incident-sample.jsonl` | `d0.scopes`, `d0.egress`, `d0.caps` |
| 1 | `watchdog-explain` | `.watchdog/explainer.html`, `.watchdog/CANVAS.md`, `.watchdog/canvas.html` | `d1.explainer`, `d1.canvas` |
| 2 | `watchdog-incidents` | `docs/incidents/incidents.jsonl`, `docs/incidents/holdout.json` | `d2.holdout` |
| 3 | `watchdog-heartbeats` | Heartbeats, the sweep route, parity and drift evals, door adapters and door checks, the reader and writer roles; `.watchdog/HEARTBEATS.md` | `d3.credential`, only if one is needed |
| 4 | `watchdog-checks` | `lib/watchdog/checks/*`, evals, conformance run, live dry run; `.watchdog/OBLIGATIONS.md`, `CHECKS.md` | `d4.verdicts` |
| 5 | `watchdog-review` | Packet builder, review checks, model shortlist and bake-off; `.watchdog/REVIEW.md` | `d5.key` and `d5.cap` before the bake-off; `d5.model` and `d5.slots` after it |
| 6 | `watchdog-page` | `/watchdog` page and trace, verdicts, alert previews, hub projection; `.watchdog/PAGE.md` | none |
| 7 | `watchdog-eval` | `.watchdog/EVAL.md` against the gates | `d7.eval` before the eval runs; `d7.merge` after it passes |
| 8 | `watchdog-prove` | `.watchdog/REPORT.md` marked operational, with the sweep id it was proven on | `d8.deployed` before it starts |

The artefact paths are the ones `scripts/journal-lib.mjs` requires; if a phase skill writes somewhere else, the validator, not the skill, is wrong, and both get fixed together. The validator also fails an artefact that still holds a template placeholder such as `{client}`, or a required section with nothing under it, because a copied template that passes would be a claim of work nobody did.

Nothing after phase 0 starts until a human has approved the scopes, the egress policy and the caps: phase 2 reads host logs and error trackers, phase 3 creates the SELECT-only role, and the egress policy decides what any of them may see. `journal-append.mjs <phase> started` enforces this; the only way past it is the approval.

Phase 0's approval sets both spend caps, one for live reads of production and one for paid model calls, and the journal carries them forward. A later phase spends within them without asking again and may only lower them; the phase that first spends against a cap (phase 4 for live reads, phase 5 for model calls) states the measured size of that spend when it does.

## The verifier

After every phase closes, before you present its stop, dispatch the `verifier` subagent by name (installed for Claude Code from `agents/verifier.md` and for Codex from `codex/agents/verifier.toml`). Its brief names the phase number and skill, the absolute paths of the artefacts the journal entry recorded, the absolute path of the shared contract (`$BUILD/references/shared-contract.md`), and the absolute path of the phase's SKILL.md, whose stop section holds the acceptance criteria. Pass absolute paths because the verifier starts in the client repo and cannot find the kit from there. Its verdict goes to the human with the stop. A `fail` sends the phase back to run again; an `unverified` criterion is shown, not waved through. At a phase with a human stop, the brief tells the verifier to judge every criterion except the decision, which cannot exist yet, and `validate-phase.mjs` reporting "awaiting decision" at that point is expected, not a defect. If the host cannot dispatch the verifier, say so at the stop, because the human is then approving without an independent read.

## Adjudicating the holdout

Phase 2 leaves every holdout case with `adjudicated_by`, `adjudicated_at` and the file's `frozen_at` set to null. At its stop you put each case to the human. When they answer, you, not the phase agent, write their answers into `docs/incidents/holdout.json`: drop or amend the cases they asked to change, set `adjudicated_by` and an ISO `adjudicated_at` on every case, and set `frozen_at`. Only then record `d2.holdout` with `journal-append.mjs 2 decision`, which re-hashes the file, and put the count adjudicated and the recall threshold per severity they set into the answer, since phase 7 judges the replay against it. The order matters: hashing before the write-back would record a sha256 the frozen file no longer has, and validation would call the holdout stale. After that the file changes only through a new adjudication.

`decision` re-hashes every artefact the entry recorded and names any that changed. Use it only for changes the human's answer made; any other edit to a closed artefact means the phase runs again.

## Between phase 7 and phase 8

Phase 7 ends with `d7.merge`. Recording it merges nothing. Then wait. The human merges and deploys; you do not. Phase 8 can only observe a scheduled sweep on the deployed revision, so starting it before the deploy would prove the old code. Ask the human to tell you when the merge is deployed and which revision is live, record it as `d8.deployed` with the revision as the answer, and start phase 8 only once the journal holds it.

## Stops

A stop is a question with the evidence attached, not a status update, and every stop has the same shape so that nine of them read as one system:

```
### Checkpoint: <decision id>
<the artefact paths, the verifier's verdict, and what each answer changes>

---
<the question>
1. <option>
2. <option>
3. Something else (say what)
```

Name the options; the human picks rather than composes, and the recorded answers stay comparable across clients. The evidence comes before the question: post the stop as text with the artefacts linked (published as private artifacts where the host can publish them, see the explain phase) and end your turn, so the human can read the contract or look at the design before anything asks for an answer. Never open a question tool in the same turn that first shows its evidence, because the tool covers the screen and invites an approval of something nobody has seen. On the human's next message, take a typed number as the answer, or, if they say they have looked, offer the same options through the host's question tool where it has one; where it has none (Codex), the numbered list is the question and the human types a number. End with the command that records the answer. Markdown headings and rules only, nothing drawn in box characters. Record the answer in the journal with who gave it and when. The build does not continue on silence; in run-ahead mode it continues elsewhere and comes back to the queue.

## When something fails

A phase that cannot finish records `node $BUILD/scripts/journal-append.mjs <phase> blocked --reason "..." --needs "..."`. Do not skip it and do not mark it done with caveats. A phase whose inputs changed since it ran (a new approved scope, a changed egress policy, an upstream artefact rewritten) is invalidated along with every phase after it; `finished` and `validate-phase` detect this from the inputs recorded at `started` and name the earliest invalidated phase, and you start again from there. A journal line that is not JSON stops every script with its line number; fix that line by hand, then run `state-from-journal.mjs`.

## What you do not do

You do not deploy. Pushing the client's main branch is the human's act in every client this kit has been built for. You do not read `.env` values; the survey records variable names only. You do not create test data in production and you do not send anything. You do not write `.watchdog/STATE.md` yourself; the scripts generate it from the journal.
