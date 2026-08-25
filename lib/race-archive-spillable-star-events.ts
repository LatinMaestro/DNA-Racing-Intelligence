import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/source-adapters";
import {
  validateEventStarAssignments,
  type StarProfileEvent,
} from "@/domain/star-signals";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);
const STAR_DATA_STATUSES = new Set<StarDataStatus>([
  "complete",
  "partial",
  "missing",
  "invalid",
]);

export type SpillableRaceArchiveStarEventSource = Readonly<{
  inputObservationCount: number;
  initialRunCount: number;
  readEvents: () => AsyncIterable<StarProfileEvent>;
  cleanup: () => Promise<void>;
}>;

type ValidatedObservation = Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  naturalKey: string;
  eventId: string;
  coreId: string;
  eventAt: string;
  distance: number;
  gateCount: number;
  starDataStatus: StarDataStatus;
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

function validatedStarDataStatus(value: StarDataStatus): StarDataStatus {
  if (!STAR_DATA_STATUSES.has(value)) {
    throw new Error("Archive star-data status is invalid.");
  }
  return value;
}

function validateObservation(
  observation: RaceArchiveCoreAnalyticalObservation,
): ValidatedObservation {
  const naturalKey = safeText(observation.naturalKey, "observation.naturalKey");
  const eventId = safeText(
    observation.sourceEventId,
    "observation.sourceEventId",
  );
  const coreId = safeText(
    observation.sourceCoreId,
    "observation.sourceCoreId",
    256,
  );
  if (naturalKey !== `${eventId}:${coreId}`) {
    throw new Error("Archive star natural key is inconsistent.");
  }
  if (!RACE_MODES.has(observation.mode)) {
    throw new Error("Archive star mode is invalid.");
  }
  const distance = positiveSafeInteger(
    observation.distance,
    "observation.distance",
  );
  const gateCount = positiveSafeInteger(
    observation.gateCount,
    "observation.gateCount",
  );
  const eventAt = normalizedTimestamp(
    observation.eventAt,
    "observation.eventAt",
  );
  if (typeof observation.goldStarEligible !== "boolean") {
    throw new Error("Archive gold-star eligibility is invalid.");
  }
  if (
    observation.goldStar !== null &&
    typeof observation.goldStar !== "boolean"
  ) {
    throw new Error("Archive gold-star value is invalid.");
  }
  if (
    observation.blueStar !== null &&
    typeof observation.blueStar !== "boolean"
  ) {
    throw new Error("Archive blue-star value is invalid.");
  }
  const starDataStatus = validatedStarDataStatus(observation.starDataStatus);
  positiveSafeInteger(observation.versionNumber, "observation.versionNumber");
  nonNegativeSafeInteger(
    observation.partitionNumber,
    "observation.partitionNumber",
  );
  positiveSafeInteger(
    observation.sourceRowNumber,
    "observation.sourceRowNumber",
  );
  return Object.freeze({
    observation,
    naturalKey,
    eventId,
    coreId,
    eventAt,
    distance,
    gateCount,
    starDataStatus,
  });
}

function validatedObservations(input: {
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  maximumObservations: number;
  onObservation: () => void;
}): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    let count = 0;
    for await (const observation of input.source) {
      count += 1;
      if (count > input.maximumObservations) {
        throw new Error("Archive star observation bound was exceeded.");
      }
      input.onObservation();
      validateObservation(observation);
      yield observation;
    }
  })();
}

function eventObservationOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  const left = validateObservation(leftValue);
  const right = validateObservation(rightValue);
  return (
    left.eventId.localeCompare(right.eventId) ||
    left.coreId.localeCompare(right.coreId) ||
    left.naturalKey.localeCompare(right.naturalKey) ||
    left.eventAt.localeCompare(right.eventAt) ||
    left.observation.versionNumber - right.observation.versionNumber ||
    left.observation.partitionNumber - right.observation.partitionNumber ||
    left.observation.sourceRowNumber - right.observation.sourceRowNumber ||
    left.observation.datasetVersionId.localeCompare(
      right.observation.datasetVersionId,
    ) ||
    left.observation.importBatchId.localeCompare(
      right.observation.importBatchId,
    )
  );
}

function assertSameEventMetadata(
  first: ValidatedObservation,
  current: ValidatedObservation,
): void {
  if (
    first.eventAt !== current.eventAt ||
    first.observation.mode !== current.observation.mode ||
    first.distance !== current.distance ||
    first.gateCount !== current.gateCount ||
    first.observation.goldStarEligible !== current.observation.goldStarEligible
  ) {
    throw new Error("Archive star event metadata changed within one event.");
  }
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

function eventsFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
}): AsyncIterable<StarProfileEvent> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveCoreAnalyticalObservation> | null =
      null;
    let eventCount = 0;

    try {
      while (true) {
        const firstResult: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validateObservation(firstResult.value);
        eventCount += 1;
        if (eventCount > input.maximumEvents) {
          throw new Error("Archive star event bound was exceeded.");
        }

        const entries: StarProfileEvent["entries"][number][] = [];
        let previousNaturalKey: string | null = null;
        let previousCoreId: string | null = null;
        let current: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          firstResult;

        while (!current.done) {
          const validated = validateObservation(current.value);
          if (validated.eventId !== first.eventId) {
            carry = current;
            break;
          }
          assertSameEventMetadata(first, validated);
          if (validated.naturalKey === previousNaturalKey) {
            throw new Error(
              "Archive star profiles contain duplicate Race evidence.",
            );
          }
          if (validated.coreId === previousCoreId) {
            throw new Error(
              "Archive star event contains duplicate Core evidence.",
            );
          }
          previousNaturalKey = validated.naturalKey;
          previousCoreId = validated.coreId;
          entries.push(
            Object.freeze({
              coreId: validated.coreId,
              goldStar: validated.observation.goldStar,
              blueStar: validated.observation.blueStar,
              starDataStatus: validated.starDataStatus,
            }),
          );
          if (entries.length > input.maximumEntriesPerEvent) {
            throw new Error("Archive star event entry bound was exceeded.");
          }
          current = await iterator.next();
        }

        const validation = validateEventStarAssignments(
          first.gateCount,
          entries,
        );
        if (
          validation.goldStarEligible !== first.observation.goldStarEligible
        ) {
          throw new Error(
            "Archive star eligibility conflicts with game rules.",
          );
        }

        yield Object.freeze({
          eventId: first.eventId,
          eventAt: first.eventAt,
          mode: first.observation.mode,
          distance: first.distance,
          gateCount: first.gateCount,
          entries: Object.freeze(entries),
        }) satisfies StarProfileEvent;
      }
    } finally {
      await closeIterator(iterator);
      await input.sorted.cleanup();
    }
  })();
}

export async function spillableStarEventsFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
}): Promise<SpillableRaceArchiveStarEventSource> {
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
    5_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );
  const maximumEvents = positiveBound(
    input.maximumEvents,
    "maximumEvents",
    1_000_000,
  );
  const maximumEntriesPerEvent = positiveBound(
    input.maximumEntriesPerEvent,
    "maximumEntriesPerEvent",
    100_000,
  );

  let inputObservationCount = 0;
  const sorted = await spillExactSortedRaceArchiveRecords({
    records: validatedObservations({
      source: input.observations,
      maximumObservations,
      onObservation() {
        inputObservationCount += 1;
      },
    }),
    store: input.store,
    compare: eventObservationOrder,
    runPrefix: `${runPrefix}/star-event-sort`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumObservations,
    maximumRunObjects,
  });
  if (sorted.recordCount !== inputObservationCount) {
    await sorted.cleanup();
    throw new Error("Archive star observation coverage changed.");
  }

  let readStarted = false;
  let cleaned = false;
  return Object.freeze({
    inputObservationCount,
    initialRunCount: sorted.initialRunCount,
    readEvents() {
      if (cleaned) {
        throw new Error("Race archive star event source has been cleaned.");
      }
      if (readStarted) {
        throw new Error("Race archive star events are single-use.");
      }
      readStarted = true;
      return eventsFromSorted({
        sorted,
        maximumEvents,
        maximumEntriesPerEvent,
      });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) {
        throw new Error("Race archive star event read owns scratch cleanup.");
      }
      await sorted.cleanup();
      cleaned = true;
    },
  });
}
