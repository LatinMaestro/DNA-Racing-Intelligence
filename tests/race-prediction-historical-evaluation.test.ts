import { describe, expect, it } from "vitest";

import {
  evaluateHistoricalRacePredictions,
  type HistoricalEvaluationPartition,
  type HistoricalPredictionObservation,
} from "../domain/race-prediction-historical-evaluation";
import { applyRacePredictionReconciliation } from "../domain/race-prediction-reconciliation";
import { freezeRacePredictionSnapshot } from "../domain/race-prediction-snapshot";

const MODEL_VERSION = "independent-v1";

function observation({
  eventId,
  eventStartsAt,
  partition,
  probabilities = [750_000, 250_000],
  winnerIndex = 0,
  distanceMeters = 1_000,
  partialOutcome = false,
}: {
  eventId: string;
  eventStartsAt: string;
  partition: HistoricalEvaluationPartition;
  probabilities?: readonly [number, number];
  winnerIndex?: 0 | 1;
  distanceMeters?: number;
  partialOutcome?: boolean;
}): HistoricalPredictionObservation {
  const startsAt = Date.parse(eventStartsAt);
  const predictedAt = new Date(startsAt - 60_000).toISOString();
  const snapshot = freezeRacePredictionSnapshot({
    snapshotId: `snapshot-${eventId}`,
    eventId,
    predictedAt,
    eventStartsAt,
    evidenceCutoff: new Date(startsAt - 120_000).toISOString(),
    modelVersion: MODEL_VERSION,
    context: {
      mode: "bike",
      distanceMeters,
      competition: "normal",
      format: "2-gate",
      gateCount: 2,
      element: { status: "known", value: "Fire" },
    },
    field: {
      fieldVersion: `field-${eventId}`,
      fieldCapturedAt: new Date(startsAt - 180_000).toISOString(),
      enteredCoreIds: [`${eventId}-core-1`, `${eventId}-core-2`],
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
    predictions: probabilities.map((probabilityMillionths, index) => ({
      coreId: `${eventId}-core-${index + 1}`,
      target: "win" as const,
      status: "available" as const,
      probabilityMillionths,
      evidenceStatus: "complete" as const,
      calculationId: `calculation-${eventId}-${index + 1}`,
    })),
  });
  const reconciliation = applyRacePredictionReconciliation({
    reconciliationId: `reconciliation-${eventId}`,
    snapshot,
    acceptedResult: {
      eventId,
      sourceEvidenceId: `evidence-${eventId}`,
      sourceVersion: "race-import-v2",
      acceptedAt: new Date(startsAt + 180_000).toISOString(),
      eventCompletedAt: new Date(startsAt + 120_000).toISOString(),
      outcomeStatus: partialOutcome ? "partial" : "complete",
      starDataStatus: "complete",
      entries: [0, 1].map((index) => ({
        coreId: `${eventId}-core-${index + 1}`,
        finishPosition: partialOutcome
          ? index === winnerIndex
            ? 1
            : null
          : index === winnerIndex
            ? 1
            : 2,
        goldStar: false,
        blueStar: index === winnerIndex,
      })),
    },
    revision: 0,
    correctsSourceEvidenceId: null,
    previous: null,
  }).reconciliation;

  return {
    caseId: `case-${eventId}`,
    eraId: "era-2026-a",
    partition,
    snapshot,
    reconciliation,
  };
}

function observations(): readonly HistoricalPredictionObservation[] {
  return [
    observation({
      eventId: "training-1",
      eventStartsAt: "2026-01-01T00:00:00Z",
      partition: "training",
    }),
    observation({
      eventId: "calibration-1",
      eventStartsAt: "2026-02-01T00:00:00Z",
      partition: "calibration",
    }),
    observation({
      eventId: "holdout-1",
      eventStartsAt: "2026-03-01T00:00:00Z",
      partition: "holdout",
    }),
  ];
}

describe("historical race prediction evaluation", () => {
  it("reports exact-context Brier and complete-field selection metrics", () => {
    const result = evaluateHistoricalRacePredictions({
      evaluationId: "evaluation-v1",
      modelVersion: MODEL_VERSION,
      evaluationKind: "point_in_time",
      observations: observations(),
    });

    expect(result).toMatchObject({
      chronologyStatus: "valid",
      evaluationStatus: "review_only",
      modelPromotionAllowed: false,
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
      partitionCoverage: {
        training: {
          eventCount: 1,
          scoredPredictionCount: 2,
          unscoredPredictionCount: 0,
        },
        calibration: {
          eventCount: 1,
          scoredPredictionCount: 2,
          unscoredPredictionCount: 0,
        },
        holdout: {
          eventCount: 1,
          scoredPredictionCount: 2,
          unscoredPredictionCount: 0,
        },
      },
    });
    expect(result.exactContextMetrics).toHaveLength(3);
    expect(
      result.exactContextMetrics.find(
        ({ partition }) => partition === "holdout",
      ),
    ).toMatchObject({
      eraId: "era-2026-a",
      target: "win",
      mode: "bike",
      distanceMeters: 1_000,
      competition: "normal",
      format: "2-gate",
      gateCount: 2,
      element: "known:Fire",
      eventCount: 1,
      scoredPredictionCount: 2,
      unscoredPredictionCount: 0,
      positiveOutcomeCount: 1,
      observedPositiveRateMillionths: 500_000,
      brierScoreMillionths: 62_500,
      completeFieldSelectionCount: 1,
      correctFieldSelectionCount: 1,
      fieldSelectionAccuracyMillionths: 1_000_000,
      fieldSelectionTieCount: 0,
      uncertaintyStatus: "sample_counts_only",
      calibrationStatus: "brier_only",
    });
  });

  it("does not count a tied leader as an eligible field selection", () => {
    const cases = observations().map((candidate) =>
      candidate.partition === "holdout"
        ? observation({
            eventId: "holdout-tie",
            eventStartsAt: "2026-03-01T00:00:00Z",
            partition: "holdout",
            probabilities: [500_000, 500_000],
          })
        : candidate,
    );
    const result = evaluateHistoricalRacePredictions({
      evaluationId: "evaluation-tie",
      modelVersion: MODEL_VERSION,
      evaluationKind: "point_in_time",
      observations: cases,
    });
    const holdout = result.exactContextMetrics.find(
      ({ partition }) => partition === "holdout",
    );
    expect(holdout).toMatchObject({
      completeFieldSelectionCount: 0,
      correctFieldSelectionCount: 0,
      fieldSelectionAccuracyMillionths: null,
      fieldSelectionTieCount: 1,
    });
  });

  it("keeps exact distances in separate metric groups", () => {
    const cases = [
      ...observations(),
      observation({
        eventId: "holdout-2",
        eventStartsAt: "2026-03-02T00:00:00Z",
        partition: "holdout",
        distanceMeters: 1_200,
      }),
    ];
    const result = evaluateHistoricalRacePredictions({
      evaluationId: "evaluation-contexts",
      modelVersion: MODEL_VERSION,
      evaluationKind: "point_in_time",
      observations: cases,
    });
    const holdoutDistances = result.exactContextMetrics
      .filter(({ partition }) => partition === "holdout")
      .map(({ distanceMeters }) => distanceMeters);
    expect(holdoutDistances).toEqual([1_000, 1_200]);
  });

  it("requires strict chronological training, calibration and holdout partitions", () => {
    const cases = observations().map((candidate) =>
      candidate.partition === "calibration"
        ? observation({
            eventId: "calibration-too-early",
            eventStartsAt: "2025-12-01T00:00:00Z",
            partition: "calibration",
          })
        : candidate,
    );
    expect(() =>
      evaluateHistoricalRacePredictions({
        evaluationId: "evaluation-invalid-chronology",
        modelVersion: MODEL_VERSION,
        evaluationKind: "point_in_time",
        observations: cases,
      }),
    ).toThrow(
      "Training, calibration and holdout evidence must be strictly chronological.",
    );
  });

  it("rejects review-required accepted evidence", () => {
    const cases = observations().map((candidate) =>
      candidate.partition === "holdout"
        ? observation({
            eventId: "holdout-partial",
            eventStartsAt: "2026-03-01T00:00:00Z",
            partition: "holdout",
            partialOutcome: true,
          })
        : candidate,
    );
    expect(() =>
      evaluateHistoricalRacePredictions({
        evaluationId: "evaluation-partial",
        modelVersion: MODEL_VERSION,
        evaluationKind: "point_in_time",
        observations: cases,
      }),
    ).toThrow("Only accepted reconciled evidence may be evaluated.");
  });

  it("rejects duplicate events and a mismatched model version", () => {
    const cases = observations();
    expect(() =>
      evaluateHistoricalRacePredictions({
        evaluationId: "evaluation-duplicate",
        modelVersion: MODEL_VERSION,
        evaluationKind: "point_in_time",
        observations: [
          ...cases,
          { ...cases[2]!, caseId: "duplicate-event-case" },
        ],
      }),
    ).toThrow("Each event may appear only once in an evaluation.");

    expect(() =>
      evaluateHistoricalRacePredictions({
        evaluationId: "evaluation-wrong-model",
        modelVersion: "challenger-v2",
        evaluationKind: "point_in_time",
        observations: cases,
      }),
    ).toThrow("Every snapshot must bind the evaluated model version.");
  });

  it("labels retrospective analysis without enabling promotion or mutation", () => {
    const result = evaluateHistoricalRacePredictions({
      evaluationId: "evaluation-retrospective",
      modelVersion: MODEL_VERSION,
      evaluationKind: "retrospective_what_if",
      observations: observations(),
    });
    expect(result).toMatchObject({
      evaluationKind: "retrospective_what_if",
      evaluationStatus: "review_only",
      modelPromotionAllowed: false,
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
    });
  });
});
