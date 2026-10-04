import { describe, expect, it, vi } from "vitest";

import {
  commitRaceMergeCoreOutcomeR2Generation,
  raceMergeCoreOutcomeR2ReceiptSetSha256,
  readCompleteRaceMergeCoreOutcomeR2Generation,
  type RaceMergeCoreOutcomeR2CapacityGate,
  type RaceMergeCoreOutcomeR2GenerationAuthority,
  type RaceMergeCoreOutcomeR2GenerationCheckpoint,
  type RaceMergeCoreOutcomeR2GenerationRepository,
  type RaceMergeCoreOutcomeR2Manifest,
} from "@/lib/race-merge-core-outcome-r2-generation";
import {
  createRaceMergeCoreOutcomeR2Store,
  type RaceMergeCoreOutcomeR2StoragePort,
} from "@/lib/race-merge-core-outcome-r2-store";

const STARTED_AT = "2026-10-03T10:00:00.000Z";
const REGISTERED_AT = "2026-10-03T10:01:00.000Z";

function observation(input: {
  core: number;
  race: string;
  position: number;
  time: number;
  object?: string;
  row?: number;
}) {
  return Object.freeze({
    source: "race_merge" as const,
    sourceCoreId: input.core,
    sourceRaceId: input.race,
    finishPosition: input.position,
    elapsedMilliseconds: input.time,
    sourceObjectSha256: input.object ?? "a".repeat(64),
    sourceRowNumber: input.row ?? 1,
  });
}

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

function storage(events: string[]) {
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
      publicAccessDisabled: true,
      r2DevDisabled: true,
      customDomainCount: 0,
    })),
    putObjectIfAbsent: vi.fn(async (request) => {
      events.push(`r2-${request.metadata["dna-core"]}`);
      const status = objects.has(request.key)
        ? ("existing" as const)
        : ("created" as const);
      if (status === "created") {
        objects.set(request.key, {
          body: await collect(request.body),
          contentType: request.contentType,
          checksumSha256: request.checksumSha256,
          metadata: request.metadata,
        });
      }
      return { status };
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

function harness(options?: { failCoreOnce?: number }) {
  const events: string[] = [];
  const target = storage(events);
  const actualStore = createRaceMergeCoreOutcomeR2Store({
    ownerId: "private-owner",
    bucketName: "private-preview",
    storage: target.value,
  });
  const store = Object.freeze({
    prepare: vi.fn((request: Parameters<typeof actualStore.prepare>[0]) => {
      events.push(`prepare-${request.sourceCoreId}`);
      return actualStore.prepare(request);
    }),
    commit: vi.fn((request: Parameters<typeof actualStore.commit>[0]) =>
      actualStore.commit(request),
    ),
    read: vi.fn((request: Parameters<typeof actualStore.read>[0]) => {
      events.push(`verify-${request.sourceCoreId}`);
      return actualStore.read(request);
    }),
  });
  let authority: RaceMergeCoreOutcomeR2GenerationAuthority | null = null;
  let complete = false;
  let failed = false;
  const manifests: RaceMergeCoreOutcomeR2Manifest[] = [];

  function checkpoint(): RaceMergeCoreOutcomeR2GenerationCheckpoint {
    if (authority === null) throw new Error("authority unavailable");
    return Object.freeze({
      ...authority,
      status: complete ? ("complete" as const) : ("writing" as const),
      registeredCoreCount: manifests.length,
      registeredUniqueOutcomeCount: manifests.reduce(
        (total, manifest) => total + manifest.uniqueOutcomeCount,
        0,
      ),
      registeredSourceObservationCount: manifests.reduce(
        (total, manifest) => total + manifest.sourceObservationCount,
        0,
      ),
      registeredR2Bytes: manifests.reduce(
        (total, manifest) => total + manifest.byteLength,
        0,
      ),
      lastRegisteredSourceCoreId: manifests.at(-1)?.sourceCoreId ?? null,
      completedReceiptSetSha256: complete ? authority.receiptSetSha256 : null,
      startedAt: STARTED_AT,
      updatedAt: manifests.length > 0 ? REGISTERED_AT : STARTED_AT,
    });
  }

  const repository: RaceMergeCoreOutcomeR2GenerationRepository = Object.freeze({
    begin: vi.fn(async (_ownerId, request) => {
      events.push("checkpoint-begin");
      authority ??= request.authority;
      return checkpoint();
    }),
    registerCore: vi.fn(async (_ownerId, request) => {
      events.push(`manifest-${request.receipt.sourceCoreId}`);
      if (options?.failCoreOnce === request.receipt.sourceCoreId && !failed) {
        failed = true;
        throw new Error("synthetic Neon interruption");
      }
      manifests.push(
        Object.freeze({
          ...request.receipt,
          registeredAt: request.registeredAt,
        }),
      );
      return checkpoint();
    }),
    finalize: vi.fn(async () => {
      events.push("checkpoint-finalize");
      complete = true;
      return checkpoint();
    }),
    listManifests: vi.fn(async (_ownerId, request) =>
      Object.freeze(
        manifests
          .filter(
            (manifest) => manifest.sourceCoreId > request.afterSourceCoreId,
          )
          .slice(0, request.limit),
      ),
    ),
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
        measuredAt: "2026-10-03T09:59:00.000Z",
        validUntil: "2026-10-03T10:05:00.000Z",
        capacityAllowed: true as const,
        projectedPaidCostAud: 0 as const,
      });
    }),
  });

  return {
    capacityGate,
    events,
    manifests,
    objects: target.objects,
    repository,
    store,
  };
}

function request(test: ReturnType<typeof harness>) {
  return {
    ownerId: "private-owner",
    generationId: "race-merge-generation-1",
    cohortOrdinal: 1,
    cores: [
      {
        sourceCoreId: 202,
        observations: [
          observation({ core: 202, race: "race-2", position: 1, time: 9000 }),
        ],
      },
      {
        sourceCoreId: 101,
        observations: [
          observation({ core: 101, race: "race-1", position: 2, time: 9500 }),
          observation({
            core: 101,
            race: "race-1",
            position: 2,
            time: 9500,
            object: "b".repeat(64),
            row: 2,
          }),
        ],
      },
    ],
    capacityGate: test.capacityGate,
    store: test.store,
    repository: test.repository,
    startedAt: STARTED_AT,
    registeredAt: REGISTERED_AT,
  };
}

describe("Race Merge Core outcome R2 generation", () => {
  it("measures every deterministic object before R2 and checkpoints only verified receipts", async () => {
    const test = harness();

    const result = await commitRaceMergeCoreOutcomeR2Generation(request(test));

    expect(test.events).toEqual([
      "prepare-101",
      "prepare-202",
      "capacity",
      "r2-101",
      "verify-101",
      "r2-202",
      "verify-202",
      "checkpoint-begin",
      "manifest-101",
      "manifest-202",
      "checkpoint-finalize",
    ]);
    expect(result.authority).toMatchObject({
      coreCount: 2,
      uniqueOutcomeCount: 2,
      sourceObservationCount: 3,
      retainedR2Bytes: [...test.objects.values()].reduce(
        (total, object) => total + object.body.byteLength,
        0,
      ),
    });
    expect(result.checkpointAfter).toMatchObject({
      status: "complete",
      registeredCoreCount: 2,
      completedReceiptSetSha256: result.authority.receiptSetSha256,
    });
    expect(result).toMatchObject({
      storageStatuses: ["created", "created"],
      resumedRegisteredCoreCount: 0,
      dnaApiRequestPerformed: false,
      persistentWritePerformed: true,
      paidUsageAllowed: false,
    });
  });

  it("resumes only the missing manifest suffix after a Neon interruption", async () => {
    const test = harness({ failCoreOnce: 202 });

    await expect(
      commitRaceMergeCoreOutcomeR2Generation(request(test)),
    ).rejects.toThrow("synthetic Neon interruption");
    expect(test.manifests.map((value) => value.sourceCoreId)).toEqual([101]);

    const replay = await commitRaceMergeCoreOutcomeR2Generation(request(test));

    expect(replay.storageStatuses).toEqual(["existing", "existing"]);
    expect(replay.resumedRegisteredCoreCount).toBe(1);
    expect(test.manifests.map((value) => value.sourceCoreId)).toEqual([
      101, 202,
    ]);
    expect(
      test.events.filter((value) => value === "manifest-101"),
    ).toHaveLength(1);
  });

  it("captures the durable registration timestamp after fresh capacity approval", async () => {
    const test = harness();
    vi.mocked(
      test.capacityGate.assertFreshCurrentCapacity,
    ).mockImplementationOnce(async (authority) => {
      test.events.push("capacity-late");
      return {
        version: 1,
        generationId: authority.generationId,
        cohortOrdinal: authority.cohortOrdinal,
        receiptSetSha256: authority.receiptSetSha256,
        retainedR2Bytes: authority.retainedR2Bytes,
        measuredAt: "2026-10-03T10:00:30.000Z",
        validUntil: "2026-10-03T10:05:00.000Z",
        capacityAllowed: true,
        projectedPaidCostAud: 0,
      };
    });
    const fixed = request(test);
    const registrationClock = vi.fn(() => {
      test.events.push("registration-clock");
      return new Date(REGISTERED_AT);
    });

    const result = await commitRaceMergeCoreOutcomeR2Generation({
      ownerId: fixed.ownerId,
      generationId: fixed.generationId,
      cohortOrdinal: fixed.cohortOrdinal,
      cores: fixed.cores,
      capacityGate: fixed.capacityGate,
      store: fixed.store,
      repository: fixed.repository,
      startedAt: fixed.startedAt,
      registrationClock,
    });

    expect(result.capacityMeasuredAt).toBe("2026-10-03T10:00:30.000Z");
    expect(registrationClock).toHaveBeenCalledOnce();
    expect(test.events.indexOf("registration-clock")).toBeGreaterThan(
      test.events.indexOf("capacity-late"),
    );
    expect(test.events.indexOf("registration-clock")).toBeLessThan(
      test.events.indexOf("r2-101"),
    );
  });

  it("fails before R2 and checkpoints when fresh capacity does not bind exact bytes", async () => {
    const test = harness();
    vi.mocked(
      test.capacityGate.assertFreshCurrentCapacity,
    ).mockImplementationOnce(async (authority) => ({
      version: 1,
      generationId: authority.generationId,
      cohortOrdinal: authority.cohortOrdinal,
      receiptSetSha256: authority.receiptSetSha256,
      retainedR2Bytes: authority.retainedR2Bytes + 1,
      measuredAt: "2026-10-03T09:59:00.000Z",
      validUntil: "2026-10-03T10:05:00.000Z",
      capacityAllowed: true,
      projectedPaidCostAud: 0,
    }));

    await expect(
      commitRaceMergeCoreOutcomeR2Generation(request(test)),
    ).rejects.toThrow("capacity approval disagrees");
    expect(test.objects.size).toBe(0);
    expect(test.repository.begin).not.toHaveBeenCalled();
  });

  it("fails during local preparation when one Race/Core outcome conflicts", async () => {
    const test = harness();
    const changed = request(test);

    await expect(
      commitRaceMergeCoreOutcomeR2Generation({
        ...changed,
        cores: [
          {
            sourceCoreId: 101,
            observations: [
              observation({
                core: 101,
                race: "race-1",
                position: 1,
                time: 9500,
              }),
              observation({
                core: 101,
                race: "race-1",
                position: 2,
                time: 9500,
                object: "b".repeat(64),
                row: 2,
              }),
            ],
          },
        ],
      }),
    ).rejects.toThrow("Race/Core outcome conflict");
    expect(test.capacityGate.assertFreshCurrentCapacity).not.toHaveBeenCalled();
    expect(test.objects.size).toBe(0);
  });
  it("derives continuation only from one complete durable 100-Core page", async () => {
    const manifests = Object.freeze(
      Array.from({ length: 100 }, (_, index) => {
        const sourceCoreId = index + 1;
        const sourceRaceId = `race-${String(sourceCoreId).padStart(3, "0")}`;
        return Object.freeze({
          version: 1 as const,
          generationId: "race-merge-generation-1",
          sourceCoreId,
          objectKey: `private/outcomes/${sourceCoreId}.jsonl`,
          bodySha256: sourceCoreId.toString(16).padStart(64, "0"),
          byteLength: 10,
          uniqueOutcomeCount: 1,
          sourceObservationCount: 1,
          firstSourceRaceId: sourceRaceId,
          lastSourceRaceId: sourceRaceId,
          registeredAt: REGISTERED_AT,
        });
      }),
    );
    const receiptSetSha256 = raceMergeCoreOutcomeR2ReceiptSetSha256(manifests);
    const begin = vi.fn(async (_ownerId, request) =>
      Object.freeze({
        ...request.authority,
        status: "complete" as const,
        registeredCoreCount: 100,
        registeredUniqueOutcomeCount: 100,
        registeredSourceObservationCount: 100,
        registeredR2Bytes: 1_000,
        lastRegisteredSourceCoreId: 100,
        completedReceiptSetSha256: receiptSetSha256,
        startedAt: STARTED_AT,
        updatedAt: REGISTERED_AT,
      }),
    );
    const repository: RaceMergeCoreOutcomeR2GenerationRepository =
      Object.freeze({
        begin,
        async registerCore() {
          throw new Error("unexpected register");
        },
        async finalize() {
          throw new Error("unexpected finalize");
        },
        async listManifests(_ownerId, request) {
          return manifests
            .filter(
              (manifest) => manifest.sourceCoreId > request.afterSourceCoreId,
            )
            .slice(0, request.limit);
        },
      });

    const result = await readCompleteRaceMergeCoreOutcomeR2Generation({
      ownerId: "private-owner",
      generationId: "race-merge-generation-1",
      cohortOrdinal: 1,
      repository,
    });

    expect(result.authority).toMatchObject({
      cohortOrdinal: 1,
      firstSourceCoreId: 1,
      lastSourceCoreId: 100,
      coreCount: 100,
      uniqueOutcomeCount: 100,
      sourceObservationCount: 100,
      retainedR2Bytes: 1_000,
      receiptSetSha256,
    });
    expect(result.checkpoint.status).toBe("complete");
    expect(begin).toHaveBeenCalledOnce();
  });

  it("refuses continuation from an incomplete predecessor page", async () => {
    const begin = vi.fn();
    const repository: RaceMergeCoreOutcomeR2GenerationRepository =
      Object.freeze({
        begin,
        async registerCore() {
          throw new Error("unexpected register");
        },
        async finalize() {
          throw new Error("unexpected finalize");
        },
        async listManifests() {
          return [];
        },
      });

    await expect(
      readCompleteRaceMergeCoreOutcomeR2Generation({
        ownerId: "private-owner",
        generationId: "race-merge-generation-1",
        cohortOrdinal: 1,
        repository,
      }),
    ).rejects.toThrow("previous cohort is not a complete bounded page");
    expect(begin).not.toHaveBeenCalled();
  });
});
