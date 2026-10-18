import { describe, expect, it, vi } from "vitest";
import type { HistoricalEvaluationPartition } from "@/domain/race-prediction-historical-evaluation";
import {
  applyRacePredictionReconciliation,
  type RacePredictionReconciliation,
} from "@/domain/race-prediction-reconciliation";
import {
  freezeRacePredictionSnapshot,
  type FrozenRacePredictionSnapshot,
} from "@/domain/race-prediction-snapshot";
import {
  bindPersistedHistoricalRacePredictionEvaluation,
  evaluatePersistedHistoricalRacePredictions,
  type PersistedHistoricalEvaluationCase,
} from "@/lib/race-prediction-historical-evaluation-service";

const MODEL_VERSION = "independent-v1";

function evidence(
  eventId: string,
  eventStartsAt: string,
): Readonly<{
  snapshot: FrozenRacePredictionSnapshot;
  reconciliation: RacePredictionReconciliation;
}> {
  const start = Date.parse(eventStartsAt);
  const snapshot = freezeRacePredictionSnapshot({
    snapshotId: `snapshot-${eventId}`,
    eventId,
    predictedAt: new Date(start - 60_000).toISOString(),
    eventStartsAt,
    evidenceCutoff: new Date(start - 120_000).toISOString(),
    modelVersion: MODEL_VERSION,
    context: {
      mode: "car",
      distanceMeters: 1_200,
      competition: "normal",
      format: "2-gate",
      gateCount: 2,
      element: { status: "known", value: "Water" },
    },
    field: {
      fieldVersion: `field-${eventId}`,
      fieldCapturedAt: new Date(start - 180_000).toISOString(),
      enteredCoreIds: [`${eventId}-1`, `${eventId}-2`],
    },
    sources: {
      sessionVersion: `session-${eventId}`,
      eligibilityVersion: `eligibility-${eventId}`,
      raceImportVersion: "race-v1",
      vaultSnapshotVersion: "vault-v1",
      historicalAggregateVersion: "aggregate-v1",
      historyGenerationVersion: "history-v1",
      historySourceIdentitySha256: "a".repeat(64),
      lockVersion: `lock-${eventId}`,
    },
    predictions: [750_000, 250_000].map((probabilityMillionths, index) => ({
      coreId: `${eventId}-${index + 1}`,
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
      sourceVersion: "race-v2",
      acceptedAt: new Date(start + 180_000).toISOString(),
      eventCompletedAt: new Date(start + 120_000).toISOString(),
      outcomeStatus: "complete",
      starDataStatus: "complete",
      entries: [0, 1].map((index) => ({
        coreId: `${eventId}-${index + 1}`,
        finishPosition: index + 1,
        goldStar: false,
        blueStar: index === 0,
      })),
    },
    revision: 0,
    correctsSourceEvidenceId: null,
    previous: null,
  }).reconciliation;
  return { snapshot, reconciliation };
}

function fixture() {
  const rows = [
    ["training", "2026-01-01T00:00:00.000Z"],
    ["calibration", "2026-02-01T00:00:00.000Z"],
    ["holdout", "2026-03-01T00:00:00.000Z"],
  ].map(([partition, startsAt]) => ({
    partition: partition as HistoricalEvaluationPartition,
    ...evidence(partition!, startsAt!),
  }));
  const cases: PersistedHistoricalEvaluationCase[] = rows.map(
    ({ partition, snapshot, reconciliation }) => ({
      caseId: `case-${partition}`,
      eraId: "era-2026-a",
      partition,
      snapshotId: snapshot.snapshotId,
      reconciliationId: reconciliation.reconciliationId,
      reconciliationRevision: reconciliation.revision,
    }),
  );
  return { rows, cases };
}

function repository(
  snapshots: readonly FrozenRacePredictionSnapshot[],
  reconciliations: readonly RacePredictionReconciliation[],
) {
  return {
    listSnapshotsByOwner: vi.fn(async () => snapshots),
    listReconciliationsByOwner: vi.fn(async () => reconciliations),
  };
}

describe("persisted historical race prediction evaluation", () => {
  it("joins explicit immutable evidence pins into point-in-time evaluation", async () => {
    const { rows, cases } = fixture();
    const source = repository(
      rows.map(({ snapshot }) => snapshot),
      rows.map(({ reconciliation }) => reconciliation),
    );
    const result = await evaluatePersistedHistoricalRacePredictions(source, {
      ownerId: "user-owner",
      evaluationId: "evaluation-v1",
      modelVersion: MODEL_VERSION,
      cases,
    });
    expect(result).toMatchObject({
      evaluationKind: "point_in_time",
      chronologyStatus: "valid",
      evaluationStatus: "review_only",
      modelPromotionAllowed: false,
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
      partitionCoverage: {
        training: { eventCount: 1, scoredPredictionCount: 2 },
        calibration: { eventCount: 1, scoredPredictionCount: 2 },
        holdout: { eventCount: 1, scoredPredictionCount: 2 },
      },
    });
    expect(source.listSnapshotsByOwner).toHaveBeenCalledWith("user-owner");
    expect(source.listReconciliationsByOwner).toHaveBeenCalledWith(
      "user-owner",
    );
  });

  it("refuses a superseded reconciliation revision", async () => {
    const { rows, cases } = fixture();
    const holdout = rows.find(({ partition }) => partition === "holdout")!;
    const corrected = applyRacePredictionReconciliation({
      reconciliationId: holdout.reconciliation.reconciliationId,
      snapshot: holdout.snapshot,
      acceptedResult: {
        eventId: holdout.snapshot.eventId,
        sourceEvidenceId: "evidence-holdout-v2",
        sourceVersion: "race-v3",
        acceptedAt: "2026-03-01T01:00:00.000Z",
        eventCompletedAt: "2026-03-01T00:02:00.000Z",
        outcomeStatus: "complete",
        starDataStatus: "complete",
        entries: [0, 1].map((index) => ({
          coreId: `holdout-${index + 1}`,
          finishPosition: index === 0 ? 2 : 1,
          goldStar: false,
          blueStar: index === 1,
        })),
      },
      revision: 1,
      correctsSourceEvidenceId: holdout.reconciliation.sourceEvidenceId,
      previous: holdout.reconciliation,
    }).reconciliation;
    await expect(
      evaluatePersistedHistoricalRacePredictions(
        repository(
          rows.map(({ snapshot }) => snapshot),
          [...rows.map(({ reconciliation }) => reconciliation), corrected],
        ),
        {
          ownerId: "user-owner",
          evaluationId: "evaluation-stale",
          modelVersion: MODEL_VERSION,
          cases,
        },
      ),
    ).rejects.toThrow("latest accepted reconciliation revision");
  });

  it("fails closed for missing or mismatched evidence pins", async () => {
    const { rows, cases } = fixture();
    const source = repository(
      rows.map(({ snapshot }) => snapshot),
      rows.map(({ reconciliation }) => reconciliation),
    );
    await expect(
      evaluatePersistedHistoricalRacePredictions(source, {
        ownerId: "user-owner",
        evaluationId: "evaluation-missing",
        modelVersion: MODEL_VERSION,
        cases: [{ ...cases[2]!, snapshotId: "missing-snapshot" }],
      }),
    ).rejects.toThrow("snapshot is unavailable");
    await expect(
      evaluatePersistedHistoricalRacePredictions(source, {
        ownerId: "user-owner",
        evaluationId: "evaluation-mismatch",
        modelVersion: MODEL_VERSION,
        cases: [
          cases[0]!,
          cases[1]!,
          {
            ...cases[2]!,
            reconciliationId: cases[1]!.reconciliationId,
          },
        ],
      }),
    ).rejects.toThrow("does not match its snapshot");
  });

  it("rejects duplicate planned snapshots before evaluation", async () => {
    const { rows, cases } = fixture();
    await expect(
      evaluatePersistedHistoricalRacePredictions(
        repository(
          rows.map(({ snapshot }) => snapshot),
          rows.map(({ reconciliation }) => reconciliation),
        ),
        {
          ownerId: "user-owner",
          evaluationId: "evaluation-duplicate",
          modelVersion: MODEL_VERSION,
          cases: [cases[0]!, { ...cases[0]!, caseId: "case-copy" }],
        },
      ),
    ).rejects.toThrow("snapshot may be evaluated only once");
  });

  it("fails closed for ambiguous persisted reconciliation revisions", async () => {
    const { rows, cases } = fixture();
    const duplicate = {
      ...rows[0]!.reconciliation,
      reconciliationId: "another-reconciliation-id",
    };
    await expect(
      evaluatePersistedHistoricalRacePredictions(
        repository(
          rows.map(({ snapshot }) => snapshot),
          [...rows.map(({ reconciliation }) => reconciliation), duplicate],
        ),
        {
          ownerId: "user-owner",
          evaluationId: "evaluation-ambiguous",
          modelVersion: MODEL_VERSION,
          cases,
        },
      ),
    ).rejects.toThrow("snapshot reconciliation revision");
  });

  it("rejects evidence loaded for another owner", () => {
    const { rows, cases } = fixture();
    expect(() =>
      bindPersistedHistoricalRacePredictionEvaluation(
        {
          ownerId: "user-other",
          snapshots: rows.map(({ snapshot }) => snapshot),
          reconciliations: rows.map(({ reconciliation }) => reconciliation),
        },
        {
          ownerId: "user-owner",
          evaluationId: "evaluation-owner-mismatch",
          modelVersion: MODEL_VERSION,
          cases,
        },
      ),
    ).toThrow("owner does not match");
  });
});
