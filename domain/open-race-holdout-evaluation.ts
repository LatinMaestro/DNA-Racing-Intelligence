export const openRaceHoldoutModes = ["bike", "car", "horse"] as const;
export type OpenRaceHoldoutMode = (typeof openRaceHoldoutModes)[number];

export type OpenRaceHoldoutCase = Readonly<{
  caseId: string;
  eventId: string;
  mode: OpenRaceHoldoutMode;
  distanceMeters: number;
  featureCutoffAt: string;
  decisionAt: string;
  fieldLockedAt: string;
  outcomeAt: string;
  dataCurrentThrough: string;
  historicalFreshness: "current" | "ageing" | "stale" | "unknown";
  currentRaceStarsKnownAtDecision: false;
  eligibleCoreIds: readonly string[];
  modelSelectedCoreId: string;
  baselineSelectedCoreId: string;
  actualBestEligibleCoreIds: readonly string[];
  modelRealizedTimeMs: number | null;
  baselineRealizedTimeMs: number | null;
  bestEligibleTimeMs: number | null;
  modelCompetitiveOutcome: boolean | null;
  baselineCompetitiveOutcome: boolean | null;
  modelAvoidSignal: boolean | null;
  entryShouldHaveBeenAvoided: boolean | null;
  evidenceStatus: "complete" | "partial" | "invalid";
}>;

export type OpenRaceHoldoutConfiguration = Readonly<{
  holdoutStartsAt: string;
  holdoutEndsAt: string;
  minimumCompleteCases: number;
  minimumCompetitiveRateLift: number;
  minimumRegretImprovementMs: number;
  modelVersion: string;
  baselineVersion: string;
  evidenceSource: "synthetic" | "historical_holdout";
}>;

export type OpenRaceHoldoutSummary = Readonly<{
  mode: OpenRaceHoldoutMode | "all";
  distanceMeters: number | null;
  totalCaseCount: number;
  completeCaseCount: number;
  excludedCaseCount: number;
  modelCompetitiveCount: number;
  baselineCompetitiveCount: number;
  modelCompetitiveRate: number | null;
  baselineCompetitiveRate: number | null;
  competitiveRateLift: number | null;
  modelBestSelectionCount: number;
  baselineBestSelectionCount: number;
  modelMeanRegretMs: number | null;
  baselineMeanRegretMs: number | null;
  regretImprovementMs: number | null;
  evaluatedAvoidDecisionCount: number;
  correctAvoidDecisionCount: number;
  avoidDecisionAccuracy: number | null;
  evidenceStatus:
    | "insufficient_sample"
    | "model_better_than_baseline"
    | "baseline_not_worse"
    | "mixed_requires_review";
}>;

export type OpenRaceHoldoutReport = Readonly<{
  holdoutStartsAt: string;
  holdoutEndsAt: string;
  modelVersion: string;
  baselineVersion: string;
  evidenceSource: OpenRaceHoldoutConfiguration["evidenceSource"];
  overall: OpenRaceHoldoutSummary;
  exactCells: readonly OpenRaceHoldoutSummary[];
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "SYNTHETIC_EVIDENCE_NON_DISPOSITIVE"
    | "PARTIAL_OR_INVALID_CASES_EXCLUDED"
    | "STALE_HISTORICAL_EVIDENCE_PRESENT"
    | "INSUFFICIENT_COMPLETE_CASES"
    | "MODEL_NOT_CONSISTENTLY_BETTER"
  )[];
  gateCStatus: "evidence_only";
  gateCPassed: false;
  actionableRecommendationsAllowed: false;
}>;

type CompleteCase = OpenRaceHoldoutCase & {
  modelRealizedTimeMs: number;
  baselineRealizedTimeMs: number;
  bestEligibleTimeMs: number;
  modelCompetitiveOutcome: boolean;
  baselineCompetitiveOutcome: boolean;
  modelAvoidSignal: boolean;
  entryShouldHaveBeenAvoided: boolean;
  evidenceStatus: "complete";
};

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

function positiveSafeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
}

function rate(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 1) {
    throw new Error(`${label} must be between zero and one.`);
  }
  return value;
}

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateCase(
  input: OpenRaceHoldoutCase,
  holdoutStartMs: number,
  holdoutEndMs: number,
): OpenRaceHoldoutCase {
  const caseId = required(input.caseId, "Case ID");
  const eventId = required(input.eventId, "Event ID");
  if (!openRaceHoldoutModes.includes(input.mode)) {
    throw new Error(`Open Race holdout mode is invalid for ${caseId}.`);
  }
  positiveSafeInteger(input.distanceMeters, "Distance metres");
  if (
    !["current", "ageing", "stale", "unknown"].includes(
      input.historicalFreshness,
    )
  ) {
    throw new Error(`Historical freshness is invalid for ${caseId}.`);
  }
  if (input.currentRaceStarsKnownAtDecision !== false) {
    throw new Error(
      "Current-race stars must be unavailable at the pre-entry decision.",
    );
  }
  if (!["complete", "partial", "invalid"].includes(input.evidenceStatus)) {
    throw new Error(`Evidence status is invalid for ${caseId}.`);
  }

  const featureCutoffAt = timestamp(
    input.featureCutoffAt,
    "Feature cutoff time",
  );
  const decisionAt = timestamp(input.decisionAt, "Decision time");
  const fieldLockedAt = timestamp(input.fieldLockedAt, "Field lock time");
  const outcomeAt = timestamp(input.outcomeAt, "Outcome time");
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const decisionMs = Date.parse(decisionAt);
  if (decisionMs < holdoutStartMs || decisionMs >= holdoutEndMs) {
    throw new Error(`Decision for ${caseId} must fall in the holdout window.`);
  }
  if (
    Date.parse(featureCutoffAt) > decisionMs ||
    Date.parse(dataCurrentThrough) > decisionMs ||
    decisionMs >= Date.parse(fieldLockedAt) ||
    Date.parse(fieldLockedAt) >= Date.parse(outcomeAt)
  ) {
    throw new Error(
      `Feature, decision, lock and outcome times are invalid for ${caseId}.`,
    );
  }

  const eligibleCoreIds = input.eligibleCoreIds.map((coreId) =>
    required(coreId, "Eligible core ID"),
  );
  if (
    eligibleCoreIds.length === 0 ||
    new Set(eligibleCoreIds).size !== eligibleCoreIds.length
  ) {
    throw new Error(`Eligible core IDs must be non-empty and unique.`);
  }
  const modelSelectedCoreId = required(
    input.modelSelectedCoreId,
    "Model-selected core ID",
  );
  const baselineSelectedCoreId = required(
    input.baselineSelectedCoreId,
    "Baseline-selected core ID",
  );
  if (
    !eligibleCoreIds.includes(modelSelectedCoreId) ||
    !eligibleCoreIds.includes(baselineSelectedCoreId)
  ) {
    throw new Error(`Selected cores must be eligible in ${caseId}.`);
  }
  const actualBestEligibleCoreIds = input.actualBestEligibleCoreIds.map(
    (coreId) => required(coreId, "Best eligible core ID"),
  );
  if (
    actualBestEligibleCoreIds.length === 0 ||
    new Set(actualBestEligibleCoreIds).size !==
      actualBestEligibleCoreIds.length ||
    actualBestEligibleCoreIds.some(
      (coreId) => !eligibleCoreIds.includes(coreId),
    )
  ) {
    throw new Error(`Best eligible core IDs are invalid for ${caseId}.`);
  }

  const optionalTimes = [
    input.modelRealizedTimeMs,
    input.baselineRealizedTimeMs,
    input.bestEligibleTimeMs,
  ];
  for (const value of optionalTimes) {
    if (value !== null) positiveSafeInteger(value, "Realized time");
  }
  if (input.evidenceStatus === "complete") {
    if (
      input.modelRealizedTimeMs === null ||
      input.baselineRealizedTimeMs === null ||
      input.bestEligibleTimeMs === null ||
      input.modelCompetitiveOutcome === null ||
      input.baselineCompetitiveOutcome === null ||
      input.modelAvoidSignal === null ||
      input.entryShouldHaveBeenAvoided === null
    ) {
      throw new Error(`Complete evidence is missing outcomes for ${caseId}.`);
    }
    if (
      typeof input.modelCompetitiveOutcome !== "boolean" ||
      typeof input.baselineCompetitiveOutcome !== "boolean" ||
      typeof input.modelAvoidSignal !== "boolean" ||
      typeof input.entryShouldHaveBeenAvoided !== "boolean"
    ) {
      throw new Error(`Complete evidence outcomes must be Boolean.`);
    }
    if (
      input.bestEligibleTimeMs > input.modelRealizedTimeMs ||
      input.bestEligibleTimeMs > input.baselineRealizedTimeMs
    ) {
      throw new Error(`Best eligible time cannot exceed selected times.`);
    }
    if (
      actualBestEligibleCoreIds.includes(modelSelectedCoreId) !==
      (input.modelRealizedTimeMs === input.bestEligibleTimeMs)
    ) {
      throw new Error(`Model best-core identity and time disagree.`);
    }
    if (
      actualBestEligibleCoreIds.includes(baselineSelectedCoreId) !==
      (input.baselineRealizedTimeMs === input.bestEligibleTimeMs)
    ) {
      throw new Error(`Baseline best-core identity and time disagree.`);
    }
    if (
      modelSelectedCoreId === baselineSelectedCoreId &&
      (input.modelRealizedTimeMs !== input.baselineRealizedTimeMs ||
        input.modelCompetitiveOutcome !== input.baselineCompetitiveOutcome)
    ) {
      throw new Error(
        `The same selected core must carry identical realized evidence.`,
      );
    }
  }

  return {
    ...input,
    caseId,
    eventId,
    featureCutoffAt,
    decisionAt,
    fieldLockedAt,
    outcomeAt,
    dataCurrentThrough,
    eligibleCoreIds,
    modelSelectedCoreId,
    baselineSelectedCoreId,
    actualBestEligibleCoreIds,
  };
}

function summarize(
  values: readonly OpenRaceHoldoutCase[],
  minimumCompleteCases: number,
  minimumCompetitiveRateLift: number,
  minimumRegretImprovementMs: number,
  mode: OpenRaceHoldoutSummary["mode"],
  distanceMeters: number | null,
): OpenRaceHoldoutSummary {
  const complete = values.filter(
    (value): value is CompleteCase => value.evidenceStatus === "complete",
  );
  const count = complete.length;
  const modelCompetitiveCount = complete.filter(
    ({ modelCompetitiveOutcome }) => modelCompetitiveOutcome,
  ).length;
  const baselineCompetitiveCount = complete.filter(
    ({ baselineCompetitiveOutcome }) => baselineCompetitiveOutcome,
  ).length;
  const modelRate = count === 0 ? null : modelCompetitiveCount / count;
  const baselineRate = count === 0 ? null : baselineCompetitiveCount / count;
  const modelMeanRegret =
    count === 0
      ? null
      : complete.reduce(
          (total, value) =>
            total + (value.modelRealizedTimeMs - value.bestEligibleTimeMs),
          0,
        ) / count;
  const baselineMeanRegret =
    count === 0
      ? null
      : complete.reduce(
          (total, value) =>
            total + (value.baselineRealizedTimeMs - value.bestEligibleTimeMs),
          0,
        ) / count;
  const competitiveRateLift =
    modelRate === null || baselineRate === null
      ? null
      : modelRate - baselineRate;
  const regretImprovement =
    modelMeanRegret === null || baselineMeanRegret === null
      ? null
      : baselineMeanRegret - modelMeanRegret;
  const correctAvoid = complete.filter(
    ({ modelAvoidSignal, entryShouldHaveBeenAvoided }) =>
      modelAvoidSignal === entryShouldHaveBeenAvoided,
  ).length;

  let evidenceStatus: OpenRaceHoldoutSummary["evidenceStatus"];
  if (count < minimumCompleteCases) {
    evidenceStatus = "insufficient_sample";
  } else if (
    competitiveRateLift !== null &&
    regretImprovement !== null &&
    competitiveRateLift >= minimumCompetitiveRateLift &&
    regretImprovement >= minimumRegretImprovementMs
  ) {
    evidenceStatus = "model_better_than_baseline";
  } else if (
    competitiveRateLift !== null &&
    regretImprovement !== null &&
    competitiveRateLift <= 0 &&
    regretImprovement <= 0
  ) {
    evidenceStatus = "baseline_not_worse";
  } else {
    evidenceStatus = "mixed_requires_review";
  }

  return {
    mode,
    distanceMeters,
    totalCaseCount: values.length,
    completeCaseCount: count,
    excludedCaseCount: values.length - count,
    modelCompetitiveCount,
    baselineCompetitiveCount,
    modelCompetitiveRate: modelRate === null ? null : rounded(modelRate),
    baselineCompetitiveRate:
      baselineRate === null ? null : rounded(baselineRate),
    competitiveRateLift:
      competitiveRateLift === null ? null : rounded(competitiveRateLift),
    modelBestSelectionCount: complete.filter(
      ({ modelSelectedCoreId, actualBestEligibleCoreIds }) =>
        actualBestEligibleCoreIds.includes(modelSelectedCoreId),
    ).length,
    baselineBestSelectionCount: complete.filter(
      ({ baselineSelectedCoreId, actualBestEligibleCoreIds }) =>
        actualBestEligibleCoreIds.includes(baselineSelectedCoreId),
    ).length,
    modelMeanRegretMs:
      modelMeanRegret === null ? null : rounded(modelMeanRegret),
    baselineMeanRegretMs:
      baselineMeanRegret === null ? null : rounded(baselineMeanRegret),
    regretImprovementMs:
      regretImprovement === null ? null : rounded(regretImprovement),
    evaluatedAvoidDecisionCount: complete.length,
    correctAvoidDecisionCount: correctAvoid,
    avoidDecisionAccuracy:
      complete.length === 0 ? null : rounded(correctAvoid / complete.length),
    evidenceStatus,
  };
}

export function evaluateOpenRaceChronologicalHoldout(
  inputs: readonly OpenRaceHoldoutCase[],
  configuration: OpenRaceHoldoutConfiguration,
): OpenRaceHoldoutReport {
  const holdoutStartsAt = timestamp(
    configuration.holdoutStartsAt,
    "Holdout start",
  );
  const holdoutEndsAt = timestamp(configuration.holdoutEndsAt, "Holdout end");
  if (Date.parse(holdoutStartsAt) >= Date.parse(holdoutEndsAt)) {
    throw new Error("Open Race holdout window must be ordered.");
  }
  if (
    !Number.isSafeInteger(configuration.minimumCompleteCases) ||
    configuration.minimumCompleteCases < 2
  ) {
    throw new Error("Minimum complete cases must be at least two.");
  }
  const minimumCompetitiveRateLift = rate(
    configuration.minimumCompetitiveRateLift,
    "Minimum competitive-rate lift",
  );
  if (
    !Number.isSafeInteger(configuration.minimumRegretImprovementMs) ||
    configuration.minimumRegretImprovementMs < 0
  ) {
    throw new Error("Minimum regret improvement must be non-negative.");
  }
  const modelVersion = required(configuration.modelVersion, "Model version");
  const baselineVersion = required(
    configuration.baselineVersion,
    "Baseline version",
  );
  if (modelVersion === baselineVersion) {
    throw new Error("Model and baseline versions must be distinct.");
  }
  if (
    !["synthetic", "historical_holdout"].includes(configuration.evidenceSource)
  ) {
    throw new Error("Evidence source is invalid.");
  }

  const cases = inputs.map((input) =>
    validateCase(input, Date.parse(holdoutStartsAt), Date.parse(holdoutEndsAt)),
  );
  if (new Set(cases.map(({ caseId }) => caseId)).size !== cases.length) {
    throw new Error("Open Race holdout case IDs must be unique.");
  }
  if (new Set(cases.map(({ eventId }) => eventId)).size !== cases.length) {
    throw new Error("Open Race holdout event IDs must be unique.");
  }

  const overall = summarize(
    cases,
    configuration.minimumCompleteCases,
    minimumCompetitiveRateLift,
    configuration.minimumRegretImprovementMs,
    "all",
    null,
  );
  const grouped = new Map<string, OpenRaceHoldoutCase[]>();
  for (const value of cases) {
    const key = JSON.stringify([value.mode, value.distanceMeters]);
    const group = grouped.get(key) ?? [];
    group.push(value);
    grouped.set(key, group);
  }
  const exactCells = [...grouped.values()]
    .map((group) =>
      summarize(
        group,
        configuration.minimumCompleteCases,
        minimumCompetitiveRateLift,
        configuration.minimumRegretImprovementMs,
        group[0]!.mode,
        group[0]!.distanceMeters,
      ),
    )
    .sort(
      (left, right) =>
        openRaceHoldoutModes.indexOf(left.mode as OpenRaceHoldoutMode) -
          openRaceHoldoutModes.indexOf(right.mode as OpenRaceHoldoutMode) ||
        left.distanceMeters! - right.distanceMeters!,
    );

  const warnings: OpenRaceHoldoutReport["warnings"][number][] = [
    "GATE_C_NOT_PASSED",
  ];
  if (configuration.evidenceSource === "synthetic") {
    warnings.push("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  }
  if (cases.some(({ evidenceStatus }) => evidenceStatus !== "complete")) {
    warnings.push("PARTIAL_OR_INVALID_CASES_EXCLUDED");
  }
  if (
    cases.some(
      ({ historicalFreshness }) =>
        historicalFreshness === "stale" || historicalFreshness === "unknown",
    )
  ) {
    warnings.push("STALE_HISTORICAL_EVIDENCE_PRESENT");
  }
  if (overall.completeCaseCount < configuration.minimumCompleteCases) {
    warnings.push("INSUFFICIENT_COMPLETE_CASES");
  }
  if (overall.evidenceStatus !== "model_better_than_baseline") {
    warnings.push("MODEL_NOT_CONSISTENTLY_BETTER");
  }

  return {
    holdoutStartsAt,
    holdoutEndsAt,
    modelVersion,
    baselineVersion,
    evidenceSource: configuration.evidenceSource,
    overall,
    exactCells,
    warnings,
    gateCStatus: "evidence_only",
    gateCPassed: false,
    actionableRecommendationsAllowed: false,
  };
}
