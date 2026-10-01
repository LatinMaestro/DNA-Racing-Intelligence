import { deriveFreshness } from "@/domain/freshness";
import {
  coreEsportsResultRule,
  type CoreEsportsResultRule,
} from "@/domain/core-esports-performance";
import { proLeagueMaps, type ProLeagueMapId } from "@/domain/pro-league-maps";
import type {
  ProLeagueExactFormatEvidence,
  ProLeagueExactFormatPopulationBenchmark,
  ProLeagueMatchupAssessment,
} from "@/domain/pro-league-matchup";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type RaceArchiveProLeagueExactFormatBenchmark =
  ProLeagueExactFormatPopulationBenchmark &
    Readonly<{
      raceType: string;
      distanceMetres: number;
      resultRule: CoreEsportsResultRule;
      mapIds: readonly ProLeagueMapId[];
      refreshedAt: string;
    }>;

export type RaceArchiveProLeagueExactFormatProfile =
  ProLeagueExactFormatEvidence & Readonly<{ sourceCoreId: string }>;

export type RaceArchiveProLeagueExactFormatBuild = Readonly<{
  inputObservationCount: number;
  acceptedPublishedCellEntryCount: number;
  nonBikeEntryCount: number;
  missingFormatEntryCount: number;
  unsupportedFormatEntryCount: number;
  unpublishedCellEntryCount: number;
  unbenchmarkedPublishedCellEntryCount: number;
  benchmarks: readonly RaceArchiveProLeagueExactFormatBenchmark[];
  profiles: readonly RaceArchiveProLeagueExactFormatProfile[];
}>;

type PublishedCell = Readonly<{
  raceType: string;
  distanceMetres: number;
  mapIds: readonly ProLeagueMapId[];
}>;

type AcceptedObservation = Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  cell: PublishedCell;
}>;

function cellKey(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.toLowerCase(), distanceMetres]);
}

const publishedCells: ReadonlyMap<string, PublishedCell> = (() => {
  const values = new Map<
    string,
    { raceType: string; distanceMetres: number; mapIds: Set<ProLeagueMapId> }
  >();
  for (const map of proLeagueMaps) {
    for (const race of map.races) {
      const key = cellKey(race.raceType, race.distanceMetres);
      const existing = values.get(key) ?? {
        raceType: race.raceType,
        distanceMetres: race.distanceMetres,
        mapIds: new Set<ProLeagueMapId>(),
      };
      existing.mapIds.add(map.mapId);
      values.set(key, existing);
    }
  }
  return new Map(
    [...values.entries()].map(([key, value]) => [
      key,
      Object.freeze({
        raceType: value.raceType,
        distanceMetres: value.distanceMetres,
        mapIds: Object.freeze([...value.mapIds].sort()),
      }),
    ]),
  );
})();

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
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

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function normalizedPayoutFormat(value: string): string {
  return safeText(value, "observation.payoutMechanismSourceValue")
    .toLowerCase()
    .replace(/[\s_-]+/gu, " ")
    .trim();
}

export function publishedProLeagueRaceTypeFromArchive(input: {
  payoutMechanismSourceValue: string | null;
  gateCount: number;
  distanceMetres: number;
}):
  | Readonly<{ status: "accepted"; cell: PublishedCell }>
  | Readonly<{
      status: "missing_format" | "unsupported_format" | "unpublished_cell";
    }> {
  const gateCount = positiveInteger(input.gateCount, "gateCount");
  const distanceMetres = positiveInteger(
    input.distanceMetres,
    "distanceMetres",
  );
  if (input.payoutMechanismSourceValue === null) {
    return Object.freeze({ status: "missing_format" });
  }
  const payout = normalizedPayoutFormat(input.payoutMechanismSourceValue);
  const raceType =
    payout === "winner take all" || payout === "wta"
      ? gateCount === 2
        ? "1v1"
        : `${gateCount} gate WTA`
      : payout === "top 3" || payout === "top3" || payout === "top three"
        ? `${gateCount} gate madness`
        : null;
  if (raceType === null) {
    return Object.freeze({ status: "unsupported_format" });
  }
  const cell = publishedCells.get(cellKey(raceType, distanceMetres));
  return cell === undefined
    ? Object.freeze({ status: "unpublished_cell" })
    : Object.freeze({ status: "accepted", cell });
}

function percentile(sorted: readonly number[], fraction: number): number {
  if (sorted.length === 0) throw new Error("Percentile requires observations");
  const position = (sorted.length - 1) * fraction;
  const lowerIndex = Math.floor(position);
  const upperIndex = Math.ceil(position);
  const lower = sorted[lowerIndex]!;
  const upper = sorted[upperIndex]!;
  return lowerIndex === upperIndex
    ? lower
    : lower + (upper - lower) * (position - lowerIndex);
}

function mean(values: readonly number[]): number {
  if (values.length === 0) throw new Error("Mean requires observations");
  return values.reduce((total, value) => total + value, 0) / values.length;
}

export function roundedProLeagueExactFormatMetric(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function distribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(sorted);
  const variance = mean(sorted.map((value) => (value - average) ** 2));
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  return Object.freeze({
    p25Milliseconds: roundedProLeagueExactFormatMetric(p25),
    medianMilliseconds: roundedProLeagueExactFormatMetric(
      percentile(sorted, 0.5),
    ),
    p75Milliseconds: roundedProLeagueExactFormatMetric(p75),
    standardDeviationMilliseconds: roundedProLeagueExactFormatMetric(
      Math.sqrt(variance),
    ),
    interquartileRangeMilliseconds: roundedProLeagueExactFormatMetric(
      p75 - p25,
    ),
  });
}

function profileDistribution(values: readonly number[]) {
  const sorted = [...values].sort((left, right) => left - right);
  const average = mean(sorted);
  const trimCount = sorted.length < 10 ? 0 : Math.floor(sorted.length * 0.1);
  const trimmed =
    trimCount === 0
      ? sorted
      : sorted.slice(trimCount, sorted.length - trimCount);
  const p25 = percentile(sorted, 0.25);
  const p75 = percentile(sorted, 0.75);
  return Object.freeze({
    bestMilliseconds: sorted[0]!,
    medianMilliseconds: roundedProLeagueExactFormatMetric(
      percentile(sorted, 0.5),
    ),
    trimmedMeanMilliseconds: roundedProLeagueExactFormatMetric(mean(trimmed)),
    standardDeviationMilliseconds: roundedProLeagueExactFormatMetric(
      Math.sqrt(mean(sorted.map((value) => (value - average) ** 2))),
    ),
    interquartileRangeMilliseconds: roundedProLeagueExactFormatMetric(
      p75 - p25,
    ),
  });
}

export function proLeagueExactFormatBenchmarkAssessment(input: {
  elapsedTime: RaceArchiveProLeagueExactFormatProfile["elapsedTime"];
  benchmark: ProLeagueExactFormatPopulationBenchmark;
}): ProLeagueMatchupAssessment {
  if (
    input.elapsedTime.medianMilliseconds <=
      input.benchmark.winningMedianMilliseconds &&
    input.elapsedTime.trimmedMeanMilliseconds <=
      input.benchmark.winningP75Milliseconds
  ) {
    return "winning_range";
  }
  if (
    input.elapsedTime.medianMilliseconds <=
      input.benchmark.topThreeMedianMilliseconds &&
    input.elapsedTime.trimmedMeanMilliseconds <=
      input.benchmark.topThreeP75Milliseconds
  ) {
    return "top_three_range";
  }
  return "outside_top_three_range";
}

export function unavailableProLeagueExactFormatSupportingEvidence(input: {
  winCount: number;
  topThreeCount: number;
}): RaceArchiveProLeagueExactFormatProfile["supportingEvidence"] {
  return Object.freeze({
    outcomes: Object.freeze({
      status: "available" as const,
      winCount: input.winCount,
      topThreeCount: input.topThreeCount,
    }),
    goldStar: Object.freeze({
      status: "unavailable" as const,
      assignedCount: 0,
      eligibleRaceCount: 0,
    }),
    blueStar: Object.freeze({
      status: "unavailable" as const,
      assignedCount: 0,
      opportunityCount: 0,
    }),
    oppositionAdjustedStars: Object.freeze({
      status: "unavailable" as const,
      qualityKnownRaceCount: 0,
      strongFieldYellowReceivedCount: 0,
      strongFieldBlueReceivedCount: 0,
      eliteOpponentYellowReceivedCount: 0,
      eliteOpponentBlueReceivedCount: 0,
      yellowFieldAdjustedIndex: null,
      blueFieldAdjustedIndex: null,
      rawConversionUsedForRanking: false as const,
    }),
    strongOpposition: Object.freeze({
      status: "unavailable" as const,
      raceCount: 0,
      winCount: 0,
      topThreeCount: 0,
    }),
  });
}

export function proLeagueExactFormatEvidenceFromRaceArchive(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  refreshedAt: string;
  maximumObservations: number;
  maximumBenchmarks: number;
  maximumProfiles: number;
}): RaceArchiveProLeagueExactFormatBuild {
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
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    500_000,
  );
  if (input.observations.length > maximumObservations) {
    throw new Error("Pro League exact-format observation bound was exceeded");
  }
  const refreshedAt = timestamp(input.refreshedAt, "refreshedAt");
  const refreshedAtMs = Date.parse(refreshedAt);
  const naturalKeys = new Set<string>();
  const accepted: AcceptedObservation[] = [];
  let nonBikeEntryCount = 0;
  let missingFormatEntryCount = 0;
  let unsupportedFormatEntryCount = 0;
  let unpublishedCellEntryCount = 0;

  for (const observation of input.observations) {
    const naturalKey = safeText(
      observation.naturalKey,
      "observation.naturalKey",
    );
    if (naturalKeys.has(naturalKey)) {
      throw new Error(
        "Pro League exact-format evidence contains a duplicate race entry",
      );
    }
    naturalKeys.add(naturalKey);
    const eventAt = timestamp(observation.eventAt, "observation.eventAt");
    if (Date.parse(eventAt) > refreshedAtMs) {
      throw new Error(
        "Pro League exact-format evidence exceeds its point-in-time cutoff",
      );
    }
    if (observation.mode !== "bike") {
      nonBikeEntryCount += 1;
      continue;
    }
    const finishPosition = positiveInteger(
      observation.finishPosition,
      "observation.finishPosition",
    );
    if (finishPosition > observation.gateCount) {
      throw new Error(
        "observation.finishPosition cannot exceed observation.gateCount",
      );
    }
    positiveInteger(
      observation.elapsedMilliseconds,
      "observation.elapsedMilliseconds",
    );
    const authority = publishedProLeagueRaceTypeFromArchive({
      payoutMechanismSourceValue: observation.payoutMechanismSourceValue,
      gateCount: observation.gateCount,
      distanceMetres: observation.distance,
    });
    if (authority.status !== "accepted") {
      if (authority.status === "missing_format") missingFormatEntryCount += 1;
      if (authority.status === "unsupported_format")
        unsupportedFormatEntryCount += 1;
      if (authority.status === "unpublished_cell")
        unpublishedCellEntryCount += 1;
      continue;
    }
    accepted.push(Object.freeze({ observation, cell: authority.cell }));
  }

  const byCell = new Map<string, AcceptedObservation[]>();
  for (const value of accepted) {
    const key = cellKey(value.cell.raceType, value.cell.distanceMetres);
    const group = byCell.get(key) ?? [];
    group.push(value);
    byCell.set(key, group);
  }
  if (byCell.size > maximumBenchmarks) {
    throw new Error("Pro League exact-format benchmark bound was exceeded");
  }

  const benchmarks: RaceArchiveProLeagueExactFormatBenchmark[] = [];
  const benchmarkByCell = new Map<
    string,
    RaceArchiveProLeagueExactFormatBenchmark
  >();
  let unbenchmarkedPublishedCellEntryCount = 0;
  for (const [key, values] of byCell) {
    const winning = values
      .filter(({ observation }) => observation.finishPosition === 1)
      .map(({ observation }) => observation.elapsedMilliseconds);
    const topThree = values
      .filter(({ observation }) => observation.finishPosition <= 3)
      .map(({ observation }) => observation.elapsedMilliseconds);
    if (winning.length === 0 || topThree.length === 0) {
      unbenchmarkedPublishedCellEntryCount += values.length;
      continue;
    }
    const winner = distribution(winning);
    const podium = distribution(topThree);
    const first = values[0]!.cell;
    const benchmark = Object.freeze({
      raceType: first.raceType,
      distanceMetres: first.distanceMetres,
      resultRule: coreEsportsResultRule(first.raceType),
      mapIds: first.mapIds,
      dataCurrentThrough: values
        .map(({ observation }) =>
          timestamp(observation.eventAt, "observation.eventAt"),
        )
        .sort()
        .at(-1)!,
      raceEntryCount: values.length,
      coreCount: new Set(
        values.map(({ observation }) => observation.sourceCoreId),
      ).size,
      winningEntryCount: winning.length,
      topThreeEntryCount: topThree.length,
      winningP25Milliseconds: winner.p25Milliseconds,
      winningMedianMilliseconds: winner.medianMilliseconds,
      winningP75Milliseconds: winner.p75Milliseconds,
      winningStandardDeviationMilliseconds:
        winner.standardDeviationMilliseconds,
      winningInterquartileRangeMilliseconds:
        winner.interquartileRangeMilliseconds,
      topThreeP25Milliseconds: podium.p25Milliseconds,
      topThreeMedianMilliseconds: podium.medianMilliseconds,
      topThreeP75Milliseconds: podium.p75Milliseconds,
      topThreeStandardDeviationMilliseconds:
        podium.standardDeviationMilliseconds,
      topThreeInterquartileRangeMilliseconds:
        podium.interquartileRangeMilliseconds,
      refreshedAt,
    });
    benchmarks.push(benchmark);
    benchmarkByCell.set(key, benchmark);
  }

  const byCoreCell = new Map<string, AcceptedObservation[]>();
  for (const value of accepted) {
    const key = JSON.stringify([
      value.observation.sourceCoreId,
      value.cell.raceType.toLowerCase(),
      value.cell.distanceMetres,
    ]);
    const group = byCoreCell.get(key) ?? [];
    group.push(value);
    byCoreCell.set(key, group);
  }
  if (byCoreCell.size > maximumProfiles) {
    throw new Error("Pro League exact-format profile bound was exceeded");
  }

  const profiles = [...byCoreCell.values()].flatMap(
    (values): RaceArchiveProLeagueExactFormatProfile[] => {
      const first = values[0]!;
      const benchmark = benchmarkByCell.get(
        cellKey(first.cell.raceType, first.cell.distanceMetres),
      );
      if (benchmark === undefined) return [];
      const elapsedTime = profileDistribution(
        values.map(({ observation }) => observation.elapsedMilliseconds),
      );
      const dataCurrentThrough = values
        .map(({ observation }) =>
          timestamp(observation.eventAt, "observation.eventAt"),
        )
        .sort()
        .at(-1)!;
      const populationBenchmark: ProLeagueExactFormatPopulationBenchmark =
        Object.freeze({
          dataCurrentThrough: benchmark.dataCurrentThrough,
          raceEntryCount: benchmark.raceEntryCount,
          coreCount: benchmark.coreCount,
          winningEntryCount: benchmark.winningEntryCount,
          topThreeEntryCount: benchmark.topThreeEntryCount,
          winningP25Milliseconds: benchmark.winningP25Milliseconds,
          winningMedianMilliseconds: benchmark.winningMedianMilliseconds,
          winningP75Milliseconds: benchmark.winningP75Milliseconds,
          winningStandardDeviationMilliseconds:
            benchmark.winningStandardDeviationMilliseconds,
          winningInterquartileRangeMilliseconds:
            benchmark.winningInterquartileRangeMilliseconds,
          topThreeP25Milliseconds: benchmark.topThreeP25Milliseconds,
          topThreeMedianMilliseconds: benchmark.topThreeMedianMilliseconds,
          topThreeP75Milliseconds: benchmark.topThreeP75Milliseconds,
          topThreeStandardDeviationMilliseconds:
            benchmark.topThreeStandardDeviationMilliseconds,
          topThreeInterquartileRangeMilliseconds:
            benchmark.topThreeInterquartileRangeMilliseconds,
        });
      return [
        Object.freeze({
          sourceCoreId: safeText(
            first.observation.sourceCoreId,
            "observation.sourceCoreId",
          ),
          raceType: first.cell.raceType,
          distanceMetres: first.cell.distanceMetres,
          raceCount: values.length,
          sampleStatus:
            values.length >= 10
              ? ("minimally_analytical" as const)
              : ("hypothesis_only" as const),
          freshness: deriveFreshness(
            new Date(dataCurrentThrough),
            new Date(refreshedAt),
          ),
          dataCurrentThrough,
          benchmarkAssessment: proLeagueExactFormatBenchmarkAssessment({
            elapsedTime,
            benchmark: populationBenchmark,
          }),
          elapsedTime,
          speed: Object.freeze({
            bestMetresPerSecond: roundedProLeagueExactFormatMetric(
              first.cell.distanceMetres /
                (elapsedTime.bestMilliseconds / 1_000),
            ),
            medianMetresPerSecond: roundedProLeagueExactFormatMetric(
              first.cell.distanceMetres /
                (elapsedTime.medianMilliseconds / 1_000),
            ),
          }),
          populationBenchmark,
          supportingEvidence: unavailableProLeagueExactFormatSupportingEvidence(
            {
              winCount: values.filter(
                ({ observation }) => observation.finishPosition === 1,
              ).length,
              topThreeCount: values.filter(
                ({ observation }) => observation.finishPosition <= 3,
              ).length,
            },
          ),
        }),
      ];
    },
  );

  return Object.freeze({
    inputObservationCount: input.observations.length,
    acceptedPublishedCellEntryCount: accepted.length,
    nonBikeEntryCount,
    missingFormatEntryCount,
    unsupportedFormatEntryCount,
    unpublishedCellEntryCount,
    unbenchmarkedPublishedCellEntryCount,
    benchmarks: Object.freeze(
      benchmarks.sort(
        (left, right) =>
          left.raceType.localeCompare(right.raceType) ||
          left.distanceMetres - right.distanceMetres,
      ),
    ),
    profiles: Object.freeze(
      profiles.sort(
        (left, right) =>
          left.sourceCoreId.localeCompare(right.sourceCoreId) ||
          left.raceType.localeCompare(right.raceType) ||
          left.distanceMetres - right.distanceMetres,
      ),
    ),
  });
}
