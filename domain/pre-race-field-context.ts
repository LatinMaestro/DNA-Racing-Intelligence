import {
  raceModes,
  type PerformanceObservation,
  type RaceMode,
} from "@/domain/core-performance";
import {
  refreshStarProfiles,
  type CoreStarProfile,
  type StarProfileEvent,
} from "@/domain/star-signals";

export type HistoricalFieldRequest = {
  eventId: string;
  eventAt: string;
  enteredCoreId: string;
  opponentCoreIds: readonly string[];
  mode: RaceMode;
  distance: number;
};

export type FieldContextWarning =
  | "NO_OPPONENTS"
  | "OPPONENT_HISTORY_UNAVAILABLE"
  | "PARTIAL_OPPONENT_HISTORY"
  | "STAR_HISTORY_UNAVAILABLE"
  | "PARTIAL_STAR_HISTORY"
  | "SAME_OR_FUTURE_EVIDENCE_EXCLUDED"
  | "QUALITY_BAND_UNCLASSIFIED";

export type OpponentPreRaceContext = {
  coreId: string;
  priorExactDistanceRaceCount: number;
  priorBestMilliseconds: number | null;
  priorMedianMilliseconds: number | null;
  latestPriorRaceAt: string | null;
  priorStarProfile: CoreStarProfile | null;
};

export type HistoricalFieldContext = {
  eventId: string;
  eventAt: string;
  enteredCoreId: string;
  mode: RaceMode;
  distance: number;
  evidenceCutoff: {
    timestamp: string;
    comparison: "strictly_before";
  };
  opponents: readonly OpponentPreRaceContext[];
  coverage: {
    opponentCount: number;
    opponentsWithPriorExactDistanceHistory: number;
    opponentsWithoutPriorExactDistanceHistory: number;
    status: "unavailable" | "partial" | "complete";
  };
  fieldTimeSummary: {
    fastestKnownPriorBestMilliseconds: number | null;
    medianKnownOpponentMedianMilliseconds: number | null;
  };
  excludedEvidence: {
    sameOrFuturePerformanceObservationCount: number;
    sameOrFutureStarEventCount: number;
  };
  qualityBand: "unclassified";
  warnings: readonly FieldContextWarning[];
};

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

function assertRequest(request: HistoricalFieldRequest): void {
  const opponentIds = request.opponentCoreIds.map((coreId) => coreId.trim());
  if (
    request.eventId.trim() === "" ||
    request.enteredCoreId.trim() === "" ||
    !raceModes.includes(request.mode) ||
    !Number.isSafeInteger(request.distance) ||
    request.distance <= 0 ||
    opponentIds.some((coreId) => coreId === "") ||
    new Set(opponentIds).size !== opponentIds.length ||
    opponentIds.includes(request.enteredCoreId)
  ) {
    throw new Error("Historical field request is invalid.");
  }
  parseTimestamp(request.eventAt, "Historical event time");
}

function assertPerformanceObservation(
  observation: PerformanceObservation,
): void {
  if (
    observation.eventId.trim() === "" ||
    observation.coreId.trim() === "" ||
    !raceModes.includes(observation.mode) ||
    !Number.isSafeInteger(observation.distance) ||
    observation.distance <= 0 ||
    !Number.isSafeInteger(observation.elapsedTimeMilliseconds) ||
    observation.elapsedTimeMilliseconds <= 0
  ) {
    throw new Error(
      `Performance observation is invalid: ${observation.eventId}.`,
    );
  }
  parseTimestamp(observation.eventAt, "Performance observation time");
}

function assertStarEvent(event: StarProfileEvent): void {
  const starStatuses = ["complete", "partial", "missing", "invalid"] as const;
  if (
    event.eventId.trim() === "" ||
    !raceModes.includes(event.mode) ||
    !Number.isSafeInteger(event.distance) ||
    event.distance <= 0 ||
    !Number.isSafeInteger(event.gateCount) ||
    event.gateCount <= 0 ||
    event.entries.some(
      (entry) =>
        entry.coreId.trim() === "" ||
        (entry.goldStar !== null && typeof entry.goldStar !== "boolean") ||
        (entry.blueStar !== null && typeof entry.blueStar !== "boolean") ||
        !starStatuses.includes(entry.starDataStatus),
    )
  ) {
    throw new Error(`Star event is invalid: ${event.eventId}.`);
  }
  parseTimestamp(event.eventAt, "Star event time");
}

function quantile(
  sortedValues: readonly number[],
  probability: number,
): number {
  if (sortedValues.length === 0)
    throw new Error("A quantile requires at least one value.");
  const index = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex]!;
  const upper = sortedValues[upperIndex]!;
  return lower + (upper - lower) * (index - lowerIndex);
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function warningList(input: {
  opponentCount: number;
  knownOpponentCount: number;
  opponentStarProfileCount: number;
  excludedPerformanceCount: number;
  excludedStarCount: number;
}): FieldContextWarning[] {
  const warnings: FieldContextWarning[] = [];
  if (input.opponentCount === 0) warnings.push("NO_OPPONENTS");
  if (input.knownOpponentCount === 0)
    warnings.push("OPPONENT_HISTORY_UNAVAILABLE");
  else if (input.knownOpponentCount < input.opponentCount)
    warnings.push("PARTIAL_OPPONENT_HISTORY");
  if (input.opponentCount > 0 && input.opponentStarProfileCount === 0) {
    warnings.push("STAR_HISTORY_UNAVAILABLE");
  } else if (input.opponentStarProfileCount < input.opponentCount) {
    warnings.push("PARTIAL_STAR_HISTORY");
  }
  if (input.excludedPerformanceCount > 0 || input.excludedStarCount > 0)
    warnings.push("SAME_OR_FUTURE_EVIDENCE_EXCLUDED");
  warnings.push("QUALITY_BAND_UNCLASSIFIED");
  return warnings;
}

export function buildHistoricalFieldContext(
  request: HistoricalFieldRequest,
  performanceObservations: readonly PerformanceObservation[],
  starEvents: readonly StarProfileEvent[],
): HistoricalFieldContext {
  assertRequest(request);
  const eventAt = parseTimestamp(request.eventAt, "Historical event time");
  const opponentIds = [...request.opponentCoreIds].sort((left, right) =>
    left.localeCompare(right),
  );
  const opponentIdSet = new Set(opponentIds);

  const seenPerformanceEntries = new Set<string>();
  for (const observation of performanceObservations) {
    assertPerformanceObservation(observation);
    const key = JSON.stringify([observation.eventId, observation.coreId]);
    if (seenPerformanceEntries.has(key)) {
      throw new Error(
        `Duplicate performance observation: ${observation.eventId}|${observation.coreId}.`,
      );
    }
    seenPerformanceEntries.add(key);
  }
  const seenStarEvents = new Set<string>();
  for (const event of starEvents) {
    assertStarEvent(event);
    if (seenStarEvents.has(event.eventId)) {
      throw new Error(`Duplicate star event: ${event.eventId}.`);
    }
    seenStarEvents.add(event.eventId);
  }

  const matchingPerformance = performanceObservations.filter(
    (observation) =>
      opponentIdSet.has(observation.coreId) &&
      observation.mode === request.mode &&
      observation.distance === request.distance,
  );
  const priorPerformance = matchingPerformance.filter(
    (observation) => Date.parse(observation.eventAt) < eventAt,
  );
  const sameOrFuturePerformanceCount =
    matchingPerformance.length - priorPerformance.length;

  const matchingStarEvents = starEvents.filter(
    (event) =>
      event.mode === request.mode &&
      event.distance === request.distance &&
      event.entries.some(({ coreId }) => opponentIdSet.has(coreId)),
  );
  const priorStarEvents = matchingStarEvents.filter(
    (event) => Date.parse(event.eventAt) < eventAt,
  );
  const sameOrFutureStarCount =
    matchingStarEvents.length - priorStarEvents.length;
  const priorStarProfiles =
    priorStarEvents.length === 0
      ? []
      : refreshStarProfiles(priorStarEvents).profiles;
  const starProfilesByCore = new Map(
    priorStarProfiles
      .filter(
        (profile) =>
          opponentIdSet.has(profile.coreId) &&
          profile.mode === request.mode &&
          profile.distance === request.distance,
      )
      .map((profile) => [profile.coreId, profile]),
  );

  const opponents = opponentIds.map((coreId): OpponentPreRaceContext => {
    const observations = priorPerformance
      .filter((observation) => observation.coreId === coreId)
      .sort(
        (left, right) =>
          Date.parse(left.eventAt) - Date.parse(right.eventAt) ||
          left.eventId.localeCompare(right.eventId),
      );
    const sortedElapsed = observations
      .map(({ elapsedTimeMilliseconds }) => elapsedTimeMilliseconds)
      .sort((left, right) => left - right);
    return {
      coreId,
      priorExactDistanceRaceCount: observations.length,
      priorBestMilliseconds: sortedElapsed[0] ?? null,
      priorMedianMilliseconds:
        sortedElapsed.length === 0
          ? null
          : roundMetric(quantile(sortedElapsed, 0.5)),
      latestPriorRaceAt: observations.at(-1)?.eventAt ?? null,
      priorStarProfile: starProfilesByCore.get(coreId) ?? null,
    };
  });

  const knownOpponentMedians = opponents
    .map(({ priorMedianMilliseconds }) => priorMedianMilliseconds)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const knownPriorBests = opponents
    .map(({ priorBestMilliseconds }) => priorBestMilliseconds)
    .filter((value): value is number => value !== null)
    .sort((left, right) => left - right);
  const knownOpponentCount = knownOpponentMedians.length;
  const opponentStarProfileCount = opponents.filter(
    ({ priorStarProfile }) => priorStarProfile !== null,
  ).length;

  return {
    eventId: request.eventId,
    eventAt: request.eventAt,
    enteredCoreId: request.enteredCoreId,
    mode: request.mode,
    distance: request.distance,
    evidenceCutoff: {
      timestamp: request.eventAt,
      comparison: "strictly_before",
    },
    opponents,
    coverage: {
      opponentCount: opponents.length,
      opponentsWithPriorExactDistanceHistory: knownOpponentCount,
      opponentsWithoutPriorExactDistanceHistory:
        opponents.length - knownOpponentCount,
      status:
        knownOpponentCount === 0
          ? "unavailable"
          : knownOpponentCount === opponents.length
            ? "complete"
            : "partial",
    },
    fieldTimeSummary: {
      fastestKnownPriorBestMilliseconds: knownPriorBests[0] ?? null,
      medianKnownOpponentMedianMilliseconds:
        knownOpponentMedians.length === 0
          ? null
          : roundMetric(quantile(knownOpponentMedians, 0.5)),
    },
    excludedEvidence: {
      sameOrFuturePerformanceObservationCount: sameOrFuturePerformanceCount,
      sameOrFutureStarEventCount: sameOrFutureStarCount,
    },
    qualityBand: "unclassified",
    warnings: warningList({
      opponentCount: opponents.length,
      knownOpponentCount,
      opponentStarProfileCount,
      excludedPerformanceCount: sameOrFuturePerformanceCount,
      excludedStarCount: sameOrFutureStarCount,
    }),
  };
}
