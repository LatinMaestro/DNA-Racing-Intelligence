import type { BreederScope } from "./breeder-quality";

export type BreederLiftObservation = Readonly<{
  offspringCoreId: string;
  parentACoreId: string;
  parentBCoreId: string;
  scope: BreederScope;
  /** Child quality percentile minus the empirically expected mating median. */
  liftPercentilePoints: number;
}>;

export type BreederEffectPolicy = Readonly<{
  parentRidgeStrength: number;
  pairPriorStrength: number;
  huberDelta: number;
  iterations: number;
  minimumTargetOffspring: number;
  minimumTargetCoParents: number;
  targetEffectPercentile: number;
  watchEffectPercentile: number;
  minimumPositiveLiftRate: number;
}>;

export const defaultBreederEffectPolicy: BreederEffectPolicy = Object.freeze({
  parentRidgeStrength: 4,
  pairPriorStrength: 3,
  huberDelta: 15,
  iterations: 30,
  minimumTargetOffspring: 3,
  minimumTargetCoParents: 2,
  targetEffectPercentile: 95,
  watchEffectPercentile: 80,
  minimumPositiveLiftRate: 0.6,
});

export type BreederParentEffect = Readonly<{
  parentCoreId: string;
  offspringCount: number;
  distinctCoParentCount: number;
  rawMedianLift: number;
  positiveLiftRate: number;
  adjustedBreederEffect: number;
  effectPercentile: number;
  status: "target" | "watch" | "wait";
  warnings: readonly string[];
}>;

export type BreederPairSynergy = Readonly<{
  parentACoreId: string;
  parentBCoreId: string;
  offspringCount: number;
  rawMedianResidualAfterParentEffects: number;
  adjustedPairSynergy: number;
  positiveResidualRate: number;
  status: "watch" | "wait";
}>;

export type BreederEffectDecomposition = Readonly<{
  scope: BreederScope;
  observationCount: number;
  parentCount: number;
  baselineLift: number;
  parentEffects: readonly BreederParentEffect[];
  pairSynergies: readonly BreederPairSynergy[];
  method: "robust_ridge_parent_effect_plus_shrunk_pair_residual";
}>;

function scopeKey(scope: BreederScope): string {
  return `${scope.mode}|${scope.distanceMetres ?? "all"}`;
}

function finiteLift(value: number): number {
  if (!Number.isFinite(value) || value < -100 || value > 100) {
    throw new Error("Breeder lift must be finite and between -100 and 100.");
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 1) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function percentage(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between 0 and 100.`);
  }
  return value;
}

function validatePolicy(policy: BreederEffectPolicy): void {
  positiveFinite(policy.parentRidgeStrength, "Parent ridge strength");
  positiveFinite(policy.pairPriorStrength, "Pair prior strength");
  positiveFinite(policy.huberDelta, "Huber delta");
  positiveInteger(policy.iterations, "Iteration count");
  positiveInteger(policy.minimumTargetOffspring, "Minimum target offspring");
  positiveInteger(policy.minimumTargetCoParents, "Minimum target co-parents");
  percentage(policy.targetEffectPercentile, "Target effect percentile");
  percentage(policy.watchEffectPercentile, "Watch effect percentile");
  if (policy.watchEffectPercentile > policy.targetEffectPercentile) {
    throw new Error("Watch effect percentile cannot exceed target threshold.");
  }
  if (
    !Number.isFinite(policy.minimumPositiveLiftRate) ||
    policy.minimumPositiveLiftRate < 0 ||
    policy.minimumPositiveLiftRate > 1
  ) {
    throw new Error("Minimum positive lift rate must be between 0 and 1.");
  }
}

function canonicalParentPair(
  left: string,
  right: string,
): readonly [string, string] {
  if (left === right)
    throw new Error("A mating cannot use the same Core twice.");
  return left < right ? [left, right] : [right, left];
}

function quantile(values: readonly number[], q: number): number {
  if (values.length === 0)
    throw new Error("Cannot calculate an empty quantile.");
  const sorted = [...values].sort((a, b) => a - b);
  const position = (sorted.length - 1) * q;
  const low = Math.floor(position);
  const high = Math.ceil(position);
  if (low === high) return sorted[low]!;
  const weight = position - low;
  return sorted[low]! * (1 - weight) + sorted[high]! * weight;
}

function median(values: readonly number[]): number {
  return quantile(values, 0.5);
}

function percentileRank(values: readonly number[], value: number): number {
  if (values.length === 0) return 0;
  const lower = values.filter((candidate) => candidate < value).length;
  const equal = values.filter((candidate) => candidate === value).length;
  return (100 * (lower + 0.5 * equal)) / values.length;
}

function huberWeight(residual: number, delta: number): number {
  const absolute = Math.abs(residual);
  return absolute <= delta ? 1 : delta / absolute;
}

export function decomposeBreederEffects(input: {
  scope: BreederScope;
  observations: readonly BreederLiftObservation[];
  policy?: BreederEffectPolicy;
}): BreederEffectDecomposition {
  const policy = input.policy ?? defaultBreederEffectPolicy;
  validatePolicy(policy);
  const wantedScope = scopeKey(input.scope);
  const observations = input.observations.map((observation) => {
    if (scopeKey(observation.scope) !== wantedScope) {
      throw new Error("Breeder-effect observations must share one scope.");
    }
    if (
      observation.offspringCoreId.trim() === "" ||
      observation.parentACoreId.trim() === "" ||
      observation.parentBCoreId.trim() === ""
    ) {
      throw new Error("Breeder-effect Core IDs are required.");
    }
    const [parentA, parentB] = canonicalParentPair(
      observation.parentACoreId,
      observation.parentBCoreId,
    );
    return Object.freeze({
      offspringCoreId: observation.offspringCoreId,
      parentA,
      parentB,
      lift: finiteLift(observation.liftPercentilePoints),
    });
  });

  const offspringIds = new Set<string>();
  for (const observation of observations) {
    if (offspringIds.has(observation.offspringCoreId)) {
      throw new Error(
        `Duplicate offspring ${observation.offspringCoreId} in one breeder-effect scope.`,
      );
    }
    offspringIds.add(observation.offspringCoreId);
  }

  const parentIds = [
    ...new Set(observations.flatMap((row) => [row.parentA, row.parentB])),
  ].sort();
  const effects = new Map(parentIds.map((parent) => [parent, 0]));
  let baseline =
    observations.length > 0 ? median(observations.map((r) => r.lift)) : 0;

  for (let iteration = 0; iteration < policy.iterations; iteration++) {
    const residuals = observations.map((row) => {
      const predicted =
        baseline +
        (effects.get(row.parentA) ?? 0) +
        (effects.get(row.parentB) ?? 0);
      return row.lift - predicted;
    });
    const weights = residuals.map((residual) =>
      huberWeight(residual, policy.huberDelta),
    );

    let weightedBaselineNumerator = 0;
    let baselineWeight = 0;
    observations.forEach((row, index) => {
      const weight = weights[index]!;
      weightedBaselineNumerator +=
        weight *
        (row.lift -
          (effects.get(row.parentA) ?? 0) -
          (effects.get(row.parentB) ?? 0));
      baselineWeight += weight;
    });
    if (baselineWeight > 0)
      baseline = weightedBaselineNumerator / baselineWeight;

    for (const parent of parentIds) {
      let numerator = 0;
      let denominator = policy.parentRidgeStrength;
      observations.forEach((row, index) => {
        if (row.parentA !== parent && row.parentB !== parent) return;
        const other = row.parentA === parent ? row.parentB : row.parentA;
        const weight = weights[index]!;
        numerator += weight * (row.lift - baseline - (effects.get(other) ?? 0));
        denominator += weight;
      });
      effects.set(parent, denominator > 0 ? numerator / denominator : 0);
    }
  }

  // Recenter parent effects to zero so the baseline remains the population-level
  // mating residual and effects represent relative breeder contribution.
  if (parentIds.length > 0) {
    const meanEffect =
      parentIds.reduce((sum, parent) => sum + (effects.get(parent) ?? 0), 0) /
      parentIds.length;
    for (const parent of parentIds) {
      effects.set(parent, (effects.get(parent) ?? 0) - meanEffect);
    }
    baseline += 2 * meanEffect;
  }

  const effectValues = parentIds.map((parent) => effects.get(parent) ?? 0);
  const parentEffects = parentIds
    .map((parentCoreId): BreederParentEffect => {
      const rows = observations.filter(
        (row) => row.parentA === parentCoreId || row.parentB === parentCoreId,
      );
      const coParents = new Set(
        rows.map((row) =>
          row.parentA === parentCoreId ? row.parentB : row.parentA,
        ),
      );
      const lifts = rows.map((row) => row.lift);
      const adjustedBreederEffect = effects.get(parentCoreId) ?? 0;
      const effectPercentile = percentileRank(
        effectValues,
        adjustedBreederEffect,
      );
      const positiveLiftRate =
        lifts.length === 0
          ? 0
          : lifts.filter((lift) => lift > 0).length / lifts.length;
      const warnings: string[] = [];
      if (rows.length < policy.minimumTargetOffspring) {
        warnings.push(
          "Too few offspring to establish a repeatable breeder effect.",
        );
      }
      if (coParents.size < policy.minimumTargetCoParents) {
        warnings.push(
          "Co-parent diversity is insufficient to separate parent effect from pair-specific synergy.",
        );
      }

      let status: BreederParentEffect["status"] = "wait";
      if (
        rows.length >= policy.minimumTargetOffspring &&
        coParents.size >= policy.minimumTargetCoParents &&
        adjustedBreederEffect > 0 &&
        effectPercentile >= policy.targetEffectPercentile &&
        positiveLiftRate >= policy.minimumPositiveLiftRate
      ) {
        status = "target";
      } else if (
        adjustedBreederEffect > 0 &&
        effectPercentile >= policy.watchEffectPercentile
      ) {
        status = "watch";
      }

      return Object.freeze({
        parentCoreId,
        offspringCount: rows.length,
        distinctCoParentCount: coParents.size,
        rawMedianLift: lifts.length > 0 ? median(lifts) : 0,
        positiveLiftRate,
        adjustedBreederEffect,
        effectPercentile,
        status,
        warnings: Object.freeze(warnings),
      });
    })
    .sort(
      (left, right) =>
        right.effectPercentile - left.effectPercentile ||
        right.adjustedBreederEffect - left.adjustedBreederEffect ||
        right.offspringCount - left.offspringCount ||
        left.parentCoreId.localeCompare(right.parentCoreId),
    );

  const pairGroups = new Map<string, typeof observations>();
  for (const observation of observations) {
    const key = `${observation.parentA}|${observation.parentB}`;
    const rows = pairGroups.get(key) ?? [];
    rows.push(observation);
    pairGroups.set(key, rows);
  }
  const pairSynergies = [...pairGroups.entries()]
    .map(([key, rows]): BreederPairSynergy => {
      const [parentACoreId, parentBCoreId] = key.split("|");
      const residuals = rows.map(
        (row) =>
          row.lift -
          baseline -
          (effects.get(row.parentA) ?? 0) -
          (effects.get(row.parentB) ?? 0),
      );
      const rawMedianResidualAfterParentEffects = median(residuals);
      const adjustedPairSynergy =
        rawMedianResidualAfterParentEffects *
        (rows.length / (rows.length + policy.pairPriorStrength));
      const positiveResidualRate =
        residuals.filter((residual) => residual > 0).length / residuals.length;
      return Object.freeze({
        parentACoreId: parentACoreId!,
        parentBCoreId: parentBCoreId!,
        offspringCount: rows.length,
        rawMedianResidualAfterParentEffects,
        adjustedPairSynergy,
        positiveResidualRate,
        status: rows.length >= 2 && adjustedPairSynergy > 0 ? "watch" : "wait",
      });
    })
    .sort(
      (left, right) =>
        right.adjustedPairSynergy - left.adjustedPairSynergy ||
        right.offspringCount - left.offspringCount ||
        left.parentACoreId.localeCompare(right.parentACoreId) ||
        left.parentBCoreId.localeCompare(right.parentBCoreId),
    );

  return Object.freeze({
    scope: input.scope,
    observationCount: observations.length,
    parentCount: parentIds.length,
    baselineLift: baseline,
    parentEffects: Object.freeze(parentEffects),
    pairSynergies: Object.freeze(pairSynergies),
    method: "robust_ridge_parent_effect_plus_shrunk_pair_residual",
  });
}
