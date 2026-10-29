# Installing PostHog on a build

Everything here was learned putting PostHog on the first build (a Next.js operations app) and then walking these steps against a second, very different one (a Next.js office app, an Expo field app and Supabase edge functions, for a UK client). Follow it in order. Write what you do, and anything that surprised you, into `.telemetry/SETUP.md` as you go, because the surprises are what improve this file.

## Before anything: the repo's own rules

The client repo's `AGENTS.md`, `CLAUDE.md`, `README` and deployment docs win over this file. Find these four things in them before you run a single command, and write them at the top of SETUP.md:

- **The package manager.** Run the wizard and every install through it (`pnpm dlx`, `yarn dlx`, `bunx`), in the app's own directory in a monorepo, never `npx` at the root of a repo that forbids it.
- **Which env file is which.** Some repos keep production values in `.env.local`. Put the token where the repo's docs say local development values go, and never write to a file the docs call production.
- **What deploys production.** Often a push to `main`. Work on a branch and open a pull request; never push to the deploy branch. "Deploy" in this file always means: the account owner merges, the deploy goes live, and you confirm it.
- **How migrations run.** Use the repo's own migration tool. If its docs disagree with each other, ask which wins rather than picking one.

## The account

Never assume whose PostHog this goes in. Ask on every build, before installing anything, and record the answers in SETUP.md:

1. **Whose account?** The builder's own organisation (an agency that keeps all its clients' telemetry in one place), the client's own, or the partner's. Each is fine. What changes is who pays, who can see the data, and who must set the billing limits.
2. **New project or an existing one?** If the client already has PostHog, use their project and add to it; do not create a second one or change their settings without asking.
3. **Which region?** PostHog's US and EU clouds are separate instances, so an EU project lives in a separate organisation, and a project can never move regions later. For a UK or EU client, the account owner decides, knowing the client's privacy policy will have to name PostHog and where the data goes. The EU path is: an organisation on `eu.posthog.com`, ingest host `eu.i.posthog.com`, assets host `eu-assets.i.posthog.com`, and `--region eu` on the wizard.
4. **Which timezone?** PostHog has no organisation default and every new project starts on UTC, so set it. Use the account's own convention if it has one, otherwise the client's business timezone (look for it in the code, for example a `Europe/London` constant).

Only an organisation admin can create a project and invite people to it, so a developer who is not in the organisation asks the account owner for both and waits. One project per build is the default; an agency account with many small clients can share a project and tell them apart by `client_slug`.

Create the project (or open the existing one), then:

- Set its timezone to the answer above.
- Set test-account filters: person `is_internal` is not `true`, and event `environment` is not any of `development`, `preview`, `smoke-test`, `test`. Leave "filter by default" off while internal people are the only users, or every insight goes blank.
- Store the project token where the repo keeps local values, and in the host's environment settings. If the host account is the client's, setting variables there is for whoever holds it: write the names and where they go in SETUP.md and ask. Never paste a key into chat, never read `.env` values back, never ask for anyone's login.

## An existing install

If the repo already has PostHog (look for `posthog-js`, `posthog-node`, `@posthog/ai`, `instrumentation-client.ts`, a `posthog-server` module), do not run the wizard: it would rewrite a working, hand-fixed install. Read the project's live settings first (replay on or off, its sampling and masking, the test-account filters, the 30-day event volumes), then audit the code against every section below and fix only the gaps, logging each one in SETUP.md as kept or fixed. On one client the audit found five gaps in an install that already worked: previews tagged as production, link tokens in URLs, captures awaited inside requests, three untraced model calls and no cron heartbeats.

## The wizard

Run the PostHog wizard (`@posthog/wizard@latest`) through the repo's package manager, in the web app's directory. It needs an interactive terminal, so inside an agent it fails with `PHW_CLI_INTERACTIVE_REQUIRED`: hand the human the one command to run in a normal terminal, or use `--ci --region <us|eu> --api-key "$POSTHOG_PERSONAL_API_KEY"` with a personal key the account owner issued you, set in your own shell, never pasted into chat or committed. Read its "Event plan" tab before it instruments.

Expect it to stop partway. On the first build it got to step 4 of 10 and handed off with a task file under `.posthog/wizard-spellbook-*/README.md`. Read that file and finish the job yourself; do not assume the wizard completes. Gitignore `.posthog/` and `.posthog-wizard-cache/`.

After it, always run the type check and the client's own build through its own scripts, and check every new dependency's peer ranges and release date. On the first build the wizard installed OpenTelemetry log packages a week old that needed a newer `@opentelemetry/api` than the AI SDK allowed; the fix was pinning the log packages to the previous line, not bumping the API. It also wrote `new BatchLogRecordProcessor(exporter)` where the current API takes `{ exporter }`.

**Do not let the wizard forward logs or traces until you have read what they carry.** It can wire the app's OpenTelemetry logs and spans into PostHog. If the app already records AI inputs and outputs in its telemetry (look for `recordInputs: true`, `recordOutputs: true`, or logging of tool inputs and results), those prompts, replies and the customer data in them go straight to PostHog and break the privacy rule below. Either turn those off first or leave log and trace forwarding out, and say which in SETUP.md. If the app already has an error tracker (Sentry and the like), ask before adding PostHog error tracking next to it.

## The layer on top

The wizard does the SDK, environment, error capture, logs and a first set of events. These are the additions it does not make:

- **Tags on every event.** A properties module exporting `client_slug` (the client's kebab-case slug), `app` and `environment`. Register them in the browser with `posthog.register`; on the server, wrap capture, because posthog-node has no `register`. Then find every path that skips the wrapper and tag it explicitly. Take `environment` from the host's own variable, never `NODE_ENV` alone: Vercel builds previews with `NODE_ENV=production`, so preview traffic passes the test-account filter as real use. Read `NEXT_PUBLIC_VERCEL_ENV` (inlined into the browser), then `VERCEL_ENV`, then `NODE_ENV`. On the first build the AI tracing (`withTracing` from `@posthog/ai`) sent `$ai_generation` events with no tags until `posthogProperties` was given the same object.
- **Identify where the session is, not where the login form is.** Identify the real user (not an impersonated one) from a client-side provider whenever a signed-in session exists, because many apps redirect after login before any code of yours runs, and devices often restore a saved session without logging in at all. Call `reset()` in client code just before sign-out; if sign-out is a server action or a plain form post, hook the button's click, because `reset()` cannot run on the server.
- **Internal users.** Set a person property `is_internal`: true for our staff and developers, and on a partner's client also for the partner's own accounts, because the partner testing the client's system is not the client using it. Test accounts are internal too. The client's staff and their customers are real users. Apps rarely have a role for this, and some default every unknown user to a real role, so use an allowlist of emails or domains in config, and say so in SETUP.md.
- **AI privacy.** Set `privacyMode: true` on the server client and `posthogPrivacyMode: true` on every traced model call. Prompts and replies carry client data; PostHog gets model, tokens, cost and latency only. Grep every `generateText`, `streamText`, `generateObject` and `streamObject`, not only the chat agent: on one client three of four call sites were untraced. Check the `@posthog/ai` release supports the app's `ai` SDK major before wrapping with `withTracing`. If it does not, do not force it: capture `$ai_generation` yourself from the call's `onFinish` with model, provider, token counts, latency and cost, and never the prompt or the reply.
- **Tokens in URLs.** posthog-js records the URL on every event (`$current_url`, `$pathname`, `$referrer`, the `$initial_*` person properties) and the `href` of every autocaptured link. If the app has magic links, share links or no-login client links, a pageview copies a working credential into analytics. Add a `before_send` that rewrites token path segments, `?code=`, `?token_hash=` and `#access_token=` before anything is sent, keep it a pure function with tests, and check operator pages that display client links too, since their hrefs are autocaptured. Redact every string in `properties`, `$set` and `$set_once` at any depth, not a list of URL keys: on one build the key list passed every `$pageview`, but `$web_vitals` carries the raw URL inside nested `$web_vitals_*_event` objects and leaked the token. Prove it on the deployed site by loading a fake token URL in a real browser (headless Chrome left open about 25 seconds so posthog-js flushes), then search `toString(properties)` for the fake string, not just `$current_url`.
- **Never slow a request.** Send captures and flush from Next's `after()`, or the platform's equivalent (`EdgeRuntime.waitUntil` in Supabase edge functions), so a request never waits on PostHog. Route tests then need `after` stubbed, because it throws outside a request scope. Audit every capture site, not only the one you fixed first: on one client five routes and server actions still awaited `shutdown()` after the agent route had moved to `after()`. A helper that calls `after()` inside a try (dropping the event outside a request scope) fixes them all at once, and ids that are not people (an inquiry, an intake, a guest) get `$process_person_profile: false`.
- **Reverse proxy.** On a web app, serve PostHog through the app's own origin (`/ingest` rewrites to the ingest host and `/ingest/static` to the assets host, `skipTrailingSlashRedirect: true`, `api_host: "/ingest"`, `ui_host` set to the PostHog app), because ad blockers drop requests to PostHog's own domain. Then read the middleware's `matcher` (`middleware.ts`, or `proxy.ts` from Next 16): even if it does not redirect `/ingest`, running auth on every capture batch costs a database round trip each time, so exclude `ingest` from it.

## By stack

The steps above are written for a Next.js server app. Most client builds are more than that. Work out every app in the repo from the scan (office app, field app, edge functions) and apply the section for each.

**Next.js 16.** `middleware.ts` became `proxy.ts`; check whichever exists. Initialise posthog-js in `instrumentation-client.ts`. `after()` comes from `next/server`.

**Vite or another single-page app.** There is no server, so no `after()`, no server-side capture and no `next.config` rewrite. Put the proxy in the host's config instead (on Vercel, two `rewrites` in `vercel.json`) and list them before the app's catch-all rewrite to `index.html`, or the catch-all swallows them. The token goes in a public build variable (`VITE_`), which is fine for a project token and for nothing else. Server-side events come from the backend or edge functions.

**Capacitor or Ionic.** The app runs in a web view whose origin is the device (`capacitor://localhost` on iOS; on Android `https://localhost` from Capacitor 6, `http://localhost` before it, so check `server.androidScheme`), so a relative `/ingest` hits the bundled app and goes nowhere. Give `api_host` the full URL: the web app's deployed `/ingest`, or the ingest host directly, since a native web view has no ad blocker. Events captured offline are held in memory and lost if the app is closed, so a field app that works offline gets its important events from the server when its queue syncs.

**Expo or React Native.** Use `posthog-react-native` with `PostHogProvider`. On Expo it also needs `expo-device` and `expo-localization`, which are native modules, so if the app lacks them even plain analytics ships only in a new build. Screen tracking comes from the navigation library with React Navigation, but Expo Router needs a manual `posthog.screen(pathname)` on each route change. No proxy is needed. Session replay needs the native plugin, so it works only in a development or store build, never in Expo Go. `ph-no-capture` and `maskAllInputs` do nothing on native: set `maskAllTextInputs` and `maskAllImages` on, and wrap sensitive views in `PostHogMaskView`. "Deploying the masking" here means a new build installed on every device, not a web deploy, so replay on a field app waits until the account owner confirms every device has it.

**Supabase or other Deno edge functions.** Send each event with one `fetch` to the ingest host's capture endpoint with the project token, inside `EdgeRuntime.waitUntil` so the response never waits on it. Use the same tags, the user's id as `distinct_id` when the function knows it, and the function's name for scheduled work with `$process_person_profile: false`, so a job does not become a person.

## Session replay

Cost is rarely the question on a small build: the free tier is 5,000 recordings a month and the billing limit stops recording at the cap. What is on screen is the question. Replay stays off until all four steps are done, and an install you inherit is checked against them too: on one client replay had been switched on at 100% with only inputs masked, which fails step 2 on an app whose screens are client records. Turning it off is a project setting; making it safe if someone turns it back on is code (`maskTextSelector: "*"` and `disable_session_recording` outside the signed-in app).

1. **Find everything personal on screen**, in every app: secrets and credentials, card and bank numbers, government numbers, and also customers' and staff's names, addresses, phone numbers and emails, message threads (WhatsApp, SMS, email), photos and signatures, and live locations and maps. List each in SERVICES.md with how it is blocked. On the web, block it with the `ph-no-capture` class (dialogs portal outside their parent, so tag their contents directly); on native, `PostHogMaskView`.
2. **Mask by default where the screens are mostly personal.** Keep input masking on everywhere. On an app whose main screens are customer records or messages, mask all text (`maskTextSelector: "*"` on the web) and unmask only what is safe, instead of the other way round. Leave public pages that customers open from a link (confirmations, bookings, payments) out of replay entirely.
3. **Deploy the masking** (on mobile, a new build on every device), confirm it is live, then enable replay. Skip sessions under two seconds.
4. **The account owner records the lawful basis in SETUP.md.** This is the client's decision, not a developer's, and not legal advice. In the UK and EU, recording the client's own staff at work is employee monitoring: the client normally needs a data protection impact assessment and must tell staff before it starts, and their consent is rarely the right basis. Recording customers or using analytics cookies on public pages needs consent or a recognised exemption, and the privacy policy has to cover it. For a partner's client, the partner signs off too.

## Outside the web app

Add each of these only when the scan found it. A service mentioned in docs but not in the code is "planned", not connected.

- **n8n.** The last node of every workflow sends `workflow_run_finished` (with `workflow`, `result`, `duration_s`, `items`, and `minutes_saved` where a baseline exists) to the capture endpoint, through the proxy or directly. A first node sending `workflow_run_started` makes durations exact.
- **GoHighLevel.** If GoHighLevel workflows do the work, each relevant workflow posts a webhook into PostHog with the same event shape. If it is only the message transport (the app's own code receives its webhooks and sends through its API), emit the events from that code instead.
- **Stripe, Supabase, HubSpot and other sources** PostHog can import: connect as data sources when the plan needs them. Anything else sends through a webhook.
- **Scheduled jobs** (cron, Trigger.dev, Inngest, `pg_cron` and the like) send a `heartbeat` with `job` and `last_run_at`, so the page and the Watchdog can tell silence from success. For `pg_cron`, one scheduled sweep that reads `cron.job_run_details` and sends a heartbeat per job beats a migration per job. For Vercel crons, wrap each route handler: `success` on a 2xx, `failure` on any other status, `error` when it throws, the JSON body's top-level numbers as counts, and nothing on a 401, because a stray caller is not a run. Count the volume before the billing gate: a cron that runs every minute sends about 43,000 heartbeats a month on its own.

Name events and properties in snake_case, mirroring OpenTelemetry's CI/CD conventions for runs (`result` is one of `success`, `failure`, `error`, `timeout`, `cancellation`, `skip`; a run id is a property, never a metric label). Event properties carry ids and counts, never names, addresses, phone numbers or message text.

## Verify, never assume

A change that looks right is not a working install. After the deploy:

- On a web app, fetch `/ingest/static/array.js` and send one proxied capture; both should succeed.
- Check the live bundle initialises with the right host and registers the tags.
- Load the production site in a real browser (headless Chrome is dropped by posthog-js unless the user agent is overridden) and query PostHog for the `$pageview`, its tags and its environment. On mobile, open the installed build and look for its screen events.
- Ask the human to use the app for real, then query what arrived, event by event, and look for anything missing its tags or carrying personal data in a property.

## The billing gate

Setup is not finished until a billing limit is set on every paid product this build turned on: product analytics, session replay, error tracking, logs, AI observability and feature flags. In an agency account one noisy client can bill for all of them; in the client's own account, the bill is theirs and so is the decision. Stop and say so in these words, with a suggested cap for each product and a link to the organisation's billing page:

> **Set a billing limit on every PostHog product you're paying for before this goes live.**

Do not mark the install done in SETUP.md until the account owner confirms the limits are set. The PostHog MCP cannot read billing limits, so this gate rests on the owner's word; record who confirmed and when.
