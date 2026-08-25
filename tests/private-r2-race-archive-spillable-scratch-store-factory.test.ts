import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import type { CoreStarProfile } from "../domain/star-signals";
import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import type { PrivateR2ExternalSortedRunStoragePort } from "../lib/private-r2-external-sorted-run-store";
import { createPrivateR2RaceArchiveSpillableScratchStoreFactory } from "../lib/private-r2-race-archive-spillable-scratch-store-factory";

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
  storage: PrivateR2ExternalSortedRunStoragePort;
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
        return {
          status: objects.delete(request.key)
            ? ("deleted" as const)
            : ("missing" as const),
        };
      },
    },
  };
}

function observation(): RaceArchiveCoreAnalyticalObservation {
  return {
    datasetVersionId: "version-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: 1,
    naturalKey: "event-1:core-1",
    fingerprintSha256: "a".repeat(64),
    sourceEventId: "event-1",
    sourceCoreId: "core-1",
    eventAt: "2026-08-20T01:02:03.000Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: true,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedMilliseconds: 61_250,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

function starProfile(): CoreStarProfile {
  return {
    coreId: "core-1",
    mode: "bike",
    distance: 1000,
    dataCurrentThrough: "2026-08-20T01:02:03.000Z",
    raceCount: 1,
    completeStarDataRaceCount: 1,
    partialStarDataRaceCount: 0,
    missingStarDataRaceCount: 0,
    invalidStarDataRaceCount: 0,
    goldEligibleRaceCount: 1,
    goldAssignmentOpportunityCount: 1,
    goldReceivedCount: 1,
    goldNegativeOpportunityCount: 0,
    goldEligibleNoAssignmentCount: 0,
    goldIneligibleAssignmentCount: 0,
    goldExcludedAnomalyCount: 0,
    goldReceivedRate: { numerator: 1, denominator: 1 },
    blueAssignmentOpportunityCount: 1,
    blueReceivedCount: 0,
    blueNegativeOpportunityCount: 1,
    blueNoAssignmentCount: 0,
    blueExcludedAnomalyCount: 0,
    blueReceivedRate: { numerator: 0, denominator: 1 },
    sameCoreReceivedBothCount: 0,
  };
}

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function collect<T>(source: AsyncIterable<T>): Promise<T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

function factory(storage: PrivateR2ExternalSortedRunStoragePort) {
  return createPrivateR2RaceArchiveSpillableScratchStoreFactory({
    bucketName: "private-archive",
    storage,
    maximumPartBytes: 4096,
    maximumPartsPerRun: 20,
    maximumManifestBytes: 4096,
  });
}

const request = {
  ownerId: "owner-1",
  updateSessionId: "33333333-3333-4333-8333-333333333333",
  refreshId: "aaaaaaaa-aaaa-faaa-7aaa-aaaaaaaaaaaa",
  sourceVersionSetSha256: "b".repeat(64),
} as const;

describe("private R2 Race archive spillable scratch-store factory", () => {
  it("round-trips observation and star-profile scratch runs in separate typed namespaces", async () => {
    const { storage, objects } = memoryStorage();
    const stores = await factory(storage).create(request);
    const runId = "same-logical-run";

    await stores.observationStore.writeRun({
      runId,
      records: records([observation()]),
    });
    await stores.starProfileStore.writeRun({
      runId,
      records: records([starProfile()]),
    });

    await expect(
      collect(stores.observationStore.readRun({ runId })),
    ).resolves.toEqual([observation()]);
    await expect(
      collect(stores.starProfileStore.readRun({ runId })),
    ).resolves.toEqual([starProfile()]);
    expect(objects.size).toBe(4);
    expect(new Set(objects.keys()).size).toBe(4);
  });

  it("isolates identical run IDs across aggregate refresh identities", async () => {
    const { storage, objects } = memoryStorage();
    const first = await factory(storage).create(request);
    const second = await factory(storage).create({
      ...request,
      refreshId: "bbbbbbbb-bbbb-fbbb-7bbb-bbbbbbbbbbbb",
    });

    await first.observationStore.writeRun({
      runId: "run-1",
      records: records([observation()]),
    });
    const afterFirst = new Set(objects.keys());
    await second.observationStore.writeRun({
      runId: "run-1",
      records: records([observation()]),
    });

    expect(objects.size).toBe(4);
    expect([...objects.keys()].some((key) => !afterFirst.has(key))).toBe(true);
  });

  it("fails closed before scratch creation when aggregate identity is malformed", async () => {
    const { storage, objects } = memoryStorage();
    const scratchFactory = factory(storage);

    await expect(
      scratchFactory.create({
        ...request,
        sourceVersionSetSha256: "not-a-digest",
      }),
    ).rejects.toThrow(
      "sourceVersionSetSha256 must be a lowercase SHA-256 digest",
    );
    expect(objects.size).toBe(0);
  });

  it("inherits the generic private-bucket gate before either typed store can write", async () => {
    const { storage, objects } = memoryStorage({ privateBucket: false });
    const stores = await factory(storage).create(request);

    await expect(
      stores.starProfileStore.writeRun({
        runId: "run-1",
        records: records([starProfile()]),
      }),
    ).rejects.toThrow("Race archive scratch bucket is not private.");
    expect(objects.size).toBe(0);
  });

  it("replays an identical deterministic scratch identity without creating duplicate objects", async () => {
    const { storage, objects } = memoryStorage();
    const first = await factory(storage).create(request);
    const replay = await factory(storage).create(request);

    await first.observationStore.writeRun({
      runId: "run-1",
      records: records([observation()]),
    });
    const objectCount = objects.size;
    await replay.observationStore.writeRun({
      runId: "run-1",
      records: records([observation()]),
    });

    expect(objects.size).toBe(objectCount);
    await expect(
      collect(replay.observationStore.readRun({ runId: "run-1" })),
    ).resolves.toEqual([observation()]);
  });
});
