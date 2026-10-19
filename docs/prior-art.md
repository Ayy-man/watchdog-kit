# Prior art and what the kit borrowed

Surveyed 19 Oct 2026 across GitHub, Hacker News and X. No public project does the whole combination (end-state checks on app tables, grounded model review, a findings page with human verdicts, incident replay as an eval, cron heartbeats). The mechanisms exist in five families, and each borrowing below had to pass one test: it makes a door's proof stronger, a finding's resolution safer, or a model output more grounded. Popularity was not a reason.

## Borrowed

| Mechanism | From | Where it lives in the kit | Why it passed the test |
|---|---|---|---|
| Finding identity as a hash of identifying fields, never of text; open, resolved, reopened as a regression | Alertmanager, Keep, Sentry issue grouping | `core/run.js` finding ids, `reopened_count`, the "back again" card label | A reworded finding keeps its row and its verdict; a returning fault reads differently from a new one |
| Group by key, repeat interval, parent-child inhibition | Alertmanager | `skills/watchdog-page/references/alert-routes.md` | One outage is one alert; the findings underneath stay intact and judged |
| Paired start and finish per run with a max runtime; schedule reconciled against the scheduler config | Healthchecks, Sentry Crons, Cronitor discover | `core/job-run.js`, `job_stuck`, the parity eval | A hung run and an overlapping run are both invisible to "did a row appear" |
| A result payload on the heartbeat with a floor | deadmancheck | `work_floor`, `job_did_nothing` | "Ran and did nothing" is the failure an operator notices last |
| Reconcile `cron.job` against `cron.job_run_details` in SQL | pg_cron | heartbeats phase, pg_cron clients | Native run history is a proof source; a wrapper would add a second recording path |
| Deterministic first, model second, exact-value grounding; mask identifiers before the call; cache per stable facts | k8sgpt, deepeval, Ragas | `core/grounding.js`, the packet hash | The model cannot invent a finding from nothing and cannot be re-billed for an unchanged subject |
| Human verdicts as scores; precision per check and per prompt version; proposals to retune or mute, never auto-applied | Langfuse annotation queues, Monte Carlo "Tune Monitor" | verdicts, `## Precision per check` in EVAL.md | Precision is the number that decides whether the watchdog may ever act |
| Incident replay as a fixture folder with the facts the output must contain and tags | HolmesGPT eval suite | `docs/incidents/holdout.json`, the eval phase | Recall on real incidents is the only honest measure of coverage |
| A hook that flags monitoring gaps when the code changes | Monte Carlo "Prevent" skill | `scripts/eval-contract-drift.mjs` | The doors contract rots silently otherwise |
| Message, then attempts with status, to prove outbound delivery | svix, outpost | the door adapter's `deliveryDoor` and `alert_sends` | Acceptance is not delivery |

## Considered and not taken

- **An external dead-man switch for the watchdog itself** (deadcheck). The owner chose not to run one. The hub projection is pulled, so the hub detects a silent installation without the watchdog's help, which covers the same failure from the other side.
- **Claim-level faithfulness as a second grounding pass** (deepeval, Ragas). The exact-value check already rejects any quote not in the packet, and the verify pass only ever lowers confidence. A second model judging the first adds cost and a new way to be wrong, without a failure it would catch that the exact check does not.
- **Anomaly tests learned from a training window** (Elementary, Deequ). The kit has one such shape, absence against a baseline per scope, with the baseline shown in the evidence. Learned thresholds beyond that trade explainability for coverage the incident log has not asked for.
- **Workflow engines for routing** (Keep). Routes, caps and inhibition are a few constants with the incident that set them beside each; a workflow language would hide that.

None of the alerting tools surveyed computes its own precision from human verdicts. That is the kit's differentiator and the reason the page exists before any alert does.
