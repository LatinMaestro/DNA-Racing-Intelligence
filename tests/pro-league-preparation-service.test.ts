import { describe, expect, it, vi } from "vitest";

import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import type { DiscoveryBenchmarkRepository } from "@/lib/neon-discovery-benchmark-repository";
import type { CorePayoutFormatProfileRepository } from "@/lib/neon-core-payout-format-profile-repository";
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
        coreClass: "Morphed" as const,
        element: "Water" as const,
        fNumber: 18,
        sex: "female" as const,
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
          distance: 1_600,
          dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          freshness: "current" as const,
          raceCount: 12,
          sampleStatus: "minimally_analytical" as const,
          elapsedTime: {
            bestMilliseconds: 11_000,
            medianMilliseconds: 11_400,
            meanMilliseconds: 11_500,
            trimmedMeanMilliseconds: 11_450,
            standardDeviationMilliseconds: 250,
            interquartileRangeMilliseconds: 180,
          },
          speed: {
            bestMetresPerSecond: 145.455,
            medianMetresPerSecond: 140.351,
          },
          starProfile: null,
          analyticalStatus: "experimental" as const,
        },
      ],
    })),
  };
  const benchmark: DiscoveryBenchmarkRepository = {
    status: "ready",
    listBenchmarksByOwner: vi.fn(async () => [
      {
        mode: "bike" as const,
        distanceMetres: 1_400,
        dataCurrentThrough: "2026-08-19T00:00:00.000Z",
        raceEntryCount: 100,
        winningEntryCount: 20,
        topThreeEntryCount: 60,
        winningP25Milliseconds: 9_800,
        winningMedianMilliseconds: 10_100,
        winningP75Milliseconds: 10_200,
        topThreeP25Milliseconds: 10_100,
        topThreeMedianMilliseconds: 10_600,
        topThreeP75Milliseconds: 10_900,
        refreshedAt: "2026-08-20T00:00:00.000Z",
      },
      {
        mode: "car" as const,
        distanceMetres: 1_600,
        dataCurrentThrough: "2026-08-19T00:00:00.000Z",
        raceEntryCount: 100,
        winningEntryCount: 20,
        topThreeEntryCount: 60,
        winningP25Milliseconds: 10_500,
        winningMedianMilliseconds: 10_800,
        winningP75Milliseconds: 10_900,
        topThreeP25Milliseconds: 10_900,
        topThreeMedianMilliseconds: 11_500,
        topThreeP75Milliseconds: 11_700,
        refreshedAt: "2026-08-20T00:00:00.000Z",
      },
    ]),
  };
  const payoutFormat: CorePayoutFormatProfileRepository = {
    status: "ready",
    listProfilesByOwner: vi.fn(async () => ({
      lastImportedAt: "2026-08-20T00:00:00.000Z",
      profiles: [
        {
          coreId: "water-1",
          mode: "bike" as const,
          payoutFormatKey: "top 3",
          payoutFormatLabel: "Top 3",
          dataCurrentThrough: "2026-08-19T00:00:00.000Z",
          firstEventAt: "2026-08-01T00:00:00.000Z",
          raceCount: 12,
          winCount: 2,
          topThreeCount: 7,
          exactDistanceCount: 3,
          timedRaceCount: 12,
          refreshedAt: "2026-08-20T00:00:00.000Z",
          sampleStatus: "minimally_supported" as const,
          freshness: "current" as const,
        },
      ],
    })),
  };
  return { vault, performance, benchmark, payoutFormat };
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

  it("uses My Vault plus cross-mode benchmark-relative performance", async () => {
    const { vault, performance, benchmark, payoutFormat } = repositories();
    const state = await loadProLeaguePreparationPageState({
      authenticatedOwnerId: ownerId,
      configuredOwnerId: ownerId,
      repository: createProLeaguePreparationRepository({
        vaultRepository: vault,
        performanceRepository: performance,
        benchmarkRepository: benchmark,
        payoutFormatRepository: payoutFormat,
      }),
    });

    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.preparation?.overallPowerPool[0]).toMatchObject({
      coreId: "water-1",
      powerTier: "multi_mode_top_three_range",
      winningRangeModes: ["bike"],
      topThreeOrBetterModes: ["bike", "car"],
      analyticalModes: ["bike", "car"],
      supportedPayoutFormatCount: 1,
    });
    expect(state.lastImportedAt).toBe("2026-08-20T00:00:00.000Z");
  });

  it("fails closed when benchmark evidence is not configured", () => {
    const { vault, performance, payoutFormat } = repositories();

    expect(
      createProLeaguePreparationRepository({
        vaultRepository: vault,
        performanceRepository: performance,
        benchmarkRepository: { status: "not_configured" },
        payoutFormatRepository: payoutFormat,
      }),
    ).toBe(unavailableProLeaguePreparationRepository);
  });

  it("fails closed when payout-format evidence is not configured", () => {
    const { vault, performance, benchmark } = repositories();

    expect(
      createProLeaguePreparationRepository({
        vaultRepository: vault,
        performanceRepository: performance,
        benchmarkRepository: benchmark,
        payoutFormatRepository: { status: "not_configured" },
      }),
    ).toBe(unavailableProLeaguePreparationRepository);
  });
});
