import { describe, expect, it } from "vitest";
import {
  assessEvidenceConfidence,
  type AnalyticalValidationInput,
  type EvidenceConfidenceInput,
} from "@/domain/evidence-confidence";
import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { CoreStarProfile } from "@/domain/star-signals";

const cutoff = "2026-07-20T00:00:00Z";
const importedAt = "2026-07-20T02:00:00Z";

function starProfile(
  overrides: Partial<CoreStarProfile> = {},
): CoreStarProfile {
  return {
    coreId: "core-a",
    mode: "bike",
    distance: 1_000,
    dataCurrentThrough: cutoff,
    raceCount: 10,
    completeStarDataRaceCount: 10,
    partialStarDataRaceCount: 0,
    missingStarDataRaceCount: 0,
    invalidStarDataRaceCount: 0,
    goldEligibleRaceCount: 8,
    goldAssignmentOpportunityCount: 7,
    goldReceivedCount: 3,
    goldNegativeOpportunityCount: 4,
    goldEligibleNoAssignmentCount: 1,
    goldIneligibleAssignmentCount: 0,
    goldExcludedAnomalyCount: 0,
    goldReceivedRate: { numerator: 3, denominator: 7 },
    blueAssignmentOpportunityCount: 9,
    blueReceivedCount: 2,
    blueNegativeOpportunityCount: 7,
    blueNoAssignmentCount: 1,
    blueExcludedAnomalyCount: 0,
    blueReceivedRate: { numerator: 2, denominator: 9 },
    sameCoreReceivedBothCount: 1,
    ...overrides,
  };
}

function profile(
  raceCount = 10,
  overrides: Partial<CorePerformanceProfile> = {},
): CorePerformanceProfile {
  return {
    coreId: "core-a",
    mode: "bike",
    distance: 1_000,
    dataCurrentThrough: cutoff,
    freshness: "current",
    raceCount,
    sampleStatus: raceCount >= 10 ? "minimally_analytical" : "hypothesis_only",
    elapsedTime: {
      bestMilliseconds: 50_000,
      medianMilliseconds: 55_000,
      meanMilliseconds: 55_000,
      trimmedMeanMilliseconds: 55_000,
      standardDeviationMilliseconds: 1_000,
      interquartileRangeMilliseconds: 1_500,
    },
    speed: {
      bestMetresPerSecond: 20,
      medianMetresPerSecond: 18.182,
    },
    starProfile: starProfile({ raceCount }),
    analyticalStatus: "experimental",
    ...overrides,
  };
}

const incompleteValidation: AnalyticalValidationInput = {
  chronologicalHoldout: "not_run",
  baselineComparison: "not_run",
  calibration: "not_run",
};

function input(
  overrides: Partial<EvidenceConfidenceInput> = {},
): EvidenceConfidenceInput {
  return {
    profile: profile(),
    lastImportedAt: importedAt,
    benchmark: {
      comparisonEventCount: 20,
      completeOutcomeEventCount: 20,
      partialOutcomeEventCount: 0,
      dataCurrentThrough: cutoff,
    },
    lineage: {
      resolvedRelationshipCount: 4,
      unresolvedRelationshipCount: 0,
    },
    validation: incompleteValidation,
    ...overrides,
  };
}

describe("Phase 2 evidence confidence", () => {
  it("keeps a minimally analytical profile experimental before validation", () => {
    const assessment = assessEvidenceConfidence(input());

    expect(assessment).toMatchObject({
      level: "moderate",
      analyticalReadiness: "experimental",
      direct: {
        raceCount: 10,
        minimumRaceCount: 10,
        sampleStatus: "minimally_analytical",
      },
      warnings: ["CHRONOLOGICAL_VALIDATION_INCOMPLETE"],
    });
  });

  it("labels zero direct evidence insufficient without fabricating coverage", () => {
    const assessment = assessEvidenceConfidence(
      input({
        profile: profile(0, { starProfile: null }),
        lastImportedAt: null,
        benchmark: {
          comparisonEventCount: 0,
          completeOutcomeEventCount: 0,
          partialOutcomeEventCount: 0,
          dataCurrentThrough: null,
        },
        lineage: {
          resolvedRelationshipCount: 0,
          unresolvedRelationshipCount: 0,
        },
      }),
    );

    expect(assessment).toMatchObject({
      level: "insufficient",
      analyticalReadiness: "experimental",
      stars: { status: "unavailable", raceCount: 0 },
      benchmark: { status: "unavailable" },
      lineage: { status: "unavailable" },
    });
    expect(assessment.warnings).toEqual([
      "DIRECT_EVIDENCE_UNAVAILABLE",
      "IMPORT_TIME_UNKNOWN",
      "STAR_EVIDENCE_UNAVAILABLE",
      "BENCHMARK_EVIDENCE_UNAVAILABLE",
      "LINEAGE_EVIDENCE_UNAVAILABLE",
      "CHRONOLOGICAL_VALIDATION_INCOMPLETE",
    ]);
  });

  it("keeps fewer than ten exact-distance races low confidence", () => {
    const assessment = assessEvidenceConfidence(
      input({
        profile: profile(9, {
          starProfile: starProfile({
            raceCount: 9,
            completeStarDataRaceCount: 9,
          }),
        }),
      }),
    );

    expect(assessment.level).toBe("low");
    expect(assessment.direct.sampleStatus).toBe("hypothesis_only");
    expect(assessment.warnings).toContain("DIRECT_SAMPLE_BELOW_MINIMUM");
  });

  it("requires holdout, baseline, calibration and complete benchmarks for high confidence", () => {
    const passed: AnalyticalValidationInput = {
      chronologicalHoldout: "passed",
      baselineComparison: "passed",
      calibration: "passed",
    };
    const assessment = assessEvidenceConfidence(input({ validation: passed }));

    expect(assessment.level).toBe("high");
    expect(assessment.analyticalReadiness).toBe("validated_evidence");
    expect(assessment.warnings).toEqual([]);

    expect(
      assessEvidenceConfidence(
        input({
          validation: passed,
          benchmark: {
            comparisonEventCount: 20,
            completeOutcomeEventCount: 15,
            partialOutcomeEventCount: 5,
            dataCurrentThrough: cutoff,
          },
        }),
      ).level,
    ).toBe("moderate");

    expect(
      assessEvidenceConfidence(
        input({ validation: passed, lastImportedAt: null }),
      ).level,
    ).toBe("moderate");
  });

  it("caps stale evidence and failed validation at low confidence", () => {
    const stale = assessEvidenceConfidence(
      input({
        profile: profile(40, {
          freshness: "stale",
          starProfile: starProfile({
            raceCount: 40,
            completeStarDataRaceCount: 40,
          }),
        }),
        validation: {
          chronologicalHoldout: "passed",
          baselineComparison: "passed",
          calibration: "passed",
        },
      }),
    );
    expect(stale.level).toBe("low");
    expect(stale.warnings).toContain("DATA_STALE");

    const failed = assessEvidenceConfidence(
      input({
        validation: {
          chronologicalHoldout: "failed",
          baselineComparison: "passed",
          calibration: "passed",
        },
      }),
    );
    expect(failed.level).toBe("low");
    expect(failed.warnings).toContain("CHRONOLOGICAL_VALIDATION_FAILED");
  });

  it("exposes partial star, benchmark and lineage coverage independently", () => {
    const assessment = assessEvidenceConfidence(
      input({
        profile: profile(10, {
          starProfile: starProfile({
            completeStarDataRaceCount: 6,
            partialStarDataRaceCount: 1,
            missingStarDataRaceCount: 2,
            invalidStarDataRaceCount: 1,
            goldIneligibleAssignmentCount: 1,
          }),
        }),
        benchmark: {
          comparisonEventCount: 20,
          completeOutcomeEventCount: 15,
          partialOutcomeEventCount: 5,
          dataCurrentThrough: cutoff,
        },
        lineage: {
          resolvedRelationshipCount: 3,
          unresolvedRelationshipCount: 2,
        },
      }),
    );

    expect(assessment.stars).toMatchObject({
      status: "partial",
      completeRaceCount: 6,
      partialRaceCount: 1,
      missingRaceCount: 2,
      invalidRaceCount: 1,
      anomalyCount: 1,
      goldReceived: { numerator: 3, denominator: 7 },
      blueReceived: { numerator: 2, denominator: 9 },
    });
    expect(assessment.benchmark.status).toBe("partial");
    expect(assessment.lineage.status).toBe("partial");
    expect(assessment.warnings).toEqual([
      "STAR_EVIDENCE_PARTIAL",
      "STAR_EVIDENCE_ANOMALOUS",
      "BENCHMARK_OUTCOMES_PARTIAL",
      "LINEAGE_EVIDENCE_PARTIAL",
      "CHRONOLOGICAL_VALIDATION_INCOMPLETE",
    ]);
  });

  it("fails closed on inconsistent counts, keys, timestamps and sample labels", () => {
    expect(() =>
      assessEvidenceConfidence(
        input({
          profile: profile(10, { sampleStatus: "hypothesis_only" }),
        }),
      ),
    ).toThrow("does not match race count");

    expect(() =>
      assessEvidenceConfidence(
        input({
          profile: profile(10, {
            starProfile: starProfile({ distance: 1_200 }),
          }),
        }),
      ),
    ).toThrow("does not match the performance profile key");

    expect(() =>
      assessEvidenceConfidence(
        input({
          benchmark: {
            comparisonEventCount: 10,
            completeOutcomeEventCount: 7,
            partialOutcomeEventCount: 2,
            dataCurrentThrough: cutoff,
          },
        }),
      ),
    ).toThrow("must equal comparison events");

    expect(() =>
      assessEvidenceConfidence(
        input({ lastImportedAt: "2026-07-19T00:00:00Z" }),
      ),
    ).toThrow("cannot precede the profile data cutoff");

    expect(() =>
      assessEvidenceConfidence(
        input({
          profile: profile(10, { coreId: "" }),
        }),
      ),
    ).toThrow("identity or freshness is invalid");
  });

  it("does not consume quality metrics when deriving confidence", () => {
    const strongTimes = assessEvidenceConfidence(input());
    const weakTimes = assessEvidenceConfidence(
      input({
        profile: profile(10, {
          elapsedTime: {
            bestMilliseconds: 999_000,
            medianMilliseconds: 999_000,
            meanMilliseconds: 999_000,
            trimmedMeanMilliseconds: 999_000,
            standardDeviationMilliseconds: 200_000,
            interquartileRangeMilliseconds: 300_000,
          },
        }),
      }),
    );

    expect(weakTimes).toEqual(strongTimes);
  });
});
