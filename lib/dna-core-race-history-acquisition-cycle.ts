import { createHash } from "node:crypto";

export const DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION = 1 as const;
export const DNA_CORE_RACE_HISTORY_SOURCE_FAMILY = "core_race_history" as const;
export const DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE = 50 as const;
export const DNA_CORE_RACE_HISTORY_MAXIMUM_CORES = 4_096 as const;
export const DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE = 10_000 as const;
export const DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS = 32 as const;
export const DNA_CORE_RACE_HISTORY_EMPTY_RECEIPT_CHAIN_SHA256 = "0".repeat(64);

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export const DNA_CORE_RACE_HISTORY_PAUSE_REASONS = Object.freeze([
  "api_unavailable",
  "rate_limited",
  "tier_ineligible",
  "budget_closed",
  "invalid_response",
  "evidence_conflict",
  "operator_hold",
] as const);

export type DnaCoreRaceHistoryPauseReason =
  (typeof DNA_CORE_RACE_HISTORY_PAUSE_REASONS)[number];

export type DnaCoreRaceHistoryAcquisitionCycleStatus =
  "running" | "paused" | "complete" | "superseded";

export type DnaCoreRaceHistoryAcquisitionCycle = Readonly<{
  version: typeof DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION;
  cycleId: string;
  attemptId: string;
  previousCompletedCycleId: string | null;
  sourceFamily: typeof DNA_CORE_RACE_HISTORY_SOURCE_FAMILY;
  currentStateGenerationId: string;
  evaluatedAt: string;
  coreSetSha256: string;
  coreIds: readonly number[];
  attemptNumber: number;
  status: DnaCoreRaceHistoryAcquisitionCycleStatus;
  pause: Readonly<{
    reason: DnaCoreRaceHistoryPauseReason;
    pausedAt: string;
    retryAt: string | null;
  }> | null;
  completion: Readonly<{
    completedAt: string;
    completedCoreCount: number;
    pageReceiptCount: number;
    sourceRowCount: number;
    acceptedResultCount: number;
    quarantineCount: number;
    replayDuplicateCount: number;
    coreCompletionSetSha256: string;
    completionSha256: string;
  }> | null;
  supersededByAttemptNumber: number | null;
}>;

export type DnaCoreRaceHistoryCoreCheckpoint = Readonly<{
  version: typeof DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION;
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  coreOrdinal: number;
  status: "running" | "complete";
  nextPage: number;
  completedPageCount: number;
  sourceRowCount: number;
  acceptedResultCount: number;
  quarantineCount: number;
  replayDuplicateCount: number;
  receiptChainSha256: string;
  terminalPageNumber: number | null;
  completionSha256: string | null;
}>;

export type DnaCoreRaceHistoryPageReceipt = Readonly<{
  version: typeof DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION;
  cycleId: string;
  attemptNumber: number;
  coreId: number;
  pageNumber: number;
  observedAt: string;
  sourceRowCount: number;
  acceptedResultCount: number;
  quarantineCount: number;
  replayDuplicateCount: number;
  terminal: boolean;
  pageObjectKey: string;
  pageBodySha256: string;
  pageByteLength: number;
  quarantineObjectKey: string | null;
  quarantineBodySha256: string | null;
  quarantineByteLength: number | null;
  receiptSha256: string;
}>;

export type StoredDnaCoreRaceHistoryAcquisitionCycle = Readonly<{
  revision: string;
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
}>;

export type StoredDnaCoreRaceHistoryCoreCheckpoint = Readonly<{
  revision: string;
  checkpoint: DnaCoreRaceHistoryCoreCheckpoint;
}>;

export type DnaCoreRaceHistoryAcquisitionRepository = Readonly<{
  loadAttempt: (input: {
    cycleId: string;
    attemptNumber: number;
  }) => Promise<StoredDnaCoreRaceHistoryAcquisitionCycle | null>;
  loadNextCore: (input: {
    cycleId: string;
    attemptNumber: number;
  }) => Promise<StoredDnaCoreRaceHistoryCoreCheckpoint | null>;
  loadCores: (input: {
    cycleId: string;
    attemptNumber: number;
  }) => Promise<readonly StoredDnaCoreRaceHistoryCoreCheckpoint[]>;
  loadLatestComplete: () => Promise<StoredDnaCoreRaceHistoryAcquisitionCycle | null>;
  saveAttempt: (input: {
    expectedRevision: string | null;
    cycle: DnaCoreRaceHistoryAcquisitionCycle;
  }) => Promise<StoredDnaCoreRaceHistoryAcquisitionCycle>;
  savePage: (input: {
    expectedCoreRevision: string;
    checkpoint: DnaCoreRaceHistoryCoreCheckpoint;
    receipt: DnaCoreRaceHistoryPageReceipt;
  }) => Promise<StoredDnaCoreRaceHistoryCoreCheckpoint>;
}>;

export class DnaCoreRaceHistoryAcquisitionError extends Error {
  readonly kind:
    | "invalid_cycle"
    | "invalid_checkpoint"
    | "invalid_receipt"
    | "invalid_transition"
    | "authority_drift";

  constructor(input: {
    kind: DnaCoreRaceHistoryAcquisitionError["kind"];
    message: string;
  }) {
    super(input.message);
    this.name = "DnaCoreRaceHistoryAcquisitionError";
    this.kind = input.kind;
  }
}

function acquisitionError(
  kind: DnaCoreRaceHistoryAcquisitionError["kind"],
  message: string,
): never {
  throw new DnaCoreRaceHistoryAcquisitionError({ kind, message });
}

function hash(parts: readonly (string | number | boolean)[]): string {
  return createHash("sha256")
    .update(parts.map(String).join("\u0000"), "utf8")
    .digest("hex");
}

function sha256(
  value: string,
  field: string,
  kind: DnaCoreRaceHistoryAcquisitionError["kind"],
): string {
  const normalized = value.trim().toLowerCase();
  if (!SHA_256_PATTERN.test(normalized)) {
    acquisitionError(kind, `${field} must be a SHA-256 value`);
  }
  return normalized;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) {
    acquisitionError("invalid_cycle", `${field} must be a UUID`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  if (
    typeof value !== "string" ||
    value.trim() !== value ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      value,
    ) ||
    Number.isNaN(Date.parse(value))
  ) {
    acquisitionError(
      "invalid_cycle",
      `${field} must be a timezone-qualified timestamp`,
    );
  }
  return new Date(value).toISOString();
}

function safeInteger(
  value: number,
  field: string,
  input: {
    minimum?: number;
    maximum?: number;
    kind?: DnaCoreRaceHistoryAcquisitionError["kind"];
  } = {},
): number {
  const minimum = input.minimum ?? 0;
  const maximum = input.maximum ?? Number.MAX_SAFE_INTEGER;
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    acquisitionError(
      input.kind ?? "invalid_cycle",
      `${field} must be between ${minimum} and ${maximum}`,
    );
  }
  return value;
}

function attemptNumber(value: number): number {
  return safeInteger(value, "attemptNumber", {
    minimum: 1,
    maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS,
  });
}

function pageNumber(
  value: number,
  kind: DnaCoreRaceHistoryAcquisitionError["kind"],
): number {
  return safeInteger(value, "pageNumber", {
    minimum: 1,
    maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
    kind,
  });
}

function normalizedCoreIds(values: readonly number[]): readonly number[] {
  if (!Array.isArray(values) || values.length < 1) {
    acquisitionError("invalid_cycle", "coreIds must not be empty");
  }
  if (values.length > DNA_CORE_RACE_HISTORY_MAXIMUM_CORES) {
    acquisitionError("invalid_cycle", "coreIds exceed the bounded capacity");
  }
  const normalized = values.map((value) =>
    safeInteger(value, "coreId", { minimum: 1 }),
  );
  const sorted = [...new Set(normalized)].sort((left, right) => left - right);
  if (sorted.length !== normalized.length) {
    acquisitionError("invalid_cycle", "coreIds must be unique");
  }
  return Object.freeze(sorted);
}

export function dnaCoreRaceHistoryCoreSetSha256(
  coreIds: readonly number[],
): string {
  const normalized = normalizedCoreIds(coreIds);
  return hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "core_set",
    ...normalized,
  ]);
}

export function dnaCoreRaceHistoryCycleId(input: {
  previousCompletedCycleId: string | null;
  currentStateGenerationId: string;
  evaluatedAt: string;
  coreSetSha256: string;
}): string {
  const previous =
    input.previousCompletedCycleId === null
      ? "initial"
      : sha256(
          input.previousCompletedCycleId,
          "previousCompletedCycleId",
          "invalid_cycle",
        );
  return hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "cycle",
    previous,
    uuid(input.currentStateGenerationId, "currentStateGenerationId"),
    timestamp(input.evaluatedAt, "evaluatedAt"),
    sha256(input.coreSetSha256, "coreSetSha256", "invalid_cycle"),
  ]);
}

export function dnaCoreRaceHistoryAttemptId(input: {
  cycleId: string;
  attemptNumber: number;
}): string {
  return hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "attempt",
    sha256(input.cycleId, "cycleId", "invalid_cycle"),
    attemptNumber(input.attemptNumber),
  ]);
}

function normalizePause(
  pause: DnaCoreRaceHistoryAcquisitionCycle["pause"],
): DnaCoreRaceHistoryAcquisitionCycle["pause"] {
  if (pause === null) return null;
  if (!DNA_CORE_RACE_HISTORY_PAUSE_REASONS.includes(pause.reason)) {
    acquisitionError("invalid_cycle", "pause reason is invalid");
  }
  const pausedAt = timestamp(pause.pausedAt, "pause.pausedAt");
  const retryAt =
    pause.retryAt === null ? null : timestamp(pause.retryAt, "pause.retryAt");
  if (retryAt !== null && Date.parse(retryAt) < Date.parse(pausedAt)) {
    acquisitionError("invalid_cycle", "retryAt cannot precede pausedAt");
  }
  return Object.freeze({ reason: pause.reason, pausedAt, retryAt });
}

function normalizedCompletion(
  value: NonNullable<DnaCoreRaceHistoryAcquisitionCycle["completion"]>,
  cycle: Pick<
    DnaCoreRaceHistoryAcquisitionCycle,
    "cycleId" | "attemptId" | "coreIds" | "evaluatedAt"
  >,
): NonNullable<DnaCoreRaceHistoryAcquisitionCycle["completion"]> {
  const completedAt = timestamp(value.completedAt, "completion.completedAt");
  if (Date.parse(completedAt) < Date.parse(cycle.evaluatedAt)) {
    acquisitionError("invalid_cycle", "completion predates evaluation");
  }
  const completedCoreCount = safeInteger(
    value.completedCoreCount,
    "completion.completedCoreCount",
  );
  if (completedCoreCount !== cycle.coreIds.length) {
    acquisitionError("invalid_cycle", "completion does not cover every Core");
  }
  const counters = {
    pageReceiptCount: safeInteger(
      value.pageReceiptCount,
      "completion.pageReceiptCount",
    ),
    sourceRowCount: safeInteger(
      value.sourceRowCount,
      "completion.sourceRowCount",
    ),
    acceptedResultCount: safeInteger(
      value.acceptedResultCount,
      "completion.acceptedResultCount",
    ),
    quarantineCount: safeInteger(
      value.quarantineCount,
      "completion.quarantineCount",
    ),
    replayDuplicateCount: safeInteger(
      value.replayDuplicateCount,
      "completion.replayDuplicateCount",
    ),
  };
  if (
    counters.acceptedResultCount +
      counters.quarantineCount +
      counters.replayDuplicateCount !==
    counters.sourceRowCount
  ) {
    acquisitionError("invalid_cycle", "completion row counts are inconsistent");
  }
  const coreCompletionSetSha256 = sha256(
    value.coreCompletionSetSha256,
    "completion.coreCompletionSetSha256",
    "invalid_cycle",
  );
  const expectedCompletionSha256 = hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "completion",
    cycle.cycleId,
    cycle.attemptId,
    completedAt,
    completedCoreCount,
    counters.pageReceiptCount,
    counters.sourceRowCount,
    counters.acceptedResultCount,
    counters.quarantineCount,
    counters.replayDuplicateCount,
    coreCompletionSetSha256,
  ]);
  const completionSha256 = sha256(
    value.completionSha256,
    "completion.completionSha256",
    "invalid_cycle",
  );
  if (completionSha256 !== expectedCompletionSha256) {
    acquisitionError("authority_drift", "cycle completion identity drifted");
  }
  return Object.freeze({
    completedAt,
    completedCoreCount,
    ...counters,
    coreCompletionSetSha256,
    completionSha256,
  });
}

export function validateDnaCoreRaceHistoryAcquisitionCycle(
  value: DnaCoreRaceHistoryAcquisitionCycle,
): DnaCoreRaceHistoryAcquisitionCycle {
  if (
    value.version !== DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION ||
    value.sourceFamily !== DNA_CORE_RACE_HISTORY_SOURCE_FAMILY
  ) {
    acquisitionError("invalid_cycle", "cycle version or family is invalid");
  }
  const coreIds = normalizedCoreIds(value.coreIds);
  const coreSetSha256 = sha256(
    value.coreSetSha256,
    "coreSetSha256",
    "invalid_cycle",
  );
  if (coreSetSha256 !== dnaCoreRaceHistoryCoreSetSha256(coreIds)) {
    acquisitionError("authority_drift", "Core set identity drifted");
  }
  const previousCompletedCycleId =
    value.previousCompletedCycleId === null
      ? null
      : sha256(
          value.previousCompletedCycleId,
          "previousCompletedCycleId",
          "invalid_cycle",
        );
  const currentStateGenerationId = uuid(
    value.currentStateGenerationId,
    "currentStateGenerationId",
  );
  const evaluatedAt = timestamp(value.evaluatedAt, "evaluatedAt");
  const cycleId = sha256(value.cycleId, "cycleId", "invalid_cycle");
  const expectedCycleId = dnaCoreRaceHistoryCycleId({
    previousCompletedCycleId,
    currentStateGenerationId,
    evaluatedAt,
    coreSetSha256,
  });
  if (cycleId !== expectedCycleId) {
    acquisitionError("authority_drift", "cycle identity drifted");
  }
  const normalizedAttemptNumber = attemptNumber(value.attemptNumber);
  const attemptId = sha256(value.attemptId, "attemptId", "invalid_cycle");
  if (
    attemptId !==
    dnaCoreRaceHistoryAttemptId({
      cycleId,
      attemptNumber: normalizedAttemptNumber,
    })
  ) {
    acquisitionError("authority_drift", "attempt identity drifted");
  }
  const pause = normalizePause(value.pause);
  const supersededByAttemptNumber =
    value.supersededByAttemptNumber === null
      ? null
      : attemptNumber(value.supersededByAttemptNumber);
  const partialCycle = {
    cycleId,
    attemptId,
    coreIds,
    evaluatedAt,
  };
  const completion =
    value.completion === null
      ? null
      : normalizedCompletion(value.completion, partialCycle);
  if (
    !["running", "paused", "complete", "superseded"].includes(value.status) ||
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
        supersededByAttemptNumber !== null)) ||
    (value.status === "superseded" &&
      (pause !== null ||
        completion !== null ||
        supersededByAttemptNumber !== normalizedAttemptNumber + 1))
  ) {
    acquisitionError("invalid_cycle", "cycle status metadata is invalid");
  }
  return Object.freeze({
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    cycleId,
    attemptId,
    previousCompletedCycleId,
    sourceFamily: DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    currentStateGenerationId,
    evaluatedAt,
    coreSetSha256,
    coreIds,
    attemptNumber: normalizedAttemptNumber,
    status: value.status,
    pause,
    completion,
    supersededByAttemptNumber,
  });
}

export function createDnaCoreRaceHistoryAcquisitionCycle(input: {
  previousCompletedCycleId: string | null;
  currentStateGenerationId: string;
  evaluatedAt: string;
  coreIds: readonly number[];
  attemptNumber?: number;
}): DnaCoreRaceHistoryAcquisitionCycle {
  const coreIds = normalizedCoreIds(input.coreIds);
  const coreSetSha256 = dnaCoreRaceHistoryCoreSetSha256(coreIds);
  const cycleId = dnaCoreRaceHistoryCycleId({
    previousCompletedCycleId: input.previousCompletedCycleId,
    currentStateGenerationId: input.currentStateGenerationId,
    evaluatedAt: input.evaluatedAt,
    coreSetSha256,
  });
  const normalizedAttemptNumber = attemptNumber(input.attemptNumber ?? 1);
  return validateDnaCoreRaceHistoryAcquisitionCycle({
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    cycleId,
    attemptId: dnaCoreRaceHistoryAttemptId({
      cycleId,
      attemptNumber: normalizedAttemptNumber,
    }),
    previousCompletedCycleId: input.previousCompletedCycleId,
    sourceFamily: DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    currentStateGenerationId: input.currentStateGenerationId,
    evaluatedAt: input.evaluatedAt,
    coreSetSha256,
    coreIds,
    attemptNumber: normalizedAttemptNumber,
    status: "running",
    pause: null,
    completion: null,
    supersededByAttemptNumber: null,
  });
}

function sameCycleAuthority(
  previous: DnaCoreRaceHistoryAcquisitionCycle,
  next: DnaCoreRaceHistoryAcquisitionCycle,
): boolean {
  return (
    previous.cycleId === next.cycleId &&
    previous.attemptId === next.attemptId &&
    previous.previousCompletedCycleId === next.previousCompletedCycleId &&
    previous.currentStateGenerationId === next.currentStateGenerationId &&
    previous.evaluatedAt === next.evaluatedAt &&
    previous.coreSetSha256 === next.coreSetSha256 &&
    previous.attemptNumber === next.attemptNumber &&
    previous.coreIds.join(",") === next.coreIds.join(",")
  );
}

export function assertDnaCoreRaceHistoryCycleTransition(
  previousValue: DnaCoreRaceHistoryAcquisitionCycle,
  nextValue: DnaCoreRaceHistoryAcquisitionCycle,
): void {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(previousValue);
  const next = validateDnaCoreRaceHistoryAcquisitionCycle(nextValue);
  if (!sameCycleAuthority(previous, next)) {
    acquisitionError("authority_drift", "cycle authority cannot change");
  }
  if (previous.status === "complete" || previous.status === "superseded") {
    acquisitionError("invalid_transition", "terminal cycle cannot change");
  }
  if (
    (previous.status === "running" &&
      !["paused", "complete", "superseded"].includes(next.status)) ||
    (previous.status === "paused" &&
      !["running", "superseded"].includes(next.status))
  ) {
    acquisitionError("invalid_transition", "cycle transition is invalid");
  }
}

export function pauseDnaCoreRaceHistoryAcquisitionCycle(input: {
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
  reason: DnaCoreRaceHistoryPauseReason;
  pausedAt: string;
  retryAt?: string | null;
}): DnaCoreRaceHistoryAcquisitionCycle {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(input.cycle);
  const next = validateDnaCoreRaceHistoryAcquisitionCycle({
    ...previous,
    status: "paused",
    pause: {
      reason: input.reason,
      pausedAt: input.pausedAt,
      retryAt: input.retryAt ?? null,
    },
  });
  assertDnaCoreRaceHistoryCycleTransition(previous, next);
  return next;
}

export function resumeDnaCoreRaceHistoryAcquisitionCycle(
  value: DnaCoreRaceHistoryAcquisitionCycle,
): DnaCoreRaceHistoryAcquisitionCycle {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(value);
  const next = validateDnaCoreRaceHistoryAcquisitionCycle({
    ...previous,
    status: "running",
    pause: null,
  });
  assertDnaCoreRaceHistoryCycleTransition(previous, next);
  return next;
}

export function supersedeDnaCoreRaceHistoryAcquisitionCycle(
  value: DnaCoreRaceHistoryAcquisitionCycle,
): DnaCoreRaceHistoryAcquisitionCycle {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(value);
  const next = validateDnaCoreRaceHistoryAcquisitionCycle({
    ...previous,
    status: "superseded",
    pause: null,
    supersededByAttemptNumber: previous.attemptNumber + 1,
  });
  assertDnaCoreRaceHistoryCycleTransition(previous, next);
  return next;
}

export function beginReplacementDnaCoreRaceHistoryAcquisitionAttempt(
  value: DnaCoreRaceHistoryAcquisitionCycle,
): DnaCoreRaceHistoryAcquisitionCycle {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(value);
  if (previous.status !== "superseded") {
    acquisitionError(
      "invalid_transition",
      "replacement requires a superseded attempt",
    );
  }
  return createDnaCoreRaceHistoryAcquisitionCycle({
    previousCompletedCycleId: previous.previousCompletedCycleId,
    currentStateGenerationId: previous.currentStateGenerationId,
    evaluatedAt: previous.evaluatedAt,
    coreIds: previous.coreIds,
    attemptNumber: previous.attemptNumber + 1,
  });
}

export function createDnaCoreRaceHistoryCoreCheckpoint(input: {
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
  coreId: number;
}): DnaCoreRaceHistoryCoreCheckpoint {
  const cycle = validateDnaCoreRaceHistoryAcquisitionCycle(input.cycle);
  if (cycle.status !== "running") {
    acquisitionError(
      "invalid_checkpoint",
      "Core checkpoint requires a running attempt",
    );
  }
  const coreId = safeInteger(input.coreId, "coreId", {
    minimum: 1,
    kind: "invalid_checkpoint",
  });
  const coreOrdinal = cycle.coreIds.indexOf(coreId) + 1;
  if (coreOrdinal < 1) {
    acquisitionError(
      "authority_drift",
      "Core checkpoint is outside the cycle Core set",
    );
  }
  return Object.freeze({
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    cycleId: cycle.cycleId,
    attemptNumber: cycle.attemptNumber,
    coreId,
    coreOrdinal,
    status: "running",
    nextPage: 1,
    completedPageCount: 0,
    sourceRowCount: 0,
    acceptedResultCount: 0,
    quarantineCount: 0,
    replayDuplicateCount: 0,
    receiptChainSha256: DNA_CORE_RACE_HISTORY_EMPTY_RECEIPT_CHAIN_SHA256,
    terminalPageNumber: null,
    completionSha256: null,
  });
}

export function validateDnaCoreRaceHistoryPageReceipt(
  value: DnaCoreRaceHistoryPageReceipt,
): DnaCoreRaceHistoryPageReceipt {
  if (value.version !== DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION) {
    acquisitionError("invalid_receipt", "page receipt version is invalid");
  }
  const cycleId = sha256(value.cycleId, "cycleId", "invalid_receipt");
  const normalizedAttemptNumber = safeInteger(
    value.attemptNumber,
    "attemptNumber",
    {
      minimum: 1,
      maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS,
      kind: "invalid_receipt",
    },
  );
  const coreId = safeInteger(value.coreId, "coreId", {
    minimum: 1,
    kind: "invalid_receipt",
  });
  const normalizedPageNumber = pageNumber(value.pageNumber, "invalid_receipt");
  const observedAt = timestamp(value.observedAt, "observedAt");
  const sourceRowCount = safeInteger(value.sourceRowCount, "sourceRowCount", {
    maximum: DNA_CORE_RACE_HISTORY_PROVIDER_PAGE_SIZE,
    kind: "invalid_receipt",
  });
  const acceptedResultCount = safeInteger(
    value.acceptedResultCount,
    "acceptedResultCount",
    { maximum: sourceRowCount, kind: "invalid_receipt" },
  );
  const quarantineCount = safeInteger(
    value.quarantineCount,
    "quarantineCount",
    { maximum: sourceRowCount, kind: "invalid_receipt" },
  );
  const replayDuplicateCount = safeInteger(
    value.replayDuplicateCount,
    "replayDuplicateCount",
    { maximum: sourceRowCount, kind: "invalid_receipt" },
  );
  if (
    acceptedResultCount + quarantineCount + replayDuplicateCount !==
    sourceRowCount
  ) {
    acquisitionError("invalid_receipt", "page receipt row counts disagree");
  }
  if (value.terminal !== (sourceRowCount === 0)) {
    acquisitionError(
      "invalid_receipt",
      "only an explicit empty page can be terminal",
    );
  }
  const pageObjectKey = safeObjectKey(value.pageObjectKey, "pageObjectKey");
  const pageBodySha256 = sha256(
    value.pageBodySha256,
    "pageBodySha256",
    "invalid_receipt",
  );
  const pageByteLength = safeInteger(value.pageByteLength, "pageByteLength", {
    minimum: 1,
    kind: "invalid_receipt",
  });
  let quarantineObjectKey: string | null = null;
  let quarantineBodySha256: string | null = null;
  let quarantineByteLength: number | null = null;
  if (quarantineCount > 0) {
    if (
      value.quarantineObjectKey === null ||
      value.quarantineBodySha256 === null ||
      value.quarantineByteLength === null
    ) {
      acquisitionError(
        "invalid_receipt",
        "quarantined rows require an immutable quarantine receipt",
      );
    }
    quarantineObjectKey = safeObjectKey(
      value.quarantineObjectKey,
      "quarantineObjectKey",
    );
    quarantineBodySha256 = sha256(
      value.quarantineBodySha256,
      "quarantineBodySha256",
      "invalid_receipt",
    );
    quarantineByteLength = safeInteger(
      value.quarantineByteLength,
      "quarantineByteLength",
      { minimum: 1, kind: "invalid_receipt" },
    );
  } else if (
    value.quarantineObjectKey !== null ||
    value.quarantineBodySha256 !== null ||
    value.quarantineByteLength !== null
  ) {
    acquisitionError(
      "invalid_receipt",
      "empty quarantine metadata must remain absent",
    );
  }
  const expectedReceiptSha256 = pageReceiptIdentity({
    cycleId,
    attemptNumber: normalizedAttemptNumber,
    coreId,
    pageNumber: normalizedPageNumber,
    observedAt,
    sourceRowCount,
    acceptedResultCount,
    quarantineCount,
    replayDuplicateCount,
    terminal: value.terminal,
    pageObjectKey,
    pageBodySha256,
    pageByteLength,
    quarantineObjectKey,
    quarantineBodySha256,
    quarantineByteLength,
  });
  const receiptSha256 = sha256(
    value.receiptSha256,
    "receiptSha256",
    "invalid_receipt",
  );
  if (receiptSha256 !== expectedReceiptSha256) {
    acquisitionError("authority_drift", "page receipt identity drifted");
  }
  return Object.freeze({
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    cycleId,
    attemptNumber: normalizedAttemptNumber,
    coreId,
    pageNumber: normalizedPageNumber,
    observedAt,
    sourceRowCount,
    acceptedResultCount,
    quarantineCount,
    replayDuplicateCount,
    terminal: value.terminal,
    pageObjectKey,
    pageBodySha256,
    pageByteLength,
    quarantineObjectKey,
    quarantineBodySha256,
    quarantineByteLength,
    receiptSha256,
  });
}

function safeObjectKey(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 4_096 ||
    normalized.startsWith("/") ||
    normalized.split("/").includes("..") ||
    CONTROL_PATTERN.test(normalized)
  ) {
    acquisitionError("invalid_receipt", `${field} is invalid`);
  }
  return normalized;
}

function pageReceiptIdentity(
  value: Omit<DnaCoreRaceHistoryPageReceipt, "version" | "receiptSha256">,
): string {
  return hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "page_receipt",
    value.cycleId,
    value.attemptNumber,
    value.coreId,
    value.pageNumber,
    value.observedAt,
    value.sourceRowCount,
    value.acceptedResultCount,
    value.quarantineCount,
    value.replayDuplicateCount,
    value.terminal,
    value.pageObjectKey,
    value.pageBodySha256,
    value.pageByteLength,
    value.quarantineObjectKey ?? "none",
    value.quarantineBodySha256 ?? "none",
    value.quarantineByteLength ?? "none",
  ]);
}

export function createDnaCoreRaceHistoryPageReceipt(
  value: Omit<
    DnaCoreRaceHistoryPageReceipt,
    "version" | "terminal" | "receiptSha256"
  >,
): DnaCoreRaceHistoryPageReceipt {
  const candidate = {
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    ...value,
    terminal: value.sourceRowCount === 0,
  } as const;
  return validateDnaCoreRaceHistoryPageReceipt({
    ...candidate,
    receiptSha256: pageReceiptIdentity(candidate),
  });
}

export function validateDnaCoreRaceHistoryCoreCheckpoint(
  value: DnaCoreRaceHistoryCoreCheckpoint,
): DnaCoreRaceHistoryCoreCheckpoint {
  if (value.version !== DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION) {
    acquisitionError("invalid_checkpoint", "checkpoint version is invalid");
  }
  const cycleId = sha256(value.cycleId, "cycleId", "invalid_checkpoint");
  const normalizedAttemptNumber = safeInteger(
    value.attemptNumber,
    "attemptNumber",
    {
      minimum: 1,
      maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_ATTEMPTS,
      kind: "invalid_checkpoint",
    },
  );
  const coreId = safeInteger(value.coreId, "coreId", {
    minimum: 1,
    kind: "invalid_checkpoint",
  });
  const coreOrdinal = safeInteger(value.coreOrdinal, "coreOrdinal", {
    minimum: 1,
    maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_CORES,
    kind: "invalid_checkpoint",
  });
  const nextPage = safeInteger(value.nextPage, "nextPage", {
    minimum: 1,
    maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE + 1,
    kind: "invalid_checkpoint",
  });
  const completedPageCount = safeInteger(
    value.completedPageCount,
    "completedPageCount",
    {
      maximum: DNA_CORE_RACE_HISTORY_MAXIMUM_PAGES_PER_CORE,
      kind: "invalid_checkpoint",
    },
  );
  const sourceRowCount = safeInteger(value.sourceRowCount, "sourceRowCount", {
    kind: "invalid_checkpoint",
  });
  const acceptedResultCount = safeInteger(
    value.acceptedResultCount,
    "acceptedResultCount",
    { maximum: sourceRowCount, kind: "invalid_checkpoint" },
  );
  const quarantineCount = safeInteger(
    value.quarantineCount,
    "quarantineCount",
    { maximum: sourceRowCount, kind: "invalid_checkpoint" },
  );
  const replayDuplicateCount = safeInteger(
    value.replayDuplicateCount,
    "replayDuplicateCount",
    { maximum: sourceRowCount, kind: "invalid_checkpoint" },
  );
  if (
    acceptedResultCount + quarantineCount + replayDuplicateCount !==
    sourceRowCount
  ) {
    acquisitionError("invalid_checkpoint", "checkpoint counts disagree");
  }
  const receiptChainSha256 = sha256(
    value.receiptChainSha256,
    "receiptChainSha256",
    "invalid_checkpoint",
  );
  const terminalPageNumber =
    value.terminalPageNumber === null
      ? null
      : pageNumber(value.terminalPageNumber, "invalid_checkpoint");
  const completionSha256 =
    value.completionSha256 === null
      ? null
      : sha256(
          value.completionSha256,
          "completionSha256",
          "invalid_checkpoint",
        );
  if (
    nextPage !== completedPageCount + 1 ||
    (value.status === "running" &&
      (terminalPageNumber !== null || completionSha256 !== null)) ||
    (value.status === "complete" &&
      (terminalPageNumber !== completedPageCount ||
        completionSha256 === null)) ||
    !["running", "complete"].includes(value.status) ||
    (completedPageCount === 0 &&
      receiptChainSha256 !== DNA_CORE_RACE_HISTORY_EMPTY_RECEIPT_CHAIN_SHA256)
  ) {
    acquisitionError("invalid_checkpoint", "checkpoint state is invalid");
  }
  if (value.status === "complete") {
    const expected = hash([
      "dna_open_lab",
      "v1",
      DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
      "core_completion",
      cycleId,
      normalizedAttemptNumber,
      coreId,
      coreOrdinal,
      completedPageCount,
      sourceRowCount,
      acceptedResultCount,
      quarantineCount,
      replayDuplicateCount,
      receiptChainSha256,
    ]);
    if (completionSha256 !== expected) {
      acquisitionError("authority_drift", "Core completion identity drifted");
    }
  }
  return Object.freeze({
    version: DNA_CORE_RACE_HISTORY_ACQUISITION_VERSION,
    cycleId,
    attemptNumber: normalizedAttemptNumber,
    coreId,
    coreOrdinal,
    status: value.status,
    nextPage,
    completedPageCount,
    sourceRowCount,
    acceptedResultCount,
    quarantineCount,
    replayDuplicateCount,
    receiptChainSha256,
    terminalPageNumber,
    completionSha256,
  });
}

export function applyDnaCoreRaceHistoryPageReceipt(input: {
  checkpoint: DnaCoreRaceHistoryCoreCheckpoint;
  receipt: DnaCoreRaceHistoryPageReceipt;
}): DnaCoreRaceHistoryCoreCheckpoint {
  const previous = validateDnaCoreRaceHistoryCoreCheckpoint(input.checkpoint);
  const receipt = validateDnaCoreRaceHistoryPageReceipt(input.receipt);
  if (previous.status !== "running") {
    acquisitionError("invalid_transition", "complete Core cannot advance");
  }
  if (
    receipt.cycleId !== previous.cycleId ||
    receipt.attemptNumber !== previous.attemptNumber ||
    receipt.coreId !== previous.coreId ||
    receipt.pageNumber !== previous.nextPage
  ) {
    acquisitionError("authority_drift", "page receipt cursor drifted");
  }
  const completedPageCount = previous.completedPageCount + 1;
  const receiptChainSha256 = hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "receipt_chain",
    previous.receiptChainSha256,
    receipt.receiptSha256,
  ]);
  const counters = {
    sourceRowCount: previous.sourceRowCount + receipt.sourceRowCount,
    acceptedResultCount:
      previous.acceptedResultCount + receipt.acceptedResultCount,
    quarantineCount: previous.quarantineCount + receipt.quarantineCount,
    replayDuplicateCount:
      previous.replayDuplicateCount + receipt.replayDuplicateCount,
  };
  const completionSha256 = receipt.terminal
    ? hash([
        "dna_open_lab",
        "v1",
        DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
        "core_completion",
        previous.cycleId,
        previous.attemptNumber,
        previous.coreId,
        previous.coreOrdinal,
        completedPageCount,
        counters.sourceRowCount,
        counters.acceptedResultCount,
        counters.quarantineCount,
        counters.replayDuplicateCount,
        receiptChainSha256,
      ])
    : null;
  return validateDnaCoreRaceHistoryCoreCheckpoint({
    ...previous,
    status: receipt.terminal ? "complete" : "running",
    nextPage: previous.nextPage + 1,
    completedPageCount,
    ...counters,
    receiptChainSha256,
    terminalPageNumber: receipt.terminal ? receipt.pageNumber : null,
    completionSha256,
  });
}

export function completeDnaCoreRaceHistoryAcquisitionCycle(input: {
  cycle: DnaCoreRaceHistoryAcquisitionCycle;
  checkpoints: readonly DnaCoreRaceHistoryCoreCheckpoint[];
  completedAt: string;
}): DnaCoreRaceHistoryAcquisitionCycle {
  const previous = validateDnaCoreRaceHistoryAcquisitionCycle(input.cycle);
  if (previous.status !== "running") {
    acquisitionError(
      "invalid_transition",
      "only a running attempt can complete",
    );
  }
  const checkpoints = input.checkpoints
    .map(validateDnaCoreRaceHistoryCoreCheckpoint)
    .sort((left, right) => left.coreOrdinal - right.coreOrdinal);
  if (
    checkpoints.length !== previous.coreIds.length ||
    checkpoints.some(
      (checkpoint, index) =>
        checkpoint.status !== "complete" ||
        checkpoint.cycleId !== previous.cycleId ||
        checkpoint.attemptNumber !== previous.attemptNumber ||
        checkpoint.coreId !== previous.coreIds[index] ||
        checkpoint.coreOrdinal !== index + 1 ||
        checkpoint.completionSha256 === null,
    )
  ) {
    acquisitionError(
      "authority_drift",
      "cycle completion lacks exact Core coverage",
    );
  }
  const totals = checkpoints.reduce(
    (result, checkpoint) => ({
      pageReceiptCount: result.pageReceiptCount + checkpoint.completedPageCount,
      sourceRowCount: result.sourceRowCount + checkpoint.sourceRowCount,
      acceptedResultCount:
        result.acceptedResultCount + checkpoint.acceptedResultCount,
      quarantineCount: result.quarantineCount + checkpoint.quarantineCount,
      replayDuplicateCount:
        result.replayDuplicateCount + checkpoint.replayDuplicateCount,
    }),
    {
      pageReceiptCount: 0,
      sourceRowCount: 0,
      acceptedResultCount: 0,
      quarantineCount: 0,
      replayDuplicateCount: 0,
    },
  );
  const coreCompletionSetSha256 = hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "core_completion_set",
    ...checkpoints.map((checkpoint) => checkpoint.completionSha256!),
  ]);
  const completedAt = timestamp(input.completedAt, "completedAt");
  const completionSha256 = hash([
    "dna_open_lab",
    "v1",
    DNA_CORE_RACE_HISTORY_SOURCE_FAMILY,
    "completion",
    previous.cycleId,
    previous.attemptId,
    completedAt,
    checkpoints.length,
    totals.pageReceiptCount,
    totals.sourceRowCount,
    totals.acceptedResultCount,
    totals.quarantineCount,
    totals.replayDuplicateCount,
    coreCompletionSetSha256,
  ]);
  const next = validateDnaCoreRaceHistoryAcquisitionCycle({
    ...previous,
    status: "complete",
    completion: {
      completedAt,
      completedCoreCount: checkpoints.length,
      ...totals,
      coreCompletionSetSha256,
      completionSha256,
    },
  });
  assertDnaCoreRaceHistoryCycleTransition(previous, next);
  return next;
}
