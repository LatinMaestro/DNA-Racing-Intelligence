import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationRaceIndexR2ChunkStore,
  fitDnaPopulationRaceIndexR2ChunkDocuments,
} from "../lib/dna-population-race-index-r2-chunk";

function document(sourceRaceId: string, rawEvidenceSha256 = "a".repeat(64)) {
  return Object.freeze({
    requestOrdinal: 1,
    endpoint: "races.finished" as const,
    observedAt: "2026-09-02T00:00:00.000Z",
    sourceRaceId,
    rawEvidenceSha256,
    canonical: Object.freeze({
      sourceType: "race_document" as const,
      sourceRaceId,
      mode: "bike" as const,
    }),
  });
}

function storage(status: "created" | "existing" = "created") {
  let head:
    | {
        contentType: string;
        byteLength: number;
        checksumSha256: string;
        metadata: Readonly<Record<string, string>>;
      }
    | undefined;
  const putObjectIfAbsent = vi.fn(async (input) => {
    head = {
      contentType: input.contentType,
      byteLength: input.byteLength,
      checksumSha256: input.checksumSha256,
      metadata: input.metadata,
    };
    return { status };
  });
  const headObject = vi.fn(async () =>
    head === undefined
      ? { status: "missing" as const }
      : { status: "ready" as const, ...head },
  );
  const getObject = vi.fn(async () => ({ status: "missing" as const }));
  return {
    putObjectIfAbsent,
    headObject,
    value: {
      readBucketPrivacy: vi.fn(async () => ({
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      })),
      putObjectIfAbsent,
      headObject,
      getObject,
    },
  };
}

describe("DNA population race index R2 chunk store", () => {
  it("writes one deterministic sorted immutable chunk and verifies its head", async () => {
    const target = storage();
    const store = createDnaPopulationRaceIndexR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });
    const result = await store.write({
      generationId: "b".repeat(64),
      chunkOrdinal: 1,
      documents: [document("race-2"), document("race-1")],
    });

    expect(result.storageStatus).toBe("created");
    expect(result.receipt).toMatchObject({
      version: 1,
      generationId: "b".repeat(64),
      chunkOrdinal: 1,
      rowCount: 2,
      firstSourceRaceId: "race-1",
      lastSourceRaceId: "race-2",
    });
    expect(result.receipt.objectKey).toContain(
      "/population-race-index/generations/",
    );
    expect(result.receipt.bodySha256).toMatch(/^[a-f0-9]{64}$/u);
    expect(target.putObjectIfAbsent).toHaveBeenCalledOnce();
    expect(target.headObject).toHaveBeenCalledOnce();
  });

  it("rejects duplicate race identities instead of storing a second canonical row", async () => {
    const target = storage();
    const store = createDnaPopulationRaceIndexR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });
    await expect(
      store.write({
        generationId: "b".repeat(64),
        chunkOrdinal: 1,
        documents: [document("race-1"), document("race-1")],
      }),
    ).rejects.toThrow("duplicate race identity");
    expect(target.putObjectIfAbsent).not.toHaveBeenCalled();
  });

  it("accepts an exact create-only replay only when the immutable head matches", async () => {
    const target = storage("existing");
    const store = createDnaPopulationRaceIndexR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.value,
    });
    await expect(
      store.write({
        generationId: "b".repeat(64),
        chunkOrdinal: 3,
        documents: [document("race-3")],
      }),
    ).resolves.toMatchObject({ storageStatus: "existing" });
  });

  it("fits the largest ordered prefix below the immutable byte ceiling", () => {
    const large = (sourceRaceId: string) =>
      Object.freeze({
        ...document(sourceRaceId),
        canonical: Object.freeze({
          sourceType: "race_document" as const,
          sourceRaceId,
          mode: "bike" as const,
          payload: "x".repeat(3_000_000),
        }),
      });

    const fitted = fitDnaPopulationRaceIndexR2ChunkDocuments({
      generationId: "b".repeat(64),
      chunkOrdinal: 1,
      documents: [large("race-3"), large("race-1"), large("race-2")],
    });

    expect(fitted.map((entry) => entry.sourceRaceId)).toEqual([
      "race-1",
      "race-2",
    ]);
  });
});
