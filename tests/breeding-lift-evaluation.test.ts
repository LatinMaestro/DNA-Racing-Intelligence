import { describe, expect, it } from "vitest";

import {
  evaluateBreedingPredictiveLift,
  type BreedingLiftEvaluationInput,
  type BreedingLiftPrediction,
} from "../domain/breeding-lift-evaluation";

function prediction(
  sequence: number,
  overrides: Partial<BreedingLiftPrediction> = {},
): BreedingLiftPrediction {
  return {
    predictionId: `prediction-${sequence}`,
    breedingId: `breeding-${sequence}`,
    outcomeId: `outcome-${sequence}`,
    breedingAt: `2026-07-${String(10 + sequence).padStart(2, "0")}T00:00:00Z`,
    predictionCreatedAt: `2026-07-${String(10 + sequence).padStart(2, "0")}T00:00:00Z`,
    featureCutoff: "2026-07-01T00:00:00Z",
    outcomeAt: `2026-08-${String(sequence).padStart(2, "0")}T00:00:00Z`,
    mode: "Car",
    exactDistanceM: 1000,
    exceptionalOutcome: sequence === 1,
    timeOnlyProbabilityBasisPoints: sequence === 1 ? 3000 : 2000,
    lineageProbabilityBasisPoints: sequence === 1 ? 4000 : 1500,
    timeAndStarProbabilityBasisPoints: sequence === 1 ? 8000 : 500,
    starFeatureStatus: "complete",
    ...overrides,
  };
}

function input(
  overrides: Partial<BreedingLiftEvaluationInput> = {},
): BreedingLiftEvaluationInput {
  return {
    holdoutStartsAt: "2026-07-10T00:00:00Z",
    minimumHoldoutRowsPerCell: 2,
    minimumBrierImprovementMillionths: 1,
    predictions: [prediction(1), prediction(2)],
    ...overrides,
  };
}

describe("breeding predictive lift evaluation", () => {
  it("compares all models on identical chronological holdout rows", () => {
    const result = evaluateBreedingPredictiveLift(input());
    expect(result.includedHoldoutRows).toBe(2);
    expect(result.cells[0]?.candidateLiftStatus).toBe("supported");
    expect(result.cells[0]?.timeAndStar.brierScoreMillionths).toBeLessThan(
      result.cells[0]!.timeOnly.brierScoreMillionths,
    );
    expect(result.allModelsEvaluatedOnIdenticalRows).toBe(true);
    expect(result.gateEReviewCandidate).toBe(true);
    expect(result.predictiveLiftEstablished).toBe(false);
    expect(result.gateEPassed).toBe(false);
    expect(result.recommendationAllowed).toBe(false);
  });

  it("reports calibration using exact observed and predicted rates", () => {
    const result = evaluateBreedingPredictiveLift(input());
    expect(result.cells[0]?.timeAndStar).toEqual(
      expect.objectContaining({
        meanPredictedRateBasisPoints: 4250,
        observedRateBasisPoints: 5000,
        calibrationErrorBasisPoints: 750,
      }),
    );
  });

  it("marks a cell insufficient below the configured sample", () => {
    const result = evaluateBreedingPredictiveLift(
      input({ minimumHoldoutRowsPerCell: 3 }),
    );
    expect(result.cells[0]?.candidateLiftStatus).toBe("insufficient_sample");
    expect(result.gateEReviewCandidate).toBe(false);
  });

  it("does not support star features that fail either baseline", () => {
    const result = evaluateBreedingPredictiveLift(
      input({
        predictions: [
          prediction(1, { timeAndStarProbabilityBasisPoints: 3000 }),
          prediction(2, { timeAndStarProbabilityBasisPoints: 2000 }),
        ],
      }),
    );
    expect(result.cells[0]?.brierImprovementVsTimeOnlyMillionths).toBe(0);
    expect(result.cells[0]?.candidateLiftStatus).toBe("not_supported");
  });

  it("excludes training rows and incomplete star features", () => {
    const result = evaluateBreedingPredictiveLift(
      input({
        minimumHoldoutRowsPerCell: 1,
        predictions: [
          prediction(1, {
            breedingAt: "2026-07-09T00:00:00Z",
            predictionCreatedAt: "2026-07-09T00:00:00Z",
          }),
          prediction(2, { starFeatureStatus: "partial" }),
          prediction(3),
        ],
      }),
    );
    expect(result.includedHoldoutRows).toBe(1);
    expect(result.excludedRows).toEqual([
      {
        predictionId: "prediction-1",
        reasons: ["TRAINING_PARTITION"],
      },
      {
        predictionId: "prediction-2",
        reasons: ["STAR_FEATURES_INCOMPLETE"],
      },
    ]);
  });

  it("keeps mode and exact distance cells separate", () => {
    const result = evaluateBreedingPredictiveLift(
      input({
        minimumHoldoutRowsPerCell: 1,
        predictions: [
          prediction(1),
          prediction(2, { exactDistanceM: 1200 }),
          prediction(3, { mode: "Bike" }),
        ],
      }),
    );
    expect(
      result.cells.map(({ mode, exactDistanceM }) => [mode, exactDistanceM]),
    ).toEqual([
      ["Bike", 1000],
      ["Car", 1000],
      ["Car", 1200],
    ]);
  });

  it("rejects feature leakage at or after breeding", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [
            prediction(1, { featureCutoff: "2026-07-11T00:00:00Z" }),
          ],
        }),
      ),
    ).toThrow("Feature cutoff must predate breeding");
  });

  it("rejects retrospective predictions created after breeding", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [
            prediction(1, {
              predictionCreatedAt: "2026-07-12T00:00:00Z",
            }),
          ],
        }),
      ),
    ).toThrow("no later than breeding");
  });

  it("rejects predictions created before their feature evidence", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [
            prediction(1, {
              predictionCreatedAt: "2026-06-30T00:00:00Z",
            }),
          ],
        }),
      ),
    ).toThrow("cannot predate its feature cutoff");
  });

  it("rejects outcomes that do not follow breeding", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [prediction(1, { outcomeAt: "2026-07-11T00:00:00Z" })],
        }),
      ),
    ).toThrow("must follow breeding");
  });

  it("rejects duplicate authoritative outcomes", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [
            prediction(1),
            prediction(2, { outcomeId: "outcome-1" }),
          ],
        }),
      ),
    ).toThrow("outcome IDs must be unique");
  });

  it("rejects probabilities outside exact basis-point bounds", () => {
    expect(() =>
      evaluateBreedingPredictiveLift(
        input({
          predictions: [
            prediction(1, { timeAndStarProbabilityBasisPoints: 10_001 }),
          ],
        }),
      ),
    ).toThrow("0 to 10000");
  });
});
