import { createHash } from "node:crypto";

import {
  validateDnaFinishedRaceBackfillCheckpoint,
  type DnaFinishedRaceBackfillCheckpoint,
} from "./dna-open-lab-finished-race-backfill";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

export const DNA_FINISHED_RACE_INCREMENTAL_CYCLE_VERSION = 1 as const;
export const DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY =
  "races_finished" as const;
export const DNA_FINISHED_RACE_INCREMENTAL_MAX_ATTEMPTS = 32 as const;
export const DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT =
  "2026-09-02T00:11:55.961Z" as const;

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;

export const DNA_FINISHED_RACE_INCREMENTAL_PAUSE_REASONS = Object.freeze([
  "api_unavailable",
  "rate_limited",
  "tier_ineligible",
  "budget_closed",
  "invalid_response",
  "operator_hold",
] as const);

export type DnaFinishedRaceIncrementalPauseReason =
  (typeof DNA_FINISHED_RACE_INCREMENTAL_PAUSE_REASONS)[number];

export type DnaFinishedRaceIncrementalCycleStatus =
  "running" | "paused" | "complete" | "superseded";

export type DnaFinishedRaceIncrementalCycle = Readonly<{
  version: typeof DNA_FINISHED_RACE_INCREMENTAL_CYCLE_VERSION;
  cycleId: string;
  attemptId: string;
  previousCompletedCycleId: string | null;
  sourceFamily: typeof DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY;
  lowerBoundAt: string;
  upperBoundAt: string;
  attemptNumber: number;
  status: DnaFinishedRaceIncrementalCycleStatus;
  checkpoint: DnaFinishedRaceBackfillCheckpoint;
  pause: Readonly<{
    reason: DnaFinishedRaceIncrementalPauseReason;
    pausedAt: string;
    retryAt: string | null;
  }> | null;
  completion: Readonly<{
    completedAt: string;
    checkpointSha256: string;
    completionSha256: string;
  }> | null;
  supersededByAttemptNumber: number | null;
}>;

export type StoredDnaFinishedRaceIncrementalCycle = Readonly<{
  revision: string;
  cycle: DnaFinishedRaceIncrementalCycle;
}>;

export type DnaFinishedRaceIncrementalCycleRepository = Readonly<{
  load: (input: {
    cycleId: string;
    attemptNumber: number;
  }) => Promise<StoredDnaFinishedRaceIncrementalCycle | null>;
  loadLatestComplete: () => Promise<StoredDnaFinishedRaceIncrementalCycle | null>;
  save: (input: {
    expectedRevision: string | null;
    cycle: DnaFinishedRaceIncrementalCycle;
  }) => Promise<StoredDnaFinishedRaceIncrementalCycle>;
}>;

export class DnaFinishedRaceIncrementalCycleError extends Error {
  readonly kind: "invalid_cycle" | "invalid_transition" | "authority_drift";

  constructor(input: {
    kind: DnaFinishedRaceIncrementalCycleError["kind"];
    message: string;
  }) {
    super(input.message);
    this.name = "DnaFinishedRaceIncrementalCycleError";
    this.kind = input.kind;
  }
}

function cycleError(
  kind: DnaFinishedRaceIncrementalCycleError["kind"],
  message: string,
): never {
  throw new DnaFinishedRaceIncrementalCycleError({ kind, message });
}

function timestamp(value: string, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    cycleError("invalid_cycle", `${field} is required`);
  }
  const parsed = Date.parse(value);
  if (!Number.isFinite(parsed)) {
    cycleError("invalid_cycle", `${field} must be a valid timestamp`);
  }
  return new Date(parsed).toISOString();
}

function sha256(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    cycleError("invalid_cycle", `${field} must be a SHA-256 value`);
  }
  return normalized;
}

function attemptNumber(value: number, field = "attemptNumber"): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value > DNA_FINISHED_RACE_INCREMENTAL_MAX_ATTEMPTS
  ) {
    cycleError(
      "invalid_cycle",
      `${field} must be between 1 and ${DNA_FINISHED_RACE_INCREMENTAL_MAX_ATTEMPTS}`,
    );
  }
  return value;
}

function hash(parts: readonly string[]): string {
  return createHash("sha256").update(parts.join("|"), "utf8").digest("hex");
}

export function dnaFinishedRaceIncrementalCycleId(input: {
  lowerBoundAt: string;
  upperBoundAt: string;
  previousCompletedCycleId: string | null;
}): string {
  const lowerBoundAt = timestamp(input.lowerBoundAt, "lowerBoundAt");
  const upperBoundAt = timestamp(input.upperBoundAt, "upperBoundAt");
  if (Date.parse(lowerBoundAt) >= Date.parse(upperBoundAt)) {
    cycleError("invalid_cycle", "incremental cycle bounds are invalid");
  }
  const previous =
    input.previousCompletedCycleId === null
      ? "historical_baseline"
      : sha256(input.previousCompletedCycleId, "previousCompletedCycleId");
  if (
    input.previousCompletedCycleId === null &&
    lowerBoundAt !== DNA_FINISHED_RACE_INCREMENTAL_BASELINE_CUTOFF_AT
  ) {
    cycleError(
      "authority_drift",
      "first incremental cycle must begin at the immutable P5 cutoff",
    );
  }
  return hash([
    "dna_open_lab",
    "v1",
    DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY,
    lowerBoundAt,
    upperBoundAt,
    previous,
  ]);
}

export function dnaFinishedRaceIncrementalAttemptId(input: {
  cycleId: string;
  attemptNumber: number;
}): string {
  return hash([
    "dna_open_lab",
    "v1",
    "finished_race_incremental_attempt",
    sha256(input.cycleId, "cycleId"),
    String(attemptNumber(input.attemptNumber)),
  ]);
}

function completionIdentity(input: {
  cycleId: string;
  attemptId: string;
  checkpointSha256: string;
  completedAt: string;
}): string {
  return hash([
    "dna_open_lab",
    "v1",
    "finished_race_incremental_completion",
    input.cycleId,
    input.attemptId,
    input.checkpointSha256,
    input.completedAt,
  ]);
}

function normalizePause(
  value: DnaFinishedRaceIncrementalCycle["pause"],
): DnaFinishedRaceIncrementalCycle["pause"] {
  if (value === null) return null;
  if (!DNA_FINISHED_RACE_INCREMENTAL_PAUSE_REASONS.includes(value.reason)) {
    cycleError("invalid_cycle", "incremental cycle pause reason is invalid");
  }
  const pausedAt = timestamp(value.pausedAt, "pause.pausedAt");
  const retryAt =
    value.retryAt === null ? null : timestamp(value.retryAt, "pause.retryAt");
  if (retryAt !== null && Date.parse(retryAt) < Date.parse(pausedAt)) {
    cycleError("invalid_cycle", "incremental cycle retry cannot precede pause");
  }
  return Object.freeze({ reason: value.reason, pausedAt, retryAt });
}

export function validateDnaFinishedRaceIncrementalCycle(
  value: DnaFinishedRaceIncrementalCycle,
): DnaFinishedRaceIncrementalCycle {
  if (
    value.version !== DNA_FINISHED_RACE_INCREMENTAL_CYCLE_VERSION ||
    value.sourceFamily !== DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY
  ) {
    cycleError(
      "invalid_cycle",
      "incremental cycle version or family is invalid",
    );
  }
  const lowerBoundAt = timestamp(value.lowerBoundAt, "lowerBoundAt");
  const upperBoundAt = timestamp(value.upperBoundAt, "upperBoundAt");
  if (Date.parse(lowerBoundAt) >= Date.parse(upperBoundAt)) {
    cycleError("invalid_cycle", "incremental cycle bounds are invalid");
  }
  const previousCompletedCycleId =
    value.previousCompletedCycleId === null
      ? null
      : sha256(value.previousCompletedCycleId, "previousCompletedCycleId");
  const expectedCycleId = dnaFinishedRaceIncrementalCycleId({
    lowerBoundAt,
    upperBoundAt,
    previousCompletedCycleId,
  });
  const cycleId = sha256(value.cycleId, "cycleId");
  if (cycleId !== expectedCycleId) {
    cycleError(
      "authority_drift",
      "incremental cycle identity does not match its bounds",
    );
  }
  const normalizedAttemptNumber = attemptNumber(value.attemptNumber);
  const attemptId = sha256(value.attemptId, "attemptId");
  if (
    attemptId !==
    dnaFinishedRaceIncrementalAttemptId({
      cycleId,
      attemptNumber: normalizedAttemptNumber,
    })
  ) {
    cycleError("authority_drift", "incremental attempt identity is invalid");
  }
  const checkpoint = validateDnaFinishedRaceBackfillCheckpoint(
    value.checkpoint,
  );
  if (
    checkpoint.rootWindow.startTime !== lowerBoundAt ||
    checkpoint.rootWindow.endTime !== upperBoundAt
  ) {
    cycleError("authority_drift", "checkpoint root differs from cycle bounds");
  }
  if (
    checkpoint.identityOmissionAuthority !== null ||
    checkpoint.omittedIdentityObservationCount !== 0
  ) {
    cycleError(
      "authority_drift",
      "historical omission authority cannot carry into an incremental cycle",
    );
  }
  const pause = normalizePause(value.pause);
  const supersededByAttemptNumber =
    value.supersededByAttemptNumber === null
      ? null
      : attemptNumber(
          value.supersededByAttemptNumber,
          "supersededByAttemptNumber",
        );
  let completion: DnaFinishedRaceIncrementalCycle["completion"] = null;
  if (value.completion !== null) {
    const completedAt = timestamp(
      value.completion.completedAt,
      "completion.completedAt",
    );
    if (Date.parse(completedAt) < Date.parse(upperBoundAt)) {
      cycleError(
        "invalid_cycle",
        "incremental completion cannot precede its upper bound",
      );
    }
    const checkpointSha256 = sha256(
      value.completion.checkpointSha256,
      "completion.checkpointSha256",
    );
    const expectedCheckpointSha256 = dnaOpenLabRawEvidenceSha256(checkpoint);
    if (checkpointSha256 !== expectedCheckpointSha256) {
      cycleError("authority_drift", "completion checkpoint identity drifted");
    }
    const expectedCompletionSha256 = completionIdentity({
      cycleId,
      attemptId,
      checkpointSha256,
      completedAt,
    });
    const completionSha256 = sha256(
      value.completion.completionSha256,
      "completion.completionSha256",
    );
    if (completionSha256 !== expectedCompletionSha256) {
      cycleError("authority_drift", "incremental completion identity drifted");
    }
    completion = Object.freeze({
      completedAt,
      checkpointSha256,
      completionSha256,
    });
  }

  if (
    (value.status === "running" &&
      (pause !== null ||
        completion !== null ||
        supersededByAttemptNumber !== null)) ||
    (value.status === "paused" &&
      (pause === null ||
        completion !== null ||
        supersededByAttemptNumber !== null)) ||
    (value.status === "complete" &&
      (pause !== null ||
        completion === null ||
        supersededByAttemptNumber !== null ||
        checkpoint.pendingWindows.length !== 0)) ||
    (value.status === "superseded" &&
      (pause !== null ||
        completion !== null ||
        supersededByAttemptNumber !== normalizedAttemptNumber + 1)) ||
    !["running", "paused", "complete", "superseded"].includes(value.status)
  ) {
    cycleError("invalid_cycle", "incremental cycle status metadata is invalid");
  }

  return Object.freeze({
    version: DNA_FINISHED_RACE_INCREMENTAL_CYCLE_VERSION,
    cycleId,
    attemptId,
    previousCompletedCycleId,
    sourceFamily: DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY,
    lowerBoundAt,
    upperBoundAt,
    attemptNumber: normalizedAttemptNumber,
    status: value.status,
    checkpoint,
    pause,
    completion,
    supersededByAttemptNumber,
  });
}

export function createDnaFinishedRaceIncrementalCycle(input: {
  lowerBoundAt: string;
  upperBoundAt: string;
  previousCompletedCycleId: string | null;
  checkpoint: DnaFinishedRaceBackfillCheckpoint;
  attemptNumber?: number;
}): DnaFinishedRaceIncrementalCycle {
  const normalizedAttemptNumber = attemptNumber(input.attemptNumber ?? 1);
  const normalizedCheckpoint = validateDnaFinishedRaceBackfillCheckpoint(
    input.checkpoint,
  );
  if (
    normalizedAttemptNumber === 1 &&
    (normalizedCheckpoint.pendingWindows.length !== 1 ||
      dnaOpenLabRawEvidenceSha256(normalizedCheckpoint.pendingWindows[0]) !==
        dnaOpenLabRawEvidenceSha256(normalizedCheckpoint.rootWindow) ||
      normalizedCheckpoint.completedWindowCount !== 0 ||
      normalizedCheckpoint.splitCount !== 0 ||
      normalizedCheckpoint.successfulFinishedRaceRequestCount !== 0 ||
      normalizedCheckpoint.raceDocumentRequestCount !== 0 ||
      normalizedCheckpoint.publishedWindowDocumentCount !== 0)
  ) {
    cycleError(
      "authority_drift",
      "first incremental attempt must begin at its unprocessed root window",
    );
  }
  const cycleId = dnaFinishedRaceIncrementalCycleId(input);
  return validateDnaFinishedRaceIncrementalCycle({
    version: DNA_FINISHED_RACE_INCREMENTAL_CYCLE_VERSION,
    cycleId,
    attemptId: dnaFinishedRaceIncrementalAttemptId({
      cycleId,
      attemptNumber: normalizedAttemptNumber,
    }),
    previousCompletedCycleId: input.previousCompletedCycleId,
    sourceFamily: DNA_FINISHED_RACE_INCREMENTAL_SOURCE_FAMILY,
    lowerBoundAt: input.lowerBoundAt,
    upperBoundAt: input.upperBoundAt,
    attemptNumber: normalizedAttemptNumber,
    status: "running",
    checkpoint: normalizedCheckpoint,
    pause: null,
    completion: null,
    supersededByAttemptNumber: null,
  });
}

function assertSameAuthority(
  previous: DnaFinishedRaceIncrementalCycle,
  next: DnaFinishedRaceIncrementalCycle,
): void {
  for (const field of [
    "cycleId",
    "attemptId",
    "previousCompletedCycleId",
    "sourceFamily",
    "lowerBoundAt",
    "upperBoundAt",
    "attemptNumber",
  ] as const) {
    if (previous[field] !== next[field]) {
      cycleError("authority_drift", `incremental cycle ${field} cannot change`);
    }
  }
}

function assertMonotonicCheckpoint(
  previous: DnaFinishedRaceBackfillCheckpoint,
  next: DnaFinishedRaceBackfillCheckpoint,
): void {
  if (
    dnaOpenLabRawEvidenceSha256(previous.rootWindow) !==
      dnaOpenLabRawEvidenceSha256(next.rootWindow) ||
    previous.minimumWindowMilliseconds !== next.minimumWindowMilliseconds ||
    next.completedWindowCount < previous.completedWindowCount ||
    next.splitCount < previous.splitCount ||
    next.successfulFinishedRaceRequestCount <
      previous.successfulFinishedRaceRequestCount ||
    next.raceDocumentRequestCount < previous.raceDocumentRequestCount ||
    next.publishedWindowDocumentCount < previous.publishedWindowDocumentCount ||
    next.omittedIdentityObservationCount !== 0
  ) {
    cycleError(
      "invalid_transition",
      "incremental checkpoint progress regressed",
    );
  }
}

export function assertDnaFinishedRaceIncrementalCycleTransition(
  previousValue: DnaFinishedRaceIncrementalCycle,
  nextValue: DnaFinishedRaceIncrementalCycle,
): void {
  const previous = validateDnaFinishedRaceIncrementalCycle(previousValue);
  const next = validateDnaFinishedRaceIncrementalCycle(nextValue);
  assertSameAuthority(previous, next);
  assertMonotonicCheckpoint(previous.checkpoint, next.checkpoint);
  if (previous.status === "complete" || previous.status === "superseded") {
    cycleError(
      "invalid_transition",
      "terminal incremental attempt cannot change",
    );
  }
  const checkpointChanged =
    dnaOpenLabRawEvidenceSha256(previous.checkpoint) !==
    dnaOpenLabRawEvidenceSha256(next.checkpoint);
  if (
    ((previous.status === "running" && next.status === "paused") ||
      (previous.status === "paused" && next.status === "running") ||
      next.status === "superseded") &&
    checkpointChanged
  ) {
    cycleError(
      "invalid_transition",
      "pause, resume and supersede cannot alter checkpoint progress",
    );
  }
  if (
    (previous.status === "paused" &&
      next.status !== "running" &&
      next.status !== "superseded") ||
    (previous.status === "running" &&
      !["running", "paused", "complete", "superseded"].includes(next.status)) ||
    (previous.status === "running" &&
      next.status === "running" &&
      !checkpointChanged)
  ) {
    cycleError("invalid_transition", "incremental cycle transition is invalid");
  }
}

export function pauseDnaFinishedRaceIncrementalCycle(input: {
  cycle: DnaFinishedRaceIncrementalCycle;
  reason: DnaFinishedRaceIncrementalPauseReason;
  pausedAt: string;
  retryAt?: string | null;
}): DnaFinishedRaceIncrementalCycle {
  const previous = validateDnaFinishedRaceIncrementalCycle(input.cycle);
  const next = validateDnaFinishedRaceIncrementalCycle({
    ...previous,
    status: "paused",
    pause: {
      reason: input.reason,
      pausedAt: input.pausedAt,
      retryAt: input.retryAt ?? null,
    },
  });
  assertDnaFinishedRaceIncrementalCycleTransition(previous, next);
  return next;
}

export function resumeDnaFinishedRaceIncrementalCycle(
  value: DnaFinishedRaceIncrementalCycle,
): DnaFinishedRaceIncrementalCycle {
  const previous = validateDnaFinishedRaceIncrementalCycle(value);
  const next = validateDnaFinishedRaceIncrementalCycle({
    ...previous,
    status: "running",
    pause: null,
  });
  assertDnaFinishedRaceIncrementalCycleTransition(previous, next);
  return next;
}

export function completeDnaFinishedRaceIncrementalCycle(input: {
  cycle: DnaFinishedRaceIncrementalCycle;
  checkpoint: DnaFinishedRaceBackfillCheckpoint;
  completedAt: string;
}): DnaFinishedRaceIncrementalCycle {
  const previous = validateDnaFinishedRaceIncrementalCycle(input.cycle);
  const checkpoint = validateDnaFinishedRaceBackfillCheckpoint(
    input.checkpoint,
  );
  const completedAt = timestamp(input.completedAt, "completedAt");
  const checkpointSha256 = dnaOpenLabRawEvidenceSha256(checkpoint);
  const completionSha256 = completionIdentity({
    cycleId: previous.cycleId,
    attemptId: previous.attemptId,
    checkpointSha256,
    completedAt,
  });
  const next = validateDnaFinishedRaceIncrementalCycle({
    ...previous,
    status: "complete",
    checkpoint,
    completion: { completedAt, checkpointSha256, completionSha256 },
  });
  assertDnaFinishedRaceIncrementalCycleTransition(previous, next);
  return next;
}

export function supersedeDnaFinishedRaceIncrementalCycle(
  value: DnaFinishedRaceIncrementalCycle,
): DnaFinishedRaceIncrementalCycle {
  const previous = validateDnaFinishedRaceIncrementalCycle(value);
  const next = validateDnaFinishedRaceIncrementalCycle({
    ...previous,
    status: "superseded",
    pause: null,
    supersededByAttemptNumber: previous.attemptNumber + 1,
  });
  assertDnaFinishedRaceIncrementalCycleTransition(previous, next);
  return next;
}

export function beginReplacementDnaFinishedRaceIncrementalCycleAttempt(
  supersededValue: DnaFinishedRaceIncrementalCycle,
): DnaFinishedRaceIncrementalCycle {
  const superseded = validateDnaFinishedRaceIncrementalCycle(supersededValue);
  if (superseded.status !== "superseded") {
    cycleError(
      "invalid_transition",
      "replacement requires a superseded attempt",
    );
  }
  return createDnaFinishedRaceIncrementalCycle({
    lowerBoundAt: superseded.lowerBoundAt,
    upperBoundAt: superseded.upperBoundAt,
    previousCompletedCycleId: superseded.previousCompletedCycleId,
    checkpoint: superseded.checkpoint,
    attemptNumber: superseded.attemptNumber + 1,
  });
}
