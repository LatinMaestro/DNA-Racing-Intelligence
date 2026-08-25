import type { DiscoveryExactDistanceBenchmarkEvidence } from "@/domain/discovery-benchmark";
import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";
import { exactSortedRaceArchiveStatistics } from "./race-archive-exact-sorted-statistics";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type SpillableRaceArchiveDiscoveryBenchmarkSource = Readonly<{
  inputObservationCount: number;
  initialRunCount: number;
  readBenchmarks: () => AsyncIterable<DiscoveryExactDistanceBenchmarkEvidence>;
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
  const sourceCoreId = safeText(
    value.sourceCoreId,
    "observation.sourceCoreId",
    256,
  );
  const sourceEventId = safeText(
    value.sourceEventId,
    "observation.sourceEventId",
  );
  const naturalKey = safeText(value.naturalKey, "observation.naturalKey");
  if (naturalKey !== `${sourceEventId}:${sourceCoreId}`) {
    throw new Error("Race archive Discovery natural key is inconsistent.");
  }
  if (!RACE_MODES.has(value.mode)) {
    throw new Error("Race archive Discovery mode is invalid.");
  }
  positiveSafeInteger(value.distance, "observation.distance");
  positiveSafeInteger(value.finishPosition, "observation.finishPosition");
  positiveSafeInteger(
    value.elapsedMilliseconds,
    "observation.elapsedMilliseconds",
  );
  normalizedTimestamp(value.eventAt, "observation.eventAt");
  positiveSafeInteger(value.versionNumber, "observation.versionNumber");
  nonNegativeSafeInteger(value.partitionNumber, "observation.partitionNumber");
  positiveSafeInteger(value.sourceRowNumber, "observation.sourceRowNumber");
  return value;
}

function validatedObservations(
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>,
): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    for await (const observation of source) {
      yield validatedObservation(observation);
    }
  })();
}

function groupKey(value: RaceArchiveCoreAnalyticalObservation): string {
  return `${value.mode}\u0000${value.distance}`;
}

function discoveryOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  const left = validatedObservation(leftValue);
  const right = validatedObservation(rightValue);
  return (
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

function qualifyingElapsedValues(input: {
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runId: string;
  maximumFinishPosition: number;
}): AsyncIterable<number> {
  return (async function* () {
    for await (const raw of input.store.readRun({ runId: input.runId })) {
      const observation = validatedObservation(raw);
      if (observation.finishPosition <= input.maximumFinishPosition) {
        yield observation.elapsedMilliseconds;
      }
    }
  })();
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

function benchmarksFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  groupRunPrefix: string;
  refreshedAt: string;
  maximumBenchmarks: number;
  maximumObservations: number;
}): AsyncIterable<DiscoveryExactDistanceBenchmarkEvidence> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveCoreAnalyticalObservation> | null =
      null;
    let activeGroupRunId: string | null = null;
    let groupSequence = 0;
    let benchmarkCount = 0;

    try {
      while (true) {
        const firstResult = carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validatedObservation(firstResult.value);
        const expectedGroupKey = groupKey(first);
        groupSequence += 1;
        const groupRunId = `${input.groupRunPrefix}/group-${String(groupSequence).padStart(8, "0")}`;
        activeGroupRunId = groupRunId;
        let raceEntryCount = 0;
        let winningEntryCount = 0;
        let topThreeEntryCount = 0;
        let dataCurrentThrough: string | null = null;

        const groupRecords = (async function* () {
          let current: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
            firstResult;
          while (!current.done) {
            const observation = validatedObservation(current.value);
            if (groupKey(observation) !== expectedGroupKey) {
              carry = current;
              return;
            }
            raceEntryCount += 1;
            if (raceEntryCount > input.maximumObservations) {
              throw new Error(
                "Race archive Discovery observation bound was exceeded.",
              );
            }
            if (observation.finishPosition === 1) winningEntryCount += 1;
            if (observation.finishPosition <= 3) topThreeEntryCount += 1;
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

        await input.store.writeRun({
          runId: groupRunId,
          records: groupRecords,
        });
        if (raceEntryCount < 1 || dataCurrentThrough === null) {
          throw new Error("Race archive Discovery group coverage changed.");
        }
        if (winningEntryCount === 0 || topThreeEntryCount === 0) {
          await input.store.deleteRun({ runId: groupRunId });
          activeGroupRunId = null;
          continue;
        }

        benchmarkCount += 1;
        if (benchmarkCount > input.maximumBenchmarks) {
          throw new Error(
            "Race archive Discovery benchmark bound was exceeded.",
          );
        }
        const winning = await exactSortedRaceArchiveStatistics({
          readValues: () =>
            qualifyingElapsedValues({
              store: input.store,
              runId: groupRunId,
              maximumFinishPosition: 1,
            }),
          expectedCount: winningEntryCount,
          maximumValues: input.maximumObservations,
        });
        const topThree = await exactSortedRaceArchiveStatistics({
          readValues: () =>
            qualifyingElapsedValues({
              store: input.store,
              runId: groupRunId,
              maximumFinishPosition: 3,
            }),
          expectedCount: topThreeEntryCount,
          maximumValues: input.maximumObservations,
        });

        const benchmark = Object.freeze({
          mode: first.mode,
          distanceMetres: first.distance,
          dataCurrentThrough,
          raceEntryCount,
          winningEntryCount,
          topThreeEntryCount,
          winningP25Milliseconds: winning.p25,
          winningMedianMilliseconds: winning.median,
          winningP75Milliseconds: winning.p75,
          topThreeP25Milliseconds: topThree.p25,
          topThreeMedianMilliseconds: topThree.median,
          topThreeP75Milliseconds: topThree.p75,
          refreshedAt: input.refreshedAt,
        }) satisfies DiscoveryExactDistanceBenchmarkEvidence;

        await input.store.deleteRun({ runId: groupRunId });
        activeGroupRunId = null;
        yield benchmark;
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

export async function spillableDiscoveryExactDistanceBenchmarksFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  refreshedAt: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumBenchmarks: number;
}): Promise<SpillableRaceArchiveDiscoveryBenchmarkSource> {
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
  const maximumBenchmarks = positiveBound(
    input.maximumBenchmarks,
    "maximumBenchmarks",
    100_000,
  );

  const sorted = await spillExactSortedRaceArchiveRecords({
    records: validatedObservations(input.observations),
    store: input.store,
    compare: discoveryOrder,
    runPrefix: `${runPrefix}/discovery-sort`,
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
    readBenchmarks() {
      if (cleaned) {
        throw new Error("Race archive Discovery source has been cleaned.");
      }
      if (readStarted) {
        throw new Error("Race archive Discovery benchmarks are single-use.");
      }
      readStarted = true;
      return benchmarksFromSorted({
        sorted,
        store: input.store,
        groupRunPrefix: `${runPrefix}/discovery-values`,
        refreshedAt,
        maximumBenchmarks,
        maximumObservations,
      });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) {
        throw new Error("Race archive Discovery read owns scratch cleanup.");
      }
      await sorted.cleanup();
      cleaned = true;
    },
  });
}
