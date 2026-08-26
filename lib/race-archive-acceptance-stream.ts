import type { DurablePreviewStagedRow } from "./durable-import-preview-staging-sink";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type RaceArchiveAcceptanceCandidate = Readonly<{
  naturalKey: string;
  fingerprintSha256: string;
  partitionNumber: number;
  sourceRowNumber: number;
  stagedRow: DurablePreviewStagedRow;
}>;

export type RaceArchiveAcceptanceGroup =
  | Readonly<{
      status: "accepted";
      naturalKey: string;
      fingerprintSha256: string;
      canonicalRow: DurablePreviewStagedRow;
      sourceRowCount: number;
      duplicateRowCount: number;
    }>
  | Readonly<{
      status: "fingerprint_conflict";
      naturalKey: string;
      sourceRowCount: number;
      distinctFingerprintCount: number;
    }>;

export type SpillableRaceArchiveAcceptanceStream = Readonly<{
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  initialRunCount: number;
  readGroups: () => AsyncIterable<RaceArchiveAcceptanceGroup>;
  cleanup: () => Promise<void>;
}>;

function safeText(value: string, field: string, maximumLength = 512): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function fingerprint(value: string): string {
  const normalized = safeText(value, "fingerprintSha256", 64);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error("fingerprintSha256 must be a lowercase SHA-256 digest");
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function candidateOrder(
  left: RaceArchiveAcceptanceCandidate,
  right: RaceArchiveAcceptanceCandidate,
): number {
  return (
    left.naturalKey.localeCompare(right.naturalKey) ||
    left.fingerprintSha256.localeCompare(right.fingerprintSha256) ||
    left.sourceRowNumber - right.sourceRowNumber ||
    left.partitionNumber - right.partitionNumber
  );
}

function validateCandidate(
  value: RaceArchiveAcceptanceCandidate,
): RaceArchiveAcceptanceCandidate {
  const naturalKey = safeText(value.naturalKey, "naturalKey");
  const fingerprintSha256 = fingerprint(value.fingerprintSha256);
  positiveSafeInteger(value.sourceRowNumber, "sourceRowNumber");
  nonNegativeSafeInteger(value.partitionNumber, "partitionNumber");
  if (
    value.stagedRow.sourceRowNumber !== value.sourceRowNumber ||
    value.stagedRow.naturalKey !== naturalKey ||
    value.stagedRow.fingerprintSha256 !== fingerprintSha256 ||
    value.stagedRow.row.status !== "ready"
  ) {
    throw new Error("Race archive acceptance candidate is inconsistent.");
  }
  return value;
}

function classifiedGroups(
  sorted: RaceArchiveExternalSortedResult<RaceArchiveAcceptanceCandidate>,
): AsyncIterable<RaceArchiveAcceptanceGroup> {
  return (async function* () {
    let naturalKey: string | null = null;
    let firstFingerprint: string | null = null;
    let previousFingerprint: string | null = null;
    let canonicalRow: DurablePreviewStagedRow | null = null;
    let sourceRowCount = 0;
    let distinctFingerprintCount = 0;

    const group = (): RaceArchiveAcceptanceGroup | null => {
      if (
        naturalKey === null ||
        firstFingerprint === null ||
        canonicalRow === null ||
        sourceRowCount < 1 ||
        distinctFingerprintCount < 1
      ) {
        return null;
      }
      if (distinctFingerprintCount === 1) {
        return Object.freeze({
          status: "accepted" as const,
          naturalKey,
          fingerprintSha256: firstFingerprint,
          canonicalRow,
          sourceRowCount,
          duplicateRowCount: sourceRowCount - 1,
        });
      }
      return Object.freeze({
        status: "fingerprint_conflict" as const,
        naturalKey,
        sourceRowCount,
        distinctFingerprintCount,
      });
    };

    try {
      for await (const raw of sorted.read()) {
        const candidate = validateCandidate(raw);
        if (candidate.naturalKey !== naturalKey) {
          const completed = group();
          if (completed !== null) yield completed;
          naturalKey = candidate.naturalKey;
          firstFingerprint = candidate.fingerprintSha256;
          previousFingerprint = candidate.fingerprintSha256;
          canonicalRow = candidate.stagedRow;
          sourceRowCount = 1;
          distinctFingerprintCount = 1;
          continue;
        }

        sourceRowCount += 1;
        if (candidate.fingerprintSha256 !== previousFingerprint) {
          distinctFingerprintCount += 1;
          previousFingerprint = candidate.fingerprintSha256;
        }
      }
      const completed = group();
      if (completed !== null) yield completed;
    } finally {
      await sorted.cleanup();
    }
  })();
}

export async function prepareSpillableRaceArchiveAcceptanceStream(input: {
  ownerId: string;
  datasetVersionId: string;
  rehydrator: RaceStagedRowRehydrator;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveAcceptanceCandidate>;
  runPrefix: string;
  maximumArchivePartitions: number;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumSourceRows: number;
  maximumRunObjects: number;
}): Promise<SpillableRaceArchiveAcceptanceStream> {
  const ownerId = safeText(input.ownerId, "ownerId", 128);
  const datasetVersionId = safeText(
    input.datasetVersionId,
    "datasetVersionId",
    128,
  );
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions,
    "maximumArchivePartitions",
    10_000,
  );
  const maximumSourceRows = positiveBound(
    input.maximumSourceRows,
    "maximumSourceRows",
    100_000_000,
  );

  const opened = await input.rehydrator.open({
    ownerId,
    datasetVersionId,
    maximumPartitions: maximumArchivePartitions,
  });
  if (opened.status === "missing") {
    throw new Error("Race archive acceptance evidence is unavailable.");
  }
  if (opened.manifest.rowCount > maximumSourceRows) {
    throw new Error("Race archive acceptance source-row bound was exceeded.");
  }

  let sourceRowCount = 0;
  let readyRowCount = 0;
  let quarantinedRowCount = 0;

  const candidates = (async function* () {
    for await (const rehydrated of opened.rows) {
      sourceRowCount += 1;
      if (sourceRowCount > maximumSourceRows) {
        throw new Error(
          "Race archive acceptance source-row bound was exceeded.",
        );
      }
      const stagedRow = rehydrated.stagedRow;
      if (stagedRow.row.status === "quarantined") {
        quarantinedRowCount += 1;
        continue;
      }
      if (
        stagedRow.naturalKey === null ||
        stagedRow.fingerprintSha256 === null
      ) {
        throw new Error("Ready Race archive row is missing identity evidence.");
      }
      readyRowCount += 1;
      yield Object.freeze({
        naturalKey: safeText(stagedRow.naturalKey, "naturalKey"),
        fingerprintSha256: fingerprint(stagedRow.fingerprintSha256),
        partitionNumber: nonNegativeSafeInteger(
          rehydrated.partitionNumber,
          "partitionNumber",
        ),
        sourceRowNumber: positiveSafeInteger(
          stagedRow.sourceRowNumber,
          "sourceRowNumber",
        ),
        stagedRow,
      });
    }
  })();

  const sorted = await spillExactSortedRaceArchiveRecords({
    records: candidates,
    store: input.store,
    compare: candidateOrder,
    runPrefix,
    maximumRecordsInMemory: input.maximumRecordsInMemory,
    mergeFanIn: input.mergeFanIn,
    maximumInputRecords: maximumSourceRows,
    maximumRunObjects: input.maximumRunObjects,
  });

  if (
    sourceRowCount !== opened.manifest.rowCount ||
    readyRowCount + quarantinedRowCount !== sourceRowCount ||
    sorted.recordCount !== readyRowCount
  ) {
    await sorted.cleanup();
    throw new Error("Race archive acceptance coverage changed.");
  }

  return Object.freeze({
    sourceRowCount,
    readyRowCount,
    quarantinedRowCount,
    initialRunCount: sorted.initialRunCount,
    readGroups: () => classifiedGroups(sorted),
    cleanup: sorted.cleanup,
  });
}
