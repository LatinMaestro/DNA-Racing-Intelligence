import {
  evaluateHistoricalRacePredictions,
  type HistoricalEvaluationPartition,
  type HistoricalPredictionEvaluation,
  type HistoricalPredictionEvaluationInput,
} from "@/domain/race-prediction-historical-evaluation";
import type { RacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import type { FrozenRacePredictionSnapshot } from "@/domain/race-prediction-snapshot";
import type { OpenRacePredictionRepository } from "@/lib/neon-open-race-prediction-repository";

export type PersistedHistoricalEvaluationCase = Readonly<{
  caseId: string;
  eraId: string;
  partition: HistoricalEvaluationPartition;
  snapshotId: string;
  reconciliationId: string;
  reconciliationRevision: number;
}>;

export type PersistedHistoricalEvaluationRepository = Pick<
  OpenRacePredictionRepository,
  "listSnapshotsByOwner" | "listReconciliationsByOwner"
>;

export type PersistedHistoricalEvaluationEvidence = Readonly<{
  ownerId: string;
  snapshots: readonly FrozenRacePredictionSnapshot[];
  reconciliations: readonly RacePredictionReconciliation[];
}>;

export type EvaluatePersistedHistoricalPredictionsInput = Readonly<{
  ownerId: string;
  evaluationId: string;
  modelVersion: string;
  cases: readonly PersistedHistoricalEvaluationCase[];
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function uniqueById<T>(
  values: readonly T[],
  identity: (value: T) => string,
  label: string,
): ReadonlyMap<string, T> {
  const byId = new Map<string, T>();
  for (const value of values) {
    const id = identity(value);
    if (byId.has(id)) throw new Error(`${label} identities must be unique.`);
    byId.set(id, value);
  }
  return byId;
}

function reconciliationKey(
  reconciliation: Pick<
    RacePredictionReconciliation,
    "reconciliationId" | "revision"
  >,
): string {
  return `${reconciliation.reconciliationId}\u0000${reconciliation.revision}`;
}

function validatePersistedSnapshot(snapshot: FrozenRacePredictionSnapshot) {
  if (
    snapshot.frozen !== true ||
    snapshot.predictionMutationAllowed !== false ||
    snapshot.sameEventEvidenceIncluded !== false ||
    snapshot.observedOutcomeIncluded !== false ||
    snapshot.fairExOddsIncluded !== false ||
    snapshot.reconciliationStatus !== "pending" ||
    Date.parse(snapshot.evidenceCutoff) > Date.parse(snapshot.predictedAt) ||
    Date.parse(snapshot.predictedAt) >= Date.parse(snapshot.eventStartsAt)
  ) {
    throw new Error(
      "Persisted historical evaluation requires an immutable pre-event snapshot.",
    );
  }
}

export function bindPersistedHistoricalRacePredictionEvaluation(
  evidence: PersistedHistoricalEvaluationEvidence,
  input: EvaluatePersistedHistoricalPredictionsInput,
): HistoricalPredictionEvaluationInput {
  const ownerId = required(input.ownerId, "Owner ID");
  if (required(evidence.ownerId, "Evidence owner ID") !== ownerId) {
    throw new Error("Persisted historical evaluation owner does not match.");
  }
  if (input.cases.length === 0) {
    throw new Error("Persisted historical evaluation cases are required.");
  }

  const snapshotsById = uniqueById(
    evidence.snapshots,
    ({ snapshotId }) => snapshotId,
    "Persisted snapshot",
  );
  const reconciliationsById = uniqueById(
    evidence.reconciliations,
    reconciliationKey,
    "Persisted reconciliation revision",
  );
  uniqueById(
    evidence.reconciliations,
    ({ snapshotId, revision }) => `${snapshotId}\u0000${revision}`,
    "Persisted snapshot reconciliation revision",
  );
  const latestRevisionBySnapshot = new Map<string, number>();
  for (const reconciliation of evidence.reconciliations) {
    latestRevisionBySnapshot.set(
      reconciliation.snapshotId,
      Math.max(
        latestRevisionBySnapshot.get(reconciliation.snapshotId) ?? -1,
        reconciliation.revision,
      ),
    );
  }

  const plannedCaseIds = new Set<string>();
  const plannedSnapshotIds = new Set<string>();
  const observations = input.cases.map((planned) => {
    const caseId = required(planned.caseId, "Evaluation case ID");
    const eraId = required(planned.eraId, "Era ID");
    const snapshotId = required(planned.snapshotId, "Snapshot ID");
    const reconciliationId = required(
      planned.reconciliationId,
      "Reconciliation ID",
    );
    if (
      !Number.isSafeInteger(planned.reconciliationRevision) ||
      planned.reconciliationRevision < 0
    ) {
      throw new Error("Reconciliation revision is invalid.");
    }
    if (plannedCaseIds.has(caseId)) {
      throw new Error("Evaluation case IDs must be unique.");
    }
    plannedCaseIds.add(caseId);
    if (plannedSnapshotIds.has(snapshotId)) {
      throw new Error("Each persisted snapshot may be evaluated only once.");
    }
    plannedSnapshotIds.add(snapshotId);

    const snapshot = snapshotsById.get(snapshotId);
    if (snapshot === undefined) {
      throw new Error("Pinned persisted prediction snapshot is unavailable.");
    }
    validatePersistedSnapshot(snapshot);
    const reconciliation = reconciliationsById.get(
      reconciliationKey({
        reconciliationId,
        revision: planned.reconciliationRevision,
      }),
    );
    if (reconciliation === undefined) {
      throw new Error("Pinned persisted reconciliation is unavailable.");
    }
    if (
      reconciliation.snapshotId !== snapshot.snapshotId ||
      reconciliation.eventId !== snapshot.eventId
    ) {
      throw new Error("Pinned reconciliation does not match its snapshot.");
    }
    if (latestRevisionBySnapshot.get(snapshotId) !== reconciliation.revision) {
      throw new Error(
        "Historical evaluation must use the latest accepted reconciliation revision.",
      );
    }
    if (
      reconciliation.correctionHistory.length !== reconciliation.revision ||
      reconciliation.frozenPredictionMutated !== false
    ) {
      throw new Error("Persisted reconciliation provenance is invalid.");
    }

    return {
      caseId,
      eraId,
      partition: planned.partition,
      snapshot,
      reconciliation,
    };
  });

  return {
    evaluationId: input.evaluationId,
    modelVersion: input.modelVersion,
    evaluationKind: "point_in_time",
    observations,
  };
}

export async function loadPersistedHistoricalRacePredictionEvaluation(
  repository: PersistedHistoricalEvaluationRepository,
  input: EvaluatePersistedHistoricalPredictionsInput,
): Promise<HistoricalPredictionEvaluationInput> {
  const ownerId = required(input.ownerId, "Owner ID");
  const [snapshots, reconciliations] = await Promise.all([
    repository.listSnapshotsByOwner(ownerId),
    repository.listReconciliationsByOwner(ownerId),
  ]);
  return bindPersistedHistoricalRacePredictionEvaluation(
    { ownerId, snapshots, reconciliations },
    input,
  );
}

export async function evaluatePersistedHistoricalRacePredictions(
  repository: PersistedHistoricalEvaluationRepository,
  input: EvaluatePersistedHistoricalPredictionsInput,
): Promise<HistoricalPredictionEvaluation> {
  return evaluateHistoricalRacePredictions(
    await loadPersistedHistoricalRacePredictionEvaluation(repository, input),
  );
}
