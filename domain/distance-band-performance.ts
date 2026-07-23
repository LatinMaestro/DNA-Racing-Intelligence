import type {
  CorePerformanceProfile,
  RaceMode,
} from "@/domain/core-performance";
import { raceModes } from "@/domain/core-performance";
import type { FreshnessState } from "@/domain/freshness";

export const distanceBands = ["sprint", "middle", "marathon"] as const;
export type DistanceBand = (typeof distanceBands)[number];

const bandOrder = new Map<DistanceBand, number>(
  distanceBands.map((band, index) => [band, index]),
);

const freshnessPriority: Readonly<Record<FreshnessState, number>> = {
  current: 0,
  ageing: 1,
  stale: 2,
  unknown: 3,
};

export type DistanceBandStarEvidence = Readonly<{
  exactDistanceProfileCountWithStarData: number;
  exactDistanceProfileCountWithoutStarData: number;
  completeStarDataRaceCount: number;
  partialStarDataRaceCount: number;
  missingStarDataRaceCount: number;
  invalidStarDataRaceCount: number;
  goldEligibleRaceCount: number;
  goldAssignmentOpportunityCount: number;
  goldReceivedCount: number;
  goldReceivedRate: Readonly<{ numerator: number; denominator: number }>;
  goldExcludedAnomalyCount: number;
  blueAssignmentOpportunityCount: number;
  blueReceivedCount: number;
  blueReceivedRate: Readonly<{ numerator: number; denominator: number }>;
  blueExcludedAnomalyCount: number;
  sameCoreReceivedBothCount: number;
}>;

export type DistanceBandSummary = Readonly<{
  coreId: string;
  mode: RaceMode;
  band: DistanceBand;
  exactDistancesMetres: readonly number[];
  exactDistanceProfileCount: number;
  sharedBoundaryProfileCount: number;
  raceCount: number;
  minimallyAnalyticalExactDistanceCount: number;
  hypothesisOnlyExactDistanceCount: number;
  dataCurrentThrough: string;
  oldestProfileCurrentThrough: string;
  freshness: FreshnessState;
  profileFreshnessStates: readonly FreshnessState[];
  speedEvidence: Readonly<{
    bestMetresPerSecondAcrossExactDistances: number;
    slowestExactDistanceMedianMetresPerSecond: number;
    fastestExactDistanceMedianMetresPerSecond: number;
  }>;
  elapsedTimeTreatment: "kept_separate_by_exact_distance";
  starEvidence: DistanceBandStarEvidence;
  analyticalStatus: "experimental";
}>;

export type UnbandedPerformanceProfile = Readonly<{
  coreId: string;
  mode: RaceMode;
  distanceMetres: number;
  warningCode: "OUTSIDE_SUPPORTED_DISTANCE_BANDS";
}>;

export type DistanceBandProjection = Readonly<{
  summaries: readonly DistanceBandSummary[];
  unbandedProfiles: readonly UnbandedPerformanceProfile[];
}>;

export function distanceBandMemberships(
  distanceMetres: number,
): DistanceBand[] {
  if (!Number.isSafeInteger(distanceMetres) || distanceMetres <= 0) {
    throw new Error("distanceMetres must be a positive integer");
  }

  const memberships: DistanceBand[] = [];
  if (distanceMetres >= 900 && distanceMetres <= 1_400) {
    memberships.push("sprint");
  }
  if (distanceMetres >= 1_400 && distanceMetres <= 1_800) {
    memberships.push("middle");
  }
  if (distanceMetres >= 1_800 && distanceMetres <= 2_200) {
    memberships.push("marathon");
  }
  return memberships;
}

function profileKey(
  profile: Pick<CorePerformanceProfile, "coreId" | "mode" | "distance">,
): string {
  return JSON.stringify([profile.coreId, profile.mode, profile.distance]);
}

function summaryKey(
  profile: Pick<CorePerformanceProfile, "coreId" | "mode">,
  band: DistanceBand,
): string {
  return JSON.stringify([profile.coreId, profile.mode, band]);
}

function assertProfile(profile: CorePerformanceProfile): void {
  if (
    profile.coreId.trim() === "" ||
    !raceModes.includes(profile.mode) ||
    !Number.isSafeInteger(profile.distance) ||
    profile.distance <= 0 ||
    !Number.isSafeInteger(profile.raceCount) ||
    profile.raceCount <= 0 ||
    !["hypothesis_only", "minimally_analytical"].includes(
      profile.sampleStatus,
    ) ||
    Number.isNaN(Date.parse(profile.dataCurrentThrough)) ||
    !(profile.freshness in freshnessPriority) ||
    !Number.isFinite(profile.speed.bestMetresPerSecond) ||
    profile.speed.bestMetresPerSecond <= 0 ||
    !Number.isFinite(profile.speed.medianMetresPerSecond) ||
    profile.speed.medianMetresPerSecond <= 0 ||
    profile.analyticalStatus !== "experimental"
  ) {
    throw new Error(
      `Invalid exact-distance profile: ${profile.coreId}|${profile.mode}|${profile.distance}`,
    );
  }

  if (
    profile.starProfile !== null &&
    (profile.starProfile.coreId !== profile.coreId ||
      profile.starProfile.mode !== profile.mode ||
      profile.starProfile.distance !== profile.distance)
  ) {
    throw new Error(
      `Mismatched star profile: ${profile.coreId}|${profile.mode}|${profile.distance}`,
    );
  }

  if (profile.starProfile !== null) {
    const starCounts = [
      profile.starProfile.raceCount,
      profile.starProfile.completeStarDataRaceCount,
      profile.starProfile.partialStarDataRaceCount,
      profile.starProfile.missingStarDataRaceCount,
      profile.starProfile.invalidStarDataRaceCount,
      profile.starProfile.goldEligibleRaceCount,
      profile.starProfile.goldAssignmentOpportunityCount,
      profile.starProfile.goldReceivedCount,
      profile.starProfile.goldExcludedAnomalyCount,
      profile.starProfile.blueAssignmentOpportunityCount,
      profile.starProfile.blueReceivedCount,
      profile.starProfile.blueExcludedAnomalyCount,
      profile.starProfile.sameCoreReceivedBothCount,
    ];
    const invalidCount = starCounts.some(
      (value) => !Number.isSafeInteger(value) || value < 0,
    );
    const invalidRate =
      profile.starProfile.goldReceivedRate.numerator !==
        profile.starProfile.goldReceivedCount ||
      profile.starProfile.goldReceivedRate.denominator !==
        profile.starProfile.goldAssignmentOpportunityCount ||
      profile.starProfile.blueReceivedRate.numerator !==
        profile.starProfile.blueReceivedCount ||
      profile.starProfile.blueReceivedRate.denominator !==
        profile.starProfile.blueAssignmentOpportunityCount ||
      profile.starProfile.goldReceivedCount >
        profile.starProfile.goldAssignmentOpportunityCount ||
      profile.starProfile.blueReceivedCount >
        profile.starProfile.blueAssignmentOpportunityCount;

    if (invalidCount || invalidRate) {
      throw new Error(
        `Invalid star evidence: ${profile.coreId}|${profile.mode}|${profile.distance}`,
      );
    }
  }
}

function latestTimestamp(values: readonly string[]): string {
  return values.reduce((latest, value) =>
    Date.parse(value) > Date.parse(latest) ? value : latest,
  );
}

function earliestTimestamp(values: readonly string[]): string {
  return values.reduce((earliest, value) =>
    Date.parse(value) < Date.parse(earliest) ? value : earliest,
  );
}

function worstFreshness(values: readonly FreshnessState[]): FreshnessState {
  return values.reduce((worst, value) =>
    freshnessPriority[value] > freshnessPriority[worst] ? value : worst,
  );
}

function sum(
  profiles: readonly CorePerformanceProfile[],
  value: (profile: CorePerformanceProfile) => number,
): number {
  return profiles.reduce((total, profile) => total + value(profile), 0);
}

function summarizeStarEvidence(
  profiles: readonly CorePerformanceProfile[],
): DistanceBandStarEvidence {
  const withStars = profiles.filter(({ starProfile }) => starProfile !== null);
  const starValue = (
    value: (
      starProfile: NonNullable<CorePerformanceProfile["starProfile"]>,
    ) => number,
  ): number =>
    withStars.reduce(
      (total, profile) => total + value(profile.starProfile!),
      0,
    );
  const goldAssignmentOpportunityCount = starValue(
    ({ goldAssignmentOpportunityCount }) => goldAssignmentOpportunityCount,
  );
  const goldReceivedCount = starValue(
    ({ goldReceivedCount }) => goldReceivedCount,
  );
  const blueAssignmentOpportunityCount = starValue(
    ({ blueAssignmentOpportunityCount }) => blueAssignmentOpportunityCount,
  );
  const blueReceivedCount = starValue(
    ({ blueReceivedCount }) => blueReceivedCount,
  );

  return {
    exactDistanceProfileCountWithStarData: withStars.length,
    exactDistanceProfileCountWithoutStarData:
      profiles.length - withStars.length,
    completeStarDataRaceCount: starValue(
      ({ completeStarDataRaceCount }) => completeStarDataRaceCount,
    ),
    partialStarDataRaceCount: starValue(
      ({ partialStarDataRaceCount }) => partialStarDataRaceCount,
    ),
    missingStarDataRaceCount: starValue(
      ({ missingStarDataRaceCount }) => missingStarDataRaceCount,
    ),
    invalidStarDataRaceCount: starValue(
      ({ invalidStarDataRaceCount }) => invalidStarDataRaceCount,
    ),
    goldEligibleRaceCount: starValue(
      ({ goldEligibleRaceCount }) => goldEligibleRaceCount,
    ),
    goldAssignmentOpportunityCount,
    goldReceivedCount,
    goldReceivedRate: {
      numerator: goldReceivedCount,
      denominator: goldAssignmentOpportunityCount,
    },
    goldExcludedAnomalyCount: starValue(
      ({ goldExcludedAnomalyCount }) => goldExcludedAnomalyCount,
    ),
    blueAssignmentOpportunityCount,
    blueReceivedCount,
    blueReceivedRate: {
      numerator: blueReceivedCount,
      denominator: blueAssignmentOpportunityCount,
    },
    blueExcludedAnomalyCount: starValue(
      ({ blueExcludedAnomalyCount }) => blueExcludedAnomalyCount,
    ),
    sameCoreReceivedBothCount: starValue(
      ({ sameCoreReceivedBothCount }) => sameCoreReceivedBothCount,
    ),
  };
}

function summarizeBand(
  profiles: readonly CorePerformanceProfile[],
  band: DistanceBand,
): DistanceBandSummary {
  const first = profiles[0]!;
  const freshnessStates = [
    ...new Set(profiles.map(({ freshness }) => freshness)),
  ].sort((left, right) => freshnessPriority[left] - freshnessPriority[right]);
  const bestSpeeds = profiles.map(({ speed }) => speed.bestMetresPerSecond);
  const medianSpeeds = profiles.map(({ speed }) => speed.medianMetresPerSecond);
  const currentThroughValues = profiles.map(
    ({ dataCurrentThrough }) => dataCurrentThrough,
  );

  return {
    coreId: first.coreId,
    mode: first.mode,
    band,
    exactDistancesMetres: profiles.map(({ distance }) => distance),
    exactDistanceProfileCount: profiles.length,
    sharedBoundaryProfileCount: profiles.filter(
      ({ distance }) => distance === 1_400 || distance === 1_800,
    ).length,
    raceCount: sum(profiles, ({ raceCount }) => raceCount),
    minimallyAnalyticalExactDistanceCount: profiles.filter(
      ({ sampleStatus }) => sampleStatus === "minimally_analytical",
    ).length,
    hypothesisOnlyExactDistanceCount: profiles.filter(
      ({ sampleStatus }) => sampleStatus === "hypothesis_only",
    ).length,
    dataCurrentThrough: latestTimestamp(currentThroughValues),
    oldestProfileCurrentThrough: earliestTimestamp(currentThroughValues),
    freshness: worstFreshness(profiles.map(({ freshness }) => freshness)),
    profileFreshnessStates: freshnessStates,
    speedEvidence: {
      bestMetresPerSecondAcrossExactDistances: Math.max(...bestSpeeds),
      slowestExactDistanceMedianMetresPerSecond: Math.min(...medianSpeeds),
      fastestExactDistanceMedianMetresPerSecond: Math.max(...medianSpeeds),
    },
    elapsedTimeTreatment: "kept_separate_by_exact_distance",
    starEvidence: summarizeStarEvidence(profiles),
    analyticalStatus: "experimental",
  };
}

export function buildDistanceBandProjection(
  profiles: readonly CorePerformanceProfile[],
): DistanceBandProjection {
  const seenProfiles = new Set<string>();
  const groups = new Map<
    string,
    { band: DistanceBand; profiles: CorePerformanceProfile[] }
  >();
  const unbandedProfiles: UnbandedPerformanceProfile[] = [];

  for (const profile of profiles) {
    assertProfile(profile);
    const key = profileKey(profile);
    if (seenProfiles.has(key)) {
      throw new Error(
        `Duplicate exact-distance profile: ${profile.coreId}|${profile.mode}|${profile.distance}`,
      );
    }
    seenProfiles.add(key);

    const memberships = distanceBandMemberships(profile.distance);
    if (memberships.length === 0) {
      unbandedProfiles.push({
        coreId: profile.coreId,
        mode: profile.mode,
        distanceMetres: profile.distance,
        warningCode: "OUTSIDE_SUPPORTED_DISTANCE_BANDS",
      });
      continue;
    }

    for (const band of memberships) {
      const key = summaryKey(profile, band);
      const group = groups.get(key) ?? { band, profiles: [] };
      group.profiles.push(profile);
      groups.set(key, group);
    }
  }

  const summaries = [...groups.values()]
    .map(({ band, profiles: groupProfiles }) =>
      summarizeBand(
        groupProfiles.sort((left, right) => left.distance - right.distance),
        band,
      ),
    )
    .sort(
      (left, right) =>
        left.coreId.localeCompare(right.coreId) ||
        left.mode.localeCompare(right.mode) ||
        bandOrder.get(left.band)! - bandOrder.get(right.band)!,
    );

  return {
    summaries,
    unbandedProfiles: unbandedProfiles.sort(
      (left, right) =>
        left.coreId.localeCompare(right.coreId) ||
        left.mode.localeCompare(right.mode) ||
        left.distanceMetres - right.distanceMetres,
    ),
  };
}
