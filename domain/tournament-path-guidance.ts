export type TournamentAttemptInput = Readonly<{
  eventId: string;
  eventAt: string;
  metricAssessment: "competitive" | "weak" | "unavailable";
  starContext:
    | "strong_field_star"
    | "weak_field_eligible_no_star"
    | "gold_ineligible_no_star"
    | "neutral"
    | "unavailable";
}>;

export type TournamentPathGuidanceInput = Readonly<{
  tournamentId: string;
  bracketId: string;
  coreId: string;
  minimumReviewRaces: number;
  maximumProbeRaces: number;
  remainingRaceBudget: number;
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  evidenceConfidence: "high" | "medium" | "low" | "unknown";
  maidenCommitment: "not_maiden" | "uncommitted" | "committed";
  maidenModeDisposition:
    | "preferred_here"
    | "preserve_for_stronger_mode"
    | "not_applicable"
    | "unresolved";
  attempts: readonly TournamentAttemptInput[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type TournamentPathWarning =
  | "INSUFFICIENT_SAMPLE"
  | "PROBE_LIMIT_REACHED"
  | "NO_RACE_BUDGET"
  | "WEAK_TIME_EVIDENCE"
  | "TIME_METRIC_DISAGREEMENT"
  | "STRONG_FIELD_STAR_SUPPORTS_CONTINUE"
  | "NO_STAR_NON_DISPOSITIVE"
  | "GOLD_INELIGIBLE_NO_STAR_EXCLUDED"
  | "METRIC_EVIDENCE_UNAVAILABLE"
  | "LOW_EVIDENCE_CONFIDENCE"
  | "EVIDENCE_CONFIDENCE_UNKNOWN"
  | "PRESERVE_ME"
  | "MAIDEN_DISPOSITION_UNRESOLVED"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "CURRENT_FIELD_UNAVAILABLE"
  | "GATE_C_NOT_PASSED";

export type TournamentPathGuidance = Readonly<{
  tournamentId: string;
  bracketId: string;
  coreId: string;
  reviewSignal:
    "continue_probe" | "pause_review" | "stop_candidate" | "preserve_me";
  acceptedAttemptCount: number;
  competitiveMetricCount: number;
  weakMetricCount: number;
  unavailableMetricCount: number;
  strongFieldStarCount: number;
  eligibleNoStarCount: number;
  goldIneligibleNoStarCount: number;
  minimumReviewRaces: number;
  maximumProbeRaces: number;
  remainingRaceBudget: number;
  stopEvidence: "sufficient_weak_metric_and_time" | "not_established";
  noStarUsedForStop: false;
  historicalStarsRole: "supports_limited_continuation_only" | "non_dispositive";
  warnings: readonly TournamentPathWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: TournamentPathGuidanceInput["freshness"];
  importedHistoricalSnapshot: true;
  currentQualifyingFieldAvailable: false;
  gateCRequired: true;
  actionableRecommendationAllowed: false;
  automaticEntryAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function nonNegativeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function optionalTimestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

export function reviewTournamentPath(
  input: TournamentPathGuidanceInput,
): TournamentPathGuidance {
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const bracketId = required(input.bracketId, "Bracket ID");
  const coreId = required(input.coreId, "Core ID");
  const minimumReviewRaces = positiveInteger(
    input.minimumReviewRaces,
    "Minimum review races",
  );
  const maximumProbeRaces = positiveInteger(
    input.maximumProbeRaces,
    "Maximum probe races",
  );
  if (maximumProbeRaces < minimumReviewRaces) {
    throw new Error(
      "Maximum probe races cannot be below minimum review races.",
    );
  }
  const remainingRaceBudget = nonNegativeInteger(
    input.remainingRaceBudget,
    "Remaining race budget",
  );
  if (
    !["strong", "competitive", "weak", "unknown"].includes(input.timeEvidence)
  ) {
    throw new Error("Time evidence is invalid.");
  }
  if (
    !["high", "medium", "low", "unknown"].includes(input.evidenceConfidence)
  ) {
    throw new Error("Evidence confidence is invalid.");
  }
  if (
    !["not_maiden", "uncommitted", "committed"].includes(input.maidenCommitment)
  ) {
    throw new Error("Maiden commitment is invalid.");
  }
  if (
    ![
      "preferred_here",
      "preserve_for_stronger_mode",
      "not_applicable",
      "unresolved",
    ].includes(input.maidenModeDisposition)
  ) {
    throw new Error("Maiden mode disposition is invalid.");
  }
  if (
    input.maidenModeDisposition === "preserve_for_stronger_mode" &&
    input.maidenCommitment !== "uncommitted"
  ) {
    throw new Error("Only an uncommitted Maiden can preserve ME.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Path freshness is invalid.");
  }

  const dataCurrentThrough = optionalTimestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = optionalTimestamp(input.lastImported, "Last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }

  const attempts = input.attempts
    .map((attempt) => {
      const eventId = required(attempt.eventId, "Event ID");
      const parsed = Date.parse(required(attempt.eventAt, "Event time"));
      if (Number.isNaN(parsed)) throw new Error("Event time must be valid.");
      const eventAt = new Date(parsed).toISOString();
      if (
        !["competitive", "weak", "unavailable"].includes(
          attempt.metricAssessment,
        )
      ) {
        throw new Error("Metric assessment is invalid.");
      }
      if (
        ![
          "strong_field_star",
          "weak_field_eligible_no_star",
          "gold_ineligible_no_star",
          "neutral",
          "unavailable",
        ].includes(attempt.starContext)
      ) {
        throw new Error("Attempt star context is invalid.");
      }
      if (
        dataCurrentThrough !== null &&
        Date.parse(eventAt) > Date.parse(dataCurrentThrough)
      ) {
        throw new Error("Tournament attempt cannot exceed the data cutoff.");
      }
      return { ...attempt, eventId, eventAt };
    })
    .sort(
      (left, right) =>
        Date.parse(left.eventAt) - Date.parse(right.eventAt) ||
        left.eventId.localeCompare(right.eventId),
    );
  if (
    new Set(attempts.map((attempt) => attempt.eventId)).size !== attempts.length
  ) {
    throw new Error("Tournament attempt event IDs must be unique.");
  }
  if (attempts.length > maximumProbeRaces) {
    throw new Error("Accepted attempts exceed the configured probe limit.");
  }

  const competitiveMetricCount = attempts.filter(
    (attempt) => attempt.metricAssessment === "competitive",
  ).length;
  const weakMetricCount = attempts.filter(
    (attempt) => attempt.metricAssessment === "weak",
  ).length;
  const unavailableMetricCount = attempts.filter(
    (attempt) => attempt.metricAssessment === "unavailable",
  ).length;
  const strongFieldStarCount = attempts.filter(
    (attempt) => attempt.starContext === "strong_field_star",
  ).length;
  const eligibleNoStarCount = attempts.filter(
    (attempt) => attempt.starContext === "weak_field_eligible_no_star",
  ).length;
  const goldIneligibleNoStarCount = attempts.filter(
    (attempt) => attempt.starContext === "gold_ineligible_no_star",
  ).length;

  const warnings = new Set<TournamentPathWarning>([
    "CURRENT_FIELD_UNAVAILABLE",
    "GATE_C_NOT_PASSED",
  ]);
  if (attempts.length < minimumReviewRaces) warnings.add("INSUFFICIENT_SAMPLE");
  if (attempts.length === maximumProbeRaces)
    warnings.add("PROBE_LIMIT_REACHED");
  if (remainingRaceBudget === 0) warnings.add("NO_RACE_BUDGET");
  if (input.timeEvidence === "weak") warnings.add("WEAK_TIME_EVIDENCE");
  if (eligibleNoStarCount > 0) warnings.add("NO_STAR_NON_DISPOSITIVE");
  if (goldIneligibleNoStarCount > 0) {
    warnings.add("GOLD_INELIGIBLE_NO_STAR_EXCLUDED");
  }
  if (unavailableMetricCount > 0) {
    warnings.add("METRIC_EVIDENCE_UNAVAILABLE");
  }
  if (input.evidenceConfidence === "low") {
    warnings.add("LOW_EVIDENCE_CONFIDENCE");
  }
  if (input.evidenceConfidence === "unknown") {
    warnings.add("EVIDENCE_CONFIDENCE_UNKNOWN");
  }
  if (input.maidenModeDisposition === "preserve_for_stronger_mode") {
    warnings.add("PRESERVE_ME");
  }
  if (
    input.maidenCommitment === "uncommitted" &&
    input.maidenModeDisposition === "unresolved"
  ) {
    warnings.add("MAIDEN_DISPOSITION_UNRESOLVED");
  }
  if (dataCurrentThrough === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (input.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
  if (input.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");

  const sufficientWeakMetric =
    attempts.length >= minimumReviewRaces &&
    weakMetricCount === attempts.length &&
    unavailableMetricCount === 0;
  const stopEstablished = sufficientWeakMetric && input.timeEvidence === "weak";
  const timeMetricDisagreement =
    (input.timeEvidence === "weak" && competitiveMetricCount > 0) ||
    ((input.timeEvidence === "strong" ||
      input.timeEvidence === "competitive") &&
      sufficientWeakMetric);
  if (timeMetricDisagreement) warnings.add("TIME_METRIC_DISAGREEMENT");

  const evidenceUsable =
    input.freshness === "current" &&
    dataCurrentThrough !== null &&
    lastImported !== null &&
    (input.evidenceConfidence === "high" ||
      input.evidenceConfidence === "medium");
  const canContinue =
    attempts.length < maximumProbeRaces &&
    remainingRaceBudget > 0 &&
    input.timeEvidence !== "weak" &&
    input.timeEvidence !== "unknown" &&
    (competitiveMetricCount > 0 ||
      (attempts.length < minimumReviewRaces && strongFieldStarCount > 0));
  if (canContinue && competitiveMetricCount === 0 && strongFieldStarCount > 0) {
    warnings.add("STRONG_FIELD_STAR_SUPPORTS_CONTINUE");
  }

  let reviewSignal: TournamentPathGuidance["reviewSignal"];
  if (input.maidenModeDisposition === "preserve_for_stronger_mode") {
    reviewSignal = "preserve_me";
  } else if (
    !evidenceUsable ||
    input.timeEvidence === "unknown" ||
    (input.maidenCommitment === "uncommitted" &&
      input.maidenModeDisposition === "unresolved") ||
    remainingRaceBudget === 0
  ) {
    reviewSignal = "pause_review";
  } else if (stopEstablished) {
    reviewSignal = "stop_candidate";
  } else if (timeMetricDisagreement) {
    reviewSignal = "pause_review";
  } else if (canContinue) {
    reviewSignal = "continue_probe";
  } else {
    reviewSignal = "pause_review";
  }

  return {
    tournamentId,
    bracketId,
    coreId,
    reviewSignal,
    acceptedAttemptCount: attempts.length,
    competitiveMetricCount,
    weakMetricCount,
    unavailableMetricCount,
    strongFieldStarCount,
    eligibleNoStarCount,
    goldIneligibleNoStarCount,
    minimumReviewRaces,
    maximumProbeRaces,
    remainingRaceBudget,
    stopEvidence: stopEstablished
      ? "sufficient_weak_metric_and_time"
      : "not_established",
    noStarUsedForStop: false,
    historicalStarsRole:
      strongFieldStarCount > 0
        ? "supports_limited_continuation_only"
        : "non_dispositive",
    warnings: [...warnings].sort(),
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    importedHistoricalSnapshot: true,
    currentQualifyingFieldAvailable: false,
    gateCRequired: true,
    actionableRecommendationAllowed: false,
    automaticEntryAllowed: false,
  };
}
