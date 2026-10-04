import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { PrivateRawImportObjectStore } from "@/lib/private-raw-import-object-stream";
import { raceMergeCoreOutcomeConnectedRuntimeFromEnvironment } from "@/lib/race-merge-core-outcome-connected-runtime";
import type {
  RaceMergeCoreOutcomeR2CapacityGate,
  RaceMergeCoreOutcomeR2GenerationAuthority,
  RaceMergeCoreOutcomeR2GenerationCheckpoint,
  RaceMergeCoreOutcomeR2GenerationRepository,
  RaceMergeCoreOutcomeR2Manifest,
} from "@/lib/race-merge-core-outcome-r2-generation";
import {
  createRaceMergeCoreOutcomeR2Store,
  type RaceMergeCoreOutcomeR2StoragePort,
} from "@/lib/race-merge-core-outcome-r2-store";

const HEAD = "a".repeat(40);
const OWNER = "private-owner";
const BUCKET = "private-preview";
const encoder = new TextEncoder();

async function collect(body: AsyncIterable<Uint8Array>): Promise<Uint8Array> {
  const chunks: Uint8Array[] = [];
  let length = 0;
  for await (const chunk of body) {
    chunks.push(chunk);
    length += chunk.byteLength;
  }
  const output = new Uint8Array(length);
  let offset = 0;
  for (const chunk of chunks) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function harness() {
  const events: string[] = [];
  const csv = encoder.encode(
    "event_id,token_id,pos,time\nrace-3,300,3,13.003\nrace-1,101,2,11.001\nrace-2,202,1,12.002\nrace-1,101,2,11.001\n",
  );
  const digest = createHash("sha256").update(csv).digest("hex");
  const sourceObjectStore: PrivateRawImportObjectStore = Object.freeze({
    async openObject() {
      events.push("source-open");
      return Object.freeze({
        advertisedByteLength: csv.byteLength,
        body: (async function* () {
          yield csv;
        })(),
      });
    },
  });
  const objects = new Map<
    string,
    Readonly<{
      body: Uint8Array;
      contentType: string;
      checksumSha256: string;
      metadata: Readonly<Record<string, string>>;
    }>
  >();
  const outcomeStorage: RaceMergeCoreOutcomeR2StoragePort = Object.freeze({
    async readBucketPrivacy() {
      return {
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      };
    },
    async putObjectIfAbsent(request) {
      const status = objects.has(request.key) ? "existing" : "created";
      if (status === "created") {
        objects.set(
          request.key,
          Object.freeze({
            body: await collect(request.body),
            contentType: request.contentType,
            checksumSha256: request.checksumSha256,
            metadata: request.metadata,
          }),
        );
      }
      return { status };
    },
    async headObject({ key }) {
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
    },
    async getObject({ key }) {
      const object = objects.get(key);
      return object === undefined
        ? { status: "missing" as const }
        : {
            status: "ready" as const,
            body: (async function* () {
              yield object.body;
            })(),
          };
    },
  });
  let authority: RaceMergeCoreOutcomeR2GenerationAuthority | null = null;
  let complete = false;
  const manifests: RaceMergeCoreOutcomeR2Manifest[] = [];
  function checkpoint(): RaceMergeCoreOutcomeR2GenerationCheckpoint {
    if (authority === null) throw new Error("authority unavailable");
    return Object.freeze({
      ...authority,
      status: complete ? ("complete" as const) : ("writing" as const),
      registeredCoreCount: manifests.length,
      registeredUniqueOutcomeCount: manifests.reduce(
        (total, value) => total + value.uniqueOutcomeCount,
        0,
      ),
      registeredSourceObservationCount: manifests.reduce(
        (total, value) => total + value.sourceObservationCount,
        0,
      ),
      registeredR2Bytes: manifests.reduce(
        (total, value) => total + value.byteLength,
        0,
      ),
      lastRegisteredSourceCoreId: manifests.at(-1)?.sourceCoreId ?? null,
      completedReceiptSetSha256: complete ? authority.receiptSetSha256 : null,
      startedAt: "2026-10-03T16:00:00.000Z",
      updatedAt:
        manifests.length > 0
          ? "2026-10-03T16:01:00.000Z"
          : "2026-10-03T16:00:00.000Z",
    });
  }
  const repository: RaceMergeCoreOutcomeR2GenerationRepository = Object.freeze({
    async begin(_ownerId, request) {
      authority ??= request.authority;
      return checkpoint();
    },
    async registerCore(_ownerId, request) {
      manifests.push(
        Object.freeze({
          ...request.receipt,
          registeredAt: request.registeredAt,
        }),
      );
      return checkpoint();
    },
    async finalize() {
      complete = true;
      return checkpoint();
    },
    async listManifests(_ownerId, request) {
      return manifests
        .filter((value) => value.sourceCoreId > request.afterSourceCoreId)
        .slice(0, request.limit);
    },
  });
  const capacityGate: RaceMergeCoreOutcomeR2CapacityGate = Object.freeze({
    assertFreshCurrentCapacity: vi.fn(async (request) => {
      events.push("capacity");
      return Object.freeze({
        version: 1 as const,
        generationId: request.generationId,
        cohortOrdinal: request.cohortOrdinal,
        receiptSetSha256: request.receiptSetSha256,
        retainedR2Bytes: request.retainedR2Bytes,
        measuredAt: "2026-10-03T16:00:30.000Z",
        validUntil: "2026-10-03T16:05:00.000Z",
        capacityAllowed: true as const,
        projectedPaidCostAud: 0 as const,
      });
    }),
  });
  const outcomeStore = createRaceMergeCoreOutcomeR2Store({
    ownerId: OWNER,
    bucketName: BUCKET,
    storage: outcomeStorage,
  });
  const times = [
    new Date("2026-10-03T16:00:00.000Z"),
    new Date("2026-10-03T16:01:00.000Z"),
  ];
  return {
    capacityGate,
    digest,
    events,
    manifests,
    objects,
    outcomeStore,
    repository,
    sourceObjectStore,
    now: () => times.shift() ?? new Date("2026-10-03T16:01:00.000Z"),
    reference: Object.freeze({
      objectId: "owner-race-merge",
      sourceFamily: "race_merge" as const,
      expectedByteLength: csv.byteLength,
      expectedSha256: digest,
    }),
  };
}

const bounds = Object.freeze({
  maximumFiles: 8,
  maximumTotalBytes: 1_000_000,
  maximumObjectBytes: 500_000,
  maximumChunkBytes: 100_000,
  maximumRowsPerObject: 10_000,
  maximumRowsPerGeneration: 10_000,
  maximumHeaderColumns: 100,
  maximumFieldCharacters: 1_000,
  maximumRowCharacters: 10_000,
  maximumSelectedObservations: 1_000,
});

describe("Race Merge Core outcome connected runtime", () => {
  it("streams one source cohort through capacity, R2 and durable manifests", async () => {
    const test = harness();
    const runtime = raceMergeCoreOutcomeConnectedRuntimeFromEnvironment(
      {
        authorizedOwnerId: OWNER,
        exactCodeHeadSha: HEAD,
        r2BucketName: BUCKET,
      },
      {
        capacityGate: test.capacityGate,
        sourceObjectStore: test.sourceObjectStore,
        outcomeStore: test.outcomeStore,
        repository: test.repository,
        now: test.now,
      },
    );
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const result = await runtime.execute({
      generationId: "generation-1",
      cohortOrdinal: 1,
      afterSourceCoreId: 100,
      maximumCores: 2,
      references: [test.reference],
      bounds,
    });

    expect(result).toMatchObject({
      sourceManifestSha256: expect.stringMatching(/^[a-f0-9]{64}$/u),
      selectedExactReplayCount: 1,
      dnaProviderRequestCount: 0,
      persistentWritePerformed: true,
      paidUsageAllowed: false,
      source: {
        selectedCoreCount: 2,
        selectedUniqueOutcomeCount: 2,
        selectedObservationCount: 3,
        firstSourceCoreId: 101,
        lastSourceCoreId: 202,
      },
      generation: {
        authority: {
          coreCount: 2,
          uniqueOutcomeCount: 2,
          sourceObservationCount: 3,
          firstSourceCoreId: 101,
          lastSourceCoreId: 202,
        },
        checkpointAfter: { status: "complete" },
      },
    });
    expect(test.capacityGate.assertFreshCurrentCapacity).toHaveBeenCalledTimes(
      1,
    );
    expect(test.events).toEqual(["source-open", "capacity"]);
    expect(test.objects.size).toBe(2);
    expect(test.manifests).toHaveLength(2);
  });

  it("fails closed before provider work when connected authority is incomplete", () => {
    expect(raceMergeCoreOutcomeConnectedRuntimeFromEnvironment({})).toEqual({
      status: "not_configured",
    });
    expect(
      raceMergeCoreOutcomeConnectedRuntimeFromEnvironment({
        authorizedOwnerId: OWNER,
        exactCodeHeadSha: HEAD,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      raceMergeCoreOutcomeConnectedRuntimeFromEnvironment({
        authorizedOwnerId: OWNER,
        exactCodeHeadSha: HEAD,
        r2BucketName: BUCKET,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("does not call generation when source verification fails", async () => {
    const test = harness();
    const commitGeneration = vi.fn();
    const runtime = raceMergeCoreOutcomeConnectedRuntimeFromEnvironment(
      {
        authorizedOwnerId: OWNER,
        exactCodeHeadSha: HEAD,
        r2BucketName: BUCKET,
      },
      {
        capacityGate: test.capacityGate,
        sourceObjectStore: test.sourceObjectStore,
        outcomeStore: test.outcomeStore,
        repository: test.repository,
        commitGeneration,
        now: test.now,
      },
    );
    if (runtime.status !== "ready") throw new Error("expected ready runtime");
    await expect(
      runtime.execute({
        generationId: "generation-1",
        cohortOrdinal: 1,
        afterSourceCoreId: 0,
        maximumCores: 2,
        references: [{ ...test.reference, expectedSha256: "b".repeat(64) }],
        bounds,
      }),
    ).rejects.toThrow("checksum_mismatch");
    expect(commitGeneration).not.toHaveBeenCalled();
  });
  it("derives the next ordinal and source watermark from the durable predecessor", async () => {
    const test = harness();
    const receiptSetSha256 = "c".repeat(64);
    const authority = Object.freeze({
      version: 1 as const,
      generationId: "generation-1",
      cohortOrdinal: 1,
      firstSourceCoreId: 1,
      lastSourceCoreId: 202,
      coreCount: 100,
      uniqueOutcomeCount: 10_000,
      sourceObservationCount: 10_004,
      retainedR2Bytes: 1_000_000,
      receiptSetSha256,
    });
    const checkpoint = Object.freeze({
      ...authority,
      status: "complete" as const,
      registeredCoreCount: 100,
      registeredUniqueOutcomeCount: 10_000,
      registeredSourceObservationCount: 10_004,
      registeredR2Bytes: 1_000_000,
      lastRegisteredSourceCoreId: 202,
      completedReceiptSetSha256: receiptSetSha256,
      startedAt: "2026-10-03T15:00:00.000Z",
      updatedAt: "2026-10-03T15:10:00.000Z",
    });
    const readCompleteGeneration = vi.fn(async () =>
      Object.freeze({
        authority,
        checkpoint,
        manifests: Object.freeze([]),
      }),
    );
    const runtime = raceMergeCoreOutcomeConnectedRuntimeFromEnvironment(
      {
        authorizedOwnerId: OWNER,
        exactCodeHeadSha: HEAD,
        r2BucketName: BUCKET,
      },
      {
        capacityGate: test.capacityGate,
        sourceObjectStore: test.sourceObjectStore,
        outcomeStore: test.outcomeStore,
        repository: test.repository,
        readCompleteGeneration,
        now: test.now,
      },
    );
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const result = await runtime.executeNext({
      generationId: "generation-1",
      previousCohortOrdinal: 1,
      references: [test.reference],
      bounds,
    });

    expect(readCompleteGeneration).toHaveBeenCalledWith({
      ownerId: OWNER,
      generationId: "generation-1",
      cohortOrdinal: 1,
      repository: test.repository,
    });
    expect(result.previousGeneration.checkpoint.status).toBe("complete");
    expect(result.next).toMatchObject({
      source: {
        firstSourceCoreId: 300,
        lastSourceCoreId: 300,
        selectedCoreCount: 1,
      },
      generation: {
        authority: {
          cohortOrdinal: 2,
          firstSourceCoreId: 300,
          lastSourceCoreId: 300,
          coreCount: 1,
        },
        checkpointAfter: { status: "complete" },
      },
      dnaProviderRequestCount: 0,
      paidUsageAllowed: false,
    });
  });
});
