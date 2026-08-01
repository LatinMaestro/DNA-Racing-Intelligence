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

function report(
  sources: readonly CompletedSourceUpdate[],
  aggregateStatus: Parameters<
    typeof buildImportCompletionReport
  >[0]["aggregateStatus"] = "completed",
) {
  return buildImportCompletionReport({
    updateSessionId: "synthetic-session",
    completedAt: "2026-07-24T01:00:00.000Z",
    sources,
    aggregateStatus,
  });
}

describe("private import completion report", () => {
  it("reports accepted facts as partial until aggregate publication completes", () => {
    const result = report(
      [source({ quarantinedRows: 0, sourceRows: 9 })],
      "pending",
    );

    expect(result).toMatchObject({
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
    const result = report([
      source({
        sourceType: "current_vault",
        quarantinedRows: 0,
        sourceRows: 9,
      }),
    ]);

    expect(result.status).toBe("completed");
    expect(result.recommendationReadiness).toBe("ready");
    expect(result.reviewReasons).toEqual([]);
  });

  it("preserves quarantine and review reasons without claiming readiness", () => {
    const result = report([
      source({
        identityReviewCount: 2,
        reconciliationReviewCount: 1,
      }),
    ]);

    expect(result.status).toBe("completed_with_review");
    expect(result.recommendationReadiness).toBe("partial");
    expect(result.reviewReasons).toEqual([
      "quarantined_rows",
      "identity_review",
      "reconciliation_review",
    ]);
  });

  it("blocks a wholly quarantined update", () => {
    const result = report(
      [
        source({
          outcome: "quarantined",
          acceptedRows: 0,
          duplicateRows: 0,
          quarantinedRows: 10,
          priorVersionAvailable: false,
        }),
      ],
      "not_required",
    );

    expect(result.status).toBe("failed");
    expect(result.recommendationReadiness).toBe("blocked");
    expect(result.rollbackSourceTypes).toEqual([]);
  });

  it("accepts an exact replay without refreshing or creating rollback state", () => {
    const result = report(
      [
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
      "not_required",
    );

    expect(result.status).toBe("completed");
    expect(result.recommendationReadiness).toBe("ready");
    expect(result.rollbackSourceTypes).toEqual([]);
  });

  it("canonicalizes identifiers before output and duplicate comparison", () => {
    const result = report([source({ batchId: " synthetic-batch " })]);
    expect(result.sources[0]?.batchId).toBe("synthetic-batch");

    expect(() =>
      report([
        source({ batchId: "batch-one" }),
        source({ batchId: " batch-one " }),
      ]),
    ).toThrow("batch IDs must be unique");
  });

  it("rejects malformed runtime discriminants and Booleans", () => {
    expect(() => report([source({ outcome: "invented" } as never)])).toThrow(
      "outcome is invalid",
    );
    expect(() =>
      report([source({ priorVersionAvailable: "true" } as never)]),
    ).toThrow("must be a Boolean");
    expect(() => report([source()], "invented" as never)).toThrow(
      "aggregateStatus is invalid",
    );
  });

  it("rejects impossible or unsafe row totals and false aggregate claims", () => {
    expect(() => report([source({ sourceRows: 11 })])).toThrow(
      "classifications",
    );
    expect(() =>
      report(
        [
          source({
            sourceRows: Number.MAX_SAFE_INTEGER,
            acceptedRows: Number.MAX_SAFE_INTEGER,
            duplicateRows: 1,
            quarantinedRows: 0,
          }),
        ],
        "pending",
      ),
    ).toThrow("safe integer");
    expect(() =>
      report(
        [
          source({
            batchId: "batch-one",
            sourceRows: Number.MAX_SAFE_INTEGER,
            acceptedRows: Number.MAX_SAFE_INTEGER,
            duplicateRows: 0,
            quarantinedRows: 0,
          }),
          source({
            batchId: "batch-two",
            sourceRows: Number.MAX_SAFE_INTEGER,
            acceptedRows: Number.MAX_SAFE_INTEGER,
            duplicateRows: 0,
            quarantinedRows: 0,
          }),
        ],
        "pending",
      ),
    ).toThrow("total must be");
    expect(() => report([source()], "not_required")).toThrow(
      "require aggregate refresh",
    );
  });
});
