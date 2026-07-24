import { describe, expect, it } from "vitest";
import {
  assessPrivateChronologicalValidation,
  type PrivateChronologicalValidationInput,
} from "@/domain/private-chronological-validation";

function input(
  overrides: Partial<PrivateChronologicalValidationInput> = {},
): PrivateChronologicalValidationInput {
  return {
    evidenceId: "synthetic-private-chronology",
    exactHeadSha: "d".repeat(40),
    sourceRows: 2_000_010,
    uniqueRows: 2_000_000,
    duplicateRowsIgnored: 10,
    uniqueEvents: 600_000,
    completeEvents: 500_000,
    partialEvents: 100_000,
    partialEventsExcludedFromOutcomeScoring: true,
    externallyChronologicallyOrdered: true,
    featureCutoffStrictlyBeforeEvent: true,
    sameEventHistoryUpdatedAfterPrediction: true,
    baselinePartitions: {
      mode: true,
      exactDistanceMetres: true,
      gateCount: true,
    },
    pairedHoldoutCases: 100_000,
    directHistoryBrierImprovementMillionths: 1_000,
    historicalStarBrierImprovementMillionths: -100,
    lineageProxyCases: 80_000,
    lineageProxyBrierImprovementMillionths: -200,
    breedingTimestampCoverageAvailable: false,
    pointInTimeMaidenEntitlementAvailable: false,
    eraReviewCandidateCount: 2,
    algorithmChangeClaimed: false,
    capacity: {
      evidenceSource: "private_hosted",
      repetitions: 3,
      peakMemoryMegabytes: 200,
      memoryBudgetMegabytes: 512,
      runsOffRequestPath: true,
      routineRequestP95Measured: false,
    },
    economics: {
      historicalBgcRows: 10,
      raceLedgerTransactionsFromHistoricalBgc: 0,
      unknownRaceAssetRows: 0,
    },
    ...overrides,
  };
}

describe("Phase 9 private chronological validation evidence", () => {
  it("keeps favourable direct-history evidence review-only", () => {
    const result = assessPrivateChronologicalValidation(input());
    expect(result).toMatchObject({
      status: "blocked",
      chronologyStatus: "valid",
      directHistoryStatus: "review_candidate",
      historicalStarStatus: "not_supported",
      lineageProxyStatus: "not_supported",
      gateCStatus: "not_accepted",
      gateEStatus: "not_accepted",
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
    });
  });

  it("blocks file-order leakage and same-event updates", () => {
    const result = assessPrivateChronologicalValidation(
      input({
        externallyChronologicallyOrdered: false,
        sameEventHistoryUpdatedAfterPrediction: false,
      }),
    );
    expect(result.chronologyStatus).toBe("invalid");
    expect(result.directHistoryStatus).toBe("insufficient_evidence");
    expect(result.warnings).toContain("CHRONOLOGICAL_ORDER_INVALID");
  });

  it("requires partial events to stay outside outcome scoring", () => {
    const result = assessPrivateChronologicalValidation(
      input({ partialEventsExcludedFromOutcomeScoring: false }),
    );
    expect(result.directHistoryStatus).toBe("insufficient_evidence");
    expect(result.warnings).toContain("PARTIAL_EVENTS_INCLUDED_IN_OUTCOMES");
  });

  it("requires gate count in the benchmark context", () => {
    const result = assessPrivateChronologicalValidation(
      input({
        baselinePartitions: {
          mode: true,
          exactDistanceMetres: true,
          gateCount: false,
        },
      }),
    );
    expect(result.directHistoryStatus).toBe("insufficient_evidence");
    expect(result.warnings).toContain("BASELINE_CONTEXT_INCOMPLETE");
  });

  it("does not promote negative star or lineage lift", () => {
    const result = assessPrivateChronologicalValidation(input());
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "HISTORICAL_STAR_FEATURE_NOT_SUPPORTED",
        "LINEAGE_PROXY_NOT_SUPPORTED",
      ]),
    );
  });

  it("blocks breeding and Maiden claims without point-in-time evidence", () => {
    const result = assessPrivateChronologicalValidation(input());
    expect(result.breedingStatus).toBe("blocked_missing_timestamps");
    expect(result.maidenStatus).toBe(
      "blocked_missing_point_in_time_entitlement",
    );
  });

  it("recognizes representative background capacity without claiming runtime p95", () => {
    const result = assessPrivateChronologicalValidation(input());
    expect(result.capacityStatus).toBe("representative_background_only");
    expect(result.warnings).toContain("ROUTINE_REQUEST_CAPACITY_NOT_MEASURED");
  });

  it("requires historical BGC races to create no race-ledger transaction", () => {
    const result = assessPrivateChronologicalValidation(
      input({
        economics: {
          historicalBgcRows: 10,
          raceLedgerTransactionsFromHistoricalBgc: 1,
          unknownRaceAssetRows: 0,
        },
      }),
    );
    expect(result.economicsStatus).toBe("invalid");
    expect(result.warnings).toContain("BGC_EXCEPTION_INVALID");
  });

  it("rejects irreconcilable aggregate coverage", () => {
    expect(() =>
      assessPrivateChronologicalValidation(input({ uniqueRows: 1 })),
    ).toThrow(/coverage counts/);
  });
});
