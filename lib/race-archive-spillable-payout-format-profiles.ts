import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveCorePayoutFormatProfile } from "./race-archive-core-payout-format-profiles";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type SpillableRaceArchivePayoutFormatProfileSource = Readonly<{
  inputObservationCount: number;
  acceptedFormatEntryCount: number;
  initialRunCount: number;
  readProfiles: () => AsyncIterable<RaceArchiveCorePayoutFormatProfile>;
  cleanup: () => Promise<void>;
}>;

type NormalizedPayoutFormat = Readonly<{ key: string; label: string }>;
type CommonObservation = Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  naturalKey: string;
  format: NormalizedPayoutFormat | null;
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

function normalizedTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function payoutFormat(value: string | null): NormalizedPayoutFormat | null {
  if (value === null) return null;
  const label = value.trim().replace(/\s+/gu, " ");
  if (
    label.length < 1 ||
    label.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(label)
  ) {
    throw new Error("Archived payout-format label is invalid.");
  }
  return Object.freeze({ key: label.toLowerCase(), label });
}

function validateCommonObservation(
  value: RaceArchiveCoreAnalyticalObservation,
): CommonObservation {
  const naturalKey = safeText(value.naturalKey, "observation.naturalKey");
  if (!RACE_MODES.has(value.mode)) {
    throw new Error("Archive payout-format mode is invalid.");
  }
  return Object.freeze({
    observation: value,
    naturalKey,
    format: payoutFormat(value.payoutMechanismSourceValue),
  });
}

function validateAcceptedObservation(
  value: RaceArchiveCoreAnalyticalObservation,
  common = validateCommonObservation(value),
): Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  naturalKey: string;
  format: NormalizedPayoutFormat;
  sourceCoreId: string;
  eventAt: string;
}> {
  if (common.format === null) {
    throw new Error(
      "Race archive payout-format accepted evidence lost its format.",
    );
  }
  const sourceCoreId = safeText(
    value.sourceCoreId,
    "observation.sourceCoreId",
    256,
  );
  positiveSafeInteger(value.distance, "observation.distance");
  positiveSafeInteger(value.finishPosition, "observation.finishPosition");
  positiveSafeInteger(
    value.elapsedMilliseconds,
    "observation.elapsedMilliseconds",
  );
  const eventAt = normalizedTimestamp(value.eventAt, "observation.eventAt");
  positiveSafeInteger(value.versionNumber, "observation.versionNumber");
  nonNegativeSafeInteger(value.partitionNumber, "observation.partitionNumber");
  positiveSafeInteger(value.sourceRowNumber, "observation.sourceRowNumber");
  return Object.freeze({
    observation: value,
    naturalKey: common.naturalKey,
    format: common.format,
    sourceCoreId,
    eventAt,
  });
}

function commonValidatedObservations(input: {
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  maximumObservations: number;
  onObservation: () => void;
}): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    let count = 0;
    for await (const observation of input.source) {
      count += 1;
      if (count > input.maximumObservations) {
        throw new Error(
          "Archive payout-format observation bound was exceeded.",
        );
      }
      input.onObservation();
      validateCommonObservation(observation);
      yield observation;
    }
  })();
}

function naturalKeyOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  return validateCommonObservation(leftValue).naturalKey.localeCompare(
    validateCommonObservation(rightValue).naturalKey,
  );
}

function uniqueAcceptedObservations(
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>,
): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    let previousNaturalKey: string | null = null;
    for await (const observation of source) {
      const common = validateCommonObservation(observation);
      if (previousNaturalKey === common.naturalKey) {
        throw new Error(
          "Archive payout-format profiles contain duplicate Race evidence.",
        );
      }
      previousNaturalKey = common.naturalKey;
      if (common.format === null) continue;
      validateAcceptedObservation(observation, common);
      yield observation;
    }
  })();
}

function profileKey(value: RaceArchiveCoreAnalyticalObservation): string {
  const accepted = validateAcceptedObservation(value);
  return JSON.stringify([
    accepted.sourceCoreId,
    value.mode,
    accepted.format.key,
  ]);
}

function payoutProfileOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  const left = validateAcceptedObservation(leftValue);
  const right = validateAcceptedObservation(rightValue);
  return (
    left.sourceCoreId.localeCompare(right.sourceCoreId) ||
    leftValue.mode.localeCompare(rightValue.mode) ||
    left.format.key.localeCompare(right.format.key) ||
    leftValue.distance - rightValue.distance ||
    left.format.label.localeCompare(right.format.label) ||
    left.eventAt.localeCompare(right.eventAt) ||
    left.naturalKey.localeCompare(right.naturalKey) ||
    leftValue.versionNumber - rightValue.versionNumber ||
    leftValue.partitionNumber - rightValue.partitionNumber ||
    leftValue.sourceRowNumber - rightValue.sourceRowNumber ||
    leftValue.datasetVersionId.localeCompare(rightValue.datasetVersionId) ||
    leftValue.importBatchId.localeCompare(rightValue.importBatchId)
  );
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

function profilesFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>;
  refreshedAt: string;
  maximumProfiles: number;
}): AsyncIterable<RaceArchiveCorePayoutFormatProfile> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveCoreAnalyticalObservation> | null =
      null;
    let profileCount = 0;

    try {
      while (true) {
        const firstResult: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validateAcceptedObservation(firstResult.value);
        const expectedProfileKey = profileKey(first.observation);
        profileCount += 1;
        if (profileCount > input.maximumProfiles) {
          throw new Error("Archive payout-format profile bound was exceeded.");
        }

        let payoutFormatLabel = first.format.label;
        let firstEventAt = first.eventAt;
        let dataCurrentThrough = first.eventAt;
        let raceCount = 0;
        let winCount = 0;
        let topThreeCount = 0;
        let timedRaceCount = 0;
        let exactDistanceCount = 0;
        let previousDistance: number | null = null;
        let current: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          firstResult;

        while (!current.done) {
          const accepted = validateAcceptedObservation(current.value);
          if (profileKey(accepted.observation) !== expectedProfileKey) {
            carry = current;
            break;
          }
          if (accepted.format.label < payoutFormatLabel) {
            payoutFormatLabel = accepted.format.label;
          }
          if (accepted.eventAt < firstEventAt) firstEventAt = accepted.eventAt;
          if (accepted.eventAt > dataCurrentThrough) {
            dataCurrentThrough = accepted.eventAt;
          }
          raceCount += 1;
          timedRaceCount += 1;
          if (accepted.observation.finishPosition === 1) winCount += 1;
          if (accepted.observation.finishPosition <= 3) topThreeCount += 1;
          if (previousDistance !== accepted.observation.distance) {
            if (
              previousDistance !== null &&
              accepted.observation.distance < previousDistance
            ) {
              throw new Error(
                "Race archive payout-format distance evidence is not ordered.",
              );
            }
            exactDistanceCount += 1;
            previousDistance = accepted.observation.distance;
          }
          current = await iterator.next();
        }

        if (raceCount < 1 || exactDistanceCount < 1) {
          throw new Error(
            "Race archive payout-format profile coverage changed.",
          );
        }
        yield Object.freeze({
          sourceCoreId: first.sourceCoreId,
          mode: first.observation.mode,
          payoutFormatKey: first.format.key,
          payoutFormatLabel,
          dataCurrentThrough,
          firstEventAt,
          raceCount,
          winCount,
          topThreeCount,
          exactDistanceCount,
          timedRaceCount,
          refreshedAt: input.refreshedAt,
        }) satisfies RaceArchiveCorePayoutFormatProfile;
      }
    } finally {
      await closeIterator(iterator);
      await input.sorted.cleanup();
    }
  })();
}

export async function spillableCorePayoutFormatProfilesFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  refreshedAt: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumProfiles: number;
}): Promise<SpillableRaceArchivePayoutFormatProfileSource> {
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
  const refreshedAt = normalizedTimestamp(input.refreshedAt, "refreshedAt");
  const maximumRecordsInMemory = positiveBound(
    input.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    5_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    500_000,
  );

  let inputObservationCount = 0;
  const naturalKeySorted = await spillExactSortedRaceArchiveRecords({
    records: commonValidatedObservations({
      source: input.observations,
      maximumObservations,
      onObservation() {
        inputObservationCount += 1;
      },
    }),
    store: input.store,
    compare: naturalKeyOrder,
    runPrefix: `${runPrefix}/payout-natural-key-sort`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumObservations,
    maximumRunObjects,
  });
  if (naturalKeySorted.recordCount !== inputObservationCount) {
    await naturalKeySorted.cleanup();
    throw new Error("Archive payout-format observation coverage changed.");
  }

  let sorted:
    | RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>
    | undefined;
  try {
    sorted = await spillExactSortedRaceArchiveRecords({
      records: uniqueAcceptedObservations(naturalKeySorted.read()),
      store: input.store,
      compare: payoutProfileOrder,
      runPrefix: `${runPrefix}/payout-format-sort`,
      maximumRecordsInMemory,
      mergeFanIn,
      maximumInputRecords: maximumObservations,
      maximumRunObjects,
    });
    await naturalKeySorted.cleanup();
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    try {
      await naturalKeySorted.cleanup();
    } catch (cleanupError) {
      cleanupFailures.push(cleanupError);
    }
    if (sorted !== undefined) {
      try {
        await sorted.cleanup();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        "Race archive payout-format preparation failed and scratch cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }

  let readStarted = false;
  let cleaned = false;
  return Object.freeze({
    inputObservationCount,
    acceptedFormatEntryCount: sorted.recordCount,
    initialRunCount: sorted.initialRunCount,
    readProfiles() {
      if (cleaned) {
        throw new Error("Race archive payout-format source has been cleaned.");
      }
      if (readStarted) {
        throw new Error("Race archive payout-format profiles are single-use.");
      }
      readStarted = true;
      return profilesFromSorted({
        sorted,
        refreshedAt,
        maximumProfiles,
      });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) {
        throw new Error(
          "Race archive payout-format read owns scratch cleanup.",
        );
      }
      await sorted.cleanup();
      cleaned = true;
    },
  });
}
