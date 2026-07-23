export const discoveryAgreementModes = ["bike", "car", "horse"] as const;
export type DiscoveryAgreementMode = (typeof discoveryAgreementModes)[number];

export type DiscoveryEvidenceAgreementInput = Readonly<{
  coreId: string;
  mode: DiscoveryAgreementMode;
  distanceMetres: number;
  directRaceCount: number;
  successfulTimePercentile: number | null;
  timeEvidenceStatus: "complete" | "partial" | "missing" | "invalid";
  goldEligibleRaces: number;
  goldAssignmentOpportunities: number;
  goldReceived: number;
  blueAssignmentOpportunities: number;
  blueReceived: number;
  strongFieldStarCount: number;
  weakFieldEligibleNoStarCount: number;
  starEvidenceStatus: "complete" | "partial" | "missing" | "invalid";
  freshness: "current" | "ageing" | "stale" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
}>;

export type DiscoveryEvidenceAgreementThresholds = Readonly<{
  competitiveTimePercentile: number;
  weakTimePercentile: number;
  repeatedPositiveStarCount: number;
  repeatedWeakFieldNoStarCount: number;
  version: string;
}>;

export type DiscoveryEvidenceAgreement = Readonly<{
  coreId: string;
  mode: DiscoveryAgreementMode;
  distanceMetres: number;
  status:
    | "positive_agreement"
    | "negative_agreement_candidate"
    | "time_positive_star_neutral"
    | "time_weak_star_positive_mismatch"
    | "time_neutral_star_positive"
    | "time_neutral_star_negative"
    | "neutral_evidence"
    | "insufficient_evidence";
  timeSignal: "positive" | "neutral" | "weak" | "unavailable";
  starSignal: "positive" | "neutral" | "negative_support" | "unavailable";
  successfulTimePercentile: number | null;
  directRaceCount: number;
  gold: Readonly<{
    eligibleRaces: number;
    assignmentOpportunities: number;
    received: number;
  }>;
  blue: Readonly<{
    assignmentOpportunities: number;
    received: number;
  }>;
  strongFieldStarCount: number;
  weakFieldEligibleNoStarCount: number;
  freshness: DiscoveryEvidenceAgreementInput["freshness"];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "TIME_EVIDENCE_INCOMPLETE"
    | "STAR_EVIDENCE_INCOMPLETE"
    | "TIME_STAR_MISMATCH"
    | "NO_STAR_NON_DISPOSITIVE"
    | "DATA_CUTOFF_UNKNOWN"
    | "DATA_AGEING"
    | "DATA_STALE"
  )[];
  thresholdVersion: string;
  experimental: true;
  actionable: false;
  automaticStopAllowed: false;
  qualityConfirmed: false;
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

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error(`${label} must be valid.`);
  }
  return new Date(parsed).toISOString();
}

export function assessDiscoveryEvidenceAgreement(
  input: DiscoveryEvidenceAgreementInput,
  thresholds: DiscoveryEvidenceAgreementThresholds,
): DiscoveryEvidenceAgreement {
  const coreId = required(input.coreId, "Core ID");
  if (!discoveryAgreementModes.includes(input.mode)) {
    throw new Error("Discovery agreement mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error(
      "Discovery agreement distance must be positive integer metres.",
    );
  }
  if (
    !["complete", "partial", "missing", "invalid"].includes(
      input.timeEvidenceStatus,
    ) ||
    !["complete", "partial", "missing", "invalid"].includes(
      input.starEvidenceStatus,
    )
  ) {
    throw new Error("Discovery agreement evidence status is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Discovery agreement freshness is invalid.");
  }

  const directRaceCount = count(input.directRaceCount, "Direct race count");
  const timePercentile = percentile(
    input.successfulTimePercentile,
    "Successful-time percentile",
  );
  const goldEligibleRaces = count(
    input.goldEligibleRaces,
    "Gold-eligible races",
  );
  const goldOpportunities = count(
    input.goldAssignmentOpportunities,
    "Gold assignment opportunities",
  );
  const goldReceived = count(input.goldReceived, "Gold received");
  const blueOpportunities = count(
    input.blueAssignmentOpportunities,
    "Blue assignment opportunities",
  );
  const blueReceived = count(input.blueReceived, "Blue received");
  const strongStars = count(
    input.strongFieldStarCount,
    "Strong-field star count",
  );
  const weakNoStars = count(
    input.weakFieldEligibleNoStarCount,
    "Weak-field eligible no-star count",
  );

  if (
    goldEligibleRaces > directRaceCount ||
    goldOpportunities > goldEligibleRaces ||
    goldReceived > goldOpportunities ||
    blueOpportunities > directRaceCount ||
    blueReceived > blueOpportunities ||
    strongStars > goldReceived + blueReceived ||
    weakNoStars > goldEligibleRaces
  ) {
    throw new Error("Discovery agreement star denominators are inconsistent.");
  }
  if (
    (directRaceCount === 0 && timePercentile !== null) ||
    (directRaceCount > 0 &&
      input.timeEvidenceStatus === "complete" &&
      timePercentile === null)
  ) {
    throw new Error("Discovery agreement time evidence is inconsistent.");
  }

  const competitiveThreshold = percentile(
    thresholds.competitiveTimePercentile,
    "Competitive-time threshold",
  )!;
  const weakThreshold = percentile(
    thresholds.weakTimePercentile,
    "Weak-time threshold",
  )!;
  if (weakThreshold >= competitiveThreshold) {
    throw new Error(
      "Weak-time threshold must be lower than the competitive-time threshold.",
    );
  }
  if (
    !Number.isSafeInteger(thresholds.repeatedPositiveStarCount) ||
    thresholds.repeatedPositiveStarCount < 1 ||
    !Number.isSafeInteger(thresholds.repeatedWeakFieldNoStarCount) ||
    thresholds.repeatedWeakFieldNoStarCount < 2
  ) {
    throw new Error("Discovery agreement repetition thresholds are invalid.");
  }
  const thresholdVersion = required(thresholds.version, "Threshold version");
  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }

  const timeSignal: DiscoveryEvidenceAgreement["timeSignal"] =
    input.timeEvidenceStatus !== "complete" || timePercentile === null
      ? "unavailable"
      : timePercentile >= competitiveThreshold
        ? "positive"
        : timePercentile <= weakThreshold
          ? "weak"
          : "neutral";
  const starSignal: DiscoveryEvidenceAgreement["starSignal"] =
    input.starEvidenceStatus !== "complete"
      ? "unavailable"
      : strongStars >= thresholds.repeatedPositiveStarCount
        ? "positive"
        : weakNoStars >= thresholds.repeatedWeakFieldNoStarCount
          ? "negative_support"
          : "neutral";

  const warnings = new Set<DiscoveryEvidenceAgreement["warnings"][number]>([
    "GATE_C_NOT_PASSED",
  ]);
  if (input.timeEvidenceStatus !== "complete" || timePercentile === null) {
    warnings.add("TIME_EVIDENCE_INCOMPLETE");
  }
  if (input.starEvidenceStatus !== "complete") {
    warnings.add("STAR_EVIDENCE_INCOMPLETE");
  }
  if (starSignal === "negative_support") {
    warnings.add("NO_STAR_NON_DISPOSITIVE");
  }
  if (
    (timeSignal === "positive" && starSignal === "negative_support") ||
    (timeSignal === "weak" && starSignal === "positive")
  ) {
    warnings.add("TIME_STAR_MISMATCH");
  }
  if (
    dataCurrentThrough === null ||
    lastImported === null ||
    input.freshness === "unknown"
  ) {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (input.freshness === "ageing") warnings.add("DATA_AGEING");
  if (input.freshness === "stale") warnings.add("DATA_STALE");

  const unusable =
    timeSignal === "unavailable" ||
    starSignal === "unavailable" ||
    dataCurrentThrough === null ||
    lastImported === null ||
    ["stale", "unknown"].includes(input.freshness);

  let status: DiscoveryEvidenceAgreement["status"];
  if (unusable) status = "insufficient_evidence";
  else if (timeSignal === "positive" && starSignal === "positive") {
    status = "positive_agreement";
  } else if (timeSignal === "weak" && starSignal === "negative_support") {
    status = "negative_agreement_candidate";
  } else if (timeSignal === "positive" && starSignal === "neutral") {
    status = "time_positive_star_neutral";
  } else if (timeSignal === "weak" && starSignal === "positive") {
    status = "time_weak_star_positive_mismatch";
  } else if (timeSignal === "neutral" && starSignal === "positive") {
    status = "time_neutral_star_positive";
  } else if (timeSignal === "neutral" && starSignal === "negative_support") {
    status = "time_neutral_star_negative";
  } else {
    status = "neutral_evidence";
  }

  return {
    coreId,
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    status,
    timeSignal,
    starSignal,
    successfulTimePercentile: timePercentile,
    directRaceCount,
    gold: {
      eligibleRaces: goldEligibleRaces,
      assignmentOpportunities: goldOpportunities,
      received: goldReceived,
    },
    blue: {
      assignmentOpportunities: blueOpportunities,
      received: blueReceived,
    },
    strongFieldStarCount: strongStars,
    weakFieldEligibleNoStarCount: weakNoStars,
    freshness: input.freshness,
    dataCurrentThrough,
    lastImported,
    warnings: [...warnings].sort(),
    thresholdVersion,
    experimental: true,
    actionable: false,
    automaticStopAllowed: false,
    qualityConfirmed: false,
  };
}
