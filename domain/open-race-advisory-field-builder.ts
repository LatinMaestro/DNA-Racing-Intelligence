import type { CorePerformanceProfile } from "@/domain/core-performance";
import { type OwnerVaultOpenRaceAdvisoryField } from "@/domain/open-race-accepted-evaluation";
import {
  evaluateOpenRaceEligibility,
  type OpenRaceEligibilityRules,
} from "@/domain/open-race-eligibility";
import { scanOwnerVaultOpenRaceOpportunities } from "@/domain/open-race-owner-vault-scanner";

export type OpenRaceAdvisoryFieldEvidence = Readonly<{
  evaluatedAt: string;
  dataCurrentThrough: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  materialGapMs: number;
  rulesByRaceId: Readonly<Record<string, OpenRaceEligibilityRules>>;
  availabilityByCoreId: Readonly<
    Record<string, "available" | "unavailable" | "unresolved">
  >;
  maidenStateByCoreId: Readonly<
    Record<string, "eligible" | "not_eligible" | "unknown" | "invalid">
  >;
}>;

export type OpenRaceAdvisoryFieldBuild =
  | Readonly<{
      status: "ready";
      fields: readonly OwnerVaultOpenRaceAdvisoryField[];
    }>
  | Readonly<{
      status: "unavailable";
      reason:
        | "missing_race_rules"
        | "no_eligible_candidate"
        | "missing_candidate_profile"
        | "duplicate_profile";
      fields: null;
    }>;

function profileKey(input: { coreId: string; mode: string; distance: number }) {
  return JSON.stringify([input.coreId, input.mode, input.distance]);
}

function timeProfile(profile: CorePerformanceProfile) {
  const optimisticTimeMs = Math.round(profile.elapsedTime.bestMilliseconds);
  const medianTimeMs = Math.round(profile.elapsedTime.medianMilliseconds);
  return {
    optimisticTimeMs,
    medianTimeMs,
    conservativeTimeMs:
      medianTimeMs + Math.max(0, medianTimeMs - optimisticTimeMs),
    sampleCount: profile.raceCount,
    sampleStatus: profile.sampleStatus,
  };
}

function historicalStars(profile: CorePerformanceProfile) {
  const stars = profile.starProfile;
  if (stars === null) {
    return {
      goldReceived: 0,
      goldOpportunities: 0,
      blueReceived: 0,
      blueOpportunities: 0,
      evidenceStatus: "partial" as const,
      rationale: ["Accepted historical star evidence is unavailable."],
    };
  }
  const complete =
    stars.partialStarDataRaceCount === 0 &&
    stars.missingStarDataRaceCount === 0 &&
    stars.invalidStarDataRaceCount === 0;
  return {
    goldReceived: stars.goldReceivedCount,
    goldOpportunities: stars.goldAssignmentOpportunityCount,
    blueReceived: stars.blueReceivedCount,
    blueOpportunities: stars.blueAssignmentOpportunityCount,
    evidenceStatus: complete ? ("complete" as const) : ("partial" as const),
    rationale: [
      complete
        ? "Accepted historical star evidence is complete."
        : "Accepted historical star evidence is partial.",
    ],
  };
}

/** Builds evaluator fields only from the canonical API envelope and accepted
 * owner/profile evidence. It does not score, derive new weights, or use stars
 * from the current forming race. Missing rules or exact-context candidate
 * history fail closed before ranking.
 */
export function buildOpenRaceAdvisoryFields(
  input: Readonly<{
    scan: Parameters<typeof scanOwnerVaultOpenRaceOpportunities>[0];
    profiles: readonly CorePerformanceProfile[];
    evidence: OpenRaceAdvisoryFieldEvidence;
  }>,
): OpenRaceAdvisoryFieldBuild {
  const ownerScan = scanOwnerVaultOpenRaceOpportunities(input.scan);
  const profiles = new Map<string, CorePerformanceProfile>();
  for (const profile of input.profiles) {
    const key = profileKey(profile);
    if (profiles.has(key)) {
      return {
        status: "unavailable",
        reason: "duplicate_profile",
        fields: null,
      };
    }
    profiles.set(key, profile);
  }

  const fields: OwnerVaultOpenRaceAdvisoryField[] = [];
  for (const opportunity of ownerScan.scan.opportunities) {
    const rules = input.evidence.rulesByRaceId[opportunity.raceId];
    if (rules === undefined) {
      return {
        status: "unavailable",
        reason: "missing_race_rules",
        fields: null,
      };
    }
    const eligibility = {
      evaluationId: `open-race-eligibility:${opportunity.raceId}`,
      evaluatedAt: input.evidence.evaluatedAt,
      vaultDataCurrentThrough: input.evidence.dataCurrentThrough,
      freshness: input.evidence.freshness,
      rules,
      cores: input.scan.ownedCores.map(({ canonical }) => ({
        coreId: canonical.sourceCoreId,
        activeOwnership: "confirmed" as const,
        availability:
          input.evidence.availabilityByCoreId[canonical.sourceCoreId] ??
          "unresolved",
        coreClass: canonical.coreClass,
        element: canonical.element,
        fNumber: canonical.fNumber,
        maidenState:
          input.evidence.maidenStateByCoreId[canonical.sourceCoreId] ??
          "unknown",
        attributeEvidence: "complete" as const,
      })),
    };
    const eligible = evaluateOpenRaceEligibility(eligibility).eligibleCoreIds;
    if (eligible.length === 0) {
      return {
        status: "unavailable",
        reason: "no_eligible_candidate",
        fields: null,
      };
    }
    const candidateProfiles = eligible.map((coreId) =>
      profiles.get(
        profileKey({
          coreId,
          mode: opportunity.mode,
          distance: opportunity.distanceMetres,
        }),
      ),
    );
    if (candidateProfiles.some((profile) => profile === undefined)) {
      return {
        status: "unavailable",
        reason: "missing_candidate_profile",
        fields: null,
      };
    }
    fields.push({
      raceId: opportunity.raceId,
      eligibility,
      rankingId: `open-race-ranking:${opportunity.raceId}`,
      evaluatedAt: input.evidence.evaluatedAt,
      dataCurrentThrough: input.evidence.dataCurrentThrough,
      freshness: input.evidence.freshness,
      materialGapMs: input.evidence.materialGapMs,
      eligibleCandidates: candidateProfiles.map((profile) => ({
        coreId: profile!.coreId,
        eligibilityStatus: "eligible",
        mode: opportunity.mode,
        distanceMeters: opportunity.distanceMetres,
        profile: timeProfile(profile!),
        historicalStars: historicalStars(profile!),
      })),
      opponents: opportunity.enteredOpponentCoreIds.map((coreId) => {
        const profile = profiles.get(
          profileKey({
            coreId,
            mode: opportunity.mode,
            distance: opportunity.distanceMetres,
          }),
        );
        return {
          coreId,
          identityStatus: profile === undefined ? "unresolved" : "confirmed",
          mode: opportunity.mode,
          distanceMeters: opportunity.distanceMetres,
          profile: profile === undefined ? null : timeProfile(profile),
        };
      }),
    });
  }
  return { status: "ready", fields };
}
