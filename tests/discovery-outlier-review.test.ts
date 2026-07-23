import { describe, expect, it } from "vitest";

import {
  reviewUnexpectedOutlier,
  type DiscoveryOutlierInput,
} from "@/domain/discovery-outlier-review";

const thresholds = {
  elitePercentile: 95,
  unexpectedGapPoints: 25,
  repeatedObservationCount: 2,
  version: "synthetic-v1",
} as const;

function input(
  overrides: Partial<DiscoveryOutlierInput> = {},
): DiscoveryOutlierInput {
  return {
    coreId: "core-a",
    mode: "horse",
    distanceMetres: 1600,
    directRaceCount: 4,
    bestTimePercentile: 98,
    medianTimePercentile: 65,
    priorExpectedPercentile: 60,
    eliteObservationCount: 1,
    earlyStrongFieldStarCount: 1,
    observationStatus: "complete",
    freshness: "current",
    evidenceCutoff: "2026-07-20T00:00:00Z",
    ...overrides,
  };
}

describe("unexpected Discovery outlier review", () => {
  it("flags an unexpected time outlier without confirming elite quality", () => {
    const result = reviewUnexpectedOutlier(input(), thresholds);
    expect(result).toEqual(
      expect.objectContaining({
        status: "unexpected_outlier_candidate",
        repeatStatus: "single_observation",
        primaryEvidence: "time",
        eliteQualityConfirmed: false,
        actionable: false,
      }),
    );
  });

  it("distinguishes repeated exceptional observations", () => {
    const result = reviewUnexpectedOutlier(
      input({ eliteObservationCount: 3 }),
      thresholds,
    );
    expect(result.repeatStatus).toBe("repeated_observations");
    expect(result.warnings).not.toContain("SINGLE_OBSERVATION");
  });

  it("separates expected elite evidence from an unexpected outlier", () => {
    const result = reviewUnexpectedOutlier(
      input({ priorExpectedPercentile: 90 }),
      thresholds,
    );
    expect(result.status).toBe("expected_elite_candidate");
  });

  it("does not create an outlier from stars without elite time", () => {
    const result = reviewUnexpectedOutlier(
      input({
        bestTimePercentile: 70,
        priorExpectedPercentile: 30,
        earlyStrongFieldStarCount: 3,
        eliteObservationCount: 0,
      }),
      thresholds,
    );
    expect(result.status).toBe("no_outlier_signal");
    expect(result.warnings).toContain("STAR_SUPPORT_ONLY");
  });

  it("fails closed on partial, stale or unknown-cutoff evidence", () => {
    const result = reviewUnexpectedOutlier(
      input({
        observationStatus: "partial",
        freshness: "stale",
        evidenceCutoff: null,
      }),
      thresholds,
    );
    expect(result.status).toBe("insufficient_evidence");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "PARTIAL_OR_INVALID_OBSERVATIONS",
        "DATA_CUTOFF_UNKNOWN",
        "DATA_STALE",
      ]),
    );
  });

  it("keeps an unavailable prior explicit", () => {
    const result = reviewUnexpectedOutlier(
      input({ priorExpectedPercentile: null }),
      thresholds,
    );
    expect(result.status).toBe("expected_elite_candidate");
    expect(result.warnings).toContain("PRIOR_EXPECTATION_UNAVAILABLE");
  });

  it("rejects inconsistent supporting counts", () => {
    expect(() =>
      reviewUnexpectedOutlier(
        input({ directRaceCount: 2, eliteObservationCount: 3 }),
        thresholds,
      ),
    ).toThrow("cannot exceed direct races");
  });

  it("requires versioned and valid thresholds and runtime enums", () => {
    expect(() =>
      reviewUnexpectedOutlier(input(), {
        ...thresholds,
        repeatedObservationCount: 1,
      }),
    ).toThrow("at least two");

    expect(() =>
      reviewUnexpectedOutlier(
        input({ mode: "plane" as DiscoveryOutlierInput["mode"] }),
        thresholds,
      ),
    ).toThrow("mode is invalid");
  });
});
