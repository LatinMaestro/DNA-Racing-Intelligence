import type { BreedingPairRankingResult } from "@/domain/breeding-pair-ranking";
import type { ProLeagueCoverageGap } from "@/domain/pro-league-matchup";
import type { ProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";

const MAXIMUM_RANKINGS = 200;
const MAXIMUM_PRIORITY_GAPS = 100;
const MAXIMUM_PAIR_ROWS = 2_000;
const MAXIMUM_CANDIDATES_PER_OBJECTIVE = 4;

type RankedPair = BreedingPairRankingResult["vaultGapRanking"][number];

export type ProLeagueBreedingObjectiveCandidate = Readonly<{
  rankingId: string;
  pairId: string;
  parentCoreIds: RankedPair["parentCoreIds"];
  source: RankedPair["source"];
  evidenceConfidence: RankedPair["evidenceConfidence"];
  predictedOffspringClass: RankedPair["predictedOffspringClass"];
  predictedOffspringElement: RankedPair["predictedOffspringElement"];
  predictedOffspringFNumber: number;
  exceptionalUpsideBasisPoints: number;
  strongerOrExceptionalBasisPoints: number;
  vaultFitBasisPoints: number;
  researchRoles: readonly ("vault_gap" | "elite_upside")[];
  performanceEvidenceScope: "bike_exact_distance_only";
  proLeagueRaceTypeEvidence: "unavailable";
  officialPairValidation: "required_at_decision_time";
  officialPairInfo: "required_at_decision_time";
  recommendationAllowed: false;
  spliceExecutionAllowed: false;
}>;

export type ProLeagueBreedingObjective = Readonly<{
  objectiveId: string;
  raceType: string;
  distanceMetres: number;
  mapIds: ProLeagueCoverageGap["mapIds"];
  raceLineCount: number;
  gapPriority: "high" | "medium";
  gapStatus: ProLeagueCoverageGap["status"];
  status: "research_candidates" | "wait_no_exact_distance_pair_evidence";
  candidates: readonly ProLeagueBreedingObjectiveCandidate[];
  warnings: readonly (
    | "RACE_TYPE_PAIR_EVIDENCE_UNAVAILABLE"
    | "OFFICIAL_PAIR_VALIDATION_REQUIRED"
    | "OFFICIAL_PAIR_INFO_REQUIRED"
    | "GATE_E_NOT_PASSED"
    | "BREEDING_OUTCOME_IS_PROBABILISTIC"
    | "ARENA_STATE_MUST_BE_REVALIDATED"
    | "NO_CURRENT_EXACT_DISTANCE_PAIR_EVIDENCE"
  )[];
}>;

export type ProLeagueBreedingObjectiveQueue = Readonly<{
  authority: "active_verified_exact_format_generation";
  evidenceCutoffAt: string;
  objectives: readonly ProLeagueBreedingObjective[];
  diagnostics: Readonly<{
    priorityGapCount: number;
    researchCandidateCount: number;
    waitingObjectiveCount: number;
    staleOrUnknownRankingCount: number;
    nonBikePairRowCount: number;
  }>;
  decisionSupportOnly: true;
  recommendationAllowed: false;
  automaticPairValidationAllowed: false;
  spliceExecutionAllowed: false;
}>;

type CandidateAccumulator = {
  rankingId: string;
  pair: RankedPair;
  roles: Set<"vault_gap" | "elite_upside">;
  bestRank: number;
};

function objectiveId(gap: ProLeagueCoverageGap): string {
  return `${gap.raceType.trim().toLowerCase()}:${gap.distanceMetres}`;
}

function pairKey(rankingId: string, pair: RankedPair): string {
  return JSON.stringify([
    rankingId,
    [...pair.parentCoreIds].sort((left, right) => left.localeCompare(right)),
  ]);
}

function assertSafeRanking(ranking: BreedingPairRankingResult): void {
  if (
    ranking.recommendationAllowed !== false ||
    ranking.breedingExecutionAllowed !== false ||
    ranking.gateEPassed !== false
  ) {
    throw new Error(
      "Pro League breeding objectives require held Gate E evidence.",
    );
  }
}

export function buildProLeagueBreedingObjectiveQueue(
  roster: ProLeagueDraftRosterRecommendation,
  rankings: readonly BreedingPairRankingResult[],
): ProLeagueBreedingObjectiveQueue {
  if (
    roster.authority !== "active_verified_exact_format_generation" ||
    !Array.isArray(roster.coverageGaps) ||
    !Array.isArray(rankings)
  ) {
    throw new Error("Pro League breeding objective input is invalid.");
  }
  if (rankings.length > MAXIMUM_RANKINGS) {
    throw new Error("Pro League breeding ranking bound was exceeded.");
  }
  const gaps = roster.coverageGaps.filter(
    (
      gap,
    ): gap is ProLeagueCoverageGap & {
      discoveryPriority: "high" | "medium";
    } => gap.discoveryPriority !== "maintain",
  );
  if (gaps.length > MAXIMUM_PRIORITY_GAPS) {
    throw new Error("Pro League breeding objective bound was exceeded.");
  }

  let pairRowCount = 0;
  let staleOrUnknownRankingCount = 0;
  let nonBikePairRowCount = 0;
  const currentRankings = rankings.filter((ranking) => {
    assertSafeRanking(ranking);
    pairRowCount +=
      ranking.vaultGapRanking.length + ranking.eliteUpsideRanking.length;
    if (pairRowCount > MAXIMUM_PAIR_ROWS) {
      throw new Error("Pro League breeding pair row bound was exceeded.");
    }
    nonBikePairRowCount += [
      ...ranking.vaultGapRanking,
      ...ranking.eliteUpsideRanking,
    ].filter(({ mode }) => mode !== "Bike").length;
    if (ranking.freshness === "stale" || ranking.freshness === "unknown") {
      staleOrUnknownRankingCount += 1;
      return false;
    }
    return true;
  });

  const objectives = gaps.map((gap): ProLeagueBreedingObjective => {
    const candidates = new Map<string, CandidateAccumulator>();
    for (const ranking of currentRankings) {
      for (const [role, rows] of [
        ["vault_gap", ranking.vaultGapRanking],
        ["elite_upside", ranking.eliteUpsideRanking],
      ] as const) {
        for (const pair of rows) {
          if (pair.mode !== "Bike") continue;
          if (pair.rank > 2) continue;
          if (pair.exactDistanceM !== gap.distanceMetres) continue;
          const key = pairKey(ranking.rankingId, pair);
          const existing = candidates.get(key);
          if (existing === undefined) {
            candidates.set(key, {
              rankingId: ranking.rankingId,
              pair,
              roles: new Set([role]),
              bestRank: pair.rank,
            });
          } else {
            existing.roles.add(role);
            existing.bestRank = Math.min(existing.bestRank, pair.rank);
          }
        }
      }
    }
    const selected = [...candidates.values()]
      .sort(
        (left, right) =>
          Number(right.roles.has("vault_gap")) -
            Number(left.roles.has("vault_gap")) ||
          Number(right.roles.has("elite_upside")) -
            Number(left.roles.has("elite_upside")) ||
          left.bestRank - right.bestRank ||
          right.pair.exceptionalUpsideBasisPoints -
            left.pair.exceptionalUpsideBasisPoints ||
          left.rankingId.localeCompare(right.rankingId) ||
          left.pair.pairId.localeCompare(right.pair.pairId),
      )
      .slice(0, MAXIMUM_CANDIDATES_PER_OBJECTIVE)
      .map(({ rankingId, pair, roles }): ProLeagueBreedingObjectiveCandidate =>
        Object.freeze({
          rankingId,
          pairId: pair.pairId,
          parentCoreIds: pair.parentCoreIds,
          source: pair.source,
          evidenceConfidence: pair.evidenceConfidence,
          predictedOffspringClass: pair.predictedOffspringClass,
          predictedOffspringElement: pair.predictedOffspringElement,
          predictedOffspringFNumber: pair.predictedOffspringFNumber,
          exceptionalUpsideBasisPoints: pair.exceptionalUpsideBasisPoints,
          strongerOrExceptionalBasisPoints:
            pair.strongerOrExceptionalBasisPoints,
          vaultFitBasisPoints: pair.vaultFitBasisPoints,
          researchRoles: Object.freeze([...roles].sort()),
          performanceEvidenceScope: "bike_exact_distance_only",
          proLeagueRaceTypeEvidence: "unavailable",
          officialPairValidation: "required_at_decision_time",
          officialPairInfo: "required_at_decision_time",
          recommendationAllowed: false,
          spliceExecutionAllowed: false,
        }),
      );
    const warnings = new Set<ProLeagueBreedingObjective["warnings"][number]>([
      "RACE_TYPE_PAIR_EVIDENCE_UNAVAILABLE",
      "OFFICIAL_PAIR_VALIDATION_REQUIRED",
      "OFFICIAL_PAIR_INFO_REQUIRED",
      "GATE_E_NOT_PASSED",
      "BREEDING_OUTCOME_IS_PROBABILISTIC",
    ]);
    if (selected.some(({ source }) => source !== "owned_owned")) {
      warnings.add("ARENA_STATE_MUST_BE_REVALIDATED");
    }
    if (selected.length === 0) {
      warnings.add("NO_CURRENT_EXACT_DISTANCE_PAIR_EVIDENCE");
    }
    return Object.freeze({
      objectiveId: objectiveId(gap),
      raceType: gap.raceType,
      distanceMetres: gap.distanceMetres,
      mapIds: gap.mapIds,
      raceLineCount: gap.raceLineCount,
      gapPriority: gap.discoveryPriority,
      gapStatus: gap.status,
      status:
        selected.length === 0
          ? "wait_no_exact_distance_pair_evidence"
          : "research_candidates",
      candidates: Object.freeze(selected),
      warnings: Object.freeze([...warnings].sort()),
    });
  });
  objectives.sort(
    (left, right) =>
      ({ high: 0, medium: 1 })[left.gapPriority] -
        { high: 0, medium: 1 }[right.gapPriority] ||
      right.raceLineCount - left.raceLineCount ||
      left.raceType.localeCompare(right.raceType) ||
      left.distanceMetres - right.distanceMetres,
  );
  return Object.freeze({
    authority: "active_verified_exact_format_generation",
    evidenceCutoffAt: roster.evidenceCutoffAt,
    objectives: Object.freeze(objectives),
    diagnostics: Object.freeze({
      priorityGapCount: gaps.length,
      researchCandidateCount: objectives.reduce(
        (count, objective) => count + objective.candidates.length,
        0,
      ),
      waitingObjectiveCount: objectives.filter(
        ({ status }) => status === "wait_no_exact_distance_pair_evidence",
      ).length,
      staleOrUnknownRankingCount,
      nonBikePairRowCount,
    }),
    decisionSupportOnly: true,
    recommendationAllowed: false,
    automaticPairValidationAllowed: false,
    spliceExecutionAllowed: false,
  });
}
