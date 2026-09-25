import { describe, expect, it } from "vitest";

import { projectDnaPopulationEntrantAuthorityChunkArchive } from "@/lib/dna-population-entrant-authority-chunk-projection";

describe("population entrant authority chunk projection", () => {
  it("fits the conservative compact authority ceiling while remaining persistence-held", () => {
    const projection = projectDnaPopulationEntrantAuthorityChunkArchive({
      unresolvedRaceCount: 1_135_198,
      unresolvedRaceSetSha256: "a".repeat(64),
      measuredMaximumCompactEntrantAuthorityBytes: 257,
      verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 902,
      currentR2StorageBytes: 1_500_631_079,
      currentR2ClassAOperations: 100_000,
      currentR2ClassBOperations: 100_000,
      currentNeonStorageBytes: 408_821_760,
    });

    expect(projection.authority.maximumCompactEntrantAuthorityBytes).toBe(902);
    expect(projection.chunk.projectedRowsPerChunk).toBe(5_000);
    expect(projection.chunk.projectedChunkCount).toBe(228);
    expect(projection.provider.minimumRaceDocRequestCount).toBe(56_760);
    expect(projection.projected.r2StorageBytes).toBe(1_025_317_038);
    expect(projection.projected.r2ClassAOperations).toBe(456);
    expect(projection.projected.r2ClassBOperations).toBe(912);
    expect(projection.projected.neonStorageBytes).toBe(999_424);
    expect(projection.capacityAllowed).toBe(true);
    expect(projection.blockerIds).toEqual([]);
    expect(projection.replayIntegrityStatus).toBe(
      "held_unproven_compact_replay",
    );
    expect(projection.persistentWriteAllowed).toBe(false);
    expect(projection.paidUsageAllowed).toBe(false);
  });

  it("fails capacity closed when current provider usage consumes the headroom", () => {
    const projection = projectDnaPopulationEntrantAuthorityChunkArchive({
      unresolvedRaceCount: 1_135_198,
      unresolvedRaceSetSha256: "b".repeat(64),
      measuredMaximumCompactEntrantAuthorityBytes: 257,
      verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 902,
      currentR2StorageBytes: 7_500_000_000,
      currentR2ClassAOperations: 799_700,
      currentR2ClassBOperations: 100_000,
      currentNeonStorageBytes: 499_500_000,
    });

    expect(projection.capacityAllowed).toBe(false);
    expect(projection.blockerIds).toEqual([
      "r2_storage_budget_exhausted",
      "r2_class_a_budget_exhausted",
      "neon_storage_budget_exhausted",
    ]);
    expect(projection.persistentWriteAllowed).toBe(false);
  });

  it("rejects malformed authority", () => {
    expect(() =>
      projectDnaPopulationEntrantAuthorityChunkArchive({
        unresolvedRaceCount: 1,
        unresolvedRaceSetSha256: "not-a-hash",
        measuredMaximumCompactEntrantAuthorityBytes: 1,
        verifiedIncrementalMaximumCompactEntrantAuthorityBytes: 1,
        currentR2StorageBytes: 0,
        currentR2ClassAOperations: 0,
        currentR2ClassBOperations: 0,
        currentNeonStorageBytes: 0,
      }),
    ).toThrow("unresolved Race set SHA-256 is invalid");
  });
});
