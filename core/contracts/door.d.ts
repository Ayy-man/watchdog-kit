/**
 * A door adapter. One module per boundary event of the client app, written by
 * the survey phase and reviewed by a human. The core calls only this interface
 * and carries no knowledge of the client's tables.
 *
 * Why a module and not a column map: the two-tenant test (19 Oct 2026) showed a
 * column map cannot say which join proves a turn completed, which event types
 * owe a reply, that `indeterminate` means unknown rather than failed, that one
 * SMS provider has no delivery door while another does, that a refused attempt is deleted
 * (so absence is not "never tried"), or how a source paginates. All of that is
 * semantics, so it is code with a contract test, not configuration.
 */

export type DoorDirection = 'in' | 'out' | 'internal';

/** Never a boolean. `unknown` and `unsupported` are reported, not hidden. */
export type ProofStatus = 'proven' | 'failed' | 'unknown' | 'unsupported';

export interface Scope {
  /** The client installation (one deployment of one app). */
  installation: string;
  /** The tenant within a multi-tenant app; null for single-tenant apps. */
  tenant: string | null;
  /** The environment the evidence came from. */
  environment: 'production' | 'preview' | 'development';
}

export interface Window {
  /** Inclusive start, UTC instant. */
  from: Date;
  /** Exclusive end, UTC instant. */
  to: Date;
}

export interface DoorEvent {
  /** Stable id of the event within this door; combined with Scope by the core. */
  id: string;
  scope: Scope;
  /** When the event happened in the world, if the source records it. */
  eventAt: Date | null;
  /** When the client app observed it. Always present. */
  observedAt: Date;
  /** The subject(s) the event belongs to, in the client's own scope types. */
  subjects: SubjectRef[];
  /** Opaque, already filtered by the egress policy; never raw customer text. */
  facts: Record<string, string | number | boolean | null>;
}

export interface SubjectRef {
  /** A scope type the survey phase declared: 'ingress_event' | 'appointment' | 'tenant' | ... */
  type: string;
  id: string;
}

export interface Proof {
  status: ProofStatus;
  /** Which row or receipt established it, as refs the finding can quote. */
  evidence: EvidenceRef[];
  /** Human-readable reason, especially for failed / unknown / unsupported. */
  reason: string;
  /** When the proof was established, if known (event time of the receipt). */
  at: Date | null;
}

export interface EvidenceRef {
  source: string;
  id: string;
  field?: string;
  value?: string | number | boolean | null;
}

/** What an event owes. Written from the obligation table, not from the sender's predicates. */
export interface Obligation {
  /** A stable kind from the client's obligation table, e.g. 'reply', 'reminder_24h', 'invoice_writeback'. */
  kind: string;
  /** The deadline as a UTC instant, computed in code. The model never computes it. */
  dueAt: Date;
  /** Grace after dueAt before the obligation reads as overdue. */
  graceMs: number;
  /** The subject the outcome should land on. */
  subject: SubjectRef;
}

export interface Page<T> {
  items: T[];
  /** True when the source returned fewer rows than exist. The core then reports partial coverage and resolves nothing. */
  truncated: boolean;
  /** Opaque cursor for the next page; null when exhausted. */
  cursor: string | null;
}

export interface DoorAdapter {
  /** Stable id, snake_case, unique within the installation. */
  id: string;
  direction: DoorDirection;
  /** Which scope types this door's events attach to. */
  scopes: string[];

  /**
   * Events observed in the window, paginated the source's own way. The adapter
   * declares its cap and ordering so the core can tell truncation from
   * completeness; a page that drops the oldest stuck rows is a defect.
   */
  listEvents(scope: Scope, window: Window, cursor?: string | null): Promise<Page<DoorEvent>>;

  /** Did this event fire? Reads the proof signal only. */
  proofOf(event: DoorEvent): Promise<Proof>;

  /**
   * Tests the proof itself against the authoritative source (the provider's
   * event list, a read-back of the message, a write-back on the object).
   * Optional because some doors have no authoritative source. Then the proof
   * still stands for what it establishes (the app recorded an attempt), the
   * reconciliation is `unknown` or `unsupported`, and the door counts as
   * covered for nothing more than that. Finding 0 is reserved for a door with
   * no proof at all.
   */
  proofOfProof?(event: DoorEvent, proof: Proof): Promise<Proof>;

  /** What this event owes, if anything. A Status webhook owes nothing. */
  owes(event: DoorEvent): Obligation[];

  /**
   * Whether a delivery signal exists for this door, per channel when the door
   * spans several. 'none' means the strongest proof is provider acceptance and
   * the core must never raise "not delivered" on it.
   */
  deliveryDoor: 'none' | { signal: string; channels?: Record<string, 'none' | string> };

  /**
   * True when the client app deletes or rewrites the row on refusal or failure.
   * The core then treats an absent row as unknown, never as "never attempted".
   */
  failureErasesEvidence: boolean;

  /**
   * Reads the sent message or object back from the provider and compares the
   * recipient with the client's own identity row. The only proof for a wrong
   * recipient within a tenant. Read-only; must be allowlisted by the egress
   * policy because it touches the provider.
   */
  verifyRecipient?(event: DoorEvent): Promise<Proof>;

  /** Which tables/views this adapter reads, for the coverage receipt and the SELECT-only role. */
  reads: string[];
}
