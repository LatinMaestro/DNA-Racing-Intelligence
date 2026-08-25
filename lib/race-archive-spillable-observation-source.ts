import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import {
  raceArchiveObservationsFromRefreshPlan,
} from "./race-archive-observation-stream";
import type { RaceArchiveAggregateRefreshPlanVersion } from "./race-archive-aggregate-refresher";
import {
  spillAndDeduplicateRaceArchiveObservations,
  type SpillableRaceArchiveObservationDeduplication,
} from "./race-archive-spillable-natural-key-deduplicator";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type SpillableRaceArchiveObservationSource = Readonly<{
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

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function expectedAcceptedRows(
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[],
  maximumInputObservations: number,
): number {
  let total = 0;
  for (const [index, version] of versions.entries()) {
    const acceptedRowCount = positiveBound(
      version.acceptedRowCount,
      `versions[${index}].acceptedRowCount`,
      5_000_000,
    );
    total += acceptedRowCount;
    if (!Number.isSafeInteger(total) || total > maximumInputObservations) {
      throw new Error(
        "Race archive spillable observation input bound was exceeded.",
      );
    }
  }
  return total;
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
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
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
  const expectedInputObservationCount = expectedAcceptedRows(
    input.versions,
    maximumInputObservations,
  );

  const spilled = await spillAndDeduplicateRaceArchiveObservations({
    observations: raceArchiveObservationsFromRefreshPlan({
      ownerId,
      versions: input.versions,
      rehydrator: input.rehydrator,
      maximumArchivePartitions,
    }),
    store: input.store,
    runPrefix,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputObservations,
    maximumRunObjects,
  });

  if (spilled.inputObservationCount !== expectedInputObservationCount) {
    return cleanupAfterFailure(
      spilled,
      new Error("Race archive spillable observation coverage changed."),
    );
  }

  return Object.freeze({
    inputObservationCount: spilled.inputObservationCount,
    initialRunCount: spilled.initialRunCount,
    readUnique: spilled.readUnique,
    cleanup: spilled.cleanup,
  });
}
