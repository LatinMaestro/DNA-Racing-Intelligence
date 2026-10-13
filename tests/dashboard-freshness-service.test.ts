import { describe, expect, it, vi } from "vitest";

import type { PrivateImportBatch } from "@/domain/import-workflow";
import { loadDashboardFreshnessPageState } from "@/lib/dashboard-freshness-service";
import type { ImportBatchRepository } from "@/lib/import-workspace-service";

const now = new Date("2026-10-14T00:00:00.000Z");

function batch(): PrivateImportBatch {
  return {
    batchId: "synthetic-race-receipt",
    sourceType: "race_merge",
    status: "accepted",
    uploadedAt: "2026-10-13T04:00:00.000Z",
    importCompletedAt: "2026-10-13T04:05:00.000Z",
    dataCurrentThrough: "2026-10-12T04:00:00.000Z",
    aggregateRefreshedAt: "2026-10-13T04:06:00.000Z",
    sourceRows: 2,
    acceptedRows: 2,
    rejectedRows: 0,
    warningRows: 0,
    isActive: true,
    priorVersionAvailable: false,
    identityReviewCount: 0,
    reconciliationReviewCount: 0,
    issueCounts: [],
  };
}

describe("dashboard freshness service", () => {
  it("keeps disconnected identity explicit without querying persistence", async () => {
    const listBatchesByOwner = vi.fn(async () => [batch()]);
    const state = await loadDashboardFreshnessPageState({
      authenticatedOwnerId: null,
      configuredOwnerId: "configured-owner",
      repository: { status: "ready", listBatchesByOwner },
      now,
    });

    expect(state.connectionStatus).toBe("identity_not_connected");
    expect(
      state.workspace.sources.every((source) => source.freshness === "unknown"),
    ).toBe(true);
    expect(listBatchesByOwner).not.toHaveBeenCalled();
  });

  it("denies a signed-in identity that differs from the allowlist", async () => {
    await expect(
      loadDashboardFreshnessPageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "configured-owner",
        repository: { status: "not_configured" },
        now,
      }),
    ).rejects.toThrow("access denied");
  });

  it("returns accepted owner-scoped source receipts", async () => {
    const listBatchesByOwner = vi.fn(async () => [batch()]);
    const state = await loadDashboardFreshnessPageState({
      authenticatedOwnerId: "configured-owner",
      configuredOwnerId: "configured-owner",
      repository: { status: "ready", listBatchesByOwner },
      now,
    });

    expect(listBatchesByOwner).toHaveBeenCalledExactlyOnceWith(
      "configured-owner",
    );
    expect(state.connectionStatus).toBe("read_model_connected");
    expect(state.workspace.sources[0]).toMatchObject({
      sourceType: "race_merge",
      activeBatchId: "synthetic-race-receipt",
      freshness: "current",
    });
  });

  it("does not downgrade a persistence owner-scope denial", async () => {
    await expect(
      loadDashboardFreshnessPageState({
        authenticatedOwnerId: "configured-owner",
        configuredOwnerId: "configured-owner",
        repository: {
          status: "ready",
          listBatchesByOwner: vi.fn(async () => {
            throw new Error("Import repository owner scope denied.");
          }),
        },
        now,
      }),
    ).rejects.toThrow("owner scope denied");
  });

  it("degrades an optional receipt failure without inventing source coverage", async () => {
    const repository: ImportBatchRepository = {
      status: "ready",
      listBatchesByOwner: vi.fn(async () => {
        throw new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL");
      }),
    };
    const state = await loadDashboardFreshnessPageState({
      authenticatedOwnerId: "configured-owner",
      configuredOwnerId: "configured-owner",
      repository,
      now,
    });

    expect(state.connectionStatus).toBe("read_failed");
    expect(
      state.workspace.sources.every((source) => source.activeBatchId === null),
    ).toBe(true);
    expect(
      state.workspace.sources.every((source) => source.freshness === "unknown"),
    ).toBe(true);
    expect(JSON.stringify(state)).not.toContain(
      "SYNTHETIC_PRIVATE_PROVIDER_DETAIL",
    );
  });
});
