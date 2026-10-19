# Alert routes, the hub projection and the two contract levels

The page is always on. Everything in this file beyond the page belongs to one of two contract levels, and the level decides what the deployed watchdog is *able* to do, not what a setting says it should do.

- **Report-only.** The runtime holds no notification credential, no notification-table grant and no hub-write capability. Alerts are rendered and recorded as `meta.alerts` previews on the finding; nothing is sent. The hub reads a projection; the watchdog never posts. This is the level every build ships at first, and its proof is that the sender has nothing to send with, not that a flag reads off.
- **Report-and-tell.** The same code with a separately provisioned sender: its credentials and grants are added in a change of their own, after the report-and-tell gates in `EVAL.md` pass, and the route settings below become operational controls. A setting is never the evidence that report-only cannot send; it is how an authorised installation chooses which routes are live.

The alert sender lives in `lib/watchdog/alerts/send.js`, imported only by the route modules, and the report-only build does not provision what it needs (no `WATCHDOG_ALERT_*` credential, no grant on any notification table). `lib/watchdog/alerts.js` (kinds, grouping, caps, rendering) is built and tested at report-only because the previews on the page are how the human judges the routing before any send is authorised.

## Alert kinds

A fixed enum in code, mapped from finding kinds. A finding kind that maps to nothing produces no alert; a new mapping is a code change with a reason.

| Alert kind | From finding kinds | Default severity floor |
|---|---|---|
| `outcome_overdue` | `no_outcome_past_due` | high |
| `delivery_missing` | `sent_not_delivered` | high |
| `inbound_unapplied` | `webhook_received_not_applied`, `reply_unapplied` | high |
| `inbound_silent` | `inbound_silent`, `absence_against_baseline` | medium |
| `send_burst` | `send_burst` | high |
| `drift` | `settings_drift` | medium |
| `provider` | `provider_credit`, `model_unavailable` | medium |
| `money` | `money_mismatch` | high |
| `watchdog_self` | `check_error`, `sweep_missed`, `stale_alarm` | medium |

## Payload

An alert carries the finding id, the alert kind, the severity, the scope key, the page link and the trace link. Nothing else: no title, no subject list, no would-say text, no evidence value. Titles and subjects are text derived from app data and the egress policy governs them on the page, where the reader is already authorised; an alert reaches a channel the policy did not review. The person follows the link.

## Routes

Each route is a module with `send(alert)` returning a proof (`{ status, evidence, reason, at }`). Under report-and-tell a route is live only while `settings.watchdog_alert_<route>_enabled` reads exactly `true`; anything else, including a settings read that throws, reads as off. This is the one place the shared "a gate that cannot be read is on" rule is reversed, on purpose: that rule protects a check from assuming the quiet case, while here an alert sent by mistake is the mistake.

- `owner_email`: to the owner alert address from settings, subject `[watchdog] <alert kind> on <scope>`, body as the payload above.
- `chat_webhook`: one message to a webhook URL held in an environment variable by name, same payload.
- `in_app`: a notification row in the client's own notification table, with the finding id as the dedupe key. This route writes outside the watchdog's own tables, so it needs its own grant, provisioned with the sender under report-and-tell and never under report-only.

Every send is a door of its own, with its proof table in `$KIT/core/sql/0006_alert_sends.sql`: an `alert_sends` row claimed before the attempt (finding id, route, generation, attempt, `status: claimed`), the proof written after it (`proven` with the provider id, or `failed` or `unknown` with the error; `unknown` is settled by hand, never retried blindly), and the recipient-side dedupe key set so a crash between acceptance and proof cannot duplicate on retry. A retry never resends an older generation once a newer one has been claimed.

## Grouping

One alert per finding id per route per interval, and one alert per incident group: findings with the same check, kind and scope raised in the same sweep are one alert carrying their count and the page link filtered to them. A finding that reopens after resolution may alert again after the interval. The grouping key and the interval are constants in the module with the reason beside them.

Inhibition runs before grouping: while a door-level or provider-level finding is open on a scope (a webhook route returning errors, a provider refusing, the watchdog's own `check_error` for a check), the alerts for the kinds it explains on that scope are held, and each held alert is recorded on its finding under `meta.alerts` as "inhibited by <finding id>". The findings themselves are untouched; only the attention is folded into the parent, so an outage produces one alert, not one per affected subject. The inhibition map (parent kind to child kinds) is a constant in the module with the incident that justified each row.

## Caps and escalation

Escalation is through caps, not volume: at most `max_per_day` alerts per route (default 10), at most one per finding per `repeat_interval` (default 12 hours), and when the day's cap is reached one final "cap reached, n suppressed" alert goes and nothing more until the day turns. A high-severity finding open for longer than `escalate_after` (default 24 hours) moves to the next route in the escalation list once. Every decision, including every suppression, is recorded on the finding's `meta.alerts` so the page shows "would alert on owner_email" at report-only and "would have alerted, capped" at either level.

## Existing monitoring

Where `MAPPING.md` matched a finding to an existing incident (`meta.existing_monitoring`), the matched route is suppressed for that finding's condition and occurrence only, with the suppression recorded under `meta.alerts`. Unrelated kinds keep their routes; one uptime probe does not switch off the business alerts.

## Hub projection

The central dashboard pulls; the watchdog never posts. `GET /api/watchdog/summary` returns the bounded aggregate below, read from the watchdog's own tables only, through the core's read-only wrapper over the writer, behind a bearer token held in an environment variable by name and scoped to this one route. The hub polls it on its own cadence and raises its own "silent installation" when a poll fails or the sweep id stops moving, which is a stronger silence signal than any push could give, because the watchdog's own outage cannot suppress it. Never a finding's text or evidence.

```json
{ "version": 2,
  "installation": "acme-prod", "scope": "acme-prod/t_42/production", "environment": "production",
  "contract_level": "report-only",
  "sweep": { "id": "sweep_01HZ...", "generation": 412, "started": "2026-10-19T07:30:02Z", "finished": "2026-10-19T07:31:40Z", "trigger": "cron", "ok": true },
  "checks": [{ "id": "reply_owed_not_sent", "open": 2, "high": 1, "medium": 1, "low": 0, "errored": false, "complete": true, "truncated": false }],
  "totals": { "open": 5, "reviewed": 40, "correct": 31, "false_alarm": 6, "unsure": 3 },
  "uptime": { "window_hours": 48, "expected": 96, "ran": 95, "missed": 1, "errored": 0 },
  "receipt": { "sources": 14, "rows": 3120, "truncated_sources": 0, "model_key": "WATCHDOG_OPENROUTER_API_KEY", "model_calls": 3, "model_cost": 0.42 } }
```

The projection is validated against this schema in an offline eval and listed in `EGRESS.md` as an approved read with its token variable name.
