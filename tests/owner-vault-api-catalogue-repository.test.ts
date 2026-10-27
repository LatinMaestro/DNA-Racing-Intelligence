import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabServingOwnedCore } from "@/lib/neon-dna-open-lab-sync-publication";
import { createOwnerVaultApiCatalogueRepository } from "@/lib/owner-vault-api-catalogue-repository";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

const filters = {
  scope: "vault" as const,
  query: null,
  element: null,
  coreClass: null,
  sex: null,
  fNumber: null,
};

function apiCore(
  sourceCoreId: string,
  displayName: string,
  element: "Metal" | "Fire" = "Metal",
): DnaOpenLabServingOwnedCore {
  return {
    generationId: "11111111-1111-4111-8111-111111111111",
    observedAt: "2026-09-22T00:00:00.000Z",
    rawEvidenceSha256: "a".repeat(64),
    canonical: {
      sourceType: "core_details",
      sourceCoreId,
      displayName,
      coreClass: "Genesis",
      element,
      fNumber: 1,
      sex: "female",
      colorSourceValue: null,
      fatherSourceCoreId: null,
      fatherNameSourceValue: null,
      motherSourceCoreId: null,
      motherNameSourceValue: null,
    },
  };
}

function supplemental(isMaidenByCore: Readonly<Record<string, boolean>>) {
  return {
    generationId: "11111111-1111-4111-8111-111111111111",
    rows: Object.entries(isMaidenByCore).map(([sourceCoreId, isMaiden]) => ({
      generationId: "11111111-1111-4111-8111-111111111111",
      sourceCoreId,
      family: "racing_stats" as const,
      observedAt: "2026-09-22T00:00:00.000Z",
      rawEvidenceSha256: "c".repeat(64),
      canonical: {
        sourceType: "core_racing_stats_snapshot" as const,
        sourceCoreId,
        statsByMode: { bike: {}, car: {}, horse: {} },
        ageingSourceValue: null,
        isMaiden,
        tournamentProfitsSourceValue: null,
      },
    })),
  };
}

describe("accepted owner API Vault catalogue fallback", () => {
  it("preserves a complete accepted Core Details catalogue when available", async () => {
    const legacyRead = vi.fn(async () => ({
      cores: [],
      publication: {
        coreDatasetVersionId: "33333333-3333-4333-8333-333333333333",
        importBatchId: "44444444-4444-4444-8444-444444444444",
        sourceSha256: "b".repeat(64),
        sourceRowCount: 1,
        acceptedRowCount: 0,
        coreCount: 0,
        evidenceRowCount: 1,
        activatedAt: "2026-09-20T00:00:00.000Z",
        dataCurrentThrough: null,
        aggregateRefreshedAt: "2026-09-20T00:00:00.000Z",
        evidenceSealedAt: "2026-09-20T00:00:00.000Z",
      },
    }));
    const apiRead = vi.fn();
    const supplementalRead = vi.fn();
    const fallback: OwnerVaultCatalogueRepository = {
      status: "ready",
      listCoresByOwner: vi.fn(),
      readCataloguePageByOwner: legacyRead,
    };
    const repository = createOwnerVaultApiCatalogueRepository({
      fallback,
      apiRepository: {
        readServingOwnedCores: apiRead,
        readServingSupplementalCores: supplementalRead,
      },
    });

    await expect(
      repository.status === "ready"
        ? repository.readCataloguePageByOwner!("owner-1", filters)
        : null,
    ).resolves.toMatchObject({
      cores: [],
      publication: {
        coreDatasetVersionId: "33333333-3333-4333-8333-333333333333",
      },
    });
    expect(apiRead).not.toHaveBeenCalled();
    expect(supplementalRead).not.toHaveBeenCalled();
  });

  it("maps and filters the accepted owner snapshot without inventing registry state", async () => {
    const apiRead = vi.fn(async () => [
      apiCore("101", "Solar One", "Fire"),
      apiCore("102", "Metal Two"),
    ]);
    const repository = createOwnerVaultApiCatalogueRepository({
      fallback: {
        status: "ready",
        listCoresByOwner: vi.fn(),
        readCataloguePageByOwner: vi.fn(async () => {
          throw new Error("Core Details publication absent");
        }),
      },
      apiRepository: {
        readServingOwnedCores: apiRead,
        readServingSupplementalCores: vi.fn(async () =>
          supplemental({ "101": true }),
        ),
      },
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");

    const read = await repository.readCataloguePageByOwner!("owner-1", {
      ...filters,
      query: "solar",
      element: "Fire",
    });

    expect(read).toMatchObject({
      coverage: "accepted_owner_api_snapshot",
      publication: null,
      apiSnapshot: {
        generationId: "11111111-1111-4111-8111-111111111111",
        coreCount: 2,
      },
      cores: [
        {
          sourceCoreId: "101",
          inMyVault: true,
          meEligible: true,
          version: null,
          source: "accepted_owner_api_snapshot",
        },
      ],
    });
    expect(apiRead).toHaveBeenCalledWith({ ownerId: "owner-1" });
  });

  it("rejects mixed accepted API generation identities", async () => {
    const repository = createOwnerVaultApiCatalogueRepository({
      fallback: { status: "not_configured" },
      apiRepository: {
        readServingOwnedCores: vi.fn(async () => [
          apiCore("101", "One"),
          {
            ...apiCore("102", "Two"),
            generationId: "22222222-2222-4222-8222-222222222222",
          },
        ]),
        readServingSupplementalCores: vi.fn(async () => supplemental({})),
      },
    });
    if (repository.status !== "ready")
      throw new Error("repository unavailable");
    await expect(
      repository.readCataloguePageByOwner!("owner-1", filters),
    ).rejects.toThrow("generation is inconsistent");
  });
});
