import type {
  ProLeagueEsportsBenchmark,
  ProLeagueEsportsWinningCell,
} from "@/domain/pro-league-esports-benchmark";

/** A verified current Bike ageing balance, rather than the API's opaque field. */
export function ownerVerifiedBikeAgeing(balance: number): Readonly<{
  used: number;
  remaining: number;
  eligible: boolean;
}> {
  if (!Number.isSafeInteger(balance) || balance < 0 || balance > 1025) {
    throw new Error(
      "Current Bike ageing balance must be verified and in range.",
    );
  }
  const used = 1025 - balance;
  return Object.freeze({
    used,
    remaining: balance,
    eligible: used <= 400 && balance > 0,
  });
}

export type OwnedBikeFinish = Readonly<{
  distanceMetres: number;
  elapsedTimeMilliseconds: number;
  completedAt: string;
  /** Both ordinary and esports Bike results may contribute to intrinsic pace. */
  source: "normal_bike" | "esports_bike";
}>;

export type OwnedBikeCellScreen = Readonly<{
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  scoring: ProLeagueEsportsWinningCell["scoring"];
  sampleCount: number;
  officialRaceCount: number;
  medianMilliseconds: number | null;
  standardDeviationMilliseconds: number | null;
  status: "elite_range" | "positive_range" | "outside" | "provisional";
  /** Normal Bike races do not prove a gate or scoring advantage. */
  distanceOnlyProjection: true;
}>;

function median(sorted: readonly number[]): number {
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2
    ? sorted[middle]!
    : (sorted[middle - 1]! + sorted[middle]!) / 2;
}

export function screenOwnedBikePace(input: {
  finishes: readonly OwnedBikeFinish[];
  benchmark: ProLeagueEsportsBenchmark;
  currentThrough: string;
  maximumAgeDays?: number;
}): readonly OwnedBikeCellScreen[] {
  if (input.benchmark.authority !== "completed_official_esports_races") {
    throw new Error("Official esports benchmark is required.");
  }
  const asOf = Date.parse(input.currentThrough);
  const maximumAgeDays = input.maximumAgeDays ?? 90;
  if (
    !Number.isFinite(asOf) ||
    !Number.isSafeInteger(maximumAgeDays) ||
    maximumAgeDays < 1
  ) {
    throw new Error("A valid evidence cutoff and age window are required.");
  }
  const byDistance = new Map<number, number[]>();
  for (const finish of input.finishes) {
    const ended = Date.parse(finish.completedAt);
    if (
      !Number.isSafeInteger(finish.distanceMetres) ||
      finish.distanceMetres <= 0 ||
      !Number.isFinite(finish.elapsedTimeMilliseconds) ||
      finish.elapsedTimeMilliseconds <= 0 ||
      !Number.isFinite(ended) ||
      ended > asOf ||
      (finish.source !== "normal_bike" && finish.source !== "esports_bike")
    ) {
      throw new Error(
        "Bike finish has invalid distance, time, source or timestamp.",
      );
    }
    if (asOf - ended > maximumAgeDays * 86_400_000) continue;
    const times = byDistance.get(finish.distanceMetres) ?? [];
    times.push(finish.elapsedTimeMilliseconds);
    byDistance.set(finish.distanceMetres, times);
  }

  return Object.freeze(
    input.benchmark.cells.map((cell) => {
      const times = [...(byDistance.get(cell.distanceMetres) ?? [])].sort(
        (a, b) => a - b,
      );
      const midpoint = times.length ? median(times) : null;
      const average =
        times.reduce((sum, value) => sum + value, 0) / times.length;
      const deviation = times.length
        ? Math.sqrt(
            times.reduce((sum, value) => sum + (value - average) ** 2, 0) /
              times.length,
          )
        : null;
      const adequate = times.length >= 10 && cell.raceCount >= 5;
      const positive =
        midpoint !== null &&
        midpoint <= cell.targets.maximumPositiveMilliseconds;
      const elite =
        midpoint !== null && midpoint <= cell.targets.eliteMilliseconds;
      const consistent =
        deviation !== null &&
        deviation <=
          Math.max(1000, cell.firstPlaceTimes.interquartileRangeMilliseconds);
      return Object.freeze({
        raceType: cell.raceType,
        distanceMetres: cell.distanceMetres,
        gateCount: cell.gateCount,
        scoring: cell.scoring,
        sampleCount: times.length,
        officialRaceCount: cell.raceCount,
        medianMilliseconds: midpoint,
        standardDeviationMilliseconds: deviation,
        status: !adequate
          ? "provisional"
          : elite && consistent
            ? "elite_range"
            : positive && consistent
              ? "positive_range"
              : "outside",
        distanceOnlyProjection: true,
      });
    }),
  );
}
