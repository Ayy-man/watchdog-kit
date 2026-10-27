# Installing PostHog on a build

Everything here was learned putting PostHog on hexOS, the first build (full log in the Hexona vault at `hexona/operational/active-projects/vitalmeter/setup-log.md`). Follow it in order. Write what you do, and anything that surprised you, into `.telemetry/SETUP.md` as you go, because the surprises are what improve this file.

## The account

All client telemetry lives in Hexona's one PostHog organisation on pay-as-you-go, not in client-owned accounts. One project per build (past six projects, small clients share a project and are told apart by `client_slug`). The organisation is on the US region; for a UK client, raise the region question with the human before installing, because a project cannot move regions later and the client's privacy policy should name where their data goes.

Create the project, then immediately:

- Set its timezone to `America/New_York`. PostHog has no organisation default, so every new project starts on UTC.
- Set test-account filters: person `is_internal` is not `true`, and event `environment` is not any of `development`, `preview`, `smoke-test`, `test`. Leave "filter by default" off while Hexona staff are the only users, or every insight goes blank.
- Store the project token in the client's `.env.local` and the host's environment settings (Vercel through its connector if the CLI fails). Never paste a key into chat and never read `.env` values back.

## The wizard

Run `npx -y @posthog/wizard@latest` in the client repo. It needs an interactive terminal, so inside Claude Code it fails with `PHW_CLI_INTERACTIVE_REQUIRED`: hand the human the one command to run in a normal terminal, or use `--ci --region us --api-key <personal key>` with a key from the Keychain. Read its "Event plan" tab before it instruments.

Expect it to stop partway. On hexOS it got to step 4 of 10 and handed off with a task file under `.posthog/wizard-spellbook-*/README.md`. Read that file and finish the job yourself; do not assume the wizard completes. Gitignore `.posthog/` and `.posthog-wizard-cache/`.

After it, always run the type check and the client's own build through its own scripts, and check every new dependency's peer ranges and release date. On hexOS the wizard installed OpenTelemetry log packages a week old that needed a newer `@opentelemetry/api` than the AI SDK allowed; the fix was pinning the log packages to the previous line, not bumping the API. It also wrote `new BatchLogRecordProcessor(exporter)` where the current API takes `{ exporter }`.

## The Hexona layer on top

The wizard does the SDK, environment, error capture, logs and a first set of events. These are the additions it does not make:

- **Tags on every event.** A properties module exporting `client_slug` (the vault's kebab-case slug for whoever owns the build), `app` and `environment`. Register them in the browser with `posthog.register`; on the server, wrap capture, because posthog-node has no `register`. Then find every path that skips the wrapper and tag it explicitly. On hexOS the AI tracing (`withTracing` from `@posthog/ai`) sent `$ai_generation` events with no tags until `posthogProperties` was given the same object.
- **Identify and internal users.** Identify on login with the real user, not an impersonated one, and set a person property `is_internal` from the app's roles (Hexona staff true; partners and clients are real users). Call `reset()` on sign-out.
- **AI privacy mode.** Set `privacyMode: true` on the server client and `posthogPrivacyMode: true` on every traced model call. Agent prompts and replies carry client data; PostHog gets model, tokens, cost and latency only.
- **Never slow a request.** Send captures and flush logs from Next's `after()`, or the platform's equivalent, so a request never waits on PostHog. Route tests then need `after` stubbed, because it throws outside a request scope.
- **Reverse proxy.** Serve PostHog through the app's own origin (`/ingest` rewrites to `us.i.posthog.com` and the assets host, `skipTrailingSlashRedirect: true`, `api_host: "/ingest"`, `ui_host` set to the PostHog app), because ad blockers drop requests to PostHog's own domain. Check the app's middleware matcher does not swallow `/ingest`.

## Session replay

Cost is rarely the question on a small build: the free tier is 5,000 recordings a month and the billing limit stops recording at the cap. What is on screen is the question. Before turning replay on:

1. Search the code for every place a secret, credential, card or government number renders, and block it from replay with the `ph-no-capture` class. Remember that dialogs portal outside their parent, so tag their inputs directly.
2. Keep `maskAllInputs` on. Mask on-screen text on any page the client says is sensitive.
3. Deploy the masking, wait for the deploy to be live, and only then enable replay. Skip sessions under two seconds.
4. On a client build, get the client's consent first (for a partner's client, the partner's and the client's), and make sure their privacy policy covers recordings.

## Outside the web app

- **n8n.** The last node of every workflow sends `workflow_run_finished` (with `workflow`, `result`, `duration_s`, `items`, and `minutes_saved` where a baseline exists) to PostHog's capture endpoint, through the client's proxy or directly. A first node sending `workflow_run_started` makes durations exact. Connect n8n by default when the scan finds it.
- **GoHighLevel.** Each relevant workflow posts a webhook into PostHog with the same event shape. Connect it by default when found.
- **Stripe, Supabase, HubSpot and other sources** PostHog can import: connect as data sources when the plan needs them. Anything else sends through a webhook.
- **Scheduled jobs** (cron, Trigger.dev, Inngest and the like) send a `heartbeat` with `job` and `last_run_at`, so the page and the Watchdog can tell silence from success.

Name events and properties in snake_case, mirroring OpenTelemetry's CI/CD conventions for runs (`result` is one of `success`, `failure`, `error`, `timeout`, `cancellation`, `skip`; a run id is a property, never a metric label).

## Verify, never assume

A change that looks right is not a working install. After the deploy:

- Fetch `/ingest/static/array.js` and send one proxied capture; both should succeed.
- Check the live bundle initialises with the proxy host and registers the tags.
- Load the production site in a real browser (headless Chrome is dropped by posthog-js unless the user agent is overridden) and query PostHog for the `$pageview`, its tags and its environment.
- Ask the human to use the app for real, then query what arrived, event by event, and look for anything missing its tags.

## The billing gate

Setup is not finished until a billing limit is set on every paid product this build turned on: product analytics, session replay, error tracking, logs, AI observability and feature flags. One shared organisation means one noisy client can bill for all of them. Stop and say so in these words, with a suggested cap for each product and a link to the organisation's billing page:

> **Set a billing limit on every PostHog product you're paying for before this goes live.**

Do not mark the install done in SETUP.md until the human confirms the limits are set.
