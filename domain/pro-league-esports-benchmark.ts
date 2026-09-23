export type ProLeagueEsportsRace = Readonly<{
  matchId: string;
  raceId: string;
  mapId: string;
  raceNumber: number;
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  scoring: "wta_win" | "podium_majority";
  homeTeamId: string;
  awayTeamId: string;
  pointTo: "home" | "away";
  homeCoreIds: readonly string[];
  awayCoreIds: readonly string[];
  completedAt: string;
}>;

export type ProLeagueEsportsResult = Readonly<{
  raceId: string;
  coreId: string;
  finishPosition: number;
  elapsedTimeMilliseconds: number;
}>;

export type ProLeagueEsportsTimeDistribution = Readonly<{
  observationCount: number;
  fastestMilliseconds: number;
  lowerQuartileMilliseconds: number;
  medianMilliseconds: number;
  upperQuartileMilliseconds: number;
  slowestMilliseconds: number;
}>;

export type ProLeagueEsportsWinningCell = Readonly<{
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  scoring: "wta_win" | "podium_majority";
  raceCount: number;
  sampleStatus: "early_signal" | "developing" | "representative";
  firstPlaceTimes: ProLeagueEsportsTimeDistribution;
  positiveContributorTimes: ProLeagueEsportsTimeDistribution;
  podiumCutoffTimes: ProLeagueEsportsTimeDistribution | null;
  targets: Readonly<{
    eliteMilliseconds: number;
    expectedWinningMilliseconds: number;
    maximumPositiveMilliseconds: number;
  }>;
}>;

export type ProLeagueEsportsBenchmark = Readonly<{
  authority: "completed_official_esports_races";
  raceCount: number;
  resultCount: number;
  dataCurrentThrough: string;
  cells: readonly ProLeagueEsportsWinningCell[];
  warnings: readonly string[];
}>;

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

function text(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > 256 ||
    CONTROL_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid.`);
  }
  return normalized;
}

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${field} must be a positive safe integer.`);
  }
  return value;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${field} must be a canonical UTC timestamp.`);
  }
  return value;
}

function percentile(values: readonly number[], quantile: number): number {
  const sorted = [...values].sort((left, right) => left - right);
  if (sorted.length === 1) return sorted[0]!;
  const rank = (sorted.length - 1) * quantile;
  const lower = Math.floor(rank);
  const fraction = rank - lower;
  return Math.round(
    sorted[lower]! +
      (sorted[Math.min(lower + 1, sorted.length - 1)]! - sorted[lower]!) *
        fraction,
  );
}

function distribution(
  values: readonly number[],
): ProLeagueEsportsTimeDistribution {
  if (values.length < 1) {
    throw new Error("An Esports time distribution cannot be empty.");
  }
  const sorted = [...values].sort((left, right) => left - right);
  return Object.freeze({
    observationCount: sorted.length,
    fastestMilliseconds: sorted[0]!,
    lowerQuartileMilliseconds: percentile(sorted, 0.25),
    medianMilliseconds: percentile(sorted, 0.5),
    upperQuartileMilliseconds: percentile(sorted, 0.75),
    slowestMilliseconds: sorted.at(-1)!,
  });
}

function cellKey(
  value: Pick<
    ProLeagueEsportsRace,
    "raceType" | "distanceMetres" | "gateCount" | "scoring"
  >,
): string {
  return JSON.stringify([
    value.raceType.trim().toLowerCase(),
    value.distanceMetres,
    value.gateCount,
    value.scoring,
  ]);
}

type CellAccumulator = {
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  scoring: "wta_win" | "podium_majority";
  raceCount: number;
  firstPlaceTimes: number[];
  positiveContributorTimes: number[];
  podiumCutoffTimes: number[];
};

function sideForCore(
  race: ProLeagueEsportsRace,
  coreId: string,
): "home" | "away" | null {
  const home = race.homeCoreIds.includes(coreId);
  const away = race.awayCoreIds.includes(coreId);
  if (home && away) {
    throw new Error("An Esports Core cannot occupy both sides of one race.");
  }
  return home ? "home" : away ? "away" : null;
}

export function buildProLeagueEsportsBenchmark(input: {
  races: readonly ProLeagueEsportsRace[];
  results: readonly ProLeagueEsportsResult[];
}): ProLeagueEsportsBenchmark {
  if (input.races.length < 1) {
    throw new Error("Completed Esports races are required.");
  }
  const raceById = new Map<string, ProLeagueEsportsRace>();
  for (const raw of input.races) {
    const race: ProLeagueEsportsRace = Object.freeze({
      ...raw,
      matchId: text(raw.matchId, "Esports match ID"),
      raceId: text(raw.raceId, "Esports race ID"),
      mapId: text(raw.mapId, "Esports map ID"),
      raceNumber: positiveInteger(raw.raceNumber, "Esports race number"),
      raceType: text(raw.raceType, "Esports race type").toLowerCase(),
      distanceMetres: positiveInteger(raw.distanceMetres, "Esports distance"),
      gateCount: positiveInteger(raw.gateCount, "Esports gate count"),
      homeTeamId: text(raw.homeTeamId, "Esports home team ID"),
      awayTeamId: text(raw.awayTeamId, "Esports away team ID"),
      homeCoreIds: Object.freeze(
        raw.homeCoreIds.map((value) => text(value, "Esports home Core ID")),
      ),
      awayCoreIds: Object.freeze(
        raw.awayCoreIds.map((value) => text(value, "Esports away Core ID")),
      ),
      completedAt: timestamp(raw.completedAt, "Esports completion time"),
    });
    if (race.homeTeamId === race.awayTeamId) {
      throw new Error("An Esports race requires two distinct teams.");
    }
    if (raceById.has(race.raceId)) {
      throw new Error("Duplicate Esports race authority is not allowed.");
    }
    raceById.set(race.raceId, race);
  }

  const resultsByRace = new Map<string, ProLeagueEsportsResult[]>();
  const resultKeys = new Set<string>();
  for (const raw of input.results) {
    const result = Object.freeze({
      raceId: text(raw.raceId, "Esports result race ID"),
      coreId: text(raw.coreId, "Esports result Core ID"),
      finishPosition: positiveInteger(
        raw.finishPosition,
        "Esports finish position",
      ),
      elapsedTimeMilliseconds: positiveInteger(
        raw.elapsedTimeMilliseconds,
        "Esports elapsed time",
      ),
    });
    const race = raceById.get(result.raceId);
    if (race === undefined || sideForCore(race, result.coreId) === null) {
      throw new Error("Esports result identity is outside race authority.");
    }
    if (result.finishPosition > race.gateCount) {
      throw new Error("Esports finish position exceeds the race gate count.");
    }
    const key = JSON.stringify([result.raceId, result.coreId]);
    if (resultKeys.has(key)) {
      throw new Error("Duplicate Esports result authority is not allowed.");
    }
    resultKeys.add(key);
    const values = resultsByRace.get(result.raceId) ?? [];
    values.push(result);
    resultsByRace.set(result.raceId, values);
  }

  const cells = new Map<string, CellAccumulator>();
  for (const race of raceById.values()) {
    const results = resultsByRace.get(race.raceId) ?? [];
    if (results.length !== race.gateCount) {
      throw new Error("Every completed Esports race requires every result.");
    }
    const positions = new Set(
      results.map(({ finishPosition }) => finishPosition),
    );
    if (positions.size !== race.gateCount) {
      throw new Error("Esports finish positions must be unique and complete.");
    }
    const first = results.find(({ finishPosition }) => finishPosition === 1)!;
    if (
      race.scoring === "wta_win" &&
      sideForCore(race, first.coreId) !== race.pointTo
    ) {
      throw new Error(
        "WTA point authority conflicts with first-place evidence.",
      );
    }
    const winningPodium = results.filter(
      (result) =>
        result.finishPosition <= 3 &&
        sideForCore(race, result.coreId) === race.pointTo,
    );
    if (race.scoring === "podium_majority" && winningPodium.length < 2) {
      throw new Error(
        "Madness point authority lacks a winning podium majority.",
      );
    }
    const key = cellKey(race);
    const cell = cells.get(key) ?? {
      raceType: race.raceType,
      distanceMetres: race.distanceMetres,
      gateCount: race.gateCount,
      scoring: race.scoring,
      raceCount: 0,
      firstPlaceTimes: [],
      positiveContributorTimes: [],
      podiumCutoffTimes: [],
    };
    cell.raceCount += 1;
    cell.firstPlaceTimes.push(first.elapsedTimeMilliseconds);
    if (race.scoring === "wta_win") {
      cell.positiveContributorTimes.push(first.elapsedTimeMilliseconds);
    } else {
      cell.positiveContributorTimes.push(
        ...winningPodium.map(
          ({ elapsedTimeMilliseconds }) => elapsedTimeMilliseconds,
        ),
      );
      cell.podiumCutoffTimes.push(
        results.find(({ finishPosition }) => finishPosition === 3)!
          .elapsedTimeMilliseconds,
      );
    }
    cells.set(key, cell);
  }

  const dataCurrentThrough = [...raceById.values()].reduce(
    (latest, race) => (race.completedAt > latest ? race.completedAt : latest),
    "",
  );
  return Object.freeze({
    authority: "completed_official_esports_races",
    raceCount: raceById.size,
    resultCount: resultKeys.size,
    dataCurrentThrough,
    cells: Object.freeze(
      [...cells.values()]
        .sort(
          (left, right) =>
            left.distanceMetres - right.distanceMetres ||
            left.gateCount - right.gateCount ||
            left.raceType.localeCompare(right.raceType),
        )
        .map((cell): ProLeagueEsportsWinningCell => {
          const firstPlaceTimes = distribution(cell.firstPlaceTimes);
          const positiveContributorTimes = distribution(
            cell.positiveContributorTimes,
          );
          return Object.freeze({
            raceType: cell.raceType,
            distanceMetres: cell.distanceMetres,
            gateCount: cell.gateCount,
            scoring: cell.scoring,
            raceCount: cell.raceCount,
            sampleStatus:
              cell.raceCount >= 20
                ? "representative"
                : cell.raceCount >= 5
                  ? "developing"
                  : "early_signal",
            firstPlaceTimes,
            positiveContributorTimes,
            podiumCutoffTimes:
              cell.podiumCutoffTimes.length === 0
                ? null
                : distribution(cell.podiumCutoffTimes),
            targets: Object.freeze({
              eliteMilliseconds:
                positiveContributorTimes.lowerQuartileMilliseconds,
              expectedWinningMilliseconds:
                positiveContributorTimes.medianMilliseconds,
              maximumPositiveMilliseconds:
                positiveContributorTimes.upperQuartileMilliseconds,
            }),
          });
        }),
    ),
    warnings: Object.freeze([
      "One completed competition week is an early benchmark, not a permanent speed constant.",
      "WTA positive contributors are first-place finishers; Madness positive contributors are Cores from the point-winning team that finished in the top three.",
      "A Core must show repeatable exact-cell pace and acceptable variance; one isolated fast time is not enough for roster selection.",
      "The upper-quartile value is a screening ceiling, not a guarantee of winning against a particular opponent.",
    ]),
  });
}
