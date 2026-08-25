import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveCorePerformanceProfile } from "./race-archive-core-performance-profiles";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";
import { exactSortedRaceArchiveStatistics } from "./race-archive-exact-sorted-statistics";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type SpillableRaceArchiveCorePerformanceSource = Readonly<{
  inputObservationCount: number;
  initialRunCount: number;
  readProfiles: () => AsyncIterable<RaceArchiveCorePerformanceProfile>;
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

function validatedObservation(
  value: RaceArchiveCoreAnalyticalObservation,
): RaceArchiveCoreAnalyticalObservation {
  const sourceCoreId = safeText(value.sourceCoreId, "observation.sourceCoreId", 256);
  const sourceEventId = safeText(value.sourceEventId, "observation.sourceEventId");
  const naturalKey = safeText(value.naturalKey, "observation.naturalKey");
  if (naturalKey !== `${sourceEventId}:${sourceCoreId}`) {
    throw new Error("Race archive Core Performance natural key is inconsistent.");
  }
  if (!RACE_MODES.has(value.mode)) {
    throw new Error("Race archive Core Performance mode is invalid.");
  }
  positiveSafeInteger(value.distance, "observation.distance");
  positiveSafeInteger(value.elapsedMilliseconds, "observation.elapsedMilliseconds");
  normalizedTimestamp(value.eventAt, "observation.eventAt");
  positiveSafeInteger(value.versionNumber, "observation.versionNumber");
  nonNegativeSafeInteger(value.partitionNumber, "observation.partitionNumber");
  positiveSafeInteger(value.sourceRowNumber, "observation.sourceRowNumber");
  return value;
}

function profileGroupKey(value: RaceArchiveCoreAnalyticalObservation): string {
  return `${value.sourceCoreId}\u0000${value.mode}\u0000${value.distance}`;
}

function profileOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  const left = validatedObservation(leftValue);
  const right = validatedObservation(rightValue);
  return (
    left.sourceCoreId.localeCompare(right.sourceCoreId) ||
    left.mode.localeCompare(right.mode) ||
    left.distance - right.distance ||
    left.elapsedMilliseconds - right.elapsedMilliseconds ||
    left.eventAt.localeCompare(right.eventAt) ||
    left.naturalKey.localeCompare(right.naturalKey) ||
    left.versionNumber - right.versionNumber ||
    left.partitionNumber - right.partitionNumber ||
    left.sourceRowNumber - right.sourceRowNumber ||
    left.datasetVersionId.localeCompare(right.datasetVersionId) ||
    left.importBatchId.localeCompare(right.importBatchId)
  );
}

function elapsedValues(
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>,
  runId: string,
): AsyncIterable<number> {
  return (async function* () {
    for await (const observation of store.readRun({ runId })) {
      yield validatedObservation(observation).elapsedMilliseconds;
    }
  })();
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

function profilesFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  groupRunPrefix: string;
  maximumProfiles: number;
  maximumObservations: number;
}): AsyncIterable<RaceArchiveCorePerformanceProfile> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveCoreAnalyticalObservation> | null = null;
    let activeGroupRunId: string | null = null;
    let profileCount = 0;

    try {
      while (true) {
        const firstResult = carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validatedObservation(firstResult.value);
        const groupKey = profileGroupKey(first);
        profileCount += 1;
        if (profileCount > input.maximumProfiles) {
          throw new Error("Race archive Core Performance profile bound was exceeded.");
        }

        const groupRunId = `${input.groupRunPrefix}/group-${String(profileCount).padStart(8, "0")}`;
        activeGroupRunId = groupRunId;
        let groupCount = 0;
        let dataCurrentThrough: string | null = null;

        const groupRecords = (async function* () {
          let current: IteratorResult<RaceArchiveCoreAnalyticalObservation> = firstResult;
          while (!current.done) {
            const observation = validatedObservation(current.value);
            if (profileGroupKey(observation) !== groupKey) {
              carry = current;
              return;
            }
            groupCount += 1;
            if (groupCount > input.maximumObservations) {
              throw new Error("Race archive Core Performance observation bound was exceeded.");
            }
            const eventAt = normalizedTimestamp(
              observation.eventAt,
              "observation.eventAt",
            );
            if (dataCurrentThrough === null || eventAt > dataCurrentThrough) {
              dataCurrentThrough = eventAt;
            }
            yield observation;
            current = await iterator.next();
          }
          carry = current;
        })();

        await input.store.writeRun({ runId: groupRunId, records: groupRecords });
        if (groupCount < 1 || dataCurrentThrough === null) {
          throw new Error("Race archive Core Performance group coverage changed.");
        }
        const statistics = await exactSortedRaceArchiveStatistics({
          readValues: () => elapsedValues(input.store, groupRunId),
          expectedCount: groupCount,
          maximumValues: input.maximumObservations,
        });
        if (statistics.count !== groupCount) {
          throw new Error("Race archive Core Performance statistics coverage changed.");
        }

        const profile = Object.freeze({
          sourceCoreId: first.sourceCoreId,
          mode: first.mode,
          distance: first.distance,
          dataCurrentThrough,
          raceCount: groupCount,
          bestMilliseconds: statistics.best,
          medianMilliseconds: statistics.median,
          meanMilliseconds: statistics.mean,
          trimmedMeanMilliseconds: statistics.trimmedMean,
          standardDeviationMilliseconds: statistics.populationStandardDeviation,
          interquartileRangeMilliseconds: statistics.interquartileRange,
          bestMetresPerSecond: first.distance / (statistics.best / 1000),
          medianMetresPerSecond: first.distance / (statistics.median / 1000),
        }) satisfies RaceArchiveCorePerformanceProfile;

        await input.store.deleteRun({ runId: groupRunId });
        activeGroupRunId = null;
        yield profile;
      }
    } finally {
      await closeIterator(iterator);
      if (activeGroupRunId !== null) {
        await input.store.deleteRun({ runId: activeGroupRunId });
      }
      await input.sorted.cleanup();
    }
  })();
}

export async function spillableCorePerformanceProfilesFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumProfiles: number;
}): Promise<SpillableRaceArchiveCorePerformanceSource> {
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
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
    100_000_000,
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

  const sorted = await spillExactSortedRaceArchiveRecords({
    records: input.observations,
    store: input.store,
    compare: profileOrder,
    runPrefix: `${runPrefix}/core-performance-sort`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumObservations,
    maximumRunObjects,
  });
  let readStarted = false;
  let cleaned = false;

  return Object.freeze({
    inputObservationCount: sorted.recordCount,
    initialRunCount: sorted.initialRunCount,
    readProfiles() {
      if (cleaned) {
        throw new Error("Race archive Core Performance source has been cleaned.");
      }
      if (readStarted) {
        throw new Error("Race archive Core Performance profiles are single-use.");
      }
      readStarted = true;
      return profilesFromSorted({
        sorted,
        store: input.store,
        groupRunPrefix: `${runPrefix}/core-performance-values`,
        maximumProfiles,
        maximumObservations,
      });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) {
        throw new Error("Race archive Core Performance read owns scratch cleanup.");
      }
      await sorted.cleanup();
      cleaned = true;
    },
  });
}
