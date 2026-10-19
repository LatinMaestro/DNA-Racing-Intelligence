import { describe, expect, it, vi } from "vitest";
import type { PrivateImportBatch } from "@/domain/import-workflow";
import {
  loadImportWorkspacePageState,
  unavailableImportBatchRepository,
  type ImportBatchRepository,
} from "@/lib/import-workspace-service";

const now = new Date("2026-07-24T08:00:00.000Z");

function batch(
  overrides: Partial<PrivateImportBatch> = {},
): PrivateImportBatch {
  return {
    batchId: "synthetic-batch",
    sourceType: "race_merge",
    status: "accepted",
    uploadedAt: "2026-07-24T06:00:00.000Z",
    importCompletedAt: "2026-07-24T06:05:00.000Z",
    dataCurrentThrough: "2026-07-23T06:00:00.000Z",
    aggregateRefreshedAt: "2026-07-24T06:06:00.000Z",
    sourceRows: 2,
    acceptedRows: 2,
    rejectedRows: 0,
    warningRows: 0,
    isActive: true,
    priorVersionAvailable: false,
    identityReviewCount: 0,
    reconciliationReviewCount: 0,
    issueCounts: [],
    ...overrides,
  };
}

describe("owner-scoped import workspace service", () => {
  it("returns an explicit empty identity state without querying persistence", async () => {
    const listBatchesByOwner = vi.fn(async () => [batch()]);
    const repository: ImportBatchRepository = {
      status: "ready",
      listBatchesByOwner,
    };

    const state = await loadImportWorkspacePageState({
      authenticatedOwnerId: null,
      configuredOwnerId: "configured-owner",
      repository,
      now,
    });

    expect(state.connectionStatus).toBe("identity_not_connected");
    expect(state.workspace.recentBatches).toEqual([]);
    expect(listBatchesByOwner).not.toHaveBeenCalled();
  });

  it("denies a signed-in identity that differs from the configured owner", async () => {
    await expect(
      loadImportWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "configured-owner",
        repository: unavailableImportBatchRepository,
        now,
      }),
    ).rejects.toThrow("access denied");
  });

  it("keeps persistence unavailable after owner verification", async () => {
    const state = await loadImportWorkspacePageState({
      authenticatedOwnerId: "configured-owner",
      configuredOwnerId: "configured-owner",
      repository: unavailableImportBatchRepository,
      now,
    });

    expect(state.connectionStatus).toBe("persistence_not_configured");
    expect(
      state.workspace.sources.every(({ freshness }) => freshness === "unknown"),
    ).toBe(true);
  });

  it("queries only the verified owner and builds the connected read model", async () => {
    const listBatchesByOwner = vi.fn(async () => [batch()]);
    const state = await loadImportWorkspacePageState({
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
      latestBatchStatus: "accepted",
      acceptedRows: 2,
      freshness: "current",
    });
  });

  it("withholds all evidence when persisted batches are internally inconsistent", async () => {
    await expect(
      loadImportWorkspacePageState({
        authenticatedOwnerId: "configured-owner",
        configuredOwnerId: "configured-owner",
        repository: {
          status: "ready",
          listBatchesByOwner: async () => [
            batch({ acceptedRows: 2, rejectedRows: 1 }),
          ],
        },
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "integrity_failed",
      workspace: {
        recentBatches: [],
        recoveryQueue: [],
      },
    });
  });

  it("withholds all evidence when the owner-scoped repository read fails", async () => {
    const listBatchesByOwner = vi.fn(async () => {
      throw new Error("SYNTHETIC_PRIVATE_PROVIDER_DETAIL");
    });
    const state = await loadImportWorkspacePageState({
      authenticatedOwnerId: "configured-owner",
      configuredOwnerId: "configured-owner",
      repository: { status: "ready", listBatchesByOwner },
      now,
    });

    expect(listBatchesByOwner).toHaveBeenCalledExactlyOnceWith(
      "configured-owner",
    );
    expect(state.connectionStatus).toBe("read_failed");
    expect(state.workspace.recentBatches).toEqual([]);
    expect(state.workspace.recoveryQueue).toEqual([]);
    expect(
      state.workspace.sources.every(
        ({ activeBatchId, freshness }) =>
          activeBatchId === null && freshness === "unknown",
      ),
    ).toBe(true);
    expect(JSON.stringify(state)).not.toContain(
      "SYNTHETIC_PRIVATE_PROVIDER_DETAIL",
    );
  });

  it("does not downgrade a repository owner-scope denial", async () => {
    await expect(
      loadImportWorkspacePageState({
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

  it("rejects an invalid repository capability before reading evidence", async () => {
    await expect(
      loadImportWorkspacePageState({
        authenticatedOwnerId: "configured-owner",
        configuredOwnerId: "configured-owner",
        repository: { status: "unexpected" } as never,
        now,
      }),
    ).rejects.toThrow("repository status is invalid");
  });
});
