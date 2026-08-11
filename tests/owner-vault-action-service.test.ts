import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  updateOwnerVaultCore,
  type OwnerVaultMutationRepository,
} from "../lib/owner-vault-action-service";

const ownerId = "user_owner";
type ReadyRepository = Extract<
  OwnerVaultMutationRepository,
  { status: "ready" }
>;
type SetCoreStateInput = Parameters<ReadyRepository["setCoreState"]>[0];

function dependencies(repository: OwnerVaultMutationRepository) {
  return {
    resolveAuthenticatedOwnerId: vi.fn(async () => ownerId),
    configuredOwnerId: ownerId,
    repository,
    now: () => new Date("2026-08-11T01:00:00.000Z"),
  };
}

describe("owner Vault action service", () => {
  it("fails closed before persistence when owner identity is unavailable or mismatched", async () => {
    const setCoreState = vi.fn();
    const repository: OwnerVaultMutationRepository = {
      status: "ready",
      setCoreState,
    };

    await expect(
      updateOwnerVaultCore(
        {
          sourceCoreId: "core-1",
          inMyVault: true,
          meEligible: false,
          expectedVersion: 0,
          idempotencyKey: "vault-1",
        },
        {
          ...dependencies(repository),
          resolveAuthenticatedOwnerId: async () => null,
        },
      ),
    ).resolves.toEqual({ status: "identity_not_connected" });

    await expect(
      updateOwnerVaultCore(
        {
          sourceCoreId: "core-1",
          inMyVault: true,
          meEligible: false,
          expectedVersion: 0,
          idempotencyKey: "vault-1",
        },
        {
          ...dependencies(repository),
          configuredOwnerId: "different-owner",
        },
      ),
    ).resolves.toEqual({ status: "identity_not_connected" });
    expect(setCoreState).not.toHaveBeenCalled();
  });

  it("rejects impossible ME state and malformed versions before persistence", async () => {
    const setCoreState = vi.fn();
    const repository: OwnerVaultMutationRepository = {
      status: "ready",
      setCoreState,
    };
    await expect(
      updateOwnerVaultCore(
        {
          sourceCoreId: "core-1",
          inMyVault: false,
          meEligible: true,
          expectedVersion: 0,
          idempotencyKey: "vault-1",
        },
        dependencies(repository),
      ),
    ).resolves.toEqual({ status: "invalid_request" });
    await expect(
      updateOwnerVaultCore(
        {
          sourceCoreId: "core-1",
          inMyVault: true,
          meEligible: false,
          expectedVersion: -1,
          idempotencyKey: "vault-2",
        },
        dependencies(repository),
      ),
    ).resolves.toEqual({ status: "invalid_request" });
    expect(setCoreState).not.toHaveBeenCalled();
  });

  it("binds an authenticated mutation to a deterministic request fingerprint", async () => {
    const setCoreState = vi.fn(async (input: SetCoreStateInput) => ({
      status: "applied" as const,
      sourceCoreId: input.sourceCoreId,
      inMyVault: input.inMyVault,
      meEligible: input.meEligible,
      version: 4,
      updatedAt: input.requestedAt,
    }));
    const repository: OwnerVaultMutationRepository = {
      status: "ready",
      setCoreState,
    };
    const input = {
      sourceCoreId: "core-1",
      inMyVault: true,
      meEligible: true,
      expectedVersion: 3,
      idempotencyKey: "vault-3",
    };

    await expect(
      updateOwnerVaultCore(input, dependencies(repository)),
    ).resolves.toEqual({
      status: "updated",
      state: {
        status: "applied",
        sourceCoreId: "core-1",
        inMyVault: true,
        meEligible: true,
        version: 4,
        updatedAt: "2026-08-11T01:00:00.000Z",
      },
    });

    expect(setCoreState).toHaveBeenCalledWith({
      ownerId,
      ...input,
      requestFingerprintSha256: createHash("sha256")
        .update(JSON.stringify(["core-1", true, true, 3]))
        .digest("hex"),
      requestedAt: "2026-08-11T01:00:00.000Z",
    });
  });

  it.each([
    ["conflict", "conflict"],
    ["core_unavailable", "core_unavailable"],
    ["idempotency_conflict", "idempotency_conflict"],
    ["invalid_state", "invalid_request"],
  ] as const)(
    "maps %s without exposing provider details",
    async (repositoryStatus, actionStatus) => {
      const repository: OwnerVaultMutationRepository = {
        status: "ready",
        setCoreState: async () => ({ status: repositoryStatus }),
      };
      await expect(
        updateOwnerVaultCore(
          {
            sourceCoreId: "core-1",
            inMyVault: true,
            meEligible: false,
            expectedVersion: 0,
            idempotencyKey: "vault-map",
          },
          dependencies(repository),
        ),
      ).resolves.toEqual({ status: actionStatus });
    },
  );

  it("returns a fixed unavailable state for unexpected persistence failures", async () => {
    const repository: OwnerVaultMutationRepository = {
      status: "ready",
      setCoreState: async () => {
        throw new Error("postgresql://secret-host/private-row");
      },
    };
    await expect(
      updateOwnerVaultCore(
        {
          sourceCoreId: "core-1",
          inMyVault: true,
          meEligible: false,
          expectedVersion: 0,
          idempotencyKey: "vault-fail",
        },
        dependencies(repository),
      ),
    ).resolves.toEqual({ status: "persistence_unavailable" });
  });
});
