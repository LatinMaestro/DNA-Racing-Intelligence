import { raceModes, type RaceMode } from "@/domain/core-performance";

export type StarEraPeriodInput = {
  periodId: string;
  startsAt: string;
  endsAt: string;
  mode: RaceMode;
  distance: number;
  validEventCount: number;
  goldEligibleEventCount: number;
  goldAssignedEventCount: number;
  blueOpportunityEventCount: number;
  blueAssignedEventCount: number;
  goldOutcomeKnownCount: number;
  goldTopThreeCount: number;
  blueOutcomeKnownCount: number;
  blueWinCount: number;
  evidenceStatus: "complete" | "partial" | "invalid";
};

export type StarEraDetectionPolicy = {
  minimumEventsPerPeriod: number;
  minimumOutcomeEventsPerPeriod: number;
  assignmentShiftThresholdBasisPoints: number;
  conversionShiftThresholdBasisPoints: number;
};

export type StarEraMetricComparison = {
  metric:
    | "gold_assignment"
    | "blue_assignment"
    | "gold_top_three_conversion"
    | "blue_win_conversion";
  earlierNumerator: number;
  earlierDenominator: number;
  laterNumerator: number;
  laterDenominator: number;
  earlierRateBasisPoints: number | null;
  laterRateBasisPoints: number | null;
  absoluteShiftBasisPoints: number | null;
  thresholdBasisPoints: number;
  sufficientEvidence: boolean;
  materialShift: boolean;
};

export type StarEraBoundaryReview = {
  earlierPeriodId: string;
  laterPeriodId: string;
  boundaryAt: string;
  mode: RaceMode;
  distance: number;
  status:
    "insufficient_evidence" | "no_material_shift_detected" | "review_candidate";
  assignmentShiftDetected: boolean;
  conversionShiftDetected: boolean;
  comparisons: readonly StarEraMetricComparison[];
  warnings: readonly (
    | "PARTIAL_PERIOD_EXCLUDED"
    | "EVENT_SAMPLE_BELOW_MINIMUM"
    | "OUTCOME_SAMPLE_BELOW_MINIMUM"
    | "ASSIGNMENT_SHIFT_ONLY"
    | "CONVERSION_SHIFT_ONLY"
    | "CHANGE_CAUSE_UNKNOWN"
  )[];
  algorithmChangeConfirmed: false;
  automaticEraSegmentationAllowed: false;
};

export type StarEraDetectionReport = {
  comparisons: readonly StarEraBoundaryReview[];
  status:
    | "insufficient_evidence"
    | "no_material_shift_detected"
    | "review_candidates_present";
  gateCStatus: "not_assessed";
  syntheticEvidenceCanConfirmChange: false;
};

function parseTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

function assertCount(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertPeriod(period: StarEraPeriodInput): void {
  if (
    period.periodId.trim() === "" ||
    !raceModes.includes(period.mode) ||
    !Number.isSafeInteger(period.distance) ||
    period.distance <= 0 ||
    !["complete", "partial", "invalid"].includes(period.evidenceStatus)
  ) {
    throw new Error("Star era period is invalid.");
  }
  const startsAt = parseTimestamp(period.startsAt, "Period start");
  const endsAt = parseTimestamp(period.endsAt, "Period end");
  if (endsAt <= startsAt)
    throw new Error("Period end must follow period start.");

  const counts: readonly [number, string][] = [
    [period.validEventCount, "Valid event count"],
    [period.goldEligibleEventCount, "Gold-eligible event count"],
    [period.goldAssignedEventCount, "Gold-assigned event count"],
    [period.blueOpportunityEventCount, "Blue opportunity count"],
    [period.blueAssignedEventCount, "Blue-assigned event count"],
    [period.goldOutcomeKnownCount, "Gold outcome-known count"],
    [period.goldTopThreeCount, "Gold top-three count"],
    [period.blueOutcomeKnownCount, "Blue outcome-known count"],
    [period.blueWinCount, "Blue win count"],
  ];
  for (const [value, label] of counts) assertCount(value, label);

  if (
    period.goldEligibleEventCount > period.validEventCount ||
    period.goldAssignedEventCount > period.goldEligibleEventCount ||
    period.blueOpportunityEventCount > period.validEventCount ||
    period.blueAssignedEventCount > period.blueOpportunityEventCount ||
    period.goldOutcomeKnownCount > period.goldAssignedEventCount ||
    period.goldTopThreeCount > period.goldOutcomeKnownCount ||
    period.blueOutcomeKnownCount > period.blueAssignedEventCount ||
    period.blueWinCount > period.blueOutcomeKnownCount
  ) {
    throw new Error("Star era period counts are inconsistent.");
  }
}

function assertPolicy(policy: StarEraDetectionPolicy): void {
  const integerFields: readonly [number, string][] = [
    [policy.minimumEventsPerPeriod, "Minimum events"],
    [policy.minimumOutcomeEventsPerPeriod, "Minimum outcome events"],
    [policy.assignmentShiftThresholdBasisPoints, "Assignment threshold"],
    [policy.conversionShiftThresholdBasisPoints, "Conversion threshold"],
  ];
  for (const [value, label] of integerFields) {
    if (!Number.isSafeInteger(value) || value <= 0) {
      throw new Error(`${label} must be a positive safe integer.`);
    }
  }
  if (
    policy.assignmentShiftThresholdBasisPoints > 10_000 ||
    policy.conversionShiftThresholdBasisPoints > 10_000
  ) {
    throw new Error("Basis-point thresholds cannot exceed 10000.");
  }
}

function rateBasisPoints(
  numerator: number,
  denominator: number,
): number | null {
  if (denominator === 0) return null;
  return Number(
    (BigInt(numerator) * 10_000n + BigInt(Math.floor(denominator / 2))) /
      BigInt(denominator),
  );
}

function comparison(input: {
  metric: StarEraMetricComparison["metric"];
  earlierNumerator: number;
  earlierDenominator: number;
  laterNumerator: number;
  laterDenominator: number;
  minimumDenominator: number;
  thresholdBasisPoints: number;
}): StarEraMetricComparison {
  const earlierRateBasisPoints = rateBasisPoints(
    input.earlierNumerator,
    input.earlierDenominator,
  );
  const laterRateBasisPoints = rateBasisPoints(
    input.laterNumerator,
    input.laterDenominator,
  );
  const sufficientEvidence =
    input.earlierDenominator >= input.minimumDenominator &&
    input.laterDenominator >= input.minimumDenominator;
  const absoluteShiftBasisPoints =
    earlierRateBasisPoints === null || laterRateBasisPoints === null
      ? null
      : Math.abs(laterRateBasisPoints - earlierRateBasisPoints);

  return {
    metric: input.metric,
    earlierNumerator: input.earlierNumerator,
    earlierDenominator: input.earlierDenominator,
    laterNumerator: input.laterNumerator,
    laterDenominator: input.laterDenominator,
    earlierRateBasisPoints,
    laterRateBasisPoints,
    absoluteShiftBasisPoints,
    thresholdBasisPoints: input.thresholdBasisPoints,
    sufficientEvidence,
    materialShift:
      sufficientEvidence &&
      absoluteShiftBasisPoints !== null &&
      absoluteShiftBasisPoints >= input.thresholdBasisPoints,
  };
}

function compareAdjacentPeriods(
  earlier: StarEraPeriodInput,
  later: StarEraPeriodInput,
  policy: StarEraDetectionPolicy,
): StarEraBoundaryReview {
  if (
    earlier.mode !== later.mode ||
    earlier.distance !== later.distance ||
    parseTimestamp(earlier.endsAt, "Earlier period end") >=
      parseTimestamp(later.startsAt, "Later period start")
  ) {
    throw new Error(
      "Era comparisons require matching mode-distance and non-overlapping periods.",
    );
  }

  const comparisons = [
    comparison({
      metric: "gold_assignment",
      earlierNumerator: earlier.goldAssignedEventCount,
      earlierDenominator: earlier.goldEligibleEventCount,
      laterNumerator: later.goldAssignedEventCount,
      laterDenominator: later.goldEligibleEventCount,
      minimumDenominator: policy.minimumEventsPerPeriod,
      thresholdBasisPoints: policy.assignmentShiftThresholdBasisPoints,
    }),
    comparison({
      metric: "blue_assignment",
      earlierNumerator: earlier.blueAssignedEventCount,
      earlierDenominator: earlier.blueOpportunityEventCount,
      laterNumerator: later.blueAssignedEventCount,
      laterDenominator: later.blueOpportunityEventCount,
      minimumDenominator: policy.minimumEventsPerPeriod,
      thresholdBasisPoints: policy.assignmentShiftThresholdBasisPoints,
    }),
    comparison({
      metric: "gold_top_three_conversion",
      earlierNumerator: earlier.goldTopThreeCount,
      earlierDenominator: earlier.goldOutcomeKnownCount,
      laterNumerator: later.goldTopThreeCount,
      laterDenominator: later.goldOutcomeKnownCount,
      minimumDenominator: policy.minimumOutcomeEventsPerPeriod,
      thresholdBasisPoints: policy.conversionShiftThresholdBasisPoints,
    }),
    comparison({
      metric: "blue_win_conversion",
      earlierNumerator: earlier.blueWinCount,
      earlierDenominator: earlier.blueOutcomeKnownCount,
      laterNumerator: later.blueWinCount,
      laterDenominator: later.blueOutcomeKnownCount,
      minimumDenominator: policy.minimumOutcomeEventsPerPeriod,
      thresholdBasisPoints: policy.conversionShiftThresholdBasisPoints,
    }),
  ] as const;

  const periodComplete =
    earlier.evidenceStatus === "complete" &&
    later.evidenceStatus === "complete";
  const eventSamplesSufficient = comparisons
    .slice(0, 2)
    .every((item) => item.sufficientEvidence);
  const outcomeSamplesSufficient = comparisons
    .slice(2)
    .every((item) => item.sufficientEvidence);
  const assignmentShiftDetected =
    periodComplete &&
    comparisons.slice(0, 2).some((item) => item.materialShift);
  const conversionShiftDetected =
    periodComplete && comparisons.slice(2).some((item) => item.materialShift);
  const warnings: StarEraBoundaryReview["warnings"][number][] = [];
  if (!periodComplete) warnings.push("PARTIAL_PERIOD_EXCLUDED");
  if (!eventSamplesSufficient) warnings.push("EVENT_SAMPLE_BELOW_MINIMUM");
  if (!outcomeSamplesSufficient) warnings.push("OUTCOME_SAMPLE_BELOW_MINIMUM");
  if (assignmentShiftDetected && !conversionShiftDetected) {
    warnings.push("ASSIGNMENT_SHIFT_ONLY");
  }
  if (!assignmentShiftDetected && conversionShiftDetected) {
    warnings.push("CONVERSION_SHIFT_ONLY");
  }
  if (assignmentShiftDetected || conversionShiftDetected) {
    warnings.push("CHANGE_CAUSE_UNKNOWN");
  }

  const sufficientEvidence =
    periodComplete && eventSamplesSufficient && outcomeSamplesSufficient;
  return {
    earlierPeriodId: earlier.periodId,
    laterPeriodId: later.periodId,
    boundaryAt: new Date(
      parseTimestamp(later.startsAt, "Later period start"),
    ).toISOString(),
    mode: earlier.mode,
    distance: earlier.distance,
    status: !sufficientEvidence
      ? "insufficient_evidence"
      : assignmentShiftDetected || conversionShiftDetected
        ? "review_candidate"
        : "no_material_shift_detected",
    assignmentShiftDetected,
    conversionShiftDetected,
    comparisons,
    warnings,
    algorithmChangeConfirmed: false,
    automaticEraSegmentationAllowed: false,
  };
}

export function detectStarAlgorithmEraCandidates(
  periods: readonly StarEraPeriodInput[],
  policy: StarEraDetectionPolicy,
): StarEraDetectionReport {
  assertPolicy(policy);
  for (const period of periods) assertPeriod(period);
  const periodIds = periods.map((period) => period.periodId);
  if (new Set(periodIds).size !== periodIds.length) {
    throw new Error("Star era period IDs must be unique.");
  }

  const grouped = new Map<string, StarEraPeriodInput[]>();
  for (const period of periods) {
    const key = JSON.stringify([period.mode, period.distance]);
    const values = grouped.get(key) ?? [];
    values.push(period);
    grouped.set(key, values);
  }

  const comparisons: StarEraBoundaryReview[] = [];
  for (const values of grouped.values()) {
    values.sort(
      (left, right) =>
        parseTimestamp(left.startsAt, "Period start") -
          parseTimestamp(right.startsAt, "Period start") ||
        left.periodId.localeCompare(right.periodId),
    );
    for (let index = 1; index < values.length; index += 1) {
      comparisons.push(
        compareAdjacentPeriods(values[index - 1]!, values[index]!, policy),
      );
    }
  }
  comparisons.sort(
    (left, right) =>
      Date.parse(left.boundaryAt) - Date.parse(right.boundaryAt) ||
      left.mode.localeCompare(right.mode) ||
      left.distance - right.distance,
  );

  return {
    comparisons,
    status:
      comparisons.length === 0 ||
      (comparisons.some((item) => item.status === "insufficient_evidence") &&
        !comparisons.some((item) => item.status === "review_candidate"))
        ? "insufficient_evidence"
        : comparisons.some((item) => item.status === "review_candidate")
          ? "review_candidates_present"
          : "no_material_shift_detected",
    gateCStatus: "not_assessed",
    syntheticEvidenceCanConfirmChange: false,
  };
}
