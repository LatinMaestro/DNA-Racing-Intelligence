import { deriveFreshness, type FreshnessState } from "@/domain/freshness";
import type { CoreStarProfile } from "@/domain/star-signals";

export const raceModes = ["bike", "car", "horse"] as const;
export type RaceMode = (typeof raceModes)[number];

export type PerformanceObservation = {
  eventId: string;
  eventAt: string;
  coreId: string;
  mode: RaceMode;
  distance: number;
  elapsedTimeMilliseconds: number;
};

export type PerformanceSampleStatus =
  "hypothesis_only" | "minimally_analytical";

export type CorePerformanceProfile = {
  coreId: string;
  mode: RaceMode;
  distance: number;
  dataCurrentThrough: string;
  freshness: FreshnessState;
  raceCount: number;
  sampleStatus: PerformanceSampleStatus;
  elapsedTime: {
    bestMilliseconds: number;
    medianMilliseconds: number;
    meanMilliseconds: number;
    trimmedMeanMilliseconds: number;
    standardDeviationMilliseconds: number;
    interquartileRangeMilliseconds: number;
  };
  speed: {
    bestDistanceUnitsPerSecond: number;
    medianDistanceUnitsPerSecond: number;
  };
  starProfile: CoreStarProfile | null;
  analyticalStatus: "experimental";
};

const MINIMUM_ANALYTICAL_RACES = 10;

function profileKey(
  value: Pick<PerformanceObservation, "coreId" | "mode" | "distance">,
): string {
  return JSON.stringify([value.coreId, value.mode, value.distance]);
}

function assertObservation(observation: PerformanceObservation): void {
  if (
    observation.eventId.trim() === "" ||
    observation.coreId.trim() === "" ||
    Number.isNaN(Date.parse(observation.eventAt)) ||
    !raceModes.includes(observation.mode) ||
    !Number.isSafeInteger(observation.distance) ||
    observation.distance <= 0 ||
    !Number.isSafeInteger(observation.elapsedTimeMilliseconds) ||
    observation.elapsedTimeMilliseconds <= 0
  ) {
    throw new Error(
      `Invalid normalized performance observation: ${observation.eventId}`,
    );
  }
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

function mean(values: readonly number[]): number {
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function roundMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function elapsedToSpeed(
  distanceUnits: number,
  elapsedMilliseconds: number,
): number {
  return distanceUnits / (elapsedMilliseconds / 1_000);
}

function summarize(
  observations: readonly PerformanceObservation[],
  starProfile: CoreStarProfile | null,
  now: Date,
): CorePerformanceProfile {
  const first = observations[0]!;
  const sortedElapsed = observations
    .map(({ elapsedTimeMilliseconds }) => elapsedTimeMilliseconds)
    .sort((left, right) => left - right);
  const trimCount =
    sortedElapsed.length >= MINIMUM_ANALYTICAL_RACES
      ? Math.floor(sortedElapsed.length * 0.1)
      : 0;
  const trimmedElapsed =
    trimCount > 0
      ? sortedElapsed.slice(trimCount, sortedElapsed.length - trimCount)
      : sortedElapsed;
  const meanElapsed = mean(sortedElapsed);
  const standardDeviation = Math.sqrt(
    mean(sortedElapsed.map((elapsed) => (elapsed - meanElapsed) ** 2)),
  );
  const dataCurrentThrough = observations.reduce(
    (latest, observation) =>
      Date.parse(observation.eventAt) > Date.parse(latest)
        ? observation.eventAt
        : latest,
    first.eventAt,
  );
  const bestElapsed = sortedElapsed[0]!;
  const medianElapsed = quantile(sortedElapsed, 0.5);

  return {
    coreId: first.coreId,
    mode: first.mode,
    distance: first.distance,
    dataCurrentThrough,
    freshness: deriveFreshness(new Date(dataCurrentThrough), now),
    raceCount: sortedElapsed.length,
    sampleStatus:
      sortedElapsed.length >= MINIMUM_ANALYTICAL_RACES
        ? "minimally_analytical"
        : "hypothesis_only",
    elapsedTime: {
      bestMilliseconds: bestElapsed,
      medianMilliseconds: roundMetric(medianElapsed),
      meanMilliseconds: roundMetric(meanElapsed),
      trimmedMeanMilliseconds: roundMetric(mean(trimmedElapsed)),
      standardDeviationMilliseconds: roundMetric(standardDeviation),
      interquartileRangeMilliseconds: roundMetric(
        quantile(sortedElapsed, 0.75) - quantile(sortedElapsed, 0.25),
      ),
    },
    speed: {
      bestDistanceUnitsPerSecond: roundMetric(
        elapsedToSpeed(first.distance, bestElapsed),
      ),
      medianDistanceUnitsPerSecond: roundMetric(
        elapsedToSpeed(first.distance, medianElapsed),
      ),
    },
    starProfile,
    analyticalStatus: "experimental",
  };
}

export function buildCorePerformanceProfiles(
  observations: readonly PerformanceObservation[],
  starProfiles: readonly CoreStarProfile[],
  now: Date,
): readonly CorePerformanceProfile[] {
  if (Number.isNaN(now.getTime()))
    throw new Error("A valid current time is required.");

  const seenRaceEntries = new Set<string>();
  const groupedObservations = new Map<string, PerformanceObservation[]>();

  for (const observation of observations) {
    assertObservation(observation);
    const raceEntryKey = JSON.stringify([
      observation.eventId,
      observation.coreId,
    ]);
    if (seenRaceEntries.has(raceEntryKey)) {
      throw new Error(
        `Duplicate performance observation: ${observation.eventId}|${observation.coreId}`,
      );
    }
    seenRaceEntries.add(raceEntryKey);

    const key = profileKey(observation);
    const group = groupedObservations.get(key) ?? [];
    group.push(observation);
    groupedObservations.set(key, group);
  }

  const starsByProfile = new Map<string, CoreStarProfile>();
  for (const starProfile of starProfiles) {
    const key = profileKey(starProfile);
    if (starsByProfile.has(key))
      throw new Error(
        `Duplicate star profile: ${starProfile.coreId}|${starProfile.mode}|${starProfile.distance}`,
      );
    starsByProfile.set(key, starProfile);
  }

  return [...groupedObservations.entries()]
    .map(([key, group]) =>
      summarize(group, starsByProfile.get(key) ?? null, now),
    )
    .sort(
      (left, right) =>
        left.coreId.localeCompare(right.coreId) ||
        left.mode.localeCompare(right.mode) ||
        left.distance - right.distance,
    );
}
