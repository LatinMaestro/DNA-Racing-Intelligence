import { describe, expect, it } from "vitest";

import {
  evaluateDiscoveryChronologicalHoldout,
  type DiscoveryHoldoutPrediction,
} from "@/domain/discovery-holdout-evaluation";

const configuration = {
  trainingDataThrough: "2026-06-30T23:59:59Z",
  holdoutStartsAt: "2026-07-01T00:00:00Z",
  holdoutEndsAt: "2026-08-01T00:00:00Z",
  minimumPredictions: 2,
  minimumLift: 0.01,
  maximumCalibrationGap: 0.25,
  modelVersion: "time-star-v1",
  baselineVersion: "time-only-v1",
} as const;

function prediction(
  id: string,
  overrides: Partial<DiscoveryHoldoutPrediction> = {},
): DiscoveryHoldoutPrediction {
  return {
    predictionId: id,
    eventId: `event-${id}`,
    coreId: `core-${id}`,
    mode: "bike",
    distanceMetres: 1400,
    eventAt: `2026-07-${id.padStart(2, "0")}T12:00:00Z`,
    featureCutoffAt: `2026-07-${id.padStart(2, "0")}T11:59:59Z`,
    competitiveTimeOutcome: id === "1",
    timeAndStarProbability: id === "1" ? 0.8 : 0.2,
    timeOnlyBaselineProbability: 0.5,
    starFeatureStatus: "complete",
    ...overrides,
  };
}

describe("Discovery chronological holdout evaluation", () => {
  it("compares time-plus-star predictions with the time-only baseline", () => {
    const report = evaluateDiscoveryChronologicalHoldout(
      [prediction("1"), prediction("2")],
      configuration,
    );
    expect(report.overall).toEqual(
      expect.objectContaining({
        predictionCount: 2,
        timeAndStarBrierScore: 0.04,
        timeOnlyBaselineBrierScore: 0.25,
        brierLift: 0.21,
        evidenceStatus: "candidate_better_than_baseline",
      }),
    );
  });

  it("never self-passes Gate C from synthetic evaluation", () => {
    const report = evaluateDiscoveryChronologicalHoldout(
      [prediction("1"), prediction("2")],
      configuration,
    );
    expect(report.gateCPassed).toBe(false);
    expect(report.gateCStatus).toBe("evidence_only");
    expect(report.actionableRecommendationsAllowed).toBe(false);
    expect(report.warnings).toContain("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  });

  it("fails closed on current-event or future feature leakage", () => {
    expect(() =>
      evaluateDiscoveryChronologicalHoldout(
        [
          prediction("1", {
            featureCutoffAt: "2026-07-01T12:00:00Z",
          }),
        ],
        configuration,
      ),
    ).toThrow("strictly earlier");
  });

  it("requires every event to fall inside the declared holdout", () => {
    expect(() =>
      evaluateDiscoveryChronologicalHoldout(
        [prediction("1", { eventAt: "2026-08-01T00:00:00Z" })],
        configuration,
      ),
    ).toThrow("inside the holdout window");
  });

  it("reports insufficient samples and partial star coverage", () => {
    const report = evaluateDiscoveryChronologicalHoldout(
      [prediction("1", { starFeatureStatus: "partial" })],
      configuration,
    );
    expect(report.overall.evidenceStatus).toBe("insufficient_sample");
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "INSUFFICIENT_HOLDOUT_SAMPLE",
        "PARTIAL_STAR_FEATURE_COVERAGE",
      ]),
    );
  });

  it("keeps exact mode and distance cells separate", () => {
    const report = evaluateDiscoveryChronologicalHoldout(
      [
        prediction("1"),
        prediction("2"),
        prediction("3", {
          mode: "horse",
          distanceMetres: 1800,
          competitiveTimeOutcome: true,
          timeAndStarProbability: 0.7,
        }),
      ],
      configuration,
    );
    expect(report.exactCells).toHaveLength(2);
    expect(
      report.exactCells.map(({ mode, distanceMetres }) => [
        mode,
        distanceMetres,
      ]),
    ).toEqual([
      ["bike", 1400],
      ["horse", 1800],
    ]);
  });

  it("surfaces no-lift and calibration review states", () => {
    const report = evaluateDiscoveryChronologicalHoldout(
      [
        prediction("1", {
          timeAndStarProbability: 0.1,
          timeOnlyBaselineProbability: 0.8,
        }),
        prediction("2", {
          timeAndStarProbability: 0.9,
          timeOnlyBaselineProbability: 0.2,
        }),
      ],
      configuration,
    );
    expect(report.overall.evidenceStatus).toBe(
      "candidate_not_better_than_baseline",
    );
    expect(report.warnings).toContain("NO_INCREMENTAL_LIFT");
  });

  it("rejects duplicate observations and invalid runtime values", () => {
    expect(() =>
      evaluateDiscoveryChronologicalHoldout(
        [prediction("1"), prediction("1")],
        configuration,
      ),
    ).toThrow("prediction IDs must be unique");
    expect(() =>
      evaluateDiscoveryChronologicalHoldout(
        [
          prediction("1"),
          prediction("2", {
            eventId: "event-1",
            coreId: "core-1",
          }),
        ],
        configuration,
      ),
    ).toThrow("authoritative event and core");
    expect(() =>
      evaluateDiscoveryChronologicalHoldout(
        [
          prediction("1", {
            mode: "plane" as DiscoveryHoldoutPrediction["mode"],
          }),
        ],
        configuration,
      ),
    ).toThrow("mode is invalid");
  });

  it("requires ordered windows and distinct model versions", () => {
    expect(() =>
      evaluateDiscoveryChronologicalHoldout([prediction("1")], {
        ...configuration,
        trainingDataThrough: configuration.holdoutStartsAt,
      }),
    ).toThrow("strictly ordered");
    expect(() =>
      evaluateDiscoveryChronologicalHoldout([prediction("1")], {
        ...configuration,
        baselineVersion: configuration.modelVersion,
      }),
    ).toThrow("must be distinct");
  });
});
