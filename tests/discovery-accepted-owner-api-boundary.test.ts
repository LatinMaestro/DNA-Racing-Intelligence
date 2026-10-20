import { readFileSync } from "node:fs";

import { describe, expect, it, vi } from "vitest";

import { createDiscoveryProbeRepository } from "@/lib/discovery-workspace-service";

describe("Discovery accepted owner API Core source", () => {
  it("composes the same accepted owner API fallback as My Vault and Search", () => {
    const page = readFileSync("app/(private)/discovery/page.tsx", "utf8");
    expect(page).toContain(
      "ownerVaultCatalogueRepositoryWithApiFallbackFromEnvironment(",
    );
    expect(page).toContain("now.toISOString()");
    expect(page).not.toContain(
      "neonOwnerVaultCatalogueRepositoryFromEnvironment(",
    );
  });

  it(
    "restricts candidate evidence to API-owned Cores without inventing Maiden status",
    async () => {
    const listCoresByOwner = vi.fn(async () => [
      {
        sourceCoreId: "10457",
        displayName: "Accepted API Core",
        coreClass: "Genesis" as const,
        element: "Earth" as const,
        fNumber: 5,
        sex: "female" as const,
        inMyVault: true,
        meEligible: null,
        version: null,
        updatedAt: "2026-09-22T06:19:45.520Z",
        source: "accepted_owner_api_snapshot" as const,
      },
    ]);
    const repository = createDiscoveryProbeRepository({
      vaultRepository: { status: "ready", listCoresByOwner },
      performanceRepository: {
        status: "ready",
        listProfilesByOwner: async () => ({
          profiles: [
            {
              coreId: "10457",
              mode: "bike",
              distance: 1_400,
              raceCount: 4,
              elapsedTime: {
                bestMilliseconds: 80_000,
                medianMilliseconds: 82_000,
                meanMilliseconds: 83_000,
                standardDeviationMilliseconds: 1_000,
              },
              starProfile: null,
              freshness: "stale",
              dataCurrentThrough: "2026-09-16T10:12:20.407Z",
            } as never,
          ],
          lastImportedAt: "2026-09-22T06:19:45.520Z",
        }),
      },
      lineageRepository: {
        status: "ready",
        listHypothesesByOwner: async () =>
          ["10457", "unowned-core"].map((coreId) => ({
            coreId,
            coreName: coreId,
            meEligible: false,
            mode: "bike" as const,
            distanceMetres: 1_600,
            lineageRelationship: "parent" as const,
            lineageRaceCount: 12,
            dataCurrentThrough: "2026-09-16T10:12:20.407Z",
            lastImportedAt: "2026-09-22T06:19:45.520Z",
          })),
      },
      benchmarkRepository: {
        status: "ready",
        listBenchmarksByOwner: async () => ({
          benchmarks: [],
          publication: null,
        }),
      },
      tournamentRepository: { status: "not_configured" },
    });

    expect(repository.status).toBe("ready");
    if (repository.status !== "ready") throw new Error("Discovery not ready");
    const result = await repository.listCandidateEvidenceByOwner("owner");

    expect(listCoresByOwner).toHaveBeenCalledWith("owner", {
      scope: "vault",
      query: null,
      element: null,
      coreClass: null,
      sex: null,
      fNumber: null,
    });
    expect(result.candidates).toContainEqual(
      expect.objectContaining({
        coreId: "10457",
        directRaceCount: 4,
        maidenState: "unknown",
      }),
    );
    expect(result.candidates.length).toBeGreaterThan(0);
    expect(result.candidates.every(({ coreId }) => coreId === "10457")).toBe(
      true,
    );
    expect(
      result.candidates.every(({ maidenState }) => maidenState === "unknown"),
    ).toBe(true);
  },
  );
});
