import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexGenerationRepository,
} from "../lib/dna-population-race-index-generation";
import {
  createDnaPopulationRaceIndexR2CompactionOperator,
  DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT,
  DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION,
} from "../lib/dna-population-race-index-r2-compaction-operator";
import type { DnaOpenLabProviderCapacityPreflight } from "../lib/dna-open-lab-provider-capacity-preflight";

const ownerId = "private-owner";
const generationId = "a".repeat(64);
const attemptedAt = "2026-09-24T10:30:00.000Z";

function checkpoint(
  overrides: Partial<DnaPopulationRaceIndexCheckpoint> = {},
): DnaPopulationRaceIndexCheckpoint {
  return Object.freeze({
    version: 1,
    generationId,
    baselineCompletionSha256: generationId,
    baselineLogicalRequestCount: 17_464,
    baselineRetainedR2Bytes: 874_370_990,
    baselineOmittedIdentityObservationCount: 1,
    state: "staging",
    lastRequestOrdinal: 6_324,
    processedReceiptCount: 6_324,
    processedReceiptBytes: 300_000_000,
    processedIdentityOmissionCount: 0,
    finishedRaceReceiptCount: 6_300,
    canonicalDocumentObservationCount: 420_000,
    uniqueRaceCount: 2,
    uniqueEntrantCoreCount: 0,
    storageLayout: "legacy_neon_v1",
    r2ChunkCount: 0,
    r2IdentityChunkCount: 0,
    r2CompactedRaceCount: 0,
    r2LastSourceRaceId: null,
    compactedAt: null,
    legacyStorageRetiredAt: null,
    updatedAt: attemptedAt,
    completedAt: null,
    publishedAt: null,
    ...overrides,
  });
}

function baseline() {
  return {
    load: vi.fn(async () => ({
      revision: "1",
      status: "complete" as const,
      nextRequestOrdinal: 17_465,
      logicalRequestCount: 17_464,
      retainedR2Bytes: 874_370_990,
      omittedIdentityObservationCount: 1,
      completionSha256: generationId,
    })),
  };
}

function repository() {
  const load = vi.fn(async () => checkpoint());
  const readLegacyChunk = vi.fn(async () => ({
    documents: [
      {
        requestOrdinal: 1,
        endpoint: "races.finished" as const,
        observedAt: "2026-09-02T00:00:00.000Z",
        sourceRaceId: "race-1",
        rawEvidenceSha256: "b".repeat(64),
        canonical: {
          sourceType: "race_document" as const,
          sourceRaceId: "race-1",
          mode: "bike" as const,
        },
      },
      {
        requestOrdinal: 2,
        endpoint: "races.finished" as const,
        observedAt: "2026-09-02T00:00:01.000Z",
        sourceRaceId: "race-2",
        rawEvidenceSha256: "c".repeat(64),
        canonical: {
          sourceType: "race_document" as const,
          sourceRaceId: "race-2",
          mode: "horse" as const,
        },
      },
    ],
  }));
  const registerCompactionChunk = vi.fn(async () =>
    checkpoint({
      r2ChunkCount: 1,
      r2CompactedRaceCount: 2,
      r2LastSourceRaceId: "race-2",
    }),
  );
  const finalizeCompaction = vi.fn(async () =>
    checkpoint({
      storageLayout: "r2_chunked_v1",
      r2ChunkCount: 1,
      r2CompactedRaceCount: 2,
      r2LastSourceRaceId: "race-2",
      compactedAt: attemptedAt,
    }),
  );
  const unused = vi.fn(async () => {
    throw new Error("unexpected repository call");
  });
  return {
    load,
    readLegacyChunk,
    registerCompactionChunk,
    finalizeCompaction,
    value: {
      begin: unused,
      readLegacyChunk,
      registerCompactionChunk,
      finalizeCompaction,
      lookupIdentities: unused,
      appendR2Batch: unused,
      publish: unused,
      load,
    } as unknown as DnaPopulationRaceIndexGenerationRepository,
  };
}

function capacity(
  status: "ready" | "held" = "ready",
  blockerIds: readonly (
    "neon_storage_budget_exhausted" | "r2_storage_class_not_standard"
  )[] = ["neon_storage_budget_exhausted"],
) {
  const inspect = vi.fn(async () =>
    status === "ready"
      ? { status: "ready", preflightSha256: "d".repeat(64) }
      : {
          status: "held",
          reason: "capacity_blocked",
          blockerIds,
        },
  );
  return {
    inspect,
    value: { inspect } as unknown as DnaOpenLabProviderCapacityPreflight,
  };
}

function invocation() {
  return {
    operatorVersion: DNA_POPULATION_RACE_INDEX_R2_COMPACTION_OPERATOR_VERSION,
    intent: DNA_POPULATION_RACE_INDEX_R2_COMPACTION_INTENT,
    allowPersistentWrite: true as const,
    authenticatedOwnerId: ownerId,
    exactCodeHeadSha: "e".repeat(40),
    workerId: "population-r2-compaction-worker",
    attemptedAt,
    maximumRows: 4_000,
  };
}

describe("DNA population race index R2 compaction operator", () => {
  it("writes one exact unique chunk, registers it, then finalizes equivalence", async () => {
    const store = repository();
    const gate = capacity();
    const chunkWrite = vi.fn(async () => ({
      receipt: {
        version: 1 as const,
        generationId,
        chunkOrdinal: 1,
        objectKey: "private/population/chunk-1.json",
        bodySha256: "f".repeat(64),
        byteLength: 512,
        rowCount: 2,
        firstSourceRaceId: "race-1",
        lastSourceRaceId: "race-2",
      },
      storageStatus: "created" as const,
    }));
    const operator = createDnaPopulationRaceIndexR2CompactionOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: gate.value,
      chunkStore: { write: chunkWrite },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      beforeCompactedRaceCount: 0,
      afterCompactedRaceCount: 2,
      uniqueRaceCount: 2,
      r2ChunkCount: 1,
      storageLayout: "r2_chunked_v1",
      r2ObjectCreated: true,
      dnaProviderRequestCount: 0,
      paidUsageAllowed: false,
      preserveLastGood: true,
    });
    expect(store.readLegacyChunk).toHaveBeenCalledWith(ownerId, {
      generationId,
      afterSourceRaceId: null,
      limit: 4_000,
    });
    expect(store.registerCompactionChunk).toHaveBeenCalledOnce();
    expect(store.finalizeCompaction).toHaveBeenCalledOnce();
  });

  it("continues when Neon storage is the only blocker because each chunk is storage-negative", async () => {
    const store = repository();
    const gate = capacity("held");
    const chunkWrite = vi.fn(async () => ({
      receipt: {
        version: 1 as const,
        generationId,
        chunkOrdinal: 1,
        objectKey: "private/population/chunk-1.json",
        bodySha256: "f".repeat(64),
        byteLength: 512,
        rowCount: 2,
        firstSourceRaceId: "race-1",
        lastSourceRaceId: "race-2",
      },
      storageStatus: "created" as const,
    }));
    const operator = createDnaPopulationRaceIndexR2CompactionOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: gate.value,
      chunkStore: { write: chunkWrite },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      afterCompactedRaceCount: 2,
      r2ObjectCreated: true,
      providerCapacityBlockerIds: [],
    });
    expect(store.readLegacyChunk).toHaveBeenCalledOnce();
    expect(chunkWrite).toHaveBeenCalledOnce();
  });

  it("still holds before writes when any non-storage blocker is present", async () => {
    const store = repository();
    const gate = capacity("held", [
      "neon_storage_budget_exhausted",
      "r2_storage_class_not_standard",
    ]);
    const chunkWrite = vi.fn();
    const operator = createDnaPopulationRaceIndexR2CompactionOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: gate.value,
      chunkStore: { write: chunkWrite },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "held",
      afterCompactedRaceCount: 0,
      r2ObjectCreated: false,
      providerCapacityBlockerIds: [
        "neon_storage_budget_exhausted",
        "r2_storage_class_not_standard",
      ],
    });
    expect(store.readLegacyChunk).not.toHaveBeenCalled();
    expect(chunkWrite).not.toHaveBeenCalled();
  });
});
