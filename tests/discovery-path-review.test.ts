import { describe, expect, it } from "vitest";

import {
  reviewDiscoveryPath,
  type DiscoveryPathReviewInput,
} from "@/domain/discovery-path-review";

const thresholds = {
  continuePercentile: 70,
  weakPercentile: 30,
  minimumDirectRaces: 10,
  version: "synthetic-v1",
} as const;

function input(
  overrides: Partial<DiscoveryPathReviewInput> = {},
): DiscoveryPathReviewInput {
  return {
    coreId: "core-a",
    mode: "bike",
    distanceMetres: 1400,
    directRaceCount: 6,
    successfulTimePercentile: 75,
    timeDirection: "stable",
    earlyStrongFieldStarCount: 0,
    weakFieldEligibleNoStarCount: 0,
    starDataStatus: "complete",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    ...overrides,
  };
}

describe("discovery path review", () => {
  it("uses competitive time as the primary continue evidence", () => {
    const result = reviewDiscoveryPath(input(), thresholds);
    expect(result).toEqual(
      expect.objectContaining({
        reviewSignal: "continue_candidate",
        primaryReason: "competitive_time",
        actionable: false,
        automaticStopAllowed: false,
      }),
    );
  });

  it("allows early strong-field stars to support more review only", () => {
    const result = reviewDiscoveryPath(
      input({
        successfulTimePercentile: 50,
        earlyStrongFieldStarCount: 1,
      }),
      thresholds,
    );
    expect(result).toEqual(
      expect.objectContaining({
        reviewSignal: "continue_candidate",
        primaryReason: "early_strong_field_support",
        additionalRacesToMinimum: 4,
      }),
    );
  });

  it("never creates a stop from no-star evidence alone", () => {
    const result = reviewDiscoveryPath(
      input({
        directRaceCount: 10,
        successfulTimePercentile: 50,
        weakFieldEligibleNoStarCount: 8,
      }),
      thresholds,
    );
    expect(result.reviewSignal).toBe("hold_for_more_evidence");
    expect(result.warnings).toContain("NO_STAR_NON_DISPOSITIVE");
  });

  it("creates only a non-actionable stop candidate from mature weak time", () => {
    const result = reviewDiscoveryPath(
      input({
        directRaceCount: 12,
        successfulTimePercentile: 20,
        timeDirection: "declining",
        weakFieldEligibleNoStarCount: 6,
      }),
      thresholds,
    );
    expect(result).toEqual(
      expect.objectContaining({
        reviewSignal: "stop_candidate",
        primaryReason: "weak_time_after_minimum",
        actionable: false,
        automaticStopAllowed: false,
      }),
    );
  });

  it("holds a time-star mismatch for review", () => {
    const result = reviewDiscoveryPath(
      input({
        directRaceCount: 10,
        successfulTimePercentile: 20,
        earlyStrongFieldStarCount: 1,
      }),
      thresholds,
    );
    expect(result.reviewSignal).toBe("hold_for_more_evidence");
    expect(result.warnings).toContain("TIME_STAR_MISMATCH");
  });

  it("fails closed on stale or unknown-cutoff evidence", () => {
    const result = reviewDiscoveryPath(
      input({
        freshness: "stale",
        dataCurrentThrough: null,
      }),
      thresholds,
    );
    expect(result.reviewSignal).toBe("insufficient_evidence");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "DATA_STALE"]),
    );
  });

  it("requires direct time evidence to reconcile with race count", () => {
    expect(() =>
      reviewDiscoveryPath(
        input({
          directRaceCount: 0,
          successfulTimePercentile: 75,
          timeDirection: "stable",
        }),
        thresholds,
      ),
    ).toThrow("Time evidence requires at least one direct race");
  });

  it("requires versioned, ordered thresholds and valid runtime enums", () => {
    expect(() =>
      reviewDiscoveryPath(input(), {
        ...thresholds,
        weakPercentile: 80,
      }),
    ).toThrow("must be lower");

    expect(() =>
      reviewDiscoveryPath(
        input({ mode: "plane" as DiscoveryPathReviewInput["mode"] }),
        thresholds,
      ),
    ).toThrow("mode is invalid");
  });
});
