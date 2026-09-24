import { describe, expect, it, vi } from "vitest";

import type {
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexGenerationRepository,
} from "../lib/dna-population-race-index-generation";
import {
  createDnaPopulationRaceIndexR2IdentityBackfillOperator,
  DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT,
  DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION,
} from "../lib/dna-population-race-index-r2-identity-backfill-operator";
import type { DnaOpenLabProviderCapacityPreflight } from "../lib/dna-open-lab-provider-capacity-preflight";

const ownerId = "private-owner";
const generationId = "a".repeat(64);
const attemptedAt = "2026-09-24T12:30:00.000Z";

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
    lastRequestOrdinal: 8_254,
    processedReceiptCount: 8_254,
    processedReceiptBytes: 400_000_000,
    processedIdentityOmissionCount: 0,
    finishedRaceReceiptCount: 8_200,
    canonicalDocumentObservationCount: 541_502,
    uniqueRaceCount: 2,
    uniqueEntrantCoreCount: 0,
    storageLayout: "r2_chunked_v1",
    r2ChunkCount: 1,
    r2IdentityChunkCount: 0,
    r2CompactedRaceCount: 2,
    r2LastSourceRaceId: "race-2",
    compactedAt: attemptedAt,
    legacyStorageRetiredAt: attemptedAt,
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

function capacity(status: "ready" | "held" = "ready") {
  return {
    inspect: vi.fn(async () =>
      status === "ready"
        ? { status: "ready" as const, preflightSha256: "e".repeat(64) }
        : {
            status: "held" as const,
            reason: "capacity_blocked" as const,
            blockerIds: ["neon_storage_budget_exhausted"] as const,
          },
    ),
  } as unknown as DnaOpenLabProviderCapacityPreflight;
}

function repository() {
  const load = vi.fn(async () => checkpoint());
  const listR2ChunkManifests = vi.fn(async () => [
    {
      version: 1 as const,
      generationId,
      chunkOrdinal: 1,
      objectKey: "private/population/chunk-1.json",
      bodySha256: "b".repeat(64),
      byteLength: 512,
      rowCount: 2,
      firstSourceRaceId: "race-1",
      lastSourceRaceId: "race-2",
      registeredAt: attemptedAt,
      identityRegisteredAt: null,
    },
  ]);
  const registerCompactIdentityChunk = vi.fn(async () =>
    checkpoint({ r2IdentityChunkCount: 1 }),
  );
  return {
    load,
    listR2ChunkManifests,
    registerCompactIdentityChunk,
    value: {
      load,
      listR2ChunkManifests,
      registerCompactIdentityChunk,
    } as unknown as DnaPopulationRaceIndexGenerationRepository,
  };
}

function invocation() {
  return {
    operatorVersion:
      DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_OPERATOR_VERSION,
    intent: DNA_POPULATION_RACE_INDEX_R2_IDENTITY_BACKFILL_INTENT,
    allowPersistentWrite: true as const,
    authenticatedOwnerId: ownerId,
    exactCodeHeadSha: "c".repeat(40),
    workerId: "population-r2-identity-preview-worker",
    attemptedAt,
  };
}

describe("DNA population race index R2 identity backfill operator", () => {
  it("verifies one R2 chunk and advances exactly one durable identity checkpoint", async () => {
    const store = repository();
    const read = vi.fn(async () => [
      { sourceRaceId: "race-1", rawEvidenceSha256: "d".repeat(64) },
      { sourceRaceId: "race-2", rawEvidenceSha256: "e".repeat(64) },
    ]);
    const operator = createDnaPopulationRaceIndexR2IdentityBackfillOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: capacity(),
      chunkStore: { read },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      beforeIdentityChunkCount: 0,
      afterIdentityChunkCount: 1,
      r2ChunkCount: 1,
      r2ReadPerformed: true,
      dnaProviderRequestCount: 0,
      paidUsageAllowed: false,
    });
    expect(read).toHaveBeenCalledOnce();
    expect(store.registerCompactIdentityChunk).toHaveBeenCalledWith(
      ownerId,
      expect.objectContaining({
        chunkOrdinal: 1,
        identities: [
          { sourceRaceId: "race-1", rawEvidenceSha256: "d".repeat(64) },
          { sourceRaceId: "race-2", rawEvidenceSha256: "e".repeat(64) },
        ],
      }),
    );
  });

  it("holds without an R2 read or Neon write when capacity is closed", async () => {
    const store = repository();
    const read = vi.fn();
    const operator = createDnaPopulationRaceIndexR2IdentityBackfillOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: capacity("held"),
      chunkStore: { read },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "held",
      reason: "provider_capacity_capacity_blocked",
      beforeIdentityChunkCount: 0,
      afterIdentityChunkCount: 0,
      r2ReadPerformed: false,
    });
    expect(read).not.toHaveBeenCalled();
    expect(store.registerCompactIdentityChunk).not.toHaveBeenCalled();
  });

  it("is a no-op after every manifest has a compact identity checkpoint", async () => {
    const store = repository();
    store.load.mockResolvedValueOnce(checkpoint({ r2IdentityChunkCount: 1 }));
    const read = vi.fn();
    const operator = createDnaPopulationRaceIndexR2IdentityBackfillOperator({
      configuredOwnerId: ownerId,
      baseline: baseline(),
      repository: store.value,
      capacityPreflight: capacity(),
      chunkStore: { read },
    });

    await expect(operator.execute(invocation())).resolves.toMatchObject({
      status: "complete",
      beforeIdentityChunkCount: 1,
      afterIdentityChunkCount: 1,
      r2ReadPerformed: false,
    });
    expect(store.listR2ChunkManifests).not.toHaveBeenCalled();
    expect(read).not.toHaveBeenCalled();
  });
});
