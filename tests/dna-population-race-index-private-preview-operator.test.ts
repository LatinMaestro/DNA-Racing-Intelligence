import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexGenerationRepository,
} from "../lib/dna-population-race-index-generation";
import {
  createDnaPopulationRaceIndexPrivatePreviewOperator,
  DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT,
  DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION,
} from "../lib/dna-population-race-index-private-preview-operator";
import type { DnaOpenLabProviderCapacityPreflight } from "../lib/dna-open-lab-provider-capacity-preflight";

const ownerId = "private-owner";
const completionSha256 = "a".repeat(64);
const exactCodeHeadSha = "b".repeat(40);
const attemptedAt = "2026-09-24T04:00:00.000Z";

function baseline() {
  const receipts = [
    {
      family: "finished_races" as const,
      requestOrdinal: 1,
      observedAt: "2026-09-02T00:00:00.000Z",
      contentSha256: "c".repeat(64),
      byteLength: 10,
      evidenceObjectKey: "private/1.json",
      omittedIdentityObservationCount: 0 as const,
      quarantineBound: false,
    },
    {
      family: "core_current_state" as const,
      requestOrdinal: 2,
      observedAt: "2026-09-02T00:00:01.000Z",
      contentSha256: "d".repeat(64),
      byteLength: 20,
      evidenceObjectKey: "private/2.json",
      omittedIdentityObservationCount: 0 as const,
      quarantineBound: false,
    },
  ];
  const loadReceipts = vi.fn(
    async ({
      afterRequestOrdinal,
      limit,
    }: {
      afterRequestOrdinal: number;
      limit?: number;
    }) =>
      receipts
        .filter((receipt) => receipt.requestOrdinal > afterRequestOrdinal)
        .slice(0, limit),
  );
  const readEvidence = vi.fn(async () => ({
    family: "finished_races" as const,
    requestOrdinal: 1,
    endpoint: "races.finished",
    request: {},
    response: {
      result: [
        {
          rid: 101,
          rvmode: "bike",
          format: "sprint",
          hids: [501, 502],
        },
      ],
      httpStatus: 200,
      rateLimit: {
        limit: null,
        remaining: null,
        resetSeconds: null,
        rateClass: null,
        retryAfterSeconds: null,
      },
    },
    observedAt: "2026-09-02T00:00:00.000Z",
  }));
  return {
    value: {
      load: vi.fn(async () => ({
        revision: "1",
        status: "complete" as const,
        nextRequestOrdinal: 17_465,
        logicalRequestCount: 17_464,
        retainedR2Bytes: 874_370_990,
        omittedIdentityObservationCount: 1,
        completionSha256,
      })),
      loadReceipts,
      readEvidence,
    },
    loadReceipts,
    readEvidence,
  };
}

function checkpoint(
  overrides: Partial<DnaPopulationRaceIndexCheckpoint> = {},
): DnaPopulationRaceIndexCheckpoint {
  return Object.freeze({
    version: 1,
    generationId: completionSha256,
    baselineCompletionSha256: completionSha256,
    baselineLogicalRequestCount: 17_464,
    baselineRetainedR2Bytes: 874_370_990,
    baselineOmittedIdentityObservationCount: 1,
    state: "staging",
    lastRequestOrdinal: 0,
    processedReceiptCount: 0,
    processedReceiptBytes: 0,
    processedIdentityOmissionCount: 0,
    finishedRaceReceiptCount: 0,
    canonicalDocumentObservationCount: 0,
    uniqueRaceCount: 0,
    uniqueEntrantCoreCount: 0,
    storageLayout: "r2_chunked_v1",
    r2ChunkCount: 0,
    r2CompactedRaceCount: 0,
    r2LastSourceRaceId: null,
    compactedAt: attemptedAt,
    legacyStorageRetiredAt: attemptedAt,
    updatedAt: attemptedAt,
    completedAt: null,
    publishedAt: null,
    ...overrides,
  });
}

function repository(existing: DnaPopulationRaceIndexCheckpoint | null = null) {
  const begin = vi.fn(async () => checkpoint());
  const readLegacyChunk = vi.fn(async () => ({ documents: [] }));
  const registerCompactionChunk = vi.fn(async () => checkpoint());
  const finalizeCompaction = vi.fn(async () => checkpoint());
  const lookupIdentities = vi.fn(async () => []);
  const appendR2Batch = vi.fn(async () =>
    checkpoint({
      lastRequestOrdinal: 2,
      processedReceiptCount: 2,
      processedReceiptBytes: 30,
      finishedRaceReceiptCount: 1,
      canonicalDocumentObservationCount: 1,
      uniqueRaceCount: 1,
      uniqueEntrantCoreCount: 2,
      r2ChunkCount: 1,
      r2CompactedRaceCount: 1,
    }),
  );
  const publish = vi.fn(async () =>
    checkpoint({ state: "published", publishedAt: attemptedAt }),
  );
  const load = vi.fn(async () => existing);
  return {
    value: {
      begin,
      readLegacyChunk,
      registerCompactionChunk,
      finalizeCompaction,
      lookupIdentities,
      appendR2Batch,
      publish,
      load,
    } satisfies DnaPopulationRaceIndexGenerationRepository,
    begin,
    readLegacyChunk,
    registerCompactionChunk,
    finalizeCompaction,
    lookupIdentities,
    appendR2Batch,
    publish,
    load,
  };
}

function capacity(status: "ready" | "held" = "ready") {
  const inspect = vi.fn(async () =>
    status === "ready"
      ? { status: "ready", preflightSha256: "e".repeat(64) }
      : {
          status: "held",
          reason: "capacity_blocked",
          blockerIds: ["neon_storage_budget_exhausted"],
        },
  );
  return {
    inspect,
    value: { inspect } as unknown as DnaOpenLabProviderCapacityPreflight,
  };
}

function chunkStore() {
  const write = vi.fn(async () => ({
    receipt: {
      version: 1 as const,
      generationId: completionSha256,
      chunkOrdinal: 1,
      objectKey: "private/population/1.json",
      bodySha256: "f".repeat(64),
      byteLength: 256,
      rowCount: 1,
      firstSourceRaceId: "101",
      lastSourceRaceId: "101",
    },
    storageStatus: "created" as const,
  }));
  return { write, value: { write } };
}

function invocation() {
  return {
    operatorVersion: DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_OPERATOR_VERSION,
    intent: DNA_POPULATION_RACE_INDEX_PRIVATE_PREVIEW_INTENT,
    allowPersistentWrite: true as const,
    authenticatedOwnerId: ownerId,
    exactCodeHeadSha,
    workerId: "population-index-preview-worker",
    attemptedAt,
    maximumReceiptCount: 2,
  };
}

describe("DNA population race index private Preview operator", () => {
  it("measures capacity and advances one durable bounded receipt slice", async () => {
    const source = baseline();
    const store = repository();
    const gate = capacity();
    const operator = createDnaPopulationRaceIndexPrivatePreviewOperator({
      configuredOwnerId: ownerId,
      baseline: source.value,
      repository: store.value,
      capacityPreflight: gate.value,
      chunkStore: chunkStore().value,
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "advanced",
      beforeRequestOrdinal: 0,
      afterRequestOrdinal: 2,
      processedReceiptCount: 2,
      uniqueRaceCount: 1,
      uniqueEntrantCoreCount: 2,
      persistentWriteArmed: true,
      previewOnly: true,
      dnaProviderRequestCount: 0,
      providerWritePerformed: false,
      paidUsageAllowed: false,
      preserveLastGood: true,
      providerWritePerformed: true,
    });
    expect(gate.inspect).toHaveBeenCalledOnce();
    expect(gate.inspect).toHaveBeenCalledWith(
      expect.objectContaining({ projectionHorizon: "single_refresh" }),
    );
    expect(store.begin).toHaveBeenCalledOnce();
    expect(store.appendR2Batch).toHaveBeenCalledOnce();
    expect(store.publish).not.toHaveBeenCalled();
    expect(source.readEvidence).toHaveBeenCalledOnce();
  });

  it("holds before the first evidence read or database write when capacity is closed", async () => {
    const source = baseline();
    const store = repository();
    const gate = capacity("held");
    const operator = createDnaPopulationRaceIndexPrivatePreviewOperator({
      configuredOwnerId: ownerId,
      baseline: source.value,
      repository: store.value,
      capacityPreflight: gate.value,
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "held",
      reason: "provider_capacity_capacity_blocked",
      providerCapacityBlockerIds: ["neon_storage_budget_exhausted"],
      processedReceiptCount: 0,
    });
    expect(source.loadReceipts).not.toHaveBeenCalled();
    expect(source.readEvidence).not.toHaveBeenCalled();
    expect(store.begin).not.toHaveBeenCalled();
    expect(store.appendR2Batch).not.toHaveBeenCalled();
  });

  it("returns complete without capacity measurement or writes for an active generation", async () => {
    const source = baseline();
    const store = repository(
      checkpoint({
        state: "published",
        lastRequestOrdinal: 17_464,
        processedReceiptCount: 17_464,
        publishedAt: attemptedAt,
      }),
    );
    const gate = capacity();
    const operator = createDnaPopulationRaceIndexPrivatePreviewOperator({
      configuredOwnerId: ownerId,
      baseline: source.value,
      repository: store.value,
      capacityPreflight: gate.value,
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      processedReceiptCount: 0,
      afterRequestOrdinal: 17_464,
    });
    expect(gate.inspect).not.toHaveBeenCalled();
    expect(store.begin).not.toHaveBeenCalled();
    expect(store.appendR2Batch).not.toHaveBeenCalled();
  });

  it("rejects missing write authority, owner drift and oversized batches", async () => {
    const source = baseline();
    const store = repository();
    const gate = capacity();
    const operator = createDnaPopulationRaceIndexPrivatePreviewOperator({
      configuredOwnerId: ownerId,
      baseline: source.value,
      repository: store.value,
      capacityPreflight: gate.value,
    });

    await expect(
      operator.execute({
        ...invocation(),
        allowPersistentWrite: false,
      } as never),
    ).rejects.toThrow("invocation is not explicitly armed");
    await expect(
      operator.execute({ ...invocation(), authenticatedOwnerId: "other" }),
    ).rejects.toThrow("owner scope denied");
    await expect(
      operator.execute({ ...invocation(), maximumReceiptCount: 101 }),
    ).rejects.toThrow("receipt bound is invalid");
    expect(gate.inspect).not.toHaveBeenCalled();
  });
});
