import { describe, expect, it, vi } from "vitest";

import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import {
  createEsportsPrepRepository,
  loadEsportsPrepWorkspacePageState,
  unavailableEsportsPrepRepository,
} from "@/lib/esports-prep-workspace-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

const ownerId = "user_owner";

function repositories() {
  const listCoresByOwner = vi.fn(async () => [
    {
      sourceCoreId: "water-1",
      displayName: "Water One",
      coreClass: "Morphed" as const,
      element: "Water" as const,
      fNumber: 18,
      sex: "female" as const,
      inMyVault: true,
      meEligible: false,
      version: 1,
      updatedAt: "2026-08-19T00:00:00.000Z",
    },
  ]);
  const listProfilesByOwner = vi.fn(async () => ({
    lastImportedAt: "2026-08-20T00:00:00.000Z",
    profiles: [
      {
        coreId: "water-1",
        mode: "bike" as const,
        distance: 1_400,
        dataCurrentThrough: "2026-08-19T00:00:00.000Z",
        freshness: "current" as const,
        raceCount: 10,
        sampleStatus: "minimally_analytical" as const,
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
        analyticalStatus: "experimental" as const,
      },
      {
        coreId: "water-1",
        mode: "car" as const,
        distance: 1_400,
        dataCurrentThrough: "2026-08-19T00:00:00.000Z",
        freshness: "current" as const,
        raceCount: 20,
        sampleStatus: "minimally_analytical" as const,
        elapsedTime: {
          bestMilliseconds: 9_000,
          medianMilliseconds: 9_500,
          meanMilliseconds: 9_600,
          trimmedMeanMilliseconds: 9_550,
          standardDeviationMilliseconds: 250,
          interquartileRangeMilliseconds: 180,
        },
        speed: {
          bestMetresPerSecond: 155.556,
          medianMetresPerSecond: 147.368,
        },
        starProfile: null,
        analyticalStatus: "experimental" as const,
      },
    ],
  }));
  const vaultRepository: OwnerVaultCatalogueRepository = {
    status: "ready",
    listCoresByOwner,
  };
  const performanceRepository: CorePerformanceProfileRepository = {
    status: "ready",
    listProfilesByOwner,
  };
  return {
    vaultRepository,
    performanceRepository,
    listCoresByOwner,
    listProfilesByOwner,
  };
}

describe("Esports preparation workspace service", () => {
  it("fails closed when owner identity is not connected", async () => {
    const state = await loadEsportsPrepWorkspacePageState({
      authenticatedOwnerId: null,
      configuredOwnerId: ownerId,
      repository: unavailableEsportsPrepRepository,
    });
    expect(state).toEqual({
      connectionStatus: "identity_not_connected",
      preparation: null,
      lastImportedAt: null,
    });
  });

  it("fails closed when either required private read model is unavailable", () => {
    const ready = repositories();
    expect(
      createEsportsPrepRepository({
        vaultRepository: ready.vaultRepository,
        performanceRepository: { status: "not_configured" },
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("denies a signed-in owner who does not match the configured private owner", async () => {
    await expect(
      loadEsportsPrepWorkspacePageState({
        authenticatedOwnerId: "other_owner",
        configuredOwnerId: ownerId,
        repository: unavailableEsportsPrepRepository,
      }),
    ).rejects.toThrow("access denied");
  });

  it("builds preparation from current Vault cores and Bike profiles only", async () => {
    const ready = repositories();
    const repository = createEsportsPrepRepository({
      vaultRepository: ready.vaultRepository,
      performanceRepository: ready.performanceRepository,
    });
    const state = await loadEsportsPrepWorkspacePageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository,
    });

    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.lastImportedAt).toBe("2026-08-20T00:00:00.000Z");
    expect(state.preparation?.ownedCoreCount).toBe(1);
    expect(state.preparation?.candidates[0]).toMatchObject({
      coreId: "water-1",
      sex: "female",
      fNumber: 18,
      totalDnaRacingBikeRaces: 10,
      minimallyAnalyticalBikeDistances: 1,
      bikePriorStatus: "minimally_analytical",
    });
    expect(ready.listCoresByOwner).toHaveBeenCalledWith(ownerId, {
      scope: "vault",
      query: null,
      element: null,
      coreClass: null,
      sex: null,
      fNumber: null,
    });
    expect(ready.listProfilesByOwner).toHaveBeenCalledWith(ownerId);
  });
});
