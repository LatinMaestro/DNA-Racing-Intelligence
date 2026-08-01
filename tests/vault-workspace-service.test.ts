import { describe, expect, it, vi } from "vitest";
import {
  loadVaultWorkspacePageState,
  unavailableVaultRegistryRepository,
  type VaultRegistryRepository,
} from "@/lib/vault-workspace-service";

const now = new Date("2026-07-24T08:00:00.000Z");

function readyRepository(
  evidence: Awaited<
    ReturnType<
      Extract<
        VaultRegistryRepository,
        { status: "ready" }
      >["loadVaultEvidenceByOwner"]
    >
  > = {
    snapshot: null,
    ownershipEdits: [],
    maidenOverrides: [],
    knownCoreIds: [],
  },
): Extract<VaultRegistryRepository, { status: "ready" }> {
  return {
    status: "ready",
    loadVaultEvidenceByOwner: vi.fn(async () => evidence),
  };
}

function input(
  overrides: Partial<Parameters<typeof loadVaultWorkspacePageState>[0]> = {},
): Parameters<typeof loadVaultWorkspacePageState>[0] {
  return {
    authenticatedOwnerId: "owner",
    configuredOwnerId: "owner",
    repository: readyRepository(),
    now,
    ...overrides,
  };
}

describe("Vault workspace service", () => {
  it("returns an identity state before inspecting persistence", async () => {
    await expect(
      loadVaultWorkspacePageState(
        input({
          authenticatedOwnerId: null,
          repository: unavailableVaultRegistryRepository,
        }),
      ),
    ).resolves.toMatchObject({
      connectionStatus: "identity_not_connected",
      registry: { cores: [], freshness: "unknown" },
    });
  });

  it("denies a different owner before persistence", async () => {
    const repository = readyRepository();
    await expect(
      loadVaultWorkspacePageState(
        input({ authenticatedOwnerId: "other-owner", repository }),
      ),
    ).rejects.toThrow("access denied");
    expect(repository.loadVaultEvidenceByOwner).not.toHaveBeenCalled();
  });

  it("keeps a verified owner fail-closed until persistence is configured", async () => {
    await expect(
      loadVaultWorkspacePageState(
        input({ repository: unavailableVaultRegistryRepository }),
      ),
    ).resolves.toMatchObject({
      connectionStatus: "persistence_not_configured",
      registry: { cores: [], freshness: "unknown" },
    });
  });

  it("builds the deterministic registry only from canonical owner-scoped evidence", async () => {
    const repository = readyRepository({
      snapshot: {
        snapshotId: " snapshot ",
        dataCurrentThrough: "2026-07-23T00:00:00.000Z",
        lastImportedAt: "2026-07-23T01:00:00.000Z",
        entries: [
          {
            entryId: " entry ",
            proposedCoreId: null,
            confirmedCoreId: " core-1 ",
            maidenState: "eligible",
          },
        ],
      },
      ownershipEdits: [],
      maidenOverrides: [],
      knownCoreIds: [" core-1 "],
    });

    await expect(
      loadVaultWorkspacePageState(input({ repository })),
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
    expect(repository.loadVaultEvidenceByOwner).toHaveBeenCalledWith("owner");
  });

  it("rejects malformed repository shapes and discriminants", async () => {
    for (const evidence of [
      null,
      {},
      {
        snapshot: null,
        ownershipEdits: {},
        maidenOverrides: [],
        knownCoreIds: [],
      },
      {
        snapshot: {
          snapshotId: "snapshot",
          dataCurrentThrough: "2026-07-23T00:00:00.000Z",
          lastImportedAt: "2026-07-23T01:00:00.000Z",
          entries: [{ maidenState: "invented" }],
        },
        ownershipEdits: [],
        maidenOverrides: [],
        knownCoreIds: [],
      },
    ]) {
      await expect(
        loadVaultWorkspacePageState(
          input({ repository: readyRepository(evidence as never) }),
        ),
      ).rejects.toThrow();
    }
  });

  it("rejects invalid request time and repository capability evidence", async () => {
    await expect(
      loadVaultWorkspacePageState(input({ now: "today" as never })),
    ).rejects.toThrow("now must be valid");
    await expect(
      loadVaultWorkspacePageState(
        input({ repository: { status: "unexpected" } as never }),
      ),
    ).rejects.toThrow("repository is invalid");
  });
});
