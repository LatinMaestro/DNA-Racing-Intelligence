import {
  refreshStarProfiles,
  type StarProfileEvent,
  type StarProfileRefresh,
} from "@/domain/star-signals";
import type { RaceMode } from "@/domain/import-contract";
import type { StarDataStatus } from "@/domain/source-adapters";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);
const STAR_DATA_STATUSES = new Set<StarDataStatus>([
  "complete",
  "partial",
  "missing",
  "invalid",
]);

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

type MutableArchiveStarEvent = {
  eventId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  goldStarEligible: boolean;
  entries: Array<{
    coreId: string;
    goldStar: boolean | null;
    blueStar: boolean | null;
    starDataStatus: StarDataStatus;
  }>;
  coreIds: Set<string>;
};

function assertEventMetadata(
  event: MutableArchiveStarEvent,
  observation: RaceArchiveCoreAnalyticalObservation,
): void {
  const eventAt = normalizedTimestamp(observation.eventAt, "observation.eventAt");
  if (
    event.eventAt !== eventAt ||
    event.mode !== observation.mode ||
    event.distance !== observation.distance ||
    event.gateCount !== observation.gateCount ||
    event.goldStarEligible !== observation.goldStarEligible
  ) {
    throw new Error("Archive star event metadata changed within one event.");
  }
}

export function starProfilesFromRaceArchive(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  maximumObservations: number;
  maximumEvents: number;
  maximumProfiles: number;
}): StarProfileRefresh {
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    5_000_000,
  );
  const maximumEvents = positiveBound(input.maximumEvents, "maximumEvents", 1_000_000);
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    500_000,
  );
  if (input.observations.length > maximumObservations) {
    throw new Error("Archive star observation bound was exceeded.");
  }

  const events = new Map<string, MutableArchiveStarEvent>();
  const naturalKeys = new Set<string>();

  for (const observation of input.observations) {
    const naturalKey = safeText(
      observation.naturalKey,
      "observation.naturalKey",
    );
    if (naturalKeys.has(naturalKey)) {
      throw new Error("Archive star profiles contain duplicate Race evidence.");
    }
    naturalKeys.add(naturalKey);

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
    const status = starDataStatus(observation.starDataStatus);

    let event = events.get(eventId);
    if (event === undefined) {
      if (events.size >= maximumEvents) {
        throw new Error("Archive star event bound was exceeded.");
      }
      event = {
        eventId,
        eventAt,
        mode: observation.mode,
        distance,
        gateCount,
        goldStarEligible: observation.goldStarEligible,
        entries: [],
        coreIds: new Set<string>(),
      };
      events.set(eventId, event);
    } else {
      assertEventMetadata(event, observation);
    }

    if (event.coreIds.has(coreId)) {
      throw new Error("Archive star event contains duplicate Core evidence.");
    }
    event.coreIds.add(coreId);
    event.entries.push({
      coreId,
      goldStar: observation.goldStar,
      blueStar: observation.blueStar,
      starDataStatus: status,
    });
  }

  const profileEvents: StarProfileEvent[] = [...events.values()]
    .sort((left, right) => left.eventId.localeCompare(right.eventId))
    .map((event) => ({
      eventId: event.eventId,
      eventAt: event.eventAt,
      mode: event.mode,
      distance: event.distance,
      gateCount: event.gateCount,
      entries: [...event.entries].sort((left, right) =>
        left.coreId.localeCompare(right.coreId),
      ),
    }));

  const refresh = refreshStarProfiles(profileEvents);
  if (refresh.profiles.length > maximumProfiles) {
    throw new Error("Archive star profile bound was exceeded.");
  }

  for (const validation of refresh.eventValidations) {
    const event = events.get(validation.eventId);
    if (event === undefined) {
      throw new Error("Archive star validation lost event identity.");
    }
    if (validation.goldStarEligible !== event.goldStarEligible) {
      throw new Error("Archive star eligibility conflicts with game rules.");
    }
  }

  return Object.freeze({
    eventValidations: Object.freeze(refresh.eventValidations),
    profiles: Object.freeze(refresh.profiles),
  });
}
