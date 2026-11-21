import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";
import {
  rankOpenRacePreEntry,
  type OpenRacePreEntryRankingInput,
  type OpenRacePreEntryRankingResult,
  type OpenRaceRankedCandidate,
  type OpenRaceRankedOpponent,
} from "@/domain/open-race-pre-entry-ranking";

export type OpenRaceOpportunityDecision = Readonly<{
  raceId: string;
  decision: "provisional_pick" | "avoid" | "unavailable";
  recommendedCoreId: string | null;
  viableAlternativeCoreIds: readonly string[];
  explanation: readonly string[];
  ranking: OpenRacePreEntryRankingResult;
  advisoryOnly: true;
  queueAllowed: false;
  gameEntryAllowed: false;
}>;

function sameIdentitySet(left: readonly string[], right: readonly string[]) {
  const normalizedLeft = [...left].sort();
  const normalizedRight = [...right].sort();
  return (
    normalizedLeft.length === normalizedRight.length &&
    normalizedLeft.every((value, index) => normalizedRight[index] === value)
  );
}

/**
 * Bridges one verified ordinary Open Race opportunity into the accepted
 * pre-entry ranking method. Eligibility and exact-context profiles are
 * supplied by their existing authorities; this layer adds no score or weight.
 * It refuses changed opponent fields and keeps every result advisory-only.
 */
export function evaluateOpenRaceOpportunity(
  input: Readonly<{
    rankingId: string;
    evaluatedAt: string;
    dataCurrentThrough: string;
    freshness: OpenRacePreEntryRankingInput["freshness"];
    materialGapMs: number;
    opportunity: OpenRaceScanOpportunity;
    eligibleCandidates: readonly OpenRaceRankedCandidate[];
    opponents: readonly OpenRaceRankedOpponent[];
  }>,
): OpenRaceOpportunityDecision {
  if (
    input.opportunity.eligibility !== "needs_owner_core_restriction_check" ||
    input.opportunity.rank !== "not_evaluated" ||
    input.opportunity.gameEntryAllowed !== false
  ) {
    throw new Error("Open Race opportunity is not an unranked advisory field.");
  }
  if (
    !sameIdentitySet(
      input.opportunity.enteredOpponentCoreIds,
      input.opponents.map(({ coreId }) => coreId),
    )
  ) {
    throw new Error(
      "Open Race opponent evidence does not match the current field.",
    );
  }

  const ranking = rankOpenRacePreEntry({
    rankingId: input.rankingId,
    evaluatedAt: input.evaluatedAt,
    dataCurrentThrough: input.dataCurrentThrough,
    freshness: input.freshness,
    fieldStage: "forming",
    mode: input.opportunity.mode,
    distanceMeters: input.opportunity.distanceMetres,
    materialGapMs: input.materialGapMs,
    candidates: input.eligibleCandidates,
    opponents: input.opponents,
  });

  const viableAlternativeCoreIds = ranking.rankedCandidates
    .filter(({ rank }) => rank > 1)
    .map(({ coreId }) => coreId);
  if (ranking.status === "insufficient_evidence") {
    return {
      raceId: input.opportunity.raceId,
      decision: "unavailable",
      recommendedCoreId: null,
      viableAlternativeCoreIds,
      explanation: ranking.reviewReasons,
      ranking,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  }
  if (ranking.avoidSignal) {
    return {
      raceId: input.opportunity.raceId,
      decision: "avoid",
      recommendedCoreId: null,
      viableAlternativeCoreIds,
      explanation: [
        "Even the strongest eligible Core's optimistic time is slower than the strongest opponent's conservative time.",
      ],
      ranking,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  }

  const recommendedCoreId = ranking.provisionalRecommendedCoreId;
  if (recommendedCoreId === null) {
    throw new Error("Open Race provisional ranking has no leading Core.");
  }
  const leader = ranking.rankedCandidates.find(
    ({ coreId }) => coreId === recommendedCoreId,
  );
  const opponentMargin = leader?.marginToStrongestOpponentMs ?? null;
  return {
    raceId: input.opportunity.raceId,
    decision: "provisional_pick",
    recommendedCoreId,
    viableAlternativeCoreIds,
    explanation: [
      opponentMargin === null
        ? "The leading eligible Core has the strongest accepted exact-context time profile."
        : opponentMargin >= 0
          ? `The leading eligible Core's median time is ${opponentMargin} ms faster than the strongest verified opponent.`
          : `The leading eligible Core's median time is ${Math.abs(opponentMargin)} ms slower than the strongest verified opponent, but their accepted time ranges overlap.`,
    ],
    ranking,
    advisoryOnly: true,
    queueAllowed: false,
    gameEntryAllowed: false,
  };
}
