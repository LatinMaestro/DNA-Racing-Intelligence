import { describe, expect, it } from "vitest";
import {
  buildImportWorkspace,
  redactImportBatchSummary,
  type PrivateImportBatch,
} from "@/domain/import-workflow";

const now = new Date("2026-07-23T08:00:00.000Z");

function batch(
  overrides: Partial<PrivateImportBatch> = {},
): PrivateImportBatch {
  return {
    batchId: "synthetic-batch-1",
    sourceType: "race_merge",
    status: "accepted",
    uploadedAt: "2026-07-23T06:00:00.000Z",
    importCompletedAt: "2026-07-23T06:05:00.000Z",
    dataCurrentThrough: "2026-07-22T06:00:00.000Z",
    aggregateRefreshedAt: "2026-07-23T06:06:00.000Z",
    sourceRows: 10,
    acceptedRows: 9,
    rejectedRows: 1,
    warningRows: 2,
    isActive: true,
    priorVersionAvailable: false,
    identityReviewCount: 0,
    reconciliationReviewCount: 0,
    issueCounts: [
      { code: "SYNTHETIC_WARNING", severity: "warning", occurrenceCount: 2 },
    ],
    ...overrides,
  };
}

describe("private import and recovery workspace", () => {
  it("keeps every source unknown until an accepted import exists", () => {
    const workspace = buildImportWorkspace([], now);

    expect(workspace.sources).toHaveLength(4);
    expect(
      workspace.sources.map(({ latestBatchStatus, freshness }) => ({
        latestBatchStatus,
        freshness,
      })),
    ).toEqual(
      Array.from({ length: 4 }, () => ({
        latestBatchStatus: "not_imported",
        freshness: "unknown",
      })),
    );
  });

  it("shows the latest attempt separately from the active historical data", () => {
    const workspace = buildImportWorkspace(
      [
        batch(),
        batch({
          batchId: "synthetic-quarantine",
          status: "quarantined",
          uploadedAt: "2026-07-23T07:00:00.000Z",
          importCompletedAt: null,
          dataCurrentThrough: null,
          aggregateRefreshedAt: null,
          sourceRows: 2,
          acceptedRows: 0,
          rejectedRows: 2,
          warningRows: 2,
          isActive: false,
        }),
      ],
      now,
    );

    expect(workspace.sources[0]).toMatchObject({
      latestBatchStatus: "quarantined",
      activeBatchId: "synthetic-batch-1",
      dataCurrentThrough: "2026-07-22T06:00:00.000Z",
      freshness: "current",
    });
  });

  it("creates review, rollback and pending-aggregate queues only for active data", () => {
    const workspace = buildImportWorkspace(
      [
        batch({
          sourceType: "current_vault",
          priorVersionAvailable: true,
          identityReviewCount: 3,
          reconciliationReviewCount: 2,
          aggregateRefreshedAt: null,
        }),
        batch({
          batchId: "historical-batch",
          sourceType: "current_vault",
          status: "rolled_back",
          isActive: false,
          identityReviewCount: 99,
        }),
      ],
      now,
    );

    expect(
      workspace.recoveryQueue.map(({ kind, count }) => ({ kind, count })),
    ).toEqual([
      { kind: "rollback_available", count: 1 },
      { kind: "identity_review", count: 3 },
      { kind: "reconciliation_review", count: 2 },
      { kind: "aggregate_pending", count: 1 },
    ]);
  });

  it("rejects impossible coverage and multiple active versions", () => {
    expect(() =>
      buildImportWorkspace([batch({ acceptedRows: 10, rejectedRows: 1 })], now),
    ).toThrow("acceptedRows plus rejectedRows must equal sourceRows");

    expect(() =>
      buildImportWorkspace(
        [batch(), batch({ batchId: "synthetic-batch-2" })],
        now,
      ),
    ).toThrow("cannot have multiple active batches");
  });

  it("keeps routine summaries count-only and omits private identifiers", () => {
    const redacted = redactImportBatchSummary(batch());

    expect(redacted).toEqual({
      sourceType: "race_merge",
      status: "accepted",
      sourceRows: 10,
      acceptedRows: 9,
      rejectedRows: 1,
      warningRows: 2,
      issueCounts: [
        { code: "SYNTHETIC_WARNING", severity: "warning", occurrenceCount: 2 },
      ],
    });
    expect(redacted).not.toHaveProperty("batchId");
    expect(redacted).not.toHaveProperty("uploadedAt");
  });
});
