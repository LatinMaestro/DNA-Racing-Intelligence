import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import { raceArchiveObservationsFromRefreshPlan } from "./race-archive-observation-stream";
import type { RaceArchiveAggregateRefreshPlanVersion } from "./race-archive-aggregate-refresher";
import {
  spillAndDeduplicateRaceArchiveObservations,
  type SpillableRaceArchiveObservationDeduplication,
} from "./race-archive-spillable-natural-key-deduplicator";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type SpillableRaceArchiveObservationSource = Readonly<{
  inputObservationCount: number;
  initialRunCount: number;
  readUnique: () => AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  cleanup: () => Promise<void>;
}>;

type MaterializedObservationRun = Readonly<{ runId: string }>;

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

function validateMergedObservation(
  value: RaceArchiveCoreAnalyticalObservation,
): RaceArchiveCoreAnalyticalObservation {
  const naturalKey = safeText(value.naturalKey, "naturalKey");
  const fingerprintSha256 = safeText(
    value.fingerprintSha256,
    "fingerprintSha256",
    64,
  );
  if (!SHA_256_PATTERN.test(fingerprintSha256)) {
    throw new Error("fingerprintSha256 must be a lowercase SHA-256 digest");
  }
  positiveSafeInteger(value.versionNumber, "versionNumber");
  nonNegativeSafeInteger(value.partitionNumber, "partitionNumber");
  positiveSafeInteger(value.sourceRowNumber, "sourceRowNumber");
  const sourceEventId = safeText(value.sourceEventId, "sourceEventId");
  const sourceCoreId = safeText(value.sourceCoreId, "sourceCoreId", 256);
  if (naturalKey !== `${sourceEventId}:${sourceCoreId}`) {
    throw new Error("Race archive observation natural key is inconsistent.");
  }
  return value;
}

function childRunPrefix(root: string, suffix: string): string {
  const value = `${root}/${suffix}`;
  if (value.length > 256) {
    throw new Error(
      "runPrefix is too long for hierarchical Race archive spill",
    );
  }
  return value;
}

function materializedRunId(root: string, suffix: string): string {
  const value = `${root}/${suffix}`;
  if (value.length > 512) {
    throw new Error("runPrefix is too long for materialized Race archive runs");
  }
  return value;
}

async function closeIterators<T>(
  iterators: readonly AsyncIterator<T>[],
): Promise<void> {
  await Promise.all(
    iterators.map(async (iterator) => {
      if (iterator.return !== undefined) await iterator.return();
    }),
  );
}

function mergedUniqueRuns(input: {
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runs: readonly MaterializedObservationRun[];
}): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    const iterators = input.runs.map((run) =>
      input.store.readRun({ runId: run.runId })[Symbol.asyncIterator](),
    );
    const heads: Array<
      IteratorResult<RaceArchiveCoreAnalyticalObservation> | undefined
    > = [];
    let previousNaturalKey: string | null = null;
    let previousFingerprint: string | null = null;
    try {
      for (const iterator of iterators) heads.push(await iterator.next());
      while (true) {
        let selectedIndex = -1;
        for (let index = 0; index < heads.length; index += 1) {
          const head = heads[index];
          if (head === undefined || head.done) continue;
          if (selectedIndex < 0) {
            selectedIndex = index;
            continue;
          }
          const selectedHead = heads[selectedIndex];
          if (selectedHead === undefined || selectedHead.done) {
            throw new Error("Race archive merge state is invalid.");
          }
          if (observationOrder(head.value, selectedHead.value) < 0) {
            selectedIndex = index;
          }
        }
        if (selectedIndex < 0) return;
        const selectedHead = heads[selectedIndex];
        if (selectedHead === undefined || selectedHead.done) {
          throw new Error("Race archive merge state is invalid.");
        }
        const observation = validateMergedObservation(selectedHead.value);
        if (observation.naturalKey === previousNaturalKey) {
          if (observation.fingerprintSha256 !== previousFingerprint) {
            throw new Error(
              "Race archive history contains conflicting replay evidence.",
            );
          }
        } else {
          previousNaturalKey = observation.naturalKey;
          previousFingerprint = observation.fingerprintSha256;
          yield observation;
        }
        const iterator = iterators[selectedIndex];
        if (iterator === undefined) {
          throw new Error("Race archive merge iterator is unavailable.");
        }
        heads[selectedIndex] = await iterator.next();
      }
    } finally {
      await closeIterators(iterators);
    }
  })();
}

async function cleanupAfterFailure(
  spilled: SpillableRaceArchiveObservationDeduplication,
  cause: unknown,
): Promise<never> {
  try {
    await spilled.cleanup();
  } catch {
    throw new Error(
      "Race archive spillable observation preparation failed and scratch cleanup was incomplete.",
      { cause },
    );
  }
  throw cause;
}

export async function prepareSpillableRaceArchiveObservations(input: {
  ownerId: string;
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[];
  rehydrator: RaceStagedRowRehydrator;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  maximumArchivePartitions: number;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumInputObservations: number;
  maximumRunObjects: number;
}): Promise<SpillableRaceArchiveObservationSource> {
  const ownerId = safeText(input.ownerId, "ownerId", 128);
  const runPrefix = safeText(input.runPrefix, "runPrefix", 240);
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions,
    "maximumArchivePartitions",
    10_000,
  );
  const maximumRecordsInMemory = positiveBound(
    input.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
  // Bound lifetime-unique Race observations, not the cumulative size of full
  // rolling-sheet snapshots that may legitimately replay unchanged history.
  const maximumInputObservations = positiveBound(
    input.maximumInputObservations,
    "maximumInputObservations",
    100_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );
  if (input.versions.length < 1 || input.versions.length > 10_000) {
    throw new Error(
      "Race archive aggregate plan version count is outside its bound.",
    );
  }

  const ownedRuns = new Set<string>();
  let cleaned = false;
  let inputObservationCount = 0;
  let initialRunCount = 0;

  const cleanup = async (): Promise<void> => {
    if (cleaned) return;
    const failures: unknown[] = [];
    for (const runId of [...ownedRuns]) {
      try {
        await input.store.deleteRun({ runId });
        ownedRuns.delete(runId);
      } catch (error) {
        failures.push(error);
      }
    }
    if (failures.length > 0) {
      throw new Error("Race archive hierarchical scratch cleanup failed.");
    }
    cleaned = true;
  };

  const writeCountedRun = async (inputRun: {
    runId: string;
    observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  }): Promise<void> => {
    let observationCount = 0;
    ownedRuns.add(inputRun.runId);
    try {
      await input.store.writeRun({
        runId: inputRun.runId,
        records: (async function* () {
          for await (const observation of inputRun.observations) {
            observationCount += 1;
            if (observationCount > maximumInputObservations) {
              throw new Error(
                "Race archive unique observation bound was exceeded.",
              );
            }
            yield observation;
          }
        })(),
      });
      if (observationCount < 1) {
        throw new Error(
          "Race archive spillable rebuild has no unique observations.",
        );
      }
    } catch (error) {
      await input.store
        .deleteRun({ runId: inputRun.runId })
        .catch(() => undefined);
      ownedRuns.delete(inputRun.runId);
      throw error;
    }
  };

  try {
    // Consolidate as versions arrive so transient R2 storage stays bounded by
    // the configured merge fan-in rather than the number of historical uploads.
    let runs: MaterializedObservationRun[] = [];
    let mergeSequence = 0;

    const consolidateRuns = async (
      sourceRuns: readonly MaterializedObservationRun[],
    ): Promise<MaterializedObservationRun> => {
      if (sourceRuns.length < 2 || sourceRuns.length > mergeFanIn) {
        throw new Error(
          "Race archive hierarchical merge group is outside its bound.",
        );
      }
      mergeSequence += 1;
      const runId = materializedRunId(
        runPrefix,
        `merge-${String(mergeSequence).padStart(5, "0")}`,
      );
      await writeCountedRun({
        runId,
        observations: mergedUniqueRuns({
          store: input.store,
          runs: sourceRuns,
        }),
      });
      for (const source of sourceRuns) {
        await input.store.deleteRun({ runId: source.runId });
        ownedRuns.delete(source.runId);
      }
      return Object.freeze({ runId });
    };

    for (const [index, version] of input.versions.entries()) {
      const acceptedRowCount = positiveBound(
        version.acceptedRowCount,
        `versions[${index}].acceptedRowCount`,
        5_000_000,
      );
      inputObservationCount += acceptedRowCount;
      if (!Number.isSafeInteger(inputObservationCount)) {
        throw new Error("Race archive input observation count is unsafe.");
      }

      const spilled = await spillAndDeduplicateRaceArchiveObservations({
        observations: raceArchiveObservationsFromRefreshPlan({
          ownerId,
          versions: [version],
          rehydrator: input.rehydrator,
          maximumArchivePartitions,
        }),
        store: input.store,
        runPrefix: childRunPrefix(
          runPrefix,
          `version-${String(index + 1).padStart(5, "0")}`,
        ),
        maximumRecordsInMemory,
        mergeFanIn,
        maximumInputObservations: acceptedRowCount,
        maximumRunObjects,
      });
      if (spilled.inputObservationCount !== acceptedRowCount) {
        await cleanupAfterFailure(
          spilled,
          new Error("Race archive spillable observation coverage changed."),
        );
      }
      initialRunCount += spilled.initialRunCount;
      const runId = materializedRunId(
        runPrefix,
        `version-${String(index + 1).padStart(5, "0")}-unique`,
      );
      try {
        await writeCountedRun({
          runId,
          observations: spilled.readUnique(),
        });
      } catch (error) {
        try {
          await spilled.cleanup();
        } catch {
          throw new Error(
            "Race archive version deduplication failed and scratch cleanup was incomplete.",
            { cause: error },
          );
        }
        throw error;
      }
      runs.push(Object.freeze({ runId }));
      if (runs.length === mergeFanIn) {
        runs = [await consolidateRuns(runs)];
      }
    }

    if (runs.length > 1) {
      runs = [await consolidateRuns(runs)];
    }

    const finalRun = runs[0];
    if (finalRun === undefined) {
      throw new Error(
        "Race archive spillable rebuild has no unique observations.",
      );
    }

    return Object.freeze({
      inputObservationCount,
      initialRunCount,
      readUnique() {
        if (cleaned) {
          throw new Error("Race archive observation source has been cleaned.");
        }
        return (async function* () {
          try {
            for await (const observation of input.store.readRun({
              runId: finalRun.runId,
            })) {
              yield validateMergedObservation(observation);
            }
          } finally {
            await cleanup();
          }
        })();
      },
      cleanup,
    });
  } catch (error) {
    try {
      await cleanup();
    } catch {
      throw new Error(
        "Race archive hierarchical observation preparation failed and scratch cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }
}
