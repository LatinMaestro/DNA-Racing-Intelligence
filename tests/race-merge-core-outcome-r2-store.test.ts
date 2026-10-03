import { describe, expect, it, vi } from "vitest";

import {
  createRaceMergeCoreOutcomeR2Store,
  type RaceMergeCoreOutcomeR2StoragePort,
} from "../lib/race-merge-core-outcome-r2-store";

function observation(
  sourceCoreId: number,
  sourceRaceId: string,
  finishPosition: number,
  elapsedMilliseconds: number,
  sourceObjectSha256: string,
  sourceRowNumber: number,
) {
  return Object.freeze({
    source: "race_merge" as const,
    sourceCoreId,
    sourceRaceId,
    finishPosition,
    elapsedMilliseconds,
    sourceObjectSha256,
    sourceRowNumber,
  });
}

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let bytes = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    bytes += chunk.byteLength;
  }
  const output = new Uint8Array(bytes);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function storage(existing = false, privateBucket = true) {
  const objects = new Map<
    string,
    {
      body: Uint8Array;
      contentType: string;
      checksumSha256: string;
      metadata: Readonly<Record<string, string>>;
    }
  >();

  const value: RaceMergeCoreOutcomeR2StoragePort = {
    readBucketPrivacy: vi.fn(async () => ({
      publicAccessDisabled: privateBucket,
      r2DevDisabled: true,
      customDomainCount: 0,
    })),
    putObjectIfAbsent: vi.fn(async (input) => {
      if (!objects.has(input.key)) {
        objects.set(input.key, {
          body: await collect(input.body),
          contentType: input.contentType,
          checksumSha256: input.checksumSha256,
          metadata: input.metadata,
        });
      }
      return {
        status: existing ? ("existing" as const) : ("created" as const),
      };
    }),
    headObject: vi.fn(async ({ key }) => {
      const object = objects.get(key);
      return object === undefined
        ? { status: "missing" as const }
        : {
            status: "ready" as const,
            contentType: object.contentType,
            byteLength: object.body.byteLength,
            checksumSha256: object.checksumSha256,
            metadata: object.metadata,
          };
    }),
    getObject: vi.fn(async ({ key }) => {
      const object = objects.get(key);
      return object === undefined
        ? { status: "missing" as const }
        : {
            status: "ready" as const,
            body: (async function* () {
              yield object.body;
            })(),
          };
    }),
  };

  return { value, objects };
}

describe("Race Merge Core outcome R2 store", () => {
  it("writes one sorted immutable Core object while preserving exact replay provenance", async () => {
    const target = storage();
    const store = createRaceMergeCoreOutcomeR2Store({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });
    const sourceA = "a".repeat(64);
    const sourceB = "b".repeat(64);

    const write = await store.write({
      generationId: "generation-1",
      sourceCoreId: 101,
      observations: [
        observation(101, "race-2", 1, 9_500, sourceB, 4),
        observation(101, "race-1", 2, 12_345, sourceA, 1),
        observation(101, "race-1", 2, 12_345, sourceB, 3),
      ],
    });

    expect(write.storageStatus).toBe("created");
    expect(write.receipt).toMatchObject({
      version: 1,
      generationId: "generation-1",
      sourceCoreId: 101,
      uniqueOutcomeCount: 2,
      sourceObservationCount: 3,
      firstSourceRaceId: "race-1",
      lastSourceRaceId: "race-2",
    });
    expect(write.receipt.objectKey).toContain(
      "/race-merge-core-outcomes/generations/generation-1/cores/",
    );
    expect(write.receipt.bodySha256).toMatch(/^[a-f0-9]{64}$/u);

    await expect(store.read(write.receipt)).resolves.toEqual([
      {
        source: "race_merge",
        sourceCoreId: 101,
        sourceRaceId: "race-1",
        finishPosition: 2,
        elapsedMilliseconds: 12_345,
      },
      {
        source: "race_merge",
        sourceCoreId: 101,
        sourceRaceId: "race-2",
        finishPosition: 1,
        elapsedMilliseconds: 9_500,
      },
    ]);
  });

  it("rejects conflicting Race/Core evidence before writing R2", async () => {
    const target = storage();
    const store = createRaceMergeCoreOutcomeR2Store({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });

    await expect(
      store.write({
        generationId: "generation-1",
        sourceCoreId: 101,
        observations: [
          observation(101, "race-1", 1, 9_500, "a".repeat(64), 1),
          observation(101, "race-1", 2, 9_500, "b".repeat(64), 2),
        ],
      }),
    ).rejects.toThrow("Race/Core outcome conflict");
    expect(target.objects.size).toBe(0);
  });

  it("rejects observations that change the requested Core identity", async () => {
    const target = storage();
    const store = createRaceMergeCoreOutcomeR2Store({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });

    await expect(
      store.write({
        generationId: "generation-1",
        sourceCoreId: 101,
        observations: [observation(202, "race-1", 1, 9_500, "a".repeat(64), 1)],
      }),
    ).rejects.toThrow("source Core identity changed");
  });

  it("accepts an immutable replay only when the verified object head agrees", async () => {
    const target = storage(true);
    const store = createRaceMergeCoreOutcomeR2Store({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });

    await expect(
      store.write({
        generationId: "generation-1",
        sourceCoreId: 101,
        observations: [observation(101, "race-1", 1, 9_500, "a".repeat(64), 1)],
      }),
    ).resolves.toMatchObject({ storageStatus: "existing" });
  });

  it("fails closed when the bucket is not private", async () => {
    const target = storage(false, false);
    const store = createRaceMergeCoreOutcomeR2Store({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });

    await expect(
      store.write({
        generationId: "generation-1",
        sourceCoreId: 101,
        observations: [observation(101, "race-1", 1, 9_500, "a".repeat(64), 1)],
      }),
    ).rejects.toThrow("R2 bucket is not private");
    expect(target.objects.size).toBe(0);
  });
});
