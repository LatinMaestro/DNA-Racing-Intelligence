import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import type { ProLeagueDraftRosterRecommendation } from "@/domain/pro-league-roster-recommendation";
import {
  loadProLeagueBreedingObjectiveState,
  unavailableProLeagueBreedingObjectiveState,
} from "@/lib/pro-league-breeding-objective-service";

const ownerId = "private_owner";

function roster(): ProLeagueDraftRosterRecommendation {
  return {
    authority: "active_verified_exact_format_generation",
    evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
    coverageGaps: [
      {
        raceType: "6 gate madness",
        distanceMetres: 1_200,
        mapIds: ["map-1"],
        raceLineCount: 5,
        maximumGateEntriesPerVault: 3,
        status: "unproven",
        bestAvailableCoreIds: [],
        bestAvailableRostered: false,
        discoveryPriority: "high",
        rosterAdvice: "test_before_roster_lock",
        guidance: "Research the gap.",
      },
    ],
  } as unknown as ProLeagueDraftRosterRecommendation;
}

function ranking(
  dataCurrentThrough = "2026-09-07T00:00:00.000Z",
): BreedingPairRankingInput {
  return {
    rankingId: "private-ranking-id",
    rankingLabel: "Bike 1,200 m",
    rulesetVersion: "rules-v1",
    candidateSnapshotVersion: "candidates-v1",
    projectionVersion: "projection-v1",
    arenaSnapshotVersion: null,
    evaluatedAt: "2026-09-07T02:00:00.000Z",
    dataCurrentThrough,
    lastImported: "2026-09-07T02:00:00.000Z",
    freshness: "current",
    arenaDataCurrentThrough: null,
    arenaLastImported: null,
    arenaFreshness: "unknown",
    eliteWeightBasisPoints: 6_000,
    vaultFitWeightBasisPoints: 4_000,
    candidates: [
      {
        pairId: "private-pair-id",
        parents: [
          {
            coreId: "private-parent-a",
            ownership: "owned",
            coreClass: "Genesis",
            element: "Metal",
            fNumber: 3,
          },
          {
            coreId: "private-parent-b",
            ownership: "owned",
            coreClass: "Morphed",
            element: "Earth",
            fNumber: 8,
          },
        ],
        source: "owned_owned",
        mode: "Bike",
        exactDistanceM: 1_200,
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
        exceptionalUpsideBasisPoints: 2_000,
        strongerOrExceptionalBasisPoints: 6_000,
        vaultFitBasisPoints: 8_000,
      },
    ],
  };
}

function repository(dataCurrentThrough?: string) {
  const loadRankingEvidenceByOwner = vi.fn(async () => ({
    rankings: [ranking(dataCurrentThrough)],
    latestAcceptedPerformanceImportAt: "2026-09-07T02:00:00.000Z",
    latestAcceptedArenaImportAt: null,
  }));
  return {
    value: { status: "ready" as const, loadRankingEvidenceByOwner },
    loadRankingEvidenceByOwner,
  };
}

describe("Pro League breeding objective service", () => {
  it("loads owner-scoped evidence and strips ranking, pair and parent identifiers", async () => {
    const source = repository();
    const result = await loadProLeagueBreedingObjectiveState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      roster: roster(),
      repository: source.value,
      now: new Date("2026-09-08T00:00:00.000Z"),
    });

    expect(source.loadRankingEvidenceByOwner).toHaveBeenCalledWith(ownerId);
    expect(result).toMatchObject({
      status: "connected",
      evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
      performanceDataCurrentThrough: "2026-09-07T00:00:00.000Z",
      objectives: [
        {
          raceType: "6 gate madness",
          distanceMetres: 1_200,
          status: "research_candidates",
          candidates: [
            {
              candidateNumber: 1,
              predictedOffspringClass: "Freak",
              predictedOffspringElement: "Earth",
              predictedOffspringFNumber: 11,
              recommendationAllowed: false,
              spliceExecutionAllowed: false,
            },
          ],
        },
      ],
      decisionSupportOnly: true,
      automaticPairValidationAllowed: false,
      spliceExecutionAllowed: false,
    });
    expect(JSON.stringify(result)).not.toContain("private-ranking-id");
    expect(JSON.stringify(result)).not.toContain("private-pair-id");
    expect(JSON.stringify(result)).not.toContain("private-parent");
  });

  it("rejects performance evidence after the active roster cutoff", async () => {
    const source = repository("2026-09-07T01:30:00.000Z");
    await expect(
      loadProLeagueBreedingObjectiveState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        roster: roster(),
        repository: source.value,
        now: new Date("2026-09-08T00:00:00.000Z"),
      }),
    ).rejects.toThrow("exceeds the active generation cutoff");
  });

  it("keeps absent persistence explicit and non-actionable", async () => {
    await expect(
      loadProLeagueBreedingObjectiveState({
        authenticatedOwnerId: ownerId,
        configuredOwnerId: ownerId,
        roster: roster(),
        repository: { status: "not_configured" },
        now: new Date("2026-09-08T00:00:00.000Z"),
      }),
    ).resolves.toEqual(
      unavailableProLeagueBreedingObjectiveState(
        "persistence_not_configured",
        "2026-09-07T01:00:00.000Z",
        1,
      ),
    );
  });
});
