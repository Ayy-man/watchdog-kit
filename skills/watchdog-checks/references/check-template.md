# Check template

A rule check is wholly on the read side of report-only, as the contract defines it. Consistent with `Check`, `CheckResult`, `Coverage` and `CheckContext` in `$KIT/core/contracts/finding.d.ts`. One file per check in `lib/watchdog/checks/<check_id>.js`; a check is live only once it is imported and listed in `lib/watchdog/checks/index.js`.

```js
/**
 * <check_id>: <one sentence: what is wrong when this fires>.
 *
 * Cluster: <taxonomy cluster>. Incidents: <ids>.
 * Signal: <row, column, value, or the absence past a deadline>.
 * Quiet when: <the healthy state, in words>.
 * Unknown when: <what makes this check unable to say, and why that is reported not hidden>.
 */

import { wallToDate, dateAdd } from '../core/wall-time.js';

// Thresholds, each with the incident that set it. A change here is a diff with a reason.
const OVERDUE_GRACE_MS = 6 * 60 * 60_000;   // INC-014: 6h grace on the 24h step
const WINDOW_DAYS = 14;                       // bounded read; older subjects are out of scope
const PAGE_LIMIT = 500;                       // newest first, so a backlog drops the oldest, not today's
const POLICY_VERSION = 'obligations@2026-10-19';
const ZONE = 'Europe/London';                 // the client's IANA zone from MAPPING.md

export default {
  id: '<check_id>',
  severity: 'high',
  incidents: ['INC-014'],
  model: false,

  /**
   * @param {{ read, now, scope, budgetMs, trigger, flagged, coverage }} ctx
   *   read     SELECT-only client over approved views; any write throws
   *   now      the sweep's clock; never call Date.now()
   *   scope    the Scope every finding carries
   *   coverage recorder: examined(subject), examinedInterval(from, to), freshAsOf(date), policyVersion(v), partial(reason, skipped)
   */
  async run({ read, now, scope, coverage }) {
    coverage.policyVersion(POLICY_VERSION);
    const findings = [];

    // 1. Read the subjects in a bounded window, the source's own order and cap.
    const { data: subjects, error } = await read.from('v_appointments')
      .select('id, starts_at, booked_at, status, tenant_id')
      .gte('starts_at', now.toISOString())
      .order('starts_at', { ascending: true })
      .limit(PAGE_LIMIT);
    if (error) throw error;                     // a thrown check becomes one check_error finding; it never resolves anything

    // 2. For each subject, compute the obligation in code and look for the outcome.
    for (const s of subjects) {
      if (s.status === 'cancelled') { coverage.examined({ type: 'appointment', id: s.id }); continue; }   // exception from the table
      const dueAt = new Date(Date.parse(s.starts_at) - 24 * 60 * 60_000);
      const overdueAt = new Date(dueAt.getTime() + OVERDUE_GRACE_MS);
      coverage.examined({ type: 'appointment', id: s.id });                                               // positively looked at, whatever the result
      if (now < overdueAt) continue;

      const { data: rows } = await read.from('v_booking_reminders').select('id, sent_at').eq('appointment_id', s.id).eq('step', '24h');
      if (rows?.length) continue;                                                                           // the outcome exists; quiet

      // 3. The finding: subject from the rows, id left to the core, evidence as refs, inert plan.
      findings.push({
        scope,
        checkId: '<check_id>',
        kind: 'no_outcome_past_due',
        subject: { type: 'appointment', id: s.id },
        severity: 'high',
        title: `24h reminder for appointment ${s.id} is overdue with no row`,
        detail: `Due ${dueAt.toISOString()} with ${OVERDUE_GRACE_MS / 3_600_000}h grace; no 24h reminder row exists.`,
        link: `/appointments/${s.id}`,
        wouldDo: 'Check the provider log for a 24h reminder and send one only if none was accepted',
        wouldSay: null,
        evidence: [
          { source: 'v_appointments', id: s.id, field: 'starts_at', value: s.starts_at },
          { source: 'v_booking_reminders', id: `appointment:${s.id}:24h`, field: 'count', value: 0 },
        ],
      });
    }

    // 4. Honest coverage. A page at the limit may be a cut: say so and resolve nothing.
    if (subjects.length >= PAGE_LIMIT) coverage.partial('page at limit', ['appointments beyond the first page']);
    coverage.freshAsOf(now);
    return { findings };   // coverage comes from the recorder; a check may also return its own Coverage object
  },
};
```

## Rules the template encodes

- **Read-only.** `read` throws on insert, update, upsert, delete and rpc (a stored-procedure call, refused because it can write). A check that needs to write is not a rule check.
- **Deterministic.** Same data and `now` give the same findings. No `Date.now()`, no randomness, no model call.
- **Bounded.** A few queries with a limit and an order chosen so a backlog over the cap drops the oldest rows, never today's.
- **Timing in code.** Every due instant is computed here, in the client's zone through `$KIT/core/wall-time.js`, from the obligation table.
- **Evidence as refs.** Source, id, field, value: what a human checks in the trace. Never a raw customer text; a short quote only where the egress policy allows it, with the reason.
- **Coverage is explicit.** `examined` for every subject positively looked at, `partial` whenever a page may have been cut, `freshAsOf` for the newest observation. A check that reads a table has not examined every subject in it.
- **Unknown is reported.** On a door whose adapter says `unknown` or `unsupported`, the check says so in coverage or in a low finding, rather than staying silent.
- **Quiet on healthy data.** A check that fires on today's normal state is a false alarm, not a feature; the offline eval has a healthy fixture for that reason.

## The offline eval, `scripts/eval-watchdog-<check_id>.mjs`

Builds a fake read client from `$KIT/evals/lib/fake-postgrest.mjs`, then asserts: each incident in `incidents` replays to a finding on the expected subject and kind; a healthy fixture gives no findings; a fixture at the page limit gives `partial` and the finding list unchanged; any write through the client throws; `coverage.examined` lists every subject the fixture holds. No network. Exit 1 on the first failed assertion with the fixture named.
