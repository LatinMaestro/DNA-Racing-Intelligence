import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  createDnaOpenLabR2CurrentStateEvidenceReader,
  createDnaOpenLabR2CurrentStateEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "@/lib/dna-open-lab-r2-current-state-evidence";
import type { DnaCurrentStateRequest } from "@/lib/dna-open-lab-current-state-sync-plan";
import type { DnaOpenLabResponse } from "@/lib/dna-open-lab-v1-client";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryR2Storage implements DnaOpenLabR2CurrentStateEvidenceStoragePort {
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

  async getObject(input: { bucketName: string; key: string }) {
    const stored = this.objects.get(input.key);
    if (stored === undefined) {
      return Object.freeze({ status: "missing" as const });
    }
    return Object.freeze({
      status: "ready" as const,
      body: (async function* () {
        yield stored.body;
      })(),
    });
  }
}

const cycleId = "75000000-0000-4000-8000-000000000010";
const requestKey = "1".repeat(64);
const request: DnaCurrentStateRequest = Object.freeze({
  endpoint: "tokens.prices",
  scope: "tokens",
  payload: Object.freeze({}),
});

function response(result: unknown): DnaOpenLabResponse<unknown> {
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

function sink(storage: MemoryR2Storage, maximumObjectBytes?: number) {
  return createDnaOpenLabR2CurrentStateEvidenceSink({
    ownerId: "owner-vault@example.test",
    bucketName: "dna-racing-import-preview",
    storage,
    ...(maximumObjectBytes === undefined ? {} : { maximumObjectBytes }),
  });
}

function evidenceInput(result: unknown, observedAt = "2026-08-28T00:00:10Z") {
  return {
    cycleId,
    group: "token_prices" as const,
    requestKey,
    request,
    response: response(result),
    observedAt,
  };
}

describe("DNA Open Lab private R2 current-state evidence", () => {
  it("writes one immutable private observation and verifies its receipt", async () => {
    const storage = new MemoryR2Storage();
    const persist = sink(storage);

    const receipt = await persist(evidenceInput({ dez: "1.25", eth: "3.5" }));
    const [key, stored] = [...storage.objects.entries()][0] ?? [];

    expect(receipt).toEqual({
      requestKey,
      observedAt: "2026-08-28T00:00:10.000Z",
      contentSha256: stored?.checksumSha256,
      evidenceObjectKey: key,
    });
    expect(key).toMatch(
      new RegExp(`/current-state/cycles/${cycleId}/${requestKey}\\.json$`, "u"),
    );
    expect(stored?.metadata["dna-endpoint"]).toBe("tokens.prices");
    expect(stored?.metadata["dna-group"]).toBe("token_prices");
    expect(storage.privacyReadCount).toBe(1);
  });

  it("returns the first immutable receipt when a crashed request replays", async () => {
    const storage = new MemoryR2Storage();
    const persist = sink(storage);
    const first = await persist(evidenceInput({ price: "first" }));
    const replay = await persist(
      evidenceInput({ price: "later" }, "2026-08-28T00:00:20Z"),
    );

    expect(replay).toEqual(first);
    expect(storage.objects.size).toBe(1);
    expect(storage.putCount).toBe(2);
    expect(storage.privacyReadCount).toBe(1);
  });

  it("keeps recovery probes in the fixed cleanup-eligible namespace", async () => {
    const storage = new MemoryR2Storage();
    const persist = createDnaOpenLabP5RecoveryTemporaryEvidenceSink({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: "owner-vault@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    const receipt = await persist(evidenceInput({ recoveryProbe: true }));
    expect(receipt.evidenceObjectKey).toMatch(
      new RegExp(
        `/p5-recovery/crash-after-evidence-write/cycles/${cycleId}/${requestKey}\\.json$`,
        "u",
      ),
    );
    expect(
      storage.objects.get(receipt.evidenceObjectKey)?.metadata["dna-kind"],
    ).toBe("p5_recovery_current_state_request");

    const read = createDnaOpenLabP5RecoveryTemporaryEvidenceReader({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: "owner-vault@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    await expect(read({ cycleId, receipt })).resolves.toMatchObject({
      requestKey,
      response: { result: { recoveryProbe: true } },
    });
  });

  it("reads back only exact private receipt-bound evidence", async () => {
    const storage = new MemoryR2Storage();
    const persist = sink(storage);
    const receipt = await persist(evidenceInput({ dez: "1.25" }));
    const read = createDnaOpenLabR2CurrentStateEvidenceReader({
      ownerId: "owner-vault@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });

    await expect(read({ cycleId, receipt })).resolves.toEqual({
      cycleId,
      group: "token_prices",
      requestKey,
      observedAt: "2026-08-28T00:00:10.000Z",
      request,
      response: response({ dez: "1.25" }),
    });
    expect(storage.privacyReadCount).toBe(2);
  });

  it("rejects owner/key drift and modified evidence bytes", async () => {
    const storage = new MemoryR2Storage();
    const receipt = await sink(storage)(evidenceInput({ price: "first" }));
    const wrongOwner = createDnaOpenLabR2CurrentStateEvidenceReader({
      ownerId: "different-owner@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    await expect(wrongOwner({ cycleId, receipt })).rejects.toThrow(
      "receipt object key does not match its identity",
    );

    const stored = storage.objects.get(receipt.evidenceObjectKey);
    if (stored === undefined) throw new Error("synthetic evidence missing");
    storage.objects.set(
      receipt.evidenceObjectKey,
      Object.freeze({
        ...stored,
        body: new TextEncoder().encode("{}"),
      }),
    );
    const read = createDnaOpenLabR2CurrentStateEvidenceReader({
      ownerId: "owner-vault@example.test",
      bucketName: "dna-racing-import-preview",
      storage,
    });
    await expect(read({ cycleId, receipt })).rejects.toThrow(
      "body integrity is invalid",
    );
  });

  it("rejects conflicting immutable identity metadata", async () => {
    const storage = new MemoryR2Storage();
    const persist = sink(storage);
    const receipt = await persist(evidenceInput({ price: "first" }));
    const stored = storage.objects.get(receipt.evidenceObjectKey);
    if (stored === undefined) throw new Error("synthetic evidence missing");
    storage.objects.set(
      receipt.evidenceObjectKey,
      Object.freeze({
        ...stored,
        metadata: Object.freeze({
          ...stored.metadata,
          "dna-group": "race_activity",
        }),
      }),
    );

    await expect(persist(evidenceInput({ price: "first" }))).rejects.toThrow(
      "integrity does not match publication",
    );
  });

  it("fails before storage when the evidence bucket is exposed", async () => {
    const storage = new MemoryR2Storage();
    storage.privacy = {
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    };

    await expect(sink(storage)(evidenceInput({}))).rejects.toThrow(
      "evidence bucket is not private",
    );
    expect(storage.putCount).toBe(0);
  });

  it("enforces object size and logical identity bounds", async () => {
    const storage = new MemoryR2Storage();
    await expect(
      sink(storage, 128)(evidenceInput({ payload: "x".repeat(512) })),
    ).rejects.toThrow("exceeds its bounded byte capacity");
    await expect(
      sink(storage)(
        Object.freeze({ ...evidenceInput({}), requestKey: "invalid" }),
      ),
    ).rejects.toThrow("requestKey is invalid");
    expect(storage.objects.size).toBe(0);
  });
});
