import type { RaceMode } from "@/domain/import-contract";
import {
  validateEventStarAssignments,
  type CoreStarProfile,
  type EventStarEntry,
  type EventStarValidation,
  type StarDataStatus,
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

export type RaceArchiveStarProfileContribution = Readonly<{
  eventId: string;
  coreId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  starDataStatus: StarDataStatus;
  goldStarEligible: boolean;
  goldAssignmentOpportunity: boolean;
  goldReceived: boolean;
  goldNegativeOpportunity: boolean;
  goldEligibleNoAssignment: boolean;
  goldIneligibleAssignment: boolean;
  goldExcludedAnomaly: boolean;
  blueAssignmentOpportunity: boolean;
  blueReceived: boolean;
  blueNegativeOpportunity: boolean;
  blueNoAssignment: boolean;
  blueExcludedAnomaly: boolean;
  sameCoreReceivedBoth: boolean;
}>;

export type SpillableRaceArchiveStarProfileSource = Readonly<{
  inputObservationCount: number;
  validatedEventCount: number;
  initialEventRunCount: number;
  initialContributionRunCount: number;
  readProfiles: () => AsyncIterable<CoreStarProfile>;
  cleanup: () => Promise<void>;
}>;

type ValidatedObservation = Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  naturalKey: string;
  eventId: string;
  coreId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  goldStarEligible: boolean;
  starDataStatus: StarDataStatus;
}>;

type EventMetadata = Readonly<{
  eventId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  goldStarEligible: boolean;
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

function starDataStatus(value: StarDataStatus): StarDataStatus {
  if (!STAR_DATA_STATUSES.has(value)) {
    throw new Error("Archive star-data status is invalid.");
  }
  return value;
}

function validatedObservation(
  observation: RaceArchiveCoreAnalyticalObservation,
): ValidatedObservation {
  const naturalKey = safeText(observation.naturalKey, "observation.naturalKey");
  const eventId = safeText(observation.sourceEventId, "observation.sourceEventId");
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
  const eventAt = normalizedTimestamp(observation.eventAt, "observation.eventAt");
  if (typeof observation.goldStarEligible !== "boolean") {
    throw new Error("Archive gold-star eligibility is invalid.");
  }
  if (observation.goldStar !== null && typeof observation.goldStar !== "boolean") {
    throw new Error("Archive gold-star value is invalid.");
  }
  if (observation.blueStar !== null && typeof observation.blueStar !== "boolean") {
    throw new Error("Archive blue-star value is invalid.");
  }
  const status = starDataStatus(observation.starDataStatus);
  positiveSafeInteger(observation.versionNumber, "observation.versionNumber");
  nonNegativeSafeInteger(observation.partitionNumber, "observation.partitionNumber");
  positiveSafeInteger(observation.sourceRowNumber, "observation.sourceRowNumber");
  return Object.freeze({
    observation,
    naturalKey,
    eventId,
    coreId,
    eventAt,
    mode: observation.mode,
    distance,
    gateCount,
    goldStarEligible: observation.goldStarEligible,
    starDataStatus: status,
  });
}

function validatedObservations(
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>,
): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    for await (const observation of source) {
      validatedObservation(observation);
      yield observation;
    }
  })();
}

function eventOrder(
  leftValue: RaceArchiveCoreAnalyticalObservation,
  rightValue: RaceArchiveCoreAnalyticalObservation,
): number {
  const left = validatedObservation(leftValue);
  const right = validatedObservation(rightValue);
  return (
    left.eventId.localeCompare(right.eventId) ||
    left.coreId.localeCompare(right.coreId) ||
    left.naturalKey.localeCompare(right.naturalKey) ||
    left.observation.versionNumber - right.observation.versionNumber ||
    left.observation.partitionNumber - right.observation.partitionNumber ||
    left.observation.sourceRowNumber - right.observation.sourceRowNumber ||
    left.observation.datasetVersionId.localeCompare(right.observation.datasetVersionId) ||
    left.observation.importBatchId.localeCompare(right.observation.importBatchId)
  );
}

function assertEventMetadata(
  expected: EventMetadata,
  observation: ValidatedObservation,
): void {
  if (
    expected.eventAt !== observation.eventAt ||
    expected.mode !== observation.mode ||
    expected.distance !== observation.distance ||
    expected.gateCount !== observation.gateCount ||
    expected.goldStarEligible !== observation.goldStarEligible
  ) {
    throw new Error("Archive star event metadata changed within one event.");
  }
}

function contributionForEntry(input: {
  metadata: EventMetadata;
  entry: EventStarEntry;
  validation: EventStarValidation;
}): RaceArchiveStarProfileContribution {
  const goldDataIsComplete =
    input.validation.goldDataCounts.complete === input.validation.entryCount;
  const blueDataIsComplete =
    input.validation.blueDataCounts.complete === input.validation.entryCount;
  const goldReceived =
    input.validation.goldAssignmentOpportunity &&
    input.validation.uniqueGoldCoreId === input.entry.coreId;
  const blueReceived =
    input.validation.blueAssignmentOpportunity &&
    input.validation.uniqueBlueCoreId === input.entry.coreId;
  const goldEligibleNoAssignment =
    input.validation.goldStarEligible &&
    !input.validation.goldAssignmentOpportunity &&
    goldDataIsComplete &&
    input.validation.goldAssignmentCount === 0;
  const blueNoAssignment =
    !input.validation.blueAssignmentOpportunity &&
    blueDataIsComplete &&
    input.validation.blueAssignmentCount === 0;

  return Object.freeze({
    eventId: input.metadata.eventId,
    coreId: input.entry.coreId,
    eventAt: input.metadata.eventAt,
    mode: input.metadata.mode,
    distance: input.metadata.distance,
    starDataStatus: input.entry.starDataStatus,
    goldStarEligible: input.validation.goldStarEligible,
    goldAssignmentOpportunity: input.validation.goldAssignmentOpportunity,
    goldReceived,
    goldNegativeOpportunity:
      input.validation.goldAssignmentOpportunity && !goldReceived,
    goldEligibleNoAssignment,
    goldIneligibleAssignment:
      !input.validation.goldStarEligible && input.entry.goldStar === true,
    goldExcludedAnomaly:
      input.validation.goldStarEligible &&
      !input.validation.goldAssignmentOpportunity &&
      !goldEligibleNoAssignment,
    blueAssignmentOpportunity: input.validation.blueAssignmentOpportunity,
    blueReceived,
    blueNegativeOpportunity:
      input.validation.blueAssignmentOpportunity && !blueReceived,
    blueNoAssignment,
    blueExcludedAnomaly:
      !input.validation.blueAssignmentOpportunity && !blueNoAssignment,
    sameCoreReceivedBoth:
      input.validation.goldAssignmentOpportunity &&
      input.validation.blueAssignmentOpportunity &&
      input.validation.sameCoreReceivedBoth &&
      input.validation.uniqueGoldCoreId === input.entry.coreId,
  });
}

function contributionsFromEvents(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveCoreAnalyticalObservation>;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
  onEventValidation?: (
    validation: Readonly<EventStarValidation & { eventId: string }>,
  ) => void | Promise<void>;
  onValidatedEvent: () => void;
}): AsyncIterable<RaceArchiveStarProfileContribution> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveCoreAnalyticalObservation> | null = null;
    let eventCount = 0;

    try {
      while (true) {
        const firstResult: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validatedObservation(firstResult.value);
        eventCount += 1;
        if (eventCount > input.maximumEvents) {
          throw new Error("Archive star event bound was exceeded.");
        }
        const metadata: EventMetadata = Object.freeze({
          eventId: first.eventId,
          eventAt: first.eventAt,
          mode: first.mode,
          distance: first.distance,
          gateCount: first.gateCount,
          goldStarEligible: first.goldStarEligible,
        });
        const entries: EventStarEntry[] = [];
        const naturalKeys = new Set<string>();
        const coreIds = new Set<string>();
        let current: IteratorResult<RaceArchiveCoreAnalyticalObservation> =
          firstResult;

        while (!current.done) {
          const observation = validatedObservation(current.value);
          if (observation.eventId !== metadata.eventId) {
            carry = current;
            break;
          }
          assertEventMetadata(metadata, observation);
          if (naturalKeys.has(observation.naturalKey)) {
            throw new Error("Archive star profiles contain duplicate Race evidence.");
          }
          naturalKeys.add(observation.naturalKey);
          if (coreIds.has(observation.coreId)) {
            throw new Error("Archive star event contains duplicate Core evidence.");
          }
          coreIds.add(observation.coreId);
          if (entries.length >= input.maximumEntriesPerEvent) {
            throw new Error("Archive star event-entry bound was exceeded.");
          }
          entries.push({
            coreId: observation.coreId,
            goldStar: observation.observation.goldStar,
            blueStar: observation.observation.blueStar,
            starDataStatus: observation.starDataStatus,
          });
          current = await iterator.next();
        }

        const validation = validateEventStarAssignments(metadata.gateCount, entries);
        if (validation.goldStarEligible !== metadata.goldStarEligible) {
          throw new Error("Archive star eligibility conflicts with game rules.");
        }
        const eventValidation = Object.freeze({
          eventId: metadata.eventId,
          ...validation,
        });
        await input.onEventValidation?.(eventValidation);
        input.onValidatedEvent();
        for (const entry of entries) {
          yield contributionForEntry({ metadata, entry, validation });
        }
      }
    } finally {
      if (iterator.return !== undefined) await iterator.return();
      await input.sorted.cleanup();
    }
  })();
}

function validatedContribution(
  value: RaceArchiveStarProfileContribution,
): RaceArchiveStarProfileContribution {
  const eventId = safeText(value.eventId, "contribution.eventId");
  const coreId = safeText(value.coreId, "contribution.coreId", 256);
  const eventAt = normalizedTimestamp(value.eventAt, "contribution.eventAt");
  if (!RACE_MODES.has(value.mode)) {
    throw new Error("Archive star contribution mode is invalid.");
  }
  const distance = positiveSafeInteger(value.distance, "contribution.distance");
  const status = starDataStatus(value.starDataStatus);
  for (const [field, fieldValue] of Object.entries(value)) {
    if (
      field !== "eventId" &&
      field !== "coreId" &&
      field !== "eventAt" &&
      field !== "mode" &&
      field !== "distance" &&
      field !== "starDataStatus" &&
      typeof fieldValue !== "boolean"
    ) {
      throw new Error(`Archive star contribution ${field} is invalid.`);
    }
  }
  return Object.freeze({ ...value, eventId, coreId, eventAt, distance, starDataStatus: status });
}

function contributionOrder(
  leftValue: RaceArchiveStarProfileContribution,
  rightValue: RaceArchiveStarProfileContribution,
): number {
  const left = validatedContribution(leftValue);
  const right = validatedContribution(rightValue);
  return (
    left.coreId.localeCompare(right.coreId) ||
    left.mode.localeCompare(right.mode) ||
    left.distance - right.distance ||
    left.eventAt.localeCompare(right.eventAt) ||
    left.eventId.localeCompare(right.eventId)
  );
}

function profileKey(value: RaceArchiveStarProfileContribution): string {
  return JSON.stringify([value.coreId, value.mode, value.distance]);
}

function profilesFromContributions(input: {
  sorted: RaceArchiveExternalSortedResult<RaceArchiveStarProfileContribution>;
  maximumProfiles: number;
}): AsyncIterable<CoreStarProfile> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<RaceArchiveStarProfileContribution> | null = null;
    let profileCount = 0;

    try {
      while (true) {
        const firstResult: IteratorResult<RaceArchiveStarProfileContribution> =
          carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = validatedContribution(firstResult.value);
        const expectedKey = profileKey(first);
        profileCount += 1;
        if (profileCount > input.maximumProfiles) {
          throw new Error("Archive star profile bound was exceeded.");
        }

        const profile = {
          coreId: first.coreId,
          mode: first.mode,
          distance: first.distance,
          dataCurrentThrough: first.eventAt,
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
        let current: IteratorResult<RaceArchiveStarProfileContribution> = firstResult;

        while (!current.done) {
          const contribution = validatedContribution(current.value);
          if (profileKey(contribution) !== expectedKey) {
            carry = current;
            break;
          }
          profile.raceCount += 1;
          if (contribution.eventAt > profile.dataCurrentThrough) {
            profile.dataCurrentThrough = contribution.eventAt;
          }
          if (contribution.starDataStatus === "complete") profile.completeStarDataRaceCount += 1;
          else if (contribution.starDataStatus === "partial") profile.partialStarDataRaceCount += 1;
          else if (contribution.starDataStatus === "missing") profile.missingStarDataRaceCount += 1;
          else profile.invalidStarDataRaceCount += 1;
          if (contribution.goldStarEligible) profile.goldEligibleRaceCount += 1;
          if (contribution.goldAssignmentOpportunity) profile.goldAssignmentOpportunityCount += 1;
          if (contribution.goldReceived) profile.goldReceivedCount += 1;
          if (contribution.goldNegativeOpportunity) profile.goldNegativeOpportunityCount += 1;
          if (contribution.goldEligibleNoAssignment) profile.goldEligibleNoAssignmentCount += 1;
          if (contribution.goldIneligibleAssignment) profile.goldIneligibleAssignmentCount += 1;
          if (contribution.goldExcludedAnomaly) profile.goldExcludedAnomalyCount += 1;
          if (contribution.blueAssignmentOpportunity) profile.blueAssignmentOpportunityCount += 1;
          if (contribution.blueReceived) profile.blueReceivedCount += 1;
          if (contribution.blueNegativeOpportunity) profile.blueNegativeOpportunityCount += 1;
          if (contribution.blueNoAssignment) profile.blueNoAssignmentCount += 1;
          if (contribution.blueExcludedAnomaly) profile.blueExcludedAnomalyCount += 1;
          if (contribution.sameCoreReceivedBoth) profile.sameCoreReceivedBothCount += 1;
          current = await iterator.next();
        }

        yield Object.freeze({
          ...profile,
          goldReceivedRate: Object.freeze({
            numerator: profile.goldReceivedCount,
            denominator: profile.goldAssignmentOpportunityCount,
          }),
          blueReceivedRate: Object.freeze({
            numerator: profile.blueReceivedCount,
            denominator: profile.blueAssignmentOpportunityCount,
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
  value: RaceArchiveStarProfileContribution,
): Uint8Array {
  return new TextEncoder().encode(`${JSON.stringify(validatedContribution(value))}\n`);
}

export function decodeRaceArchiveStarProfileContributionLine(
  line: string,
): RaceArchiveStarProfileContribution {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Race archive star contribution JSON is invalid.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Race archive star contribution is invalid.");
  }
  return validatedContribution(parsed as RaceArchiveStarProfileContribution);
}

export async function spillableStarProfilesFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  contributionStore: RaceArchiveExternalSortedRunStore<RaceArchiveStarProfileContribution>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumEvents: number;
  maximumEntriesPerEvent: number;
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
  const maximumEvents = positiveBound(input.maximumEvents, "maximumEvents", 1_000_000);
  const maximumEntriesPerEvent = positiveBound(
    input.maximumEntriesPerEvent,
    "maximumEntriesPerEvent",
    100_000,
  );
  const maximumProfiles = positiveBound(input.maximumProfiles, "maximumProfiles", 500_000);

  const eventSorted = await spillExactSortedRaceArchiveRecords({
    records: validatedObservations(input.observations),
    store: input.observationStore,
    compare: eventOrder,
    runPrefix: `${runPrefix}/star-events`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumObservations,
    maximumRunObjects,
  });
  let validatedEventCount = 0;
  let contributionSorted:
    | RaceArchiveExternalSortedResult<RaceArchiveStarProfileContribution>
    | undefined;
  try {
    contributionSorted = await spillExactSortedRaceArchiveRecords({
      records: contributionsFromEvents({
        sorted: eventSorted,
        maximumEvents,
        maximumEntriesPerEvent,
        onEventValidation: input.onEventValidation,
        onValidatedEvent() {
          validatedEventCount += 1;
        },
      }),
      store: input.contributionStore,
      compare: contributionOrder,
      runPrefix: `${runPrefix}/star-contributions`,
      maximumRecordsInMemory,
      mergeFanIn,
      maximumInputRecords: maximumObservations,
      maximumRunObjects,
    });
  } catch (error) {
    try {
      await eventSorted.cleanup();
    } catch {
      throw new Error(
        "Race archive star preparation failed and event scratch cleanup was incomplete.",
        { cause: error },
      );
    }
    throw error;
  }
  if (contributionSorted.recordCount !== eventSorted.recordCount) {
    await contributionSorted.cleanup();
    throw new Error("Race archive star contribution coverage changed.");
  }

  let readStarted = false;
  let cleaned = false;
  return Object.freeze({
    inputObservationCount: eventSorted.recordCount,
    validatedEventCount,
    initialEventRunCount: eventSorted.initialRunCount,
    initialContributionRunCount: contributionSorted.initialRunCount,
    readProfiles() {
      if (cleaned) throw new Error("Race archive star source has been cleaned.");
      if (readStarted) throw new Error("Race archive star profiles are single-use.");
      readStarted = true;
      return profilesFromContributions({ sorted: contributionSorted, maximumProfiles });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) throw new Error("Race archive star read owns scratch cleanup.");
      await contributionSorted.cleanup();
      cleaned = true;
    },
  });
}
