import type { CorePerformanceProfile } from "@/domain/core-performance";
import { type OwnerVaultOpenRaceAdvisoryField } from "@/domain/open-race-accepted-evaluation";
import {
  evaluateOpenRaceEligibility,
  type OpenRaceEligibilityRules,
} from "@/domain/open-race-eligibility";
import { scanOwnerVaultOpenRaceOpportunities } from "@/domain/open-race-owner-vault-scanner";
import type { OpenRaceTimeProfile } from "@/domain/open-race-pre-entry-ranking";

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
  rankingProfiles: readonly Readonly<{
    coreId: string;
    mode: "bike" | "car" | "horse";
    distanceMeters: number;
    profile: OpenRaceTimeProfile;
  }>[];
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
  const rankingProfiles = new Map<string, OpenRaceTimeProfile>();
  for (const ranked of input.evidence.rankingProfiles) {
    const key = profileKey({
      coreId: ranked.coreId,
      mode: ranked.mode,
      distance: ranked.distanceMeters,
    });
    if (rankingProfiles.has(key)) {
      return {
        status: "unavailable",
        reason: "duplicate_profile",
        fields: null,
      };
    }
    rankingProfiles.set(key, ranked.profile);
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
    const candidateProfiles = eligible.map((coreId) => {
      const key = profileKey({
        coreId,
        mode: opportunity.mode,
        distance: opportunity.distanceMetres,
      });
      return {
        accepted: profiles.get(key),
        ranked: rankingProfiles.get(key),
      };
    });
    if (
      candidateProfiles.some(
        ({ accepted, ranked }) =>
          accepted === undefined || ranked === undefined,
      )
    ) {
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
      eligibleCandidates: candidateProfiles.map(({ accepted, ranked }) => ({
        coreId: accepted!.coreId,
        eligibilityStatus: "eligible",
        mode: opportunity.mode,
        distanceMeters: opportunity.distanceMetres,
        profile: ranked!,
        historicalStars: historicalStars(accepted!),
      })),
      opponents: opportunity.enteredOpponentCoreIds.map((coreId) => {
        const key = profileKey({
          coreId,
          mode: opportunity.mode,
          distance: opportunity.distanceMetres,
        });
        const accepted = profiles.get(key);
        const ranked = rankingProfiles.get(key);
        return {
          coreId,
          identityStatus:
            accepted === undefined || ranked === undefined
              ? "unresolved"
              : "confirmed",
          mode: opportunity.mode,
          distanceMeters: opportunity.distanceMetres,
          profile:
            accepted === undefined || ranked === undefined ? null : ranked,
        };
      }),
    });
  }
  return { status: "ready", fields };
}
