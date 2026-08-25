import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { createPrivateR2ExternalSortedRunStore } from "../lib/private-r2-external-sorted-run-store";
import {
  createPrivateR2RaceArchiveScratchRunStore,
  type PrivateR2RaceArchiveScratchStoragePort,
} from "../lib/private-r2-race-archive-scratch-run-store";

function checksum(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function collectBody(
  source: AsyncIterable<Uint8Array>,
): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let byteLength = 0;
  for await (const chunk of source) {
    chunks.push(chunk);
    byteLength += chunk.byteLength;
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

type StoredObject = {
  contentType: string;
  body: Uint8Array;
  checksumSha256: string;
  metadata: Readonly<Record<string, string>>;
};

function memoryStorage(input?: { privateBucket?: boolean }): {
  storage: PrivateR2RaceArchiveScratchStoragePort;
  objects: Map<string, StoredObject>;
} {
  const objects = new Map<string, StoredObject>();
  return {
    objects,
    storage: {
      async readBucketPrivacy() {
        return {
          publicAccessDisabled: input?.privateBucket ?? true,
          r2DevDisabled: input?.privateBucket ?? true,
          customDomainCount: input?.privateBucket === false ? 1 : 0,
        };
      },
      async putObjectIfAbsent(request) {
        if (objects.has(request.key)) return { status: "existing" as const };
        const value = await collectBody(request.body);
        if (
          value.byteLength !== request.byteLength ||
          checksum(value) !== request.checksumSha256
        ) {
          throw new Error("test storage write mismatch");
        }
        objects.set(request.key, {
          contentType: request.contentType,
          body: value,
          checksumSha256: request.checksumSha256,
          metadata: request.metadata,
        });
        return { status: "created" as const };
      },
      async headObject(request) {
        const value = objects.get(request.key);
        if (value === undefined) return { status: "missing" as const };
        return {
          status: "ready" as const,
          contentType: value.contentType,
          byteLength: value.body.byteLength,
          checksumSha256: value.checksumSha256,
          metadata: value.metadata,
        };
      },
      async getObject(request) {
        const value = objects.get(request.key);
        if (value === undefined) return { status: "missing" as const };
        return {
          status: "ready" as const,
          body: (async function* () {
            yield value.body;
          })(),
        };
      },
      async deleteObject(request) {
        const deleted = objects.delete(request.key);
        return {
          status: deleted ? ("deleted" as const) : ("missing" as const),
        };
      },
    },
  };
}

function observation(input: {
  naturalKey: string;
  fingerprint?: string;
  elapsedMilliseconds?: number;
}): RaceArchiveCoreAnalyticalObservation {
  const [sourceEventId = "event-1", sourceCoreId = "core-1"] =
    input.naturalKey.split(":");
  return {
    datasetVersionId: "version-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: 1,
    naturalKey: input.naturalKey,
    fingerprintSha256: input.fingerprint ?? "a".repeat(64),
    sourceEventId,
    sourceCoreId,
    eventAt: "2026-08-20T01:02:03.000Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: true,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedMilliseconds: input.elapsedMilliseconds ?? 61_250,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

function records(
  values: readonly RaceArchiveCoreAnalyticalObservation[],
): AsyncIterable<RaceArchiveCoreAnalyticalObservation> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function store(
  storage: PrivateR2RaceArchiveScratchStoragePort,
  maximumPartBytes = 1024,
) {
  return createPrivateR2RaceArchiveScratchRunStore({
    ownerId: "owner-1",
    sessionId: "refresh-1",
    bucketName: "private-archive",
    storage,
    maximumPartBytes,
    maximumPartsPerRun: 10,
    maximumManifestBytes: 4096,
  });
}

describe("private R2 Race archive scratch run store", () => {
  it("writes bounded chunks, verifies them and streams the exact observations back", async () => {
    const { storage, objects } = memoryStorage();
    const scratch = store(storage, 700);
    const values = [
      observation({ naturalKey: "event-1:core-1" }),
      observation({
        naturalKey: "event-2:core-2",
        fingerprint: "b".repeat(64),
        elapsedMilliseconds: 62_500,
      }),
      observation({
        naturalKey: "event-3:core-3",
        fingerprint: "c".repeat(64),
        elapsedMilliseconds: 63_750,
      }),
    ];

    await scratch.writeRun({
      runId: "refresh-1/run-00000001",
      records: records(values),
    });

    const partKeys = [...objects.keys()].filter((key) =>
      key.endsWith(".ndjson"),
    );
    expect(partKeys.length).toBeGreaterThan(1);
    expect(
      partKeys.every((key) => (objects.get(key)?.body.byteLength ?? 0) <= 700),
    ).toBe(true);
    await expect(
      collect(scratch.readRun({ runId: "refresh-1/run-00000001" })),
    ).resolves.toEqual(values);
  });

  it("fails closed before writing when the configured bucket is public", async () => {
    const { storage, objects } = memoryStorage({ privateBucket: false });
    const scratch = store(storage);

    await expect(
      scratch.writeRun({
        runId: "refresh-1/run-00000001",
        records: records([observation({ naturalKey: "event-1:core-1" })]),
      }),
    ).rejects.toThrow("Race archive scratch bucket is not private.");
    expect(objects.size).toBe(0);
  });

  it("fails closed when an existing deterministic scratch object has different bytes", async () => {
    const { storage, objects } = memoryStorage();
    const scratch = store(storage);
    const runId = "refresh-1/run-00000001";
    await scratch.writeRun({
      runId,
      records: records([observation({ naturalKey: "event-1:core-1" })]),
    });

    await expect(
      scratch.writeRun({
        runId,
        records: records([
          observation({
            naturalKey: "event-1:core-1",
            elapsedMilliseconds: 61_251,
          }),
        ]),
      }),
    ).rejects.toThrow("Race archive scratch object failed exact verification.");
    expect(objects.size).toBeGreaterThan(0);
  });

  it("detects body corruption even when object metadata still claims the original checksum", async () => {
    const { storage, objects } = memoryStorage();
    const scratch = store(storage);
    const runId = "refresh-1/run-00000001";
    await scratch.writeRun({
      runId,
      records: records([observation({ naturalKey: "event-1:core-1" })]),
    });
    const partKey = [...objects.keys()].find((key) => key.endsWith(".ndjson"));
    if (partKey === undefined) throw new Error("test scratch part missing");
    const part = objects.get(partKey);
    if (part === undefined) throw new Error("test scratch part missing");
    const corrupted = new Uint8Array(part.body);
    corrupted[0] = corrupted[0] === 123 ? 91 : 123;
    part.body = corrupted;

    await expect(collect(scratch.readRun({ runId }))).rejects.toThrow(
      "Race archive scratch object checksum changed.",
    );
  });

  it("deletes every part and manifest owned by the run", async () => {
    const { storage, objects } = memoryStorage();
    const scratch = store(storage, 700);
    const runId = "refresh-1/run-00000001";
    await scratch.writeRun({
      runId,
      records: records([
        observation({ naturalKey: "event-1:core-1" }),
        observation({
          naturalKey: "event-2:core-2",
          fingerprint: "b".repeat(64),
        }),
      ]),
    });
    expect(objects.size).toBeGreaterThan(1);

    await scratch.deleteRun({ runId });

    expect(objects.size).toBe(0);
    await expect(scratch.deleteRun({ runId })).resolves.toBeUndefined();
  });

  it("rejects a restarted-run manifest that redirects cleanup outside its deterministic prefix", async () => {
    const { storage, objects } = memoryStorage();
    const runId = "refresh-1/run-00000001";
    const writer = store(storage);
    await writer.writeRun({
      runId,
      records: records([observation({ naturalKey: "event-1:core-1" })]),
    });

    const manifestKey = [...objects.keys()].find((key) =>
      key.endsWith("/manifest.json"),
    );
    if (manifestKey === undefined)
      throw new Error("test scratch manifest missing");
    const manifestObject = objects.get(manifestKey);
    if (manifestObject === undefined)
      throw new Error("test scratch manifest missing");

    const protectedKey = "evidence/protected-object";
    const protectedBody = new TextEncoder().encode("keep");
    objects.set(protectedKey, {
      contentType: "application/octet-stream",
      body: protectedBody,
      checksumSha256: checksum(protectedBody),
      metadata: { scope: "protected" },
    });

    const manifest = JSON.parse(
      new TextDecoder().decode(manifestObject.body),
    ) as {
      parts: Array<{ key: string }>;
    };
    const firstPart = manifest.parts[0];
    if (firstPart === undefined)
      throw new Error("test scratch manifest parts missing");
    firstPart.key = protectedKey;
    manifestObject.body = new TextEncoder().encode(JSON.stringify(manifest));
    manifestObject.checksumSha256 = checksum(manifestObject.body);

    const restarted = store(storage);
    await expect(restarted.deleteRun({ runId })).rejects.toThrow(
      "Race archive scratch manifest part ownership changed.",
    );
    expect(objects.has(protectedKey)).toBe(true);
  });

  it("supports bounded exact codecs for derived external-sort records", async () => {
    const { storage } = memoryStorage();
    type SummaryRecord = Readonly<{ key: string; count: number }>;
    const encoder = new TextEncoder();
    const scratch = createPrivateR2ExternalSortedRunStore<SummaryRecord>({
      ownerId: "owner-1",
      sessionId: "refresh-1:summary",
      bucketName: "private-bucket",
      storage,
      maximumPartBytes: 128,
      maximumPartsPerRun: 10,
      maximumManifestBytes: 4096,
      encodeRecord(record) {
        return encoder.encode(`${JSON.stringify(record)}\n`);
      },
      decodeRecordLine(line) {
        const value = JSON.parse(line) as Partial<SummaryRecord>;
        const count = value.count;
        if (
          typeof value.key !== "string" ||
          typeof count !== "number" ||
          !Number.isSafeInteger(count) ||
          count < 0
        ) {
          throw new Error("summary record is invalid");
        }
        return Object.freeze({ key: value.key, count });
      },
    });
    const records = Object.freeze([
      Object.freeze({ key: "bike:1000", count: 3 }),
      Object.freeze({ key: "horse:1600", count: 7 }),
    ]);
    await scratch.writeRun({
      runId: "summary-run",
      records: (async function* () {
        for (const record of records) yield record;
      })(),
    });
    const roundTripped: SummaryRecord[] = [];
    for await (const record of scratch.readRun({ runId: "summary-run" })) {
      roundTripped.push(record);
    }
    expect(roundTripped).toEqual(records);
    await scratch.deleteRun({ runId: "summary-run" });
  });

  it("rejects a generic scratch codec that emits more than one line per record", async () => {
    const { storage } = memoryStorage();
    const scratch = createPrivateR2ExternalSortedRunStore<string>({
      ownerId: "owner-1",
      sessionId: "refresh-1:summary",
      bucketName: "private-bucket",
      storage,
      maximumPartBytes: 128,
      maximumPartsPerRun: 10,
      maximumManifestBytes: 4096,
      encodeRecord() {
        return new TextEncoder().encode("first\nsecond\n");
      },
      decodeRecordLine(line) {
        return line;
      },
    });
    await expect(
      scratch.writeRun({
        runId: "invalid-codec",
        records: (async function* () {
          yield "value";
        })(),
      }),
    ).rejects.toThrow("Race archive scratch encoded record must be one line.");
  });
});
