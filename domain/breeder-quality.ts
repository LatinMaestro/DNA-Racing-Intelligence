import { probeModes, type ProbeMode } from "./discovery-probe-plan";
import type {
  BreedingConfidence,
  BreedingRecommendationStatus,
} from "./breeding-recommendation";

export type BreederScope = Readonly<{
  mode: ProbeMode;
  distanceMetres: number | null;
}>;

export type BreederOffspringOutcome = Readonly<{
  parentCoreId: string;
  coParentCoreId: string;
  offspringCoreId: string;
  scope: BreederScope;
  offspringQualityPercentile: number;
  expectedQualityPercentile: number;
  residualPercentile: number;
  offspringRaceSampleSize: number;
  benchmarkPopulationSize: number;
  offspringCreatedAt: string;
  expectedModelCutoff: string;
  evaluationCutoff: string;
}>;

export type BreederQualityPolicy = Readonly<{
  eliteOffspringQualityPercentile: number;
  exceptionalResidualPercentile: number;
  minimumOffspringRaceSampleSize: number;
  minimumOffspringBenchmarkPopulationSize: number;
  minimumTargetOffspring: number;
  minimumTargetDistinctCoParents: number;
  minimumWatchOffspring: number;
  targetMedianLiftBenchmarkPercentile: number;
  targetExceptionalRateBenchmarkPercentile: number;
  watchBreederScore: number;
  priorStrength: number;
  highConfidenceOffspring: number;
  highConfidenceDistinctCoParents: number;
  moderateConfidenceOffspring: number;
  moderateConfidenceDistinctCoParents: number;
}>;

export const defaultBreederQualityPolicy: BreederQualityPolicy = Object.freeze({
  eliteOffspringQualityPercentile: 95,
  exceptionalResidualPercentile: 90,
  minimumOffspringRaceSampleSize: 5,
  minimumOffspringBenchmarkPopulationSize: 25,
  minimumTargetOffspring: 3,
  minimumTargetDistinctCoParents: 2,
  minimumWatchOffspring: 1,
  targetMedianLiftBenchmarkPercentile: 95,
  targetExceptionalRateBenchmarkPercentile: 90,
  watchBreederScore: 80,
  priorStrength: 4,
  highConfidenceOffspring: 8,
  highConfidenceDistinctCoParents: 3,
  moderateConfidenceOffspring: 3,
  moderateConfidenceDistinctCoParents: 2,
});

export type BreederRawSummary = Readonly<{
  parentCoreId: string;
  scope: BreederScope;
  qualifiedOffspringCount: number;
  distinctCoParentCount: number;
  eliteOffspringCount: number;
  exceptionalOffspringCount: number;
  positiveLiftCount: number;
  medianLiftPercentilePoints: number | null;
  positiveLiftRate: number | null;
  eliteOffspringRate: number | null;
  exceptionalOffspringRate: number | null;
  shrunkEliteOffspringRate: number | null;
  shrunkExceptionalOffspringRate: number | null;
}>;

export type BreederQualityAssessment = Readonly<{
  parentCoreId: string;
  scope: BreederScope;
  status: BreedingRecommendationStatus;
  confidence: BreedingConfidence;
  qualifiedOffspringCount: number;
  distinctCoParentCount: number;
  eliteOffspringCount: number;
  exceptionalOffspringCount: number;
  medianLiftPercentilePoints: number | null;
  positiveLiftRate: number | null;
  shrunkEliteOffspringRate: number | null;
  shrunkExceptionalOffspringRate: number | null;
  medianLiftBenchmarkPercentile: number | null;
  eliteRateBenchmarkPercentile: number | null;
  exceptionalRateBenchmarkPercentile: number | null;
  breederScore: number | null;
  warnings: readonly string[];
  reasons: readonly string[];
}>;

export type BreederQualityBenchmark = Readonly<{
  scope: BreederScope;
  assessments: readonly BreederQualityAssessment[];
  qualifiedOutcomeCount: number;
  parentCount: number;
  populationEliteOffspringRate: number;
  populationExceptionalOffspringRate: number;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function finitePercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function validateScope(scope: BreederScope): BreederScope {
  if (!probeModes.includes(scope.mode)) {
    throw new Error("Breeder-quality racing mode is invalid.");
  }
  if (scope.distanceMetres !== null) {
    positiveInteger(scope.distanceMetres, "Breeder-quality distance");
  }
  return scope;
}

function validatePolicy(policy: BreederQualityPolicy): BreederQualityPolicy {
  finitePercent(
    policy.eliteOffspringQualityPercentile,
    "Elite offspring quality percentile",
  );
  finitePercent(
    policy.exceptionalResidualPercentile,
    "Exceptional residual percentile",
  );
  finitePercent(
    policy.targetMedianLiftBenchmarkPercentile,
    "Target median-lift benchmark percentile",
  );
  finitePercent(
    policy.targetExceptionalRateBenchmarkPercentile,
    "Target exceptional-rate benchmark percentile",
  );
  finitePercent(policy.watchBreederScore, "Watch breeder score");
  positiveInteger(
    policy.minimumOffspringRaceSampleSize,
    "Minimum offspring race sample size",
  );
  positiveInteger(
    policy.minimumOffspringBenchmarkPopulationSize,
    "Minimum offspring benchmark population size",
  );
  positiveInteger(policy.minimumTargetOffspring, "Minimum target offspring");
  positiveInteger(
    policy.minimumTargetDistinctCoParents,
    "Minimum target distinct co-parents",
  );
  positiveInteger(policy.minimumWatchOffspring, "Minimum watch offspring");
  positiveInteger(policy.highConfidenceOffspring, "High-confidence offspring");
  positiveInteger(
    policy.highConfidenceDistinctCoParents,
    "High-confidence distinct co-parents",
  );
  positiveInteger(
    policy.moderateConfidenceOffspring,
    "Moderate-confidence offspring",
  );
  positiveInteger(
    policy.moderateConfidenceDistinctCoParents,
    "Moderate-confidence distinct co-parents",
  );
  if (!Number.isFinite(policy.priorStrength) || policy.priorStrength <= 0) {
    throw new Error("Breeder prior strength must be positive and finite.");
  }
  if (policy.minimumWatchOffspring > policy.minimumTargetOffspring) {
    throw new Error(
      "Minimum watch offspring cannot exceed minimum target offspring.",
    );
  }
  return policy;
}

function validateOutcome(outcome: BreederOffspringOutcome): void {
  required(outcome.parentCoreId, "Parent Core ID");
  required(outcome.coParentCoreId, "Co-parent Core ID");
  required(outcome.offspringCoreId, "Offspring Core ID");
  if (outcome.parentCoreId === outcome.coParentCoreId) {
    throw new Error("Parent and co-parent Core IDs must differ.");
  }
  validateScope(outcome.scope);
  finitePercent(
    outcome.offspringQualityPercentile,
    "Offspring quality percentile",
  );
  finitePercent(
    outcome.expectedQualityPercentile,
    "Expected quality percentile",
  );
  finitePercent(outcome.residualPercentile, "Residual percentile");
  nonNegativeInteger(
    outcome.offspringRaceSampleSize,
    "Offspring race sample size",
  );
  nonNegativeInteger(
    outcome.benchmarkPopulationSize,
    "Offspring benchmark population size",
  );
  const createdAt = canonicalTimestamp(
    outcome.offspringCreatedAt,
    "Offspring creation time",
  );
  const modelCutoff = canonicalTimestamp(
    outcome.expectedModelCutoff,
    "Expected-model cutoff",
  );
  const evaluationCutoff = canonicalTimestamp(
    outcome.evaluationCutoff,
    "Offspring evaluation cutoff",
  );
  if (Date.parse(modelCutoff) > Date.parse(createdAt)) {
    throw new Error(
      "Expected offspring baseline must be frozen no later than offspring creation.",
    );
  }
  if (Date.parse(evaluationCutoff) < Date.parse(createdAt)) {
    throw new Error(
      "Offspring evaluation cutoff cannot precede offspring creation.",
    );
  }
}

function scopeKey(scope: BreederScope): string {
  return `${scope.mode}|${scope.distanceMetres ?? "all"}`;
}

function outcomeIdentity(outcome: BreederOffspringOutcome): string {
  return JSON.stringify([
    outcome.parentCoreId,
    outcome.coParentCoreId,
    outcome.offspringCoreId,
    scopeKey(outcome.scope),
  ]);
}

function outcomeFingerprint(outcome: BreederOffspringOutcome): string {
  return JSON.stringify(outcome);
}

export function deduplicateBreederOffspringOutcomes(
  outcomes: readonly BreederOffspringOutcome[],
): readonly BreederOffspringOutcome[] {
  const deduplicated = new Map<string, BreederOffspringOutcome>();
  for (const outcome of outcomes) {
    validateOutcome(outcome);
    const key = outcomeIdentity(outcome);
    const existing = deduplicated.get(key);
    if (existing !== undefined) {
      if (outcomeFingerprint(existing) !== outcomeFingerprint(outcome)) {
        throw new Error("Conflicting duplicate breeder offspring outcome.");
      }
      continue;
    }
    deduplicated.set(key, outcome);
  }
  return Object.freeze([...deduplicated.values()]);
}

function matchesScope(
  outcome: BreederOffspringOutcome,
  scope: BreederScope,
): boolean {
  return (
    outcome.scope.mode === scope.mode &&
    outcome.scope.distanceMetres === scope.distanceMetres
  );
}

function median(values: readonly number[]): number {
  const sorted = [...values].sort((left, right) => left - right);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 === 0
    ? (sorted[middle - 1]! + sorted[middle]!) / 2
    : sorted[middle]!;
}

function percentileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  const lower = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (100 * (lower + 0.5 * equal)) / values.length;
}

function shrunkRate(
  successes: number,
  total: number,
  populationRate: number,
  priorStrength: number,
): number | null {
  if (total <= 0) return null;
  return (successes + populationRate * priorStrength) / (total + priorStrength);
}

function rawSummary(
  parentCoreId: string,
  scope: BreederScope,
  outcomes: readonly BreederOffspringOutcome[],
  policy: BreederQualityPolicy,
  populationEliteRate: number,
  populationExceptionalRate: number,
): BreederRawSummary {
  const qualified = outcomes.filter(
    (outcome) =>
      outcome.parentCoreId === parentCoreId &&
      matchesScope(outcome, scope) &&
      outcome.offspringRaceSampleSize >=
        policy.minimumOffspringRaceSampleSize &&
      outcome.benchmarkPopulationSize >=
        policy.minimumOffspringBenchmarkPopulationSize,
  );
  const lifts = qualified.map(
    (outcome) =>
      outcome.offspringQualityPercentile - outcome.expectedQualityPercentile,
  );
  const eliteOffspringCount = qualified.filter(
    (outcome) =>
      outcome.offspringQualityPercentile >=
      policy.eliteOffspringQualityPercentile,
  ).length;
  const exceptionalOffspringCount = qualified.filter(
    (outcome) =>
      outcome.offspringQualityPercentile >=
        policy.eliteOffspringQualityPercentile &&
      outcome.residualPercentile >= policy.exceptionalResidualPercentile,
  ).length;
  const positiveLiftCount = lifts.filter((lift) => lift > 0).length;
  return Object.freeze({
    parentCoreId,
    scope,
    qualifiedOffspringCount: qualified.length,
    distinctCoParentCount: new Set(
      qualified.map((outcome) => outcome.coParentCoreId),
    ).size,
    eliteOffspringCount,
    exceptionalOffspringCount,
    positiveLiftCount,
    medianLiftPercentilePoints: lifts.length === 0 ? null : median(lifts),
    positiveLiftRate:
      lifts.length === 0 ? null : positiveLiftCount / qualified.length,
    eliteOffspringRate:
      qualified.length === 0 ? null : eliteOffspringCount / qualified.length,
    exceptionalOffspringRate:
      qualified.length === 0
        ? null
        : exceptionalOffspringCount / qualified.length,
    shrunkEliteOffspringRate: shrunkRate(
      eliteOffspringCount,
      qualified.length,
      populationEliteRate,
      policy.priorStrength,
    ),
    shrunkExceptionalOffspringRate: shrunkRate(
      exceptionalOffspringCount,
      qualified.length,
      populationExceptionalRate,
      policy.priorStrength,
    ),
  });
}

function confidenceFor(
  summary: BreederRawSummary,
  policy: BreederQualityPolicy,
): BreedingConfidence {
  if (
    summary.qualifiedOffspringCount >= policy.highConfidenceOffspring &&
    summary.distinctCoParentCount >= policy.highConfidenceDistinctCoParents
  ) {
    return "high";
  }
  if (
    summary.qualifiedOffspringCount >= policy.moderateConfidenceOffspring &&
    summary.distinctCoParentCount >= policy.moderateConfidenceDistinctCoParents
  ) {
    return "moderate";
  }
  return "low";
}

export function buildBreederQualityBenchmark(
  input: Readonly<{
    scope: BreederScope;
    outcomes: readonly BreederOffspringOutcome[];
    policy?: BreederQualityPolicy;
  }>,
): BreederQualityBenchmark {
  const scope = validateScope(input.scope);
  const policy = validatePolicy(input.policy ?? defaultBreederQualityPolicy);
  const outcomes = deduplicateBreederOffspringOutcomes(input.outcomes).filter(
    (outcome) => matchesScope(outcome, scope),
  );
  const qualified = outcomes.filter(
    (outcome) =>
      outcome.offspringRaceSampleSize >=
        policy.minimumOffspringRaceSampleSize &&
      outcome.benchmarkPopulationSize >=
        policy.minimumOffspringBenchmarkPopulationSize,
  );
  const populationEliteOffspringRate =
    qualified.length === 0
      ? 0
      : qualified.filter(
          (outcome) =>
            outcome.offspringQualityPercentile >=
            policy.eliteOffspringQualityPercentile,
        ).length / qualified.length;
  const populationExceptionalOffspringRate =
    qualified.length === 0
      ? 0
      : qualified.filter(
          (outcome) =>
            outcome.offspringQualityPercentile >=
              policy.eliteOffspringQualityPercentile &&
            outcome.residualPercentile >= policy.exceptionalResidualPercentile,
        ).length / qualified.length;
  const parentIds = [
    ...new Set(outcomes.map((outcome) => outcome.parentCoreId)),
  ].sort();
  const summaries = parentIds.map((parentCoreId) =>
    rawSummary(
      parentCoreId,
      scope,
      outcomes,
      policy,
      populationEliteOffspringRate,
      populationExceptionalOffspringRate,
    ),
  );
  const medianLifts = summaries
    .map((summary) => summary.medianLiftPercentilePoints)
    .filter((value): value is number => value !== null);
  const eliteRates = summaries
    .map((summary) => summary.shrunkEliteOffspringRate)
    .filter((value): value is number => value !== null);
  const exceptionalRates = summaries
    .map((summary) => summary.shrunkExceptionalOffspringRate)
    .filter((value): value is number => value !== null);

  const assessments = summaries.map((summary): BreederQualityAssessment => {
    const warnings: string[] = [];
    const reasons: string[] = [];
    const medianLiftBenchmarkPercentile =
      summary.medianLiftPercentilePoints === null
        ? null
        : percentileRank(medianLifts, summary.medianLiftPercentilePoints);
    const eliteRateBenchmarkPercentile =
      summary.shrunkEliteOffspringRate === null
        ? null
        : percentileRank(eliteRates, summary.shrunkEliteOffspringRate);
    const exceptionalRateBenchmarkPercentile =
      summary.shrunkExceptionalOffspringRate === null
        ? null
        : percentileRank(
            exceptionalRates,
            summary.shrunkExceptionalOffspringRate,
          );
    const breederScore =
      medianLiftBenchmarkPercentile === null ||
      eliteRateBenchmarkPercentile === null ||
      exceptionalRateBenchmarkPercentile === null
        ? null
        : 0.55 * medianLiftBenchmarkPercentile +
          0.3 * exceptionalRateBenchmarkPercentile +
          0.15 * eliteRateBenchmarkPercentile;

    if (summary.qualifiedOffspringCount === 0) {
      warnings.push("NO_QUALIFIED_OFFSPRING_PERFORMANCE_EVIDENCE");
      reasons.push(
        "No offspring has enough mode-specific racing evidence to evaluate breeder quality.",
      );
    }
    if (summary.distinctCoParentCount < policy.minimumTargetDistinctCoParents) {
      warnings.push("CO_PARENT_DIVERSITY_TOO_LOW_FOR_TARGET");
    }
    if (summary.qualifiedOffspringCount < policy.minimumTargetOffspring) {
      warnings.push("OFFSPRING_SAMPLE_TOO_SMALL_FOR_TARGET");
    }

    const target =
      summary.qualifiedOffspringCount >= policy.minimumTargetOffspring &&
      summary.distinctCoParentCount >= policy.minimumTargetDistinctCoParents &&
      medianLiftBenchmarkPercentile !== null &&
      medianLiftBenchmarkPercentile >=
        policy.targetMedianLiftBenchmarkPercentile &&
      exceptionalRateBenchmarkPercentile !== null &&
      exceptionalRateBenchmarkPercentile >=
        policy.targetExceptionalRateBenchmarkPercentile;
    const watch =
      !target &&
      summary.qualifiedOffspringCount >= policy.minimumWatchOffspring &&
      (summary.exceptionalOffspringCount > 0 ||
        (breederScore !== null && breederScore >= policy.watchBreederScore));

    let status: BreedingRecommendationStatus = "wait";
    if (target) {
      status = "target";
      reasons.push(
        "Offspring repeatedly outperform their mating baselines and the parent's exceptional-outcome rate ranks near the top of the breeder benchmark.",
      );
    } else if (watch) {
      status = "watch";
      if (
        summary.exceptionalOffspringCount > 0 &&
        summary.qualifiedOffspringCount < policy.minimumTargetOffspring
      ) {
        reasons.push(
          "At least one exceptional offspring exists, but the sample is too small to establish repeatable breeder lift.",
        );
      } else if (
        summary.distinctCoParentCount < policy.minimumTargetDistinctCoParents
      ) {
        reasons.push(
          "Positive offspring evidence remains confounded by limited co-parent diversity.",
        );
      } else {
        reasons.push(
          "Breeder evidence is promising but has not cleared every elite breeder gate.",
        );
      }
    } else {
      reasons.push(
        "Historical offspring evidence does not currently establish elite breeder lift.",
      );
    }

    return Object.freeze({
      parentCoreId: summary.parentCoreId,
      scope,
      status,
      confidence: confidenceFor(summary, policy),
      qualifiedOffspringCount: summary.qualifiedOffspringCount,
      distinctCoParentCount: summary.distinctCoParentCount,
      eliteOffspringCount: summary.eliteOffspringCount,
      exceptionalOffspringCount: summary.exceptionalOffspringCount,
      medianLiftPercentilePoints: summary.medianLiftPercentilePoints,
      positiveLiftRate: summary.positiveLiftRate,
      shrunkEliteOffspringRate: summary.shrunkEliteOffspringRate,
      shrunkExceptionalOffspringRate: summary.shrunkExceptionalOffspringRate,
      medianLiftBenchmarkPercentile,
      eliteRateBenchmarkPercentile,
      exceptionalRateBenchmarkPercentile,
      breederScore,
      warnings: Object.freeze(warnings),
      reasons: Object.freeze(reasons),
    });
  });

  return Object.freeze({
    scope,
    assessments: Object.freeze(
      [...assessments].sort(
        (left, right) =>
          (right.breederScore ?? -1) - (left.breederScore ?? -1) ||
          left.parentCoreId.localeCompare(right.parentCoreId),
      ),
    ),
    qualifiedOutcomeCount: qualified.length,
    parentCount: parentIds.length,
    populationEliteOffspringRate,
    populationExceptionalOffspringRate,
  });
}

export function findBreederAssessment(
  benchmark: BreederQualityBenchmark,
  parentCoreId: string,
): BreederQualityAssessment | null {
  required(parentCoreId, "Parent Core ID");
  return (
    benchmark.assessments.find(
      (assessment) => assessment.parentCoreId === parentCoreId,
    ) ?? null
  );
}
