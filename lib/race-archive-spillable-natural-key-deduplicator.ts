import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type SpillableRaceArchiveObservationDeduplication = Readonly<{
  inputObservationCount: number;
  initialRunCount: number;
  readUnique: () => AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
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

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function observationOrder(
  left: RaceArchiveCoreAnalyticalObservation,
  right: RaceArchiveCoreAnalyticalObservation,
): number {
  return (
    left.naturalKey.localeCompare(right.naturalKey) ||
    left.versionNumber - right.versionNumber ||
    left.partitionNumber - right.partitionNumber ||
    left.sourceRowNumber - right.sourceRowNumber ||
    left.datasetVersionId.localeCompare(right.datasetVersionId) ||
    left.importBatchId.localeCompare(right.importBatchId)
  );
}

function validateObservation(
  value: RaceArchiveCoreAnalyticalObservation,
): RaceArchiveCoreAnalyticalObservation {
  safeText(value.naturalKey, "naturalKey");
  fingerprint(value.fingerprintSha256);
  positiveSafeInteger(value.versionNumber, "versionNumber");
  nonNegativeSafeInteger(value.partitionNumber, "partitionNumber");
  positiveSafeInteger(value.sourceRowNumber, "sourceRowNumber");
  const sourceEventId = safeText(value.sourceEventId, "sourceEventId");
  const sourceCoreId = safeText(value.sourceCoreId, "sourceCoreId", 256);
  if (value.naturalKey !== `${sourceEventId}:${sourceCoreId}`) {
    throw new Error("Race archive observation natural key is inconsistent.");
  }
  return value;
}

function uniqueObservations(
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>,
): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    let previousNaturalKey: string | null = null;
    let previousFingerprint: string | null = null;
    try {
      for await (const candidate of sorted.read()) {
        const observation = validateObservation(candidate);
        if (observation.naturalKey === previousNaturalKey) {
          if (observation.fingerprintSha256 !== previousFingerprint) {
            throw new Error(
              "Race archive history contains conflicting replay evidence.",
            );
          }
          continue;
        }
        previousNaturalKey = observation.naturalKey;
        previousFingerprint = observation.fingerprintSha256;
        yield observation;
      }
    } finally {
      await sorted.cleanup();
    }
  })();
}

export async function spillAndDeduplicateRaceArchiveObservations(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumInputObservations: number;
  maximumRunObjects: number;
}): Promise<SpillableRaceArchiveObservationDeduplication> {
  const sorted = await spillExactSortedRaceArchiveRecords({
    records: input.observations,
    store: input.store,
    compare: observationOrder,
    runPrefix: input.runPrefix,
    maximumRecordsInMemory: input.maximumRecordsInMemory,
    mergeFanIn: input.mergeFanIn,
    maximumInputRecords: input.maximumInputObservations,
    maximumRunObjects: input.maximumRunObjects,
  });
  return Object.freeze({
    inputObservationCount: sorted.recordCount,
    initialRunCount: sorted.initialRunCount,
    readUnique: () => uniqueObservations(sorted),
    cleanup: sorted.cleanup,
  });
}
