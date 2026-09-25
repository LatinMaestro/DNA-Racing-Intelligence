import { createHash } from "node:crypto";

import { describe, expect, it } from "vitest";

import { assessDnaOpenLabCombinedHistoryPerformanceEvidence } from "../lib/dna-open-lab-combined-history-performance-evidence";
import {
  adaptDnaRaceDocumentPopulationInventory,
  dnaOpenLabRawEvidenceSha256,
  type CanonicalRaceDocumentMetadata,
} from "../lib/dna-open-lab-v1-adapters";
import type { DnaRaceDocument } from "../lib/dna-open-lab-v1-client";
import type { DnaOpenLabCombinedFinishedHistory } from "../lib/neon-dna-open-lab-sync-publication";

const ownerId = "owner-1";
const bucketName = "private-evidence";
const completionSha256 = "a".repeat(64);

function sha256(value: string): string {
  return createHash("sha256").update(value, "utf8").digest("hex");
}

function canonicalJson(value: unknown): string {
  if (value === null) return "null";
  if (
    typeof value === "string" ||
    typeof value === "boolean" ||
    typeof value === "number"
  ) {
    return JSON.stringify(value);
  }
  if (Array.isArray(value)) {
    return `[${value.map((entry) => canonicalJson(entry)).join(",")}]`;
  }
  const entries = Object.entries(value as Readonly<Record<string, unknown>>)
    .filter(([, entry]) => entry !== undefined)
    .sort(([left], [right]) => left.localeCompare(right));
  return `{${entries
    .map(([key, entry]) => `${JSON.stringify(key)}:${canonicalJson(entry)}`)
    .join(",")}}`;
}

function chunks(value: string): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield new TextEncoder().encode(value);
  })();
}

function fixture(overrides?: {
  privateBucket?: boolean;
  corruptRace?: boolean;
  baselineIdentityOmission?: boolean;
}) {
  const prefix = sha256(`dna-open-lab-owner\u0000${ownerId}`);
  const baselineRace = Object.freeze<DnaRaceDocument>({
    rid: 101,
    rvmode: "bike",
    format: "sprint",
    track: "source-track-value",
  });
  const hydratedRace = Object.freeze<DnaRaceDocument>({
    ...baselineRace,
    hids: [501, 502],
    yellowstars: [501],
  });
  const incrementalOnlyRace = Object.freeze<DnaRaceDocument>({
    rid: 202,
    rvmode: "car",
    format: "circuit",
  });
  const references = [hydratedRace, incrementalOnlyRace].map((race) => {
    const sourceRaceId = String(race.rid);
    const digest = dnaOpenLabRawEvidenceSha256(race);
    return Object.freeze({
      sourceRaceId,
      rawEvidenceSha256: digest,
      objectKey: [
        "dna-open-lab",
        "v1",
        prefix,
        "races",
        "docs",
        sha256(`dna-open-lab-race\u0000${sourceRaceId}`),
        `${digest}.json`,
      ].join("/"),
    });
  });
  const windowKey = "b".repeat(64);
  const contentSha256 = "c".repeat(64);
  const manifest = {
    schemaVersion: 2,
    source: "dna_open_lab",
    sourceVersion: "v1",
    endpoint: "races.finished",
    windowKey,
    contentSha256,
    window: {
      startTime: "2026-09-03T00:00:00.000Z",
      endTime: "2026-09-04T00:00:00.000Z",
    },
    discoveredRaces: [{ rid: 101 }, { rid: 202 }],
    raceDocumentObjects: references,
    identityConflictQuarantineObjects: [],
  };
  const manifestBody = canonicalJson(manifest);
  const manifestObjectKey = `dna-open-lab/v1/${prefix}/races/finished-windows/${windowKey}.json`;
  const objects = new Map<
    string,
    Readonly<{
      body: string;
      metadata: Readonly<Record<string, string>>;
    }>
  >();
  objects.set(manifestObjectKey, {
    body: manifestBody,
    metadata: {
      "dna-source": "dna_open_lab",
      "dna-version": "v1",
      "dna-endpoint": "races.finished",
      "dna-owner-sha256": prefix,
      "dna-window-key": windowKey,
      "dna-content-sha256": contentSha256,
      "dna-document-count": "2",
    },
  });
  for (const [index, reference] of references.entries()) {
    const race = [hydratedRace, incrementalOnlyRace][index]!;
    objects.set(reference.objectKey, {
      body:
        overrides?.corruptRace === true && index === 0
          ? canonicalJson({ ...race, format: "changed" })
          : canonicalJson(race),
      metadata: {
        "dna-source": "dna_open_lab",
        "dna-version": "v1",
        "dna-endpoint": "races.docs",
        "dna-owner-sha256": prefix,
        "dna-race-id-sha256": sha256(
          `dna-open-lab-race\u0000${reference.sourceRaceId}`,
        ),
        "dna-raw-sha256": reference.rawEvidenceSha256,
      },
    });
  }

  const observedAt = "2026-09-02T00:00:00.000Z";
  const baselineIdentityOmissionCount = overrides?.baselineIdentityOmission
    ? 1
    : 0;
  const receipt = {
    family: "finished_races" as const,
    requestOrdinal: 1,
    observedAt,
    contentSha256: "d".repeat(64),
    byteLength: 100,
    evidenceObjectKey: "private/baseline/000001.json",
    omittedIdentityObservationCount: baselineIdentityOmissionCount as 0 | 1,
    quarantineBound: baselineIdentityOmissionCount === 1,
  };
  const history: DnaOpenLabCombinedFinishedHistory = Object.freeze({
    refreshCycleId: "e".repeat(64),
    currentStateGenerationId: "11111111-1111-4111-8111-111111111111",
    selectedCycleId: "f".repeat(64),
    receiptCount: 1,
    documentCount: 2,
    manifestByteLength: manifestBody.length,
    cycles: Object.freeze([
      Object.freeze({
        lineageDepth: 0,
        publication: Object.freeze({
          version: 1,
          cycleId: "f".repeat(64),
          previousPublishedCycleId: null,
          attemptNumber: 1,
          lowerBoundAt: "2026-09-03T00:00:00.000Z",
          upperBoundAt: "2026-09-04T00:00:00.000Z",
          receiptCount: 1,
          documentCount: 2,
          manifestByteLength: manifestBody.length,
          receiptSetSha256: "1".repeat(64),
          validatedAt: "2026-09-04T00:01:00.000Z",
          publishedAt: "2026-09-04T00:02:00.000Z",
        }),
        receipts: Object.freeze([
          Object.freeze({
            cycleId: "f".repeat(64),
            firstAttemptNumber: 1,
            windowStartAt: "2026-09-03T00:00:00.000Z",
            windowEndAt: "2026-09-04T00:00:00.000Z",
            windowKey,
            contentSha256,
            documentCount: 2,
            manifestObjectKey,
            manifestBodySha256: sha256(manifestBody),
            manifestByteLength: manifestBody.length,
          }),
        ]),
      }),
    ]),
  });

  return {
    ownerId,
    bucketName,
    baselineAuthority: {
      logicalRequestCount: 1,
      retainedR2Bytes: 100,
      omittedIdentityObservationCount: baselineIdentityOmissionCount,
      completionSha256,
    },
    baseline: {
      load: async () => ({
        revision: "1",
        status: "complete" as const,
        nextRequestOrdinal: 2,
        logicalRequestCount: 1,
        retainedR2Bytes: 100,
        omittedIdentityObservationCount: baselineIdentityOmissionCount,
        completionSha256,
      }),
      loadReceipts: async () => [receipt],
      readEvidence: async () => ({
        family: "finished_races" as const,
        requestOrdinal: 1,
        endpoint: "races.finished",
        request: {},
        response: {
          result:
            baselineIdentityOmissionCount === 1
              ? [{ rid: null }, baselineRace, baselineRace]
              : [baselineRace, baselineRace],
          httpStatus: 200,
          rateLimit: {
            limit: null,
            remaining: null,
            resetSeconds: null,
            rateClass: null,
            retryAfterSeconds: null,
          },
        },
        observedAt,
      }),
    },
    history,
    readBudget: {
      maximumClassBOperations: 8,
      paidUsageAllowed: false as const,
    },
    storage: {
      readBucketPrivacy: async () => ({
        publicAccessDisabled: overrides?.privateBucket !== false,
        r2DevDisabled: true,
        customDomainCount: 0,
      }),
      headObject: async ({ key }: { key: string }) => {
        const object = objects.get(key);
        if (object === undefined) return { status: "missing" as const };
        const isManifest = key === manifestObjectKey;
        const bodySha256 = sha256(object.body);
        return {
          status: "ready" as const,
          contentType: "application/json",
          byteLength: object.body.length,
          checksumSha256: isManifest
            ? bodySha256
            : object.metadata["dna-raw-sha256"]!,
          metadata: object.metadata,
        };
      },
      getObject: async ({ key }: { key: string }) => {
        const object = objects.get(key);
        return object === undefined
          ? { status: "missing" as const }
          : { status: "ready" as const, body: chunks(object.body) };
      },
    },
  };
}

describe("combined DNA finished-history performance evidence", () => {
  it("verifies baseline and incremental R2 evidence, deduplicates overlap and holds unsupported analysis", async () => {
    const documents: Array<{
      sourceRaceId: string;
      entrantCoreIds?: readonly string[];
    }> = [];
    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...fixture(),
        onCanonicalRaceDocument: (document) => {
          documents.push(document);
        },
      },
    );

    expect(assessment).toEqual({
      authority: "complete_serving_generation_combined_finished_history",
      refreshCycleId: "e".repeat(64),
      currentStateGenerationId: "11111111-1111-4111-8111-111111111111",
      baselineReceiptCount: 1,
      baselineFinishedRaceReceiptCount: 1,
      incrementalWindowCount: 1,
      incrementalDocumentReferenceCount: 2,
      incrementalMaximumRaceDocumentBytes: 111,
      incrementalMaximumCompactEntrantAuthorityBytes: expect.any(Number),
      quarantinedIdentityObservationCount: 0,
      r2ClassBOperationsUsed: 8,
      uniqueRaceCount: 2,
      duplicateRaceEvidenceCount: 1,
      conflictingRaceEvidenceCount: 0,
      bikeRaceCount: 1,
      bikeRaceWithFormatCount: 1,
      bikeRaceWithTrackSourceValueCount: 1,
      exactTypeAndDistanceElapsedObservationCount: 0,
      performanceSelectionStatus:
        "held_without_exact_format_elapsed_time_evidence",
      unavailableAuthorities: [
        "authoritative_exact_distance",
        "authoritative_elapsed_time",
        "authoritative_finish_position",
      ],
      rawEvidenceExposed: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(documents).toEqual([
      expect.objectContaining({
        sourceRaceId: "101",
        entrantCoreIds: ["501", "502"],
      }),
      expect.objectContaining({ sourceRaceId: "202" }),
    ]);
    expect(assessment).not.toHaveProperty("raceDocuments");
  });

  it("uses a compact published P5 baseline while preserving incremental population authority", async () => {
    const input = fixture();
    const observedAt = "2026-09-02T00:00:00.000Z";
    const raw = Object.freeze<DnaRaceDocument>({
      rid: 101,
      rvmode: "bike",
      format: "sprint",
      track: "source-track-value",
    });
    const adapted = adaptDnaRaceDocumentPopulationInventory({
      raw,
      observedAt,
      endpoint: "races.finished",
    });
    const documents: CanonicalRaceDocumentMetadata[] = [];
    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...input,
        baselineIndex: {
          documents: Object.freeze([
            Object.freeze({
              requestOrdinal: 1,
              endpoint: "races.finished" as const,
              observedAt,
              sourceRaceId: adapted.canonical.sourceRaceId,
              rawEvidenceSha256: adapted.rawEvidenceSha256,
              canonical: adapted.canonical,
            }),
          ]),
          baselineReceiptCount: 1,
          baselineFinishedRaceReceiptCount: 1,
          baselineIdentityOmissionObservationCount: 0,
          r2ClassBOperationsUsed: 2,
        },
        canonicalPurpose: "population_inventory",
        onCanonicalRaceDocument: (document) => documents.push(document),
      },
    );

    expect(assessment.baselineReceiptCount).toBe(1);
    expect(assessment.baselineFinishedRaceReceiptCount).toBe(1);
    expect(assessment.r2ClassBOperationsUsed).toBe(8);
    expect(assessment.uniqueRaceCount).toBe(2);
    expect(assessment.conflictingRaceEvidenceCount).toBe(0);
    expect(documents).toEqual([
      expect.objectContaining({
        sourceRaceId: "101",
        mode: "bike",
        entrantCoreIds: ["501", "502"],
      }),
      expect.objectContaining({ sourceRaceId: "202", mode: "car" }),
    ]);
  });

  it("uses the population-inventory purpose without weakening essential Race authority", async () => {
    const input = fixture();
    const raceDocuments: CanonicalRaceDocumentMetadata[] = [];
    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...input,
        canonicalPurpose: "population_inventory",
        onCanonicalRaceDocument: (document) => raceDocuments.push(document),
      },
    );

    expect(assessment.uniqueRaceCount).toBe(2);
    expect(raceDocuments).toEqual([
      expect.objectContaining({
        sourceRaceId: "101",
        mode: "bike",
        entrantCoreIds: ["501", "502"],
      }),
      expect.objectContaining({ sourceRaceId: "202", mode: "car" }),
    ]);
  });

  it("reconciles the one immutable P5 identity omission without admitting it to the population", async () => {
    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      fixture({ baselineIdentityOmission: true }),
    );

    expect(assessment.quarantinedIdentityObservationCount).toBe(1);
    expect(assessment.uniqueRaceCount).toBe(2);
    expect(assessment.duplicateRaceEvidenceCount).toBe(1);
  });

  it("excludes saturated P5 planning windows before reconciling terminal identity authority", async () => {
    const input = fixture();
    const readEvidence = input.baseline.readEvidence;
    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...input,
        baseline: {
          ...input.baseline,
          readEvidence: async () => {
            const evidence = await readEvidence();
            return {
              ...evidence,
              response: {
                ...evidence.response,
                result: Array.from({ length: 200 }, (_, index) =>
                  index === 0
                    ? { rid: null }
                    : { rid: 1_000 + index, rvmode: "bike" },
                ),
              },
            };
          },
        },
      },
    );

    expect(assessment.uniqueRaceCount).toBe(2);
    expect(assessment.duplicateRaceEvidenceCount).toBe(0);
    expect(assessment.quarantinedIdentityObservationCount).toBe(0);
  });

  it("fails closed when baseline identity omissions exceed immutable authority", async () => {
    const input = fixture();
    const readEvidence = input.baseline.readEvidence;

    await expect(
      assessDnaOpenLabCombinedHistoryPerformanceEvidence({
        ...input,
        baseline: {
          ...input.baseline,
          readEvidence: async () => {
            const evidence = await readEvidence();
            return {
              ...evidence,
              response: {
                ...evidence.response,
                result: [{ rid: null }],
              },
            };
          },
        },
      }),
    ).rejects.toThrow("identity omissions exceed baseline authority");
  });

  it("fails closed when the evidence bucket is not private", async () => {
    await expect(
      assessDnaOpenLabCombinedHistoryPerformanceEvidence(
        fixture({ privateBucket: false }),
      ),
    ).rejects.toThrow("evidence bucket is not private");
  });

  it("fails closed when an incremental object body disagrees with its manifest", async () => {
    await expect(
      assessDnaOpenLabCombinedHistoryPerformanceEvidence(
        fixture({ corruptRace: true }),
      ),
    ).rejects.toThrow("checksum or identity disagrees");
  });

  it("fails closed when immutable P5 authority changes", async () => {
    const input = fixture();
    await expect(
      assessDnaOpenLabCombinedHistoryPerformanceEvidence({
        ...input,
        baselineAuthority: {
          ...input.baselineAuthority,
          logicalRequestCount: 2,
        },
      }),
    ).rejects.toThrow("baseline authority is incomplete or inconsistent");
  });

  it("refuses provider reads before they exceed the authorized free budget", async () => {
    const input = fixture();
    await expect(
      assessDnaOpenLabCombinedHistoryPerformanceEvidence({
        ...input,
        readBudget: {
          maximumClassBOperations: 7,
          paidUsageAllowed: false,
        },
      }),
    ).rejects.toThrow("read budget is exhausted before provider access");
  });

  it("reads incremental Race evidence concurrently while preserving deterministic acceptance order", async () => {
    const input = fixture();
    const headObject = input.storage.headObject;
    let activeRaceHeads = 0;
    let maximumActiveRaceHeads = 0;
    const acceptedRaceIds: string[] = [];

    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...input,
        storage: {
          ...input.storage,
          headObject: async (query: { bucketName: string; key: string }) => {
            if (!query.key.includes("/races/docs/")) {
              return headObject(query);
            }
            activeRaceHeads += 1;
            maximumActiveRaceHeads = Math.max(
              maximumActiveRaceHeads,
              activeRaceHeads,
            );
            try {
              await new Promise((resolve) => setTimeout(resolve, 5));
              return await headObject(query);
            } finally {
              activeRaceHeads -= 1;
            }
          },
        },
        onCanonicalRaceDocument: (document) => {
          acceptedRaceIds.push(document.sourceRaceId);
        },
      },
    );

    expect(assessment.incrementalDocumentReferenceCount).toBe(2);
    expect(assessment.incrementalMaximumRaceDocumentBytes).toBeGreaterThan(0);
    expect(
      assessment.incrementalMaximumCompactEntrantAuthorityBytes,
    ).toBeGreaterThan(0);
    expect(
      assessment.incrementalMaximumCompactEntrantAuthorityBytes,
    ).toBeLessThan(assessment.incrementalMaximumRaceDocumentBytes);
    expect(maximumActiveRaceHeads).toBe(2);
    expect(acceptedRaceIds).toEqual(["101", "202"]);
  });

  it("bounds baseline evidence concurrency while preserving receipt order", async () => {
    const input = fixture();
    const receiptCount = 128;
    const [templateReceipt] = await input.baseline.loadReceipts();
    const evidenceTemplate = await input.baseline.readEvidence();
    if (templateReceipt === undefined) {
      throw new Error("baseline receipt fixture is unavailable");
    }
    const receipts = Array.from({ length: receiptCount }, (_, index) =>
      Object.freeze({
        ...templateReceipt,
        requestOrdinal: index + 1,
        quarantineBound: false as const,
      }),
    );
    let activeReads = 0;
    let maximumActiveReads = 0;

    const assessment = await assessDnaOpenLabCombinedHistoryPerformanceEvidence(
      {
        ...input,
        baselineAuthority: {
          ...input.baselineAuthority,
          logicalRequestCount: receiptCount,
          retainedR2Bytes: receiptCount * templateReceipt.byteLength,
        },
        baseline: {
          load: async () => ({
            revision: "1",
            status: "complete" as const,
            nextRequestOrdinal: receiptCount + 1,
            logicalRequestCount: receiptCount,
            retainedR2Bytes: receiptCount * templateReceipt.byteLength,
            omittedIdentityObservationCount: 0,
            completionSha256,
          }),
          loadReceipts: async (query: {
            afterRequestOrdinal: number;
            limit?: number;
          }) =>
            receipts
              .filter(
                (receipt) => receipt.requestOrdinal > query.afterRequestOrdinal,
              )
              .slice(0, query.limit ?? receipts.length),
          readEvidence: async (requestOrdinal: number) => {
            activeReads += 1;
            maximumActiveReads = Math.max(maximumActiveReads, activeReads);
            try {
              await new Promise((resolve) => setTimeout(resolve, 5));
              return {
                ...evidenceTemplate,
                requestOrdinal,
              };
            } finally {
              activeReads -= 1;
            }
          },
        },
        readBudget: {
          maximumClassBOperations: receiptCount * 2 + 6,
          paidUsageAllowed: false,
        },
      },
    );

    expect(assessment.baselineReceiptCount).toBe(receiptCount);
    expect(assessment.baselineFinishedRaceReceiptCount).toBe(receiptCount);
    expect(maximumActiveReads).toBe(64);
  });
});
