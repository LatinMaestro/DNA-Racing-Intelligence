export const starConversionModes = ["bike", "car", "horse"] as const;
export type StarConversionMode = (typeof starConversionModes)[number];

export type StarAssignmentOutcome = Readonly<{
  status: "assigned" | "not_assigned" | "excluded";
  assignedCoreFinishPosition: number | null;
}>;

export type StarConversionObservation = Readonly<{
  eventId: string;
  eventAt: string;
  starObservedAt: string;
  resultRecordedAt: string;
  mode: StarConversionMode;
  distanceMeters: number;
  gateCount: number;
  eraId: string;
  starDataStatus: "complete" | "partial" | "invalid";
  gold: StarAssignmentOutcome;
  blue: StarAssignmentOutcome;
}>;

export type StarConversionConfiguration = Readonly<{
  minimumAssignedEvents: number;
  evidenceSource: "synthetic" | "historical_holdout";
}>;

export type ConversionRate = Readonly<{
  assignedCount: number;
  convertedCount: number;
  rate: number | null;
  evidenceStatus: "insufficient_sample" | "descriptive_ready";
}>;

export type StarConversionSummary = Readonly<{
  mode: StarConversionMode | "all";
  distanceMeters: number | null;
  gateCount: number | null;
  eraId: string | "all";
  eventCount: number;
  completeEventCount: number;
  excludedEventCount: number;
  goldEligibleEventCount: number;
  goldIneligibleEventCount: number;
  ineligibleGoldAnomalyCount: number;
  goldTopThree: ConversionRate;
  blueWin: ConversionRate;
  blueTopThree: ConversionRate;
  interpretation: "descriptive_only";
}>;

export type StarConversionReport = Readonly<{
  overall: StarConversionSummary;
  exactCells: readonly StarConversionSummary[];
  evidenceSource: StarConversionConfiguration["evidenceSource"];
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "SYNTHETIC_EVIDENCE_NON_DISPOSITIVE"
    | "PARTIAL_OR_INVALID_STAR_EVENTS_EXCLUDED"
    | "INELIGIBLE_GOLD_ASSIGNMENT_ANOMALY"
    | "INSUFFICIENT_CONVERSION_SAMPLE"
  )[];
  predictiveFeatureCreated: false;
  gateCStatus: "evidence_only";
  gateCPassed: false;
  actionableRecommendationsAllowed: false;
}>;

type NormalizedObservation = Omit<
  StarConversionObservation,
  "eventId" | "eventAt" | "starObservedAt" | "resultRecordedAt" | "eraId"
> & {
  eventId: string;
  eventAt: string;
  starObservedAt: string;
  resultRecordedAt: string;
  eraId: string;
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

function rounded(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function validateAssignment(
  assignment: StarAssignmentOutcome,
  gateCount: number,
  label: string,
): void {
  if (!["assigned", "not_assigned", "excluded"].includes(assignment.status)) {
    throw new Error(`${label} assignment status is invalid.`);
  }
  if (assignment.status === "assigned") {
    if (
      !Number.isSafeInteger(assignment.assignedCoreFinishPosition) ||
      assignment.assignedCoreFinishPosition === null ||
      assignment.assignedCoreFinishPosition <= 0 ||
      assignment.assignedCoreFinishPosition > gateCount
    ) {
      throw new Error(`${label} assigned finish position is invalid.`);
    }
  } else if (assignment.assignedCoreFinishPosition !== null) {
    throw new Error(`${label} unassigned state cannot contain a finish.`);
  }
}

function normalizeObservation(
  input: StarConversionObservation,
): NormalizedObservation {
  const eventId = required(input.eventId, "Event ID");
  if (!starConversionModes.includes(input.mode)) {
    throw new Error(`Star conversion mode is invalid for ${eventId}.`);
  }
  positiveSafeInteger(input.distanceMeters, "Distance metres");
  positiveSafeInteger(input.gateCount, "Gate count");
  const eraId = required(input.eraId, "Era ID");
  if (!["complete", "partial", "invalid"].includes(input.starDataStatus)) {
    throw new Error(`Star data status is invalid for ${eventId}.`);
  }
  const starObservedAt = timestamp(
    input.starObservedAt,
    "Star observation time",
  );
  const eventAt = timestamp(input.eventAt, "Event time");
  const resultRecordedAt = timestamp(
    input.resultRecordedAt,
    "Result recorded time",
  );
  if (
    Date.parse(starObservedAt) > Date.parse(eventAt) ||
    Date.parse(eventAt) >= Date.parse(resultRecordedAt)
  ) {
    throw new Error(
      `Star observation, event and result times are invalid for ${eventId}.`,
    );
  }
  validateAssignment(input.gold, input.gateCount, "Gold");
  validateAssignment(input.blue, input.gateCount, "Blue");
  return {
    ...input,
    eventId,
    eraId,
    starObservedAt,
    eventAt,
    resultRecordedAt,
  };
}

function conversionRate(
  assignedFinishes: readonly number[],
  converted: (finishPosition: number) => boolean,
  minimumAssignedEvents: number,
): ConversionRate {
  const convertedCount = assignedFinishes.filter(converted).length;
  return {
    assignedCount: assignedFinishes.length,
    convertedCount,
    rate:
      assignedFinishes.length === 0
        ? null
        : rounded(convertedCount / assignedFinishes.length),
    evidenceStatus:
      assignedFinishes.length < minimumAssignedEvents
        ? "insufficient_sample"
        : "descriptive_ready",
  };
}

function summarize(
  values: readonly NormalizedObservation[],
  minimumAssignedEvents: number,
  mode: StarConversionSummary["mode"],
  distanceMeters: number | null,
  gateCount: number | null,
  eraId: StarConversionSummary["eraId"],
): StarConversionSummary {
  const complete = values.filter(
    ({ starDataStatus }) => starDataStatus === "complete",
  );
  const goldEligible = complete.filter(({ gateCount }) => gateCount > 3);
  const goldFinishes = goldEligible.flatMap(({ gold }) =>
    gold.status === "assigned" && gold.assignedCoreFinishPosition !== null
      ? [gold.assignedCoreFinishPosition]
      : [],
  );
  const blueFinishes = complete.flatMap(({ blue }) =>
    blue.status === "assigned" && blue.assignedCoreFinishPosition !== null
      ? [blue.assignedCoreFinishPosition]
      : [],
  );
  return {
    mode,
    distanceMeters,
    gateCount,
    eraId,
    eventCount: values.length,
    completeEventCount: complete.length,
    excludedEventCount: values.length - complete.length,
    goldEligibleEventCount: goldEligible.length,
    goldIneligibleEventCount: complete.length - goldEligible.length,
    ineligibleGoldAnomalyCount: complete.filter(
      ({ gateCount, gold }) => gateCount <= 3 && gold.status === "assigned",
    ).length,
    goldTopThree: conversionRate(
      goldFinishes,
      (finishPosition) => finishPosition <= 3,
      minimumAssignedEvents,
    ),
    blueWin: conversionRate(
      blueFinishes,
      (finishPosition) => finishPosition === 1,
      minimumAssignedEvents,
    ),
    blueTopThree: conversionRate(
      blueFinishes,
      (finishPosition) => finishPosition <= 3,
      minimumAssignedEvents,
    ),
    interpretation: "descriptive_only",
  };
}

export function buildStarConversionDiagnostics(
  inputs: readonly StarConversionObservation[],
  configuration: StarConversionConfiguration,
): StarConversionReport {
  if (
    !Number.isSafeInteger(configuration.minimumAssignedEvents) ||
    configuration.minimumAssignedEvents < 2
  ) {
    throw new Error("Minimum assigned events must be at least two.");
  }
  if (
    !["synthetic", "historical_holdout"].includes(configuration.evidenceSource)
  ) {
    throw new Error("Star conversion evidence source is invalid.");
  }
  const observations = inputs.map(normalizeObservation);
  if (
    new Set(observations.map(({ eventId }) => eventId)).size !==
    observations.length
  ) {
    throw new Error("Star conversion event IDs must be unique.");
  }

  const overall = summarize(
    observations,
    configuration.minimumAssignedEvents,
    "all",
    null,
    null,
    "all",
  );
  const grouped = new Map<string, NormalizedObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([
      observation.mode,
      observation.distanceMeters,
      observation.gateCount,
      observation.eraId,
    ]);
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }
  const exactCells = [...grouped.values()]
    .map((group) =>
      summarize(
        group,
        configuration.minimumAssignedEvents,
        group[0]!.mode,
        group[0]!.distanceMeters,
        group[0]!.gateCount,
        group[0]!.eraId,
      ),
    )
    .sort(
      (left, right) =>
        starConversionModes.indexOf(left.mode as StarConversionMode) -
          starConversionModes.indexOf(right.mode as StarConversionMode) ||
        left.distanceMeters! - right.distanceMeters! ||
        left.gateCount! - right.gateCount! ||
        left.eraId.localeCompare(right.eraId),
    );

  const warnings: StarConversionReport["warnings"][number][] = [
    "GATE_C_NOT_PASSED",
  ];
  if (configuration.evidenceSource === "synthetic") {
    warnings.push("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  }
  if (
    observations.some(({ starDataStatus }) => starDataStatus !== "complete")
  ) {
    warnings.push("PARTIAL_OR_INVALID_STAR_EVENTS_EXCLUDED");
  }
  if (overall.ineligibleGoldAnomalyCount > 0) {
    warnings.push("INELIGIBLE_GOLD_ASSIGNMENT_ANOMALY");
  }
  if (
    overall.goldTopThree.evidenceStatus === "insufficient_sample" ||
    overall.blueWin.evidenceStatus === "insufficient_sample"
  ) {
    warnings.push("INSUFFICIENT_CONVERSION_SAMPLE");
  }

  return {
    overall,
    exactCells,
    evidenceSource: configuration.evidenceSource,
    warnings,
    predictiveFeatureCreated: false,
    gateCStatus: "evidence_only",
    gateCPassed: false,
    actionableRecommendationsAllowed: false,
  };
}
