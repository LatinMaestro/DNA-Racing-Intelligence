import type { DiscoveryExactDistanceBenchmarkEvidence } from "@/domain/discovery-benchmark";
import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

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

function normalizedTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function percentileCont(sorted: readonly number[], fraction: number): number {
  if (sorted.length < 1) {
    throw new Error("Discovery benchmark percentile requires observations.");
  }
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex];
  const upper = sorted[upperIndex];
  if (lower === undefined || upper === undefined) {
    throw new Error("Discovery benchmark percentile index is unavailable.");
  }
  if (lowerIndex === upperIndex) return lower;
  return lower + (upper - lower) * (position - lowerIndex);
}

function percentiles(values: readonly number[]): Readonly<{
  p25: number;
  median: number;
  p75: number;
}> {
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    p25: percentileCont(sorted, 0.25),
    median: percentileCont(sorted, 0.5),
    p75: percentileCont(sorted, 0.75),
  });
}

export function discoveryExactDistanceBenchmarksFromRaceArchive(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  refreshedAt: string;
  maximumObservations: number;
  maximumBenchmarks: number;
}): readonly DiscoveryExactDistanceBenchmarkEvidence[] {
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    5_000_000,
  );
  const maximumBenchmarks = positiveBound(
    input.maximumBenchmarks,
    "maximumBenchmarks",
    100_000,
  );
  if (input.observations.length > maximumObservations) {
    throw new Error("Archive Discovery observation bound was exceeded.");
  }
  const refreshedAt = normalizedTimestamp(input.refreshedAt, "refreshedAt");

  const groups = new Map<
    string,
    {
      mode: RaceMode;
      distance: number;
      latestEventAt: string;
      raceEntryCount: number;
      winning: number[];
      topThree: number[];
    }
  >();
  const naturalKeys = new Set<string>();

  for (const observation of input.observations) {
    const naturalKey = safeText(observation.naturalKey, "observation.naturalKey");
    if (naturalKeys.has(naturalKey)) {
      throw new Error("Archive Discovery contains duplicate Race evidence.");
    }
    naturalKeys.add(naturalKey);
    if (!RACE_MODES.has(observation.mode)) {
      throw new Error("Archive Discovery mode is invalid.");
    }
    const distance = positiveSafeInteger(
      observation.distance,
      "observation.distance",
    );
    const finishPosition = positiveSafeInteger(
      observation.finishPosition,
      "observation.finishPosition",
    );
    const elapsedMilliseconds = positiveSafeInteger(
      observation.elapsedMilliseconds,
      "observation.elapsedMilliseconds",
    );
    const eventAt = normalizedTimestamp(observation.eventAt, "observation.eventAt");
    const key = `${observation.mode}:${distance}`;
    let group = groups.get(key);
    if (group === undefined) {
      if (groups.size >= maximumBenchmarks) {
        throw new Error("Archive Discovery benchmark bound was exceeded.");
      }
      group = {
        mode: observation.mode,
        distance,
        latestEventAt: eventAt,
        raceEntryCount: 0,
        winning: [],
        topThree: [],
      };
      groups.set(key, group);
    }
    group.raceEntryCount += 1;
    if (eventAt > group.latestEventAt) group.latestEventAt = eventAt;
    if (finishPosition === 1) group.winning.push(elapsedMilliseconds);
    if (finishPosition <= 3) group.topThree.push(elapsedMilliseconds);
  }

  return Object.freeze(
    [...groups.values()]
      .filter((group) => group.winning.length > 0 && group.topThree.length > 0)
      .sort(
        (left, right) =>
          left.mode.localeCompare(right.mode) || left.distance - right.distance,
      )
      .map((group) => {
        const winning = percentiles(group.winning);
        const topThree = percentiles(group.topThree);
        return Object.freeze({
          mode: group.mode,
          distanceMetres: group.distance,
          dataCurrentThrough: group.latestEventAt,
          raceEntryCount: group.raceEntryCount,
          winningEntryCount: group.winning.length,
          topThreeEntryCount: group.topThree.length,
          winningP25Milliseconds: winning.p25,
          winningMedianMilliseconds: winning.median,
          winningP75Milliseconds: winning.p75,
          topThreeP25Milliseconds: topThree.p25,
          topThreeMedianMilliseconds: topThree.median,
          topThreeP75Milliseconds: topThree.p75,
          refreshedAt,
        });
      }),
  );
}
