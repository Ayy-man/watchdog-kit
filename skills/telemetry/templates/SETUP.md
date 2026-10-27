# PostHog setup log: {client}

Every step, fix and surprise from the install, in order. Surprises worth keeping for every build go back into the skill's `references/install.md`.

## Project

- [ ] Project created in the Hexona organisation: {name, id, region}
- [ ] Timezone set to America/New_York
- [ ] Test-account filters: is_internal, environment
- [ ] Token in `.env.local` and the host's environment settings (names only here)

## Install

- [ ] Wizard run (or CI mode), hand-off file read and finished
- [ ] Type check, build and tests pass; new dependency peer ranges checked
- [ ] Tags (`client_slug`, `app`, `environment`) on browser, server and every path that skips the wrapper
- [ ] Identify on login, `is_internal`, `reset()` on sign-out
- [ ] AI privacy mode on every traced call
- [ ] Captures and flushes off the request path
- [ ] Reverse proxy, middleware matcher checked
- [ ] Sensitive screens blocked, deployed, then session replay on: {sample rate, minimum duration}
- [ ] n8n, GoHighLevel and scheduled-job events sending
- [ ] Verified against real data: {what was queried and what came back}

## Billing gate

- [ ] Billing limit set on every paid product this build turned on, confirmed by {name} on {date}: {product: cap, ...}

## Log

<!-- date · what you did · what happened · what you changed -->
