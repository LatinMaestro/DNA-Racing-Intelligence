import { describe, expect, it } from "vitest";

import {
  evaluateOpenRaceChronologicalHoldout,
  type OpenRaceHoldoutCase,
  type OpenRaceHoldoutConfiguration,
} from "../domain/open-race-holdout-evaluation";

const configuration: OpenRaceHoldoutConfiguration = {
  holdoutStartsAt: "2026-07-01T00:00:00Z",
  holdoutEndsAt: "2026-08-01T00:00:00Z",
  minimumCompleteCases: 2,
  minimumCompetitiveRateLift: 0.2,
  minimumRegretImprovementMs: 50,
  modelVersion: "open-race-time-v1",
  baselineVersion: "median-vault-v1",
  evidenceSource: "synthetic",
};

function holdoutCase(
  id: string,
  overrides: Partial<OpenRaceHoldoutCase> = {},
): OpenRaceHoldoutCase {
  return {
    caseId: `case-${id}`,
    eventId: `event-${id}`,
    mode: "horse",
    distanceMeters: 1600,
    featureCutoffAt: `2026-07-${id.padStart(2, "0")}T09:00:00Z`,
    decisionAt: `2026-07-${id.padStart(2, "0")}T10:00:00Z`,
    fieldLockedAt: `2026-07-${id.padStart(2, "0")}T10:05:00Z`,
    outcomeAt: `2026-07-${id.padStart(2, "0")}T10:10:00Z`,
    dataCurrentThrough: `2026-07-${id.padStart(2, "0")}T08:00:00Z`,
    historicalFreshness: "current",
    currentRaceStarsKnownAtDecision: false,
    eligibleCoreIds: ["model-core", "baseline-core", "other-core"],
    modelSelectedCoreId: "model-core",
    baselineSelectedCoreId: "baseline-core",
    actualBestEligibleCoreIds: ["model-core"],
    modelRealizedTimeMs: 10_000,
    baselineRealizedTimeMs: 10_200,
    bestEligibleTimeMs: 10_000,
    modelCompetitiveOutcome: true,
    baselineCompetitiveOutcome: false,
    modelAvoidSignal: false,
    entryShouldHaveBeenAvoided: false,
    evidenceStatus: "complete",
    ...overrides,
  };
}

describe("Open Race chronological holdout evaluation", () => {
  it("compares the frozen model decision with a distinct simple baseline", () => {
    const report = evaluateOpenRaceChronologicalHoldout(
      [holdoutCase("1"), holdoutCase("2")],
      configuration,
    );
    expect(report.overall).toMatchObject({
      completeCaseCount: 2,
      modelCompetitiveRate: 1,
      baselineCompetitiveRate: 0,
      competitiveRateLift: 1,
      modelBestSelectionCount: 2,
      baselineBestSelectionCount: 0,
      modelMeanRegretMs: 0,
      baselineMeanRegretMs: 200,
      regretImprovementMs: 200,
      evaluatedAvoidDecisionCount: 2,
      correctAvoidDecisionCount: 2,
      avoidDecisionAccuracy: 1,
      evidenceStatus: "model_better_than_baseline",
    });
  });

  it("never self-passes Gate C from synthetic evidence", () => {
    const report = evaluateOpenRaceChronologicalHoldout(
      [holdoutCase("1"), holdoutCase("2")],
      configuration,
    );
    expect(report).toMatchObject({
      gateCStatus: "evidence_only",
      gateCPassed: false,
      actionableRecommendationsAllowed: false,
    });
    expect(report.warnings).toContain("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  });

  it("rejects current-race stars and post-decision feature leakage", () => {
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          {
            ...holdoutCase("1"),
            currentRaceStarsKnownAtDecision: true,
          } as unknown as OpenRaceHoldoutCase,
        ],
        configuration,
      ),
    ).toThrow("must be unavailable");
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          holdoutCase("1", {
            featureCutoffAt: "2026-07-01T10:01:00Z",
          }),
        ],
        configuration,
      ),
    ).toThrow("times are invalid");
  });

  it("requires decision, lock and outcome chronology", () => {
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          holdoutCase("1", {
            fieldLockedAt: "2026-07-01T09:59:00Z",
          }),
        ],
        configuration,
      ),
    ).toThrow("times are invalid");
  });

  it("excludes partial evidence and warns on stale inputs", () => {
    const report = evaluateOpenRaceChronologicalHoldout(
      [
        holdoutCase("1"),
        holdoutCase("2", {
          evidenceStatus: "partial",
          historicalFreshness: "stale",
          modelRealizedTimeMs: null,
          baselineRealizedTimeMs: null,
          bestEligibleTimeMs: null,
          modelCompetitiveOutcome: null,
          baselineCompetitiveOutcome: null,
          modelAvoidSignal: null,
          entryShouldHaveBeenAvoided: null,
        }),
      ],
      configuration,
    );
    expect(report.overall).toMatchObject({
      totalCaseCount: 2,
      completeCaseCount: 1,
      excludedCaseCount: 1,
      evidenceStatus: "insufficient_sample",
    });
    expect(report.warnings).toEqual(
      expect.arrayContaining([
        "PARTIAL_OR_INVALID_CASES_EXCLUDED",
        "STALE_HISTORICAL_EVIDENCE_PRESENT",
        "INSUFFICIENT_COMPLETE_CASES",
      ]),
    );
  });

  it("keeps Bike, Car and Horse exact-distance cells separate", () => {
    const report = evaluateOpenRaceChronologicalHoldout(
      [
        holdoutCase("1"),
        holdoutCase("2", { mode: "bike", distanceMeters: 1000 }),
        holdoutCase("3", { mode: "car", distanceMeters: 1800 }),
      ],
      configuration,
    );
    expect(
      report.exactCells.map(({ mode, distanceMeters }) => [
        mode,
        distanceMeters,
      ]),
    ).toEqual([
      ["bike", 1000],
      ["car", 1800],
      ["horse", 1600],
    ]);
  });

  it("validates eligible selections, best-core identity and realized times", () => {
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          holdoutCase("1", {
            modelSelectedCoreId: "not-eligible",
          }),
        ],
        configuration,
      ),
    ).toThrow("Selected cores must be eligible");
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          holdoutCase("1", {
            actualBestEligibleCoreIds: ["baseline-core"],
          }),
        ],
        configuration,
      ),
    ).toThrow("Model best-core identity and time disagree");
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [
          holdoutCase("1", {
            baselineSelectedCoreId: "model-core",
            actualBestEligibleCoreIds: ["other-core"],
            bestEligibleTimeMs: 9_900,
            modelRealizedTimeMs: 10_000,
            baselineRealizedTimeMs: 10_100,
            baselineCompetitiveOutcome: false,
          }),
        ],
        configuration,
      ),
    ).toThrow("same selected core");
  });

  it("rejects duplicate authoritative events and invalid configuration", () => {
    expect(() =>
      evaluateOpenRaceChronologicalHoldout(
        [holdoutCase("1"), holdoutCase("2", { eventId: "event-1" })],
        configuration,
      ),
    ).toThrow("event IDs must be unique");
    expect(() =>
      evaluateOpenRaceChronologicalHoldout([holdoutCase("1")], {
        ...configuration,
        baselineVersion: configuration.modelVersion,
      }),
    ).toThrow("must be distinct");
  });
});
