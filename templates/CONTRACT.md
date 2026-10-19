# Doors contract: {client}

Written by the survey phase, reviewed by a human before anything is built. One row per door, except that jobs sharing one proof source and one proof shape may share a row that lists their names. A door with no proof is finding 0 and blocks any claim of coverage.

Status words are fixed: proven, failed, unknown, unsupported. "Unknown" is a real answer and stays visible. At survey time they describe the code, since nothing has been observed live yet: proven means a named row and value exists in code that would establish the door fired, failed means the code shows that proof cannot be written, unknown means no authoritative signal was found, and unsupported means the door is outside the supported stacks. Live observation of the proof comes later.

| Door | Direction | Scope types | Status | Proof it fired | Proof-of-proof | Delivery door | Failure erases evidence | Adapter |
|---|---|---|---|---|---|---|---|---|
| {door id} | in / out / internal | {scope types} | proven / failed / unknown / unsupported | {row + column + value} | {reconcile against what} | {signal or none, per channel} | yes / no | `lib/watchdog/doors/{id}.js` |

## Obligations

What each inbound event owes, independent of the sender's code. The deadline is computed in code; the model never does calendar maths.

| Event | Owes | Due | Grace | Exceptions | Policy source |
|---|---|---|---|---|---|
| `{event}` | `{outcome owed}` | {rule code can turn into a UTC instant} | {duration} | {column = value} | {who or what said so} |

## Unsupported and unknown

Doors or channels with no authoritative signal, and what it would take to instrument them. These are listed here and in REPORT.md; they never count as coverage.

| Door or channel | Status | Why no signal | To instrument it |
|---|---|---|---|
| {door or channel} | {unknown / unsupported} | {reason} | {what it would take} |

## Shared external ids

Where two tenants or two installations can hold the same provider id, and how the scope key separates them.

{Provider id, where a collision is possible, and the scope key that separates tenants; or "none found, with what was inspected".}
