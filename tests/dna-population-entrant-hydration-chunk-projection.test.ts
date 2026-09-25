import { describe, expect, it } from "vitest";

import { projectDnaPopulationEntrantHydrationChunkArchive } from "@/lib/dna-population-entrant-hydration-chunk-projection";

describe("population entrant hydration chunk projection", () => {
  it("reduces historical archive operations to bounded chunks without authorizing writes", () => {
    const projection = projectDnaPopulationEntrantHydrationChunkArchive({
      unresolvedRaceCount: 1_135_198,
      unresolvedRaceSetSha256: "a".repeat(64),
      measuredMaximumCanonicalRaceBytes: 5_031,
      verifiedIncrementalMaximumRaceDocumentBytes: 5_000,
      currentR2StorageBytes: 1_500_631_079,
      currentR2ClassAOperations: 100_000,
      currentR2ClassBOperations: 100_000,
      currentNeonStorageBytes: 408_821_760,
    });

    expect(projection.authority.maximumRaceDocumentBytes).toBe(5_031);
    expect(projection.chunk.projectedChunkCount).toBeLessThan(1_000);
    expect(projection.provider.minimumRaceDocRequestCount).toBe(56_760);
    expect(projection.projected.r2ClassAOperations).toBeLessThan(2_000);
    expect(projection.projected.r2ClassBOperations).toBeLessThan(4_000);
    expect(projection.persistentWriteAllowed).toBe(false);
    expect(projection.paidUsageAllowed).toBe(false);
  });

  it("uses the larger durable size authority and holds when storage would exceed zero-cost capacity", () => {
    const projection = projectDnaPopulationEntrantHydrationChunkArchive({
      unresolvedRaceCount: 1_135_198,
      unresolvedRaceSetSha256: "b".repeat(64),
      measuredMaximumCanonicalRaceBytes: 5_031,
      verifiedIncrementalMaximumRaceDocumentBytes: 7_000,
      currentR2StorageBytes: 1_500_631_079,
      currentR2ClassAOperations: 100_000,
      currentR2ClassBOperations: 100_000,
      currentNeonStorageBytes: 408_821_760,
    });

    expect(projection.authority.maximumRaceDocumentBytes).toBe(7_000);
    expect(projection.allowed).toBe(false);
    expect(projection.blockerIds).toContain("r2_storage_budget_exhausted");
  });

  it("rejects malformed authority before projection", () => {
    expect(() =>
      projectDnaPopulationEntrantHydrationChunkArchive({
        unresolvedRaceCount: 1,
        unresolvedRaceSetSha256: "not-a-hash",
        measuredMaximumCanonicalRaceBytes: 1,
        verifiedIncrementalMaximumRaceDocumentBytes: 1,
        currentR2StorageBytes: 0,
        currentR2ClassAOperations: 0,
        currentR2ClassBOperations: 0,
        currentNeonStorageBytes: 0,
      }),
    ).toThrow("unresolved Race set SHA-256 is invalid");
  });
});
