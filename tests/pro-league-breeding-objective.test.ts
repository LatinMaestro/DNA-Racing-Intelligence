import { describe, expect, it } from "vitest";

import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingRankingCandidateInput,
} from "@/domain/breeding-pair-ranking";
import { buildProLeagueBreedingObjectiveQueue } from "@/domain/pro-league-breeding-objective";
import type { ProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";

function candidate(
  pairId: string,
  mode: "Bike" | "Car" | "Horse",
  distance: number,
  overrides: Partial<BreedingRankingCandidateInput> = {},
): BreedingRankingCandidateInput {
  return {
    pairId,
    parents: [
      {
        coreId: `${pairId}-a`,
        ownership: "owned",
        coreClass: "Genesis",
        element: "Metal",
        fNumber: 3,
      },
      {
        coreId: `${pairId}-b`,
        ownership: "owned",
        coreClass: "Morphed",
        element: "Earth",
        fNumber: 8,
      },
    ],
    source: "owned_owned",
    mode,
    exactDistanceM: distance,
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    ruleStatus: "eligible",
    familyStatus: "eligible",
    sexCompatibilityStatus: "compatible",
    cycleStatus: "available",
    spliceCapacityStatus: "available",
    availabilityStatus: "confirmed",
    arenaListingExpiresAt: null,
    evidenceConfidence: "high",
    distributionStatus: "supported",
    chronologicalValidationStatus: "supported",
    usesStarFeatures: false,
    starLiftStatus: "not_evaluated",
    exceptionalUpsideBasisPoints: 1_000,
    strongerOrExceptionalBasisPoints: 6_000,
    vaultFitBasisPoints: 6_000,
    ...overrides,
  };
}

function ranking(
  candidates: readonly BreedingRankingCandidateInput[],
  overrides: Partial<BreedingPairRankingInput> = {},
) {
  return rankBreedingPairs({
    rankingId: "bike-ranking",
    rankingLabel: "Bike research",
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    evaluatedAt: "2026-09-07T02:00:00.000Z",
    dataCurrentThrough: "2026-09-07T01:00:00.000Z",
    lastImported: "2026-09-07T01:30:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: null,
    arenaLastImported: null,
    arenaFreshness: "unknown",
    eliteWeightBasisPoints: 6_000,
    vaultFitWeightBasisPoints: 4_000,
    candidates,
    ...overrides,
  });
}

function roster(): ProLeagueDraftRosterRecommendation {
  return {
    authority: "active_verified_exact_format_generation",
    evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
    coverageGaps: [
      {
        raceType: "1v1",
        distanceMetres: 1_000,
        mapIds: ["map-1"],
        raceLineCount: 4,
        maximumGateEntriesPerVault: 1,
        status: "unproven",
        bestAvailableCoreIds: [],
        bestAvailableRostered: false,
        discoveryPriority: "high",
        rosterAdvice: "test_before_roster_lock",
        guidance: "Research before lock.",
      },
    ],
  } as unknown as ProLeagueDraftRosterRecommendation;
}

describe("Pro League breeding objectives", () => {
  it("maps verified gaps to exact Bike-distance research without claiming race-type evidence", () => {
    const elite = candidate("elite", "Bike", 1_000, {
      exceptionalUpsideBasisPoints: 9_000,
      strongerOrExceptionalBasisPoints: 9_500,
      vaultFitBasisPoints: 1_000,
    });
    const gap = candidate("gap", "Bike", 1_000, {
      exceptionalUpsideBasisPoints: 1_000,
      vaultFitBasisPoints: 9_000,
    });
    const result = buildProLeagueBreedingObjectiveQueue(roster(), [
      ranking([
        elite,
        gap,
        candidate("wrong-distance", "Bike", 1_200),
        candidate("wrong-mode", "Car", 1_000),
      ]),
    ]);

    expect(result.objectives[0]).toMatchObject({
      objectiveId: "1v1:1000",
      status: "research_candidates",
      gapPriority: "high",
    });
    expect(
      result.objectives[0]?.candidates.map(({ pairId }) => pairId),
    ).toEqual(["gap", "elite"]);
    expect(result.objectives[0]?.candidates[0]).toMatchObject({
      performanceEvidenceScope: "bike_exact_distance_only",
      proLeagueRaceTypeEvidence: "unavailable",
      officialPairValidation: "required_at_decision_time",
      recommendationAllowed: false,
      spliceExecutionAllowed: false,
    });
    expect(result.objectives[0]?.warnings).toContain(
      "RACE_TYPE_PAIR_EVIDENCE_UNAVAILABLE",
    );
    expect(result.diagnostics.nonBikePairRowCount).toBe(2);
  });

  it("preserves elite-upside research alongside Vault-gap fit", () => {
    const result = buildProLeagueBreedingObjectiveQueue(roster(), [
      ranking([
        candidate("rare", "Bike", 1_000, {
          exceptionalUpsideBasisPoints: 10_000,
          strongerOrExceptionalBasisPoints: 10_000,
          vaultFitBasisPoints: 0,
        }),
        candidate("fit", "Bike", 1_000, {
          exceptionalUpsideBasisPoints: 0,
          vaultFitBasisPoints: 10_000,
        }),
      ]),
    ]);

    expect(
      result.objectives[0]?.candidates.map(({ pairId, researchRoles }) => ({
        pairId,
        researchRoles,
      })),
    ).toEqual([
      { pairId: "rare", researchRoles: ["elite_upside", "vault_gap"] },
      { pairId: "fit", researchRoles: ["elite_upside", "vault_gap"] },
    ]);
  });

  it("waits rather than borrowing stale, cross-mode, or adjacent-distance evidence", () => {
    const result = buildProLeagueBreedingObjectiveQueue(roster(), [
      ranking([candidate("adjacent", "Bike", 1_200)]),
      ranking([candidate("stale", "Bike", 1_000)], {
        rankingId: "stale-ranking",
        freshness: "stale",
      }),
    ]);

    expect(result.objectives[0]).toMatchObject({
      status: "wait_no_exact_distance_pair_evidence",
      candidates: [],
    });
    expect(result.objectives[0]?.warnings).toContain(
      "NO_CURRENT_EXACT_DISTANCE_PAIR_EVIDENCE",
    );
    expect(result.diagnostics.staleOrUnknownRankingCount).toBe(1);
  });

  it("fails closed if a caller claims Gate E or execution authority", () => {
    const unsafe = {
      ...ranking([candidate("pair", "Bike", 1_000)]),
      gateEPassed: true,
    } as unknown as ReturnType<typeof rankBreedingPairs>;

    expect(() =>
      buildProLeagueBreedingObjectiveQueue(roster(), [unsafe]),
    ).toThrow("held Gate E evidence");
  });

  it("rejects an unexpectedly broad ranking read", () => {
    const evidence = ranking([candidate("pair", "Bike", 1_000)]);

    expect(() =>
      buildProLeagueBreedingObjectiveQueue(
        roster(),
        Array.from({ length: 201 }, () => evidence),
      ),
    ).toThrow("ranking bound was exceeded");
  });
});
