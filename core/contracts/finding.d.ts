/**
 * Findings, checks and coverage. Lifted from the reference build
 * (lib/watchdog/run.js, coverage.js, review-common.js) with the three changes
 * the roasts required: a Scope on every id, coverage as a structured record
 * rather than a check-level flag, and resolution that needs fresh positive
 * coverage of the subject.
 */

import type { Scope, SubjectRef, EvidenceRef } from './door';

export type Severity = 'low' | 'medium' | 'high';

export interface Finding {
  /**
   * Built in code (core/scope.js buildFindingId), never from model text:
   * `${scopeKey}:${checkId}:${kind}:${sortedEntityRefs}:${hash}`. The first four
   * parts are a readable slug; `hash` (16 hex) is of the raw tuple (scope,
   * checkId, kind, subject, sorted entities), so two problems never share an
   * id even when their slugs collide. Since kit 0.2.0.
   */
  id: string;
  scope: Scope;
  checkId: string;
  /** From the client's fixed kind enum; a slug the model wrote is display-only. */
  kind: string;
  subject: SubjectRef;
  /** Other things the finding is about (a model finding passes what its evidence points at). Part of the id. */
  entities?: SubjectRef[];
  severity: Severity;
  title: string;
  detail: string | null;
  link?: string | null;
  /** What it would have done if allowed to act. Inert. */
  wouldDo?: string | null;
  /** What it would have said. Inert; never sent. */
  wouldSay?: string | null;
  evidence: EvidenceRef[];
  /**
   * When the event the finding rests on happened. Omit it and the sweep
   * stores its own `now` and marks the row `meta.evidence_defaulted`; such a
   * row can be resolved by a check that examined its subject, never by an
   * interval, because the stored time is not the event's.
   */
  evidenceAt?: Date | string | null;
}

/** What a check returns for one finding; the sweep builds `id`, `scope` and `checkId`. */
export type FindingInput = Omit<Finding, 'id' | 'scope' | 'checkId' | 'severity'> & { severity?: Severity };

/**
 * What a run actually covered. A check that cannot fill this in resolves nothing.
 * This replaces "the check ran cleanly" as the condition for resolution.
 */
export interface Coverage {
  scope: Scope;
  /** Subjects or intervals the run positively examined. */
  examined: Array<SubjectRef | { from: Date; to: Date }>;
  /** True only when every source page was read to the end. */
  complete: boolean;
  /**
   * How fresh the data was: the newest unnamed observation, or, when sources
   * are named (`coverage.freshAsOf(at, { source })`), the OLDEST of the
   * per-source newest observations, so one stale source cannot hide behind a
   * fresh one. Defaults to the sweep's `now`.
   */
  freshAsOf: Date;
  /** The obligation table / policy version this run judged against. */
  policyVersion: string;
  /** Sources read, with rows returned, whether any page truncated, and the error text when a read failed. */
  sources: Array<{ name: string; rows: number; truncated: boolean; failed?: string }>;
}

export interface CheckResult {
  findings: FindingInput[];
  /**
   * Optional: the recorder's record (ctx.coverage) is used when omitted. A
   * returned record can only narrow it: it cannot make complete what the
   * recorder or the counting client marked incomplete, partial, truncated or
   * failed, cannot move freshAsOf later, and must name the sweep's scope.
   */
  coverage?: Coverage;
  /** Set when the check could not examine part of its scope; names what was skipped and why. */
  partial?: { reason: string; skipped: Array<SubjectRef | string> };
}

export interface Check {
  /** Lower snake case (`/^[a-z][a-z0-9_]*$/`), unique in the sweep's check list, or the sweep refuses to start. */
  id: string;
  severity: Severity;
  title?: string;
  /** Incident ids from docs/incidents this check claims to catch. Attribution, not proof; the replay eval proves it. */
  incidents: string[];
  /** True for model-backed checks; they run in phase 2 inside the budget and only in review slots. */
  model?: boolean;
  /**
   * At most one table of the check's own that its client may write (a model
   * check's reviews store). Never a kit table, never another check's table,
   * never a table any check lists in `reads`.
   */
  writes?: [string] | [];
  /** Tables or views the check reads, for the receipt and the SELECT-only role; no check may write one. */
  reads?: string[];
  /** Upper bound on this check's run, in ms; it is also cut at the time left before the sweep's hard stop. */
  timeoutMs?: number;
  /** A bare findings array is accepted too (resolves only through ctx.coverage). */
  run(ctx: CheckContext): Promise<CheckResult | FindingInput[]>;
}

export interface CoverageRecorder {
  examined(...refs: Array<SubjectRef | SubjectRef[]>): CoverageRecorder;
  examinedRows(type: string, rows: Array<Record<string, unknown>>, idKey?: string): CoverageRecorder;
  examinedInterval(from: Date | string, to: Date | string): CoverageRecorder;
  freshAsOf(at: Date | string, opts?: { source?: string }): CoverageRecorder;
  policyVersion(v: string): CoverageRecorder;
  source(name: string, rows: number, opts?: { truncated?: boolean; scope?: string }): CoverageRecorder;
  covered(label: string, opts?: { n?: number; scope?: string }): CoverageRecorder;
  idle(reason: string): CoverageRecorder;
  skipped(reason: string): CoverageRecorder;
  partial(reason: string, skipped?: Array<SubjectRef | string>): CoverageRecorder;
  incomplete(reason: string): CoverageRecorder;
  resolveReason(fn: (row: Record<string, unknown>) => ResolveReason | null): CoverageRecorder;
  review(stats: Record<string, unknown>): CoverageRecorder;
}

export interface CheckContext {
  /** A SELECT-only client over approved views: `from()` only; anything else, and every write, throws. */
  read: ReadOnlyClient;
  now: Date;
  scope: Scope;
  /** Milliseconds left before the sweep's hard stop, when the check started. */
  budgetMs: number;
  /** Absolute clock readings (on `clock`): model work must not start after startBy and must end by finishBy. */
  budget: { startBy: number; finishBy: number; clock: () => number };
  trigger: 'cron' | 'manual';
  /** Findings that rule checks opened or reopened earlier in this sweep. */
  flagged: Finding[];
  /** What the check examined, in its own words; see CoverageRecorder. */
  coverage: CoverageRecorder;
  /** The SweepGeneration this sweep holds. */
  generation: number;
  /** The job_runs id of this sweep (or a random id when the heartbeat could not be written). */
  runId: string;
}

export interface ReadOnlyClient {
  from(view: string): unknown;
}

/** A sweep's identity, used to fence every write. */
export interface SweepGeneration {
  /** Monotonic per installation; issued on claim, checked on every reconcile write. */
  generation: number;
  claimedAt: Date;
  leaseUntil: Date;
  trigger: 'cron' | 'manual';
}

/**
 * Resolution rule, stated once (core/run.js resolutionDecision):
 * an open finding resolves only when a later run with `coverage.complete`,
 * for the same scope, positively examined its subject (or an interval holding
 * its explicit evidence time), with `freshAsOf` newer than the finding's last
 * evidence, and did not report it. A rejected model answer, a truncated page,
 * a failed read, a dropped malformed finding, a cached observation, a timed
 * out or skipped check, or a run on another generation cannot resolve.
 */
export type ResolveReason = 'recovered' | 'cancelled' | 'left_scope';
