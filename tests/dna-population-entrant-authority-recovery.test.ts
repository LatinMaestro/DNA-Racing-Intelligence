import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import type { DnaPopulationEntrantAuthorityChunk } from "@/lib/dna-population-entrant-authority-archive";
import {
  recoverDnaPopulationEntrantAuthority,
  type DnaPopulationEntrantAuthorityR2RecoveryPort,
} from "@/lib/dna-population-entrant-authority-recovery";

const generationId = "a".repeat(64);
const authority: DnaPopulationEntrantAuthorityCheckpointAuthority =
  Object.freeze({
    version: 1,
    generationId,
    unresolvedRaceCount: 3,
    unresolvedRaceSetSha256: generationId,
  });

function checkpoint(
  overrides: Partial<DnaPopulationEntrantAuthorityCheckpoint> = {},
): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    ...authority,
    chunkCount: 2,
    persistedRaceCount: 3,
    lastSourceRaceId: "race-3",
    startedAt: "2026-09-25T06:00:00.000Z",
    updatedAt: "2026-09-25T06:02:00.000Z",
    ...overrides,
  });
}

function manifest(
  chunkOrdinal: number,
  firstSourceRaceId: string,
  lastSourceRaceId: string,
  rowCount: number,
): DnaPopulationEntrantAuthorityChunkManifest {
  const bodySha256 = String(chunkOrdinal).repeat(64).slice(0, 64);
  const recordSetSha256 = String(chunkOrdinal + 2).repeat(64).slice(0, 64);
  const raceSetSha256 = String(chunkOrdinal + 4).repeat(64).slice(0, 64);
  return Object.freeze({
    version: 1,
    generationId,
    chunkOrdinal,
    objectKey:
      "dna-open-lab/v1/private/population-entrant-authority/" +
      chunkOrdinal +
      ".json",
    bodySha256,
    byteLength: 500 + chunkOrdinal,
    rowCount,
    firstSourceRaceId,
    lastSourceRaceId,
    raceSetSha256,
    recordSetSha256,
    registeredAt: "2026-09-25T06:0" + chunkOrdinal + ":00.000Z",
  });
}

function stored(
  value: DnaPopulationEntrantAuthorityChunkManifest,
): DnaPopulationEntrantAuthorityChunk {
  const { objectKey: _objectKey, registeredAt: _registeredAt, ...receipt } =
    value;
  return Object.freeze({
    receipt,
    body: new Uint8Array(value.byteLength),
    records: Object.freeze([]),
  });
}

function harness(input?: {
  checkpoint?: DnaPopulationEntrantAuthorityCheckpoint;
  manifests?: readonly DnaPopulationEntrantAuthorityChunkManifest[];
  storedOverride?: (
    manifest: DnaPopulationEntrantAuthorityChunkManifest,
  ) => DnaPopulationEntrantAuthorityChunk;
}) {
  const cp = input?.checkpoint ?? checkpoint();
  const manifests =
    input?.manifests ??
    Object.freeze([
      manifest(1, "race-1", "race-2", 2),
      manifest(2, "race-3", "race-3", 1),
    ]);
  const read = vi.fn(async () => cp);
  const listChunkManifests = vi.fn(
    async (
      _ownerId: string,
      request: Readonly<{ afterChunkOrdinal: number; limit: number }>,
    ) =>
      manifests
        .filter((value) => value.chunkOrdinal > request.afterChunkOrdinal)
        .slice(0, request.limit),
  );
  const r2Store: DnaPopulationEntrantAuthorityR2RecoveryPort = Object.freeze({
    read: vi.fn(async (receipt) => {
      const matching = manifests.find(
        (value) => value.chunkOrdinal === receipt.chunkOrdinal,
      );
      if (matching === undefined) {
        throw new Error("missing synthetic manifest");
      }
      return (input?.storedOverride ?? stored)(matching);
    }),
  });
  return { listChunkManifests, r2Store, read };
}

describe("DNA population entrant authority recovery", () => {
  it("reopens every durable chunk before exposing the next deterministic resume point", async () => {
    const test = harness();

    const result = await recoverDnaPopulationEntrantAuthority({
      ownerId: "private-owner",
      authority,
      checkpointRepository: {
        read: test.read,
        listChunkManifests: test.listChunkManifests,
      },
      r2Store: test.r2Store,
    });

    expect(result).toMatchObject({
      recoveredChunkCount: 2,
      recoveredRaceCount: 3,
      nextChunkOrdinal: 3,
      resumeAfterSourceRaceId: "race-3",
      complete: true,
      providerRequestPerformed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(test.r2Store.read).toHaveBeenCalledTimes(2);
  });

  it("pages manifests in bounded deterministic order", async () => {
    const manifests = Object.freeze(
      Array.from({ length: 101 }, (_, index) =>
        manifest(
          index + 1,
          "race-" + String(index + 1).padStart(3, "0"),
          "race-" + String(index + 1).padStart(3, "0"),
          1,
        ),
      ),
    );
    const test = harness({
      checkpoint: checkpoint({
        chunkCount: 101,
        persistedRaceCount: 101,
        unresolvedRaceCount: 101,
        lastSourceRaceId: "race-101",
      }),
      manifests,
    });

    const result = await recoverDnaPopulationEntrantAuthority({
      ownerId: "private-owner",
      authority: {
        ...authority,
        unresolvedRaceCount: 101,
      },
      checkpointRepository: {
        read: test.read,
        listChunkManifests: test.listChunkManifests,
      },
      r2Store: test.r2Store,
    });

    expect(result.recoveredChunkCount).toBe(101);
    expect(test.listChunkManifests).toHaveBeenCalledTimes(2);
    expect(test.listChunkManifests.mock.calls[0]?.[1]).toMatchObject({
      afterChunkOrdinal: 0,
      limit: 100,
    });
    expect(test.listChunkManifests.mock.calls[1]?.[1]).toMatchObject({
      afterChunkOrdinal: 100,
      limit: 100,
    });
  });

  it("fails closed if the checkpoint drifts from the exact audited authority", async () => {
    const test = harness({
      checkpoint: checkpoint({ unresolvedRaceCount: 4 }),
    });

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("checkpoint disagrees with audited authority");
    expect(test.listChunkManifests).not.toHaveBeenCalled();
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("fails closed on a missing manifest page", async () => {
    const test = harness();
    test.listChunkManifests.mockResolvedValueOnce([]);

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("manifest pagination is invalid");
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("fails closed on non-contiguous manifest ordinals", async () => {
    const test = harness({
      manifests: Object.freeze([
        manifest(1, "race-1", "race-1", 1),
        manifest(3, "race-2", "race-3", 2),
      ]),
    });

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("manifest pagination is non-contiguous");
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("fails closed on overlapping Race ranges", async () => {
    const test = harness({
      manifests: Object.freeze([
        manifest(1, "race-1", "race-2", 2),
        manifest(2, "race-2", "race-3", 1),
      ]),
    });

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("manifest Race ranges overlap or are out of order");
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("fails closed if manifest counters disagree with the checkpoint", async () => {
    const test = harness({
      checkpoint: checkpoint({ persistedRaceCount: 2 }),
    });

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("manifest counters disagree with checkpoint");
    expect(test.r2Store.read).not.toHaveBeenCalled();
  });

  it("fails closed if immutable R2 content disagrees with its durable manifest", async () => {
    const test = harness({
      storedOverride: (value) =>
        stored({
          ...value,
          recordSetSha256: "f".repeat(64),
        }),
    });

    await expect(
      recoverDnaPopulationEntrantAuthority({
        ownerId: "private-owner",
        authority,
        checkpointRepository: {
          read: test.read,
          listChunkManifests: test.listChunkManifests,
        },
        r2Store: test.r2Store,
      }),
    ).rejects.toThrow("R2 chunk disagrees with durable manifest");
  });

  it("returns an incomplete resume point without performing any write", async () => {
    const one = manifest(1, "race-1", "race-2", 2);
    const test = harness({
      checkpoint: checkpoint({
        chunkCount: 1,
        persistedRaceCount: 2,
        lastSourceRaceId: "race-2",
      }),
      manifests: Object.freeze([one]),
    });

    const result = await recoverDnaPopulationEntrantAuthority({
      ownerId: "private-owner",
      authority,
      checkpointRepository: {
        read: test.read,
        listChunkManifests: test.listChunkManifests,
      },
      r2Store: test.r2Store,
    });

    expect(result).toMatchObject({
      complete: false,
      recoveredChunkCount: 1,
      recoveredRaceCount: 2,
      nextChunkOrdinal: 2,
      resumeAfterSourceRaceId: "race-2",
      providerRequestPerformed: false,
      persistentWritePerformed: false,
    });
  });
});
