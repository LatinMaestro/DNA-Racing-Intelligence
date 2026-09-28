import { describe, expect, it, vi } from "vitest";

import type { DnaOpenLabCombinedHistoryPerformanceEvidenceAssessment } from "@/lib/dna-open-lab-combined-history-performance-evidence";
import { DnaOpenLabProviderCapacityMeasurementError } from "@/lib/dna-open-lab-provider-capacity-preflight";
import {
  createDnaPopulationEntrantAuthorityLiveAuditSource,
  DnaPopulationEntrantAuthorityLiveAuditError,
} from "@/lib/dna-population-entrant-authority-live-audit-source";
import type { DnaPopulationRaceIndexDocument } from "@/lib/dna-population-race-index-checkpoint";
import type {
  DnaPopulationRaceIndexCheckpoint,
  DnaPopulationRaceIndexR2ChunkManifest,
} from "@/lib/dna-population-race-index-generation";
import type { DnaPopulationRaceIndexR2ChunkReceipt } from "@/lib/dna-population-race-index-r2-chunk";
import type { CanonicalRaceDocumentMetadata } from "@/lib/dna-open-lab-v1-adapters";
import type { NeonDnaOpenLabSyncPublicationRepository } from "@/lib/neon-dna-open-lab-sync-publication";

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

function checkpoint(): DnaPopulationRaceIndexCheckpoint {
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
  });
}

function assessment(
  uniqueRaceCount: number,
): DnaOpenLabCombinedHistoryPerformanceEvidenceAssessment {
  return Object.freeze({
    authority: "complete_serving_generation_combined_finished_history",
    refreshCycleId: "refresh-1",
    currentStateGenerationId: "current-1",
    baselineReceiptCount: 17_464,
    baselineFinishedRaceReceiptCount: 17_369,
    incrementalWindowCount: uniqueRaceCount > 3 ? 1 : 0,
    incrementalDocumentReferenceCount: Math.max(0, uniqueRaceCount - 3),
    incrementalMaximumRaceDocumentBytes: uniqueRaceCount > 3 ? 100 : 0,
    incrementalMaximumCompactEntrantAuthorityBytes:
      uniqueRaceCount > 3 ? 200 : 0,
    quarantinedIdentityObservationCount: 1,
    r2ClassBOperationsUsed: 4,
    uniqueRaceCount,
    duplicateRaceEvidenceCount: 0,
    conflictingRaceEvidenceCount: 0,
    bikeRaceCount: 3,
    bikeRaceWithFormatCount: 0,
    bikeRaceWithTrackSourceValueCount: 0,
    exactTypeAndDistanceElapsedObservationCount: 0,
    performanceSelectionStatus:
      "held_without_exact_format_elapsed_time_evidence",
    unavailableAuthorities: Object.freeze([
      "authoritative_exact_distance",
      "authoritative_elapsed_time",
      "authoritative_finish_position",
    ] as const),
    rawEvidenceExposed: false,
    persistentWritePerformed: false,
    paidUsageAllowed: false,
  });
}

function harness(input?: {
  baselineCount?: number;
  classBOperations?: number;
  history?: Readonly<{
    receiptCount: number;
    documentCount: number;
    manifestByteLength: number;
  }>;
  manifests?: readonly DnaPopulationRaceIndexR2ChunkManifest[];
  chunks?: Readonly<Record<number, readonly DnaPopulationRaceIndexDocument[]>>;
}) {
  const manifests =
    input?.manifests ??
    Object.freeze([
      manifest({ ordinal: 1, first: "race-1", last: "race-2", rows: 2 }),
      manifest({ ordinal: 2, first: "race-3", last: "race-3", rows: 1 }),
    ]);
  const chunks: Readonly<
    Record<number, readonly DnaPopulationRaceIndexDocument[]>
  > =
    input?.chunks ??
    Object.freeze({
      1: Object.freeze([document("race-1", 1), document("race-2", 2)]),
      2: Object.freeze([document("race-3", 3)]),
    });

  const readServingFinishedHistory = vi.fn<
    NeonDnaOpenLabSyncPublicationRepository["readServingFinishedHistory"]
  >(async () =>
    Object.freeze({
      refreshCycleId: "refresh-1",
      currentStateGenerationId: "current-1",
      selectedCycleId: "cycle-1",
      cycles: Object.freeze([]),
      receiptCount: input?.history?.receiptCount ?? 0,
      documentCount: input?.history?.documentCount ?? 0,
      manifestByteLength: input?.history?.manifestByteLength ?? 0,
    }),
  );

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
      loadReceipts: vi.fn(async () => Object.freeze([])),
      readEvidence: vi.fn(async () => null),
    },
    historySource: {
      readServingFinishedHistory,
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
              .filter((entry) => entry.chunkOrdinal > request.afterChunkOrdinal)
              .slice(0, request.limit),
          ),
      ),
    },
    chunkStore: {
      read: vi.fn(async (receipt: DnaPopulationRaceIndexR2ChunkReceipt) => {
        const value = chunks[receipt.chunkOrdinal];
        if (value === undefined) throw new Error("missing synthetic chunk");
        return value;
      }),
    },
    storage: {
      readBucketPrivacy: vi.fn(),
      headObject: vi.fn(),
      getObject: vi.fn(),
    },
  };
}

function source(
  target: ReturnType<typeof harness>,
  extras: readonly CanonicalRaceDocumentMetadata[] = [],
  fullAuditReuseCount: 0 | 1 | 2 = 0,
) {
  return createDnaPopulationEntrantAuthorityLiveAuditSource({
    configuredOwnerId: OWNER,
    exactCodeHeadSha: HEAD,
    bucketName: "private-preview",
    baseline: target.baseline,
    historySource: target.historySource,
    populationIndex: target.populationIndex,
    chunkStore: target.chunkStore,
    storage: target.storage as never,
    capacitySource: target.capacitySource,
    fullAuditReuseCount,
    assessCombinedHistory: async (input) => {
      await input.baselineIndex!.scanDocuments!((entry) => {
        input.onCanonicalRaceDocument?.(entry.canonical);
      });
      for (const entry of extras) {
        input.onCanonicalRaceDocument?.(entry);
      }
      return assessment(3 + extras.length);
    },
  });
}

describe("population entrant live audit source", () => {
  it("rebuilds the exact unresolved authority from the compact baseline", async () => {
    const target = harness();
    const result = await source(target).load({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    expect(result.raceDocuments.map((entry) => entry.sourceRaceId)).toEqual([
      "race-1",
      "race-2",
      "race-3",
    ]);
    expect(result.authority).toMatchObject({
      version: 1,
      unresolvedRaceCount: 3,
    });
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
  });

  it("reuses a fresh full audit only for the configured immediate checks", async () => {
    const target = harness();
    const live = source(target, [], 2);
    const request = Object.freeze({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    const first = await live.load(request);
    const second = await live.load(request);
    const third = await live.load(request);

    expect(second).toBe(first);
    expect(third).toBe(first);
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
    expect(target.capacitySource.measure).toHaveBeenCalledTimes(1);
    expect(
      target.historySource.readServingFinishedHistory,
    ).toHaveBeenCalledTimes(3);

    const fourth = await live.load(request);

    expect(fourth).not.toBe(first);
    expect(target.chunkStore.read).toHaveBeenCalledTimes(4);
    expect(target.capacitySource.measure).toHaveBeenCalledTimes(2);
  });

  it("fails closed when serving finished-history metadata changes during reuse", async () => {
    const target = harness();
    const live = source(target, [], 2);
    const request = Object.freeze({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    await live.load(request);
    target.historySource.readServingFinishedHistory.mockResolvedValueOnce(
      Object.freeze({
        refreshCycleId: "refresh-2",
        currentStateGenerationId: "current-2",
        selectedCycleId: "cycle-2",
        cycles: Object.freeze([]),
        receiptCount: 1,
        documentCount: 1,
        manifestByteLength: 1,
      }),
    );

    await expect(live.load(request)).rejects.toMatchObject({
      diagnostic: "cached_authority_unavailable",
    });
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
  });

  it("accepts append-ordered chunks whose Race ranges are not globally sorted", async () => {
    const target = harness({
      manifests: Object.freeze([
        manifest({ ordinal: 1, first: "race-2", last: "race-3", rows: 2 }),
        manifest({ ordinal: 2, first: "race-1", last: "race-1", rows: 1 }),
      ]),
      chunks: Object.freeze({
        1: Object.freeze([document("race-2", 1), document("race-3", 2)]),
        2: Object.freeze([document("race-1", 3)]),
      }),
    });

    const result = await source(target).load({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    expect(result.raceDocuments.map((entry) => entry.sourceRaceId)).toEqual([
      "race-2",
      "race-3",
      "race-1",
    ]);
    expect(result.authority).toMatchObject({
      version: 1,
      unresolvedRaceCount: 3,
    });
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
  });

  it("still rejects a duplicate Race identity across append-ordered chunks", async () => {
    const target = harness({
      manifests: Object.freeze([
        manifest({ ordinal: 1, first: "race-1", last: "race-2", rows: 2 }),
        manifest({ ordinal: 2, first: "race-2", last: "race-2", rows: 1 }),
      ]),
      chunks: Object.freeze({
        1: Object.freeze([document("race-1", 1), document("race-2", 2)]),
        2: Object.freeze([document("race-2", 3)]),
      }),
    });

    await expect(
      source(target).load({
        ownerId: OWNER,
        exactCodeHeadSha: HEAD,
      }),
    ).rejects.toMatchObject({
      diagnostic: "combined_history_unavailable",
    });
  });

  it("includes serving incremental Race documents in the exact authority", async () => {
    const target = harness();
    const incremental = Object.freeze({
      sourceType: "race_document" as const,
      sourceRaceId: "race-4",
      mode: "car" as const,
    });

    const result = await source(target, [incremental]).load({
      ownerId: OWNER,
      exactCodeHeadSha: HEAD,
    });

    expect(result.raceDocuments.map((entry) => entry.sourceRaceId)).toEqual([
      "race-1",
      "race-2",
      "race-3",
      "race-4",
    ]);
    expect(result.authority.unresolvedRaceCount).toBe(4);
    expect(
      target.historySource.readServingFinishedHistory,
    ).toHaveBeenCalledWith({
      ownerId: OWNER,
    });
  });

  it("rejects owner or exact-head drift before durable reads", async () => {
    const target = harness();
    const live = source(target);

    await expect(
      live.load({ ownerId: "other-owner", exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({
      diagnostic: "request_binding_unavailable",
    });
    await expect(
      live.load({ ownerId: OWNER, exactCodeHeadSha: "f".repeat(40) }),
    ).rejects.toMatchObject({
      diagnostic: "request_binding_unavailable",
    });
    expect(target.baseline.load).not.toHaveBeenCalled();
  });

  it("uses only available zero-cost R2 headroom instead of reserving the fixed ceiling", async () => {
    const target = harness({ classBOperations: 8_999_996 });

    await expect(
      source(target).load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).resolves.toMatchObject({
      authority: { unresolvedRaceCount: 3 },
    });
    expect(target.chunkStore.read).toHaveBeenCalledTimes(2);
  });

  it("fails closed before R2 evidence reads when the known read floor exceeds headroom", async () => {
    const target = harness({
      classBOperations: 8_999_991,
      history: Object.freeze({
        receiptCount: 1,
        documentCount: 2,
        manifestByteLength: 4,
      }),
    });

    await expect(
      source(target).load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({
      diagnostic: "authority_capacity_read_budget_unavailable",
    });
    expect(target.chunkStore.read).not.toHaveBeenCalled();
    expect(target.storage.headObject).not.toHaveBeenCalled();
    expect(target.storage.getObject).not.toHaveBeenCalled();
  });

  it("preserves sanitized provider capacity failure authority", async () => {
    const target = harness();
    target.capacitySource.measure.mockRejectedValueOnce(
      new DnaOpenLabProviderCapacityMeasurementError(
        "cloudflare_graphql_rate_limited",
      ),
    );

    await expect(
      source(target).load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({
      diagnostic:
        "authority_capacity_measurement_cloudflare_graphql_rate_limited",
    });
    expect(target.baseline.load).not.toHaveBeenCalled();
  });

  it("fails closed when immutable P5 baseline totals drift", async () => {
    const target = harness({ baselineCount: 17_463 });

    await expect(
      source(target).load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({
      diagnostic: "baseline_authority_unavailable",
    });
    expect(target.populationIndex.load).not.toHaveBeenCalled();
  });

  it("fails closed when a published manifest range disagrees with the canonical chunk", async () => {
    const target = harness({
      manifests: Object.freeze([
        manifest({
          ordinal: 1,
          first: "race-1",
          last: "race-2x",
          rows: 2,
        }),
        manifest({ ordinal: 2, first: "race-3", last: "race-3", rows: 1 }),
      ]),
    });

    await expect(
      source(target).load({ ownerId: OWNER, exactCodeHeadSha: HEAD }),
    ).rejects.toMatchObject({
      diagnostic: "combined_history_unavailable",
    });
  });

  it("classifies dependency failures without exposing private details", async () => {
    const target = harness();
    target.populationIndex.load.mockRejectedValueOnce(
      new Error("private-object-key/should-not-leak"),
    );

    const error = await source(target)
      .load({ ownerId: OWNER, exactCodeHeadSha: HEAD })
      .catch((caught: unknown) => caught);

    expect(error).toBeInstanceOf(DnaPopulationEntrantAuthorityLiveAuditError);
    expect(error).toMatchObject({
      diagnostic: "population_index_unavailable",
    });
    expect((error as Error).message).not.toContain("private-object-key");
  });
});
