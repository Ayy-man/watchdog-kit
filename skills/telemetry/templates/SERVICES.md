# Services map: {client}

Tier: {telemetry only | Custodian}
Account owner (signs off plan, billing, replay): {name}
Run by: {name}
Client of: {us directly | partner name}
PostHog: {whose account}, project {name, id}, region {US | EU} (confirmed by the owner: {date})
Client slug: {kebab-case slug}
Scanned: {date}, revision {short sha}

Every service this build touches, found by reading the code. A build that later gets a Watchdog reuses this map, so nothing is asked twice. Add a row only for what the code shows; something the docs mention but the code does not is listed under "Planned".

## Repo rules

Package manager: {pnpm | npm | yarn | bun}. Local env file: {path, per the repo's docs}. Production deploys on: {push to main | manual | ...}. Migrations through: {tool}. Conflicts between the repo's docs: {none | what, and who decides}.

## Apps

| App | Path | Stack | How PostHog goes in |
|---|---|---|---|
| {office web app} | {apps/web} | {Next 16} | {posthog-js via instrumentation-client.ts, posthog-node server-side, /ingest proxy} |
| {field app} | {apps/engineer-app} | {Expo / Capacitor} | {posthog-react-native / posthog-js with an absolute host} |
| {edge functions} | {supabase/functions} | {Deno} | {fetch to the capture endpoint inside EdgeRuntime.waitUntil} |

## Services

| Service | Found in | What it does in this build | How its events reach PostHog | Connect? |
|---|---|---|---|---|
| {n8n, only if in the code} | {path or workflow export} | {which workflows} | {final node sends workflow_run_finished} | yes (default when found) |
| {GoHighLevel, only if in the code} | {path} | {workflows, or only message transport} | {webhook per workflow, or from the app's own handler} | yes (default when found) |
| {Stripe, Xero, Twilio, Radar...} | {path} | {what it does} | {PostHog data source, webhook, or the app's own code} | {connect / skip} |
| + Other | | {anything the human knows about that the code did not show} | | |

## Scheduled jobs

| Job | Scheduler | Path | Heartbeat |
|---|---|---|---|
| {name} | {Vercel cron, pg_cron, Trigger.dev...} | {path} | {how} |

## Already in the repo

Error tracking, OpenTelemetry, logging or analytics that is already set up, and what it records. Anything that records AI inputs and outputs or personal data is flagged here before log or trace forwarding is considered.

| What | Where | Records | Note |
|---|---|---|---|
| {Sentry, registerOTel, console logs of tool calls...} | {path} | {what} | {keep, or flag} |

## AI calls

| Where | Model or provider | `ai` SDK version | Traced through | Privacy mode |
|---|---|---|---|---|
| {path} | {model} | {version} | {withTracing, or a manual $ai_generation} | on |

## Personal and sensitive screens

Every place personal or secret data renders, in every app, to be blocked from session replay before it is turned on: secrets, credentials, card, bank and government numbers, and customers' and staff's names, addresses, phones and emails, message threads, photos, signatures, and live locations or maps. Public pages customers open from a link are listed too, because they stay out of replay entirely.

| App | Screen or component | What shows | Blocked with |
|---|---|---|---|
| {web} | {path} | {what} | {ph-no-capture on ..., or masked by default} |
| {field app} | {path} | {what} | {PostHogMaskView, maskAllImages} |

## Planned

Services the docs or the client mention that are not in the code yet. Not connected until they are.
