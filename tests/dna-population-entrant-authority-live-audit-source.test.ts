import { describe, expect, it, vi } from "vitest";

import {
  createDnaPopulationEntrantAuthorityLiveAuditSource,
} from "@/lib/dna-population-entrant-authority-live-audit-source";
import type { DnaPopulationRaceIndexDocument } from "@/lib/dna-population-race-index-checkpoint";
import type {
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexR2ChunkManifest,
} from "@/lib/dna-population-race-index-generation";

const OWNER = "private-owner";
const HEAD = "a".repeat(40);
const COMPLETION = "b".repeat(64);
const OBSERVED_AT = "2026-09-25T00:00:00.000Z";

function document(
  sourceRaceId: string,
  requestOrdinal: number,
): DnaPopulationRaceIndexDocument {
  return Object.freeze({
    requestOrdinal,
    endpoint: "races.finished" as const,
    observedAt: OBSERVED_AT,
    sourceRaceId,
    rawEvidenceSha256: "c".repeat(64),
    canonical: Object.freeze({
      sourceType: "race_document" as const,
      sourceRaceId,
      mode: "bike" as const,
    }),
  });
}

function manifest(input: {
  ordinal: number;
  first: string;
  last: string;
  rows: number;
}): DnaPopulationRaceIndexR2ChunkManifest {
  return Object.freeze({
    version: 1,
    generationId: COMPLETION,
    chunkOrdinal: input.ordinal,
    objectKey: `private/chunk-${String(input.ordinal)}.json`,
    bodySha256: "d".repeat(64),
    byteLength: 100,
    rowCount: input.rows,
    firstSourceRaceId: input.first,
    lastSourceRaceId: input.last,
    registeredAt: OBSERVED_AT,
    identityRegisteredAt: OBSERVED_AT,
  });
}

function checkpoint(
  overrides: Partial<DnaPopulationRaceIndexCheckpoint> = {},
): DnaPopulationRaceIndexCheckpoint {
  return Object.freeze({
    version: 1,
    generationId: COMPLETION,
    baselineCompletionSha256: COMPLETION,
    baselineLogicalRequestCount: 17_464,
    baselineRetainedR2Bytes: 874_370_990,
    baselineOmittedIdentityObservationCount: 1,
    state: "published" as const,
    lastRequestOrdinal: 17_464,
    processedReceiptCount: 17_464,
    processedReceiptBytes: 874_370_990,
    processedIdentityOmissionCount: 1,
    finishedRaceReceiptCount: 17_369,
    canonicalDocumentObservationCount: 3,
    uniqueRaceCount: 3,
    uniqueEntrantCoreCount: 0,
    storageLayout: "r2_chunked_v1" as const,
    r2ChunkCount: 2,
    r2IdentityChunkCount: 2,
    r2CompactedRaceCount: 3,
    r2LastSourceRaceId: "race-3",
    compactedAt: OBSERVED_AT,
    legacyStorageRetiredAt: OBSERVED_AT,
    updatedAt: OBSERVED_AT,
    completedAt: OBSERVED_AT,
    publishedAt: OBSERVED_AT,
    ...overrides,
  });
}

function harness(input?: {
  baselineCount?: number;
  classBOperations?: number;
  manifests?: readonly DnaPopulationRaceIndexR2ChunkManifest[];
  chunks?: Readonly<Record<number, readonly DnaPopulationRaceIndexDocument[]>>;
}) {
  const manifests =
    input?.manifests ??
    Object.freeze([
      manifest({ ordinal: 1, first: "race-1", last: "race-2", rows: 2 }),
      manifest({ ordinal: 2, first: "race-3", last: "race-3", rows: 1 }),
    ]);
  const chunks =
    input?.chunks ??
    Object.freeze({
      1: Object.freeze([document("race-1", 1), document("race-2", 2)]),
      2: Object.freeze([document("race-3", 3)]),
    });

  return {
    capacitySource: Object.freeze({
      status: "ready" as const,
      measure: vi.fn(async () =>
        Object.freeze({
          evidenceSource: "provider_api" as const,
          r2StorageClass: "Standard",
          measuredAt: "2026-09-26T00:00:00.000Z",
          billingWindowStartAt: "2026-09-01T00:00:00.000Z",
          billingWindowEndAt: "2026-10-01T00:00:00.000Z",
          currentR2Usage: Object.freeze({
            storageBytes: 1_000,
            classAOperations: 1_000,
            classBOperations: input?.classBOperations ?? 1_000,
          }),
          neonMeasuredAt: "2026-09-26T00:00:00.000Z",
          neonBillingWindowStartAt: "2026-09-01T00:00:00.000Z",
          neonBillingWindowEndAt: "2026-10-01T00:00:00.000Z",
          currentNeonUsage: Object.freeze({
            storageBytes: 1_000,
            computeMilliCuHours: 1_000,
          }),
        }),
      ),
    }),
    baseline: {
      load: vi.fn(async () =>
        Object.freeze({
          revision: "1",
          status: "complete" as const,
          nextRequestOrdinal: 17_465,
          logicalRequestCount: input?.baselineCount ?? 17_464,
          retainedR2Bytes: 874_370_990,
          omittedIdentityObservationCount: 1,
          completionSha256: COMPLETION,
        }),
      ),
    },
    populationIndex: {
      load: vi.fn(async () => checkpoint()),
      listPublishedR2ChunkManifests: vi.fn(
        async (
          _ownerId: string,
          request: { afterChunkOrdinal: number; limit: number },
        ) =>
          Object.freeze(
            manifests
              .filter(
                (entry) => entry.chunkOrdinal > request.afterChunkOrdinal,
              )
              .slice(0, request.limit),
          ),
      ),
    },
    chunkStore: {
      read: vi.fn(async (receipt: DnaPopulationRaceIndexR2ChunkManifest) => {
        const value = chunks[receipt.chunkOrdinal];
        if (value === undefined) throw new Error("missing synthetic chunk");
        return value;
      }),
    },
  };
}

describe("population entrant live audit source", () => {
  it("rebuilds the exact unresolved authority from published compact P5 Race documents", async () => {
    const target = harness();
    const source = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: OWNER,
      exactCodeHeadSha: HEAD,
      baseline: target.baseline,
      populationIndex: target.populationIndex,
      chunkStore: target.chunkStore,
      capacitySource: target.capacitySource,
    });

    const result = await source.load({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    expect(result.exactCodeHeadSha).toBe(HEAD);
    expect(result.raceDocuments.map((entry) => entry.sourceRaceId)).toEqual([
      "race-1",
      "race-2",
      "race-3",
    ]);
    expect(result.plan).toMatchObject({
      status: "held_incomplete_race_authority",
      unresolvedRaceCount: 3,
    });
    expect(result.authority).toEqual({
      version: 1,
      generationId: result.plan.unresolvedRaceSetSha256,
      unresolvedRaceCount: 3,
      unresolvedRaceSetSha256: result.plan.unresolvedRaceSetSha256,
    });
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
  });

  it("rejects owner or exact-head drift before durable reads", async () => {
    const target = harness();
    const source = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: OWNER,
      exactCodeHeadSha: HEAD,
      baseline: target.baseline,
      populationIndex: target.populationIndex,
      chunkStore: target.chunkStore,
      capacitySource: target.capacitySource,
    });

    await expect(
      source.load({ ownerId: "other-owner", exactCodeHeadSha: HEAD }),
    ).rejects.toThrow("request binding is invalid");
    await expect(
      source.load({ ownerId: OWNER, exactCodeHeadSha: "f".repeat(40) }),
    ).rejects.toThrow("request binding is invalid");
    expect(target.baseline.load).not.toHaveBeenCalled();
  });


  it("fails closed before durable reads when zero-cost R2 read headroom is unavailable", async () => {
    const target = harness({ classBOperations: 9_950_001 });
    const source = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: OWNER,
      exactCodeHeadSha: HEAD,
      baseline: target.baseline,
      populationIndex: target.populationIndex,
      chunkStore: target.chunkStore,
      capacitySource: target.capacitySource,
    });

    await expect(
      source.load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toThrow("published Race audit read budget is unavailable");
    expect(target.baseline.load).not.toHaveBeenCalled();
  });

  it("fails closed when immutable P5 baseline totals drift", async () => {
    const target = harness({ baselineCount: 17_463 });
    const source = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: OWNER,
      exactCodeHeadSha: HEAD,
      baseline: target.baseline,
      populationIndex: target.populationIndex,
      chunkStore: target.chunkStore,
      capacitySource: target.capacitySource,
    });

    await expect(
      source.load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toThrow("immutable P5 baseline authority is unavailable");
    expect(target.populationIndex.load).not.toHaveBeenCalled();
  });

  it("fails closed when a published manifest range disagrees with the canonical chunk", async () => {
    const target = harness({
      manifests: Object.freeze([
        manifest({
          ordinal: 1,
          first: "race-1",
          last: "race-x",
          rows: 2,
        }),
        manifest({ ordinal: 2, first: "race-3", last: "race-3", rows: 1 }),
      ]),
    });
    const source = createDnaPopulationEntrantAuthorityLiveAuditSource({
      configuredOwnerId: OWNER,
      exactCodeHeadSha: HEAD,
      baseline: target.baseline,
      populationIndex: target.populationIndex,
      chunkStore: target.chunkStore,
      capacitySource: target.capacitySource,
    });

    await expect(
      source.load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toThrow("published chunk disagrees with its manifest");
  });
});
