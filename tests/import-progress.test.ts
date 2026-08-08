import { describe, expect, it } from "vitest";
import {
  projectImportProgress,
  projectRecentImportProgress,
  type ImportProgressBatch,
} from "../domain/import-progress";

function batch(
  overrides: Partial<ImportProgressBatch> = {},
): ImportProgressBatch {
  return {
    batchId: "synthetic-batch-1",
    sourceType: "race_merge",
    status: "accepted",
    importCompletedAt: "2026-07-26T01:10:00.000Z",
    dataCurrentThrough: "2026-07-25T23:00:00.000Z",
    aggregateRefreshedAt: "2026-07-26T01:15:00.000Z",
    sourceRows: 12,
    acceptedRows: 12,
    rejectedRows: 0,
    warningRows: 0,
    isActive: true,
    priorVersionAvailable: true,
    identityReviewCount: 0,
    reconciliationReviewCount: 0,
    ...overrides,
  };
}

describe("import progress projection", () => {
  it("marks accepted and refreshed evidence ready without inventing live state", () => {
    const result = projectImportProgress(batch());

    expect(result).toMatchObject({
      headline: "Historical views ready",
      readiness: "historical_views_ready",
      rollbackAvailable: true,
      aggregateRefreshPending: false,
    });
    expect(result.steps.map(({ state }) => state)).toEqual(
      Array.from({ length: 5 }, () => "complete"),
    );
  });

  it("keeps accepted data unavailable while aggregate refresh is pending", () => {
    const result = projectImportProgress(batch({ aggregateRefreshedAt: null }));

    expect(result).toMatchObject({
      headline: "Aggregate refresh pending",
      readiness: "not_ready",
      aggregateRefreshPending: true,
    });
    expect(result.steps).toContainEqual({
      stage: "aggregate_refresh",
      state: "current",
    });
    expect(result.steps).toContainEqual({ stage: "ready", state: "waiting" });
  });

  it("keeps quarantined attempts blocked without changing accepted freshness", () => {
    const result = projectImportProgress(
      batch({
        status: "quarantined",
        importCompletedAt: null,
        dataCurrentThrough: null,
        aggregateRefreshedAt: null,
        acceptedRows: 0,
        rejectedRows: 12,
        isActive: false,
        priorVersionAvailable: false,
      }),
    );

    expect(result).toMatchObject({
      headline: "Validation blocked",
      readiness: "not_ready",
      rollbackAvailable: false,
    });
    expect(result.steps).toContainEqual({
      stage: "validation",
      state: "blocked",
    });
  });

  it("retains material review work after aggregate publication", () => {
    const result = projectImportProgress(
      batch({
        sourceType: "current_vault",
        identityReviewCount: 2,
        reconciliationReviewCount: 1,
      }),
    );

    expect(result).toMatchObject({
      headline: "Imported with review work",
      readiness: "review_required",
      identityReviewCount: 2,
      reconciliationReviewCount: 1,
    });
    expect(result.steps).toContainEqual({ stage: "ready", state: "blocked" });
  });

  it("projects rolled-back evidence as recovered rather than ready", () => {
    const result = projectImportProgress(
      batch({
        status: "rolled_back",
        aggregateRefreshedAt: null,
        isActive: false,
        priorVersionAvailable: false,
      }),
    );

    expect(result).toMatchObject({
      headline: "Rolled back",
      readiness: "recovered",
      aggregateRefreshPending: false,
    });
    expect(result.steps).toContainEqual({
      stage: "activation",
      state: "recovered",
    });
  });

  it("limits recent projections and fails closed on unsafe evidence", () => {
    expect(
      projectRecentImportProgress(
        [
          batch(),
          batch({ batchId: "synthetic-batch-2" }),
          batch({ batchId: "synthetic-batch-3" }),
        ],
        2,
      ),
    ).toHaveLength(2);

    expect(() => projectImportProgress(batch({ acceptedRows: 11 }))).toThrow(
      "acceptedRows plus rejectedRows must equal sourceRows",
    );
    expect(() => projectRecentImportProgress([], -1)).toThrow(
      "limit must be a non-negative safe integer",
    );
  });
});
