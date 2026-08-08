import { describe, expect, it, vi } from "vitest";

import {
  rollbackOwnerImport,
  type ImportRecoveryActionDependencies,
} from "../lib/import-recovery-action-service";
import type { ImportRollbackRepository } from "../lib/import-rollback-service";

function readyRepository() {
  const rollbackActiveSourceVersion = vi.fn<
    Extract<
      ImportRollbackRepository,
      { status: "ready" }
    >["rollbackActiveSourceVersion"]
  >(async () => ({
    status: "restored",
    disposition: "created",
    rollbackId: "rollback-1",
    sourceType: "current_vault",
    restoredBatchId: "batch-prior",
    aggregateRefreshId: "refresh-1",
  }));
  return {
    value: {
      status: "ready",
      rollbackActiveSourceVersion,
    } satisfies ImportRollbackRepository,
    rollbackActiveSourceVersion,
  };
}

function dependencies(
  repository: ImportRollbackRepository,
  ownerId: string | null = "owner-1",
): ImportRecoveryActionDependencies {
  return {
    resolveAuthenticatedOwnerId: vi.fn(async () => ownerId),
    configuredOwnerId: "owner-1",
    now: () => new Date("2026-07-26T08:00:00.000Z"),
    rollbackRepository: repository,
  };
}

const input = {
  batchId: "batch-active",
  rollbackReason: "Restore the prior accepted Vault snapshot.",
  idempotencyKey: "rollback-request-1",
  explicitlyConfirmed: true,
} as const;

describe("import recovery owner action", () => {
  it("sanitizes an authentication-provider failure before persistence", async () => {
    const repository = readyRepository();
    const actionDependencies = dependencies(repository.value);

    await expect(
      rollbackOwnerImport(input, {
        ...actionDependencies,
        resolveAuthenticatedOwnerId: vi.fn(async () => {
          throw new Error("synthetic provider details");
        }),
      }),
    ).rejects.toThrow("Owner authentication is unavailable.");

    expect(repository.rollbackActiveSourceVersion).not.toHaveBeenCalled();
  });

  it("keeps a signed-out session disconnected before persistence", async () => {
    const repository = readyRepository();

    await expect(
      rollbackOwnerImport(input, dependencies(repository.value, null)),
    ).resolves.toEqual({ status: "identity_not_connected" });

    expect(repository.rollbackActiveSourceVersion).not.toHaveBeenCalled();
  });

  it("rejects a non-owner before persistence", async () => {
    const repository = readyRepository();

    await expect(
      rollbackOwnerImport(input, dependencies(repository.value, "other-owner")),
    ).rejects.toThrow("access denied");

    expect(repository.rollbackActiveSourceVersion).not.toHaveBeenCalled();
  });

  it("preserves the explicit unavailable-persistence state", async () => {
    await expect(
      rollbackOwnerImport(input, dependencies({ status: "not_configured" })),
    ).resolves.toEqual({ status: "persistence_not_configured" });
  });

  it("requires explicit confirmation before persistence", async () => {
    const repository = readyRepository();

    await expect(
      rollbackOwnerImport(
        { ...input, explicitlyConfirmed: false },
        dependencies(repository.value),
      ),
    ).rejects.toThrow("Explicit owner confirmation");

    expect(repository.rollbackActiveSourceVersion).not.toHaveBeenCalled();
  });

  it("forwards reasoned rollback and preserves pending aggregate refresh", async () => {
    const repository = readyRepository();

    await expect(
      rollbackOwnerImport(input, dependencies(repository.value)),
    ).resolves.toEqual({
      status: "restored",
      disposition: "created",
      rollbackId: "rollback-1",
      sourceType: "current_vault",
      restoredBatchId: "batch-prior",
      aggregateRefreshId: "refresh-1",
      aggregateStatus: "pending",
      provenanceRetained: true,
    });

    expect(repository.rollbackActiveSourceVersion).toHaveBeenCalledWith({
      ownerId: "owner-1",
      batchId: "batch-active",
      reason: "Restore the prior accepted Vault snapshot.",
      idempotencyKey: "rollback-request-1",
      requestedAt: "2026-07-26T08:00:00.000Z",
    });
  });
});
