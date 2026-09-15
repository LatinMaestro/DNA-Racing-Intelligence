import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { createDnaCoreRaceHistoryAcquisitionCycle } from "../lib/dna-core-race-history-acquisition-cycle";
import {
  createDnaCoreRaceHistoryR2EvidenceStore,
  DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES,
  type DnaCoreRaceHistoryR2EvidenceStoragePort,
} from "../lib/dna-core-race-history-r2-evidence";
import type { DnaCoreRaceHistoryRow } from "../lib/dna-core-race-history-client";
import type { DnaOpenLabResponse } from "../lib/dna-open-lab-v1-client";

type StoredObject = Readonly<{
  body: Uint8Array;
  contentType: string;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
}>;

class MemoryR2Storage implements DnaCoreRaceHistoryR2EvidenceStoragePort {
  readonly objects = new Map<string, StoredObject>();
  privacyReadCount = 0;
  putCount = 0;
  headCount = 0;
  getCount = 0;
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
    this.headCount += 1;
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
    this.getCount += 1;
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

const authority = createDnaCoreRaceHistoryAcquisitionCycle({
  previousCompletedCycleId: null,
  currentStateGenerationId: "10000000-0000-4000-8000-000000000001",
  evaluatedAt: "2026-09-15T06:00:00.000Z",
  coreIds: [42, 43],
});

function row(
  overrides: Readonly<Record<string, unknown>> = {},
): DnaCoreRaceHistoryRow {
  return Object.freeze({
    hid: 42,
    rid: "private-race-1",
    rvmode: "bike",
    cb: 12,
    time: 65.125,
    pos: 2,
    start_time: "2026-09-14T10:20:30Z",
    ...overrides,
  });
}

function response(
  rows: readonly DnaCoreRaceHistoryRow[],
): DnaOpenLabResponse<readonly DnaCoreRaceHistoryRow[]> {
  return Object.freeze({
    result: Object.freeze(rows),
    httpStatus: 200,
    rateLimit: Object.freeze({
      limit: 30,
      remaining: 29,
      resetSeconds: 30,
      rateClass: "ip",
      retryAfterSeconds: null,
    }),
  });
}

function store(storage: MemoryR2Storage, ownerId = "owner@example.test") {
  return createDnaCoreRaceHistoryR2EvidenceStore({
    ownerId,
    bucketName: "dna-racing-private-evidence",
    storage,
  });
}

function writeInput(rows: readonly DnaCoreRaceHistoryRow[]) {
  return {
    cycle: authority,
    coreId: 42,
    pageNumber: 1,
    observedAt: "2026-09-15T06:01:00.000Z",
    response: response(rows),
  };
}

describe("DNA Core race history private R2 evidence", () => {
  it("recovers then writes a private page and quarantine within the reserved operation bound", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    await expect(
      evidence.recover({ cycle: authority, coreId: 42, pageNumber: 1 }),
    ).resolves.toBeNull();
    const result = await evidence.write(
      writeInput([row(), row({ rid: "private-race-2", pos: null })]),
    );

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready evidence");
    expect(result.receipt).toMatchObject({
      sourceRowCount: 2,
      acceptedResultCount: 1,
      quarantineCount: 1,
      replayDuplicateCount: 0,
      terminal: false,
      pageBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantineBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(result.receipt.pageObjectKey).toMatch(
      /\/core-race-history\/cycles\/[a-f0-9]{64}\/attempts\/1\/cores\/[a-f0-9]{64}\/pages\/1\.json$/u,
    );
    expect(result.receipt.pageObjectKey).not.toContain("owner@example.test");
    expect(result.receipt.quarantineObjectKey).toMatch(
      /\/pages\/1\.quarantine\.json$/u,
    );
    expect(storage.objects.size).toBe(2);
    expect(storage.privacyReadCount).toBe(1);
    expect(storage.putCount).toBe(2);
    expect(storage.headCount + storage.getCount).toBe(7);
  });

  it("returns the first immutable observation when a crashed request replays", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    const first = await evidence.write(writeInput([row()]));
    const replay = await evidence.write(
      writeInput([row({ time: 99.99, pos: 8 })]),
    );

    expect(replay).toEqual(first);
    expect(storage.objects.size).toBe(1);
    expect(storage.putCount).toBe(1);
  });

  it("repairs a crash between page and quarantine publication from retained raw evidence", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    const created = await evidence.write(writeInput([row({ pos: null })]));
    expect(created.status).toBe("ready");
    if (created.status !== "ready") throw new Error("expected ready evidence");
    const quarantineKey = created.receipt.quarantineObjectKey;
    if (quarantineKey === null) throw new Error("missing quarantine key");
    storage.objects.delete(quarantineKey);

    const recovered = await evidence.recover({
      cycle: authority,
      coreId: 42,
      pageNumber: 1,
    });
    expect(recovered).toEqual(created);
    expect(storage.objects.has(quarantineKey)).toBe(true);
    expect(storage.putCount).toBe(3);
  });

  it("marks only an explicit empty page as terminal without a quarantine write", async () => {
    const storage = new MemoryR2Storage();
    const result = await store(storage).write(writeInput([]));

    expect(result.status).toBe("ready");
    if (result.status !== "ready") throw new Error("expected ready evidence");
    expect(result.receipt).toMatchObject({
      sourceRowCount: 0,
      terminal: true,
      quarantineObjectKey: null,
    });
    expect(storage.objects.size).toBe(1);
  });

  it("retains conflicts privately and holds them outside checkpoint progress", async () => {
    const storage = new MemoryR2Storage();
    const result = await store(storage).write(
      writeInput([row(), row({ time: 66.5 })]),
    );

    expect(result).toMatchObject({
      status: "held_conflict",
      conflictCount: 1,
      pageBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      quarantineBodySha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
    });
    expect(storage.objects.size).toBe(2);
  });

  it("reads only exact owner-derived evidence and detects modified metadata", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    const created = await evidence.write(writeInput([row()]));
    await expect(
      evidence.read({ cycle: authority, coreId: 42, pageNumber: 1 }),
    ).resolves.toEqual(created);
    await expect(
      store(storage, "other-owner@example.test").read({
        cycle: authority,
        coreId: 42,
        pageNumber: 1,
      }),
    ).resolves.toBeNull();

    if (created.status !== "ready") throw new Error("expected ready evidence");
    const stored = storage.objects.get(created.receipt.pageObjectKey);
    if (stored === undefined) throw new Error("synthetic page is unavailable");
    storage.objects.set(
      created.receipt.pageObjectKey,
      Object.freeze({
        ...stored,
        metadata: Object.freeze({
          ...stored.metadata,
          "dna-page": "2",
        }),
      }),
    );
    await expect(
      evidence.read({ cycle: authority, coreId: 42, pageNumber: 1 }),
    ).rejects.toThrow("stored page metadata is invalid");
  });

  it("detects modified quarantine metadata before issuing a receipt", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    const created = await evidence.write(writeInput([row({ pos: null })]));
    if (created.status !== "ready") throw new Error("expected ready evidence");
    const quarantineKey = created.receipt.quarantineObjectKey;
    if (quarantineKey === null) throw new Error("missing quarantine key");
    const stored = storage.objects.get(quarantineKey);
    if (stored === undefined) throw new Error("missing quarantine evidence");
    storage.objects.set(
      quarantineKey,
      Object.freeze({
        ...stored,
        metadata: Object.freeze({
          ...stored.metadata,
          "dna-quarantine-count": "2",
        }),
      }),
    );

    await expect(
      evidence.read({ cycle: authority, coreId: 42, pageNumber: 1 }),
    ).rejects.toThrow("quarantine receipt conflicts with stored evidence");
  });

  it("fails before any write when the bucket is exposed", async () => {
    const storage = new MemoryR2Storage();
    storage.privacy = {
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    };

    await expect(store(storage).write(writeInput([row()]))).rejects.toThrow(
      "evidence bucket is not private",
    );
    expect(storage.putCount).toBe(0);
  });

  it("rejects oversized provider pages and out-of-range cursors before writing", async () => {
    const storage = new MemoryR2Storage();
    const evidence = store(storage);
    await expect(
      evidence.write(writeInput(Array.from({ length: 51 }, () => row()))),
    ).rejects.toThrow("stored response is invalid");
    await expect(
      evidence.write({
        ...writeInput([row()]),
        pageNumber: 10_001,
      }),
    ).rejects.toThrow("pageNumber exceeds its safe bound");
    expect(storage.putCount).toBe(0);
  });

  it("cannot raise the per-object evidence bound above eight MiB", () => {
    const storage = new MemoryR2Storage();

    expect(() =>
      createDnaCoreRaceHistoryR2EvidenceStore({
        ownerId: "owner@example.test",
        bucketName: "dna-racing-private-evidence",
        storage,
        maximumObjectBytes:
          DNA_CORE_RACE_HISTORY_MAXIMUM_EVIDENCE_OBJECT_BYTES + 1,
      }),
    ).toThrow("maximumObjectBytes exceeds its safe bound");
    expect(storage.putCount).toBe(0);
  });

  it("rejects malformed stored rate-limit evidence before writing", async () => {
    const storage = new MemoryR2Storage();
    await expect(
      store(storage).write({
        ...writeInput([row()]),
        response: {
          ...response([row()]),
          rateLimit: {
            ...response([row()]).rateLimit,
            remaining: -1,
          },
        },
      }),
    ).rejects.toThrow("stored rate remaining is invalid");
    expect(storage.putCount).toBe(0);
  });
});
