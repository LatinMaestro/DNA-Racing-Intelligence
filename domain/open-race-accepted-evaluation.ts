import type { CorePerformanceProfile } from "@/domain/core-performance";
import {
  evaluateOpenRaceEligibility,
  type OpenRaceEligibilityInput,
} from "@/domain/open-race-eligibility";
import {
  evaluateOpenRaceOpportunity,
  type OpenRaceOpportunityDecision,
} from "@/domain/open-race-opportunity-evaluation";
import type { OwnerVaultOpenRaceScan } from "@/domain/open-race-owner-vault-scanner";
import {
  resolveOpenRacePerformanceEvidence,
  type OpenRacePerformanceEvidence,
} from "@/domain/open-race-performance-evidence";
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

export type OwnerVaultOpenRaceAdvisoryField = Readonly<{
  raceId: string;
  eligibility: OpenRaceEligibilityInput;
  rankingId: string;
  evaluatedAt: string;
  dataCurrentThrough: string;
  freshness: Parameters<typeof evaluateOpenRaceOpportunity>[0]["freshness"];
  materialGapMs: number;
  eligibleCandidates: readonly OpenRaceRankedCandidate[];
  opponents: readonly OpenRaceRankedOpponent[];
}>;

export type OwnerVaultOpenRaceAdvisoryBatch = Readonly<{
  sourceGenerationId: string;
  racesScanned: number;
  qualifyingRaceCount: number;
  ownerCoreCount: number;
  eligibleCandidateComparisons: number;
  opponentComparisons: number;
  evaluations: readonly OpenRaceAcceptedEvaluation[];
  advisoryOnly: true;
  queueAllowed: false;
  gameEntryAllowed: false;
}>;

/**
 * Coordinates the existing ordinary Open Race advisory steps for every race
 * that passed the whole-Vault live scanner. Each owner Core is hard-filtered
 * for eligibility before accepted performance evidence can reach ranking.
 * Tournament qualification and Free Discovery use their separate selectors;
 * this ordinary advisory coordinator does not alter either execution lane.
 */
export function evaluateOwnerVaultOpenRaceAdvisories(
  input: Readonly<{
    ownerScan: OwnerVaultOpenRaceScan;
    completeOwnedCoreIds: readonly string[];
    profiles: readonly CorePerformanceProfile[];
    fields: readonly OwnerVaultOpenRaceAdvisoryField[];
  }>,
): OwnerVaultOpenRaceAdvisoryBatch {
  const ownedCoreIds = [...input.completeOwnedCoreIds];
  if (
    ownedCoreIds.length !== input.ownerScan.ownedCoreCount ||
    new Set(ownedCoreIds).size !== ownedCoreIds.length ||
    ownedCoreIds.some((coreId) => !/^[1-9]\d*$/u.test(coreId))
  ) {
    throw new Error(
      "Open Race advisory owner Cores do not match the whole-Vault scan.",
    );
  }
  if (
    input.ownerScan.ownerCoreUniverse !== "complete_serving_generation" ||
    input.ownerScan.gameEntryAllowed !== false ||
    input.ownerScan.scan.gameEntryAllowed !== false ||
    input.ownerScan.enteredOpponentCount !==
      input.ownerScan.scan.opportunities.reduce(
        (count, opportunity) =>
          count + opportunity.enteredOpponentCoreIds.length,
        0,
      )
  ) {
    throw new Error("Open Race advisory scan authority is invalid.");
  }

  const opportunities = input.ownerScan.scan.opportunities;
  if (
    opportunities.length > 100 ||
    input.fields.length !== opportunities.length ||
    new Set(input.fields.map(({ raceId }) => raceId)).size !==
      input.fields.length ||
    !sameIdentitySet(
      opportunities.map(({ raceId }) => raceId),
      input.fields.map(({ raceId }) => raceId),
    )
  ) {
    throw new Error(
      "Open Race advisory fields do not match the verified opportunities.",
    );
  }

  const fields = new Map(input.fields.map((field) => [field.raceId, field]));
  let eligibleCandidateComparisons = 0;
  let opponentComparisons = 0;
  const evaluations = opportunities.map((opportunity) => {
    const field = fields.get(opportunity.raceId)!;
    if (
      !sameIdentitySet(
        field.eligibility.cores.map(({ coreId }) => coreId),
        ownedCoreIds,
      )
    ) {
      throw new Error(
        "Open Race eligibility does not cover the complete owner Vault.",
      );
    }
    if (
      !sameIdentitySet(
        field.opponents.map(({ coreId }) => coreId),
        opportunity.enteredOpponentCoreIds,
      )
    ) {
      throw new Error(
        "Open Race advisory opponents do not match the verified field.",
      );
    }

    const eligibility = evaluateOpenRaceEligibility(field.eligibility);
    if (
      !sameIdentitySet(
        eligibility.eligibleCoreIds,
        field.eligibleCandidates.map(({ coreId }) => coreId),
      )
    ) {
      throw new Error(
        "Open Race ranked candidates do not match hard eligibility.",
      );
    }
    eligibleCandidateComparisons += eligibility.eligibleCoreIds.length;
    opponentComparisons += field.opponents.length;

    const evidence = resolveOpenRacePerformanceEvidence({
      opportunity,
      authority: "accepted_profile_read_model",
      completeOwnedCoreIds: ownedCoreIds,
      eligibleOwnedCoreIds: eligibility.eligibleCoreIds,
      profiles: input.profiles,
    });
    return evaluateOpenRaceAcceptedEvidence({
      evidence,
      evaluation: {
        rankingId: field.rankingId,
        evaluatedAt: field.evaluatedAt,
        dataCurrentThrough: field.dataCurrentThrough,
        freshness: field.freshness,
        materialGapMs: field.materialGapMs,
        opportunity,
        eligibleCandidates: field.eligibleCandidates,
        opponents: field.opponents,
      },
    });
  });

  return {
    sourceGenerationId: input.ownerScan.sourceGenerationId,
    racesScanned: opportunities.length + input.ownerScan.scan.excluded.length,
    qualifyingRaceCount: opportunities.length,
    ownerCoreCount: ownedCoreIds.length,
    eligibleCandidateComparisons,
    opponentComparisons,
    evaluations,
    advisoryOnly: true,
    queueAllowed: false,
    gameEntryAllowed: false,
  };
}
