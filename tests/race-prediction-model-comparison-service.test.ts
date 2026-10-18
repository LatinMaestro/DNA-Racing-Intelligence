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
import type { PersistedHistoricalEvaluationCase } from "@/lib/race-prediction-historical-evaluation-service";
import { comparePersistedHistoricalPredictionModels } from "@/lib/race-prediction-model-comparison-service";

type EvidenceRow = Readonly<{
  partition: HistoricalEvaluationPartition;
  snapshot: FrozenRacePredictionSnapshot;
  reconciliation: RacePredictionReconciliation;
}>;

const events = [
  ["training", "2026-01-01T00:00:00.000Z"],
  ["calibration", "2026-02-01T00:00:00.000Z"],
  ["holdout", "2026-03-01T00:00:00.000Z"],
] as const;

function modelEvidence(
  modelVersion: string,
  probabilities: readonly [number, number],
  sourceVersion = "race-v2",
): Readonly<{
  rows: readonly EvidenceRow[];
  cases: readonly PersistedHistoricalEvaluationCase[];
}> {
  const rows = events.map(([partition, eventStartsAt]): EvidenceRow => {
    const eventId = `event-${partition}`;
    const start = Date.parse(eventStartsAt);
    const snapshot = freezeRacePredictionSnapshot({
      snapshotId: `snapshot-${modelVersion}-${eventId}`,
      eventId,
      predictedAt: new Date(start - 60_000).toISOString(),
      eventStartsAt,
      evidenceCutoff: new Date(start - 120_000).toISOString(),
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
      predictions: probabilities.map((probabilityMillionths, index) => ({
        coreId: `${eventId}-${index + 1}`,
        target: "win" as const,
        status: "available" as const,
        probabilityMillionths,
        evidenceStatus: "complete" as const,
        calculationId: `${modelVersion}-${eventId}-${index + 1}`,
      })),
    });
    const reconciliation = applyRacePredictionReconciliation({
      reconciliationId: `reconciliation-${modelVersion}-${eventId}`,
      snapshot,
      acceptedResult: {
        eventId,
        sourceEvidenceId: `evidence-${eventId}`,
        sourceVersion,
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
    return { partition, snapshot, reconciliation };
  });
  return {
    rows,
    cases: rows.map(({ partition, snapshot, reconciliation }) => ({
      caseId: `${modelVersion}-${partition}`,
      eraId: "era-2026-a",
      partition,
      snapshotId: snapshot.snapshotId,
      reconciliationId: reconciliation.reconciliationId,
      reconciliationRevision: reconciliation.revision,
    })),
  };
}

function fixture(challengerSourceVersion = "race-v2") {
  const champion = modelEvidence("champion-v1", [600_000, 400_000]);
  const challenger = modelEvidence(
    "challenger-v2",
    [750_000, 250_000],
    challengerSourceVersion,
  );
  const repository = {
    listSnapshotsByOwner: vi.fn(async () => [
      ...champion.rows.map(({ snapshot }) => snapshot),
      ...challenger.rows.map(({ snapshot }) => snapshot),
    ]),
    listReconciliationsByOwner: vi.fn(async () => [
      ...champion.rows.map(({ reconciliation }) => reconciliation),
      ...challenger.rows.map(({ reconciliation }) => reconciliation),
    ]),
  };
  return { champion, challenger, repository };
}

describe("persisted historical prediction model comparison", () => {
  it("compares pinned champion and challenger evidence without activation", async () => {
    const { champion, challenger, repository } = fixture();
    const result = await comparePersistedHistoricalPredictionModels(
      repository,
      {
        ownerId: "user-owner",
        comparisonId: "comparison-v1",
        baselineAuthorityReference: "owner-approved-independent-baseline-v1",
        champion: {
          evaluationId: "evaluation-champion-v1",
          modelVersion: "champion-v1",
          cases: champion.cases,
        },
        challenger: {
          evaluationId: "evaluation-challenger-v2",
          modelVersion: "challenger-v2",
          cases: challenger.cases,
        },
      },
    );

    expect(result).toMatchObject({
      evaluationPopulationStatus: "exact_match",
      comparisonPartition: "holdout",
      championModelVersion: "champion-v1",
      challengerModelVersion: "challenger-v2",
      comparisonStatus: "review_only",
      decisionStatus: "method_review_required",
      lastGoodModelVersion: "champion-v1",
      automaticPromotionAllowed: false,
      recommendationActivationAllowed: false,
      productionMutationAllowed: false,
    });
    expect(result.metrics[0]).toMatchObject({
      brierComparisonStatus: "comparable",
      brierDirection: "challenger_lower",
      fieldSelectionComparisonStatus: "comparable",
    });
    expect(repository.listSnapshotsByOwner).toHaveBeenCalledOnce();
    expect(repository.listSnapshotsByOwner).toHaveBeenCalledWith("user-owner");
    expect(repository.listReconciliationsByOwner).toHaveBeenCalledOnce();
  });

  it("rejects challenger outcome authority drift", async () => {
    const { champion, challenger, repository } = fixture("race-v3");
    await expect(
      comparePersistedHistoricalPredictionModels(repository, {
        ownerId: "user-owner",
        comparisonId: "comparison-drift",
        baselineAuthorityReference: "owner-approved-independent-baseline-v1",
        champion: {
          evaluationId: "evaluation-champion-v1",
          modelVersion: "champion-v1",
          cases: champion.cases,
        },
        challenger: {
          evaluationId: "evaluation-challenger-v2",
          modelVersion: "challenger-v2",
          cases: challenger.cases,
        },
      }),
    ).rejects.toThrow("exact same frozen event population");
  });

  it("rejects missing owner identity before reading persistence", async () => {
    const { champion, challenger, repository } = fixture();
    await expect(
      comparePersistedHistoricalPredictionModels(repository, {
        ownerId: " ",
        comparisonId: "comparison-missing-owner",
        baselineAuthorityReference: "owner-approved-independent-baseline-v1",
        champion: {
          evaluationId: "evaluation-champion-v1",
          modelVersion: "champion-v1",
          cases: champion.cases,
        },
        challenger: {
          evaluationId: "evaluation-challenger-v2",
          modelVersion: "challenger-v2",
          cases: challenger.cases,
        },
      }),
    ).rejects.toThrow("Owner ID is required");
    expect(repository.listSnapshotsByOwner).not.toHaveBeenCalled();
    expect(repository.listReconciliationsByOwner).not.toHaveBeenCalled();
  });
});
