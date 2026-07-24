import { describe, expect, it, vi } from "vitest";
import {
  rollbackAcceptedImport,
  type ImportRollbackRepository,
} from "@/lib/import-rollback-service";

const requestedAt = new Date("2026-07-24T02:00:00.000Z");

function repository(
  result: Awaited<
    ReturnType<
      Extract<
        ImportRollbackRepository,
        { status: "ready" }
      >["rollbackActiveSourceVersion"]
    >
  > = {
    status: "restored",
    disposition: "created",
    rollbackId: "synthetic-rollback",
    sourceType: "current_vault",
    restoredBatchId: "prior-batch",
    aggregateRefreshId: "synthetic-refresh",
  },
): Extract<ImportRollbackRepository, { status: "ready" }> {
  return {
    status: "ready",
    rollbackActiveSourceVersion: vi.fn(async () => result),
  };
}

function input(
  overrides: Partial<Parameters<typeof rollbackAcceptedImport>[0]> = {},
): Parameters<typeof rollbackAcceptedImport>[0] {
  return {
    authenticatedOwnerId: "owner",
    configuredOwnerId: "owner",
    batchId: "active-batch",
    rollbackReason: "Restore the previously accepted snapshot.",
    idempotencyKey: "synthetic-rollback-request",
    explicitlyConfirmed: true,
    requestedAt,
    repository: repository(),
    ...overrides,
  };
}

describe("owner-confirmed import rollback", () => {
  it("returns disconnected and unconfigured states without persistence calls", async () => {
    const ready = repository();
    await expect(
      rollbackAcceptedImport(
        input({ authenticatedOwnerId: null, repository: ready }),
      ),
    ).resolves.toEqual({ status: "identity_not_connected" });
    expect(ready.rollbackActiveSourceVersion).not.toHaveBeenCalled();

    await expect(
      rollbackAcceptedImport(
        input({ repository: { status: "not_configured" } }),
      ),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("denies a different owner before persistence", async () => {
    const ready = repository();
    await expect(
      rollbackAcceptedImport(
        input({ authenticatedOwnerId: "other-owner", repository: ready }),
      ),
    ).rejects.toThrow("access denied");
    expect(ready.rollbackActiveSourceVersion).not.toHaveBeenCalled();
  });

  it("requires explicit confirmation and a meaningful reason", async () => {
    await expect(
      rollbackAcceptedImport(input({ explicitlyConfirmed: false })),
    ).rejects.toThrow("Explicit owner confirmation");
    await expect(
      rollbackAcceptedImport(input({ rollbackReason: "too short" })),
    ).rejects.toThrow("Rollback reason");
  });

  it("restores a prior version and always returns pending aggregate refresh", async () => {
    const ready = repository();
    await expect(
      rollbackAcceptedImport(input({ repository: ready })),
    ).resolves.toEqual({
      status: "restored",
      disposition: "created",
      rollbackId: "synthetic-rollback",
      sourceType: "current_vault",
      restoredBatchId: "prior-batch",
      aggregateRefreshId: "synthetic-refresh",
      aggregateStatus: "pending",
      provenanceRetained: true,
    });
    expect(ready.rollbackActiveSourceVersion).toHaveBeenCalledWith({
      ownerId: "owner",
      batchId: "active-batch",
      reason: "Restore the previously accepted snapshot.",
      idempotencyKey: "synthetic-rollback-request",
      requestedAt: requestedAt.toISOString(),
    });
  });

  it("returns safe non-mutating repository outcomes", async () => {
    for (const status of [
      "not_found",
      "not_active",
      "no_prior_version",
    ] as const) {
      await expect(
        rollbackAcceptedImport(input({ repository: repository({ status }) })),
      ).resolves.toEqual({ status });
    }
  });

  it("returns an existing rollback idempotently", async () => {
    await expect(
      rollbackAcceptedImport(
        input({
          repository: repository({
            status: "restored",
            disposition: "existing",
            rollbackId: "existing-rollback",
            sourceType: "race_merge",
            restoredBatchId: "prior-race-batch",
            aggregateRefreshId: "existing-refresh",
          }),
        }),
      ),
    ).resolves.toMatchObject({
      status: "restored",
      disposition: "existing",
      aggregateStatus: "pending",
      provenanceRetained: true,
    });
  });
});
