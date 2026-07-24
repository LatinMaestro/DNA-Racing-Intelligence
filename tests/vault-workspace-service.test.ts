import { describe, expect, it, vi } from "vitest";
import {
  loadVaultWorkspacePageState,
  unavailableVaultRegistryRepository,
  type VaultRegistryRepository,
} from "@/lib/vault-workspace-service";

const now = new Date("2026-07-24T08:00:00.000Z");

describe("Vault workspace service", () => {
  it("returns an identity state before inspecting persistence", async () => {
    await expect(
      loadVaultWorkspacePageState({
        authenticatedOwnerId: null,
        configuredOwnerId: "owner",
        repository: unavailableVaultRegistryRepository,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "identity_not_connected",
      registry: { cores: [], freshness: "unknown" },
    });
  });

  it("denies a different owner before persistence", async () => {
    const loadVaultEvidenceByOwner = vi.fn(async () => ({
      snapshot: null,
      ownershipEdits: [],
      maidenOverrides: [],
      knownCoreIds: [],
    }));
    await expect(
      loadVaultWorkspacePageState({
        authenticatedOwnerId: "other-owner",
        configuredOwnerId: "owner",
        repository: { status: "ready", loadVaultEvidenceByOwner },
        now,
      }),
    ).rejects.toThrow("access denied");
    expect(loadVaultEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("keeps a verified owner fail-closed until persistence is configured", async () => {
    await expect(
      loadVaultWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository: unavailableVaultRegistryRepository,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      registry: { cores: [], freshness: "unknown" },
    });
  });

  it("builds the deterministic registry only from owner-scoped evidence", async () => {
    const repository: VaultRegistryRepository = {
      status: "ready",
      loadVaultEvidenceByOwner: vi.fn(async (ownerId) => {
        expect(ownerId).toBe("owner");
        return {
          snapshot: {
            snapshotId: "snapshot",
            dataCurrentThrough: "2026-07-23T00:00:00.000Z",
            lastImportedAt: "2026-07-23T01:00:00.000Z",
            entries: [
              {
                entryId: "entry",
                proposedCoreId: null,
                confirmedCoreId: "core-1",
                maidenState: "eligible" as const,
              },
            ],
          },
          ownershipEdits: [],
          maidenOverrides: [],
          knownCoreIds: ["core-1"],
        };
      }),
    };

    await expect(
      loadVaultWorkspacePageState({
        authenticatedOwnerId: "owner",
        configuredOwnerId: "owner",
        repository,
        now,
      }),
    ).resolves.toMatchObject({
      connectionStatus: "read_model_connected",
      registry: {
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        cores: [
          {
            coreId: "core-1",
            maidenState: "eligible",
            profileStatus: "ready",
          },
        ],
      },
    });
  });
});
