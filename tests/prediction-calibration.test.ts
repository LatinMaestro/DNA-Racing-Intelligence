import { describe, expect, it } from "vitest";

import {
  evaluatePredictionCalibration,
  type CalibrationPrediction,
  type PredictionCalibrationInput,
} from "../domain/prediction-calibration";

function pair(
  caseId: string,
  outcome: 0 | 1,
  candidate: number,
  baseline: number,
  evidenceSource: CalibrationPrediction["evidenceSource"] = "historical_holdout",
): CalibrationPrediction[] {
  const common = {
    caseId,
    outcome,
    predictedAt: "2026-06-01T00:00:00Z",
    outcomeObservedAt: "2026-06-02T00:00:00Z",
    evidenceSource,
  } as const;
  return [
    {
      ...common,
      modelRole: "candidate",
      predictedProbabilityBasisPoints: candidate,
    },
    {
      ...common,
      modelRole: "baseline",
      predictedProbabilityBasisPoints: baseline,
    },
  ];
}

function input(
  overrides: Partial<PredictionCalibrationInput> = {},
): PredictionCalibrationInput {
  return {
    reportId: "calibration-1",
    candidateModelId: "time-plus-stars-v1",
    baselineModelId: "time-only-v1",
    evaluatedAt: "2026-07-01T00:00:00Z",
    minimumRealHoldoutCases: 4,
    predictions: [
      ...pair("case-1", 1, 8_000, 6_000),
      ...pair("case-2", 1, 7_000, 5_500),
      ...pair("case-3", 0, 2_000, 4_000),
      ...pair("case-4", 0, 3_000, 4_500),
    ],
    ...overrides,
  };
}

describe("prediction calibration", () => {
  it("compares paired chronological predictions with exact basis-point scores", () => {
    const result = evaluatePredictionCalibration(input());
    expect(result).toMatchObject({
      pairedCaseCount: 4,
      realHistoricalCaseCount: 4,
      syntheticCaseCount: 0,
      liftStatus: "candidate_better",
      evidenceStatus: "real_holdout_sufficient",
      gateCDecision: "requires_gate_review",
      gateCSelfAcceptanceAllowed: false,
    });
    expect(result.candidate.brierScoreBasisPoints).toBeLessThan(
      result.baseline.brierScoreBasisPoints,
    );
    expect(result.candidateBrierImprovementBasisPoints).toBeGreaterThan(0);
  });

  it("reports calibration bins with explicit predicted and observed rates", () => {
    const result = evaluatePredictionCalibration(input());
    expect(result.candidate.bins).toEqual(
      expect.arrayContaining([
        expect.objectContaining({
          caseCount: 2,
          meanPredictedBasisPoints: 2_500,
          observedRateBasisPoints: 0,
        }),
        expect.objectContaining({
          caseCount: 1,
          meanPredictedBasisPoints: 7_000,
          observedRateBasisPoints: 10_000,
        }),
      ]),
    );
  });

  it("keeps synthetic evidence from establishing analytical sufficiency", () => {
    const result = evaluatePredictionCalibration(
      input({
        predictions: [
          ...pair("case-1", 1, 8_000, 6_000, "synthetic_fixture"),
          ...pair("case-2", 0, 2_000, 4_000, "synthetic_fixture"),
        ],
      }),
    );
    expect(result.evidenceStatus).toBe("synthetic_only");
    expect(result.warnings).toContain(
      "Synthetic cases verify arithmetic only and cannot establish analytical performance.",
    );
  });

  it("requires candidate and baseline evidence for identical cases", () => {
    expect(() =>
      evaluatePredictionCalibration(
        input({
          predictions: [
            ...pair("case-1", 1, 8_000, 6_000),
            {
              ...pair("case-2", 0, 2_000, 4_000)[0]!,
            },
          ],
        }),
      ),
    ).toThrow("identical holdout cases");
  });

  it("requires matching outcomes and evidence sources within each pair", () => {
    const predictions = pair("case-1", 1, 8_000, 6_000);
    expect(() =>
      evaluatePredictionCalibration(
        input({
          predictions: [predictions[0]!, { ...predictions[1]!, outcome: 0 }],
        }),
      ),
    ).toThrow("outcomes and evidence source must match");
  });

  it("rejects leakage, invalid probabilities and duplicate model rows", () => {
    const validPair = pair("case-1", 1, 8_000, 6_000);
    expect(() =>
      evaluatePredictionCalibration(
        input({
          predictions: [
            {
              ...validPair[0]!,
              predictedAt: "2026-06-03T00:00:00Z",
            },
            validPair[1]!,
          ],
        }),
      ),
    ).toThrow("Prediction must predate its outcome");
    expect(() =>
      evaluatePredictionCalibration(
        input({
          predictions: [
            { ...validPair[0]!, predictedProbabilityBasisPoints: 10_001 },
            validPair[1]!,
          ],
        }),
      ),
    ).toThrow("cannot exceed");
    expect(() =>
      evaluatePredictionCalibration(
        input({
          predictions: [validPair[0]!, validPair[0]!, validPair[1]!],
        }),
      ),
    ).toThrow("one prediction per model role");
  });
});
