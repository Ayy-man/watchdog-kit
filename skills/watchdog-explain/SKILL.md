---
name: watchdog-explain
description: Produce a one-screen visual explainer of this client's doors and end states and a design brief (the canvas) for the watchdog page in the client's own design tokens, then stop for the human to approve both. Loaded by watchdog-build during a build; not for use on its own.
---

# watchdog-explain

You are turning the approved doors contract into two things a non-engineer can hold in their head: a picture of the app as a box with doors, and a brief for the page where findings will be judged. Read `../watchdog-build/references/shared-contract.md` for the vocabulary, then `.watchdog/CONTRACT.md`, `.watchdog/EGRESS.md` and `.watchdog/MAPPING.md`, because the explainer must use this client's real door names and nothing invented. The canvas, in this skill, is `.watchdog/CANVAS.md`: the written design brief the findings page will be built from.

## 1. Draw the box and the doors

Write `.watchdog/explainer.html`: one screen, no scrolling at desktop width, a two-minute read. The picture is the app as a box; each door from the contract is a labelled opening on the edge (inbound on the left, outbound on the right, internal crons along the top), with its proof written under it in one line ("proof: `outbound_send_attempts.status = accepted`"). Inside the box, show the end states as short arrows between doors ("a received message owes a reply within 15 minutes"). Take them from the contract's `## Obligations` section, one arrow per obligation, worded as what should be true between the door that creates it and the door that settles it; the contract has no separate end-state list, and an arrow you cannot trace to an obligation row is invented. Draw them that way because the end states are what the model reviews and the doors are what code checks, and the reader should see that split without being told.

Use the status words on the doors as they stand in the contract: proven, failed, unknown, unsupported. An unknown door is drawn with a dashed edge and the word on it, never left off; the point of the picture is to make the gaps as visible as the coverage. A door with no proof at all is drawn as finding 0, in those words.

Keep it to one screen, one idea per block and no jargon, because the reader is judging whether the picture matches their app, not learning the kit: each door's label is its contract name in the words the operator uses (the proof line beneath can name the column), nothing is animated, labels are large, a single accent colour marks "this is where a check looks" and a muted neutral marks "nothing can see here". Put a three-line caption at the top that says in plain words what report-only means (it reads, it records its own findings, it sends nothing), faithful to the contract's definition: it reads app data through a SELECT-only role; writes only the watchdog's own tables through a separate writer. The caption is there so the reader is not waiting for a catch. Respect `prefers-reduced-motion` and keep contrast at WCAG AA.

## 2. Write the canvas brief

Look for the client's design system first: a design or brand document at the repo root or under `docs/`, a tokens file (JSON, CSS or JS), a theme module, a component library's theme config, or a utility-CSS config. Lift what it defines: palette, type, radius, spacing, and anything it says not to look like. Where there is no design system, fall back to the app's own tokens as the running app uses them: the custom properties in its global stylesheet, the theme its components import, the colours and faces that recur in its shared components. Name each token with the file it came from, so the page is built in the client's own clothes rather than a generic dashboard look.

Then write `.watchdog/CANVAS.md` from `$KIT/templates/CANVAS.md`: the brief for the watchdog page. Read `references/page-anatomy.md` before writing a line of the brief: it describes the first installation's page part by part, and the parts it names (the receipt line under the title, the uptime strip of sweep slots, the finding cards with evidence rows and the folded would-do and would-say, the verdict keys, the per-check scoreboard, the trace page) are defined there, with why each exists. Map every part onto this client's tokens and name the subject types from the contract that cards will link to. Say what a card looks like in each verdict state and in the stale-verdict state, and what the page shows when a check has errored or a door is unknown. Include the keyboard path through a card, because adjudication is a long sitting and a mouse-only page slows it.

## 3. Check it reads in two minutes

Open the explainer in a browser if one is available and time a read of it. Cut until the caption plus the picture fit on one screen at 1280 wide and the door labels are legible at phone width with a 16 px gutter. The brief is checked against the contract: every door in the table appears in the picture, and every scope type in the brief exists in the contract.

## 4. Stop

Write both artefacts and stop. Say what you wrote, then ask the human for two approvals, with the files attached:

- **The explainer.** Does the picture match how they understand their own app? Any door they would name differently, any end state missing, any arrow pointing the wrong way, goes back into the explainer now, because this picture is what every later finding will be read against.
- **The canvas.** Approve the page brief as the design to build, or name what to change. Point out any token you had to invent because neither a design system nor the app's own styles defined it, so they can supply the real one.

Both must be approved before the page is built; nothing else waits on this phase.
