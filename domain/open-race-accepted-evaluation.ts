import type { CorePerformanceProfile } from "@/domain/core-performance";
import {
  evaluateOpenRaceOpportunity,
  type OpenRaceOpportunityDecision,
} from "@/domain/open-race-opportunity-evaluation";
import type { OpenRacePerformanceEvidence } from "@/domain/open-race-performance-evidence";
import type {
  OpenRaceRankedCandidate,
  OpenRaceRankedOpponent,
} from "@/domain/open-race-pre-entry-ranking";

export type OpenRaceAcceptedEvaluation =
  | OpenRaceOpportunityDecision
  | Readonly<{
      raceId: string;
      decision: "unavailable";
      recommendedCoreId: null;
      viableAlternativeCoreIds: readonly [];
      explanation: readonly string[];
      ranking: null;
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

function assertAcceptedProfile(
  ranked:
    | OpenRaceRankedCandidate
    | (OpenRaceRankedOpponent & {
        profile: NonNullable<OpenRaceRankedOpponent["profile"]>;
      }),
  accepted: CorePerformanceProfile,
): void {
  if (
    ranked.coreId !== accepted.coreId ||
    ranked.mode !== accepted.mode ||
    ranked.distanceMeters !== accepted.distance ||
    ranked.profile.optimisticTimeMs !==
      Math.round(accepted.elapsedTime.bestMilliseconds) ||
    ranked.profile.medianTimeMs !==
      Math.round(accepted.elapsedTime.medianMilliseconds) ||
    ranked.profile.sampleCount !== accepted.raceCount ||
    ranked.profile.sampleStatus !== accepted.sampleStatus
  ) {
    throw new Error(
      `Open Race ranked profile for Core ${ranked.coreId} does not match accepted exact-context history.`,
    );
  }
}

/**
 * Joins accepted exact-context history to the existing Open Race evaluator.
 * It verifies only facts published by the accepted performance read model and
 * does not derive a new distribution, score or weight. Evidence failures stay
 * unavailable and every successful evaluation remains advisory-only.
 */
export function evaluateOpenRaceAcceptedEvidence(
  input: Readonly<{
    evidence: OpenRacePerformanceEvidence;
    evaluation: Parameters<typeof evaluateOpenRaceOpportunity>[0];
  }>,
): OpenRaceAcceptedEvaluation {
  if (input.evidence.raceId !== input.evaluation.opportunity.raceId) {
    throw new Error("Open Race evidence does not match the evaluated race.");
  }
  if (input.evidence.status !== "ready" || !input.evidence.readyForRanking) {
    return {
      raceId: input.evidence.raceId,
      decision: "unavailable",
      recommendedCoreId: null,
      viableAlternativeCoreIds: [],
      explanation:
        input.evidence.reasons.length > 0
          ? input.evidence.reasons
          : ["Accepted exact-context history is unavailable."],
      ranking: null,
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    };
  }

  if (
    !sameIdentitySet(
      input.evidence.candidateProfiles.map(({ coreId }) => coreId),
      input.evaluation.eligibleCandidates.map(({ coreId }) => coreId),
    )
  ) {
    throw new Error(
      "Open Race ranked candidates do not match the accepted evidence.",
    );
  }
  if (
    !sameIdentitySet(
      input.evidence.opponentProfiles.map(({ coreId }) => coreId),
      input.evaluation.opponents.map(({ coreId }) => coreId),
    )
  ) {
    throw new Error(
      "Open Race ranked opponents do not match the accepted evidence.",
    );
  }

  const acceptedCandidates = new Map(
    input.evidence.candidateProfiles.map((profile) => [
      profile.coreId,
      profile,
    ]),
  );
  for (const candidate of input.evaluation.eligibleCandidates) {
    const accepted = acceptedCandidates.get(candidate.coreId);
    if (accepted === undefined) {
      throw new Error(
        `Open Race accepted history is missing for Core ${candidate.coreId}.`,
      );
    }
    assertAcceptedProfile(candidate, accepted);
  }

  const acceptedOpponents = new Map(
    input.evidence.opponentProfiles.map(({ coreId, profile }) => [
      coreId,
      profile,
    ]),
  );
  for (const opponent of input.evaluation.opponents) {
    const accepted = acceptedOpponents.get(opponent.coreId);
    if (
      opponent.identityStatus !== "confirmed" ||
      opponent.profile === null ||
      accepted === undefined ||
      accepted === null
    ) {
      throw new Error(
        `Open Race accepted opponent history is missing for Core ${opponent.coreId}.`,
      );
    }
    assertAcceptedProfile(
      opponent as OpenRaceRankedOpponent & {
        profile: NonNullable<OpenRaceRankedOpponent["profile"]>;
      },
      accepted,
    );
  }

  return evaluateOpenRaceOpportunity(input.evaluation);
}
