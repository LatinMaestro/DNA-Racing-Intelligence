import { describe, expect, it } from "vitest";
import {
  detectStarAlgorithmEraCandidates,
  type StarEraDetectionPolicy,
  type StarEraPeriodInput,
} from "@/domain/star-algorithm-era-detection";

const policy: StarEraDetectionPolicy = {
  minimumEventsPerPeriod: 20,
  minimumOutcomeEventsPerPeriod: 10,
  assignmentShiftThresholdBasisPoints: 1_500,
  conversionShiftThresholdBasisPoints: 2_000,
};

function period(
  overrides: Partial<StarEraPeriodInput> = {},
): StarEraPeriodInput {
  return {
    periodId: "early",
    startsAt: "2026-01-01T00:00:00Z",
    endsAt: "2026-01-31T23:59:59Z",
    mode: "bike",
    distance: 1_000,
    validEventCount: 40,
    goldEligibleEventCount: 40,
    goldAssignedEventCount: 32,
    blueOpportunityEventCount: 40,
    blueAssignedEventCount: 30,
    goldOutcomeKnownCount: 30,
    goldTopThreeCount: 24,
    blueOutcomeKnownCount: 28,
    blueWinCount: 14,
    evidenceStatus: "complete",
    ...overrides,
  };
}

function later(
  overrides: Partial<StarEraPeriodInput> = {},
): StarEraPeriodInput {
  return period({
    periodId: "later",
    startsAt: "2026-02-01T00:00:00Z",
    endsAt: "2026-02-28T23:59:59Z",
    ...overrides,
  });
}

describe("Phase 9 star-algorithm era detection", () => {
  it("raises a review candidate for a material assignment shift", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        later({
          goldAssignedEventCount: 20,
          blueAssignedEventCount: 20,
          goldOutcomeKnownCount: 20,
          goldTopThreeCount: 16,
          blueOutcomeKnownCount: 20,
          blueWinCount: 10,
        }),
        period(),
      ],
      policy,
    );

    expect(report.status).toBe("review_candidates_present");
    expect(report.comparisons[0]).toMatchObject({
      status: "review_candidate",
      assignmentShiftDetected: true,
      conversionShiftDetected: false,
      algorithmChangeConfirmed: false,
      automaticEraSegmentationAllowed: false,
    });
    expect(report.comparisons[0]?.warnings).toEqual([
      "ASSIGNMENT_SHIFT_ONLY",
      "CHANGE_CAUSE_UNKNOWN",
    ]);
  });

  it("raises a review candidate for a material conversion shift", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later({
          goldTopThreeCount: 12,
          blueWinCount: 4,
        }),
      ],
      policy,
    );

    expect(report.comparisons[0]).toMatchObject({
      status: "review_candidate",
      assignmentShiftDetected: false,
      conversionShiftDetected: true,
    });
    expect(report.comparisons[0]?.warnings).toContain("CONVERSION_SHIFT_ONLY");
  });

  it("reports no material shift where exact rates remain within policy", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later({
          goldAssignedEventCount: 30,
          blueAssignedEventCount: 28,
          goldTopThreeCount: 22,
          blueWinCount: 13,
        }),
      ],
      policy,
    );

    expect(report.status).toBe("no_material_shift_detected");
    expect(report.comparisons[0]?.status).toBe("no_material_shift_detected");
  });

  it("fails closed when a period is partial", () => {
    const report = detectStarAlgorithmEraCandidates(
      [period(), later({ evidenceStatus: "partial" })],
      policy,
    );

    expect(report.status).toBe("insufficient_evidence");
    expect(report.comparisons[0]).toMatchObject({
      status: "insufficient_evidence",
      assignmentShiftDetected: false,
      conversionShiftDetected: false,
    });
    expect(report.comparisons[0]?.warnings).toContain(
      "PARTIAL_PERIOD_EXCLUDED",
    );
  });

  it("fails closed when assignment or outcome denominators are too small", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later({
          validEventCount: 10,
          goldEligibleEventCount: 10,
          goldAssignedEventCount: 8,
          blueOpportunityEventCount: 10,
          blueAssignedEventCount: 8,
          goldOutcomeKnownCount: 8,
          goldTopThreeCount: 4,
          blueOutcomeKnownCount: 8,
          blueWinCount: 2,
        }),
      ],
      policy,
    );

    expect(report.comparisons[0]?.status).toBe("insufficient_evidence");
    expect(report.comparisons[0]?.warnings).toEqual(
      expect.arrayContaining([
        "EVENT_SAMPLE_BELOW_MINIMUM",
        "OUTCOME_SAMPLE_BELOW_MINIMUM",
      ]),
    );
  });

  it("keeps mode and exact distance comparisons separate", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later(),
        period({
          periodId: "car-early",
          mode: "car",
        }),
        later({
          periodId: "car-later",
          mode: "car",
          goldAssignedEventCount: 20,
          goldOutcomeKnownCount: 20,
          goldTopThreeCount: 16,
        }),
        period({
          periodId: "bike-1200-only",
          distance: 1_200,
        }),
      ],
      policy,
    );

    expect(report.comparisons).toHaveLength(2);
    expect(
      report.comparisons.map((item) => [item.mode, item.distance]),
    ).toEqual([
      ["bike", 1_000],
      ["car", 1_000],
    ]);
  });

  it("does not describe mixed sufficient and insufficient coverage as stable", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later(),
        period({
          periodId: "car-early",
          mode: "car",
          validEventCount: 10,
          goldEligibleEventCount: 10,
          goldAssignedEventCount: 8,
          blueOpportunityEventCount: 10,
          blueAssignedEventCount: 8,
          goldOutcomeKnownCount: 8,
          goldTopThreeCount: 6,
          blueOutcomeKnownCount: 8,
          blueWinCount: 4,
        }),
        later({
          periodId: "car-later",
          mode: "car",
          validEventCount: 10,
          goldEligibleEventCount: 10,
          goldAssignedEventCount: 8,
          blueOpportunityEventCount: 10,
          blueAssignedEventCount: 8,
          goldOutcomeKnownCount: 8,
          goldTopThreeCount: 6,
          blueOutcomeKnownCount: 8,
          blueWinCount: 4,
        }),
      ],
      policy,
    );

    expect(report.status).toBe("insufficient_evidence");
  });

  it("rejects overlapping periods and inconsistent counts", () => {
    expect(() =>
      detectStarAlgorithmEraCandidates(
        [
          period(),
          later({
            startsAt: "2026-01-20T00:00:00Z",
            endsAt: "2026-02-20T00:00:00Z",
          }),
        ],
        policy,
      ),
    ).toThrow(/non-overlapping/);

    expect(() =>
      detectStarAlgorithmEraCandidates(
        [period({ goldAssignedEventCount: 41 })],
        policy,
      ),
    ).toThrow(/inconsistent/);
  });

  it("never self-accepts Gate C or confirms a hidden algorithm change", () => {
    const report = detectStarAlgorithmEraCandidates(
      [
        period(),
        later({
          goldAssignedEventCount: 10,
          goldOutcomeKnownCount: 10,
          goldTopThreeCount: 8,
        }),
      ],
      policy,
    );

    expect(report).toMatchObject({
      gateCStatus: "not_assessed",
      syntheticEvidenceCanConfirmChange: false,
    });
    expect(report.comparisons[0]?.algorithmChangeConfirmed).toBe(false);
  });
});
