# Worked plan: Bookings automation for a food tour company

Status: approved (worked example; figures are samples). This is the build whose boards set the bar for craft: example A on the design canvas.

The build takes every booking from the website, confirms it, invites the guest, schedules guides, asks for reviews and handles refunds, across n8n, GoHighLevel and the web app. It runs dozens of jobs a day, the owner gave minutes per task at kickoff, and the build is on the Custodian tier, so a Watchdog already watches it. The page leads with bookings handled and hours given back, split honestly into measured and estimated, and the Watchdog page becomes its Health tab.

## 1. Evidence

| Source | What it says | What it changed |
|---|---|---|
| Proposal | "Stop spending the evening on booking admin." Confirmations, guide schedules, reviews and refunds automated. | Headline is bookings handled and hours back. |
| Baseline | Minutes per task from kickoff: confirmation 1.5, guide schedule 24, review request 0.6, refund 10. | Hours saved can be credited per workflow and labelled as estimated. |
| Code | n8n workflows for confirmations, schedules and refunds; GHL for review requests; Stripe for payments; the booking form in the web app. | Four workflows in the ranked list; run events needed from n8n and GHL. |
| PostHog | 40 to 60 bookings a day, weekend peaks. | Charts and trends work; an activity heatmap is meaningful. |
| Code | `.watchdog/` exists with CANVAS.md and PAGE.md. | Health is the Watchdog page, not rebuilt. |
| Code | Design tokens in `app/globals.css`: cream ground, clay accent, Fraunces and Inter. | The page uses them. |
| Call | Owner and ops lead both check it; guides never need it. | Two roles, both full view. |

## 2. Decisions, step by step

| Step | Decision | Why |
|---|---|---|
| 1. Promise | Bookings handled and hours given back, then problems caught. | The owner's words. |
| 2. Roles | Owner and ops lead, both full view. Guides do not get the page. | Both ask "is it working and what did it give us". |
| 3. Units | Booking (paid, confirmed, toured, reviewed), refund, guide schedule. | All have timestamps in the app or n8n. |
| 4. Measured or estimated | Run durations measured from n8n start and finish; hours partly measured (before vs now per run), partly credited from kickoff minutes, shown split. | Mixing them silently would inflate the headline. |
| 5. Comparisons | Hours against last month, time per booking against the kickoff time, bookings per day as a rate. | Each tile needs one. |
| 6. Volume and zero | Dozens a day: trend charts, heatmap and funnel all work. Zero bookings in a day is a fault. | Volume supports it. |
| 7. Silent failures | A workflow going quiet, GHL review requests pausing, Stripe and the books disagreeing. | Already covered by Watchdog checks. |
| 8. Panels | See section 4. | |
| 9. Data | `workflow_run_started` and `_finished` from every n8n workflow and GHL; booking funnel steps from the form. | Needed for runs, durations and the funnel. |
| 10. Look | Client tokens; desktop first, works at phone width. | From globals.css. |

## 3. Role matrix

Owner and ops lead see everything. Guides have no access.

## 4. Tabs and panels, by role

### Owner and ops lead: "Is it working, and what did it give us?"

Summary:
1. **Status line**: everything ran on time this month, or what needs a look.
2. **Headline sentence**: bookings handled and hours back, with the measured and estimated split right under it.
3. **Four numbers**: hours saved (split), bookings handled (with a daily line), time per booking against kickoff, problems and whether they were fixed.
4. **Hours saved by week**: stacked measured and estimated, go-live marked.
5. **What did the work**: the four workflows, named for what they do for the business, with runs and hours.
6. **How we count**: fixed wording on measured versus estimated.

Detail:
1. **Totals strip**: jobs, success, hours, typical job, errors, staff, visits, AI cost.
2. **Per-workflow table**: runs on, runs, succeeded, typical, slowest 5%, minutes saved each, hours, trend, last run; each row opens its own page.
3. **Activity heatmap**: when the work happens.
4. **Booking form, step by step**: where people leave, linked to the recordings.
5. **Errors**, **website speed**, **AI usage**, **who uses it**, **latest runs**, **where the numbers come from**.
6. **One workflow page**: timings histogram, where the time goes by step, facet filters, run list with an expandable step trace.

Health: the Watchdog page (finding cards, uptime strip, checks and recent sweeps).

## 5. Considered and left out

| Panel | Why not |
|---|---|
| Money recovered | Not what the owner bought it for. |
| Every subject grid | Tours are not something the owner thinks of as assets. |
| Low-volume timeline | Volume is high enough for charts. |

## 6. Health checks

Owned by the Watchdog: every booking got its confirmation, review requests went out, guide schedules sent by 6:15 pm, Stripe and the books agree, payments recovered, booking form up.

## 7. Data to add

| Event | Sent from | Properties |
|---|---|---|
| `workflow_run_started` / `_finished` | Last node of each n8n workflow; GHL webhook | workflow, result, duration_s, items, minutes_saved |
| `booking_form_step` | Web app | step, tour_id |
| `$ai_generation` | AI tracing, privacy mode | model, tokens, cost; tagged with client_slug explicitly |

## 8. Open questions

1. Should guides get a tiny page of their own with tomorrow's tours? Best guess: not on this page; it is a separate feature.
