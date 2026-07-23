export type DiscoveryPathReviewInput = Readonly<{
  coreId: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  directRaceCount: number;
  successfulTimePercentile: number | null;
  timeDirection: "improving" | "stable" | "declining" | "unavailable";
  earlyStrongFieldStarCount: number;
  weakFieldEligibleNoStarCount: number;
  starDataStatus: "complete" | "partial" | "missing" | "invalid";
  freshness: "current" | "ageing" | "stale" | "unknown";
  dataCurrentThrough: string | null;
}>;

export type DiscoveryPathThresholds = Readonly<{
  continuePercentile: number;
  weakPercentile: number;
  minimumDirectRaces: number;
  version: string;
}>;

export type DiscoveryPathReview = Readonly<{
  coreId: string;
  mode: DiscoveryPathReviewInput["mode"];
  distanceMetres: number;
  reviewSignal:
    | "continue_candidate"
    | "stop_candidate"
    | "hold_for_more_evidence"
    | "insufficient_evidence";
  primaryReason:
    | "competitive_time"
    | "weak_time_after_minimum"
    | "early_strong_field_support"
    | "time_star_mismatch"
    | "direct_time_unavailable"
    | "stale_or_unknown_evidence";
  directRaceCount: number;
  additionalRacesToMinimum: number;
  successfulTimePercentile: number | null;
  thresholdVersion: string;
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "BELOW_MINIMUM_SAMPLE"
    | "STAR_EVIDENCE_INCOMPLETE"
    | "NO_STAR_NON_DISPOSITIVE"
    | "DATA_CUTOFF_UNKNOWN"
    | "DATA_STALE"
    | "TIME_STAR_MISMATCH"
  )[];
  experimental: true;
  actionable: false;
  automaticStopAllowed: false;
}>;

function required(value: string, label: string): string {
  const result = value.trim();
  if (result === "") throw new Error(`${label} is required.`);
  return result;
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function percentile(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between zero and 100.`);
  }
  return value;
}

function validateThresholds(
  thresholds: DiscoveryPathThresholds,
): DiscoveryPathThresholds {
  const weak = percentile(thresholds.weakPercentile, "Weak percentile");
  const keep = percentile(thresholds.continuePercentile, "Continue percentile");
  if (weak >= keep) {
    throw new Error("Weak percentile must be lower than continue percentile.");
  }
  if (
    !Number.isSafeInteger(thresholds.minimumDirectRaces) ||
    thresholds.minimumDirectRaces < 10
  ) {
    throw new Error("Minimum direct races must be at least 10.");
  }
  return {
    weakPercentile: weak,
    continuePercentile: keep,
    minimumDirectRaces: thresholds.minimumDirectRaces,
    version: required(thresholds.version, "Threshold version"),
  };
}

export function reviewDiscoveryPath(
  input: DiscoveryPathReviewInput,
  rawThresholds: DiscoveryPathThresholds,
): DiscoveryPathReview {
  const thresholds = validateThresholds(rawThresholds);
  const coreId = required(input.coreId, "Core ID");
  if (!["bike", "car", "horse"].includes(input.mode)) {
    throw new Error("Discovery mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error("Discovery distance must be positive integer metres.");
  }
  const directRaceCount = count(input.directRaceCount, "Direct race count");
  const strongStars = count(
    input.earlyStrongFieldStarCount,
    "Early strong-field star count",
  );
  const weakNoStars = count(
    input.weakFieldEligibleNoStarCount,
    "Weak-field eligible no-star count",
  );
  if (
    !["improving", "stable", "declining", "unavailable"].includes(
      input.timeDirection,
    )
  ) {
    throw new Error("Time direction is invalid.");
  }
  if (
    !["complete", "partial", "missing", "invalid"].includes(
      input.starDataStatus,
    )
  ) {
    throw new Error("Star data status is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Discovery freshness is invalid.");
  }
  const timePercentile =
    input.successfulTimePercentile === null
      ? null
      : percentile(
          input.successfulTimePercentile,
          "Successful-time percentile",
        );
  if (
    directRaceCount === 0 &&
    (timePercentile !== null || input.timeDirection !== "unavailable")
  ) {
    throw new Error("Time evidence requires at least one direct race.");
  }
  if (
    directRaceCount > 0 &&
    (timePercentile === null || input.timeDirection === "unavailable")
  ) {
    throw new Error("Direct races require complete time evidence.");
  }
  if (strongStars + weakNoStars > directRaceCount) {
    throw new Error("Star context cannot exceed direct race count.");
  }

  const cutoff =
    input.dataCurrentThrough === null
      ? null
      : new Date(input.dataCurrentThrough);
  if (cutoff !== null && Number.isNaN(cutoff.getTime())) {
    throw new Error("Data current through must be valid.");
  }
  const warnings = new Set<DiscoveryPathReview["warnings"][number]>([
    "GATE_C_NOT_PASSED",
  ]);
  if (directRaceCount < thresholds.minimumDirectRaces) {
    warnings.add("BELOW_MINIMUM_SAMPLE");
  }
  if (input.starDataStatus !== "complete") {
    warnings.add("STAR_EVIDENCE_INCOMPLETE");
  }
  if (weakNoStars > 0) warnings.add("NO_STAR_NON_DISPOSITIVE");
  if (cutoff === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (input.freshness === "stale") warnings.add("DATA_STALE");

  const stale =
    cutoff === null || ["stale", "unknown"].includes(input.freshness);
  const weakTime =
    timePercentile !== null &&
    timePercentile < thresholds.weakPercentile &&
    input.timeDirection !== "improving";
  const competitiveTime =
    timePercentile !== null && timePercentile >= thresholds.continuePercentile;
  const starMismatch = weakTime && strongStars > 0;
  if (starMismatch) warnings.add("TIME_STAR_MISMATCH");

  const decision: Pick<DiscoveryPathReview, "reviewSignal" | "primaryReason"> =
    stale
      ? {
          reviewSignal: "insufficient_evidence",
          primaryReason: "stale_or_unknown_evidence",
        }
      : timePercentile === null
        ? {
            reviewSignal: "insufficient_evidence",
            primaryReason: "direct_time_unavailable",
          }
        : starMismatch
          ? {
              reviewSignal: "hold_for_more_evidence",
              primaryReason: "time_star_mismatch",
            }
          : competitiveTime
            ? {
                reviewSignal: "continue_candidate",
                primaryReason: "competitive_time",
              }
            : directRaceCount < thresholds.minimumDirectRaces && strongStars > 0
              ? {
                  reviewSignal: "continue_candidate",
                  primaryReason: "early_strong_field_support",
                }
              : directRaceCount >= thresholds.minimumDirectRaces && weakTime
                ? {
                    reviewSignal: "stop_candidate",
                    primaryReason: "weak_time_after_minimum",
                  }
                : {
                    reviewSignal: "hold_for_more_evidence",
                    primaryReason: "competitive_time",
                  };

  return {
    coreId,
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    ...decision,
    directRaceCount,
    additionalRacesToMinimum: Math.max(
      0,
      thresholds.minimumDirectRaces - directRaceCount,
    ),
    successfulTimePercentile: timePercentile,
    thresholdVersion: thresholds.version,
    warnings: [...warnings].sort(),
    experimental: true,
    actionable: false,
    automaticStopAllowed: false,
  };
}
