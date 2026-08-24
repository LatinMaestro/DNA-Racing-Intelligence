import type { RaceMode } from "@/domain/import-contract";
import type {
  RaceArchiveCoreAnalyticalObservation,
  RaceArchiveCoreAnalyticalObservationSet,
} from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type RaceArchiveCorePerformanceProfile = Readonly<{
  sourceCoreId: string;
  mode: RaceMode;
  distance: number;
  dataCurrentThrough: string;
  raceCount: number;
  bestMilliseconds: number;
  medianMilliseconds: number;
  meanMilliseconds: number;
  trimmedMeanMilliseconds: number;
  standardDeviationMilliseconds: number;
  interquartileRangeMilliseconds: number;
  bestMetresPerSecond: number;
  medianMetresPerSecond: number;
}>;

function safeText(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 512 ||
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

function normalizedTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function percentileCont(sorted: readonly number[], fraction: number): number {
  if (sorted.length < 1) {
    throw new Error("Performance percentile requires observations.");
  }
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("Performance percentile index is unavailable.");
  }
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function average(values: readonly number[]): number {
  if (values.length < 1) {
    throw new Error("Performance mean requires observations.");
  }
  return values.reduce((total, value) => total + value, 0) / values.length;
}

function profile(input: {
  sourceCoreId: string;
  mode: RaceMode;
  distance: number;
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
}): RaceArchiveCorePerformanceProfile {
  const elapsed = input.observations
    .map((observation) =>
      positiveSafeInteger(
        observation.elapsedMilliseconds,
        "observation.elapsedMilliseconds",
      ),
    )
    .sort((left, right) => left - right);
  const meanMilliseconds = average(elapsed);
  const trimCount = elapsed.length < 10 ? 0 : Math.floor(elapsed.length * 0.1);
  const trimmed =
    trimCount === 0 ? elapsed : elapsed.slice(trimCount, elapsed.length - trimCount);
  const medianMilliseconds = percentileCont(elapsed, 0.5);
  const variance =
    elapsed.reduce(
      (total, value) => total + (value - meanMilliseconds) ** 2,
      0,
    ) / elapsed.length;
  const dataCurrentThrough = input.observations.reduce<string | null>(
    (latest, observation) => {
      const timestamp = normalizedTimestamp(
        observation.eventAt,
        "observation.eventAt",
      );
      return latest === null || timestamp > latest ? timestamp : latest;
    },
    null,
  );
  if (dataCurrentThrough === null) {
    throw new Error("Performance profile has no chronology evidence.");
  }
  const bestMilliseconds = elapsed[0];
  if (bestMilliseconds === undefined) {
    throw new Error("Performance profile has no best observation.");
  }
  return Object.freeze({
    sourceCoreId: input.sourceCoreId,
    mode: input.mode,
    distance: input.distance,
    dataCurrentThrough,
    raceCount: elapsed.length,
    bestMilliseconds,
    medianMilliseconds,
    meanMilliseconds,
    trimmedMeanMilliseconds: average(trimmed),
    standardDeviationMilliseconds: Math.sqrt(variance),
    interquartileRangeMilliseconds:
      percentileCont(elapsed, 0.75) - percentileCont(elapsed, 0.25),
    bestMetresPerSecond: input.distance / (bestMilliseconds / 1000),
    medianMetresPerSecond: input.distance / (medianMilliseconds / 1000),
  });
}

export function corePerformanceProfilesFromRaceArchive(input: {
  observationSet: RaceArchiveCoreAnalyticalObservationSet;
  maximumObservations: number;
  maximumProfiles: number;
}): readonly RaceArchiveCorePerformanceProfile[] {
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    1_000_000,
  );
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    100_000,
  );
  const sourceCoreId = safeText(
    input.observationSet.sourceCoreId,
    "observationSet.sourceCoreId",
  );
  if (input.observationSet.observations.length > maximumObservations) {
    throw new Error("Archive Core Performance observation bound was exceeded.");
  }

  const groups = new Map<
    string,
    {
      mode: RaceMode;
      distance: number;
      observations: RaceArchiveCoreAnalyticalObservation[];
    }
  >();
  const naturalKeys = new Set<string>();
  for (const observation of input.observationSet.observations) {
    if (safeText(observation.sourceCoreId, "observation.sourceCoreId") !== sourceCoreId) {
      throw new Error("Archive Core Performance observation changed Core identity.");
    }
    const naturalKey = safeText(observation.naturalKey, "observation.naturalKey");
    if (naturalKeys.has(naturalKey)) {
      throw new Error("Archive Core Performance contains duplicate Race evidence.");
    }
    naturalKeys.add(naturalKey);
    if (!RACE_MODES.has(observation.mode)) {
      throw new Error("Archive Core Performance mode is invalid.");
    }
    const distance = positiveSafeInteger(
      observation.distance,
      "observation.distance",
    );
    const key = `${observation.mode}:${distance}`;
    let group = groups.get(key);
    if (group === undefined) {
      if (groups.size >= maximumProfiles) {
        throw new Error("Archive Core Performance profile bound was exceeded.");
      }
      group = { mode: observation.mode, distance, observations: [] };
      groups.set(key, group);
    }
    group.observations.push(observation);
  }

  return Object.freeze(
    [...groups.values()]
      .sort(
        (left, right) =>
          left.mode.localeCompare(right.mode) || left.distance - right.distance,
      )
      .map((group) =>
        profile({
          sourceCoreId,
          mode: group.mode,
          distance: group.distance,
          observations: group.observations,
        }),
      ),
  );
}
