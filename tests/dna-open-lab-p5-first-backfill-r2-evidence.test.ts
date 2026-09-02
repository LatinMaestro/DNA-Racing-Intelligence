import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
  type DnaOpenLabP5FirstBackfillApprovalPacket,
} from "@/lib/dna-open-lab-p5-first-backfill-approval";
import {
  createDnaOpenLabP5FirstBackfillR2EvidenceWriter,
  type DnaOpenLabP5FirstBackfillR2EvidenceStoragePort,
} from "@/lib/dna-open-lab-p5-first-backfill-r2-evidence";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryR2Storage implements DnaOpenLabP5FirstBackfillR2EvidenceStoragePort {
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
    const object = this.objects.get(input.key);
    if (object === undefined) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({
      status: "ready" as const,
      contentType: object.contentType,
      byteLength: object.body.byteLength,
      checksumSha256: object.checksumSha256,
      metadata: object.metadata,
    });
  }
}

function writer(
  storage: MemoryR2Storage,
  approvalPacket: DnaOpenLabP5FirstBackfillApprovalPacket = DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
) {
  return createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
    ownerId: "private-owner@example.test",
    bucketName: "dna-racing-private-preview",
    storage,
    approvalPacket,
  });
}

function observation(
  result: unknown,
  requestOrdinal = 1,
  observedAt = "2026-09-02T03:00:00Z",
) {
  return {
    family: "finished_races" as const,
    requestOrdinal,
    endpoint: "races.finished",
    request: Object.freeze({ page: requestOrdinal, limit: 100 }),
    response: Object.freeze({
      result,
      httpStatus: 200,
      rateLimit: Object.freeze({
        limit: 150,
        remaining: 149,
        resetSeconds: 60,
        rateClass: "api_key" as const,
        retryAfterSeconds: null,
      }),
    }),
    observedAt,
  };
}

describe("DNA Open Lab P5 first-backfill request evidence", () => {
  it("writes one private immutable object for one logical API request", async () => {
    const storage = new MemoryR2Storage();
    const evidence = writer(storage);

    const receipt = await evidence.write(
      observation([{ rid: 1001 }, { rid: 1002 }]),
    );
    const stored = storage.objects.get(receipt.evidenceObjectKey);

    expect(receipt).toMatchObject({
      family: "finished_races",
      requestOrdinal: 1,
      observedAt: "2026-09-02T03:00:00.000Z",
    });
    expect(receipt.evidenceObjectKey).toMatch(
      /\/first-private-preview-backfill\/[a-f0-9]{64}\/requests\/000001\.json$/u,
    );
    expect(receipt.evidenceObjectKey).not.toContain("private-owner");
    expect(receipt.evidenceObjectKey).not.toContain("1001");
    expect(stored?.metadata["dna-endpoint"]).toBe("races.finished");
    expect(stored?.metadata["dna-family"]).toBe("finished_races");
    expect(storage.privacyReadCount).toBe(1);
    expect(evidence.usage()).toEqual({
      logicalRequestCount: 1,
      retainedR2Bytes: receipt.byteLength,
      logicalRequestLimit: 17_453,
      retainedR2BytesLimit: 1_151_071_826,
    });
  });

  it("replays the exact object without double-counting provider usage", async () => {
    const storage = new MemoryR2Storage();
    const evidence = writer(storage);
    const first = await evidence.write(observation([{ rid: 1001 }]));
    const replay = await evidence.write(observation([{ rid: 1001 }]));

    expect(replay).toEqual(first);
    expect(storage.objects.size).toBe(1);
    expect(storage.putCount).toBe(1);
    expect(storage.privacyReadCount).toBe(1);
    expect(evidence.usage().logicalRequestCount).toBe(1);
    expect(evidence.usage().retainedR2Bytes).toBe(first.byteLength);
  });

  it("fails closed if one ordinal is reused for different evidence", async () => {
    const storage = new MemoryR2Storage();
    const evidence = writer(storage);
    await evidence.write(observation([{ rid: 1001 }]));

    await expect(evidence.write(observation([{ rid: 9999 }]))).rejects.toThrow(
      "logical request conflicts with its prior receipt",
    );
    expect(storage.putCount).toBe(1);
  });

  it("fails closed when immutable R2 already contains conflicting bytes", async () => {
    const storage = new MemoryR2Storage();
    const firstWriter = writer(storage);
    const receipt = await firstWriter.write(observation([{ rid: 1001 }]));
    const existing = storage.objects.get(receipt.evidenceObjectKey);
    if (existing === undefined) throw new Error("synthetic object missing");
    storage.objects.set(
      receipt.evidenceObjectKey,
      Object.freeze({
        ...existing,
        checksumSha256: "f".repeat(64),
      }),
    );

    await expect(
      writer(storage).write(observation([{ rid: 1001 }])),
    ).rejects.toThrow("conflicts with immutable publication");
    expect(storage.putCount).toBe(1);
  });

  it("requires a private bucket and the exact bounded Preview approval", async () => {
    const storage = new MemoryR2Storage();
    storage.privacy = {
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    };
    await expect(writer(storage).write(observation([]))).rejects.toThrow(
      "evidence bucket is not private",
    );

    expect(() =>
      writer(
        new MemoryR2Storage(),
        Object.freeze({
          ...DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
          status: "ready_for_owner_decision",
          ownerApprovalRecorded: false,
          firstPersistentPrivatePreviewBackfillAllowed: false,
        }),
      ),
    ).toThrow("bounded private Preview approval is unavailable");
  });

  it("enforces the measured logical-request and envelope limits", async () => {
    const storage = new MemoryR2Storage();
    const evidence = writer(storage);

    await expect(evidence.write(observation([], 17_454))).rejects.toThrow(
      "exceeds the measured request bound",
    );
    await expect(
      evidence.write({
        ...observation([], 1),
        request: { padding: "x".repeat(16_385) },
      }),
    ).rejects.toThrow("envelope exceeds the measured allowance");
    expect(storage.putCount).toBe(0);
  });

  it("rehydrates bounded usage from exact durable receipts", async () => {
    const storage = new MemoryR2Storage();
    const firstWriter = writer(storage);
    const receipt = await firstWriter.write(observation([{ rid: 1001 }]));
    const resumed = createDnaOpenLabP5FirstBackfillR2EvidenceWriter({
      ownerId: "private-owner@example.test",
      bucketName: "dna-racing-private-preview",
      storage,
      approvalPacket: DNA_OPEN_LAB_CURRENT_P5_FIRST_BACKFILL_APPROVAL_PACKET,
      priorReceipts: [receipt],
    });

    expect(resumed.usage()).toMatchObject({
      logicalRequestCount: 1,
      retainedR2Bytes: receipt.byteLength,
    });
    await expect(resumed.write(observation([{ rid: 1001 }]))).resolves.toEqual(
      receipt,
    );
    expect(resumed.usage().logicalRequestCount).toBe(1);
  });
});
