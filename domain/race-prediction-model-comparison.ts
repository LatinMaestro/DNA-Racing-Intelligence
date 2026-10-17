import {
  evaluateHistoricalRacePredictions,
  type HistoricalPredictionContextMetric,
  type HistoricalPredictionEvaluationInput,
  type HistoricalPredictionObservation,
} from "@/domain/race-prediction-historical-evaluation";
import type { RacePredictionTarget } from "@/domain/race-prediction-snapshot";

export type HistoricalPredictionModelComparisonInput = Readonly<{
  comparisonId: string;
  baselineAuthorityReference: string;
  champion: HistoricalPredictionEvaluationInput;
  challenger: HistoricalPredictionEvaluationInput;
}>;

export type HistoricalPredictionModelComparisonMetric = Readonly<{
  eraId: string;
  target: RacePredictionTarget;
  mode: HistoricalPredictionContextMetric["mode"];
  distanceMeters: number;
  competition: HistoricalPredictionContextMetric["competition"];
  format: string;
  gateCount: number;
  element: string;
  championEventCount: number;
  challengerEventCount: number;
  championScoredPredictionCount: number;
  challengerScoredPredictionCount: number;
  brierComparisonStatus:
    "comparable" | "coverage_mismatch" | "metric_unavailable";
  championBrierScoreMillionths: number | null;
  challengerBrierScoreMillionths: number | null;
  challengerBrierDeltaMillionths: number | null;
  brierDirection: "challenger_lower" | "equal" | "challenger_higher" | null;
  fieldSelectionComparisonStatus:
    "comparable" | "coverage_mismatch" | "metric_unavailable";
  championCompleteFieldSelectionCount: number;
  challengerCompleteFieldSelectionCount: number;
  championFieldSelectionAccuracyMillionths: number | null;
  challengerFieldSelectionAccuracyMillionths: number | null;
  challengerFieldSelectionAccuracyDeltaMillionths: number | null;
  fieldSelectionDirection:
    "challenger_higher" | "equal" | "challenger_lower" | null;
  uncertaintyStatus: "sample_counts_only";
  calibrationStatus: "brier_only";
}>;

export type HistoricalPredictionModelComparison = Readonly<{
  comparisonId: string;
  baselineAuthorityReference: string;
  championEvaluationId: string;
  challengerEvaluationId: string;
  championModelVersion: string;
  challengerModelVersion: string;
  evaluationPopulationStatus: "exact_match";
  comparisonPartition: "holdout";
  metrics: readonly HistoricalPredictionModelComparisonMetric[];
  brierComparableMetricCount: number;
  fieldSelectionComparableMetricCount: number;
  coverageMismatchMetricCount: number;
  unavailableMetricCount: number;
  comparisonStatus: "review_only";
  decisionStatus: "method_review_required";
  lastGoodModelVersion: string;
  automaticPromotionAllowed: false;
  recommendationActivationAllowed: false;
  productionMutationAllowed: false;
}>;

type MetricCoverage = Readonly<{
  scoredPredictionKeys: ReadonlySet<string>;
  eligibleFieldSelectionKeys: ReadonlySet<string>;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function contextKey(
  observation: HistoricalPredictionObservation,
  target: RacePredictionTarget,
): string {
  const { context } = observation.snapshot;
  const element =
    context.element.status === "known"
      ? `known:${context.element.value}`
      : context.element.status;
  return [
    observation.eraId,
    target,
    context.mode,
    context.distanceMeters,
    context.competition,
    context.format,
    context.gateCount,
    element,
  ].join("\u0000");
}

function metricKey(metric: HistoricalPredictionContextMetric): string {
  return [
    metric.eraId,
    metric.target,
    metric.mode,
    metric.distanceMeters,
    metric.competition,
    metric.format,
    metric.gateCount,
    metric.element,
  ].join("\u0000");
}

function exactSetMatch(
  left: ReadonlySet<string>,
  right: ReadonlySet<string>,
): boolean {
  return (
    left.size === right.size && [...left].every((value) => right.has(value))
  );
}

function comparableFieldSelection(
  observation: HistoricalPredictionObservation,
  target: RacePredictionTarget,
): boolean {
  if (target === "place") return false;
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
    return false;
  }
  const highestProbability = Math.max(
    ...scores.map(({ predictionProbabilityMillionths }) =>
      Number(predictionProbabilityMillionths),
    ),
  );
  return (
    scores.filter(
      ({ predictionProbabilityMillionths }) =>
        predictionProbabilityMillionths === highestProbability,
    ).length === 1
  );
}

function coverageByMetric(
  input: HistoricalPredictionEvaluationInput,
): ReadonlyMap<string, MetricCoverage> {
  const mutable = new Map<
    string,
    {
      scoredPredictionKeys: Set<string>;
      eligibleFieldSelectionKeys: Set<string>;
    }
  >();
  for (const observation of input.observations) {
    if (observation.partition !== "holdout") continue;
    const targets = new Set(
      observation.reconciliation.scores.map(({ target }) => target),
    );
    for (const target of targets) {
      const key = contextKey(observation, target);
      const coverage = mutable.get(key) ?? {
        scoredPredictionKeys: new Set<string>(),
        eligibleFieldSelectionKeys: new Set<string>(),
      };
      for (const score of observation.reconciliation.scores.filter(
        (candidate) => candidate.target === target,
      )) {
        if (
          score.scoringStatus === "scored" &&
          score.predictionProbabilityMillionths !== null &&
          score.actual !== null
        ) {
          coverage.scoredPredictionKeys.add(
            `${observation.snapshot.eventId}\u0000${score.coreId}\u0000${target}`,
          );
        }
      }
      if (comparableFieldSelection(observation, target)) {
        coverage.eligibleFieldSelectionKeys.add(observation.snapshot.eventId);
      }
      mutable.set(key, coverage);
    }
  }
  return mutable;
}

function populationFacts(observation: HistoricalPredictionObservation): string {
  return JSON.stringify({
    partition: observation.partition,
    eraId: observation.eraId,
    eventStartsAt: observation.snapshot.eventStartsAt,
    evidenceCutoff: observation.snapshot.evidenceCutoff,
    context: observation.snapshot.context,
    field: observation.snapshot.field,
    acceptedResult: {
      sourceEvidenceId: observation.reconciliation.sourceEvidenceId,
      sourceVersion: observation.reconciliation.sourceVersion,
      eventCompletedAt: observation.reconciliation.eventCompletedAt,
      outcomeStatus: observation.reconciliation.outcomeStatus,
      starDataStatus: observation.reconciliation.starDataStatus,
      entries: observation.reconciliation.entries,
      revision: observation.reconciliation.revision,
    },
  });
}

function validateExactPopulation(
  champion: HistoricalPredictionEvaluationInput,
  challenger: HistoricalPredictionEvaluationInput,
): void {
  if (
    champion.evaluationKind !== "point_in_time" ||
    challenger.evaluationKind !== "point_in_time"
  ) {
    throw new Error(
      "Champion comparison requires point-in-time evaluation evidence.",
    );
  }
  if (champion.modelVersion === challenger.modelVersion) {
    throw new Error("Champion and challenger model versions must differ.");
  }
  const challengerByEvent = new Map(
    challenger.observations.map((observation) => [
      observation.snapshot.eventId,
      observation,
    ]),
  );
  if (
    challengerByEvent.size !== challenger.observations.length ||
    champion.observations.length !== challenger.observations.length
  ) {
    throw new Error("Champion and challenger event populations must match.");
  }
  for (const championObservation of champion.observations) {
    const challengerObservation = challengerByEvent.get(
      championObservation.snapshot.eventId,
    );
    if (
      challengerObservation === undefined ||
      populationFacts(championObservation) !==
        populationFacts(challengerObservation)
    ) {
      throw new Error(
        "Champion and challenger must use the exact same frozen event population and accepted outcomes.",
      );
    }
  }
}

function direction(
  delta: number,
  lowerIsBetter: boolean,
): "challenger_lower" | "challenger_higher" | "equal" {
  if (delta === 0) return "equal";
  if (lowerIsBetter)
    return delta < 0 ? "challenger_lower" : "challenger_higher";
  return delta > 0 ? "challenger_higher" : "challenger_lower";
}

export function compareHistoricalPredictionModels(
  input: HistoricalPredictionModelComparisonInput,
): HistoricalPredictionModelComparison {
  const comparisonId = required(input.comparisonId, "Comparison ID");
  const baselineAuthorityReference = required(
    input.baselineAuthorityReference,
    "Baseline authority reference",
  );
  validateExactPopulation(input.champion, input.challenger);

  const champion = evaluateHistoricalRacePredictions(input.champion);
  const challenger = evaluateHistoricalRacePredictions(input.challenger);
  const championMetrics = new Map(
    champion.exactContextMetrics
      .filter(({ partition }) => partition === "holdout")
      .map((metric) => [metricKey(metric), metric]),
  );
  const challengerMetrics = new Map(
    challenger.exactContextMetrics
      .filter(({ partition }) => partition === "holdout")
      .map((metric) => [metricKey(metric), metric]),
  );
  const championCoverage = coverageByMetric(input.champion);
  const challengerCoverage = coverageByMetric(input.challenger);
  const keys = [
    ...new Set([...championMetrics.keys(), ...challengerMetrics.keys()]),
  ].sort();

  const metrics = keys.map((key): HistoricalPredictionModelComparisonMetric => {
    const championMetric = championMetrics.get(key);
    const challengerMetric = challengerMetrics.get(key);
    const exemplar = championMetric ?? challengerMetric;
    if (exemplar === undefined)
      throw new Error("Comparison metric is missing.");
    const championMetricCoverage = championCoverage.get(key);
    const challengerMetricCoverage = challengerCoverage.get(key);
    const brierCoverageMatches =
      championMetricCoverage !== undefined &&
      challengerMetricCoverage !== undefined &&
      exactSetMatch(
        championMetricCoverage.scoredPredictionKeys,
        challengerMetricCoverage.scoredPredictionKeys,
      );
    const fieldCoverageMatches =
      championMetricCoverage !== undefined &&
      challengerMetricCoverage !== undefined &&
      exactSetMatch(
        championMetricCoverage.eligibleFieldSelectionKeys,
        challengerMetricCoverage.eligibleFieldSelectionKeys,
      );
    const brierAvailable =
      championMetric?.brierScoreMillionths !== null &&
      championMetric?.brierScoreMillionths !== undefined &&
      challengerMetric?.brierScoreMillionths !== null &&
      challengerMetric?.brierScoreMillionths !== undefined;
    const fieldAvailable =
      championMetric?.fieldSelectionAccuracyMillionths !== null &&
      championMetric?.fieldSelectionAccuracyMillionths !== undefined &&
      challengerMetric?.fieldSelectionAccuracyMillionths !== null &&
      challengerMetric?.fieldSelectionAccuracyMillionths !== undefined;
    const brierComparisonStatus = !brierCoverageMatches
      ? ("coverage_mismatch" as const)
      : !brierAvailable
        ? ("metric_unavailable" as const)
        : ("comparable" as const);
    const fieldSelectionComparisonStatus = !fieldCoverageMatches
      ? ("coverage_mismatch" as const)
      : !fieldAvailable
        ? ("metric_unavailable" as const)
        : ("comparable" as const);
    const brierDelta =
      brierComparisonStatus === "comparable"
        ? challengerMetric!.brierScoreMillionths! -
          championMetric!.brierScoreMillionths!
        : null;
    const fieldDelta =
      fieldSelectionComparisonStatus === "comparable"
        ? challengerMetric!.fieldSelectionAccuracyMillionths! -
          championMetric!.fieldSelectionAccuracyMillionths!
        : null;

    return {
      eraId: exemplar.eraId,
      target: exemplar.target,
      mode: exemplar.mode,
      distanceMeters: exemplar.distanceMeters,
      competition: exemplar.competition,
      format: exemplar.format,
      gateCount: exemplar.gateCount,
      element: exemplar.element,
      championEventCount: championMetric?.eventCount ?? 0,
      challengerEventCount: challengerMetric?.eventCount ?? 0,
      championScoredPredictionCount: championMetric?.scoredPredictionCount ?? 0,
      challengerScoredPredictionCount:
        challengerMetric?.scoredPredictionCount ?? 0,
      brierComparisonStatus,
      championBrierScoreMillionths:
        championMetric?.brierScoreMillionths ?? null,
      challengerBrierScoreMillionths:
        challengerMetric?.brierScoreMillionths ?? null,
      challengerBrierDeltaMillionths: brierDelta,
      brierDirection: brierDelta === null ? null : direction(brierDelta, true),
      fieldSelectionComparisonStatus,
      championCompleteFieldSelectionCount:
        championMetric?.completeFieldSelectionCount ?? 0,
      challengerCompleteFieldSelectionCount:
        challengerMetric?.completeFieldSelectionCount ?? 0,
      championFieldSelectionAccuracyMillionths:
        championMetric?.fieldSelectionAccuracyMillionths ?? null,
      challengerFieldSelectionAccuracyMillionths:
        challengerMetric?.fieldSelectionAccuracyMillionths ?? null,
      challengerFieldSelectionAccuracyDeltaMillionths: fieldDelta,
      fieldSelectionDirection:
        fieldDelta === null ? null : direction(fieldDelta, false),
      uncertaintyStatus: "sample_counts_only",
      calibrationStatus: "brier_only",
    };
  });

  return {
    comparisonId,
    baselineAuthorityReference,
    championEvaluationId: champion.evaluationId,
    challengerEvaluationId: challenger.evaluationId,
    championModelVersion: champion.modelVersion,
    challengerModelVersion: challenger.modelVersion,
    evaluationPopulationStatus: "exact_match",
    comparisonPartition: "holdout",
    metrics,
    brierComparableMetricCount: metrics.filter(
      ({ brierComparisonStatus }) => brierComparisonStatus === "comparable",
    ).length,
    fieldSelectionComparableMetricCount: metrics.filter(
      ({ fieldSelectionComparisonStatus }) =>
        fieldSelectionComparisonStatus === "comparable",
    ).length,
    coverageMismatchMetricCount: metrics.filter(
      ({ brierComparisonStatus, fieldSelectionComparisonStatus }) =>
        brierComparisonStatus === "coverage_mismatch" ||
        fieldSelectionComparisonStatus === "coverage_mismatch",
    ).length,
    unavailableMetricCount: metrics.filter(
      ({ brierComparisonStatus, fieldSelectionComparisonStatus }) =>
        brierComparisonStatus === "metric_unavailable" ||
        fieldSelectionComparisonStatus === "metric_unavailable",
    ).length,
    comparisonStatus: "review_only",
    decisionStatus: "method_review_required",
    lastGoodModelVersion: champion.modelVersion,
    automaticPromotionAllowed: false,
    recommendationActivationAllowed: false,
    productionMutationAllowed: false,
  };
}
