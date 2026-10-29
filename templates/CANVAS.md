# Design canvas: {client}

Written by the explain phase and approved by a human before the page is built. It is the brief for the findings page, in this client's tokens. Follows the page anatomy reference.

## Box and doors

{One paragraph: the app as a box, the doors in and out, which are proven and which are unknown, as drawn in the explainer.}

## Tokens

| Token | Value | Source file |
|---|---|---|
| {surface, text, accent, severity colours, type scale} | {values} | {design file or stylesheet} |

## Parts

One row per part of the page, mapped onto this client's design.

| Part | What it shows | Subject types it links to | States covered |
|---|---|---|---|
| {title with receipt line} | {last sweep, coverage} | | {fresh, stale} |
| {uptime strip} | {sweeps over the last days as one-height status bars, new-finding counts above, open trend in words} | | {healthy, missed, errored} |
| {finding card} | {context line naming the subject, plain fact rows, visible next step, folded hypothetical would-do and would-say; dev mode adds refs, quotes, ids, trace} | {conversation, order, ...} | {unjudged, each verdict, stale verdict, back again} |
| {checks rail} | {per-check scoreboard, recent sweeps} | | {errored, unknown door} |

## Attention policy

{For each viewer: actionable obligations and scopes, technical faults routed to another owner, exact grouping criteria and per-member verdicts, order by business deadline and consequence. If age hiding is chosen: interval, exceptions, rationale, meaningful-change fingerprint, persisted change time, legacy unknown history and where hidden findings remain inspectable. Hiding never resolves a finding or removes it from precision or coverage.}

## Keyboard path

{Keys through a card: move, open evidence, give each verdict, add a reason, next card.}

## Empty, erroring and unknown states

{What the page shows with no findings, with a check that errored, and with a door whose status is unknown.}
