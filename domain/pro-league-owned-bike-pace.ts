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

/** The calling acquisition must verify that this is the Bike-specific balance. */
export function requireCurrentBikeAgeingEvidence(input: {
  balance: number;
  observedAt: string;
  currentThrough: string;
}): ReturnType<typeof ownerVerifiedBikeAgeing> {
  const observedAt = Date.parse(input.observedAt);
  const currentThrough = Date.parse(input.currentThrough);
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(currentThrough) ||
    observedAt > currentThrough ||
    currentThrough - observedAt > 3 * 86_400_000
  ) {
    throw new Error("Verified Bike ageing balance must be current.");
  }
  return ownerVerifiedBikeAgeing(input.balance);
}

/** Conservative certificate for a private connected proof that reports age bands only. */
export function requireCurrentBikeAgeingUpperBound(input: {
  usedUpperBound: 300 | 400;
  observedAt: string;
  currentThrough: string;
  source: "connected_owner_bike_balance";
}): Readonly<{ usedUpperBound: number; minimumRemaining: number }> {
  if (
    input.source !== "connected_owner_bike_balance" ||
    (input.usedUpperBound !== 300 && input.usedUpperBound !== 400)
  ) {
    throw new Error("Verified Bike ageing band authority is invalid.");
  }
  const observedAt = Date.parse(input.observedAt);
  const currentThrough = Date.parse(input.currentThrough);
  if (
    !Number.isFinite(observedAt) ||
    !Number.isFinite(currentThrough) ||
    observedAt > currentThrough ||
    currentThrough - observedAt > 3 * 86_400_000
  ) {
    throw new Error("Verified Bike ageing band must be current.");
  }
  return Object.freeze({
    usedUpperBound: input.usedUpperBound,
    minimumRemaining: 1025 - input.usedUpperBound,
  });
}

/** Verifies a private connected proof that the Core is over the owner limit. */
export function requireCurrentBikeAgeingIneligibility(input: {
  observedAt: string;
  currentThrough: string;
  source: "connected_owner_bike_balance";
}): Readonly<{ eligible: false }> {
  const observedAt = Date.parse(input.observedAt);
  const currentThrough = Date.parse(input.currentThrough);
  if (
    input.source !== "connected_owner_bike_balance" ||
    !Number.isFinite(observedAt) ||
    !Number.isFinite(currentThrough) ||
    observedAt > currentThrough ||
    currentThrough - observedAt > 3 * 86_400_000
  ) {
    throw new Error("Verified Bike ageing ineligibility must be current.");
  }
  return Object.freeze({ eligible: false });
}

export type OwnedBikeFinish = Readonly<{
  distanceMetres: number;
  elapsedTimeMilliseconds: number;
  completedAt: string;
  /** Both ordinary and esports Bike results may contribute to intrinsic pace. */
  source: "normal_bike" | "esports_bike" | "bike_history";
}>;

export type OwnedBikeCellScreen = Readonly<{
  raceType: string;
  distanceMetres: number;
  gateCount: number;
  scoring: ProLeagueEsportsWinningCell["scoring"];
  sampleCount: number;
  recentSampleCount: number;
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
  const byDistance = new Map<
    number,
    { times: number[]; recentCount: number }
  >();
  for (const finish of input.finishes) {
    const ended = Date.parse(finish.completedAt);
    if (
      !Number.isSafeInteger(finish.distanceMetres) ||
      finish.distanceMetres <= 0 ||
      !Number.isFinite(finish.elapsedTimeMilliseconds) ||
      finish.elapsedTimeMilliseconds <= 0 ||
      !Number.isFinite(ended) ||
      ended > asOf ||
      (finish.source !== "normal_bike" &&
        finish.source !== "esports_bike" &&
        finish.source !== "bike_history")
    ) {
      throw new Error(
        "Bike finish has invalid distance, time, source or timestamp.",
      );
    }
    const bucket = byDistance.get(finish.distanceMetres) ?? {
      times: [],
      recentCount: 0,
    };
    bucket.times.push(finish.elapsedTimeMilliseconds);
    if (asOf - ended <= maximumAgeDays * 86_400_000) bucket.recentCount += 1;
    byDistance.set(finish.distanceMetres, bucket);
  }

  return Object.freeze(
    input.benchmark.cells.map((cell) => {
      const bucket = byDistance.get(cell.distanceMetres);
      const times = [...(bucket?.times ?? [])].sort((a, b) => a - b);
      const midpoint = times.length ? median(times) : null;
      const average =
        times.reduce((sum, value) => sum + value, 0) / times.length;
      const deviation = times.length
        ? Math.sqrt(
            times.reduce((sum, value) => sum + (value - average) ** 2, 0) /
              times.length,
          )
        : null;
      const adequate =
        times.length >= 10 &&
        (bucket?.recentCount ?? 0) >= 3 &&
        cell.raceCount >= 5;
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
        recentSampleCount: bucket?.recentCount ?? 0,
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
