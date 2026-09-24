import { describe, expect, it, vi } from "vitest";

import { readDnaPopulationRaceIndexReceiptBatch } from "../lib/dna-population-race-index-checkpoint";

const completionSha256 = "a".repeat(64);

function receipt(
  requestOrdinal: number,
  family: "finished_races" | "core_current_state" = "finished_races",
) {
  return Object.freeze({
    family,
    requestOrdinal,
    observedAt: "2026-09-02T00:00:00.000Z",
    contentSha256: "b".repeat(64),
    byteLength: requestOrdinal * 10,
    evidenceObjectKey: `private/${requestOrdinal}.json`,
    omittedIdentityObservationCount: 0 as const,
    quarantineBound: false,
  });
}

function fixture() {
  const receipts = [receipt(1), receipt(2, "core_current_state"), receipt(3)];
  const loadReceipts = vi.fn(
    async ({
      afterRequestOrdinal,
      limit = 500,
    }: {
      afterRequestOrdinal: number;
      limit?: number;
    }) =>
      receipts
        .filter((value) => value.requestOrdinal > afterRequestOrdinal)
        .slice(0, limit),
  );
  const readEvidence = vi.fn(async (requestOrdinal: number) => ({
    family: "finished_races" as const,
    requestOrdinal,
    endpoint: requestOrdinal === 1 ? "races.finished" : "races.docs",
    request: {},
    response: {
      result:
        requestOrdinal === 1
          ? [
              {
                rid: 101,
                rvmode: "bike",
                format: "sprint",
                hids: [501, 502],
              },
            ]
          : [
              {
                rid: 202,
                rvmode: "horse",
                format: "distance",
                hids: [601, 602],
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
    baseline: {
      load: vi.fn(async () => ({
        revision: "1",
        status: "complete" as const,
        nextRequestOrdinal: 4,
        logicalRequestCount: 3,
        retainedR2Bytes: 60,
        omittedIdentityObservationCount: 0,
        completionSha256,
      })),
      loadReceipts,
      readEvidence,
    },
    loadReceipts,
    readEvidence,
  };
}

function input(afterRequestOrdinal = 0, maximumReceiptCount = 2) {
  const values = fixture();
  return {
    values,
    input: {
      baseline: values.baseline,
      baselineCompletionSha256: completionSha256,
      baselineLogicalRequestCount: 3,
      baselineRetainedR2Bytes: 60,
      baselineOmittedIdentityObservationCount: 0,
      afterRequestOrdinal,
      maximumReceiptCount,
    },
  };
}

describe("DNA population race index receipt checkpoint", () => {
  it("reads one bounded contiguous slice and returns deterministic resume progress", async () => {
    const { input: values, values: fixtureValues } = input();
    const result = await readDnaPopulationRaceIndexReceiptBatch(values);

    expect(result).toMatchObject({
      version: 1,
      baselineCompletionSha256: completionSha256,
      afterRequestOrdinal: 0,
      nextRequestOrdinal: 3,
      processedReceiptCount: 2,
      processedReceiptBytes: 30,
      processedIdentityOmissionCount: 0,
      finishedRaceReceiptCount: 1,
      canonicalDocumentObservationCount: 1,
      complete: false,
      persistentWritePerformed: false,
      paidUsageAllowed: false,
    });
    expect(result.documents).toHaveLength(1);
    expect(result.documents[0]).toMatchObject({
      requestOrdinal: 1,
      endpoint: "races.finished",
      sourceRaceId: "101",
      canonical: { mode: "bike", entrantCoreIds: ["501", "502"] },
    });
    expect(fixtureValues.readEvidence).toHaveBeenCalledTimes(1);
  });

  it("resumes strictly after the durable ordinal and reaches completion", async () => {
    const { input: values, values: fixtureValues } = input(2, 1);
    const result = await readDnaPopulationRaceIndexReceiptBatch(values);

    expect(result).toMatchObject({
      afterRequestOrdinal: 2,
      nextRequestOrdinal: 4,
      processedReceiptCount: 1,
      processedReceiptBytes: 30,
      finishedRaceReceiptCount: 1,
      canonicalDocumentObservationCount: 1,
      complete: true,
    });
    expect(result.documents[0]).toMatchObject({
      requestOrdinal: 3,
      endpoint: "races.docs",
      sourceRaceId: "202",
      canonical: { mode: "horse", entrantCoreIds: ["601", "602"] },
    });
    expect(fixtureValues.loadReceipts).toHaveBeenCalledWith({
      afterRequestOrdinal: 2,
      limit: 1,
    });
  });

  it("stops at a receipt boundary before the adaptive document ceiling", async () => {
    const { input: values, values: fixtureValues } = input(0, 3);
    const result = await readDnaPopulationRaceIndexReceiptBatch({
      ...values,
      maximumDocumentCount: 1,
    });

    expect(result).toMatchObject({
      afterRequestOrdinal: 0,
      nextRequestOrdinal: 3,
      processedReceiptCount: 2,
      processedReceiptBytes: 30,
      finishedRaceReceiptCount: 1,
      canonicalDocumentObservationCount: 1,
      complete: false,
    });
    expect(fixtureValues.readEvidence).toHaveBeenCalledTimes(2);
  });

  it("fails closed when one receipt cannot fit the adaptive ceiling", async () => {
    const { input: values } = input(0, 1);
    await expect(
      readDnaPopulationRaceIndexReceiptBatch({
        ...values,
        maximumDocumentBytes: 1,
      }),
    ).rejects.toThrow("single receipt exceeds adaptive write ceiling");
  });

  it("returns an empty complete proof without replaying evidence", async () => {
    const { input: values, values: fixtureValues } = input(3, 1);
    const result = await readDnaPopulationRaceIndexReceiptBatch(values);

    expect(result).toMatchObject({
      afterRequestOrdinal: 3,
      nextRequestOrdinal: 4,
      processedReceiptCount: 0,
      canonicalDocumentObservationCount: 0,
      complete: true,
    });
    expect(fixtureValues.loadReceipts).not.toHaveBeenCalled();
    expect(fixtureValues.readEvidence).not.toHaveBeenCalled();
  });

  it("fails closed on stale authority, gaps and oversized batches", async () => {
    const stale = input();
    await expect(
      readDnaPopulationRaceIndexReceiptBatch({
        ...stale.input,
        baselineCompletionSha256: "c".repeat(64),
      }),
    ).rejects.toThrow("immutable P5 baseline authority is unavailable");

    const gap = input();
    gap.values.loadReceipts.mockResolvedValueOnce([receipt(2)]);
    await expect(
      readDnaPopulationRaceIndexReceiptBatch(gap.input),
    ).rejects.toThrow("receipt ordinals are not contiguous");

    const oversized = input(0, 501);
    await expect(
      readDnaPopulationRaceIndexReceiptBatch(oversized.input),
    ).rejects.toThrow("receipt range is invalid");

    await expect(
      readDnaPopulationRaceIndexReceiptBatch({
        ...input().input,
        maximumDocumentCount: 4_501,
      }),
    ).rejects.toThrow("receipt range is invalid");
  });
});
