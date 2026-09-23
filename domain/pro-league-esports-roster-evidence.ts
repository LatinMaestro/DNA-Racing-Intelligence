import type {
  ProLeagueEsportsBenchmark,
  ProLeagueEsportsWinningCell,
} from "@/domain/pro-league-esports-benchmark";
import {
  assertValidProLeagueExactFormatEvidence,
  type ProLeagueExactFormatEvidence,
  type ProLeagueExactFormatPopulationBenchmark,
  type ProLeagueMatchupAssessment,
} from "@/domain/pro-league-matchup";

function canonicalRaceType(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

function exactCell(
  benchmark: ProLeagueEsportsBenchmark,
  raceType: string,
  distanceMetres: number,
): ProLeagueEsportsWinningCell {
  if (benchmark.authority !== "completed_official_esports_races") {
    throw new Error("Official completed Esports authority is required.");
  }
  const normalized = canonicalRaceType(raceType);
  const cells = benchmark.cells.filter(
    (cell) =>
      canonicalRaceType(cell.raceType) === normalized &&
      cell.distanceMetres === distanceMetres,
  );
  if (cells.length !== 1) {
    throw new Error(
      `Exactly one official Esports benchmark is required for ${normalized} at ${distanceMetres}m.`,
    );
  }
  return cells[0]!;
}

export function hasOfficialEsportsBenchmark(input: {
  benchmark: ProLeagueEsportsBenchmark;
  raceType: string;
  distanceMetres: number;
}): boolean {
  if (input.benchmark.authority !== "completed_official_esports_races") {
    throw new Error("Official completed Esports authority is required.");
  }
  const normalized = canonicalRaceType(input.raceType);
  const cells = input.benchmark.cells.filter(
    (cell) =>
      canonicalRaceType(cell.raceType) === normalized &&
      cell.distanceMetres === input.distanceMetres,
  );
  if (cells.length > 1) {
    throw new Error(
      `At most one official Esports benchmark is allowed for ${normalized} at ${input.distanceMetres}m.`,
    );
  }
  return cells.length === 1;
}

export function toProLeagueExactFormatPopulationBenchmark(input: {
  benchmark: ProLeagueEsportsBenchmark;
  raceType: string;
  distanceMetres: number;
}): ProLeagueExactFormatPopulationBenchmark {
  const cell = exactCell(input.benchmark, input.raceType, input.distanceMetres);
  const winning = cell.firstPlaceTimes;
  const positive = cell.positiveContributorTimes;
  return Object.freeze({
    dataCurrentThrough: input.benchmark.dataCurrentThrough,
    raceEntryCount: cell.raceCount * cell.gateCount,
    coreCount: cell.uniqueCoreCount,
    winningEntryCount: winning.observationCount,
    topThreeEntryCount: positive.observationCount,
    winningP25Milliseconds: winning.lowerQuartileMilliseconds,
    winningMedianMilliseconds: winning.medianMilliseconds,
    winningP75Milliseconds: winning.upperQuartileMilliseconds,
    winningStandardDeviationMilliseconds: winning.standardDeviationMilliseconds,
    winningInterquartileRangeMilliseconds:
      winning.interquartileRangeMilliseconds,
    topThreeP25Milliseconds: positive.lowerQuartileMilliseconds,
    topThreeMedianMilliseconds: positive.medianMilliseconds,
    topThreeP75Milliseconds: positive.upperQuartileMilliseconds,
    topThreeStandardDeviationMilliseconds:
      positive.standardDeviationMilliseconds,
    topThreeInterquartileRangeMilliseconds:
      positive.interquartileRangeMilliseconds,
  });
}

function assessment(
  evidence: ProLeagueExactFormatEvidence,
  benchmark: ProLeagueExactFormatPopulationBenchmark,
): ProLeagueMatchupAssessment {
  if (
    evidence.elapsedTime.medianMilliseconds <=
      benchmark.winningMedianMilliseconds &&
    evidence.elapsedTime.trimmedMeanMilliseconds <=
      benchmark.winningP75Milliseconds
  ) {
    return "winning_range";
  }
  if (
    evidence.elapsedTime.medianMilliseconds <=
      benchmark.topThreeMedianMilliseconds &&
    evidence.elapsedTime.trimmedMeanMilliseconds <=
      benchmark.topThreeP75Milliseconds
  ) {
    return "top_three_range";
  }
  return "outside_top_three_range";
}

export function applyOfficialEsportsBenchmark(
  evidence: ProLeagueExactFormatEvidence,
  benchmark: ProLeagueEsportsBenchmark,
): ProLeagueExactFormatEvidence {
  const populationBenchmark = toProLeagueExactFormatPopulationBenchmark({
    benchmark,
    raceType: evidence.raceType,
    distanceMetres: evidence.distanceMetres,
  });
  const result: ProLeagueExactFormatEvidence = Object.freeze({
    ...evidence,
    benchmarkAssessment: assessment(evidence, populationBenchmark),
    populationBenchmark,
  });
  assertValidProLeagueExactFormatEvidence(result);
  return result;
}
