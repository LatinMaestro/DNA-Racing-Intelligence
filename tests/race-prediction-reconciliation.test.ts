import { describe, expect, it } from "vitest";

import {
  applyRacePredictionReconciliation,
  type AcceptedRacePredictionResult,
  type ApplyRacePredictionReconciliationInput,
} from "../domain/race-prediction-reconciliation";
import { freezeRacePredictionSnapshot } from "../domain/race-prediction-snapshot";

function snapshot(gateCount = 4) {
  const enteredCoreIds = Array.from(
    { length: gateCount },
    (_, index) => `core-${index + 1}`,
  );
  return freezeRacePredictionSnapshot({
    snapshotId: "snapshot-event-1-v1",
    eventId: "event-1",
    predictedAt: "2026-10-17T04:59:00Z",
    eventStartsAt: "2026-10-17T05:00:00Z",
    evidenceCutoff: "2026-10-17T04:58:00Z",
    modelVersion: "independent-v1",
    context: {
      mode: "bike",
      distanceMeters: 1_000,
      competition: "normal",
      format: `${gateCount}-gate`,
      gateCount,
      element: { status: "known", value: "Fire" },
    },
    field: {
      fieldVersion: "field-v1",
      fieldCapturedAt: "2026-10-17T04:57:00Z",
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
    predictions: [
      {
        coreId: "core-1",
        target: "win",
        status: "available",
        probabilityMillionths: 600_000,
        evidenceStatus: "complete",
        calculationId: "win-core-1-v1",
      },
      {
        coreId: "core-1",
        target: "place",
        status: "available",
        probabilityMillionths: 800_000,
        evidenceStatus: "complete",
        calculationId: "place-core-1-v1",
      },
      {
        coreId: "core-1",
        target: "blue_star",
        status: "available",
        probabilityMillionths: 700_000,
        evidenceStatus: "complete",
        calculationId: "blue-core-1-v1",
      },
      {
        coreId: "core-1",
        target: "yellow_star",
        status: gateCount <= 3 ? "not_applicable" : "available",
        probabilityMillionths: gateCount <= 3 ? null : 750_000,
        evidenceStatus: gateCount <= 3 ? "not_applicable" : "complete",
        calculationId: gateCount <= 3 ? null : "yellow-core-1-v1",
      },
      {
        coreId: "core-2",
        target: "win",
        status: "unavailable",
        probabilityMillionths: null,
        evidenceStatus: "insufficient",
        calculationId: null,
      },
    ],
  });
}

function acceptedResult(gateCount = 4): AcceptedRacePredictionResult {
  return {
    eventId: "event-1",
    sourceEvidenceId: "accepted-event-1-v1",
    sourceVersion: "race-import-v2",
    acceptedAt: "2026-10-17T05:03:00Z",
    eventCompletedAt: "2026-10-17T05:02:00Z",
    outcomeStatus: "complete",
    starDataStatus: "complete",
    entries: Array.from({ length: gateCount }, (_, index) => ({
      coreId: `core-${index + 1}`,
      finishPosition: index + 1,
      goldStar: gateCount > 3 ? index === 0 : false,
      blueStar: index === 0,
    })),
  };
}

function input(
  overrides: Partial<ApplyRacePredictionReconciliationInput> = {},
): ApplyRacePredictionReconciliationInput {
  return {
    reconciliationId: "reconciliation-event-1",
    snapshot: snapshot(),
    acceptedResult: acceptedResult(),
    revision: 0,
    correctsSourceEvidenceId: null,
    previous: null,
    ...overrides,
  };
}

describe("race prediction result reconciliation", () => {
  it("scores supported available targets without mutating the frozen prediction", () => {
    const result = applyRacePredictionReconciliation(input());
    expect(result).toMatchObject({
      applicationStatus: "created",
      reconciliation: {
        recordStatus: "reconciled",
        revision: 0,
        frozenPredictionMutated: false,
        historyUpdateAllowed: true,
        correctionHistory: [],
      },
    });
    expect(result.reconciliation.scores).toEqual([
      {
        coreId: "core-1",
        target: "win",
        predictionProbabilityMillionths: 600_000,
        actual: true,
        scoringStatus: "scored",
        reason: "prediction_available",
      },
      {
        coreId: "core-1",
        target: "place",
        predictionProbabilityMillionths: 800_000,
        actual: null,
        scoringStatus: "unscored",
        reason: "target_definition_unresolved",
      },
      {
        coreId: "core-1",
        target: "blue_star",
        predictionProbabilityMillionths: 700_000,
        actual: true,
        scoringStatus: "scored",
        reason: "prediction_available",
      },
      {
        coreId: "core-1",
        target: "yellow_star",
        predictionProbabilityMillionths: 750_000,
        actual: true,
        scoringStatus: "scored",
        reason: "prediction_available",
      },
      {
        coreId: "core-2",
        target: "win",
        predictionProbabilityMillionths: null,
        actual: null,
        scoringStatus: "unscored",
        reason: "prediction_unavailable",
      },
    ]);
  });

  it("is idempotent for an exact accepted-evidence replay", () => {
    const created = applyRacePredictionReconciliation(input()).reconciliation;
    const replay = applyRacePredictionReconciliation(
      input({ previous: created }),
    );
    expect(replay.applicationStatus).toBe("idempotent");
    expect(replay.reconciliation).toBe(created);
  });

  it("retains superseded source provenance for an explicit correction", () => {
    const previous = applyRacePredictionReconciliation(input()).reconciliation;
    const correctedResult = {
      ...acceptedResult(),
      sourceEvidenceId: "accepted-event-1-v2",
      sourceVersion: "race-import-v3",
      acceptedAt: "2026-10-17T06:00:00Z",
      entries: acceptedResult().entries.map((entry) => ({
        ...entry,
        finishPosition:
          entry.coreId === "core-1"
            ? 2
            : entry.coreId === "core-2"
              ? 1
              : entry.finishPosition,
      })),
    };
    const corrected = applyRacePredictionReconciliation(
      input({
        acceptedResult: correctedResult,
        revision: 1,
        correctsSourceEvidenceId: previous.sourceEvidenceId,
        previous,
      }),
    );
    expect(corrected.applicationStatus).toBe("corrected");
    expect(corrected.reconciliation).toMatchObject({
      revision: 1,
      sourceEvidenceId: "accepted-event-1-v2",
      correctionHistory: [
        {
          revision: 0,
          sourceEvidenceId: "accepted-event-1-v1",
          sourceVersion: "race-import-v2",
        },
      ],
    });
    expect(corrected.reconciliation.scores[0]).toMatchObject({
      target: "win",
      actual: false,
      scoringStatus: "scored",
    });

    const replay = applyRacePredictionReconciliation(
      input({
        acceptedResult: correctedResult,
        revision: 1,
        correctsSourceEvidenceId: previous.sourceEvidenceId,
        previous: corrected.reconciliation,
      }),
    );
    expect(replay.applicationStatus).toBe("idempotent");
    expect(replay.reconciliation).toBe(corrected.reconciliation);
  });

  it("rejects conflicting reuse and corrections that skip provenance", () => {
    const previous = applyRacePredictionReconciliation(input()).reconciliation;
    expect(() =>
      applyRacePredictionReconciliation(
        input({
          acceptedResult: {
            ...acceptedResult(),
            entries: acceptedResult().entries.map((entry) => ({
              ...entry,
              blueStar: false,
            })),
          },
          previous,
        }),
      ),
    ).toThrow("reused with conflicting facts");
    expect(() =>
      applyRacePredictionReconciliation(
        input({
          acceptedResult: {
            ...acceptedResult(),
            sourceEvidenceId: "accepted-event-1-v2",
          },
          revision: 1,
          correctsSourceEvidenceId: "not-the-previous-evidence",
          previous,
        }),
      ),
    ).toThrow("extend the exact previous reconciliation");
  });

  it("keeps partial outcomes and star data unscored", () => {
    const partial = applyRacePredictionReconciliation(
      input({
        acceptedResult: {
          ...acceptedResult(),
          outcomeStatus: "partial",
          starDataStatus: "partial",
          entries: acceptedResult()
            .entries.slice(0, 2)
            .map((entry) => ({
              ...entry,
              goldStar: null,
              blueStar: null,
            })),
        },
      }),
    ).reconciliation;
    expect(partial.recordStatus).toBe("review_required");
    expect(partial.historyUpdateAllowed).toBe(false);
    expect(partial.scores.find(({ target }) => target === "win")).toMatchObject(
      {
        scoringStatus: "unscored",
        reason: "outcome_incomplete",
      },
    );
    expect(
      partial.scores.find(({ target }) => target === "blue_star"),
    ).toMatchObject({
      scoringStatus: "unscored",
      reason: "star_data_incomplete",
    });
  });

  it("preserves an ineligible Yellow assignment as an unscored anomaly", () => {
    const threeGateSnapshot = snapshot(3);
    const anomaly = applyRacePredictionReconciliation(
      input({
        snapshot: threeGateSnapshot,
        acceptedResult: {
          ...acceptedResult(3),
          entries: acceptedResult(3).entries.map((entry, index) => ({
            ...entry,
            goldStar: index === 0,
          })),
        },
      }),
    ).reconciliation;
    expect(anomaly.recordStatus).toBe("review_required");
    expect(anomaly.issues).toContain(
      "Accepted Yellow/source-Gold assignment is anomalous at three gates or fewer.",
    );
    expect(
      anomaly.scores.find(({ target }) => target === "yellow_star"),
    ).toMatchObject({
      scoringStatus: "unscored",
      reason: "target_not_applicable",
    });
  });

  it("rejects event, field and chronology mismatches", () => {
    expect(() =>
      applyRacePredictionReconciliation(
        input({ acceptedResult: { ...acceptedResult(), eventId: "event-2" } }),
      ),
    ).toThrow("frozen event identity");
    expect(() =>
      applyRacePredictionReconciliation(
        input({
          acceptedResult: {
            ...acceptedResult(),
            entries: [
              ...acceptedResult().entries,
              {
                coreId: "outside-field",
                finishPosition: 1,
                goldStar: false,
                blueStar: false,
              },
            ],
          },
        }),
      ),
    ).toThrow("must belong to the frozen field");
    expect(() =>
      applyRacePredictionReconciliation(
        input({
          acceptedResult: {
            ...acceptedResult(),
            eventCompletedAt: "2026-10-17T04:58:59Z",
          },
        }),
      ),
    ).toThrow("cannot predate the frozen prediction");
  });
});
