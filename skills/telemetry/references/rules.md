# Rules every build keeps

These hold on every page this skill builds, whatever the plan says. A requirement that would break one is raised with the human along with the closest alternative that keeps the rule. The sources are where each rule comes from; the full research notes are in the Hexona vault at `hexona/operational/active-projects/vitalmeter/research.md`.

1. **Every headline number shows a comparison**: a baseline, a target, last period or a peer median. A number on its own is moved to the detail layer. (Stephen Few, "Common Pitfalls in Dashboard Design"; GOV.UK Service Manual, setting performance metrics.)
2. **Measured and estimated figures are labelled as such**, with the assumption and who gave it one click away. Estimates are never added into a measured figure without saying so. (UiPath Insights ROI model, which keeps actual and estimated benefit apart; Forrester TEI, which risk-adjusts estimates; UK Government Analysis Function on communicating uncertainty.)
3. **Baselines are locked and dated at kickoff**, per unit of work, and the page shows the date. Without one, every saving is contested. (Automation Anywhere on RPA ROI.)
4. **The summary holds three or four numbers in the client's own words.** Everything else is one deliberate click away, never mixed in. (Nielsen Norman Group on progressive disclosure.)
5. **Every figure shows where it came from and how fresh it is**, and stale data is flagged, not hidden. (GOV.UK Service Manual, data you must publish; UK Code of Practice for Statistics.)
6. **Silence is a finding.** A job, feed or heartbeat that goes quiet past its allowed window is never shown as green. (Google SRE book, monitoring distributed systems; Prometheus `absent()` and dead man's switch practice.)
7. **A missing figure shows as absent, never as zero**, with what it is waiting on.
8. **Figures a role must not see are left out of that role's data**, at the query, not only hidden on screen.
9. **Verdicts take one tap**, false alarms ask why, and the page shows how often the checks are right from those verdicts. Unsure and low-confidence findings go to a person first. (Google PAIR guidebook on feedback; Microsoft HAX guidelines 9 and 13; Settles on active learning; Sendelbach and Funk on alarm fatigue.)
10. **The client's own design system and tokens**, with no Hexona name, colours or marks on a partner client's page.

And two that follow from Hexona's PostHog setup: every event carries `client_slug`, `app` and `environment`, including events from paths that skip the app's capture wrapper (AI tracing, n8n, GHL); and AI usage is recorded as counts and cost only, never prompts or outputs.
