export const DNA_CURRENT_STATE_REQUIRED_FAMILIES = Object.freeze([
  "vault",
  "cores",
  "active_races",
  "race_fills",
  "tokens",
  "splice_arena",
] as const);

export type DnaCurrentStateFamily =
  (typeof DNA_CURRENT_STATE_REQUIRED_FAMILIES)[number];

export type DnaCurrentStateFamilyStatus = Readonly<{
  status: "complete" | "partial" | "not_attempted";
  itemCount: number;
}>;

export type DnaCurrentStateCandidate = Readonly<{
  generationId: string;
  observedAt: string;
  families: Readonly<
    Record<DnaCurrentStateFamily, DnaCurrentStateFamilyStatus>
  >;
}>;

export type DnaSyncInterruptionReason =
  | "rate_limited"
  | "api_ineligible"
  | "api_unavailable"
  | "partial_refresh"
  | "invalid_payload";

export type DnaLastGoodSyncState = Readonly<{
  acceptedGenerationId: string | null;
  acceptedObservedAt: string | null;
  acceptedAt: string | null;
  servingGenerationId: string | null;
  syncStatus: "never_synced" | "current" | "paused" | "catching_up";
  catchUpRequired: boolean;
  lastAttemptAt: string | null;
  lastInterruption: Readonly<{
    reason: DnaSyncInterruptionReason;
    at: string;
    retryAfterSeconds: number | null;
  }> | null;
  lastCatchUpCompletedAt: string | null;
}>;

export type DnaCurrentStateCandidateReadiness = Readonly<{
  ready: boolean;
  incompleteFamilies: readonly DnaCurrentStateFamily[];
}>;

function publicationError(message: string): never {
  throw new Error(`DNA Open Lab last-good publication: ${message}`);
}

function requiredText(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 512) {
    publicationError(`${field} is invalid`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = requiredText(value, field);
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    publicationError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return parsed.toISOString();
}

function nonNegativeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    publicationError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function retryAfterSeconds(value: number | null | undefined): number | null {
  if (value === null || value === undefined) return null;
  return nonNegativeInteger(value, "retryAfterSeconds");
}

function familyStatus(
  family: DnaCurrentStateFamily,
  value: DnaCurrentStateFamilyStatus,
): DnaCurrentStateFamilyStatus {
  if (
    value.status !== "complete" &&
    value.status !== "partial" &&
    value.status !== "not_attempted"
  ) {
    publicationError(`${family}.status is invalid`);
  }
  return Object.freeze({
    status: value.status,
    itemCount: nonNegativeInteger(value.itemCount, `${family}.itemCount`),
  });
}

function normalizedCandidate(
  candidate: DnaCurrentStateCandidate,
): DnaCurrentStateCandidate {
  const families = Object.fromEntries(
    DNA_CURRENT_STATE_REQUIRED_FAMILIES.map((family) => [
      family,
      familyStatus(family, candidate.families[family]),
    ]),
  ) as Record<DnaCurrentStateFamily, DnaCurrentStateFamilyStatus>;

  return Object.freeze({
    generationId: requiredText(candidate.generationId, "generationId"),
    observedAt: timestamp(candidate.observedAt, "observedAt"),
    families: Object.freeze(families),
  });
}

export function createInitialDnaLastGoodSyncState(): DnaLastGoodSyncState {
  return Object.freeze({
    acceptedGenerationId: null,
    acceptedObservedAt: null,
    acceptedAt: null,
    servingGenerationId: null,
    syncStatus: "never_synced",
    catchUpRequired: false,
    lastAttemptAt: null,
    lastInterruption: null,
    lastCatchUpCompletedAt: null,
  });
}

export function inspectDnaCurrentStateCandidate(
  candidate: DnaCurrentStateCandidate,
): DnaCurrentStateCandidateReadiness {
  const normalized = normalizedCandidate(candidate);
  const incompleteFamilies = DNA_CURRENT_STATE_REQUIRED_FAMILIES.filter(
    (family) => normalized.families[family].status !== "complete",
  );
  return Object.freeze({
    ready: incompleteFamilies.length === 0,
    incompleteFamilies: Object.freeze(incompleteFamilies),
  });
}

/**
 * Atomically advances the publication pointer only for a complete candidate.
 * A caller must persist the returned state together with the accepted snapshot
 * pointer in its own transaction/boundary. Partial candidates never become the
 * generation served by the website.
 */
export function acceptDnaCurrentStateCandidate(input: {
  previous: DnaLastGoodSyncState;
  candidate: DnaCurrentStateCandidate;
  acceptedAt: string;
}): DnaLastGoodSyncState {
  const candidate = normalizedCandidate(input.candidate);
  const acceptedAt = timestamp(input.acceptedAt, "acceptedAt");
  const readiness = inspectDnaCurrentStateCandidate(candidate);
  if (!readiness.ready) {
    publicationError(
      `candidate is incomplete: ${readiness.incompleteFamilies.join(", ")}`,
    );
  }

  if (
    input.previous.acceptedObservedAt !== null &&
    new Date(candidate.observedAt).getTime() <
      new Date(input.previous.acceptedObservedAt).getTime()
  ) {
    publicationError("candidate observedAt cannot regress behind last-good");
  }

  const completedCatchUp = input.previous.catchUpRequired;
  return Object.freeze({
    acceptedGenerationId: candidate.generationId,
    acceptedObservedAt: candidate.observedAt,
    acceptedAt,
    servingGenerationId: candidate.generationId,
    syncStatus: "current",
    catchUpRequired: false,
    lastAttemptAt: acceptedAt,
    lastInterruption: null,
    lastCatchUpCompletedAt: completedCatchUp
      ? acceptedAt
      : input.previous.lastCatchUpCompletedAt,
  });
}

/**
 * Records a retryable/non-destructive sync interruption. The serving pointer is
 * deliberately preserved so API eligibility, outage or rate loss pauses only
 * synchronization and never invalidates the last accepted website dataset.
 */
export function pauseDnaCurrentStateSync(input: {
  previous: DnaLastGoodSyncState;
  reason: DnaSyncInterruptionReason;
  attemptedAt: string;
  retryAfterSeconds?: number | null;
}): DnaLastGoodSyncState {
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  return Object.freeze({
    ...input.previous,
    servingGenerationId: input.previous.acceptedGenerationId,
    syncStatus: "paused",
    catchUpRequired: true,
    lastAttemptAt: attemptedAt,
    lastInterruption: Object.freeze({
      reason: input.reason,
      at: attemptedAt,
      retryAfterSeconds: retryAfterSeconds(input.retryAfterSeconds),
    }),
  });
}

export function beginDnaCurrentStateCatchUp(input: {
  previous: DnaLastGoodSyncState;
  attemptedAt: string;
}): DnaLastGoodSyncState {
  if (!input.previous.catchUpRequired) {
    publicationError("catch-up cannot begin when no catch-up is required");
  }
  const attemptedAt = timestamp(input.attemptedAt, "attemptedAt");
  return Object.freeze({
    ...input.previous,
    servingGenerationId: input.previous.acceptedGenerationId,
    syncStatus: "catching_up",
    lastAttemptAt: attemptedAt,
  });
}
