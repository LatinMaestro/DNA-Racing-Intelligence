npm warn Unknown env config "http-proxy". This will stop working in the next major version of npm.
import type {
  TournamentRankingMetric,
  TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";

export type TournamentMetricProfile = Readonly<{
  coreId: string;
  mode: string;
  distanceMetres: number;
  raceCount: number;
  bestMilliseconds: number;
  medianMilliseconds: number;
  meanMilliseconds: number;
}>;

export type TournamentMetricCandidate = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  eligibility: "eligible" | "ineligible" | "review_required";
}>;

export type TournamentMetricProjection = Readonly<{
  metricStatus: "complete" | "partial" | "unavailable";
  metricRank: number | null;
  metricEvidenceLabel: string | null;
}>;

const timeMetricField: Partial<
  Record<
    TournamentRankingMetric,
    "bestMilliseconds" | "medianMilliseconds" | "meanMilliseconds"
  >
> = {
  fastest_single_time: "bestMilliseconds",
  median_time: "medianMilliseconds",
  average_time: "meanMilliseconds",
};

function required(value: string, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is invalid.`);
  }
  return value.trim();
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function positiveNumber(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

export function projectTournamentQualificationMetrics(
  rule: Pick<
    TournamentRuleConfiguration,
    "mode" | "eligibleDistancesMetres" | "qualification"
  >,
  candidates: readonly TournamentMetricCandidate[],
  profiles: readonly TournamentMetricProfile[],
): ReadonlyMap<string, TournamentMetricProjection> {
  const candidateIds = candidates.map((candidate) =>
    required(candidate.coreId, "Tournament metric candidate Core ID"),
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Tournament metric candidate Core IDs must be unique.");
  }

  const profilesByKey = new Map<string, TournamentMetricProfile>();
  for (const profile of profiles) {
    const coreId = required(
      profile.coreId,
      "Tournament metric profile Core ID",
    );
    const mode = required(profile.mode, "Tournament metric profile mode");
    const distanceMetres = positiveInteger(
      profile.distanceMetres,
      "Tournament metric profile distance",
    );
    positiveInteger(profile.raceCount, "Tournament metric profile race count");
    positiveNumber(
      profile.bestMilliseconds,
      "Tournament metric profile best time",
    );
    positiveNumber(
      profile.medianMilliseconds,
      "Tournament metric profile median time",
    );
    positiveNumber(
      profile.meanMilliseconds,
      "Tournament metric profile average time",
    );
    const key = JSON.stringify([coreId, mode, distanceMetres]);
    if (profilesByKey.has(key)) {
      throw new Error("Tournament metric profile evidence is duplicated.");
    }
    profilesByKey.set(key, { ...profile, coreId, mode, distanceMetres });
  }

  const metric = rule.qualification.rankingMetric;
  const metricField = timeMetricField[metric];
  const exactDistance =
    rule.eligibleDistancesMetres.length === 1
      ? positiveInteger(
          rule.eligibleDistancesMetres[0]!,
          "Tournament metric exact distance",
        )
      : null;
  const minimumRaceCount = positiveInteger(
    rule.qualification.minimumRaceCount,
    "Tournament metric minimum race count",
  );

  const projections = new Map<
    string,
    TournamentMetricProjection & Readonly<{ metricValue?: number }>
  >();
  for (const candidate of candidates) {
    const coreId = required(
      candidate.coreId,
      "Tournament metric candidate Core ID",
    );
    if (candidate.eligibility !== "eligible" || metricField === undefined) {
      projections.set(coreId, {
        metricStatus: "unavailable",
        metricRank: null,
        metricEvidenceLabel: null,
      });
      continue;
    }
    if (exactDistance === null) {
      const hasEligibleDistanceEvidence = rule.eligibleDistancesMetres.some(
        (distance) =>
          profilesByKey.has(JSON.stringify([coreId, rule.mode, distance])),
      );
      projections.set(coreId, {
        metricStatus: hasEligibleDistanceEvidence ? "partial" : "unavailable",
        metricRank: null,
        metricEvidenceLabel: hasEligibleDistanceEvidence ? metric : null,
      });
      continue;
    }

    const profile = profilesByKey.get(
      JSON.stringify([coreId, rule.mode, exactDistance]),
    );
    if (profile === undefined) {
      projections.set(coreId, {
        metricStatus: "unavailable",
        metricRank: null,
        metricEvidenceLabel: null,
      });
      continue;
    }
    if (profile.raceCount < minimumRaceCount) {
      projections.set(coreId, {
        metricStatus: "partial",
        metricRank: null,
        metricEvidenceLabel: metric,
      });
      continue;
    }
    projections.set(coreId, {
      metricStatus: "complete",
      metricRank: null,
      metricEvidenceLabel: metric,
      metricValue: profile[metricField],
    });
  }

  const groups = new Map<
    string,
    Array<Readonly<{ coreId: string; metricValue: number }>>
  >();
  for (const candidate of candidates) {
    const projection = projections.get(candidate.coreId);
    if (
      projection?.metricStatus !== "complete" ||
      projection.metricValue === undefined
    ) {
      continue;
    }
    const group = groups.get(candidate.leaderboardGroupId) ?? [];
    group.push({
      coreId: candidate.coreId,
      metricValue: projection.metricValue,
    });
    groups.set(candidate.leaderboardGroupId, group);
  }

  for (const group of groups.values()) {
    group.sort(
      (left, right) =>
        left.metricValue - right.metricValue ||
        left.coreId.localeCompare(right.coreId),
    );
    let previousValue: number | null = null;
    let previousRank = 0;
    group.forEach((candidate, index) => {
      const rank =
        previousValue !== null && candidate.metricValue === previousValue
          ? previousRank
          : index + 1;
      const projection = projections.get(candidate.coreId)!;
      projections.set(candidate.coreId, { ...projection, metricRank: rank });
      previousValue = candidate.metricValue;
      previousRank = rank;
    });
  }

  return new Map(
    [...projections].map(([coreId, projection]) => [
      coreId,
      {
        metricStatus: projection.metricStatus,
        metricRank: projection.metricRank,
        metricEvidenceLabel: projection.metricEvidenceLabel,
      },
    ]),
  );
}
