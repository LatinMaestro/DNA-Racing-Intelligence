import { describe, expect, it, vi } from "vitest";

import { createDnaOpenLabSyncRatePolicy } from "@/domain/dna-open-lab-sync-rate-policy";
import { createInitialDnaLastGoodSyncState } from "@/lib/dna-open-lab-last-good-publication";
import type { ProLeagueExactFormatEvidence } from "@/domain/pro-league-matchup";
import type {
  ActiveProLeagueEvidenceGeneration,
  ActiveProLeagueEvidenceRow,
} from "@/lib/neon-pro-league-evidence-generation-repository";
import type { ProLeagueEvidenceReadRepository } from "@/lib/pro-league-active-vault-evidence-service";
import { loadProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

const ownerId = "private_owner";
const generation: ActiveProLeagueEvidenceGeneration = {
  generationId: "84000000-0000-4000-8000-000000000401",
  raceDatasetVersionId: "84000000-0000-4000-8000-000000000201",
  sourceVersionSetSha256: "a".repeat(64),
  evidenceCutoffAt: "2026-09-07T01:00:00.000Z",
  inputObservationCount: 120,
  acceptedEntryCount: 120,
  nonBikeEntryCount: 0,
  missingFormatEntryCount: 0,
  unsupportedFormatEntryCount: 0,
  unpublishedCellEntryCount: 0,
  unbenchmarkedEntryCount: 0,
  benchmarkCount: 1,
  profileCount: 12,
  payloadSha256: "b".repeat(64),
  publishedAt: "2026-09-07T01:01:00.000Z",
};

function evidence(sourceCoreId: string): Readonly<Record<string, unknown>> {
  const value: ProLeagueExactFormatEvidence = {
    raceType: "1v1",
    distanceMetres: 1_000,
    raceCount: 12,
    sampleStatus: "minimally_analytical",
    freshness: "current",
    dataCurrentThrough: "2026-09-07T00:00:00.000Z",
    benchmarkAssessment: "winning_range",
    elapsedTime: {
      bestMilliseconds: 45_000,
      medianMilliseconds: 49_000,
      trimmedMeanMilliseconds: 49_500,
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

function rows(): ActiveProLeagueEvidenceRow[] {
  return Array.from({ length: 12 }, (_, ordinal) => {
    const sourceCoreId = `core-${String(ordinal).padStart(2, "0")}`;
    return {
      generationId: generation.generationId,
      family: "profile" as const,
      ordinal,
      naturalKey: JSON.stringify([sourceCoreId, "1v1", 1_000]),
      rowSha256: "c".repeat(64),
      payload: evidence(sourceCoreId),
    };
  });
}

function vault(
  sex: "female" | "male" = "female",
): OwnerVaultCatalogueRepository {
  return {
    status: "ready",
    listCoresByOwner: vi.fn(async () =>
      Array.from({ length: 12 }, (_, index) => ({
        sourceCoreId: `core-${String(index).padStart(2, "0")}`,
        displayName: `Core ${index}`,
        coreClass: "Morphed" as const,
        element: "Water" as const,
        fNumber: 16,
        sex,
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: "2026-09-07T00:00:00.000Z",
      })),
    ),
  };
}

function repository(
  overrides: Partial<ProLeagueEvidenceReadRepository> = {},
): ProLeagueEvidenceReadRepository {
  const values = rows();
  return {
    readActiveGeneration: vi.fn(async () => generation),
    listActiveRows: vi.fn(async (_ownerId, _family, afterOrdinal, limit) =>
      values.slice(afterOrdinal + 1, afterOrdinal + 1 + limit),
    ),
    ...overrides,
  };
}

function input(
  overrides: Partial<
    Parameters<typeof loadProLeagueDraftCommissioningState>[0]
  > = {},
): Parameters<typeof loadProLeagueDraftCommissioningState>[0] {
  const syncPolicy = createDnaOpenLabSyncRatePolicy({
    requestedRequestsPerMinute: 30,
    now: "2026-09-08T00:00:00.000Z",
    version: 1,
  });
  return {
    authenticatedOwnerId: ownerId,
    configuredOwnerId: ownerId,
    vaultId: "my-vault",
    vaultDisplayName: "My Vault",
    rosteredCoreIds: [],
    vaultRepository: vault(),
    evidenceRepository: repository(),
    syncRatePolicyRepository: {
      status: "ready",
      read: vi.fn(async () => syncPolicy),
      set: vi.fn(async () => syncPolicy),
      recordObservation: vi.fn(async () => syncPolicy),
    },
    syncHealthRepository: {
      readServingSyncHealth: vi.fn(async () => ({
        state: createInitialDnaLastGoodSyncState(),
        evidenceIndex: null,
      })),
    },
    now: new Date("2026-09-08T00:00:00.000Z"),
    pageSize: 5,
    ...overrides,
  };
}

describe("Pro League draft commissioning service", () => {
  it("does not touch persistence before private identity is connected", async () => {
    const evidenceRepository = repository();
    const vaultRepository = vault();
    const result = await loadProLeagueDraftCommissioningState(
      input({
        authenticatedOwnerId: null,
        vaultRepository,
        evidenceRepository,
      }),
    );

    expect(result).toEqual({
      connectionStatus: "identity_not_connected",
      evidence: null,
      roster: null,
      lineup: null,
    });
    expect(evidenceRepository.readActiveGeneration).not.toHaveBeenCalled();
    if (vaultRepository.status === "ready") {
      expect(vaultRepository.listCoresByOwner).not.toHaveBeenCalled();
    }
  });

  it("denies a different authenticated owner", async () => {
    await expect(
      loadProLeagueDraftCommissioningState(
        input({ authenticatedOwnerId: "different_owner" }),
      ),
    ).rejects.toThrow("access denied");
  });

  it("reports unavailable persistence without reading either repository", async () => {
    const evidenceRepository = repository();
    const result = await loadProLeagueDraftCommissioningState(
      input({
        vaultRepository: { status: "not_configured" },
        evidenceRepository,
      }),
    );
    expect(result.connectionStatus).toBe("persistence_not_configured");
    expect(evidenceRepository.readActiveGeneration).not.toHaveBeenCalled();
  });

  it("keeps staging and absent generations invisible", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({
        evidenceRepository: repository({
          readActiveGeneration: vi.fn(async () => null),
        }),
      }),
    );
    expect(result.connectionStatus).toBe("active_generation_unavailable");
    expect(result.evidence).toBeNull();
  });

  it("returns one active generation with a compliant roster and all 168 lines", async () => {
    const result = await loadProLeagueDraftCommissioningState(input());

    expect(result).toMatchObject({
      connectionStatus: "read_model_connected",
      evidence: {
        generationId: generation.generationId,
        freshness: "current",
        populationProfileCount: 12,
        ownedProfileCount: 12,
        unownedProfileCount: 0,
        ownedCoreWithoutEvidenceCount: 0,
      },
      roster: {
        generationId: generation.generationId,
        search: { status: "constructed", targetSize: 12 },
      },
      lineup: {
        generationId: generation.generationId,
        totals: { lineCount: 168, first16LineCount: 64 },
      },
      mapPreparation: {
        authority: "verified_owned_exact_format_lineup_only",
        generationId: generation.generationId,
        homePreferenceOrder: expect.arrayContaining([
          "map-1",
          "map-2",
          "map-3",
          "map-4",
        ]),
        opponentDenialStatus: "held_without_opponent_exact_format_evidence",
        headToHeadStatus: "unavailable",
        matchActionAllowed: false,
      },
      discoveryQueue: {
        authority: "active_verified_exact_format_generation",
        exactDistanceMinimumRaceCount: 10,
        automaticRaceEntryAllowed: false,
        automaticRosterMutationAllowed: false,
      },
      breedingObjectives: {
        status: "persistence_not_configured",
        decisionSupportOnly: true,
        recommendationAllowed: false,
        automaticPairValidationAllowed: false,
        spliceExecutionAllowed: false,
      },
      syncRatePolicy: {
        connectionStatus: "connected",
        policy: { effectiveRequestsPerMinute: 30 },
      },
      syncHealth: {
        connectionStatus: "connected",
        syncStatus: "never_synced",
        lastGood: null,
        readOnly: true,
        refreshTriggered: false,
      },
      readiness: {
        status: "blocked",
        ownerAcceptanceRequired: true,
        protectedPreviewDeploymentAllowed: false,
        productionActivationAllowed: false,
        rosterOrMapSubmissionAllowed: false,
      },
    });
    expect(result.readiness?.checks).toContainEqual(
      expect.objectContaining({ code: "CURRENT_CORE_STATE", status: "block" }),
    );
    expect(result.roster?.draftRoster?.audit.readiness).toBe("compliant");
    expect(result.lineup?.maps).toHaveLength(4);
    expect(result.lineup?.maps.every(({ lines }) => lines.length === 42)).toBe(
      true,
    );
  });

  it("retains the historical draft when current API dimensions are invalid", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({
        currentStateRepository: {
          readServingSupplementalCores: vi.fn(async () => {
            throw new Error("current generation unavailable");
          }),
        },
      }),
    );

    expect(result.connectionStatus).toBe("read_model_connected");
    expect(result.currentState).toMatchObject({
      status: "invalid_generation",
      cores: [],
    });
    expect(result.roster?.draftRoster?.audit.readiness).toBe("compliant");
    expect(result.lineup?.totals.lineCount).toBe(168);
  });

  it("retains the historical draft when sync health authority is invalid", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({
        syncHealthRepository: {
          readServingSyncHealth: vi.fn(async () => {
            throw new Error("sync state unavailable");
          }),
        },
      }),
    );

    expect(result.connectionStatus).toBe("read_model_connected");
    expect(result.syncHealth).toMatchObject({
      connectionStatus: "invalid_state",
      lastGood: null,
      readOnly: true,
      refreshTriggered: false,
    });
    expect(result.roster?.draftRoster?.audit.readiness).toBe("compliant");
    expect(result.lineup?.totals.lineCount).toBe(168);
  });

  it("retains the historical draft when current race opportunities are invalid", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({
        currentRaceRepository: {
          readServingCurrentRaces: vi.fn(async () => {
            throw new Error("current race generation unavailable");
          }),
        },
      }),
    );

    expect(result.connectionStatus).toBe("read_model_connected");
    expect(result.raceOpportunities).toMatchObject({
      status: "invalid_generation",
      opportunities: [],
      raceEntryAllowed: false,
    });
    expect(result.roster?.draftRoster?.audit.readiness).toBe("compliant");
    expect(result.lineup?.totals.lineCount).toBe(168);
  });

  it("retains the historical draft when breeding evidence is invalid", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({
        breedingRepository: {
          status: "ready",
          loadRankingEvidenceByOwner: vi.fn(async () => {
            throw new Error("breeding generation unavailable");
          }),
        },
        now: new Date("2026-09-08T00:00:00.000Z"),
      }),
    );

    expect(result.connectionStatus).toBe("read_model_connected");
    expect(result.breedingObjectives).toMatchObject({
      status: "invalid_evidence",
      objectives: [],
      recommendationAllowed: false,
      spliceExecutionAllowed: false,
    });
    expect(result.roster?.draftRoster?.audit.readiness).toBe("compliant");
    expect(result.lineup?.totals.lineCount).toBe(168);
  });

  it("exposes evidence and diagnostics but no lineup when no roster is valid", async () => {
    const result = await loadProLeagueDraftCommissioningState(
      input({ vaultRepository: vault("male") }),
    );
    expect(result.connectionStatus).toBe("draft_unavailable");
    expect(result.evidence?.generationId).toBe(generation.generationId);
    expect(result.roster?.draftRoster).toBeNull();
    expect(result.lineup).toBeNull();
  });

  it("fails closed when the active pointer changes during assembly", async () => {
    const changed = {
      ...generation,
      generationId: "84000000-0000-4000-8000-000000000402",
    };
    await expect(
      loadProLeagueDraftCommissioningState(
        input({
          evidenceRepository: repository({
            readActiveGeneration: vi
              .fn()
              .mockResolvedValueOnce(generation)
              .mockResolvedValueOnce(changed),
          }),
        }),
      ),
    ).rejects.toThrow("pointer changed");
  });
});
