import { describe, expect, it, vi } from "vitest";
import {
  buildVaultPerformanceSummary,
  type VaultPerformanceSummary,
} from "@/domain/vault-performance-summary";
import {
  loadVaultPerformancePageState,
  unavailableVaultPerformanceSummaryRepository,
} from "@/lib/vault-performance-workspace-service";

const now = new Date("2026-07-21T00:00:00.000Z");

const summary = buildVaultPerformanceSummary(
  [
    {
      transactionId: "synthetic-payout",
      occurredAt: "2026-07-20T00:00:00.000Z",
      assetCode: "DEZ",
      assetKind: "crypto",
      signedAmount: "1.25",
      category: "open_race_payout",
      operating: true,
      aggregateStatus: "included",
      classificationStatus: "confirmed",
      reconciliationStatus: "reconciled",
    },
  ],
  {
    periodStart: "2026-07-01T00:00:00.000Z",
    periodEnd: "2026-07-31T23:59:59.000Z",
    sourceCoverage: "complete_recorded_period",
    manualTournamentPayoutStatus: "confirmed_none",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImported: "2026-07-20T01:00:00.000Z",
    freshnessState: "current",
  },
);

describe("Vault Performance workspace service", () => {
  it("returns an identity state before inspecting persistence", async () => {
    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        now,
        repository: unavailableVaultPerformanceSummaryRepository,
      }),
    ).resolves.toEqual({
      summary: null,
      connectionStatus: "identity_not_connected",
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadSummaryByOwner = vi.fn(async () => summary);
    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        now,
        repository: { status: "ready", loadSummaryByOwner },
      }),
    ).rejects.toThrow("access denied");
    expect(loadSummaryByOwner).not.toHaveBeenCalled();
  });

  it("keeps a verified owner fail-closed until persistence is configured", async () => {
    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        now,
        repository: unavailableVaultPerformanceSummaryRepository,
      }),
    ).resolves.toEqual({
      summary: null,
      connectionStatus: "persistence_not_configured",
    });
  });

  it("loads a validated owner-scoped materialized summary", async () => {
    const loadSummaryByOwner = vi.fn(async (ownerId: string) => {
      expect(ownerId).toBe("owner");
      return summary;
    });
    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        now,
        repository: { status: "ready", loadSummaryByOwner },
      }),
    ).resolves.toEqual({
      summary,
      connectionStatus: "read_model_connected",
    });
  });

  it("derives freshness at the 3/4/7/8-day boundaries", async () => {
    const cases = [
      ["2026-07-18T00:00:00.000Z", "current", []],
      ["2026-07-17T00:00:00.000Z", "ageing", ["IMPORTED_DATA_AGEING"]],
      ["2026-07-14T00:00:00.000Z", "ageing", ["IMPORTED_DATA_AGEING"]],
      ["2026-07-13T00:00:00.000Z", "stale", ["IMPORTED_DATA_STALE"]],
    ] as const;

    for (const [dataCurrentThrough, freshnessState, expectedWarnings] of cases) {
      const result = await loadVaultPerformancePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadSummaryByOwner: async () => ({
            ...summary,
            dataCurrentThrough,
            lastImported: "2026-07-21T00:00:00.000Z",
            freshnessState: "current",
            status: "complete_recorded_period",
            warnings: [],
          }),
        },
        now,
      });

      expect(result.summary?.freshnessState).toBe(freshnessState);
      expect(result.summary?.warnings).toEqual(expectedWarnings);
      expect(result.summary?.status).toBe(
        expectedWarnings.length === 0 ? "complete_recorded_period" : "partial",
      );
    }
  });

  it("rejects impossible freshness chronology and invalid repository capabilities", async () => {
    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: {
          status: "ready",
          loadSummaryByOwner: async () => ({
            ...summary,
            dataCurrentThrough: "2026-07-21T02:00:00.000Z",
            lastImported: "2026-07-21T01:00:00.000Z",
          }),
        },
        now,
      }),
    ).rejects.toThrow("cannot follow its import");

    await expect(
      loadVaultPerformancePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: { status: "unexpected" } as never,
        now,
      }),
    ).rejects.toThrow("repository");
  });

  it("rejects malformed persisted totals and completeness claims", async () => {
    const cases: VaultPerformanceSummary[] = [
      {
        ...summary,
        cashCryptoTotals: [
          { ...summary.cashCryptoTotals[0]!, openRacingNet: "1e2" },
        ],
      },
      {
        ...summary,
        status: "partial",
      },
      {
        ...summary,
        combinedAssetTotalAvailable: true as false,
      },
    ];

    for (const persisted of cases) {
      await expect(
        loadVaultPerformancePageState({
          authenticatedOwnerId: "owner",
          configuredOwnerId: "owner",
          now,
          repository: {
            status: "ready",
            loadSummaryByOwner: async () => persisted,
          },
        }),
      ).rejects.toThrow("Invalid Vault Performance");
    }
  });
});
