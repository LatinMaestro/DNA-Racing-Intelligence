export type BreedingDistributionMode = "Bike" | "Car" | "Horse";
export type BreedingOutcomeBand =
  "weaker" | "comparable" | "stronger" | "exceptional";

export type OutcomeBandEstimate = Readonly<{
  probabilityBasisPoints: number;
  lowerBasisPoints: number;
  upperBasisPoints: number;
}>;

export type BreedingOutcomeDistributionInput = Readonly<{
  analysisId: string;
  pairId: string;
  parentCoreIds: readonly [string, string];
  mode: BreedingDistributionMode;
  exactDistanceM: number;
  modelVersion: string;
  predictionAsOf: string;
  expectedBreedingAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  freshness: "current" | "ageing" | "stale" | "unknown";
  calibrationStatus:
    "supported" | "not_supported" | "insufficient" | "not_evaluated";
  holdoutSampleCount: number;
  minimumHoldoutSampleCount: number;
  usesStarFeatures: boolean;
  starLiftStatus:
    "supported" | "not_supported" | "insufficient" | "not_evaluated";
  estimates: Readonly<Record<BreedingOutcomeBand, OutcomeBandEstimate>>;
}>;

export type BreedingOutcomeDistribution = Readonly<{
  analysisId: string;
  pairId: string;
  parentCoreIds: readonly [string, string];
  mode: BreedingDistributionMode;
  exactDistanceM: number;
  modelVersion: string;
  predictionAsOf: string;
  expectedBreedingAt: string;
  dataCurrentThrough: string;
  lastImported: string;
  distribution: readonly Readonly<{
    band: BreedingOutcomeBand;
    probabilityBasisPoints: number;
    lowerBasisPoints: number;
    upperBasisPoints: number;
  }>[];
  exceptionalTail: OutcomeBandEstimate;
  distributionStatus:
    | "experimental_supported"
    | "held_for_sample"
    | "held_for_calibration"
    | "held_for_freshness"
    | "held_for_star_lift";
  holdReasons: readonly string[];
  probabilitiesAreDeterministicInheritance: false;
  vaultSaturationAppliedToExceptionalTail: false;
  calibratedProbabilityClaimAllowed: false;
  rankingAllowed: false;
  recommendationAllowed: false;
  gateEPassed: false;
}>;

const modes: readonly BreedingDistributionMode[] = ["Bike", "Car", "Horse"];
const bands: readonly BreedingOutcomeBand[] = [
  "weaker",
  "comparable",
  "stronger",
  "exceptional",
];

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function basisPoints(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

export function buildBreedingOutcomeDistribution(
  input: BreedingOutcomeDistributionInput,
): BreedingOutcomeDistribution {
  const analysisId = required(input.analysisId, "Analysis ID");
  const pairId = required(input.pairId, "Pair ID");
  const parentCoreIds = input.parentCoreIds.map((value) =>
    required(value, "Parent core ID"),
  ) as [string, string];
  if (parentCoreIds[0] === parentCoreIds[1]) {
    throw new Error("Outcome analysis requires two distinct parents.");
  }
  if (!modes.includes(input.mode)) throw new Error("Analysis mode is invalid.");
  if (
    !Number.isSafeInteger(input.exactDistanceM) ||
    input.exactDistanceM <= 0
  ) {
    throw new Error("Analysis distance must be a positive safe integer.");
  }
  const modelVersion = required(input.modelVersion, "Model version");
  const predictionAsOf = timestamp(input.predictionAsOf, "Prediction time");
  const expectedBreedingAt = timestamp(
    input.expectedBreedingAt,
    "Expected breeding time",
  );
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (Date.parse(lastImported) < Date.parse(dataCurrentThrough)) {
    throw new Error("Last imported cannot precede data current through.");
  }
  if (Date.parse(predictionAsOf) < Date.parse(lastImported)) {
    throw new Error("Prediction time cannot precede the imported evidence.");
  }
  if (Date.parse(expectedBreedingAt) < Date.parse(predictionAsOf)) {
    throw new Error("Expected breeding cannot predate the prediction.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Distribution freshness is invalid.");
  }
  if (
    !["supported", "not_supported", "insufficient", "not_evaluated"].includes(
      input.calibrationStatus,
    )
  ) {
    throw new Error("Calibration status is invalid.");
  }
  if (
    !["supported", "not_supported", "insufficient", "not_evaluated"].includes(
      input.starLiftStatus,
    )
  ) {
    throw new Error("Star-lift status is invalid.");
  }
  if (
    !Number.isSafeInteger(input.holdoutSampleCount) ||
    input.holdoutSampleCount < 0
  ) {
    throw new Error(
      "Holdout sample count must be a non-negative safe integer.",
    );
  }
  if (
    !Number.isSafeInteger(input.minimumHoldoutSampleCount) ||
    input.minimumHoldoutSampleCount <= 0
  ) {
    throw new Error(
      "Minimum holdout sample count must be a positive safe integer.",
    );
  }

  let probabilityTotal = 0;
  const distribution = bands.map((band) => {
    const estimate = input.estimates[band];
    if (estimate === undefined) {
      throw new Error(`The ${band} outcome estimate is required.`);
    }
    basisPoints(estimate.probabilityBasisPoints, `${band} probability`);
    basisPoints(estimate.lowerBasisPoints, `${band} lower interval`);
    basisPoints(estimate.upperBasisPoints, `${band} upper interval`);
    if (
      estimate.lowerBasisPoints > estimate.probabilityBasisPoints ||
      estimate.probabilityBasisPoints > estimate.upperBasisPoints
    ) {
      throw new Error(
        `The ${band} estimate must lie within its uncertainty interval.`,
      );
    }
    probabilityTotal += estimate.probabilityBasisPoints;
    return { band, ...estimate };
  });
  if (probabilityTotal !== 10_000) {
    throw new Error(
      "Outcome probabilities must total exactly 10000 basis points.",
    );
  }

  const holdReasons: string[] = [];
  if (input.freshness === "stale" || input.freshness === "unknown") {
    holdReasons.push("Historical evidence is not current enough for display.");
  }
  if (input.holdoutSampleCount < input.minimumHoldoutSampleCount) {
    holdReasons.push(
      "Chronological holdout sample is below the configured minimum.",
    );
  }
  if (input.calibrationStatus !== "supported") {
    holdReasons.push("Probability calibration is not supported.");
  }
  if (input.usesStarFeatures && input.starLiftStatus !== "supported") {
    holdReasons.push("Star features lack supported incremental holdout lift.");
  }

  let distributionStatus: BreedingOutcomeDistribution["distributionStatus"] =
    "experimental_supported";
  if (input.freshness === "stale" || input.freshness === "unknown") {
    distributionStatus = "held_for_freshness";
  } else if (input.holdoutSampleCount < input.minimumHoldoutSampleCount) {
    distributionStatus = "held_for_sample";
  } else if (input.calibrationStatus !== "supported") {
    distributionStatus = "held_for_calibration";
  } else if (input.usesStarFeatures && input.starLiftStatus !== "supported") {
    distributionStatus = "held_for_star_lift";
  }

  return {
    analysisId,
    pairId,
    parentCoreIds,
    mode: input.mode,
    exactDistanceM: input.exactDistanceM,
    modelVersion,
    predictionAsOf,
    expectedBreedingAt,
    dataCurrentThrough,
    lastImported,
    distribution,
    exceptionalTail: input.estimates.exceptional,
    distributionStatus,
    holdReasons,
    probabilitiesAreDeterministicInheritance: false,
    vaultSaturationAppliedToExceptionalTail: false,
    calibratedProbabilityClaimAllowed: false,
    rankingAllowed: false,
    recommendationAllowed: false,
    gateEPassed: false,
  };
}
