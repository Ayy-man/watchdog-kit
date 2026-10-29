# From a finding to a useful task

Read this when designing the queue, writing card copy or changing what existing findings show. A detector establishes a claim about recorded facts. A task asks a particular person to change an outcome. The second does not follow automatically from the first: the person needs authority, a useful next step and a reason to act now.

Trace a noisy card from its rendered text back through queue selection, canonical findings, detector predicates or model refusals, the packet and the authoritative business rule. Compare the generated implementation with the kit's current instructions and relevant history. A weakness in today's template is a prevention opportunity, not proof that template generated the original defect. Fix the earliest supported mistake and the existing-row projection that exposes it; rewording alone does not repair a false conclusion.

## Why correct quotes still produce bad cards

Grounding proves that a quoted value exists, not that the conclusion follows. A missing fulfilment flag does not prove nothing was delivered, an exhausted automated assignment does not override a valid manual assignment, and a threshold for one product does not apply to another. Start with the obligation: who owes what to whom, under which conditions, by when, and which evidence settles it. Identify counterevidence and manual completion before deciding the claim is a fault. If the records cannot settle it, state what is unrecorded and ask for a useful check; do not invent a failure.

One fault can also produce several valid observations: a failed send, the missing expected outcome, and a model's description of the same problem. Counting observations as tasks multiplies the operator's work without improving detection. Group only when the same person can fix the same obligation and occurrence with the same action. Different recipients, occurrences, tenants or independently fixable conditions remain separate.

An old observation, a repeated heartbeat and a changed business fact are different clocks. Neither first seen nor last seen establishes when the underlying problem last changed. Changing wording cannot establish that it changed either.

## Audit the definitions and the instances

Read each check, its business rule and the rendered page model, then replay a dated snapshot of retained findings through the actual queue policy. Use the permitted watchdog reader, within the approved read cap, without writing app state, adjudicating findings, sending messages or triggering a sweep just to tidy the page. A live dry run elsewhere in the build keeps its own authorisation and write boundaries.

For each check record its declared owner, obligation and scope, open count, oldest and newest open finding, retained reopen count and the exact title, description, visible next step and facts the person sees. No current finding means the type was reviewed from source and fixtures, not observed in production. A reopen counter without event timestamps cannot give a per-day reopen rate. Partial pagination or missing history remains partial or unknown.

Give each instance or supported class a disposition with evidence:

| Disposition | When it earns it |
|---|---|
| Keep | The intended viewer can do or decide something that protects the obligation. |
| Route to another owner | The fault is real but its repair belongs to support, engineering, finance or another declared role. Keep it visible to that owner. |
| Cut from the action list | A documented healthy state or specific contradicting evidence removes the proposed task. Retain the finding and reason for inspection; no automatic human verdict. |
| Merge attention | Exact shared identity, scope, obligation, occurrence and action show that several observations are one task. Retain every member and its own verdict and trace. |
| Reword | The task is useful but its claim overstates the evidence, uses internal language or leaves the next step hidden. |
| Hide unchanged | The client's recorded age policy permits it and a reliable change history proves the interval. Keep the hidden reason and canonical record available. |

Replay both current rows and the next generated findings. A prompt-only fix leaves old stored cards visible, and a display-only filter leaves faulty future conclusions in the detector. Apply each correction at the appropriate layer, and record which layers changed. A threshold or kind-wide refusal is not a substitute for proving the particular obligation is met or out of scope.

## What the viewer sees

Show the affected subject in familiar words, what is wrong, why it matters and a concrete next step without opening a disclosure. Keep the hypothetical automated plan and exact message folded and clearly inert. A visible instruction to check or correct something is not permission for the watchdog to execute it.

"Raise an alert", "review the issue" and "fix the pipeline" are not useful next steps for an operator. Name the decision and where it can be made. If the only useful action is technical maintenance, route the task to its declared owner. Show only facts that change that decision; keep internal keys, ids, hashes and raw evidence in Dev mode or the trace. Make grammatical copy templates rather than replacing isolated words and leaving broken sentences.

Missing proof requires careful wording: "not marked as dispatched; check before sending again", rather than "never dispatched". Record the strongest signal actually available, such as accepted, delivery unconfirmed or received, and never turn an unknown into a definitive failure.

Sort by the client's business deadline, consequence and waiting time. Use dates computed in the client's zone and a fixed clock in evals. A high technical severity does not make a card an operator task. State the as-of time and coverage so a quiet list does not imply a healthy system when required sources failed.

## Grouping and age are presentation policies

Keep canonical findings, ids, evidence and individual verdicts intact when grouping. A member arriving, changing, reopening or acquiring a different verdict must be independently reviewable. A judgement on the visible representative must not judge its siblings. False-alarm reasons must remain editable when the card leaves the queue. Do not rekey or resolve findings to make the count smaller; an actual identity change follows the shared contract's transition rule.

For age hiding, record the client's chosen interval, exceptions and rationale in the canvas. Do not impose the first installation's interval on another project. If enabled, persist the last meaningful change time beside a stable fingerprint of the decision-bearing facts, scope, condition and severity, outside the evidence and verdict fingerprint. Include materially changed claims; exclude heartbeat timestamps, age counters, model run metadata and cosmetic paraphrasing. Reset on changed facts or reopening, not on repeated sightings. Test that the sweep preserves this state; a page that computes an age without persistence cannot prove unchanged history. Legacy rows with no history start tracking when implemented, rather than being backdated from first seen. Hiding never resolves a fault, changes a verdict, removes it from precision or coverage accounting, or makes a stale source healthy. Keep hidden findings accessible with their reasons.

## Validation in the generated client

Use synthetic fixtures and a fixed clock. Include these opposing cases so a noisy example cannot become a blanket suppression rule:

| Tempting inference | Case that must stay visible or unknown |
|---|---|
| An automated path failed, so the work is undone | An authoritative manual completion settles it; an unverified note alone does not. |
| A threshold was crossed | The same count on a different product has a different policy; an explicit limit in free-text notes still matters. |
| The flag is missing, so repeat the action | Delivery or payment may already be proved elsewhere; missing proof asks for a check before repetition. |
| Same title or kind means duplicate | Different scope, recipient, obligation or occurrence remains separate; an exact shared event can group. |
| An old notification is obsolete | Only that specific notification contradicting current authoritative state is excluded; another open fault remains. |
| The card is old, so hide it | A heartbeat does not reset age; changed facts or reopening do; unknown legacy age does not hide it. |
| A group has a verdict | Each member retains its own judgement; changed membership and a false-alarm reason remain usable. |

Record before and after task counts on the same frozen input, with the exclusions and group membership accounting for every removed card. Separately report retained findings, operator tasks, developer tasks, hidden tasks and unknown coverage. Run the client's safe test gate; label skipped write suites, baseline failures, local builds, remote commits, deployments and authenticated page verification separately. A successful replay does not mean the live page changed. Deploying code and mutating stored production findings are separate actions with separate authorisation.
