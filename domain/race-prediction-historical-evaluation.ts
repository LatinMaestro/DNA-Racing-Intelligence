import type { RacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import type {
  FrozenRacePredictionSnapshot,
  RacePredictionTarget,
} from "@/domain/race-prediction-snapshot";

export type HistoricalEvaluationPartition =
  "training" | "calibration" | "holdout";

export type HistoricalPredictionObservation = Readonly<{
  caseId: string;
  eraId: string;
  partition: HistoricalEvaluationPartition;
  snapshot: FrozenRacePredictionSnapshot;
  reconciliation: RacePredictionReconciliation;
}>;

export type HistoricalPredictionEvaluationInput = Readonly<{
  evaluationId: string;
  modelVersion: string;
  evaluationKind: "point_in_time" | "retrospective_what_if";
  observations: readonly HistoricalPredictionObservation[];
}>;

export type HistoricalPredictionContextMetric = Readonly<{
  partition: HistoricalEvaluationPartition;
  eraId: string;
  target: RacePredictionTarget;
  mode: FrozenRacePredictionSnapshot["context"]["mode"];
  distanceMeters: number;
  competition: FrozenRacePredictionSnapshot["context"]["competition"];
  format: string;
  gateCount: number;
  element: string;
  eventCount: number;
  scoredPredictionCount: number;
  unscoredPredictionCount: number;
  positiveOutcomeCount: number;
  observedPositiveRateMillionths: number | null;
  brierScoreMillionths: number | null;
  completeFieldSelectionCount: number;
  correctFieldSelectionCount: number;
  fieldSelectionAccuracyMillionths: number | null;
  fieldSelectionTieCount: number;
  uncertaintyStatus: "sample_counts_only";
  calibrationStatus: "brier_only";
}>;

export type HistoricalPredictionEvaluation = Readonly<{
  evaluationId: string;
  modelVersion: string;
  evaluationKind: HistoricalPredictionEvaluationInput["evaluationKind"];
  chronologyStatus: "valid";
  partitionCoverage: Readonly<
    Record<
      HistoricalEvaluationPartition,
      Readonly<{
        eventCount: number;
        scoredPredictionCount: number;
        unscoredPredictionCount: number;
      }>
    >
  >;
  exactContextMetrics: readonly HistoricalPredictionContextMetric[];
  evaluationStatus: "review_only";
  modelPromotionAllowed: false;
  recommendationActivationAllowed: false;
  productionMutationAllowed: false;
}>;

type MutableMetric = {
  partition: HistoricalEvaluationPartition;
  eraId: string;
  target: RacePredictionTarget;
  mode: FrozenRacePredictionSnapshot["context"]["mode"];
  distanceMeters: number;
  competition: FrozenRacePredictionSnapshot["context"]["competition"];
  format: string;
  gateCount: number;
  element: string;
  eventIds: Set<string>;
  scoredPredictionCount: number;
  unscoredPredictionCount: number;
  positiveOutcomeCount: number;
  squaredErrorMillionths: bigint;
  completeFieldSelectionCount: number;
  correctFieldSelectionCount: number;
  fieldSelectionTieCount: number;
};

const PARTITIONS: readonly HistoricalEvaluationPartition[] = [
  "training",
  "calibration",
  "holdout",
];

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function roundedMillionths(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n)
    throw new Error("Metric denominator must be positive.");
  return Number((numerator * 1_000_000n + denominator / 2n) / denominator);
}

function elementKey(snapshot: FrozenRacePredictionSnapshot): string {
  return snapshot.context.element.status === "known"
    ? `known:${snapshot.context.element.value}`
    : snapshot.context.element.status;
}

function metricKey(
  observation: HistoricalPredictionObservation,
  target: RacePredictionTarget,
): string {
  const { context } = observation.snapshot;
  return [
    observation.partition,
    observation.eraId,
    target,
    context.mode,
    context.distanceMeters,
    context.competition,
    context.format,
    context.gateCount,
    elementKey(observation.snapshot),
  ].join("\u0000");
}

function validateChronology(
  observations: readonly HistoricalPredictionObservation[],
): void {
  const times = new Map<HistoricalEvaluationPartition, number[]>();
  for (const partition of PARTITIONS) times.set(partition, []);
  for (const observation of observations) {
    if (!PARTITIONS.includes(observation.partition)) {
      throw new Error("Historical evaluation partition is invalid.");
    }
    times
      .get(observation.partition)!
      .push(Date.parse(observation.snapshot.eventStartsAt));
  }
  for (const partition of PARTITIONS) {
    if (times.get(partition)!.length === 0) {
      throw new Error(`Historical evaluation requires ${partition} evidence.`);
    }
  }
  const latestTraining = Math.max(...times.get("training")!);
  const earliestCalibration = Math.min(...times.get("calibration")!);
  const latestCalibration = Math.max(...times.get("calibration")!);
  const earliestHoldout = Math.min(...times.get("holdout")!);
  if (
    latestTraining >= earliestCalibration ||
    latestCalibration >= earliestHoldout
  ) {
    throw new Error(
      "Training, calibration and holdout evidence must be strictly chronological.",
    );
  }
}

function addFieldSelection(
  metric: MutableMetric,
  observation: HistoricalPredictionObservation,
  target: RacePredictionTarget,
): void {
  if (target === "place") return;
  const scores = observation.reconciliation.scores.filter(
    (score) => score.target === target,
  );
  if (
    scores.length !== observation.snapshot.field.enteredCoreIds.length ||
    scores.some(
      (score) =>
        score.scoringStatus !== "scored" ||
        score.predictionProbabilityMillionths === null ||
        score.actual === null,
    ) ||
    scores.filter(({ actual }) => actual).length !== 1
  ) {
    return;
  }
  const highestProbability = Math.max(
    ...scores.map(({ predictionProbabilityMillionths }) =>
      Number(predictionProbabilityMillionths),
    ),
  );
  const leaders = scores.filter(
    ({ predictionProbabilityMillionths }) =>
      predictionProbabilityMillionths === highestProbability,
  );
  if (leaders.length !== 1) {
    metric.fieldSelectionTieCount += 1;
    return;
  }
  metric.completeFieldSelectionCount += 1;
  if (leaders[0]!.actual === true) metric.correctFieldSelectionCount += 1;
}

export function evaluateHistoricalRacePredictions(
  input: HistoricalPredictionEvaluationInput,
): HistoricalPredictionEvaluation {
  const evaluationId = required(input.evaluationId, "Evaluation ID");
  const modelVersion = required(input.modelVersion, "Model version");
  if (
    !(["point_in_time", "retrospective_what_if"] as const).includes(
      input.evaluationKind,
    )
  ) {
    throw new Error("Historical evaluation kind is invalid.");
  }
  if (input.observations.length === 0) {
    throw new Error("Historical evaluation observations are required.");
  }
  validateChronology(input.observations);

  const seenCaseIds = new Set<string>();
  const seenEventIds = new Set<string>();
  const metrics = new Map<string, MutableMetric>();
  const partitionCoverage = Object.fromEntries(
    PARTITIONS.map((partition) => [
      partition,
      { eventIds: new Set<string>(), scored: 0, unscored: 0 },
    ]),
  ) as Record<
    HistoricalEvaluationPartition,
    { eventIds: Set<string>; scored: number; unscored: number }
  >;

  for (const observation of input.observations) {
    const caseId = required(observation.caseId, "Evaluation case ID");
    const eraId = required(observation.eraId, "Era ID");
    if (seenCaseIds.has(caseId)) {
      throw new Error("Evaluation case IDs must be unique.");
    }
    seenCaseIds.add(caseId);
    if (observation.snapshot.modelVersion !== modelVersion) {
      throw new Error("Every snapshot must bind the evaluated model version.");
    }
    if (
      observation.reconciliation.snapshotId !==
        observation.snapshot.snapshotId ||
      observation.reconciliation.eventId !== observation.snapshot.eventId
    ) {
      throw new Error("Reconciliation must match its frozen snapshot.");
    }
    if (
      observation.reconciliation.recordStatus !== "reconciled" ||
      !observation.reconciliation.historyUpdateAllowed
    ) {
      throw new Error("Only accepted reconciled evidence may be evaluated.");
    }
    if (seenEventIds.has(observation.snapshot.eventId)) {
      throw new Error("Each event may appear only once in an evaluation.");
    }
    seenEventIds.add(observation.snapshot.eventId);
    partitionCoverage[observation.partition].eventIds.add(
      observation.snapshot.eventId,
    );

    const targets = new Set(
      observation.reconciliation.scores.map(({ target }) => target),
    );
    for (const target of targets) {
      const key = metricKey(observation, target);
      const metric = metrics.get(key) ?? {
        partition: observation.partition,
        eraId,
        target,
        mode: observation.snapshot.context.mode,
        distanceMeters: observation.snapshot.context.distanceMeters,
        competition: observation.snapshot.context.competition,
        format: observation.snapshot.context.format,
        gateCount: observation.snapshot.context.gateCount,
        element: elementKey(observation.snapshot),
        eventIds: new Set<string>(),
        scoredPredictionCount: 0,
        unscoredPredictionCount: 0,
        positiveOutcomeCount: 0,
        squaredErrorMillionths: 0n,
        completeFieldSelectionCount: 0,
        correctFieldSelectionCount: 0,
        fieldSelectionTieCount: 0,
      };
      metric.eventIds.add(observation.snapshot.eventId);
      for (const score of observation.reconciliation.scores.filter(
        (candidate) => candidate.target === target,
      )) {
        if (
          score.scoringStatus === "scored" &&
          score.predictionProbabilityMillionths !== null &&
          score.actual !== null
        ) {
          metric.scoredPredictionCount += 1;
          partitionCoverage[observation.partition].scored += 1;
          if (score.actual) metric.positiveOutcomeCount += 1;
          const error = BigInt(
            score.predictionProbabilityMillionths -
              (score.actual ? 1_000_000 : 0),
          );
          metric.squaredErrorMillionths += error * error;
        } else {
          metric.unscoredPredictionCount += 1;
          partitionCoverage[observation.partition].unscored += 1;
        }
      }
      addFieldSelection(metric, observation, target);
      metrics.set(key, metric);
    }
  }

  const exactContextMetrics = [...metrics.values()]
    .map((metric): HistoricalPredictionContextMetric => ({
      partition: metric.partition,
      eraId: metric.eraId,
      target: metric.target,
      mode: metric.mode,
      distanceMeters: metric.distanceMeters,
      competition: metric.competition,
      format: metric.format,
      gateCount: metric.gateCount,
      element: metric.element,
      eventCount: metric.eventIds.size,
      scoredPredictionCount: metric.scoredPredictionCount,
      unscoredPredictionCount: metric.unscoredPredictionCount,
      positiveOutcomeCount: metric.positiveOutcomeCount,
      observedPositiveRateMillionths:
        metric.scoredPredictionCount === 0
          ? null
          : roundedMillionths(
              BigInt(metric.positiveOutcomeCount),
              BigInt(metric.scoredPredictionCount),
            ),
      brierScoreMillionths:
        metric.scoredPredictionCount === 0
          ? null
          : Number(
              (metric.squaredErrorMillionths +
                BigInt(metric.scoredPredictionCount) * 500_000n) /
                (BigInt(metric.scoredPredictionCount) * 1_000_000n),
            ),
      completeFieldSelectionCount: metric.completeFieldSelectionCount,
      correctFieldSelectionCount: metric.correctFieldSelectionCount,
      fieldSelectionAccuracyMillionths:
        metric.completeFieldSelectionCount === 0
          ? null
          : roundedMillionths(
              BigInt(metric.correctFieldSelectionCount),
              BigInt(metric.completeFieldSelectionCount),
            ),
      fieldSelectionTieCount: metric.fieldSelectionTieCount,
      uncertaintyStatus: "sample_counts_only",
      calibrationStatus: "brier_only",
    }))
    .sort((left, right) =>
      [
        left.partition,
        left.eraId,
        left.target,
        left.mode,
        left.distanceMeters,
        left.competition,
        left.format,
        left.gateCount,
        left.element,
      ]
        .join("\u0000")
        .localeCompare(
          [
            right.partition,
            right.eraId,
            right.target,
            right.mode,
            right.distanceMeters,
            right.competition,
            right.format,
            right.gateCount,
            right.element,
          ].join("\u0000"),
        ),
    );

  return {
    evaluationId,
    modelVersion,
    evaluationKind: input.evaluationKind,
    chronologyStatus: "valid",
    partitionCoverage: {
      training: {
        eventCount: partitionCoverage.training.eventIds.size,
        scoredPredictionCount: partitionCoverage.training.scored,
        unscoredPredictionCount: partitionCoverage.training.unscored,
      },
      calibration: {
        eventCount: partitionCoverage.calibration.eventIds.size,
        scoredPredictionCount: partitionCoverage.calibration.scored,
        unscoredPredictionCount: partitionCoverage.calibration.unscored,
      },
      holdout: {
        eventCount: partitionCoverage.holdout.eventIds.size,
        scoredPredictionCount: partitionCoverage.holdout.scored,
        unscoredPredictionCount: partitionCoverage.holdout.unscored,
      },
    },
    exactContextMetrics,
    evaluationStatus: "review_only",
    modelPromotionAllowed: false,
    recommendationActivationAllowed: false,
    productionMutationAllowed: false,
  };
}
