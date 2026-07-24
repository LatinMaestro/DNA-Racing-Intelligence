import { describe, expect, it } from "vitest";
import {
  auditLargeHistoryCapacity,
  type LargeHistoryCapacityInput,
} from "@/domain/large-history-capacity-audit";

function input(
  overrides: Partial<LargeHistoryCapacityInput> = {},
): LargeHistoryCapacityInput {
  return {
    measurementId: "capacity-2026-07-24",
    evidenceSource: "sanitized_representative",
    exactHeadSha: "a".repeat(40),
    datasetRows: 2_500_000,
    repetitions: 5,
    routineRequest: {
      usesPrecomputedAggregates: true,
      rawHistoryRowsScanned: 0,
      p95Milliseconds: 180,
      latencyBudgetMilliseconds: 300,
    },
    backgroundPipeline: {
      importRunsOffRequestPath: true,
      aggregateRefreshRunsOffRequestPath: true,
      maxBatchRows: 50_000,
      completed: true,
      peakMemoryMegabytes: 420,
      memoryBudgetMegabytes: 512,
    },
    privateDataObservedInLogs: false,
    productionMutationRequested: false,
    providerChangeRequested: false,
    ...overrides,
  };
}

describe("Phase 9 large-history capacity audit", () => {
  it("verifies complete representative-scale evidence", () => {
    const audit = auditLargeHistoryCapacity(input());

    expect(audit.status).toBe("verified_representative");
    expect(audit.evidenceClass).toBe("representative_measurement");
    expect(audit.checks.every((item) => item.status === "pass")).toBe(true);
    expect(audit).toMatchObject({
      productionReady: false,
      gateFStatus: "not_assessed",
    });
  });

  it("keeps synthetic measurements contract-only", () => {
    const audit = auditLargeHistoryCapacity(
      input({ evidenceSource: "synthetic", datasetRows: 3_000_000 }),
    );

    expect(audit.status).toBe("review_required");
    expect(audit.evidenceClass).toBe("contract_only");
    expect(
      audit.checks.find((item) => item.code === "REPRESENTATIVE_SCALE"),
    ).toMatchObject({ status: "review" });
  });

  it("requires the expected multi-million-row scale", () => {
    const audit = auditLargeHistoryCapacity(input({ datasetRows: 1_999_999 }));
    expect(audit.status).toBe("review_required");
  });

  it("blocks raw-history scanning on routine requests", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        routineRequest: {
          ...input().routineRequest,
          rawHistoryRowsScanned: 1,
        },
      }),
    );

    expect(audit.status).toBe("blocked");
    expect(
      audit.checks.find((item) => item.code === "ROUTINE_REQUEST_BOUNDARY"),
    ).toMatchObject({ status: "block" });
  });

  it("blocks a routine request that bypasses aggregates", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        routineRequest: {
          ...input().routineRequest,
          usesPrecomputedAggregates: false,
        },
      }),
    );
    expect(audit.status).toBe("blocked");
  });

  it("keeps missing latency and memory measurements review-required", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        routineRequest: { ...input().routineRequest, p95Milliseconds: null },
        backgroundPipeline: {
          ...input().backgroundPipeline,
          peakMemoryMegabytes: null,
        },
      }),
    );

    expect(audit.status).toBe("review_required");
  });

  it("blocks exceeded latency and memory budgets", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        routineRequest: {
          ...input().routineRequest,
          p95Milliseconds: 301,
        },
        backgroundPipeline: {
          ...input().backgroundPipeline,
          peakMemoryMegabytes: 513,
        },
      }),
    );

    expect(audit.status).toBe("blocked");
  });

  it("requires bounded processing away from request paths", () => {
    const onRequest = auditLargeHistoryCapacity(
      input({
        backgroundPipeline: {
          ...input().backgroundPipeline,
          importRunsOffRequestPath: false,
        },
      }),
    );
    expect(onRequest.status).toBe("blocked");

    const unbounded = auditLargeHistoryCapacity(
      input({
        backgroundPipeline: {
          ...input().backgroundPipeline,
          maxBatchRows: 0,
        },
      }),
    );
    expect(unbounded.status).toBe("blocked");
  });

  it("requires completed and repeatable measurements", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        repetitions: 2,
        backgroundPipeline: {
          ...input().backgroundPipeline,
          completed: false,
        },
      }),
    );

    expect(audit.status).toBe("review_required");
  });

  it("blocks private logging and scope-expanding changes", () => {
    const audit = auditLargeHistoryCapacity(
      input({
        privateDataObservedInLogs: true,
        productionMutationRequested: true,
        providerChangeRequested: true,
      }),
    );

    expect(audit.status).toBe("blocked");
    expect(audit.productionReady).toBe(false);
  });

  it("rejects invalid exact-head and numeric evidence", () => {
    expect(() =>
      auditLargeHistoryCapacity(input({ exactHeadSha: "main" })),
    ).toThrow(/40 hexadecimal/);
    expect(() => auditLargeHistoryCapacity(input({ repetitions: -1 }))).toThrow(
      /non-negative/,
    );
    expect(() =>
      auditLargeHistoryCapacity(
        input({
          evidenceSource:
            "unsupported" as LargeHistoryCapacityInput["evidenceSource"],
        }),
      ),
    ).toThrow(/source is invalid/);
  });
});
