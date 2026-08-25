import {
  refreshStarProfiles,
  type CoreStarProfile,
  type EventStarValidation,
  type StarProfileEvent,
} from "@/domain/star-signals";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<StarProfileEvent["mode"]>(["bike", "car", "horse"]);
const COUNT_FIELDS = [
  "raceCount",
  "completeStarDataRaceCount",
  "partialStarDataRaceCount",
  "missingStarDataRaceCount",
  "invalidStarDataRaceCount",
  "goldEligibleRaceCount",
  "goldAssignmentOpportunityCount",
  "goldReceivedCount",
  "goldNegativeOpportunityCount",
  "goldEligibleNoAssignmentCount",
  "goldIneligibleAssignmentCount",
  "goldExcludedAnomalyCount",
  "blueAssignmentOpportunityCount",
  "blueReceivedCount",
  "blueNegativeOpportunityCount",
  "blueNoAssignmentCount",
  "blueExcludedAnomalyCount",
  "sameCoreReceivedBothCount",
] as const satisfies readonly (keyof CoreStarProfile)[];

type MutableProfile = Omit<
  CoreStarProfile,
  "goldReceivedRate" | "blueReceivedRate"
>;

export type SpillableRaceArchiveStarProfileSource = Readonly<{
  validatedEventCount: number;
  contributionCount: number;
  initialRunCount: number;
  readProfiles: () => AsyncIterable<CoreStarProfile>;
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
  return value;
}

function validatedContribution(value: CoreStarProfile): CoreStarProfile {
  const coreId = safeText(value.coreId, "profile.coreId", 256);
  if (!RACE_MODES.has(value.mode)) {
    throw new Error("Race archive star-profile mode is invalid.");
  }
  if (!Number.isSafeInteger(value.distance) || value.distance <= 0) {
    throw new Error("Race archive star-profile distance is invalid.");
  }
  const dataCurrentThrough = normalizedTimestamp(
    value.dataCurrentThrough,
    "profile.dataCurrentThrough",
  );
  for (const field of COUNT_FIELDS) {
    nonNegativeSafeInteger(value[field] as number, `profile.${field}`);
  }
  if (value.raceCount !== 1) {
    throw new Error(
      "Race archive star contribution must describe exactly one event.",
    );
  }
  if (
    value.completeStarDataRaceCount +
      value.partialStarDataRaceCount +
      value.missingStarDataRaceCount +
      value.invalidStarDataRaceCount !==
    value.raceCount
  ) {
    throw new Error(
      "Race archive star contribution data-status coverage changed.",
    );
  }
  if (
    value.goldReceivedRate.numerator !== value.goldReceivedCount ||
    value.goldReceivedRate.denominator !==
      value.goldAssignmentOpportunityCount ||
    value.blueReceivedRate.numerator !== value.blueReceivedCount ||
    value.blueReceivedRate.denominator !== value.blueAssignmentOpportunityCount
  ) {
    throw new Error("Race archive star contribution rate evidence changed.");
  }
  return Object.freeze({ ...value, coreId, dataCurrentThrough });
}

function contributionOrder(
  leftValue: CoreStarProfile,
  rightValue: CoreStarProfile,
): number {
  const left = validatedContribution(leftValue);
  const right = validatedContribution(rightValue);
  return (
    left.coreId.localeCompare(right.coreId) ||
    left.mode.localeCompare(right.mode) ||
    left.distance - right.distance ||
    left.dataCurrentThrough.localeCompare(right.dataCurrentThrough)
  );
}

function profileKey(value: CoreStarProfile): string {
  return JSON.stringify([value.coreId, value.mode, value.distance]);
}

function validatedEvents(input: {
  events: AsyncIterable<StarProfileEvent>;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
  maximumContributions: number;
  onEventValidation?: (
    validation: Readonly<EventStarValidation & { eventId: string }>,
  ) => void | Promise<void>;
  onValidatedEvent: () => void;
  onContribution: () => void;
}): AsyncIterable<CoreStarProfile> {
  return (async function* () {
    let eventCount = 0;
    let contributionCount = 0;
    let previousEventId: string | null = null;

    for await (const rawEvent of input.events) {
      eventCount += 1;
      if (eventCount > input.maximumEvents) {
        throw new Error("Race archive star event bound was exceeded.");
      }
      const eventId = safeText(rawEvent.eventId, "event.eventId");
      if (
        previousEventId !== null &&
        eventId.localeCompare(previousEventId) <= 0
      ) {
        throw new Error(
          "Race archive star events are duplicated or not ordered.",
        );
      }
      previousEventId = eventId;
      if (rawEvent.entries.length > input.maximumEntriesPerEvent) {
        throw new Error("Race archive star event-entry bound was exceeded.");
      }
      const event: StarProfileEvent = Object.freeze({
        ...rawEvent,
        eventId,
        entries: Object.freeze([...rawEvent.entries]),
      });
      const refreshed = refreshStarProfiles([event]);
      const validation = refreshed.eventValidations[0];
      if (validation === undefined || refreshed.eventValidations.length !== 1) {
        throw new Error("Race archive star event validation coverage changed.");
      }
      await input.onEventValidation?.(validation);
      input.onValidatedEvent();

      for (const rawProfile of refreshed.profiles) {
        contributionCount += 1;
        if (contributionCount > input.maximumContributions) {
          throw new Error("Race archive star contribution bound was exceeded.");
        }
        input.onContribution();
        yield validatedContribution(rawProfile);
      }
    }
  })();
}

function newMutableProfile(contribution: CoreStarProfile): MutableProfile {
  return {
    coreId: contribution.coreId,
    mode: contribution.mode,
    distance: contribution.distance,
    dataCurrentThrough: contribution.dataCurrentThrough,
    raceCount: 0,
    completeStarDataRaceCount: 0,
    partialStarDataRaceCount: 0,
    missingStarDataRaceCount: 0,
    invalidStarDataRaceCount: 0,
    goldEligibleRaceCount: 0,
    goldAssignmentOpportunityCount: 0,
    goldReceivedCount: 0,
    goldNegativeOpportunityCount: 0,
    goldEligibleNoAssignmentCount: 0,
    goldIneligibleAssignmentCount: 0,
    goldExcludedAnomalyCount: 0,
    blueAssignmentOpportunityCount: 0,
    blueReceivedCount: 0,
    blueNegativeOpportunityCount: 0,
    blueNoAssignmentCount: 0,
    blueExcludedAnomalyCount: 0,
    sameCoreReceivedBothCount: 0,
  };
}

function profilesFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<CoreStarProfile>;
  maximumProfiles: number;
}): AsyncIterable<CoreStarProfile> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<CoreStarProfile> | null = null;
    let profileCount = 0;

    try {
      while (true) {
        const firstResult: IteratorResult<CoreStarProfile> =
          carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validatedContribution(firstResult.value);
        const expectedKey = profileKey(first);
        profileCount += 1;
        if (profileCount > input.maximumProfiles) {
          throw new Error("Race archive star profile bound was exceeded.");
        }
        const aggregate = newMutableProfile(first);
        let current: IteratorResult<CoreStarProfile> = firstResult;

        while (!current.done) {
          const contribution = validatedContribution(current.value);
          if (profileKey(contribution) !== expectedKey) {
            carry = current;
            break;
          }
          if (contribution.dataCurrentThrough > aggregate.dataCurrentThrough) {
            aggregate.dataCurrentThrough = contribution.dataCurrentThrough;
          }
          for (const field of COUNT_FIELDS) {
            aggregate[field] += contribution[field] as number;
            if (!Number.isSafeInteger(aggregate[field])) {
              throw new Error(`Race archive star profile ${field} overflowed.`);
            }
          }
          current = await iterator.next();
        }

        yield Object.freeze({
          ...aggregate,
          goldReceivedRate: Object.freeze({
            numerator: aggregate.goldReceivedCount,
            denominator: aggregate.goldAssignmentOpportunityCount,
          }),
          blueReceivedRate: Object.freeze({
            numerator: aggregate.blueReceivedCount,
            denominator: aggregate.blueAssignmentOpportunityCount,
          }),
        }) satisfies CoreStarProfile;
      }
    } finally {
      if (iterator.return !== undefined) await iterator.return();
      await input.sorted.cleanup();
    }
  })();
}

export function encodeRaceArchiveStarProfileContribution(
  value: CoreStarProfile,
): Uint8Array {
  return new TextEncoder().encode(
    `${JSON.stringify(validatedContribution(value))}\n`,
  );
}

export function decodeRaceArchiveStarProfileContributionLine(
  line: string,
): CoreStarProfile {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Race archive star contribution JSON is invalid.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Race archive star contribution is invalid.");
  }
  return validatedContribution(parsed as CoreStarProfile);
}

export async function spillableStarProfilesFromEvents(input: {
  events: AsyncIterable<StarProfileEvent>;
  store: RaceArchiveExternalSortedRunStore<CoreStarProfile>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
  maximumContributions: number;
  maximumRunObjects: number;
  maximumProfiles: number;
  onEventValidation?: (
    validation: Readonly<EventStarValidation & { eventId: string }>,
  ) => void | Promise<void>;
}): Promise<SpillableRaceArchiveStarProfileSource> {
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
  const maximumRecordsInMemory = positiveBound(
    input.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
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
  const maximumContributions = positiveBound(
    input.maximumContributions,
    "maximumContributions",
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

  let validatedEventCount = 0;
  let contributionCount = 0;
  const sorted = await spillExactSortedRaceArchiveRecords({
    records: validatedEvents({
      events: input.events,
      maximumEvents,
      maximumEntriesPerEvent,
      maximumContributions,
      ...(input.onEventValidation === undefined
        ? {}
        : { onEventValidation: input.onEventValidation }),
      onValidatedEvent() {
        validatedEventCount += 1;
      },
      onContribution() {
        contributionCount += 1;
      },
    }),
    store: input.store,
    compare: contributionOrder,
    runPrefix: `${runPrefix}/star-profile-contributions`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumContributions,
    maximumRunObjects,
  });
  if (sorted.recordCount !== contributionCount) {
    await sorted.cleanup();
    throw new Error("Race archive star contribution coverage changed.");
  }

  let readStarted = false;
  let cleaned = false;
  return Object.freeze({
    validatedEventCount,
    contributionCount,
    initialRunCount: sorted.initialRunCount,
    readProfiles() {
      if (cleaned)
        throw new Error("Race archive star-profile source has been cleaned.");
      if (readStarted)
        throw new Error("Race archive star profiles are single-use.");
      readStarted = true;
      return profilesFromSorted({ sorted, maximumProfiles });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted)
        throw new Error("Race archive star-profile read owns scratch cleanup.");
      await sorted.cleanup();
      cleaned = true;
    },
  });
}
