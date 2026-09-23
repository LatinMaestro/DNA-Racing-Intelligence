import weekOneAuthority from "@/docs/research/pro-league-season1-week1-exact-cells.json";

import type {
  ProLeagueEsportsBenchmark,
  ProLeagueEsportsTimeDistribution,
  ProLeagueEsportsWinningCell,
} from "@/domain/pro-league-esports-benchmark";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MILLIS_PER_SECOND = 1_000;

function record(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} is invalid.`);
  }
  return value as Record<string, unknown>;
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid.`);
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 2_000 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function integer(value: unknown, field: string): number {
  if (!Number.isSafeInteger(value) || (value as number) < 1) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value as number;
}

function seconds(value: unknown, field: string, allowZero = false): number {
  if (
    typeof value !== "number" ||
    !Number.isFinite(value) ||
    (allowZero ? value < 0 : value <= 0)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return value * MILLIS_PER_SECOND;
}

function timestamp(value: unknown, field: string): string {
  const result = text(value, field);
  const parsed = new Date(result);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== result) {
    throw new Error(`${field} must be a canonical UTC timestamp.`);
  }
  return result;
}

function close(left: number, right: number): boolean {
  return Math.abs(left - right) <= 0.000_001;
}

function distribution(
  value: unknown,
  field: string,
): ProLeagueEsportsTimeDistribution {
  const source = record(value, field);
  const result = Object.freeze({
    observationCount: integer(source.n, `${field} count`),
    fastestMilliseconds: seconds(source.fastest_seconds, `${field} fastest`),
    lowerQuartileMilliseconds: seconds(source.p25_seconds, `${field} p25`),
    medianMilliseconds: seconds(source.median_seconds, `${field} median`),
    upperQuartileMilliseconds: seconds(source.p75_seconds, `${field} p75`),
    slowestMilliseconds: seconds(source.slowest_seconds, `${field} slowest`),
    standardDeviationMilliseconds: seconds(
      source.standard_deviation_seconds,
      `${field} standard deviation`,
      true,
    ),
    interquartileRangeMilliseconds: seconds(
      source.interquartile_range_seconds,
      `${field} interquartile range`,
      true,
    ),
  });
  if (
    result.fastestMilliseconds > result.lowerQuartileMilliseconds ||
    result.lowerQuartileMilliseconds > result.medianMilliseconds ||
    result.medianMilliseconds > result.upperQuartileMilliseconds ||
    result.upperQuartileMilliseconds > result.slowestMilliseconds ||
    !close(
      result.interquartileRangeMilliseconds,
      result.upperQuartileMilliseconds - result.lowerQuartileMilliseconds,
    )
  ) {
    throw new Error(`${field} distribution is inconsistent.`);
  }
  return result;
}

function canonicalRaceType(value: string): string {
  return value.trim().toLowerCase().replaceAll("_", " ").replace(/\s+/gu, " ");
}

function winningCell(
  value: unknown,
  index: number,
): ProLeagueEsportsWinningCell {
  const field = `Week 1 Esports cell ${index + 1}`;
  const source = record(value, field);
  const scoring = text(source.scoring, `${field} scoring`);
  if (scoring !== "wta_win" && scoring !== "podium_majority") {
    throw new Error(`${field} scoring is unsupported.`);
  }
  const sampleStatus = text(source.sample_status, `${field} sample status`);
  if (
    sampleStatus !== "early_signal" &&
    sampleStatus !== "developing" &&
    sampleStatus !== "representative"
  ) {
    throw new Error(`${field} sample status is unsupported.`);
  }
  const raceCount = integer(source.race_count, `${field} race count`);
  const expectedSampleStatus =
    raceCount >= 20
      ? "representative"
      : raceCount >= 5
        ? "developing"
        : "early_signal";
  if (sampleStatus !== expectedSampleStatus) {
    throw new Error(`${field} sample status conflicts with race count.`);
  }
  const gateCount = integer(source.gate, `${field} gate count`);
  const uniqueCoreCount = integer(
    source.unique_core_count,
    `${field} unique Core count`,
  );
  if (uniqueCoreCount > raceCount * gateCount) {
    throw new Error(`${field} unique Core count is impossible.`);
  }
  const firstPlaceTimes = distribution(
    source.first_place_times,
    `${field} first-place times`,
  );
  const positiveContributorTimes = distribution(
    source.positive_contributor_times,
    `${field} positive-contributor times`,
  );
  const podiumCutoffTimes =
    source.podium_cutoff_times === null
      ? null
      : distribution(
          source.podium_cutoff_times,
          `${field} podium-cutoff times`,
        );
  if (firstPlaceTimes.observationCount !== raceCount) {
    throw new Error(`${field} first-place coverage is incomplete.`);
  }
  if (
    scoring === "wta_win" &&
    (positiveContributorTimes.observationCount !== raceCount ||
      podiumCutoffTimes !== null)
  ) {
    throw new Error(`${field} WTA positive-contributor authority is invalid.`);
  }
  if (
    scoring === "podium_majority" &&
    (positiveContributorTimes.observationCount < raceCount * 2 ||
      positiveContributorTimes.observationCount > raceCount * 3 ||
      podiumCutoffTimes?.observationCount !== raceCount)
  ) {
    throw new Error(
      `${field} Madness positive-contributor authority is invalid.`,
    );
  }
  const targets = record(source.targets, `${field} targets`);
  const eliteMilliseconds = seconds(
    targets.elite_seconds,
    `${field} elite target`,
  );
  const expectedWinningMilliseconds = seconds(
    targets.expected_winning_seconds,
    `${field} expected-winning target`,
  );
  const maximumPositiveMilliseconds = seconds(
    targets.maximum_positive_seconds,
    `${field} maximum-positive target`,
  );
  if (
    !close(
      eliteMilliseconds,
      positiveContributorTimes.lowerQuartileMilliseconds,
    ) ||
    !close(
      expectedWinningMilliseconds,
      positiveContributorTimes.medianMilliseconds,
    ) ||
    !close(
      maximumPositiveMilliseconds,
      positiveContributorTimes.upperQuartileMilliseconds,
    )
  ) {
    throw new Error(
      `${field} targets conflict with positive-contributor times.`,
    );
  }
  return Object.freeze({
    raceType: canonicalRaceType(text(source.race_type, `${field} race type`)),
    distanceMetres: integer(source.distance_m, `${field} distance`),
    gateCount,
    scoring,
    raceCount,
    uniqueCoreCount,
    sampleStatus,
    firstPlaceTimes,
    positiveContributorTimes,
    podiumCutoffTimes,
    targets: Object.freeze({
      eliteMilliseconds,
      expectedWinningMilliseconds,
      maximumPositiveMilliseconds,
    }),
  });
}

export function loadProLeagueSeason1Week1Benchmark(
  value: unknown,
): ProLeagueEsportsBenchmark {
  const source = record(value, "Week 1 Esports authority");
  text(source.source, "Week 1 Esports source");
  text(source.validation, "Week 1 Esports validation");
  integer(source.completedMatches, "Week 1 completed matches");
  integer(source.participatingCoreCount, "Week 1 participating Core count");
  const raceCount = integer(source.scoredRaces, "Week 1 scored races");
  const resultCount = integer(source.resultCount, "Week 1 result count");
  const exactCellCount = integer(
    source.exactCellCount,
    "Week 1 exact-cell count",
  );
  if (!Array.isArray(source.cells)) {
    throw new Error("Week 1 Esports cells are invalid.");
  }
  const cells = source.cells.map(winningCell);
  if (cells.length !== exactCellCount) {
    throw new Error("Week 1 Esports exact-cell count is inconsistent.");
  }
  const exactKeys = new Set<string>();
  const analyticalKeys = new Set<string>();
  let reconciledRaceCount = 0;
  for (const cell of cells) {
    const exactKey = JSON.stringify([
      cell.raceType,
      cell.distanceMetres,
      cell.gateCount,
      cell.scoring,
    ]);
    const analyticalKey = JSON.stringify([cell.raceType, cell.distanceMetres]);
    if (exactKeys.has(exactKey) || analyticalKeys.has(analyticalKey)) {
      throw new Error("Week 1 Esports cells contain duplicate authority.");
    }
    exactKeys.add(exactKey);
    analyticalKeys.add(analyticalKey);
    reconciledRaceCount += cell.raceCount;
  }
  if (reconciledRaceCount !== raceCount) {
    throw new Error("Week 1 Esports race count is inconsistent.");
  }
  return Object.freeze({
    authority: "completed_official_esports_races",
    raceCount,
    resultCount,
    dataCurrentThrough: timestamp(
      source.dataCurrentThrough,
      "Week 1 data current through",
    ),
    cells: Object.freeze(cells),
    warnings: Object.freeze([
      "One completed competition week is an early benchmark, not a permanent speed constant.",
      "WTA positive contributors are first-place finishers; Madness positive contributors are Cores from the point-winning team that finished in the top three.",
      "A Core must show repeatable exact-cell pace and acceptable variance; one isolated fast time is not enough for roster selection.",
      "The upper-quartile value is a screening ceiling, not a guarantee of winning against a particular opponent.",
    ]),
  });
}

export const proLeagueSeason1Week1Benchmark =
  loadProLeagueSeason1Week1Benchmark(weekOneAuthority);
