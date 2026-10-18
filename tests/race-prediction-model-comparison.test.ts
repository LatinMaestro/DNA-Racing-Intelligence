import { describe, expect, it } from "vitest";

import type {
  HistoricalEvaluationPartition,
  HistoricalPredictionEvaluationInput,
} from "../domain/race-prediction-historical-evaluation";
import { compareHistoricalPredictionModels } from "../domain/race-prediction-model-comparison";
import { applyRacePredictionReconciliation } from "../domain/race-prediction-reconciliation";
import { freezeRacePredictionSnapshot } from "../domain/race-prediction-snapshot";

function evaluation({
  modelVersion,
  probabilities,
  includeSecondPrediction = true,
  holdoutEventId = "holdout-1",
  holdoutWinnerIndex = 0,
  evaluationKind = "point_in_time",
}: {
  modelVersion: string;
  probabilities: readonly [number, number];
  includeSecondPrediction?: boolean;
  holdoutEventId?: string;
  holdoutWinnerIndex?: 0 | 1;
  evaluationKind?: HistoricalPredictionEvaluationInput["evaluationKind"];
}): HistoricalPredictionEvaluationInput {
  const cases: readonly {
    eventId: string;
    eventStartsAt: string;
    partition: HistoricalEvaluationPartition;
  }[] = [
    {
      eventId: "training-1",
      eventStartsAt: "2026-01-01T00:00:00Z",
      partition: "training",
    },
    {
      eventId: "calibration-1",
      eventStartsAt: "2026-02-01T00:00:00Z",
      partition: "calibration",
    },
    {
      eventId: holdoutEventId,
      eventStartsAt: "2026-03-01T00:00:00Z",
      partition: "holdout",
    },
  ];
  return {
    evaluationId: `evaluation-${modelVersion}`,
    modelVersion,
    evaluationKind,
    observations: cases.map(({ eventId, eventStartsAt, partition }) => {
      const startsAt = Date.parse(eventStartsAt);
      const enteredCoreIds = [`${eventId}-core-1`, `${eventId}-core-2`];
      const predictions = probabilities
        .map((probabilityMillionths, index) => ({
          coreId: enteredCoreIds[index]!,
          target: "win" as const,
          status: "available" as const,
          probabilityMillionths,
          evidenceStatus: "complete" as const,
          calculationId: `${modelVersion}-${eventId}-${index + 1}`,
        }))
        .slice(0, includeSecondPrediction ? 2 : 1);
      const snapshot = freezeRacePredictionSnapshot({
        snapshotId: `snapshot-${modelVersion}-${eventId}`,
        eventId,
        predictedAt: new Date(startsAt - 60_000).toISOString(),
        eventStartsAt,
        evidenceCutoff: new Date(startsAt - 120_000).toISOString(),
        modelVersion,
        context: {
          mode: "bike",
          distanceMeters: 1_000,
          competition: "normal",
          format: "2-gate",
          gateCount: 2,
          element: { status: "known", value: "Fire" },
        },
        field: {
          fieldVersion: `field-${eventId}`,
          fieldCapturedAt: new Date(startsAt - 180_000).toISOString(),
          enteredCoreIds,
        },
        sources: {
          sessionVersion: "session-v1",
          eligibilityVersion: "eligibility-v1",
          raceImportVersion: "race-import-v1",
          vaultSnapshotVersion: "vault-v1",
          historicalAggregateVersion: "aggregate-v1",
          historyGenerationVersion: "history-generation-v1",
          historySourceIdentitySha256: "a".repeat(64),
          lockVersion: "lock-v1",
        },
        predictions,
      });
      const winnerIndex =
        partition === "holdout" ? holdoutWinnerIndex : (0 as const);
      const reconciliation = applyRacePredictionReconciliation({
        reconciliationId: `reconciliation-${modelVersion}-${eventId}`,
        snapshot,
        acceptedResult: {
          eventId,
          sourceEvidenceId: `evidence-${eventId}`,
          sourceVersion: "race-import-v2",
          acceptedAt: new Date(startsAt + 180_000).toISOString(),
          eventCompletedAt: new Date(startsAt + 120_000).toISOString(),
          outcomeStatus: "complete",
          starDataStatus: "complete",
          entries: [0, 1].map((index) => ({
            coreId: enteredCoreIds[index]!,
            finishPosition: index === winnerIndex ? 1 : 2,
            goldStar: false,
            blueStar: index === winnerIndex,
          })),
        },
        revision: 0,
        correctsSourceEvidenceId: null,
        previous: null,
      }).reconciliation;
      return {
        caseId: `${modelVersion}-${eventId}`,
        eraId: "era-2026-a",
        partition,
        snapshot,
        reconciliation,
      };
    }),
  };
}

function comparisonInput() {
  return {
    comparisonId: "comparison-v1",
    baselineAuthorityReference: "owner-approved-independent-baseline-v1",
    champion: evaluation({
      modelVersion: "champion-v1",
      probabilities: [600_000, 400_000],
    }),
    challenger: evaluation({
      modelVersion: "challenger-v2",
      probabilities: [750_000, 250_000],
    }),
  };
}

describe("historical prediction model comparison", () => {
  it("compares exact-population holdout metrics without making a decision", () => {
    const result = compareHistoricalPredictionModels(comparisonInput());

    expect(result).toMatchObject({
      evaluationPopulationStatus: "exact_match",
      comparisonPartition: "holdout",
      championModelVersion: "champion-v1",
      challengerModelVersion: "challenger-v2",
      brierComparableMetricCount: 1,
      fieldSelectionComparableMetricCount: 1,
      coverageMismatchMetricCount: 0,
      unavailableMetricCount: 0,
      comparisonStatus: "review_only",
      decisionStatus: "method_review_required",
      lastGoodModelVersion: "champion-v1",
      automaticPromotionAllowed: false,
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
    });
    expect(result.metrics).toEqual([
      expect.objectContaining({
        eraId: "era-2026-a",
        target: "win",
        championEventCount: 1,
        challengerEventCount: 1,
        championScoredPredictionCount: 2,
        challengerScoredPredictionCount: 2,
        brierComparisonStatus: "comparable",
        championBrierScoreMillionths: 160_000,
        challengerBrierScoreMillionths: 62_500,
        challengerBrierDeltaMillionths: -97_500,
        brierDirection: "challenger_lower",
        fieldSelectionComparisonStatus: "comparable",
        championFieldSelectionAccuracyMillionths: 1_000_000,
        challengerFieldSelectionAccuracyMillionths: 1_000_000,
        challengerFieldSelectionAccuracyDeltaMillionths: 0,
        fieldSelectionDirection: "equal",
      }),
    ]);
  });

  it("reports a worse challenger without changing the last-good model", () => {
    const input = comparisonInput();
    const result = compareHistoricalPredictionModels({
      ...input,
      challenger: evaluation({
        modelVersion: "challenger-v2",
        probabilities: [250_000, 750_000],
      }),
    });
    expect(result.metrics[0]).toMatchObject({
      challengerBrierDeltaMillionths: 402_500,
      brierDirection: "challenger_higher",
      challengerFieldSelectionAccuracyDeltaMillionths: -1_000_000,
      fieldSelectionDirection: "challenger_lower",
    });
    expect(result.lastGoodModelVersion).toBe("champion-v1");
    expect(result.automaticPromotionAllowed).toBe(false);
  });

  it("refuses metric comparison when scored coverage differs", () => {
    const input = comparisonInput();
    const result = compareHistoricalPredictionModels({
      ...input,
      challenger: evaluation({
        modelVersion: "challenger-v2",
        probabilities: [750_000, 250_000],
        includeSecondPrediction: false,
      }),
    });
    expect(result.metrics[0]).toMatchObject({
      championScoredPredictionCount: 2,
      challengerScoredPredictionCount: 1,
      brierComparisonStatus: "coverage_mismatch",
      challengerBrierDeltaMillionths: null,
      brierDirection: null,
      fieldSelectionComparisonStatus: "coverage_mismatch",
      challengerFieldSelectionAccuracyDeltaMillionths: null,
      fieldSelectionDirection: null,
    });
    expect(result.coverageMismatchMetricCount).toBe(1);
  });

  it("rejects a different event population", () => {
    const input = comparisonInput();
    expect(() =>
      compareHistoricalPredictionModels({
        ...input,
        challenger: evaluation({
          modelVersion: "challenger-v2",
          probabilities: [750_000, 250_000],
          holdoutEventId: "different-holdout",
        }),
      }),
    ).toThrow("exact same frozen event population and accepted outcomes");
  });

  it("rejects mismatched accepted outcomes", () => {
    const input = comparisonInput();
    expect(() =>
      compareHistoricalPredictionModels({
        ...input,
        challenger: evaluation({
          modelVersion: "challenger-v2",
          probabilities: [750_000, 250_000],
          holdoutWinnerIndex: 1,
        }),
      }),
    ).toThrow("exact same frozen event population and accepted outcomes");
  });

  it("rejects retrospective evidence and same-version comparisons", () => {
    const input = comparisonInput();
    expect(() =>
      compareHistoricalPredictionModels({
        ...input,
        challenger: evaluation({
          modelVersion: "challenger-v2",
          probabilities: [750_000, 250_000],
          evaluationKind: "retrospective_what_if",
        }),
      }),
    ).toThrow("requires point-in-time evaluation evidence");
    expect(() =>
      compareHistoricalPredictionModels({
        ...input,
        challenger: evaluation({
          modelVersion: "champion-v1",
          probabilities: [750_000, 250_000],
        }),
      }),
    ).toThrow("model versions must differ");
  });

  it("requires an explicit baseline authority reference", () => {
    expect(() =>
      compareHistoricalPredictionModels({
        ...comparisonInput(),
        baselineAuthorityReference: " ",
      }),
    ).toThrow("Baseline authority reference is required.");
  });
});
