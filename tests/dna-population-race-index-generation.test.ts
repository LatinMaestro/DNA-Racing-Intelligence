import { describe, expect, it } from "vitest";

import {
  createDnaPopulationRaceIndexAuthority,
  createDnaPopulationRaceIndexR2AppendPlan,
  createDnaPopulationRaceIndexWriteBatch,
} from "../lib/dna-population-race-index-generation";

const completionSha256 = "a".repeat(64);

function receiptBatch(overrides: Record<string, unknown> = {}) {
  return {
    version: 1 as const,
    baselineCompletionSha256: completionSha256,
    afterRequestOrdinal: 0,
    nextRequestOrdinal: 2,
    processedReceiptCount: 1,
    processedReceiptBytes: 100,
    processedIdentityOmissionCount: 0,
    finishedRaceReceiptCount: 1,
    canonicalDocumentObservationCount: 1,
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
          entrantCoreIds: ["core-1", "core-2"],
        },
      },
    ],
    complete: false,
    persistentWritePerformed: false as const,
    paidUsageAllowed: false as const,
    ...overrides,
  };
}

describe("DNA population race index generation", () => {
  it("binds a deterministic generation to the immutable P5 completion", () => {
    expect(
      createDnaPopulationRaceIndexAuthority({
        baselineCompletionSha256: completionSha256,
        baselineLogicalRequestCount: 17_464,
        baselineRetainedR2Bytes: 874_370_990,
        baselineOmittedIdentityObservationCount: 1,
      }),
    ).toEqual({
      version: 1,
      generationId: completionSha256,
      baselineCompletionSha256: completionSha256,
      baselineLogicalRequestCount: 17_464,
      baselineRetainedR2Bytes: 874_370_990,
      baselineOmittedIdentityObservationCount: 1,
    });
  });

  it("creates a deterministic bounded write receipt without changing reader evidence", () => {
    const first = createDnaPopulationRaceIndexWriteBatch(receiptBatch());
    const second = createDnaPopulationRaceIndexWriteBatch(receiptBatch());

    expect(first).toEqual(second);
    expect(first).toMatchObject({
      version: 1,
      generationId: completionSha256,
      afterRequestOrdinal: 0,
      nextRequestOrdinal: 2,
      processedReceiptCount: 1,
      canonicalDocumentObservationCount: 1,
      complete: false,
    });
    expect(first.batchSha256).toMatch(/^[a-f0-9]{64}$/u);
  });

  it("fails closed on non-contiguous or oversized writes", () => {
    expect(() =>
      createDnaPopulationRaceIndexWriteBatch(
        receiptBatch({ nextRequestOrdinal: 3 }),
      ),
    ).toThrow("batch bounds are invalid");

    expect(() =>
      createDnaPopulationRaceIndexWriteBatch(
        receiptBatch({ processedReceiptCount: 101, nextRequestOrdinal: 102 }),
      ),
    ).toThrow("batch bounds are invalid");
  });

  it("fails closed when a document falls outside its receipt interval", () => {
    const batch = receiptBatch();
    const document = batch.documents[0]!;
    expect(() =>
      createDnaPopulationRaceIndexWriteBatch({
        ...batch,
        documents: [{ ...document, requestOrdinal: 2 }],
      }),
    ).toThrow("document authority is invalid");
  });
  it("deduplicates exact durable races before creating an R2 append", () => {
    const batch = createDnaPopulationRaceIndexWriteBatch(receiptBatch());
    expect(
      createDnaPopulationRaceIndexR2AppendPlan({
        batch,
        existingIdentities: [
          {
            sourceRaceId: "race-1",
            rawEvidenceSha256: "b".repeat(64),
          },
        ],
      }),
    ).toEqual({
      newDocuments: [],
      newIdentities: [],
    });
  });

  it("fails closed instead of storing a second canonical copy when a race hash drifts", () => {
    const batch = createDnaPopulationRaceIndexWriteBatch(receiptBatch());
    expect(() =>
      createDnaPopulationRaceIndexR2AppendPlan({
        batch,
        existingIdentities: [
          {
            sourceRaceId: "race-1",
            rawEvidenceSha256: "c".repeat(64),
          },
        ],
      }),
    ).toThrow("race evidence drifted from durable compact identity");
  });

  it("keeps one exact copy when an immutable batch repeats the same race", () => {
    const base = receiptBatch();
    const duplicate = base.documents[0]!;
    const batch = createDnaPopulationRaceIndexWriteBatch({
      ...base,
      canonicalDocumentObservationCount: 2,
      documents: [
        duplicate,
        {
          ...duplicate,
          requestOrdinal: 1,
        },
      ],
    });
    const plan = createDnaPopulationRaceIndexR2AppendPlan({
      batch,
      existingIdentities: [],
    });
    expect(plan.newDocuments).toHaveLength(1);
    expect(plan.newIdentities).toEqual([
      {
        sourceRaceId: "race-1",
        rawEvidenceSha256: "b".repeat(64),
      },
    ]);
  });
});
