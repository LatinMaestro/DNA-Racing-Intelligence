import { describe, expect, it, vi } from "vitest";

import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";
import {
  createProLeaguePreparationRepository,
  loadProLeaguePreparationPageState,
  unavailableProLeaguePreparationRepository,
} from "@/lib/pro-league-preparation-service";

const ownerId = "user_owner";

function repositories() {
  const vault: OwnerVaultCatalogueRepository = {
    status: "ready",
    listCoresByOwner: vi.fn(async () => [
      {
        sourceCoreId: "water-1",
        displayName: "Water One",
        coreClass: "Morphed",
        element: "Water",
        fNumber: 18,
        sex: "female",
        inMyVault: true,
        meEligible: false,
        version: 1,
        updatedAt: "2026-08-19T00:00:00.000Z",
      },
    ]),
  };
  const performance: CorePerformanceProfileRepository = {
    status: "ready",
    listProfilesByOwner: vi.fn(async () => ({
      lastImportedAt: "2026-08-20T00:00:00.000Z",
      profiles: [
        {
          coreId: "water-1",
          mode: "bike",
          distance: 1_400,
          dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          freshness: "current",
          raceCount: 10,
          sampleStatus: "minimally_analytical",
          elapsedTime: {
            bestMilliseconds: 10_000,
            medianMilliseconds: 10_500,
            meanMilliseconds: 10_600,
            trimmedMeanMilliseconds: 10_550,
            standardDeviationMilliseconds: 300,
            interquartileRangeMilliseconds: 200,
          },
          speed: {
            bestMetresPerSecond: 140,
            medianMetresPerSecond: 133.333,
          },
          starProfile: null,
          analyticalStatus: "experimental",
        },
      ],
    })),
  };
  return { vault, performance };
}

describe("Pro League preparation service", () => {
  it("fails closed without a connected owner", async () => {
    await expect(
      loadProLeaguePreparationPageState({
        authenticatedOwnerId: null,
        configuredOwnerId: ownerId,
        repository: unavailableProLeaguePreparationRepository,
      }),
    ).resolves.toMatchObject({ connectionStatus: "identity_not_connected" });
  });

  it("rejects a different signed-in owner", async () => {
    await expect(
      loadProLeaguePreparationPageState({
        authenticatedOwnerId: "other_owner",
        configuredOwnerId: ownerId,
        repository: unavailableProLeaguePreparationRepository,
      }),
    ).rejects.toThrow("access denied");
  });

  it("uses My Vault plus Bike profiles only", async () => {
    const { vault, performance } = repositories();
    const state = await loadProLeaguePreparationPageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: createProLeaguePreparationRepository({
        vaultRepository: vault,
        performanceRepository: performance,
      }),
    });
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.preparation?.teamCandidatePools.Water[0]).toMatchObject({
      coreId: "water-1",
      bikePriorStatus: "minimally_analytical",
    });
    expect(state.lastImportedAt).toBe("2026-08-20T00:00:00.000Z");
  });
});
