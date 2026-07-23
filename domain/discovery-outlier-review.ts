export type DiscoveryOutlierInput = Readonly<{
  coreId: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  directRaceCount: number;
  bestTimePercentile: number | null;
  medianTimePercentile: number | null;
  priorExpectedPercentile: number | null;
  eliteObservationCount: number;
  earlyStrongFieldStarCount: number;
  observationStatus: "complete" | "partial" | "invalid";
  freshness: "current" | "ageing" | "stale" | "unknown";
  evidenceCutoff: string | null;
}>;

export type OutlierThresholds = Readonly<{
  elitePercentile: number;
  unexpectedGapPoints: number;
  repeatedObservationCount: number;
  version: string;
}>;

export type DiscoveryOutlierReview = Readonly<{
  coreId: string;
  mode: DiscoveryOutlierInput["mode"];
  distanceMetres: number;
  status:
    | "unexpected_outlier_candidate"
    | "expected_elite_candidate"
    | "no_outlier_signal"
    | "insufficient_evidence";
  repeatStatus: "none" | "single_observation" | "repeated_observations";
  primaryEvidence: "time" | "unavailable";
  supportingStrongFieldStars: number;
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "SINGLE_OBSERVATION"
    | "PARTIAL_OR_INVALID_OBSERVATIONS"
    | "PRIOR_EXPECTATION_UNAVAILABLE"
    | "DATA_CUTOFF_UNKNOWN"
    | "DATA_STALE"
    | "STAR_SUPPORT_ONLY"
  )[];
  thresholdVersion: string;
  experimental: true;
  eliteQualityConfirmed: false;
  actionable: false;
  automaticEntryAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function percentile(value: number | null, label: string): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between zero and 100.`);
  }
  return value;
}

export function reviewUnexpectedOutlier(
  input: DiscoveryOutlierInput,
  thresholds: OutlierThresholds,
): DiscoveryOutlierReview {
  const coreId = required(input.coreId, "Core ID");
  if (!["bike", "car", "horse"].includes(input.mode)) {
    throw new Error("Outlier mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error("Outlier distance must be positive integer metres.");
  }
  const directRaceCount = count(input.directRaceCount, "Direct race count");
  const eliteObservations = count(
    input.eliteObservationCount,
    "Elite observation count",
  );
  const strongStars = count(
    input.earlyStrongFieldStarCount,
    "Early strong-field star count",
  );
  if (eliteObservations > directRaceCount || strongStars > directRaceCount) {
    throw new Error("Supporting observations cannot exceed direct races.");
  }
  const best = percentile(input.bestTimePercentile, "Best-time percentile");
  const median = percentile(
    input.medianTimePercentile,
    "Median-time percentile",
  );
  const prior = percentile(
    input.priorExpectedPercentile,
    "Prior expected percentile",
  );
  if (
    directRaceCount === 0 &&
    (best !== null || median !== null || eliteObservations !== 0)
  ) {
    throw new Error("Outlier time evidence requires direct races.");
  }
  if (directRaceCount > 0 && (best === null || median === null)) {
    throw new Error("Direct races require best and median time evidence.");
  }
  if (!["complete", "partial", "invalid"].includes(input.observationStatus)) {
    throw new Error("Observation status is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Outlier freshness is invalid.");
  }
  const eliteThreshold = percentile(
    thresholds.elitePercentile,
    "Elite threshold",
  )!;
  if (
    !Number.isFinite(thresholds.unexpectedGapPoints) ||
    thresholds.unexpectedGapPoints <= 0 ||
    thresholds.unexpectedGapPoints > 100
  ) {
    throw new Error(
      "Unexpected gap must be greater than zero and at most 100.",
    );
  }
  if (
    !Number.isSafeInteger(thresholds.repeatedObservationCount) ||
    thresholds.repeatedObservationCount < 2
  ) {
    throw new Error("Repeated observation count must be at least two.");
  }
  const thresholdVersion = required(thresholds.version, "Threshold version");
  const cutoff =
    input.evidenceCutoff === null ? null : new Date(input.evidenceCutoff);
  if (cutoff !== null && Number.isNaN(cutoff.getTime())) {
    throw new Error("Evidence cutoff must be valid.");
  }

  const warnings = new Set<DiscoveryOutlierReview["warnings"][number]>([
    "GATE_C_NOT_PASSED",
  ]);
  if (input.observationStatus !== "complete") {
    warnings.add("PARTIAL_OR_INVALID_OBSERVATIONS");
  }
  if (prior === null) warnings.add("PRIOR_EXPECTATION_UNAVAILABLE");
  if (cutoff === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (input.freshness === "stale") warnings.add("DATA_STALE");
  if (strongStars > 0) warnings.add("STAR_SUPPORT_ONLY");
  if (eliteObservations === 1) warnings.add("SINGLE_OBSERVATION");

  const unusable =
    input.observationStatus !== "complete" ||
    cutoff === null ||
    ["stale", "unknown"].includes(input.freshness) ||
    best === null;
  const eliteTime = best !== null && best >= eliteThreshold;
  const unexpected =
    eliteTime &&
    prior !== null &&
    best - prior >= thresholds.unexpectedGapPoints;

  return {
    coreId,
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    status: unusable
      ? "insufficient_evidence"
      : unexpected
        ? "unexpected_outlier_candidate"
        : eliteTime
          ? "expected_elite_candidate"
          : "no_outlier_signal",
    repeatStatus:
      eliteObservations === 0
        ? "none"
        : eliteObservations >= thresholds.repeatedObservationCount
          ? "repeated_observations"
          : "single_observation",
    primaryEvidence: best === null ? "unavailable" : "time",
    supportingStrongFieldStars: strongStars,
    warnings: [...warnings].sort(),
    thresholdVersion,
    experimental: true,
    eliteQualityConfirmed: false,
    actionable: false,
    automaticEntryAllowed: false,
  };
}
