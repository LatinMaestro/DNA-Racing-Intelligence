import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationEntrantAuthorityCheckpoint,
  DnaPopulationEntrantAuthorityCheckpointAuthority,
  DnaPopulationEntrantAuthorityChunkManifest,
} from "@/lib/dna-population-entrant-authority-checkpoint";
import {
  buildDnaPopulationEntrantAuthorityChunk,
} from "@/lib/dna-population-entrant-authority-archive";
import {
  commitDnaPopulationEntrantAuthorityChunk,
  type DnaPopulationEntrantAuthorityCapacityGate,
  type DnaPopulationEntrantAuthorityR2CommitPort,
} from "@/lib/dna-population-entrant-authority-commit-protocol";
import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";

const generationId = "a".repeat(64);
const authority: DnaPopulationEntrantAuthorityCheckpointAuthority =
  Object.freeze({
    version: 1,
    generationId,
    unresolvedRaceCount: 3,
    unresolvedRaceSetSha256: generationId,
  });

const records: readonly DnaPopulationEntrantAuthorityRecord[] = Object.freeze([
  Object.freeze({
    sourceRaceId: "race-1",
    observedAt: "2026-09-25T06:00:00.000Z",
    rawEvidenceSha256: "b".repeat(64),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["1", "2"]),
  }),
  Object.freeze({
    sourceRaceId: "race-2",
    observedAt: "2026-09-25T06:00:00.000Z",
    rawEvidenceSha256: "c".repeat(64),
    mode: "bike" as const,
    entrantCoreIds: Object.freeze(["3"]),
  }),
]);

function emptyCheckpoint(
  overrides: Partial<DnaPopulationEntrantAuthorityCheckpoint> = {},
): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    ...authority,
    chunkCount: 0,
    persistedRaceCount: 0,
    lastSourceRaceId: null,
    startedAt: "2026-09-25T06:00:00.000Z",
    updatedAt: "2026-09-25T06:00:00.000Z",
    ...overrides,
  });
}

function afterCheckpoint(): DnaPopulationEntrantAuthorityCheckpoint {
  return Object.freeze({
    ...authority,
    chunkCount: 1,
    persistedRaceCount: 2,
    lastSourceRaceId: "race-2",
    startedAt: "2026-09-25T06:00:00.000Z",
    updatedAt: "2026-09-25T06:02:00.000Z",
  });
}

function receipt() {
  return Object.freeze({
    ...buildDnaPopulationEntrantAuthorityChunk({
      generationId,
      chunkOrdinal: 1,
      records,
    }).receipt,
    objectKey:
      "dna-open-lab/v1/private/population-entrant-authority/chunks/1.json",
  });
}

function harness(input?: {
  checkpoint?: DnaPopulationEntrantAuthorityCheckpoint;
  registerChunk?: (
    calls: number,
  ) => Promise<DnaPopulationEntrantAuthorityCheckpoint>;
}) {
  const events: string[] = [];
  let registerCalls = 0;
  let writeCalls = 0;

  const read = vi.fn(async () => {
    events.push("checkpoint-read");
    return input?.checkpoint ?? emptyCheckpoint();
  });
  const listChunkManifests = vi.fn(
    async (): Promise<
      readonly DnaPopulationEntrantAuthorityChunkManifest[]
    > => {
      events.push("manifest-list");
      return Object.freeze([]);
    },
  );
  const registerChunk = vi.fn(async () => {
    events.push("manifest-register");
    registerCalls += 1;
    return input?.registerChunk
      ? input.registerChunk(registerCalls)
      : afterCheckpoint();
  });
  const capacityGate: DnaPopulationEntrantAuthorityCapacityGate = Object.freeze(
    {
      assertFreshCurrentCapacity: vi.fn(async () => {
        events.push("capacity");
        return Object.freeze({
          version: 1 as const,
          generationId,
          unresolvedRaceCount: 3,
          unresolvedRaceSetSha256: generationId,
          observedAt: "2026-09-25T06:01:00.000Z",
          capacityAllowed: true as const,
          paidUsageAllowed: false as const,
        });
      }),
    },
  );
  const r2Store: DnaPopulationEntrantAuthorityR2CommitPort = Object.freeze({
    read: vi.fn(async () => {
      throw new Error("unexpected recovery R2 read");
    }),
    write: vi.fn(async () => {
      writeCalls += 1;
      events.push("r2-write");
      return Object.freeze({
        receipt: receipt(),
        storageStatus:
          writeCalls === 1 ? ("created" as const) : ("existing" as const),
      });
    }),
  });

  return {
    capacityGate,
    checkpointRepository: { read, listChunkManifests, registerChunk },
    events,
    r2Store,
  };
}

describe("DNA population entrant authority commit protocol", () => {
  it("requires recovery and fresh capacity before R2, then registers Neon second", async () => {
    const test = harness();

    const result = await commitDnaPopulationEntrantAuthorityChunk({
      ownerId: "private-owner",
      authority,
      records,
      capacityGate: test.capacityGate,
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
      registeredAt: "2026-09-25T06:02:00.000Z",
    });

    expect(test.events).toEqual([
      "checkpoint-read",
      "capacity",
      "r2-write",
      "manifest-register",
    ]);
    expect(result).toMatchObject({
      storageStatus: "created",
      capacityObservedAt: "2026-09-25T06:01:00.000Z",
      providerRequestPerformed: false,
      persistentWritePerformed: true,
      providerWritePerformed: false,
      paidUsageAllowed: false,
    });
  });

  it("replays an interrupted R2-first commit idempotently before retrying Neon", async () => {
    const test = harness({
      registerChunk: async (calls) => {
        if (calls === 1) throw new Error("synthetic Neon interruption");
        return afterCheckpoint();
      },
    });

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("synthetic Neon interruption");

    const replay = await commitDnaPopulationEntrantAuthorityChunk({
      ownerId: "private-owner",
      authority,
      records,
      capacityGate: test.capacityGate,
      checkpointRepository: test.checkpointRepository,
      r2Store: test.r2Store,
      registeredAt: "2026-09-25T06:02:00.000Z",
    });

    expect(replay.storageStatus).toBe("existing");
    expect(test.events.filter((value) => value === "r2-write")).toHaveLength(2);
    expect(
      test.events.filter((value) => value === "manifest-register"),
    ).toHaveLength(2);
  });

  it("fails closed before R2 when fresh capacity approval drifts", async () => {
    const test = harness();
    vi.mocked(
      test.capacityGate.assertFreshCurrentCapacity,
    ).mockResolvedValueOnce(
      Object.freeze({
        version: 1,
        generationId,
        unresolvedRaceCount: 4,
        unresolvedRaceSetSha256: generationId,
        observedAt: "2026-09-25T06:01:00.000Z",
        capacityAllowed: true,
        paidUsageAllowed: false,
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("capacity approval disagrees with authority");
    expect(test.r2Store.write).not.toHaveBeenCalled();
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });

  it("fails closed before capacity/write when prepared records do not advance recovery", async () => {
    const test = harness({
      checkpoint: emptyCheckpoint({
        chunkCount: 1,
        persistedRaceCount: 1,
        lastSourceRaceId: "race-2",
      }),
    });
    vi.mocked(
      test.checkpointRepository.listChunkManifests,
    ).mockResolvedValueOnce(
      Object.freeze([
        Object.freeze({
          ...receipt(),
          rowCount: 1,
          firstSourceRaceId: "race-2",
          lastSourceRaceId: "race-2",
          registeredAt: "2026-09-25T06:00:00.000Z",
        }),
      ]),
    );
    vi.mocked(test.r2Store.read).mockResolvedValueOnce(
      Object.freeze({
        receipt: {
          ...receipt(),
          rowCount: 1,
          firstSourceRaceId: "race-2",
          lastSourceRaceId: "race-2",
        },
        body: new Uint8Array(500),
        records: Object.freeze([]),
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("does not advance the recovered Race boundary");
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });

  it("fails closed if the R2 receipt does not match the next recovered ordinal", async () => {
    const test = harness();
    vi.mocked(test.r2Store.write).mockResolvedValueOnce(
      Object.freeze({
        receipt: Object.freeze({ ...receipt(), chunkOrdinal: 2 }),
        storageStatus: "created",
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("R2 receipt disagrees with prepared chunk");
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });

  it("fails closed if the R2 receipt does not represent the exact prepared records", async () => {
    const test = harness();
    vi.mocked(test.r2Store.write).mockResolvedValueOnce(
      Object.freeze({
        receipt: Object.freeze({
          ...receipt(),
          bodySha256: "0".repeat(64),
        }),
        storageStatus: "created",
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("R2 receipt disagrees with prepared chunk");
    expect(test.checkpointRepository.registerChunk).not.toHaveBeenCalled();
  });

  it("fails closed if Neon does not advance exactly to the immutable R2 receipt", async () => {
    const test = harness({
      registerChunk: async () =>
        Object.freeze({
          ...afterCheckpoint(),
          persistedRaceCount: 1,
        }),
    });

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority,
        records,
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("checkpoint did not advance exactly");
  });

  it("refuses further persistence when recovered authority is already complete", async () => {
    const completeAuthority = Object.freeze({
      ...authority,
      unresolvedRaceCount: 1,
    });
    const test = harness({
      checkpoint: Object.freeze({
        ...emptyCheckpoint(),
        unresolvedRaceCount: 1,
        chunkCount: 1,
        persistedRaceCount: 1,
        lastSourceRaceId: "race-1",
      }),
    });
    const completedReceipt = Object.freeze({
      ...receipt(),
      rowCount: 1,
      firstSourceRaceId: "race-1",
      lastSourceRaceId: "race-1",
    });
    vi.mocked(
      test.checkpointRepository.listChunkManifests,
    ).mockResolvedValueOnce(
      Object.freeze([
        Object.freeze({
          ...completedReceipt,
          registeredAt: "2026-09-25T06:00:00.000Z",
        }),
      ]),
    );
    vi.mocked(test.r2Store.read).mockResolvedValueOnce(
      Object.freeze({
        receipt: completedReceipt,
        body: new Uint8Array(500),
        records: Object.freeze([]),
      }),
    );

    await expect(
      commitDnaPopulationEntrantAuthorityChunk({
        ownerId: "private-owner",
        authority: completeAuthority,
        records: records.slice(0, 1),
        capacityGate: test.capacityGate,
        checkpointRepository: test.checkpointRepository,
        r2Store: test.r2Store,
        registeredAt: "2026-09-25T06:02:00.000Z",
      }),
    ).rejects.toThrow("already complete");
    expect(test.r2Store.write).not.toHaveBeenCalled();
  });
});
