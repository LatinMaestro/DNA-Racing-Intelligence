import { describe, expect, it } from "vitest";
import {
  buildImportCompletionReport,
  type CompletedSourceUpdate,
} from "@/domain/import-completion-report";

function source(
  overrides: Partial<CompletedSourceUpdate> = {},
): CompletedSourceUpdate {
  return {
    sourceType: "race_merge",
    batchId: "synthetic-batch",
    outcome: "accepted",
    sourceRows: 10,
    acceptedRows: 8,
    duplicateRows: 1,
    quarantinedRows: 1,
    warningRows: 2,
    dataCurrentThrough: "2026-07-24T00:00:00.000Z",
    priorVersionAvailable: true,
    identityReviewCount: 0,
    reconciliationReviewCount: 0,
    ...overrides,
  };
}

describe("private import completion report", () => {
  it("reports accepted facts as partial until aggregate publication completes", () => {
    const report = buildImportCompletionReport({
      updateSessionId: "synthetic-session",
      completedAt: "2026-07-24T01:00:00.000Z",
      sources: [source({ quarantinedRows: 0, sourceRows: 9 })],
      aggregateStatus: "pending",
    });

    expect(report).toMatchObject({
      status: "completed_with_review",
      recommendationReadiness: "partial",
      reviewReasons: ["aggregate_refresh_pending"],
      rollbackSourceTypes: ["race_merge"],
      totals: {
        files: 1,
        acceptedRows: 8,
        duplicateRows: 1,
        quarantinedRows: 0,
      },
    });
  });

  it("reports readiness only after aggregate completion and no reviews", () => {
    const report = buildImportCompletionReport({
      updateSessionId: "synthetic-session",
      completedAt: "2026-07-24T01:00:00.000Z",
      sources: [
        source({
          sourceType: "current_vault",
          quarantinedRows: 0,
          sourceRows: 9,
        }),
      ],
      aggregateStatus: "completed",
    });

    expect(report.status).toBe("completed");
    expect(report.recommendationReadiness).toBe("ready");
    expect(report.reviewReasons).toEqual([]);
  });

  it("preserves quarantine and review reasons without claiming readiness", () => {
    const report = buildImportCompletionReport({
      updateSessionId: "synthetic-session",
      completedAt: "2026-07-24T01:00:00.000Z",
      sources: [
        source({
          identityReviewCount: 2,
          reconciliationReviewCount: 1,
        }),
      ],
      aggregateStatus: "completed",
    });

    expect(report.status).toBe("completed_with_review");
    expect(report.recommendationReadiness).toBe("partial");
    expect(report.reviewReasons).toEqual([
      "quarantined_rows",
      "identity_review",
      "reconciliation_review",
    ]);
  });

  it("blocks a wholly quarantined update", () => {
    const report = buildImportCompletionReport({
      updateSessionId: "synthetic-session",
      completedAt: "2026-07-24T01:00:00.000Z",
      sources: [
        source({
          outcome: "quarantined",
          acceptedRows: 0,
          duplicateRows: 0,
          quarantinedRows: 10,
          priorVersionAvailable: false,
        }),
      ],
      aggregateStatus: "not_required",
    });

    expect(report.status).toBe("failed");
    expect(report.recommendationReadiness).toBe("blocked");
    expect(report.rollbackSourceTypes).toEqual([]);
  });

  it("accepts an exact replay without refreshing or creating rollback state", () => {
    const report = buildImportCompletionReport({
      updateSessionId: "synthetic-session",
      completedAt: "2026-07-24T01:00:00.000Z",
      sources: [
        source({
          outcome: "exact_replay",
          sourceRows: 10,
          acceptedRows: 0,
          duplicateRows: 10,
          quarantinedRows: 0,
          warningRows: 0,
          priorVersionAvailable: false,
        }),
      ],
      aggregateStatus: "not_required",
    });

    expect(report.status).toBe("completed");
    expect(report.recommendationReadiness).toBe("ready");
    expect(report.rollbackSourceTypes).toEqual([]);
  });

  it("rejects impossible row totals and false aggregate claims", () => {
    expect(() =>
      buildImportCompletionReport({
        updateSessionId: "synthetic-session",
        completedAt: "2026-07-24T01:00:00.000Z",
        sources: [source({ sourceRows: 11 })],
        aggregateStatus: "completed",
      }),
    ).toThrow("classifications");
    expect(() =>
      buildImportCompletionReport({
        updateSessionId: "synthetic-session",
        completedAt: "2026-07-24T01:00:00.000Z",
        sources: [source()],
        aggregateStatus: "not_required",
      }),
    ).toThrow("require aggregate refresh");
  });
});
