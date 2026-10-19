# Writing a door adapter

A door adapter is one module per boundary event, satisfying `$KIT/core/contracts/door.d.ts`. It is code rather than configuration because the questions the core has to ask (which join proves this, does absence mean never tried, how does this source paginate) have answers that are semantics, and semantics belong in a function with a contract test. The core calls only this interface and knows nothing about the client's tables.

## The module shape

```js
// lib/watchdog/doors/sms_outbound.js
export default {
  id: 'sms_outbound',
  direction: 'out',
  scopes: ['conversation', 'tenant'],
  reads: ['outbound_send_attempts', 'messages'],
  deliveryDoor: { signal: 'messages.delivered_at', channels: { sms: 'none', whatsapp: 'messages.delivered_at' } },
  failureErasesEvidence: true,

  async listEvents(scope, window, cursor = null) {
    // Paginate the source's own way: its index order, its cap. Return
    // { items, truncated, cursor }. truncated is true whenever the source
    // may hold more rows than were returned; the core then resolves nothing.
  },
  async proofOf(event) {
    // Read the proof signal only. Return { status, evidence, reason, at }.
    // status is proven | failed | unknown | unsupported, never a boolean.
  },
  async proofOfProof(event, proof) {
    // Optional. Reconcile the proof against the provider: identities, not counts.
  },
  owes(event) {
    // From the obligation table. Due instants computed here, in code.
    return [];
  },
  async verifyRecipient(event) {
    // Optional. Read the sent message back from the provider and compare
    // the recipient with the client's own identity row. Must be allowlisted
    // in EGRESS.md because it touches the provider.
  },
};
```

Every function is read-only. `reads` must list every table or view the module touches, because the SELECT-only role is granted from that list and the sweep receipt reports it.

## What each field has to get right

**`listEvents` paginates the source's own way.** A multi-tenant installation indexes its recovery queue by `(next_attempt_at, received_at, id)`; a page cut by `received_at desc` silently dropped the oldest stuck rows, which were the ones that mattered. Order by the index the source uses and declare the cap; when the page comes back as long as the cap, set `truncated: true` and hand back a cursor. A page that cannot prove it reached the end is not complete.

**`proofOf` reads the proof signal and nothing else.** A row's existence is rarely the proof. In a multi-tenant installation, `webhook_events.status = processed` is set for held, opted-out, paused, superseded and refused messages alike, so "processed" proves receipt and says nothing about whether a reply went. The proof that a reply went is an `outbound_send_attempts` row whose `origin_webhook_event_id` points back at the receipt. Name the column and value in `reason` so a human can check it.

**`unknown` is not `failed`.** An `indeterminate` attempt means a retry is forbidden and someone must settle it by hand with evidence; it is `unknown`. A row the app deleted on refusal is `unknown`, because the adapter cannot tell "refused" from "never tried". Reporting `failed` here would raise a finding against a send that may well have gone, and the human would learn to ignore the check.

**`failureErasesEvidence` is honest.** When the app deletes or rewrites the row on failure, say so. The core then treats an absent row as unknown and the check for "owed and not sent" has to look for the obligation plus the absence of any attempt, with a reason that says the absence is ambiguous.

**`deliveryDoor` is per channel.** One provider fills `messages.delivered_at` from status webhooks; another's status webhooks carry no message id and are dropped, so that channel has `'none'` and its strongest proof is provider acceptance with a provider message id. A check that says "sent, not delivered" on a channel marked `none` is a false alarm by construction.

**`owes` reads the obligation table, not the sender.** If the sender's own predicate decides whether a reply is owed, the adapter inherits every bug in the sender. Write what the event owes from the business rule (a `message.received` owes a reply within N minutes unless the conversation is paused or opted out) and compute `dueAt` as a UTC instant in code. The model never does calendar maths.

**Missed work may leave no row at all.** A reminder table that only gets a row when a run lands inside the step's grace window cannot show a missed reminder. The obligation is computed from the subject (the appointment and the step table) and the finding is "no row past due", which is why `owes` has to be able to run from the subject without any outbound row existing.

**`proofOfProof` reconciles identities.** Counting rows on both sides proves nothing when one side has a duplicate and the other a gap. Compare ids: the provider's event id against the receipt's `provider_event_id`, the provider message id against the attempt's. Where idempotency keys fold the tenant into the id string, the adapter parses that prefix; the core never does.

**`verifyRecipient` is the only proof for a wrong recipient within a tenant.** When the sending location is read with `limit(1)` and never checked against the identity's own install id, no row can show the message went to the wrong place. Only a provider read-back can, so it is a separate, egress-allowlisted method that the human may leave switched off.

**Scope on every event.** Unmatched receipts with `tenant_id = null`, or messages for an unknown location that returned 404 and wrote no row, cannot be attributed to a tenant. They are not `failed` for anyone; they are evidence that ingress may have died at the gate, visible only as absence against a per-tenant baseline. Record that in the contract's unsupported section rather than forcing a tenant onto them.

## The contract test

Each adapter gets a test with a fake source that proves: a page at the cap reports `truncated`; a deleted-on-failure row yields `unknown`, not `failed`; an obligation's `dueAt` matches a hand-computed instant across a clock change; and the status is one of the four words on every path. The adapter is not finished until this test exists, because the core trusts the adapter's `truncated` and `status` without a second look.
