export type BreedingLiftMode = "Bike" | "Car" | "Horse";

export type BreedingLiftPrediction = Readonly<{
  predictionId: string;
  breedingId: string;
  outcomeId: string;
  breedingAt: string;
  predictionCreatedAt: string;
  featureCutoff: string;
  outcomeAt: string;
  mode: BreedingLiftMode;
  exactDistanceM: number;
  exceptionalOutcome: boolean;
  timeOnlyProbabilityBasisPoints: number;
  lineageProbabilityBasisPoints: number;
  timeAndStarProbabilityBasisPoints: number;
  starFeatureStatus: "complete" | "partial" | "missing" | "invalid";
}>;

export type BreedingLiftEvaluationInput = Readonly<{
  holdoutStartsAt: string;
  minimumHoldoutRowsPerCell: number;
  minimumBrierImprovementMillionths: number;
  predictions: readonly BreedingLiftPrediction[];
}>;

export type BreedingLiftExclusionReason =
  "TRAINING_PARTITION" | "STAR_FEATURES_INCOMPLETE";

type ModelMetrics = Readonly<{
  brierScoreMillionths: number;
  meanPredictedRateBasisPoints: number;
  observedRateBasisPoints: number;
  calibrationErrorBasisPoints: number;
}>;

export type BreedingLiftCellResult = Readonly<{
  mode: BreedingLiftMode;
  exactDistanceM: number;
  holdoutRowCount: number;
  timeOnly: ModelMetrics;
  lineage: ModelMetrics;
  timeAndStar: ModelMetrics;
  brierImprovementVsTimeOnlyMillionths: number;
  brierImprovementVsLineageMillionths: number;
  candidateLiftStatus: "supported" | "not_supported" | "insufficient_sample";
}>;

export type BreedingLiftEvaluation = Readonly<{
  holdoutStartsAt: string;
  includedHoldoutRows: number;
  excludedRows: readonly Readonly<{
    predictionId: string;
    reasons: readonly BreedingLiftExclusionReason[];
  }>[];
  cells: readonly BreedingLiftCellResult[];
  allModelsEvaluatedOnIdenticalRows: true;
  starFeaturesDescribedAsInherited: false;
  predictiveLiftEstablished: false;
  gateEReviewCandidate: boolean;
  gateEPassed: false;
  recommendationAllowed: false;
}>;

const modes: readonly BreedingLiftMode[] = ["Bike", "Car", "Horse"];

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

function probability(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0 || value > 10_000) {
    throw new Error(`${label} must be an integer from 0 to 10000.`);
  }
}

function divideRounded(numerator: bigint, denominator: bigint): number {
  if (denominator <= 0n)
    throw new Error("Metric denominator must be positive.");
  return Number((numerator + denominator / 2n) / denominator);
}

function metrics(
  rows: readonly BreedingLiftPrediction[],
  probabilityFor: (row: BreedingLiftPrediction) => number,
): ModelMetrics {
  let squaredError = 0n;
  let predictedTotal = 0n;
  let observedTotal = 0n;
  for (const row of rows) {
    const predicted = BigInt(probabilityFor(row));
    const observed = row.exceptionalOutcome ? 10_000n : 0n;
    const error = predicted - observed;
    squaredError += error * error;
    predictedTotal += predicted;
    observedTotal += observed;
  }
  const count = BigInt(rows.length);
  const brierScoreMillionths = divideRounded(
    squaredError * 1_000_000n,
    count * 100_000_000n,
  );
  const meanPredictedRateBasisPoints = divideRounded(predictedTotal, count);
  const observedRateBasisPoints = divideRounded(observedTotal, count);
  return {
    brierScoreMillionths,
    meanPredictedRateBasisPoints,
    observedRateBasisPoints,
    calibrationErrorBasisPoints: Math.abs(
      meanPredictedRateBasisPoints - observedRateBasisPoints,
    ),
  };
}

function compareCells(
  left: BreedingLiftCellResult,
  right: BreedingLiftCellResult,
): number {
  return (
    modes.indexOf(left.mode) - modes.indexOf(right.mode) ||
    left.exactDistanceM - right.exactDistanceM
  );
}

export function evaluateBreedingPredictiveLift(
  input: BreedingLiftEvaluationInput,
): BreedingLiftEvaluation {
  const holdoutStartsAt = timestamp(
    input.holdoutStartsAt,
    "Holdout start time",
  );
  if (
    !Number.isSafeInteger(input.minimumHoldoutRowsPerCell) ||
    input.minimumHoldoutRowsPerCell <= 0
  ) {
    throw new Error("Minimum holdout rows must be a positive safe integer.");
  }
  if (
    !Number.isSafeInteger(input.minimumBrierImprovementMillionths) ||
    input.minimumBrierImprovementMillionths < 0
  ) {
    throw new Error(
      "Minimum Brier improvement must be a non-negative safe integer.",
    );
  }

  const predictionIds = new Set<string>();
  const outcomeIds = new Set<string>();
  const normalized: BreedingLiftPrediction[] = [];
  for (const raw of input.predictions) {
    const predictionId = required(raw.predictionId, "Prediction ID");
    const breedingId = required(raw.breedingId, "Breeding ID");
    const outcomeId = required(raw.outcomeId, "Outcome ID");
    if (predictionIds.has(predictionId)) {
      throw new Error("Prediction IDs must be unique.");
    }
    if (outcomeIds.has(outcomeId)) {
      throw new Error("Authoritative outcome IDs must be unique.");
    }
    predictionIds.add(predictionId);
    outcomeIds.add(outcomeId);
    if (!modes.includes(raw.mode))
      throw new Error("Prediction mode is invalid.");
    if (!Number.isSafeInteger(raw.exactDistanceM) || raw.exactDistanceM <= 0) {
      throw new Error("Prediction distance must be a positive safe integer.");
    }
    const breedingAt = timestamp(raw.breedingAt, "Breeding time");
    const predictionCreatedAt = timestamp(
      raw.predictionCreatedAt,
      "Prediction creation time",
    );
    const featureCutoff = timestamp(raw.featureCutoff, "Feature cutoff");
    const outcomeAt = timestamp(raw.outcomeAt, "Outcome time");
    if (Date.parse(featureCutoff) >= Date.parse(breedingAt)) {
      throw new Error("Feature cutoff must predate breeding.");
    }
    if (Date.parse(predictionCreatedAt) < Date.parse(featureCutoff)) {
      throw new Error("Prediction creation cannot predate its feature cutoff.");
    }
    if (Date.parse(predictionCreatedAt) > Date.parse(breedingAt)) {
      throw new Error("Predictions must be created no later than breeding.");
    }
    if (Date.parse(outcomeAt) <= Date.parse(breedingAt)) {
      throw new Error("Outcome time must follow breeding.");
    }
    for (const [value, label] of [
      [raw.timeOnlyProbabilityBasisPoints, "Time-only probability"],
      [raw.lineageProbabilityBasisPoints, "Lineage probability"],
      [raw.timeAndStarProbabilityBasisPoints, "Time-and-star probability"],
    ] as const) {
      probability(value, label);
    }
    if (
      !["complete", "partial", "missing", "invalid"].includes(
        raw.starFeatureStatus,
      )
    ) {
      throw new Error("Star-feature status is invalid.");
    }
    normalized.push({
      ...raw,
      predictionId,
      breedingId,
      outcomeId,
      breedingAt,
      predictionCreatedAt,
      featureCutoff,
      outcomeAt,
    });
  }

  const excludedRows: BreedingLiftEvaluation["excludedRows"][number][] = [];
  const included: BreedingLiftPrediction[] = [];
  for (const row of normalized) {
    const reasons = new Set<BreedingLiftExclusionReason>();
    if (Date.parse(row.breedingAt) < Date.parse(holdoutStartsAt)) {
      reasons.add("TRAINING_PARTITION");
    }
    if (row.starFeatureStatus !== "complete") {
      reasons.add("STAR_FEATURES_INCOMPLETE");
    }
    if (reasons.size > 0) {
      excludedRows.push({
        predictionId: row.predictionId,
        reasons: [...reasons],
      });
    } else {
      included.push(row);
    }
  }

  const grouped = new Map<string, BreedingLiftPrediction[]>();
  for (const row of included) {
    const key = `${row.mode}:${row.exactDistanceM}`;
    const rows = grouped.get(key) ?? [];
    rows.push(row);
    grouped.set(key, rows);
  }

  const cells = [...grouped.values()]
    .map((rows): BreedingLiftCellResult => {
      const first = rows[0];
      if (first === undefined) throw new Error("Lift cell cannot be empty.");
      const timeOnly = metrics(
        rows,
        (row) => row.timeOnlyProbabilityBasisPoints,
      );
      const lineage = metrics(rows, (row) => row.lineageProbabilityBasisPoints);
      const timeAndStar = metrics(
        rows,
        (row) => row.timeAndStarProbabilityBasisPoints,
      );
      const brierImprovementVsTimeOnlyMillionths =
        timeOnly.brierScoreMillionths - timeAndStar.brierScoreMillionths;
      const brierImprovementVsLineageMillionths =
        lineage.brierScoreMillionths - timeAndStar.brierScoreMillionths;
      const sufficient = rows.length >= input.minimumHoldoutRowsPerCell;
      const supported =
        sufficient &&
        brierImprovementVsTimeOnlyMillionths >=
          input.minimumBrierImprovementMillionths &&
        brierImprovementVsLineageMillionths >=
          input.minimumBrierImprovementMillionths;
      return {
        mode: first.mode,
        exactDistanceM: first.exactDistanceM,
        holdoutRowCount: rows.length,
        timeOnly,
        lineage,
        timeAndStar,
        brierImprovementVsTimeOnlyMillionths,
        brierImprovementVsLineageMillionths,
        candidateLiftStatus: !sufficient
          ? "insufficient_sample"
          : supported
            ? "supported"
            : "not_supported",
      };
    })
    .sort(compareCells);

  return {
    holdoutStartsAt,
    includedHoldoutRows: included.length,
    excludedRows,
    cells,
    allModelsEvaluatedOnIdenticalRows: true,
    starFeaturesDescribedAsInherited: false,
    predictiveLiftEstablished: false,
    gateEReviewCandidate:
      cells.length > 0 &&
      cells.every(
        ({ candidateLiftStatus }) => candidateLiftStatus === "supported",
      ),
    gateEPassed: false,
    recommendationAllowed: false,
  };
}
