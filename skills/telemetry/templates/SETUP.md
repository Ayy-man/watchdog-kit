# PostHog setup log: {client}

Every step, fix and surprise from the install, in order. Surprises worth keeping for every build go back into the skill's `references/install.md`.

## Repo rules

- [ ] Package manager, local env file, what deploys production, migration tool: {from the repo's docs}
- [ ] Working on branch {name}; pull request {link}

## Project

- [ ] Account: {builder's org | client's own | partner's}, organisation {name}, paid by {who}
- [ ] Project: {new | existing}, {name, id}, created or opened by an org admin
- [ ] Region: {US | EU}, confirmed by the account owner (UK and EU clients: see install.md)
- [ ] Timezone: {zone}
- [ ] Test-account filters: is_internal, environment
- [ ] Token in {local env file per the repo's docs} and the host's environment settings (names only here)

## Install

- [ ] Wizard run (or CI mode), hand-off file read and finished
- [ ] Type check, build and tests pass; new dependency peer ranges checked
- [ ] Tags (`client_slug`, `app`, `environment`) on browser, server and every path that skips the wrapper
- [ ] Identify from the session provider, `is_internal` from the allowlist, `reset()` on the sign-out click
- [ ] AI privacy mode on every traced call; `@posthog/ai` supports this `ai` SDK version, or manual `$ai_generation`
- [ ] Log and trace forwarding: {off | on, after checking it carries no prompts or personal data}
- [ ] Captures and flushes off the request path
- [ ] Reverse proxy, middleware matcher checked
- [ ] Sensitive screens blocked, deployed, then session replay on: {sample rate, minimum duration}
- [ ] n8n, GoHighLevel and scheduled-job events sending
- [ ] Verified against real data: {what was queried and what came back}

## Billing gate

- [ ] Billing limit set on every paid product this build turned on, confirmed by the account owner {name} on {date}: {product: cap, ...}

## Replay gate

- [ ] Masking deployed: {deploy id}
- [ ] Lawful basis recorded by the account owner {name} on {date}: staff ({DPIA done, staff told}), customers ({consent or exemption}), partner sign-off ({name}), privacy policy covering recordings ({link})
- [ ] Public customer-link pages excluded from replay: {routes}

## Log

<!-- date · what you did · what happened · what you changed -->
