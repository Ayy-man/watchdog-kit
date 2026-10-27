# Services map: {client}

Tier: {telemetry only | Custodian}
Client slug: {kebab-case slug from the vault}
Scanned: {date}, revision {short sha}

Every service this build touches, found by reading the code. A build that later gets a Watchdog reuses this map, so nothing is asked twice.

| Service | Found in | What it does in this build | How its events reach PostHog | Connect? |
|---|---|---|---|---|
| {web app} | {path} | {what it does} | {posthog-js and posthog-node, through /ingest} | yes |
| {n8n} | {path or workflow export} | {which workflows} | {final node sends workflow_run_finished} | yes (default) |
| {GoHighLevel} | {path} | {which workflows} | {webhook per workflow} | yes (default) |
| {Stripe, Xero, Twilio...} | {path} | {what it does} | {PostHog data source, or webhook} | {connect / skip} |
| {scheduled jobs} | {path} | {each job} | {heartbeat event} | yes |
| + Other | | {anything the human knows about that the code did not show} | | |

## AI calls

| Where | Model or provider | Traced through | Privacy mode |
|---|---|---|---|
| {path} | {model} | {@posthog/ai withTracing, or a manual $ai_generation} | on |

## Sensitive screens

Every place a secret, credential, card or government number renders, to be blocked from session replay before it is turned on.

| Screen or component | What shows | Blocked with |
|---|---|---|
| {path} | {what} | {ph-no-capture on ...} |
