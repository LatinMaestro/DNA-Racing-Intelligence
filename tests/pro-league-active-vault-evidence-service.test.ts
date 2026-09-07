import { describe, expect, it, vi } from "vitest";

import type { ProLeagueExactFormatEvidence } from "@/domain/pro-league-matchup";
import type {
  ActiveProLeagueEvidenceGeneration,
  ActiveProLeagueEvidenceRow,
  NeonProLeagueEvidenceGenerationRepository,
} from "@/lib/neon-pro-league-evidence-generation-repository";
import { loadActiveProLeagueVaultEvidence } from "@/lib/pro-league-active-vault-evidence-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

const ownerId = "private_owner";

const generation: ActiveProLeagueEvidenceGeneration = {
  generationId: "84000000-0000-4000-8000-000000000301",
  raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
  sourceVersionSetSha256: "a".repeat(64),
  evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
  inputObservationCount: 100,
  acceptedEntryCount: 80,
  nonBikeEntryCount: 10,
  missingFormatEntryCount: 5,
  unsupportedFormatEntryCount: 3,
  unpublishedCellEntryCount: 2,
  unbenchmarkedEntryCount: 0,
  benchmarkCount: 1,
  profileCount: 2,
  payloadSha256: "b".repeat(64),
  publishedAt: "2026-09-07T01:01:00.000Z",
};

function evidence(sourceCoreId: string): Readonly<Record<string, unknown>> {
  const distanceMetres = 1_000;
  const value: ProLeagueExactFormatEvidence = {
    raceType: "1v1",
    distanceMetres,
    raceCount: 12,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-09-07T00:00:00.000Z",
    benchmarkAssessment: "winning_range",
    elapsedTime: {
      bestMilliseconds: 45_000,
      medianMilliseconds: 49_000,
      trimmedMeanMilliseconds: 51_000,
      standardDeviationMilliseconds: 600,
      interquartileRangeMilliseconds: 800,
    },
    speed: {
      bestMetresPerSecond: 22.222,
      medianMetresPerSecond: 20.408,
    },
    populationBenchmark: {
      dataCurrentThrough: "2026-09-07T00:00:00.000Z",
      raceEntryCount: 1_000,
      coreCount: 300,
      winningEntryCount: 100,
      topThreeEntryCount: 300,
      winningP25Milliseconds: 48_000,
      winningMedianMilliseconds: 50_000,
      winningP75Milliseconds: 52_000,
      winningStandardDeviationMilliseconds: 1_200,
      winningInterquartileRangeMilliseconds: 4_000,
      topThreeP25Milliseconds: 53_000,
      topThreeMedianMilliseconds: 55_000,
      topThreeP75Milliseconds: 57_000,
      topThreeStandardDeviationMilliseconds: 1_400,
      topThreeInterquartileRangeMilliseconds: 4_000,
    },
    supportingEvidence: {
      outcomes: { status: "available", winCount: 2, topThreeCount: 5 },
      goldStar: {
        status: "unavailable",
        assignedCount: 0,
        eligibleRaceCount: 0,
      },
      blueStar: {
        status: "unavailable",
        assignedCount: 0,
        opportunityCount: 0,
      },
      oppositionAdjustedStars: {
        status: "unavailable",
        qualityKnownRaceCount: 0,
        strongFieldYellowReceivedCount: 0,
        strongFieldBlueReceivedCount: 0,
        eliteOpponentYellowReceivedCount: 0,
        eliteOpponentBlueReceivedCount: 0,
        yellowFieldAdjustedIndex: null,
        blueFieldAdjustedIndex: null,
        rawConversionUsedForRanking: false,
      },
      strongOpposition: {
        status: "unavailable",
        raceCount: 0,
        winCount: 0,
        topThreeCount: 0,
      },
    },
  };
  return { sourceCoreId, ...value } as unknown as Readonly<
    Record<string, unknown>
  >;
}

function row(
  ordinal: number,
  sourceCoreId: string,
): ActiveProLeagueEvidenceRow {
  return {
    generationId: generation.generationId,
    family: "profile",
    ordinal,
    naturalKey: JSON.stringify([sourceCoreId, "1v1", 1_000]),
    rowSha256: `${ordinal}`.repeat(64).slice(0, 64),
    payload: evidence(sourceCoreId),
  };
}

function vault(): OwnerVaultCatalogueRepository {
  return {
    status: "ready",
    listCoresByOwner: vi.fn(async () => [
      {
        sourceCoreId: "owned-1",
        displayName: "Owned One",
        coreClass: "Morphed" as const,
        element: "Water" as const,
        fNumber: 18,
        sex: "female" as const,
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
      {
        sourceCoreId: "owned-without-evidence",
        displayName: "Owned Without Evidence",
        coreClass: "Freak" as const,
        element: "Fire" as const,
        fNumber: 11,
        sex: "male" as const,
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: "2026-09-07T00:00:00.000Z",
      },
    ]),
  };
}

function repository(
  overrides: Partial<NeonProLeagueEvidenceGenerationRepository> = {},
): NeonProLeagueEvidenceGenerationRepository {
  const rows = [row(0, "owned-1"), row(1, "population-1")];
  return {
    begin: vi.fn(),
    stageRows: vi.fn(),
    publish: vi.fn(),
    readActiveGeneration: vi.fn(async () => generation),
    listActiveRows: vi.fn(async (_ownerId, _family, afterOrdinal, limit) =>
      rows.slice(afterOrdinal + 1, afterOrdinal + 1 + limit),
    ),
    ...overrides,
  } as NeonProLeagueEvidenceGenerationRepository;
}

describe("active Pro League Vault evidence service", () => {
  it("streams an exact active generation and retains only owned profiles", async () => {
    const vaultRepository = vault();
    const evidenceRepository = repository();
    const result = await loadActiveProLeagueVaultEvidence({
      ownerId,
      vaultId: "my-vault",
      vaultDisplayName: "My Vault",
      rosteredCoreIds: ["owned-1"],
      vaultRepository,
      evidenceRepository,
      pageSize: 1,
    });

    expect(result).toMatchObject({
      generation: { generationId: generation.generationId },
      populationProfileCount: 2,
      ownedProfileCount: 1,
      unownedProfileCount: 1,
      ownedCoreWithoutEvidenceCount: 1,
      vault: {
        vaultId: "my-vault",
        cores: [
          { coreId: "owned-1", rosterStatus: "rostered" },
          {
            coreId: "owned-without-evidence",
            rosterStatus: "not_rostered",
            exactFormatEvidence: [],
          },
        ],
      },
    });
    expect(result?.vault.cores[0]?.exactFormatEvidence[0]).toMatchObject({
      raceType: "1v1",
      distanceMetres: 1_000,
      benchmarkAssessment: "winning_range",
    });
    expect(evidenceRepository.listActiveRows).toHaveBeenLastCalledWith(
      ownerId,
      "profile",
      1,
      1,
    );
  });

  it("returns no candidate pool until a complete generation is active", async () => {
    await expect(
      loadActiveProLeagueVaultEvidence({
        ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        vaultRepository: vault(),
        evidenceRepository: repository({
          readActiveGeneration: vi.fn(async () => null),
        }),
      }),
    ).resolves.toBeNull();
  });

  it("fails closed when the active pointer changes during the paged read", async () => {
    const changed = {
      ...generation,
      generationId: "84000000-0000-4000-8000-000000000302",
    };
    await expect(
      loadActiveProLeagueVaultEvidence({
        ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        vaultRepository: vault(),
        evidenceRepository: repository({
          readActiveGeneration: vi
            .fn()
            .mockResolvedValueOnce(generation)
            .mockResolvedValueOnce(changed),
        }),
        pageSize: 1,
      }),
    ).rejects.toThrow("pointer changed");
  });

  it("fails closed on short or naturally inconsistent profile coverage", async () => {
    await expect(
      loadActiveProLeagueVaultEvidence({
        ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        vaultRepository: vault(),
        evidenceRepository: repository({
          listActiveRows: vi.fn(async () => []),
        }),
      }),
    ).rejects.toThrow("ended early");

    const invalid = row(0, "owned-1");
    await expect(
      loadActiveProLeagueVaultEvidence({
        ownerId,
        vaultId: "my-vault",
        vaultDisplayName: "My Vault",
        rosteredCoreIds: [],
        vaultRepository: vault(),
        evidenceRepository: repository({
          listActiveRows: vi.fn(async (_owner, _family, after) =>
            after < 0
              ? [{ ...invalid, naturalKey: "wrong" }, row(1, "population-1")]
              : [],
          ),
        }),
      }),
    ).rejects.toThrow("natural key drifted");
  });
});
