import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type {
  DnaFinishedRaceWindowPublication,
  DnaFinishedRaceWindowPublicationReceipt,
} from "../lib/dna-open-lab-finished-race-backfill";
import {
  createDnaOpenLabR2FinishedRaceWindowPublisher,
  createDnaOpenLabR2RaceDocumentClient,
  type DnaOpenLabR2RaceEvidenceStoragePort,
} from "../lib/dna-open-lab-r2-race-evidence";
import {
  adaptDnaRaceDocument,
  dnaOpenLabRawEvidenceSha256,
} from "../lib/dna-open-lab-v1-adapters";
import type {
  DnaOpenLabClient,
  DnaOpenLabResponse,
  DnaRaceDocument,
} from "../lib/dna-open-lab-v1-client";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryR2Storage implements DnaOpenLabR2RaceEvidenceStoragePort {
  readonly objects = new Map<string, StoredObject>();
  privacyReadCount = 0;
  putCount = 0;
  privacy = {
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  };

  async readBucketPrivacy() {
    this.privacyReadCount += 1;
    return this.privacy;
  }

  async putObjectIfAbsent(input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }) {
    this.putCount += 1;
    if (this.objects.has(input.key)) {
      return Object.freeze({ status: "existing" as const });
    }
    const body = new Uint8Array(input.byteLength);
    let offset = 0;
    for await (const chunk of input.body) {
      body.set(chunk, offset);
      offset += chunk.byteLength;
    }
    if (offset !== input.byteLength) throw new Error("synthetic body mismatch");
    const checksumSha256 = createHash("sha256").update(body).digest("hex");
    if (checksumSha256 !== input.checksumSha256) {
      throw new Error("synthetic checksum mismatch");
    }
    this.objects.set(
      input.key,
      Object.freeze({
        body,
        contentType: input.contentType,
        checksumSha256,
        metadata: input.metadata,
      }),
    );
    return Object.freeze({ status: "created" as const });
  }

  async headObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    if (stored === undefined) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({
      status: "ready" as const,
      contentType: stored.contentType,
      byteLength: stored.body.byteLength,
      checksumSha256: stored.checksumSha256,
      metadata: stored.metadata,
    });
  }
}

function response<T>(result: T): DnaOpenLabResponse<T> {
  return Object.freeze({
    result,
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 30,
      rateClass: "api_key",
      retryAfterSeconds: null,
    }),
  });
}

function sourceClient(
  documents: readonly DnaRaceDocument[],
): Pick<DnaOpenLabClient, "raceDocs"> {
  return Object.freeze({
    raceDocs: async () => response(documents),
  });
}

function publication(
  documents: readonly DnaRaceDocument[],
): DnaFinishedRaceWindowPublication {
  const hydratedDocuments = documents.map((raw) =>
    adaptDnaRaceDocument({
      raw,
      observedAt: "2026-08-27T10:00:00Z",
      endpoint: "races.docs",
    }),
  );
  return Object.freeze({
    windowKey: "1".repeat(64),
    contentSha256: "2".repeat(64),
    window: Object.freeze({
      startTime: "2026-08-01T00:00:00.000Z",
      endTime: "2026-08-01T00:10:00.000Z",
    }),
    discoveredRaces: documents.map(({ rid }) => ({ rid })),
    hydratedDocuments: Object.freeze(hydratedDocuments),
  });
}

function configuration(storage: MemoryR2Storage) {
  return {
    ownerId: "owner-vault@example.test",
    bucketName: "dna-racing-import-preview",
    storage,
  } as const;
}

describe("DNA Open Lab private R2 Race evidence", () => {
  it("archives every full race document before returning the DNA response", async () => {
    const storage = new MemoryR2Storage();
    const documents = [
      { rid: 42, result: { place: 1 }, z: 1, a: 2 },
      { rid: 43, result: { place: 2 } },
    ] satisfies readonly DnaRaceDocument[];
    const client = createDnaOpenLabR2RaceDocumentClient({
      client: sourceClient(documents),
      configuration: configuration(storage),
    });

    const first = await client.raceDocs([42, 43]);
    const second = await client.raceDocs([42, 43]);

    expect(first.result).toEqual(documents);
    expect(second.result).toEqual(documents);
    expect(storage.objects.size).toBe(2);
    expect(storage.privacyReadCount).toBe(1);
    expect(storage.putCount).toBe(4);
    for (const document of documents) {
      const rawSha = dnaOpenLabRawEvidenceSha256(document);
      const stored = [...storage.objects.entries()].find(([key]) =>
        key.endsWith(`/${rawSha}.json`),
      );
      expect(stored).toBeDefined();
      expect(stored?.[1].checksumSha256).toBe(rawSha);
      expect(stored?.[1].metadata["dna-endpoint"]).toBe("races.docs");
      expect(stored?.[1].metadata["dna-raw-sha256"]).toBe(rawSha);
    }
  });

  it("publishes a window manifest only after all referenced full race docs exist", async () => {
    const storage = new MemoryR2Storage();
    const documents = [
      { rid: 7, full: { position: 1 } },
      { rid: 8, full: { position: 2 } },
    ] satisfies readonly DnaRaceDocument[];
    const client = createDnaOpenLabR2RaceDocumentClient({
      client: sourceClient(documents),
      configuration: configuration(storage),
    });
    await client.raceDocs([7, 8]);
    const publish = createDnaOpenLabR2FinishedRaceWindowPublisher(
      configuration(storage),
    );

    const expected = publication(documents);
    const receipt: DnaFinishedRaceWindowPublicationReceipt =
      await publish(expected);
    const replay = await publish(expected);
    const manifest = [...storage.objects.entries()].find(([key]) =>
      key.endsWith(`/finished-windows/${expected.windowKey}.json`),
    );

    expect(receipt).toEqual({
      windowKey: expected.windowKey,
      contentSha256: expected.contentSha256,
      documentCount: 2,
      manifestObjectKey: expect.stringMatching(
        new RegExp(`/finished-windows/${expected.windowKey}\\.json$`, "u"),
      ),
      manifestBodySha256: manifest?.[1].checksumSha256,
      manifestByteLength: manifest?.[1].body.byteLength,
    });
    expect(replay).toEqual(receipt);
    expect(storage.objects.size).toBe(3);
    expect(manifest).toBeDefined();
    expect(manifest?.[1].metadata["dna-content-sha256"]).toBe(
      expected.contentSha256,
    );
    expect(manifest?.[1].metadata["dna-document-count"]).toBe("2");
  });

  it("fails closed when a window references a full race doc that was not archived", async () => {
    const storage = new MemoryR2Storage();
    const publish = createDnaOpenLabR2FinishedRaceWindowPublisher(
      configuration(storage),
    );

    await expect(publish(publication([{ rid: 99 }]))).rejects.toThrow(
      "full Race document 99 is not archived",
    );
    expect(storage.objects.size).toBe(0);
  });

  it("fails closed when an existing full race archive has inconsistent metadata", async () => {
    const storage = new MemoryR2Storage();
    const documents = [
      { rid: 77, payload: "correct" },
    ] satisfies readonly DnaRaceDocument[];
    const client = createDnaOpenLabR2RaceDocumentClient({
      client: sourceClient(documents),
      configuration: configuration(storage),
    });
    await client.raceDocs([77]);
    const [key, existing] = [...storage.objects.entries()][0] ?? [];
    if (key === undefined || existing === undefined) {
      throw new Error("synthetic archive missing");
    }
    storage.objects.set(
      key,
      Object.freeze({
        ...existing,
        metadata: Object.freeze({
          ...existing.metadata,
          "dna-raw-sha256": "0".repeat(64),
        }),
      }),
    );
    const publish = createDnaOpenLabR2FinishedRaceWindowPublisher(
      configuration(storage),
    );

    await expect(publish(publication(documents))).rejects.toThrow(
      "archive is inconsistent",
    );
  });

  it("never publishes evidence to a bucket with public exposure", async () => {
    const storage = new MemoryR2Storage();
    storage.privacy = {
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    };
    const client = createDnaOpenLabR2RaceDocumentClient({
      client: sourceClient([{ rid: 1 }]),
      configuration: configuration(storage),
    });

    await expect(client.raceDocs([1])).rejects.toThrow(
      "evidence bucket is not private",
    );
    expect(storage.putCount).toBe(0);
  });

  it("fails before storage when a single evidence object exceeds its configured bound", async () => {
    const storage = new MemoryR2Storage();
    const client = createDnaOpenLabR2RaceDocumentClient({
      client: sourceClient([{ rid: 1, payload: "x".repeat(512) }]),
      configuration: {
        ...configuration(storage),
        maximumObjectBytes: 64,
      },
    });

    await expect(client.raceDocs([1])).rejects.toThrow(
      "evidence object exceeds its bounded byte capacity",
    );
    expect(storage.objects.size).toBe(0);
  });
});
