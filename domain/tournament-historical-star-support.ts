import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

export type TournamentStarCandidate = Readonly<{
  coreId: string;
  eligibility: "eligible" | "ineligible" | "review_required";
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
}>;

export type TournamentStarProfile = Readonly<{
  coreId: string;
  mode: string;
  distanceMetres: number;
  dataCurrentThrough: string;
  raceCount: number;
  completeStarDataRaceCount: number;
  partialStarDataRaceCount: number;
  missingStarDataRaceCount: number;
  invalidStarDataRaceCount: number;
  goldAssignmentOpportunityCount: number;
  goldReceivedCount: number;
  goldNegativeOpportunityCount: number;
  goldExcludedAnomalyCount: number;
  blueAssignmentOpportunityCount: number;
  blueReceivedCount: number;
  blueNegativeOpportunityCount: number;
  blueExcludedAnomalyCount: number;
}>;

export type TournamentHistoricalStarSupport =
  | "supports"
  | "neutral"
  | "conflicts"
  | "unavailable";

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

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be canonical.`);
  }
  return value;
}

function key(coreId: string, mode: string, distanceMetres: number): string {
  return JSON.stringify([coreId, mode, distanceMetres]);
}

export function projectTournamentHistoricalStarSupport(
  rule: Pick<
    TournamentRuleConfiguration,
    "mode" | "eligibleDistancesMetres" | "qualification"
  >,
  candidates: readonly TournamentStarCandidate[],
  profiles: readonly TournamentStarProfile[],
): ReadonlyMap<string, TournamentHistoricalStarSupport> {
  const candidateIds = candidates.map((candidate) =>
    required(candidate.coreId, "Tournament star candidate Core ID"),
  );
  if (new Set(candidateIds).size !== candidateIds.length) {
    throw new Error("Tournament star candidate Core IDs must be unique.");
  }

  const profilesByKey = new Map<string, TournamentStarProfile>();
  for (const input of profiles) {
    const profile: TournamentStarProfile = {
      ...input,
      coreId: required(input.coreId, "Tournament star profile Core ID"),
      mode: required(input.mode, "Tournament star profile mode"),
      distanceMetres: positiveInteger(
        input.distanceMetres,
        "Tournament star profile distance",
      ),
      dataCurrentThrough: timestamp(
        input.dataCurrentThrough,
        "Tournament star profile cutoff",
      ),
      raceCount: positiveInteger(
        input.raceCount,
        "Tournament star profile race count",
      ),
      completeStarDataRaceCount: count(
        input.completeStarDataRaceCount,
        "Tournament complete star-data count",
      ),
      partialStarDataRaceCount: count(
        input.partialStarDataRaceCount,
        "Tournament partial star-data count",
      ),
      missingStarDataRaceCount: count(
        input.missingStarDataRaceCount,
        "Tournament missing star-data count",
      ),
      invalidStarDataRaceCount: count(
        input.invalidStarDataRaceCount,
        "Tournament invalid star-data count",
      ),
      goldAssignmentOpportunityCount: count(
        input.goldAssignmentOpportunityCount,
        "Tournament Gold opportunity count",
      ),
      goldReceivedCount: count(
        input.goldReceivedCount,
        "Tournament Gold received count",
      ),
      goldNegativeOpportunityCount: count(
        input.goldNegativeOpportunityCount,
        "Tournament Gold negative-opportunity count",
      ),
      goldExcludedAnomalyCount: count(
        input.goldExcludedAnomalyCount,
        "Tournament Gold anomaly count",
      ),
      blueAssignmentOpportunityCount: count(
        input.blueAssignmentOpportunityCount,
        "Tournament Blue opportunity count",
      ),
      blueReceivedCount: count(
        input.blueReceivedCount,
        "Tournament Blue received count",
      ),
      blueNegativeOpportunityCount: count(
        input.blueNegativeOpportunityCount,
        "Tournament Blue negative-opportunity count",
      ),
      blueExcludedAnomalyCount: count(
        input.blueExcludedAnomalyCount,
        "Tournament Blue anomaly count",
      ),
    };
    if (
      profile.completeStarDataRaceCount +
        profile.partialStarDataRaceCount +
        profile.missingStarDataRaceCount +
        profile.invalidStarDataRaceCount !==
        profile.raceCount ||
      profile.goldReceivedCount + profile.goldNegativeOpportunityCount !==
        profile.goldAssignmentOpportunityCount ||
      profile.blueReceivedCount + profile.blueNegativeOpportunityCount !==
        profile.blueAssignmentOpportunityCount ||
      profile.goldAssignmentOpportunityCount > profile.raceCount ||
      profile.blueAssignmentOpportunityCount > profile.raceCount
    ) {
      throw new Error("Tournament star profile is inconsistent.");
    }
    const profileKey = key(
      profile.coreId,
      profile.mode,
      profile.distanceMetres,
    );
    if (profilesByKey.has(profileKey)) {
      throw new Error("Tournament star profile is duplicated.");
    }
    profilesByKey.set(profileKey, profile);
  }

  const minimumRaceCount = positiveInteger(
    rule.qualification.minimumRaceCount,
    "Tournament star minimum race count",
  );
  const exactDistance =
    rule.eligibleDistancesMetres.length === 1
      ? positiveInteger(
          rule.eligibleDistancesMetres[0]!,
          "Tournament star exact distance",
        )
      : null;
  const result = new Map<string, TournamentHistoricalStarSupport>();

  for (const candidate of candidates) {
    const coreId = required(candidate.coreId, "Tournament star candidate Core ID");
    if (candidate.eligibility !== "eligible" || exactDistance === null) {
      result.set(coreId, "unavailable");
      continue;
    }
    const profile = profilesByKey.get(key(coreId, rule.mode, exactDistance));
    if (
      profile === undefined ||
      profile.invalidStarDataRaceCount > 0 ||
      profile.goldExcludedAnomalyCount > 0 ||
      profile.blueExcludedAnomalyCount > 0 ||
      (profile.goldAssignmentOpportunityCount === 0 &&
        profile.blueAssignmentOpportunityCount === 0)
    ) {
      result.set(coreId, "unavailable");
      continue;
    }

    const repeatedPositive =
      profile.goldReceivedCount >= 2 || profile.blueReceivedCount >= 2;
    const repeatedNegative =
      (profile.goldAssignmentOpportunityCount >= minimumRaceCount &&
        profile.goldReceivedCount === 0) ||
      (profile.blueAssignmentOpportunityCount >= minimumRaceCount &&
        profile.blueReceivedCount === 0);
    const timePositive = ["strong", "competitive"].includes(
      candidate.timeEvidence,
    );

    result.set(
      coreId,
      (repeatedPositive && candidate.timeEvidence === "weak") ||
        (repeatedNegative && timePositive)
        ? "conflicts"
        : repeatedPositive
          ? "supports"
          : "neutral",
    );
  }

  return result;
}
