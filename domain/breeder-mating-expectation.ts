import type { BreederScope } from "./breeder-quality";

export type HistoricalMatingOutcome = Readonly<{
  offspringCoreId: string;
  scope: BreederScope;
  parentAQualityPercentile: number;
  parentBQualityPercentile: number;
  offspringQualityPercentile: number;
  offspringCreatedAt: string;
}>;

export type MatingExpectationPolicy = Readonly<{
  minimumHistoricalMatings: number;
  maximumComparableMatings: number;
  moderateConfidenceMatings: number;
  highConfidenceMatings: number;
  moderateConfidenceMedianParentDistance: number;
  highConfidenceMedianParentDistance: number;
}>;

export const defaultMatingExpectationPolicy: MatingExpectationPolicy =
  Object.freeze({
    minimumHistoricalMatings: 12,
    maximumComparableMatings: 40,
    moderateConfidenceMatings: 20,
    highConfidenceMatings: 30,
    moderateConfidenceMedianParentDistance: 20,
    highConfidenceMedianParentDistance: 10,
  });

export type MatingExpectationEstimate =
  | Readonly<{
      status: "unavailable";
      scope: BreederScope;
      asOf: string;
      historicalMatingCount: number;
      reason: string;
    }>
  | Readonly<{
      status: "available";
      scope: BreederScope;
      asOf: string;
      historicalMatingCount: number;
      comparableMatingCount: number;
      parentQualityLow: number;
      parentQualityHigh: number;
      typicalOffspringQualityPercentile: number;
      weakerTailQualityPercentile: number;
      strongerTailQualityPercentile: number;
      medianComparableParentDistance: number;
      confidence: "low" | "moderate" | "high";
      method: "chronological_nearest_mating_quantiles";
      warnings: readonly string[];
    }>;

function finitePercent(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
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

function scopeKey(scope: BreederScope): string {
  return `${scope.mode}|${scope.distanceMetres ?? "all"}`;
}

function quantile(values: readonly number[], probability: number): number {
  if (values.length === 0)
    throw new Error("Cannot calculate an empty quantile.");
  const sorted = [...values].sort((left, right) => left - right);
  const position = (sorted.length - 1) * probability;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  const weight = position - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function validatePolicy(policy: MatingExpectationPolicy): void {
  positiveInteger(
    policy.minimumHistoricalMatings,
    "Minimum historical matings",
  );
  positiveInteger(
    policy.maximumComparableMatings,
    "Maximum comparable matings",
  );
  positiveInteger(
    policy.moderateConfidenceMatings,
    "Moderate-confidence matings",
  );
  positiveInteger(policy.highConfidenceMatings, "High-confidence matings");
  if (policy.maximumComparableMatings < policy.minimumHistoricalMatings) {
    throw new Error(
      "Maximum comparable matings cannot be below minimum historical matings.",
    );
  }
  if (
    !Number.isFinite(policy.moderateConfidenceMedianParentDistance) ||
    policy.moderateConfidenceMedianParentDistance < 0 ||
    !Number.isFinite(policy.highConfidenceMedianParentDistance) ||
    policy.highConfidenceMedianParentDistance < 0
  ) {
    throw new Error(
      "Parent-distance confidence thresholds must be non-negative.",
    );
  }
}

function validateObservation(observation: HistoricalMatingOutcome): void {
  if (observation.offspringCoreId.trim() === "") {
    throw new Error("Historical mating offspring Core ID is required.");
  }
  finitePercent(
    observation.parentAQualityPercentile,
    "Parent A quality percentile",
  );
  finitePercent(
    observation.parentBQualityPercentile,
    "Parent B quality percentile",
  );
  finitePercent(
    observation.offspringQualityPercentile,
    "Offspring quality percentile",
  );
  canonicalTimestamp(observation.offspringCreatedAt, "Offspring creation time");
}

function orderedParents(
  left: number,
  right: number,
): readonly [number, number] {
  return left <= right ? [left, right] : [right, left];
}

export function estimateHistoricalMatingExpectation(input: {
  scope: BreederScope;
  parentAQualityPercentile: number;
  parentBQualityPercentile: number;
  asOf: string;
  historicalMatings: readonly HistoricalMatingOutcome[];
  policy?: MatingExpectationPolicy;
}): MatingExpectationEstimate {
  const policy = input.policy ?? defaultMatingExpectationPolicy;
  validatePolicy(policy);
  finitePercent(input.parentAQualityPercentile, "Parent A quality percentile");
  finitePercent(input.parentBQualityPercentile, "Parent B quality percentile");
  const asOf = canonicalTimestamp(input.asOf, "Mating expectation cutoff");
  const wantedScope = scopeKey(input.scope);
  const [targetLow, targetHigh] = orderedParents(
    input.parentAQualityPercentile,
    input.parentBQualityPercentile,
  );

  const eligible = input.historicalMatings
    .map((observation) => {
      validateObservation(observation);
      return observation;
    })
    .filter(
      (observation) =>
        scopeKey(observation.scope) === wantedScope &&
        Date.parse(observation.offspringCreatedAt) < Date.parse(asOf),
    )
    .map((observation) => {
      const [low, high] = orderedParents(
        observation.parentAQualityPercentile,
        observation.parentBQualityPercentile,
      );
      return {
        observation,
        distance: Math.abs(low - targetLow) + Math.abs(high - targetHigh),
      };
    })
    .sort(
      (left, right) =>
        left.distance - right.distance ||
        left.observation.offspringCreatedAt.localeCompare(
          right.observation.offspringCreatedAt,
        ) ||
        left.observation.offspringCoreId.localeCompare(
          right.observation.offspringCoreId,
        ),
    );

  if (eligible.length < policy.minimumHistoricalMatings) {
    return Object.freeze({
      status: "unavailable",
      scope: input.scope,
      asOf,
      historicalMatingCount: eligible.length,
      reason: `Only ${eligible.length} earlier comparable-scope matings are available; ${policy.minimumHistoricalMatings} are required.`,
    });
  }

  const comparable = eligible.slice(0, policy.maximumComparableMatings);
  const offspring = comparable.map(
    (entry) => entry.observation.offspringQualityPercentile,
  );
  const distances = comparable.map((entry) => entry.distance);
  const medianDistance = quantile(distances, 0.5);
  const warnings: string[] = [];
  let confidence: "low" | "moderate" | "high" = "low";

  if (
    comparable.length >= policy.highConfidenceMatings &&
    medianDistance <= policy.highConfidenceMedianParentDistance
  ) {
    confidence = "high";
  } else if (
    comparable.length >= policy.moderateConfidenceMatings &&
    medianDistance <= policy.moderateConfidenceMedianParentDistance
  ) {
    confidence = "moderate";
  } else {
    warnings.push(
      "Comparable historical matings are sparse or materially different in parent quality; treat the expectation as low confidence.",
    );
  }

  return Object.freeze({
    status: "available",
    scope: input.scope,
    asOf,
    historicalMatingCount: eligible.length,
    comparableMatingCount: comparable.length,
    parentQualityLow: targetLow,
    parentQualityHigh: targetHigh,
    weakerTailQualityPercentile: quantile(offspring, 0.1),
    typicalOffspringQualityPercentile: quantile(offspring, 0.5),
    strongerTailQualityPercentile: quantile(offspring, 0.9),
    medianComparableParentDistance: medianDistance,
    confidence,
    method: "chronological_nearest_mating_quantiles",
    warnings: Object.freeze(warnings),
  });
}
