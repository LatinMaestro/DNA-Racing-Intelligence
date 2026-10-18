import {
  compareHistoricalPredictionModels,
  type HistoricalPredictionModelComparison,
} from "@/domain/race-prediction-model-comparison";
import {
  bindPersistedHistoricalRacePredictionEvaluation,
  type EvaluatePersistedHistoricalPredictionsInput,
  type PersistedHistoricalEvaluationRepository,
} from "@/lib/race-prediction-historical-evaluation-service";

export type ComparePersistedHistoricalPredictionModelsInput = Readonly<{
  ownerId: string;
  comparisonId: string;
  baselineAuthorityReference: string;
  champion: Omit<EvaluatePersistedHistoricalPredictionsInput, "ownerId">;
  challenger: Omit<EvaluatePersistedHistoricalPredictionsInput, "ownerId">;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

export async function comparePersistedHistoricalPredictionModels(
  repository: PersistedHistoricalEvaluationRepository,
  input: ComparePersistedHistoricalPredictionModelsInput,
): Promise<HistoricalPredictionModelComparison> {
  const ownerId = required(input.ownerId, "Owner ID");
  const [snapshots, reconciliations] = await Promise.all([
    repository.listSnapshotsByOwner(ownerId),
    repository.listReconciliationsByOwner(ownerId),
  ]);
  const evidence = { ownerId, snapshots, reconciliations };

  return compareHistoricalPredictionModels({
    comparisonId: input.comparisonId,
    baselineAuthorityReference: input.baselineAuthorityReference,
    champion: bindPersistedHistoricalRacePredictionEvaluation(evidence, {
      ownerId,
      ...input.champion,
    }),
    challenger: bindPersistedHistoricalRacePredictionEvaluation(evidence, {
      ownerId,
      ...input.challenger,
    }),
  });
}
