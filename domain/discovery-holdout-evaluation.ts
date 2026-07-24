export const holdoutModes = ["bike", "car", "horse"] as const;
export type HoldoutMode = (typeof holdoutModes)[number];

export type DiscoveryHoldoutPrediction = Readonly<{
  predictionId: string;
  eventId: string;
  coreId: string;
  mode: HoldoutMode;
  distanceMetres: number;
  eventAt: string;
  featureCutoffAt: string;
  competitiveTimeOutcome: boolean;
  timeAndStarProbability: number;
  timeOnlyBaselineProbability: number;
  starFeatureStatus: "complete" | "partial" | "unavailable";
}>;

export type DiscoveryHoldoutConfiguration = Readonly<{
  trainingDataThrough: string;
  holdoutStartsAt: string;
  holdoutEndsAt: string;
  minimumPredictions: number;
  minimumLift: number;
  maximumCalibrationGap: number;
  modelVersion: string;
  baselineVersion: string;
}>;

export type DiscoveryHoldoutSummary = Readonly<{
  mode: HoldoutMode | "all";
  distanceMetres: number | null;
  predictionCount: number;
  positiveOutcomeCount: number;
  completeStarFeatureCount: number;
  timeAndStarBrierScore: number;
  timeOnlyBaselineBrierScore: number;
  brierLift: number;
  meanPredictedProbability: number;
  observedPositiveRate: number;
  calibrationGap: number;
  evidenceStatus:
    | "insufficient_sample"
    | "candidate_better_than_baseline"
    | "candidate_not_better_than_baseline"
    | "mixed_requires_review";
}>;

export type DiscoveryHoldoutReport = Readonly<{
  trainingDataThrough: string;
  holdoutStartsAt: string;
  holdoutEndsAt: string;
  modelVersion: string;
  baselineVersion: string;
  overall: DiscoveryHoldoutSummary;
  exactCells: readonly DiscoveryHoldoutSummary[];
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "SYNTHETIC_EVIDENCE_NON_DISPOSITIVE"
    | "PARTIAL_STAR_FEATURE_COVERAGE"
    | "INSUFFICIENT_HOLDOUT_SAMPLE"
    | "NO_INCREMENTAL_LIFT"
    | "CALIBRATION_REVIEW_REQUIRED"
  )[];
  gateCStatus: "evidence_only";
  gateCPassed: false;
  actionableRecommendationsAllowed: false;
}>;

type NormalizedPrediction = Omit<
  DiscoveryHoldoutPrediction,
  "predictionId" | "eventId" | "coreId" | "eventAt" | "featureCutoffAt"
> & {
  predictionId: string;
  eventId: string;
  coreId: string;
  eventAt: string;
  featureCutoffAt: string;
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string, label: string): string {
  const normalized = required(value, label);
  const parsed = Date.parse(normalized);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function probability(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between zero and one.`);
  }
  return value;
}

function round(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function normalizePrediction(
  input: DiscoveryHoldoutPrediction,
  holdoutStartMs: number,
  holdoutEndMs: number,
): NormalizedPrediction {
  const predictionId = required(input.predictionId, "Prediction ID");
  const eventId = required(input.eventId, "Event ID");
  const coreId = required(input.coreId, "Core ID");
  if (!holdoutModes.includes(input.mode)) {
    throw new Error("Holdout mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error("Holdout distance must be positive integer metres.");
  }
  if (typeof input.competitiveTimeOutcome !== "boolean") {
    throw new Error("Competitive-time outcome must be Boolean.");
  }
  if (
    !["complete", "partial", "unavailable"].includes(input.starFeatureStatus)
  ) {
    throw new Error("Star feature status is invalid.");
  }
  const eventAt = timestamp(input.eventAt, "Holdout event time");
  const featureCutoffAt = timestamp(
    input.featureCutoffAt,
    "Feature cutoff time",
  );
  const eventMs = Date.parse(eventAt);
  if (eventMs < holdoutStartMs || eventMs >= holdoutEndMs) {
    throw new Error("Prediction event must fall inside the holdout window.");
  }
  if (Date.parse(featureCutoffAt) >= eventMs) {
    throw new Error("Feature cutoff must be strictly earlier than the event.");
  }
  return {
    ...input,
    predictionId,
    eventId,
    coreId,
    eventAt,
    featureCutoffAt,
    timeAndStarProbability: probability(
      input.timeAndStarProbability,
      "Time-and-star probability",
    ),
    timeOnlyBaselineProbability: probability(
      input.timeOnlyBaselineProbability,
      "Time-only baseline probability",
    ),
  };
}

function summarize(
  predictions: readonly NormalizedPrediction[],
  minimumPredictions: number,
  minimumLift: number,
  maximumCalibrationGap: number,
  mode: HoldoutMode | "all",
  distanceMetres: number | null,
): DiscoveryHoldoutSummary {
  const count = predictions.length;
  const positives = predictions.filter(
    ({ competitiveTimeOutcome }) => competitiveTimeOutcome,
  ).length;
  const candidateBrier =
    count === 0
      ? 0
      : predictions.reduce((total, prediction) => {
          const outcome = prediction.competitiveTimeOutcome ? 1 : 0;
          return total + (prediction.timeAndStarProbability - outcome) ** 2;
        }, 0) / count;
  const baselineBrier =
    count === 0
      ? 0
      : predictions.reduce((total, prediction) => {
          const outcome = prediction.competitiveTimeOutcome ? 1 : 0;
          return (
            total + (prediction.timeOnlyBaselineProbability - outcome) ** 2
          );
        }, 0) / count;
  const meanProbability =
    count === 0
      ? 0
      : predictions.reduce(
          (total, { timeAndStarProbability }) => total + timeAndStarProbability,
          0,
        ) / count;
  const observedRate = count === 0 ? 0 : positives / count;
  const lift = baselineBrier - candidateBrier;
  const calibrationGap = Math.abs(meanProbability - observedRate);

  let evidenceStatus: DiscoveryHoldoutSummary["evidenceStatus"];
  if (count < minimumPredictions) {
    evidenceStatus = "insufficient_sample";
  } else if (lift < minimumLift) {
    evidenceStatus = "candidate_not_better_than_baseline";
  } else if (calibrationGap > maximumCalibrationGap) {
    evidenceStatus = "mixed_requires_review";
  } else {
    evidenceStatus = "candidate_better_than_baseline";
  }

  return {
    mode,
    distanceMetres,
    predictionCount: count,
    positiveOutcomeCount: positives,
    completeStarFeatureCount: predictions.filter(
      ({ starFeatureStatus }) => starFeatureStatus === "complete",
    ).length,
    timeAndStarBrierScore: round(candidateBrier),
    timeOnlyBaselineBrierScore: round(baselineBrier),
    brierLift: round(lift),
    meanPredictedProbability: round(meanProbability),
    observedPositiveRate: round(observedRate),
    calibrationGap: round(calibrationGap),
    evidenceStatus,
  };
}

export function evaluateDiscoveryChronologicalHoldout(
  inputs: readonly DiscoveryHoldoutPrediction[],
  configuration: DiscoveryHoldoutConfiguration,
): DiscoveryHoldoutReport {
  const trainingDataThrough = timestamp(
    configuration.trainingDataThrough,
    "Training data through",
  );
  const holdoutStartsAt = timestamp(
    configuration.holdoutStartsAt,
    "Holdout start",
  );
  const holdoutEndsAt = timestamp(configuration.holdoutEndsAt, "Holdout end");
  if (
    Date.parse(trainingDataThrough) >= Date.parse(holdoutStartsAt) ||
    Date.parse(holdoutStartsAt) >= Date.parse(holdoutEndsAt)
  ) {
    throw new Error(
      "Training cutoff, holdout start and holdout end must be strictly ordered.",
    );
  }
  if (
    !Number.isSafeInteger(configuration.minimumPredictions) ||
    configuration.minimumPredictions < 2
  ) {
    throw new Error("Minimum holdout predictions must be at least two.");
  }
  const minimumLift = probability(configuration.minimumLift, "Minimum lift");
  const maximumCalibrationGap = probability(
    configuration.maximumCalibrationGap,
    "Maximum calibration gap",
  );
  const modelVersion = required(configuration.modelVersion, "Model version");
  const baselineVersion = required(
    configuration.baselineVersion,
    "Baseline version",
  );
  if (modelVersion === baselineVersion) {
    throw new Error("Model and baseline versions must be distinct.");
  }

  const predictions = inputs.map((input) =>
    normalizePrediction(
      input,
      Date.parse(holdoutStartsAt),
      Date.parse(holdoutEndsAt),
    ),
  );
  const ids = predictions.map(({ predictionId }) => predictionId);
  if (new Set(ids).size !== ids.length) {
    throw new Error("Holdout prediction IDs must be unique.");
  }
  const eventKeys = predictions.map((prediction) =>
    JSON.stringify([prediction.eventId, prediction.coreId]),
  );
  if (new Set(eventKeys).size !== eventKeys.length) {
    throw new Error(
      "Holdout observations must be unique by authoritative event and core.",
    );
  }

  const overall = summarize(
    predictions,
    configuration.minimumPredictions,
    minimumLift,
    maximumCalibrationGap,
    "all",
    null,
  );
  const groups = new Map<string, NormalizedPrediction[]>();
  for (const prediction of predictions) {
    const key = JSON.stringify([prediction.mode, prediction.distanceMetres]);
    const group = groups.get(key) ?? [];
    group.push(prediction);
    groups.set(key, group);
  }
  const exactCells = [...groups.values()]
    .map((group) =>
      summarize(
        group,
        configuration.minimumPredictions,
        minimumLift,
        maximumCalibrationGap,
        group[0]!.mode,
        group[0]!.distanceMetres,
      ),
    )
    .sort(
      (left, right) =>
        holdoutModes.indexOf(left.mode as HoldoutMode) -
          holdoutModes.indexOf(right.mode as HoldoutMode) ||
        left.distanceMetres! - right.distanceMetres!,
    );

  const warnings = new Set<DiscoveryHoldoutReport["warnings"][number]>([
    "GATE_C_NOT_PASSED",
    "SYNTHETIC_EVIDENCE_NON_DISPOSITIVE",
  ]);
  if (
    predictions.some(
      ({ starFeatureStatus }) => starFeatureStatus !== "complete",
    )
  ) {
    warnings.add("PARTIAL_STAR_FEATURE_COVERAGE");
  }
  if (overall.evidenceStatus === "insufficient_sample") {
    warnings.add("INSUFFICIENT_HOLDOUT_SAMPLE");
  }
  if (overall.brierLift < minimumLift) warnings.add("NO_INCREMENTAL_LIFT");
  if (overall.calibrationGap > maximumCalibrationGap) {
    warnings.add("CALIBRATION_REVIEW_REQUIRED");
  }

  return {
    trainingDataThrough,
    holdoutStartsAt,
    holdoutEndsAt,
    modelVersion,
    baselineVersion,
    overall,
    exactCells,
    warnings: [...warnings].sort(),
    gateCStatus: "evidence_only",
    gateCPassed: false,
    actionableRecommendationsAllowed: false,
  };
}
