export type CalibrationEvidenceSource =
  "historical_holdout" | "synthetic_fixture";

export type CalibrationPrediction = Readonly<{
  caseId: string;
  modelRole: "candidate" | "baseline";
  predictedProbabilityBasisPoints: number;
  outcome: 0 | 1;
  predictedAt: string;
  outcomeObservedAt: string;
  evidenceSource: CalibrationEvidenceSource;
}>;

export type CalibrationBin = Readonly<{
  lowerBasisPoints: number;
  upperBasisPoints: number;
  caseCount: number;
  meanPredictedBasisPoints: number;
  observedRateBasisPoints: number;
  absoluteCalibrationErrorBasisPoints: number;
}>;

export type ModelCalibration = Readonly<{
  caseCount: number;
  brierScoreBasisPoints: number;
  expectedCalibrationErrorBasisPoints: number;
  bins: readonly CalibrationBin[];
}>;

export type PredictionCalibrationInput = Readonly<{
  reportId: string;
  candidateModelId: string;
  baselineModelId: string;
  evaluatedAt: string;
  minimumRealHoldoutCases: number;
  predictions: readonly CalibrationPrediction[];
}>;

export type PredictionCalibrationResult = Readonly<{
  reportId: string;
  candidateModelId: string;
  baselineModelId: string;
  evaluatedAt: string;
  pairedCaseCount: number;
  realHistoricalCaseCount: number;
  syntheticCaseCount: number;
  candidate: ModelCalibration;
  baseline: ModelCalibration;
  candidateBrierImprovementBasisPoints: number;
  liftStatus: "candidate_better" | "candidate_tied" | "candidate_worse";
  evidenceStatus:
    "real_holdout_sufficient" | "real_holdout_insufficient" | "synthetic_only";
  gateCDecision: "requires_gate_review";
  gateCSelfAcceptanceAllowed: false;
  warnings: readonly string[];
}>;

const BIN_WIDTH = 2_000;
const BASIS_POINTS = 10_000;

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

function nonNegativeSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function roundedDivide(numerator: number, denominator: number): number {
  if (denominator <= 0)
    throw new Error("Division denominator must be positive.");
  return Math.round(numerator / denominator);
}

function calibrate(
  predictions: readonly CalibrationPrediction[],
): ModelCalibration {
  const squaredErrors = predictions.map((prediction) => {
    const target = prediction.outcome * BASIS_POINTS;
    const error = prediction.predictedProbabilityBasisPoints - target;
    return error * error;
  });
  const brierScoreBasisPoints = roundedDivide(
    squaredErrors.reduce((sum, value) => sum + value, 0),
    predictions.length * BASIS_POINTS,
  );

  const bins: CalibrationBin[] = [];
  let weightedCalibrationError = 0;
  for (let lower = 0; lower < BASIS_POINTS; lower += BIN_WIDTH) {
    const upper = lower + BIN_WIDTH - 1;
    const binPredictions = predictions.filter((prediction) => {
      const probability = prediction.predictedProbabilityBasisPoints;
      return (
        probability >= lower &&
        (lower === BASIS_POINTS - BIN_WIDTH
          ? probability <= BASIS_POINTS
          : probability <= upper)
      );
    });
    if (binPredictions.length === 0) continue;

    const meanPredictedBasisPoints = roundedDivide(
      binPredictions.reduce(
        (sum, prediction) => sum + prediction.predictedProbabilityBasisPoints,
        0,
      ),
      binPredictions.length,
    );
    const observedRateBasisPoints = roundedDivide(
      binPredictions.reduce(
        (sum, prediction) => sum + prediction.outcome * BASIS_POINTS,
        0,
      ),
      binPredictions.length,
    );
    const absoluteCalibrationErrorBasisPoints = Math.abs(
      meanPredictedBasisPoints - observedRateBasisPoints,
    );
    weightedCalibrationError +=
      absoluteCalibrationErrorBasisPoints * binPredictions.length;
    bins.push({
      lowerBasisPoints: lower,
      upperBasisPoints:
        lower === BASIS_POINTS - BIN_WIDTH ? BASIS_POINTS : upper,
      caseCount: binPredictions.length,
      meanPredictedBasisPoints,
      observedRateBasisPoints,
      absoluteCalibrationErrorBasisPoints,
    });
  }

  return {
    caseCount: predictions.length,
    brierScoreBasisPoints,
    expectedCalibrationErrorBasisPoints: roundedDivide(
      weightedCalibrationError,
      predictions.length,
    ),
    bins,
  };
}

export function evaluatePredictionCalibration(
  input: PredictionCalibrationInput,
): PredictionCalibrationResult {
  const reportId = required(input.reportId, "Report ID");
  const candidateModelId = required(
    input.candidateModelId,
    "Candidate model ID",
  );
  const baselineModelId = required(input.baselineModelId, "Baseline model ID");
  if (candidateModelId === baselineModelId) {
    throw new Error("Candidate and baseline model IDs must differ.");
  }
  const evaluatedAt = timestamp(input.evaluatedAt, "Evaluation time");
  if (
    !Number.isSafeInteger(input.minimumRealHoldoutCases) ||
    input.minimumRealHoldoutCases <= 0
  ) {
    throw new Error(
      "Minimum real holdout cases must be a positive safe integer.",
    );
  }
  if (input.predictions.length === 0) {
    throw new Error("Calibration requires paired holdout predictions.");
  }

  const byCase = new Map<
    string,
    Partial<Record<CalibrationPrediction["modelRole"], CalibrationPrediction>>
  >();
  for (const prediction of input.predictions) {
    const caseId = required(prediction.caseId, "Case ID");
    if (!["candidate", "baseline"].includes(prediction.modelRole)) {
      throw new Error("Model role is invalid.");
    }
    const probability = nonNegativeSafeInteger(
      prediction.predictedProbabilityBasisPoints,
      "Predicted probability",
    );
    if (probability > BASIS_POINTS) {
      throw new Error(
        "Predicted probability cannot exceed 10,000 basis points.",
      );
    }
    if (prediction.outcome !== 0 && prediction.outcome !== 1) {
      throw new Error("Outcome must be binary.");
    }
    if (
      !["historical_holdout", "synthetic_fixture"].includes(
        prediction.evidenceSource,
      )
    ) {
      throw new Error("Evidence source is invalid.");
    }
    const predictedAt = timestamp(prediction.predictedAt, "Prediction time");
    const outcomeObservedAt = timestamp(
      prediction.outcomeObservedAt,
      "Outcome observation time",
    );
    if (Date.parse(predictedAt) >= Date.parse(outcomeObservedAt)) {
      throw new Error("Prediction must predate its outcome.");
    }
    if (Date.parse(outcomeObservedAt) > Date.parse(evaluatedAt)) {
      throw new Error("Outcome cannot postdate calibration evaluation.");
    }

    const pair = byCase.get(caseId) ?? {};
    if (pair[prediction.modelRole] !== undefined) {
      throw new Error("Each case must have one prediction per model role.");
    }
    pair[prediction.modelRole] = {
      ...prediction,
      caseId,
      predictedProbabilityBasisPoints: probability,
      predictedAt,
      outcomeObservedAt,
    };
    byCase.set(caseId, pair);
  }

  const candidatePredictions: CalibrationPrediction[] = [];
  const baselinePredictions: CalibrationPrediction[] = [];
  for (const pair of byCase.values()) {
    if (pair.candidate === undefined || pair.baseline === undefined) {
      throw new Error(
        "Candidate and baseline must predict the identical holdout cases.",
      );
    }
    if (
      pair.candidate.outcome !== pair.baseline.outcome ||
      pair.candidate.outcomeObservedAt !== pair.baseline.outcomeObservedAt ||
      pair.candidate.evidenceSource !== pair.baseline.evidenceSource
    ) {
      throw new Error(
        "Paired holdout outcomes and evidence source must match.",
      );
    }
    candidatePredictions.push(pair.candidate);
    baselinePredictions.push(pair.baseline);
  }
  candidatePredictions.sort((left, right) =>
    left.caseId.localeCompare(right.caseId),
  );
  baselinePredictions.sort((left, right) =>
    left.caseId.localeCompare(right.caseId),
  );

  const candidate = calibrate(candidatePredictions);
  const baseline = calibrate(baselinePredictions);
  const candidateBrierImprovementBasisPoints =
    baseline.brierScoreBasisPoints - candidate.brierScoreBasisPoints;
  const realHistoricalCaseCount = candidatePredictions.filter(
    (prediction) => prediction.evidenceSource === "historical_holdout",
  ).length;
  const syntheticCaseCount =
    candidatePredictions.length - realHistoricalCaseCount;
  const evidenceStatus =
    realHistoricalCaseCount === 0
      ? "synthetic_only"
      : realHistoricalCaseCount < input.minimumRealHoldoutCases
        ? "real_holdout_insufficient"
        : "real_holdout_sufficient";
  const warnings: string[] = [];
  if (syntheticCaseCount > 0) {
    warnings.push(
      "Synthetic cases verify arithmetic only and cannot establish analytical performance.",
    );
  }
  if (realHistoricalCaseCount < input.minimumRealHoldoutCases) {
    warnings.push(
      "Real chronological holdout coverage is below the declared minimum.",
    );
  }

  return {
    reportId,
    candidateModelId,
    baselineModelId,
    evaluatedAt,
    pairedCaseCount: candidatePredictions.length,
    realHistoricalCaseCount,
    syntheticCaseCount,
    candidate,
    baseline,
    candidateBrierImprovementBasisPoints,
    liftStatus:
      candidateBrierImprovementBasisPoints > 0
        ? "candidate_better"
        : candidateBrierImprovementBasisPoints < 0
          ? "candidate_worse"
          : "candidate_tied",
    evidenceStatus,
    gateCDecision: "requires_gate_review",
    gateCSelfAcceptanceAllowed: false,
    warnings,
  };
}
