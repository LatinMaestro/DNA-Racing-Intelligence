import {
  createDnaCurrentStateAcquisitionSchedule,
  DNA_CURRENT_STATE_ACQUISITION_GROUPS,
  type DnaCurrentStateAcquisitionGroup,
  type DnaCurrentStateAcquisitionSchedule,
  type DnaScheduledCurrentStateRequest,
} from "./dna-open-lab-current-state-acquisition-cadence";
import {
  validateDnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionCycleCheckpoint,
  type DnaCurrentStateAcquisitionEvidenceReceipt,
} from "./dna-open-lab-current-state-acquisition-runner";
import type { DnaCurrentStateSyncPlan } from "./dna-open-lab-current-state-sync-plan";
import { dnaOpenLabRawEvidenceSha256 } from "./dna-open-lab-v1-adapters";

export const DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION = 1 as const;

export type DnaCurrentStateIndexedEvidenceReceipt = Readonly<{
  group: DnaCurrentStateAcquisitionGroup;
  requestKey: string;
  cycleId: string;
  observedAt: string;
  contentSha256: string;
  evidenceObjectKey: string;
}>;

export type DnaCurrentStateEvidenceIndex = Readonly<{
  version: typeof DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION;
  generationId: string;
  planSha256: string;
  indexedAt: string;
  receipts: readonly DnaCurrentStateIndexedEvidenceReceipt[];
}>;

/** Validates the self-contained storage contract without weakening plan authority. */
export function validateDnaCurrentStateEvidenceIndexDocument(input: {
  index: DnaCurrentStateEvidenceIndex;
  validatedAt: string;
}): DnaCurrentStateEvidenceIndex {
  const validatedAt = timestamp(input.validatedAt, "validatedAt");
  if (input.index.version !== DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION) {
    indexError("index version is invalid");
  }
  const generationId = uuid(input.index.generationId, "generationId");
  const indexedAt = timestamp(input.index.indexedAt, "indexedAt");
  if (Date.parse(indexedAt) > Date.parse(validatedAt)) {
    indexError("indexedAt cannot follow validation time");
  }
  const plan = sha256(input.index.planSha256, "planSha256");
  if (input.index.receipts.length < 1 || input.index.receipts.length > 512) {
    indexError("receipt count is invalid");
  }
  const receipts = input.index.receipts.map((value) => {
    if (!DNA_CURRENT_STATE_ACQUISITION_GROUPS.includes(value.group)) {
      indexError("receipt group is invalid");
    }
    return indexedReceipt({
      group: value.group,
      cycleId: value.cycleId,
      receipt: value,
      maximumObservedAt: indexedAt,
    });
  });
  if (
    new Set(receipts.map((value) => value.requestKey)).size !== receipts.length
  ) {
    indexError("index repeats a logical request receipt");
  }
  return Object.freeze({
    version: DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION,
    generationId,
    planSha256: plan,
    indexedAt,
    receipts: Object.freeze(receipts),
  });
}

const SHA_256_PATTERN = /^[a-f0-9]{64}$/u;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/iu;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function indexError(message: string): never {
  throw new Error(`DNA Open Lab current-state evidence index: ${message}`);
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    indexError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return new Date(normalized).toISOString();
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized)) indexError(`${field} is invalid`);
  return normalized;
}

function sha256(value: string, field: string): string {
  const normalized = value.trim();
  if (!SHA_256_PATTERN.test(normalized)) indexError(`${field} is invalid`);
  return normalized;
}

function objectKey(value: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 4096 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    indexError("evidenceObjectKey is invalid");
  }
  return normalized;
}

function requestKey(entry: DnaScheduledCurrentStateRequest): string {
  return dnaOpenLabRawEvidenceSha256({
    group: entry.group,
    request: entry.request,
  });
}

function fullEntries(input: {
  plan: DnaCurrentStateSyncPlan;
  evaluatedAt: string;
}): readonly DnaScheduledCurrentStateRequest[] {
  return Object.freeze(
    createDnaCurrentStateAcquisitionSchedule({
      evaluatedAt: input.evaluatedAt,
      plan: input.plan,
    }).requestBatches.flat(),
  );
}

function planSha256(
  entries: readonly DnaScheduledCurrentStateRequest[],
): string {
  return dnaOpenLabRawEvidenceSha256({ requests: entries });
}

function indexedReceipt(input: {
  group: DnaCurrentStateAcquisitionGroup;
  cycleId: string;
  receipt: DnaCurrentStateAcquisitionEvidenceReceipt;
  maximumObservedAt: string;
}): DnaCurrentStateIndexedEvidenceReceipt {
  const observedAt = timestamp(input.receipt.observedAt, "receipt.observedAt");
  if (Date.parse(observedAt) > Date.parse(input.maximumObservedAt)) {
    indexError("receipt observation cannot follow indexedAt");
  }
  return Object.freeze({
    group: input.group,
    requestKey: sha256(input.receipt.requestKey, "receipt.requestKey"),
    cycleId: uuid(input.cycleId, "receipt.cycleId"),
    observedAt,
    contentSha256: sha256(input.receipt.contentSha256, "receipt.contentSha256"),
    evidenceObjectKey: objectKey(input.receipt.evidenceObjectKey),
  });
}

function validateDocumentReceipt(input: {
  value: DnaCurrentStateIndexedEvidenceReceipt;
  expected: DnaScheduledCurrentStateRequest;
  indexedAt: string;
}): DnaCurrentStateIndexedEvidenceReceipt {
  if (
    !DNA_CURRENT_STATE_ACQUISITION_GROUPS.includes(input.value.group) ||
    input.value.group !== input.expected.group ||
    input.value.requestKey !== requestKey(input.expected)
  ) {
    indexError("indexed receipt does not match plan authority");
  }
  return indexedReceipt({
    group: input.value.group,
    cycleId: input.value.cycleId,
    receipt: input.value,
    maximumObservedAt: input.indexedAt,
  });
}

/** Validates a compact persisted receipt index against its exact full plan. */
export function validateDnaCurrentStateEvidenceIndex(input: {
  index: DnaCurrentStateEvidenceIndex;
  plan: DnaCurrentStateSyncPlan;
  validatedAt: string;
}): DnaCurrentStateEvidenceIndex {
  const document = validateDnaCurrentStateEvidenceIndexDocument(input);
  const { generationId, indexedAt } = document;
  const expected = fullEntries({ plan: input.plan, evaluatedAt: indexedAt });
  const expectedPlanSha256 = planSha256(expected);
  if (
    document.planSha256 !== expectedPlanSha256 ||
    document.receipts.length !== expected.length
  ) {
    indexError("index plan coverage is invalid");
  }
  const receipts = document.receipts.map((value, offset) =>
    validateDocumentReceipt({
      value,
      expected: expected[offset]!,
      indexedAt,
    }),
  );
  if (
    new Set(receipts.map((value) => value.requestKey)).size !== receipts.length
  ) {
    indexError("index repeats a logical request receipt");
  }
  return Object.freeze({
    version: DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION,
    generationId,
    planSha256: expectedPlanSha256,
    indexedAt,
    receipts: Object.freeze(receipts),
  });
}

/**
 * Rebuilds the exact full-plan receipt index for the next candidate generation.
 * Due-group receipts must come from the ready current cycle; non-due receipts
 * must come from the prior validated last-good index. A freshness timestamp is
 * never accepted as a substitute for receipt identity.
 */
export function createDnaCurrentStateEvidenceIndex(input: {
  plan: DnaCurrentStateSyncPlan;
  schedule: DnaCurrentStateAcquisitionSchedule;
  checkpoint: DnaCurrentStateAcquisitionCycleCheckpoint;
  prior: DnaCurrentStateEvidenceIndex | null;
  indexedAt: string;
}): DnaCurrentStateEvidenceIndex {
  const indexedAt = timestamp(input.indexedAt, "indexedAt");
  if (
    input.schedule.status !== "ready" ||
    input.schedule.completionScope !== "all_current_state"
  ) {
    indexError("schedule is not a ready current-state acquisition");
  }
  const expected = fullEntries({
    plan: input.plan,
    evaluatedAt: input.schedule.evaluatedAt,
  });
  const due = new Set(input.schedule.dueGroups);
  const expectedCurrent = expected.filter((entry) => due.has(entry.group));
  const scheduled = input.schedule.requestBatches.flat();
  if (
    scheduled.length !== input.schedule.scheduledRequestCount ||
    JSON.stringify(scheduled.map(requestKey)) !==
      JSON.stringify(expectedCurrent.map(requestKey))
  ) {
    indexError("schedule does not match the plan's due-group requests");
  }
  const checkpoint = validateDnaCurrentStateAcquisitionCycleCheckpoint({
    checkpoint: input.checkpoint,
    cycleId: input.checkpoint.cycleId,
    schedule: input.schedule,
    validatedAt: indexedAt,
  });
  if (checkpoint.status !== "ready_to_publish") {
    indexError("checkpoint is not ready to publish");
  }

  const prior =
    input.prior === null
      ? null
      : validateDnaCurrentStateEvidenceIndex({
          index: input.prior,
          plan: input.plan,
          validatedAt: indexedAt,
        });
  if (
    prior === null &&
    input.schedule.dueGroups.length !==
      DNA_CURRENT_STATE_ACQUISITION_GROUPS.length
  ) {
    indexError("a staggered cycle requires a prior last-good receipt index");
  }

  const currentByKey = new Map(
    checkpoint.receipts.map((receipt) => [receipt.requestKey, receipt]),
  );
  const priorByKey = new Map(
    (prior?.receipts ?? []).map((receipt) => [receipt.requestKey, receipt]),
  );
  const receipts = expected.map((entry) => {
    const key = requestKey(entry);
    if (due.has(entry.group)) {
      const current = currentByKey.get(key);
      if (current === undefined) {
        return indexError("a due-group receipt is unavailable");
      }
      return indexedReceipt({
        group: entry.group,
        cycleId: checkpoint.cycleId,
        receipt: current,
        maximumObservedAt: indexedAt,
      });
    }
    const cached = priorByKey.get(key);
    if (cached === undefined) {
      return indexError("a non-due cached receipt is unavailable");
    }
    return validateDocumentReceipt({
      value: cached,
      expected: entry,
      indexedAt,
    });
  });

  return Object.freeze({
    version: DNA_CURRENT_STATE_EVIDENCE_INDEX_VERSION,
    generationId: uuid(checkpoint.cycleId, "generationId"),
    planSha256: planSha256(expected),
    indexedAt,
    receipts: Object.freeze(receipts),
  });
}
