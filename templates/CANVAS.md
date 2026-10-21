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
| {uptime strip} | {sweeps over the last days} | | {healthy, missed, errored} |
| {finding card} | {context line naming the subject, plain fact rows, folded would-do and would-say; dev mode adds refs, quotes, ids, trace} | {conversation, order, ...} | {unjudged, each verdict, stale verdict, back again} |
| {checks rail} | {per-check scoreboard, recent sweeps} | | {errored, unknown door} |

## Keyboard path

{Keys through a card: move, open evidence, give each verdict, add a reason, next card.}

## Empty, erroring and unknown states

{What the page shows with no findings, with a check that errored, and with a door whose status is unknown.}
