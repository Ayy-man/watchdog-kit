# Worked plan: Multi-tenant AI appointment-setting platform

Status: approved 27 oct (worked example; names are placeholders and figures are samples)

AI agents book calls for dozens of coaches, each a separate tenant. The platform owner needs to know the business is healthy and which tenants are at risk; each coach needs to know how many calls the agent booked for them and whether it is getting better. Same events, very different pages, and money must never reach a coach’s screen or data.

## 1. Evidence

| Source | What it says | What it changed |
|---|---|---|
| Code | Roles: owner, admin, success, coach, affiliate. Tenant id on every row, row-level security. | Four views. Every query is scoped by tenant and role at the database, not in the UI. |
| Code | appointments, conversations with first_touch_keyword, tenant_cost_rollups, tenant_health_signal_snapshots. | Bookings, conversion by cohort, cost per tenant and at-risk signals are all measurable. |
| Docs | Margin shows as absent, not zero, until every cost rate exists. Churn and LTV held back until there is enough history. | Absent states are designed in, and copied as a rule for every build. |
| Code | 17 cron jobs, some every 2 to 5 minutes. GHL sub-accounts, Meta channels, A2P registration. | Health is per channel per tenant, and outside approvals are part of it. |
| Code | Existing coach Home, admin Overview, Channel health and System pages. | The skill replaces these with one page per role rather than adding a fifth. |
| Dropped in | “Coaches keep asking how they compare.” | Coaches see their rate against the platform median, never another coach’s name. |

## 2. Decisions, step by step

| Step | Decision | Why |
|---|---|---|
| 1. Promise | To the owner: bookings and MRR growing, tenants staying. To a coach: booked calls from their leads. | Two promises, one per audience. |
| 2. Roles | Owner, admin, coach, affiliate. Success staff use the admin view. | Matrix below; money is owner only. |
| 3. Units | Lead, conversation, booked appointment, message, eval run. | Appointment is the headline unit for everyone. |
| 4. Measured or estimated | Bookings and conversion measured. Margin absent until all cost rates exist. | From the docs’ own honesty rule. |
| 5. Comparisons | Conversion against the previous cohort. Coaches against the platform median. MRR against last month. | Peer comparison is what coaches asked for. |
| 6. Volume and zero | Hundreds of conversations a day: charts and cohorts work. A tenant with zero bookings this week is a risk, not a quiet week. | The volume supports trends. |
| 7. Silent failures | Inbound recovery cron silent, a channel losing approval, a tenant’s replies stopping, eval scores dropping. | Each stops bookings without an error. |
| 8. Panels | See section 4. |  |
| 9. Data | appointment_booked and conversation_stage_changed with tenant_id, a nightly per-tenant rollup, cost events owner-only. | Cost never goes into the events coaches can query. |
| 10. Look | The app’s own system; the coach view works in the mobile drawer. | Coaches live on their phones. |

## 3. Role matrix

| Panel | Platform owner | Admin and success | Coach | Affiliate |
|---|---|---|---|---|
| Calls booked | Full | Full | Own | Own (referrals) |
| Lead to booked rate | Full | Full | Own, against anonymous median | No |
| MRR, revenue, margin | Full | No | No | No |
| AI and message cost | Full | Count | No | No |
| Coaches at risk | Full | Full | No | No |
| Channel status | Full | Full | Own | No |
| Agent performance and run logs | Full | Full | No | No |
| Referral payouts | Full | No | No | Own |

Cost is recorded in an owner-only pipeline and never enters the events a coach's queries can read.

## 4. Tabs and panels, by role

### Platform owner: “Is the business healthy, and who is at risk?”

1. **MRR, active tenants, bookings, margin**: Margin shows as absent until costs are complete.
2. **Bookings and MRR by week**: The volume supports a trend.
3. **Tenants at risk**: Ranked by falling bookings and silence.
4. **Cost per booked call**: Owner only.
5. **Channel status across tenants**: Approvals that could stop bookings.

### Admin and success: “Who needs help this week?”

1. **Tenants at risk, with the reason**: Their working list.
2. **Channel issues to fix**: A2P and Meta problems by tenant.
3. **Agent performance**: Eval scores and handoffs.
4. **Usage counts**: Counts only, no money.

### Coach: “How many calls did it book me, and is it improving?”

1. **Calls booked this month**: Their headline.
2. **Lead to booked, against the platform median**: From the dropped-in note.
3. **Best keywords and channels**: What to post more of.
4. **Their own channel status**: Only their tenant.

### Affiliate: “What have my referrals earned me?”

1. **Referred coaches and status**: Their only question.
2. **Payouts**: Their own money only.

## 5. Considered and left out

| Panel | Why not |
|---|---|
| Hours saved | Not the promise to anyone here. |
| Run logs for coaches | Noise for them; admin only. |
| Named coach leaderboard for coaches | Peer data is anonymous, as a median. |
| Churn and lifetime value | Held back until there is enough history, per the docs. |

## 6. Health checks

| Check | Protects |
|---|---|
| Inbound recovery cron silent for 15 minutes | Missed leads across every tenant. |
| A tenant’s replies stopped | That coach’s bookings. |
| Channel approval at risk (A2P, Meta) | Messages being blocked. |
| Eval score down on last week | Booking quality. |
| Cost per booked call up 30% | Margin (owner only). |

## 7. Data to add

| Event | Sent from | Properties |
|---|---|---|
| `appointment_booked` | App, on booking | tenant_id, channel, keyword, minutes_from_first_touch |
| `conversation_stage_changed` | App | tenant_id, from, to |
| `tenant_rollup` | Nightly job | tenant_id, bookings, conversion, at_risk_reason |
| `cost_recorded` | Owner-only pipeline | tenant_id, kind, usd (never in coach-readable events) |
| `heartbeat` | Each of the 17 crons | job, last_run_at |

## 8. Open questions

1. Should success staff see cost? Best guess: no, counts only, same as admin.
2. What counts as at risk? Best guess: bookings down 40% on their 4-week average, or no replies for 48 hours.
3. Do affiliates need this page at all? Best guess: yes, a small one; it replaces an emailed spreadsheet.
