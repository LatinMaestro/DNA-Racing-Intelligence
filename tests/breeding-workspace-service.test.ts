import { describe, expect, it, vi } from "vitest";
import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import {
  loadBreedingWorkspacePageState,
  unavailableBreedingRankingRepository,
} from "@/lib/breeding-workspace-service";

const rankingInput: BreedingPairRankingInput = {
  rankingId: "synthetic-ranking",
  evaluatedAt: "2026-07-20T02:00:00.000Z",
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  lastImported: "2026-07-20T01:00:00.000Z",
  freshness: "current",
  eliteWeightBasisPoints: 6_000,
  vaultFitWeightBasisPoints: 4_000,
  candidates: [
    {
      pairId: "synthetic-pair",
      parentCoreIds: ["synthetic-parent-a", "synthetic-parent-b"],
      source: "owned_owned",
      mode: "Horse",
      exactDistanceM: 1_600,
      ruleStatus: "eligible",
      availabilityStatus: "confirmed",
      evidenceConfidence: "moderate",
      distributionStatus: "supported",
      usesStarFeatures: false,
      starLiftStatus: "not_evaluated",
      exceptionalUpsideBasisPoints: 1_200,
      strongerOrExceptionalBasisPoints: 6_000,
      vaultFitBasisPoints: 7_000,
    },
  ],
};

describe("Breeding workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableBreedingRankingRepository,
      }),
    ).resolves.toEqual({
      rankings: [],
      connectionStatus: "identity_not_connected",
    });
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableBreedingRankingRepository,
      }),
    ).resolves.toEqual({
      rankings: [],
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const listRankingInputsByOwner = vi.fn(async () => [rankingInput]);
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", listRankingInputsByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(listRankingInputsByOwner).not.toHaveBeenCalled();
  });

  it("builds separate non-actionable rankings from compact evidence", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          listRankingInputsByOwner: async (ownerId) => {
            expect(ownerId).toBe("owner");
            return [rankingInput];
          },
        },
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      rankings: [
        {
          rankingId: "synthetic-ranking",
          rankingsRemainSeparate: true,
          recommendationAllowed: false,
          breedingExecutionAllowed: false,
          gateEPassed: false,
        },
      ],
    });
  });

  it("rejects duplicate rankings and invalid pair evidence", async () => {
    for (const inputs of [
      [rankingInput, rankingInput],
      [
        {
          ...rankingInput,
          candidates: [
            {
              ...rankingInput.candidates[0]!,
              exactDistanceM: 0,
            },
          ],
        },
      ],
    ]) {
      await expect(
        loadBreedingWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: {
            status: "ready",
            listRankingInputsByOwner: async () => inputs,
          },
        }),
      ).rejects.toThrow();
    }
  });
});
