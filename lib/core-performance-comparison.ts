import {
  raceModes,
  type CorePerformanceProfile,
  type RaceMode,
} from "@/domain/core-performance";

// Presentation only: project accepted aggregates; never recalculate a rating.
export type CorePerformanceComparisonRow = Pick<
  CorePerformanceProfile,
  | "coreId"
  | "mode"
  | "distance"
  | "raceCount"
  | "sampleStatus"
  | "freshness"
  | "dataCurrentThrough"
  | "analyticalStatus"
  | "elapsedTime"
  | "speed"
> & {
  yellow: {
    received: number;
    opportunities: number;
    eligible: number;
    currentThrough: string;
  } | null;
  blue: {
    received: number;
    opportunities: number;
    currentThrough: string;
  } | null;
};

export function corePerformanceComparisonRows(
  profiles: readonly CorePerformanceProfile[],
): CorePerformanceComparisonRow[] {
  return profiles.map(({ starProfile, ...profile }) => ({
    ...profile,
    yellow:
      starProfile === null
        ? null
        : {
            received: starProfile.goldReceivedRate.numerator,
            opportunities: starProfile.goldReceivedRate.denominator,
            eligible: starProfile.goldEligibleRaceCount,
            currentThrough: starProfile.dataCurrentThrough,
          },
    blue:
      starProfile === null
        ? null
        : {
            received: starProfile.blueReceivedRate.numerator,
            opportunities: starProfile.blueReceivedRate.denominator,
            currentThrough: starProfile.dataCurrentThrough,
          },
  }));
}

export type CoreComparisonSort = "core" | "sample" | "median";
export type CoreComparisonSample =
  "all" | CorePerformanceProfile["sampleStatus"];

export function visibleCoreComparisonRows(
  rows: readonly CorePerformanceComparisonRow[],
  {
    sort = "core",
    sample = "all",
  }: { sort?: CoreComparisonSort; sample?: CoreComparisonSample } = {},
): CorePerformanceComparisonRow[] {
  return rows
    .filter((row) => sample === "all" || row.sampleStatus === sample)
    .sort((a, b) => {
      // Keep unlike modes/distances in fixed groups, including when sorting times.
      const context =
        raceModes.indexOf(a.mode as RaceMode) -
          raceModes.indexOf(b.mode as RaceMode) || a.distance - b.distance;
      if (context !== 0) return context;
      const selected =
        sort === "median"
          ? a.elapsedTime.medianMilliseconds - b.elapsedTime.medianMilliseconds
          : sort === "sample"
            ? b.raceCount - a.raceCount
            : 0;
      return (
        selected || a.coreId.localeCompare(b.coreId, "en", { numeric: true })
      );
    });
}
