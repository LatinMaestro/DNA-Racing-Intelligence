import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import type { DnaPopulationEntrantAuthorityRecord } from "@/lib/dna-population-entrant-authority-record";
import {
  createDnaPopulationEntrantAuthorityR2ChunkStore,
  type DnaPopulationEntrantAuthorityR2StoragePort,
} from "@/lib/dna-population-entrant-authority-r2-store";

function record(
  raceId: string,
  mode: "bike" | "car" | "horse" = "bike",
): DnaPopulationEntrantAuthorityRecord {
  return Object.freeze({
    sourceRaceId: raceId,
    observedAt: "2026-09-25T00:00:00.000Z",
    rawEvidenceSha256: createHash("sha256").update(raceId).digest("hex"),
    mode,
    entrantCoreIds: Object.freeze(["101", "202"]),
  });
}

function oneChunk(body: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield body;
  })();
}

function storage(input?: {
  status?: "created" | "existing";
  privateBucket?: boolean;
  conflictingHead?: boolean;
  ambiguousPending?: boolean;
  truncatedPending?: boolean;
  escapedPending?: boolean;
}) {
  let storedBody: Uint8Array | null = null;
  let storedKey: string | null = null;
  let head: Readonly<{
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }> | null = null;

  const putObjectIfAbsent = vi.fn(async (request) => {
    const parts: Uint8Array[] = [];
    for await (const part of request.body) {
      parts.push(part);
    }
    storedBody = Uint8Array.from(parts.flatMap((part) => Array.from(part)));
    storedKey = request.key;
    head = Object.freeze({
      contentType: request.contentType,
      byteLength: request.byteLength,
      checksumSha256: input?.conflictingHead
        ? "f".repeat(64)
        : request.checksumSha256,
      metadata: request.metadata,
    });
    return Object.freeze({ status: input?.status ?? ("created" as const) });
  });
  const headObject = vi.fn(async () =>
    head === null
      ? Object.freeze({ status: "missing" as const })
      : Object.freeze({ status: "ready" as const, ...head }),
  );
  const getObject = vi.fn(async () =>
    storedBody === null
      ? Object.freeze({ status: "missing" as const })
      : Object.freeze({
          status: "ready" as const,
          body: oneChunk(storedBody),
        }),
  );
  const listObjects = vi.fn(async (request) => {
    const objects: { key: string }[] = [];
    if (storedKey !== null && storedKey.startsWith(request.prefix)) {
      objects.push({
        key: input?.escapedPending ? "escaped/private.json" : storedKey,
      });
      if (input?.ambiguousPending) {
        objects.push({
          key: `${request.prefix}${"f".repeat(64)}.json`,
        });
      }
    }
    return Object.freeze({
      objects: Object.freeze(objects),
      truncated: input?.truncatedPending === true,
    });
  });
  const port: DnaPopulationEntrantAuthorityR2StoragePort = {
    readBucketPrivacy: vi.fn(async () =>
      Object.freeze({
        publicAccessDisabled: input?.privateBucket !== false,
        r2DevDisabled: true,
        customDomainCount: 0,
      }),
    ),
    putObjectIfAbsent,
    headObject,
    getObject,
    listObjects,
  };

  return {
    port,
    putObjectIfAbsent,
    headObject,
    getObject,
    listObjects,
    corruptBody() {
      if (storedBody === null) throw new Error("body is unavailable");
      const corrupted = new Uint8Array(storedBody);
      corrupted[0] = (corrupted[0] ?? 0) ^ 1;
      storedBody = corrupted;
    },
    corruptMetadata() {
      if (head === null) throw new Error("head is unavailable");
      head = Object.freeze({
        ...head,
        metadata: Object.freeze({
          ...head.metadata,
          "dna-record-set": "0".repeat(64),
        }),
      });
    },
  };
}

describe("population entrant authority R2 chunk store", () => {
  it("stores and re-opens one deterministic private immutable chunk", async () => {
    const target = storage();
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });

    const written = await store.write({
      generationId: "a".repeat(64),
      chunkOrdinal: 1,
      records: [record("2", "car"), record("1")],
    });

    expect(written.storageStatus).toBe("created");
    expect(written.receipt).toMatchObject({
      version: 1,
      generationId: "a".repeat(64),
      chunkOrdinal: 1,
      rowCount: 2,
      firstSourceRaceId: "1",
      lastSourceRaceId: "2",
    });
    expect(written.receipt.objectKey).toContain(
      "/population-entrant-authority/generations/",
    );
    expect(written.receipt.objectKey).not.toContain("private-owner");
    expect(target.putObjectIfAbsent).toHaveBeenCalledOnce();

    const reopened = await store.read(written.receipt);
    expect(reopened.receipt).toEqual(
      Object.fromEntries(
        Object.entries(written.receipt).filter(([key]) => key !== "objectKey"),
      ),
    );
    expect(reopened.records.map((entry) => entry.sourceRaceId)).toEqual([
      "1",
      "2",
    ]);
    expect(target.getObject).toHaveBeenCalledOnce();
  });

  it("discovers and fully re-opens one unmanifested content-addressed chunk by ordinal", async () => {
    const target = storage();
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });
    const written = await store.write({
      generationId: "b".repeat(64),
      chunkOrdinal: 7,
      records: [record("7"), record("8", "horse")],
    });

    const pending = await store.findPending({
      generationId: "b".repeat(64),
      chunkOrdinal: 7,
    });

    expect(pending?.receipt).toEqual(written.receipt);
    expect(pending?.chunk.records.map((entry) => entry.sourceRaceId)).toEqual([
      "7",
      "8",
    ]);
    expect(target.listObjects).toHaveBeenCalledOnce();
    expect(target.listObjects).toHaveBeenCalledWith({
      bucketName: "private-preview",
      prefix: expect.stringContaining(
        "/population-entrant-authority/generations/",
      ),
      limit: 2,
    });
    const prefix = target.listObjects.mock.calls[0]?.[0].prefix;
    expect(prefix).not.toContain("private-owner");
  });

  it("returns null when the exact next chunk ordinal has no R2 residue", async () => {
    const target = storage();
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });

    await expect(
      store.findPending({
        generationId: "c".repeat(64),
        chunkOrdinal: 1,
      }),
    ).resolves.toBeNull();
    expect(target.headObject).not.toHaveBeenCalled();
    expect(target.getObject).not.toHaveBeenCalled();
  });

  it("fails closed when pending discovery is ambiguous or truncated", async () => {
    for (const target of [
      storage({ ambiguousPending: true }),
      storage({ truncatedPending: true }),
    ]) {
      const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
        ownerId: "private-owner",
        bucketName: "private-preview",
        storage: target.port,
      });
      await store.write({
        generationId: "d".repeat(64),
        chunkOrdinal: 2,
        records: [record("2")],
      });

      await expect(
        store.findPending({
          generationId: "d".repeat(64),
          chunkOrdinal: 2,
        }),
      ).rejects.toThrow("pending chunk discovery is ambiguous");
    }
  });

  it("fails closed when a listed pending object escapes the deterministic prefix", async () => {
    const target = storage({ escapedPending: true });
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });
    await store.write({
      generationId: "e".repeat(64),
      chunkOrdinal: 3,
      records: [record("3")],
    });

    await expect(
      store.findPending({
        generationId: "e".repeat(64),
        chunkOrdinal: 3,
      }),
    ).rejects.toThrow("pending chunk escaped its deterministic prefix");
  });

  it("rejects pending recovery when immutable metadata or body integrity drifts", async () => {
    const metadataTarget = storage();
    const metadataStore = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: metadataTarget.port,
    });
    await metadataStore.write({
      generationId: "f".repeat(64),
      chunkOrdinal: 4,
      records: [record("4")],
    });
    metadataTarget.corruptMetadata();

    await expect(
      metadataStore.findPending({
        generationId: "f".repeat(64),
        chunkOrdinal: 4,
      }),
    ).rejects.toThrow("stored chunk head conflicts with its receipt");

    const bodyTarget = storage();
    const bodyStore = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: bodyTarget.port,
    });
    await bodyStore.write({
      generationId: "1".repeat(64),
      chunkOrdinal: 5,
      records: [record("5")],
    });
    bodyTarget.corruptBody();

    await expect(
      bodyStore.findPending({
        generationId: "1".repeat(64),
        chunkOrdinal: 5,
      }),
    ).rejects.toThrow("stored chunk body checksum disagrees");
  });

  it("accepts exact create-only replay when the immutable head agrees", async () => {
    const target = storage({ status: "existing" });
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });

    await expect(
      store.write({
        generationId: "2".repeat(64),
        chunkOrdinal: 3,
        records: [record("3")],
      }),
    ).resolves.toMatchObject({ storageStatus: "existing" });
  });

  it("rejects create-only replay when an existing immutable object conflicts", async () => {
    const target = storage({ status: "existing", conflictingHead: true });
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });

    await expect(
      store.write({
        generationId: "3".repeat(64),
        chunkOrdinal: 4,
        records: [record("4")],
      }),
    ).rejects.toThrow("stored chunk head conflicts with its receipt");
  });

  it("rejects object-key drift before reading another R2 object", async () => {
    const target = storage();
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });
    const written = await store.write({
      generationId: "4".repeat(64),
      chunkOrdinal: 1,
      records: [record("1")],
    });
    const headCallsAfterWrite = target.headObject.mock.calls.length;

    await expect(
      store.read({
        ...written.receipt,
        objectKey: `${written.receipt.objectKey}-drift`,
      }),
    ).rejects.toThrow("object key conflicts with its deterministic identity");
    expect(target.headObject).toHaveBeenCalledTimes(headCallsAfterWrite);
    expect(target.getObject).not.toHaveBeenCalled();
  });

  it("rejects a non-private bucket before any chunk write or discovery", async () => {
    const target = storage({ privateBucket: false });
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });

    await expect(
      store.write({
        generationId: "5".repeat(64),
        chunkOrdinal: 1,
        records: [record("1")],
      }),
    ).rejects.toThrow("R2 bucket is not private");
    await expect(
      store.findPending({
        generationId: "5".repeat(64),
        chunkOrdinal: 1,
      }),
    ).rejects.toThrow("R2 bucket is not private");
    expect(target.putObjectIfAbsent).not.toHaveBeenCalled();
    expect(target.listObjects).not.toHaveBeenCalled();
  });

  it("fails closed when a stored body no longer matches its receipt", async () => {
    const target = storage();
    const store = createDnaPopulationEntrantAuthorityR2ChunkStore({
      ownerId: "private-owner",
      bucketName: "private-preview",
      storage: target.port,
    });
    const written = await store.write({
      generationId: "6".repeat(64),
      chunkOrdinal: 1,
      records: [record("1")],
    });
    target.corruptBody();

    await expect(store.read(written.receipt)).rejects.toThrow(
      "stored chunk body checksum disagrees",
    );
  });
});
