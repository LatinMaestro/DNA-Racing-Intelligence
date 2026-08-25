import type {
  CoreStarProfile,
  EventStarValidation,
} from "@/domain/star-signals";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import {
  spillableStarEventsFromRaceArchive,
  type SpillableRaceArchiveStarEventSource,
} from "./race-archive-spillable-star-events";
import {
  spillableStarProfilesFromEvents,
  type SpillableRaceArchiveStarProfileSource,
} from "./race-archive-spillable-star-profile-reducer";

export type SpillableRaceArchiveStarFamilySource = Readonly<{
  inputObservationCount: number;
  validatedEventCount: number;
  contributionCount: number;
  initialEventRunCount: number;
  initialContributionRunCount: number;
  readProfiles: () => AsyncIterable<CoreStarProfile>;
  cleanup: () => Promise<void>;
}>;

export async function spillableStarProfilesFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  contributionStore: RaceArchiveExternalSortedRunStore<CoreStarProfile>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
  maximumContributions: number;
  maximumProfiles: number;
  onEventValidation?: (
    validation: Readonly<EventStarValidation & { eventId: string }>,
  ) => void | Promise<void>;
}): Promise<SpillableRaceArchiveStarFamilySource> {
  let events: SpillableRaceArchiveStarEventSource | undefined;
  let profiles: SpillableRaceArchiveStarProfileSource | undefined;

  try {
    events = await spillableStarEventsFromRaceArchive({
      observations: input.observations,
      store: input.observationStore,
      runPrefix: `${input.runPrefix}/events`,
      maximumRecordsInMemory: input.maximumRecordsInMemory,
      mergeFanIn: input.mergeFanIn,
      maximumObservations: input.maximumObservations,
      maximumRunObjects: input.maximumRunObjects,
      maximumEvents: input.maximumEvents,
      maximumEntriesPerEvent: input.maximumEntriesPerEvent,
    });

    profiles = await spillableStarProfilesFromEvents({
      events: events.readEvents(),
      store: input.contributionStore,
      runPrefix: `${input.runPrefix}/profiles`,
      maximumRecordsInMemory: input.maximumRecordsInMemory,
      mergeFanIn: input.mergeFanIn,
      maximumEvents: input.maximumEvents,
      maximumEntriesPerEvent: input.maximumEntriesPerEvent,
      maximumContributions: input.maximumContributions,
      maximumRunObjects: input.maximumRunObjects,
      maximumProfiles: input.maximumProfiles,
      ...(input.onEventValidation === undefined
        ? {}
        : { onEventValidation: input.onEventValidation }),
    });
  } catch (error) {
    const cleanupFailures: unknown[] = [];
    if (profiles !== undefined) {
      try {
        await profiles.cleanup();
      } catch (cleanupError) {
        cleanupFailures.push(cleanupError);
      }
    }
    if (events !== undefined) {
      try {
        await events.cleanup();
      } catch (cleanupError) {
        const message =
          cleanupError instanceof Error
            ? cleanupError.message
            : String(cleanupError);
        if (!message.includes("read owns scratch cleanup")) {
          cleanupFailures.push(cleanupError);
        }
      }
    }
    if (cleanupFailures.length > 0) {
      throw new Error(
        "Race archive spillable star-family preparation failed and scratch cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }

  return Object.freeze({
    inputObservationCount: events.inputObservationCount,
    validatedEventCount: profiles.validatedEventCount,
    contributionCount: profiles.contributionCount,
    initialEventRunCount: events.initialRunCount,
    initialContributionRunCount: profiles.initialRunCount,
    readProfiles: profiles.readProfiles,
    cleanup: profiles.cleanup,
  });
}
