# Page anatomy: the watchdog page in the first installation

The first installation's page is a test pen: a place where every finding the watchdog raises is judged by a human before the watchdog is ever allowed to act. Its parts exist because of specific failures during the first weeks of report-only running. Describe each part in the canvas brief in the client's own tokens; keep the function, change the clothes.

## Header and receipt line

The title, then a folded line under it: "Last sweep 07:31, 21 checks, 3 open, 2 sources truncated", with a chevron. Opening it shows the sweep receipt: sources read with row counts and truncation, per-check coverage (examined, complete, fresh as of) and timing, which checks were skipped or waiting on a review slot, and which key the model ran on by name. The receipt exists because "the sweep ran" told nobody whether it had actually looked at the thing it was silent about. A sweep can be started by hand from here, and a hand-started sweep is recorded under a different job name from the cron.

## Uptime strip

One bucket per sweep slot across the last day or two, oldest first, newest on the right: a short bar whose height is open findings and whose colour says whether the sweep ran, errored, or was missed. A missed slot is a gap, not a zero bar, because a watchdog that silently stops running is the failure it exists to catch. Under it, a one-line summary: sweeps in the window, missed, errored.

## Finding cards

The main column. Tabs filter by state: open, to review (no verdict, or a stale verdict), judged, resolved. Each card carries:

- the title in the display face, at most 90 characters, naming the subject;
- severity and check id as small chips, with the subject type and a link to the subject in the app;
- a detail paragraph: what is wrong, how the check can tell, what happens if nobody acts;
- evidence rows: one row per EvidenceRef, source, id, field and value, with timestamps rendered in the client's zone and ages ("3 hours ago") computed at render time;
- "seen" words: first seen, last seen, how many sweeps it has been seen in, and reopened count;
- a hidden plan: "What it would do" and "What it would say", folded by default behind a disclosure, so the inert action and the exact words are reviewable but do not read as something that happened;
- the verdict row.

System findings (check_error, model_error, model_unavailable, rejected, packet_error) use a quieter card and are kept out of the precision numbers, because they are the watchdog reporting on itself.

## Verdicts

Three keys on each card: Correct, False alarm, Unsure, with an optional reason. Keyboard: a card takes focus, `c`, `f`, `u` set the verdict, `r` opens the reason, arrows move between cards. A verdict belongs to the finding as judged: it is stored with a fingerprint of the title, severity, evidence and scope, and when the finding later changes or reopens the page shows it as "to review again" with the old verdict beside it, never cleared. Totals at the top of the column read "Reviewed n, correct n, false alarms n", which is the precision figure that decides whether the watchdog may ever act.

## Per-check scoreboard

A rail beside the findings: one row per check with open count, verdict counts, last run duration, last error if any, and the incidents it claims to catch. A check with an open check_error finding is marked on the rail, because a blind spot should be visible from the front page without opening the receipt. Below it, recent sweeps as a list with duration, open count and any error.

## Trace page

Each finding links to `/watchdog/<id>`: the whole story of one finding in order. Inputs: for a rule check, the rows it read, filtered to the subject, with the matching rows highlighted; for a model check, the packet as sent (loaded on demand, pseudonymised per the egress policy), the model and the key name, the tokens and the estimated cost. Decision: for a rule check, the rule in words and the values that met it; for a model check, the raw finding, every evidence ref with whether its quote matched, and what was dropped and why. What went out: the finding row, the alert state ("no route can send at report-only", or the send proof), and the would-say text held back. The trace is what lets a human mark "false alarm" with confidence and tell the developer exactly which value misled the check.

## Empty and error states

A page with no findings says so with the last sweep time, never a blank. A page whose sweep is failing shows the error at the top in the error colour with the job name and time. A door listed as unknown or unsupported in the contract is shown in a short box above the scoreboard, in words, so a reader does not mistake silence for coverage.

## What the brief must specify for this client

The tokens for each state (open, judged correct, false alarm, unsure, stale verdict, resolved, system), the display and body faces, the card radius and spacing, the chip style, the accent used for "a check looked here", the error colour, focus rings, the phone layout (cards full width, rail below, receipt as a sheet), and the link targets for each subject type in the contract.
