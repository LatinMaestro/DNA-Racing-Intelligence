import { describe, expect, it, vi } from "vitest";

import type { BreedingPairRankingInput } from "@/domain/breeding-pair-ranking";
import {
  loadBreedingWorkspacePageState,
  unavailableBreedingRankingRepository,
} from "@/lib/breeding-workspace-service";

const now = new Date("2026-07-28T00:00:00.000Z");
const versions = {
  rulesetVersion: "rules-v3",
  candidateSnapshotVersion: "candidates-v9",
  projectionVersion: "offspring-v4",
} as const;
const rankingInput: BreedingPairRankingInput = {
  rankingId: "synthetic-ranking",
  rankingLabel: "Synthetic Horse 1,600 m",
  ...versions,
  arenaSnapshotVersion: "arena-v5",
  evaluatedAt: "2026-07-28T00:00:00.000Z",
  dataCurrentThrough: "2026-07-25T00:00:00.000Z",
  lastImported: "2020-01-01T00:00:00.000Z",
  freshness: "stale",
  arenaDataCurrentThrough: "2026-07-25T00:00:00.000Z",
  arenaLastImported: "2020-01-01T00:00:00.000Z",
  arenaFreshness: "stale",
  eliteWeightBasisPoints: 6_000,
  vaultFitWeightBasisPoints: 4_000,
  candidates: [
    {
      pairId: "synthetic-pair",
      parents: [
        {
          coreId: "synthetic-parent-a",
          ownership: "owned",
          coreClass: "Genesis",
          element: "Metal",
          fNumber: 3,
        },
        {
          coreId: "synthetic-parent-b",
          ownership: "owned",
          coreClass: "Morphed",
          element: "Earth",
          fNumber: 8,
        },
      ],
      source: "owned_owned",
      mode: "Horse",
      exactDistanceM: 1_600,
      ...versions,
      arenaSnapshotVersion: null,
      ruleStatus: "eligible",
      familyStatus: "eligible",
      sexCompatibilityStatus: "compatible",
      cycleStatus: "available",
      spliceCapacityStatus: "available",
      availabilityStatus: "confirmed",
      arenaListingExpiresAt: null,
      evidenceConfidence: "moderate",
      distributionStatus: "supported",
      chronologicalValidationStatus: "supported",
      usesStarFeatures: false,
      starLiftStatus: "not_evaluated",
      exceptionalUpsideBasisPoints: 1_200,
      strongerOrExceptionalBasisPoints: 6_000,
      vaultFitBasisPoints: 7_000,
    },
  ],
};

function repository(
  rankings: readonly BreedingPairRankingInput[] = [rankingInput],
  latestAcceptedPerformanceImportAt: string | null = "2026-07-28T00:00:00.000Z",
  latestAcceptedArenaImportAt: string | null = "2026-07-28T00:00:00.000Z",
) {
  return {
    status: "ready" as const,
    loadRankingEvidenceByOwner: async () => ({
      rankings,
      latestAcceptedPerformanceImportAt,
      latestAcceptedArenaImportAt,
    }),
  };
}

describe("Breeding workspace service", () => {
  it("returns identity and persistence states without reading evidence", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableBreedingRankingRepository,
        now,
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
        now,
      }),
    ).resolves.toEqual({
      rankings: [],
      connectionStatus: "persistence_not_configured",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadRankingEvidenceByOwner = vi.fn(async () => ({
      rankings: [rankingInput],
      latestAcceptedPerformanceImportAt: "2026-07-28T00:00:00.000Z",
      latestAcceptedArenaImportAt: "2026-07-28T00:00:00.000Z",
    }));
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadRankingEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadRankingEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("derives performance and Arena freshness from accepted evidence", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      rankings: [
        {
          rankingId: "synthetic-ranking",
          freshness: "current",
          arenaFreshness: "current",
          lastImported: "2026-07-28T00:00:00.000Z",
          arenaLastImported: "2026-07-28T00:00:00.000Z",
          rankingsRemainSeparate: true,
          recommendationAllowed: false,
          breedingExecutionAllowed: false,
          gateEPassed: false,
        },
      ],
    });
  });

  it.each([
    [3, "current"],
    [4, "ageing"],
    [7, "ageing"],
    [8, "stale"],
  ] as const)(
    "derives the %s-day evidence boundary as %s",
    async (days, expected) => {
      const cutoff = new Date(now.getTime() - days * 86_400_000).toISOString();
      await expect(
        loadBreedingWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: repository([
            {
              ...rankingInput,
              dataCurrentThrough: cutoff,
              arenaDataCurrentThrough: cutoff,
            },
          ]),
          now,
        }),
      ).resolves.toMatchObject({
        rankings: [{ freshness: expected, arenaFreshness: expected }],
      });
    },
  );

  it("defers evidence when no accepted imports exist", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository([rankingInput], null, null),
        now,
      }),
    ).resolves.toMatchObject({
      rankings: [
        {
          freshness: "unknown",
          arenaFreshness: "unknown",
          eliteUpsideRanking: [],
          heldPairs: [{ pairId: "synthetic-pair" }],
        },
      ],
    });
  });

  it("rejects duplicate ranking IDs and labels", async () => {
    for (const rankings of [
      [rankingInput, rankingInput],
      [
        rankingInput,
        {
          ...rankingInput,
          rankingId: "second",
          rankingLabel: rankingInput.rankingLabel,
        },
      ],
    ]) {
      await expect(
        loadBreedingWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: repository(rankings),
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects future, post-import and non-canonical evidence", async () => {
    const cases = [
      repository([rankingInput], "2026-07-29T00:00:00.000Z"),
      repository([
        { ...rankingInput, evaluatedAt: "2026-07-29T00:00:00.000Z" },
      ]),
      repository(
        [{ ...rankingInput, dataCurrentThrough: "2026-07-27T00:00:00.000Z" }],
        "2026-07-26T00:00:00.000Z",
      ),
      repository([
        { ...rankingInput, arenaDataCurrentThrough: "2026-07-25T00:00:00Z" },
      ]),
    ];
    for (const item of cases) {
      await expect(
        loadBreedingWorkspacePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          repository: item,
          now,
        }),
      ).rejects.toThrow();
    }
  });

  it("rejects malformed repositories, payloads and server time", async () => {
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unsupported" } as never,
        now,
      }),
    ).rejects.toThrow("repository status");
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadRankingEvidenceByOwner: async () => null as never,
        },
        now,
      }),
    ).rejects.toThrow("evidence is invalid");
    await expect(
      loadBreedingWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: repository(),
        now: new Date("invalid"),
      }),
    ).rejects.toThrow("now must be valid");
  });
});
