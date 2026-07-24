export const fieldRelativeModes = ["bike", "car", "horse"] as const;
export type FieldRelativeMode = (typeof fieldRelativeModes)[number];

export type FieldRelativeStarState =
  "received" | "not_received" | "not_assigned" | "excluded";

export type FieldRelativeStarObservation = Readonly<{
  observationId: string;
  eventId: string;
  coreId: string;
  eventAt: string;
  outcomeRecordedAt: string;
  featureCutoffAt: string;
  fieldQualityCutoffAt: string;
  mode: FieldRelativeMode;
  distanceMeters: number;
  gateCount: number;
  fieldQualityBand: "strong" | "typical" | "weak";
  competitiveTimeOutcome: boolean;
  starDataStatus: "complete" | "partial" | "invalid";
  goldState: FieldRelativeStarState;
  blueState: FieldRelativeStarState;
}>;

export type FieldRelativeStarConfiguration = Readonly<{
  minimumGroupObservations: number;
  evidenceSource: "synthetic" | "historical_holdout";
}>;

export type OutcomeGroup = Readonly<{
  observationCount: number;
  competitiveOutcomeCount: number;
  competitiveOutcomeRate: number | null;
}>;

export type SignalFieldAssociation = Readonly<{
  strongFieldReceived: OutcomeGroup;
  strongFieldNotReceived: OutcomeGroup;
  weakFieldReceived: OutcomeGroup;
  weakFieldNotReceived: OutcomeGroup;
  strongFieldRateDifference: number | null;
  weakFieldNoStarRateDifference: number | null;
  strongFieldStatus: "insufficient_sample" | "descriptive_ready";
  weakFieldStatus: "insufficient_sample" | "descriptive_ready";
  interpretation: "association_only";
}>;

export type FieldRelativeStarSummary = Readonly<{
  mode: FieldRelativeMode | "all";
  distanceMeters: number | null;
  totalObservationCount: number;
  completeObservationCount: number;
  excludedObservationCount: number;
  goldIneligibleObservationCount: number;
  gold: SignalFieldAssociation;
  blue: SignalFieldAssociation;
}>;

export type FieldRelativeStarReport = Readonly<{
  overall: FieldRelativeStarSummary;
  exactCells: readonly FieldRelativeStarSummary[];
  evidenceSource: FieldRelativeStarConfiguration["evidenceSource"];
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "SYNTHETIC_EVIDENCE_NON_DISPOSITIVE"
    | "PARTIAL_OR_INVALID_OBSERVATIONS_EXCLUDED"
    | "INSUFFICIENT_STRONG_FIELD_COMPARISON"
    | "INSUFFICIENT_WEAK_FIELD_COMPARISON"
  )[];
  causalClaimAllowed: false;
  stopOrBurnDecisionAllowed: false;
  gateCStatus: "evidence_only";
  gateCPassed: false;
  actionableRecommendationsAllowed: false;
}>;

type NormalizedObservation = Omit<
  FieldRelativeStarObservation,
  | "observationId"
  | "eventId"
  | "coreId"
  | "eventAt"
  | "outcomeRecordedAt"
  | "featureCutoffAt"
  | "fieldQualityCutoffAt"
> & {
  observationId: string;
  eventId: string;
  coreId: string;
  eventAt: string;
  outcomeRecordedAt: string;
  featureCutoffAt: string;
  fieldQualityCutoffAt: string;
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

function normalizeObservation(
  input: FieldRelativeStarObservation,
): NormalizedObservation {
  const observationId = required(input.observationId, "Observation ID");
  const eventId = required(input.eventId, "Event ID");
  const coreId = required(input.coreId, "Core ID");
  if (!fieldRelativeModes.includes(input.mode)) {
    throw new Error(`Field-relative mode is invalid for ${observationId}.`);
  }
  positiveSafeInteger(input.distanceMeters, "Distance metres");
  positiveSafeInteger(input.gateCount, "Gate count");
  if (!["strong", "typical", "weak"].includes(input.fieldQualityBand)) {
    throw new Error(`Field-quality band is invalid for ${observationId}.`);
  }
  if (typeof input.competitiveTimeOutcome !== "boolean") {
    throw new Error(`Competitive-time outcome must be Boolean.`);
  }
  if (!["complete", "partial", "invalid"].includes(input.starDataStatus)) {
    throw new Error(`Star data status is invalid for ${observationId}.`);
  }
  const validStates: readonly FieldRelativeStarState[] = [
    "received",
    "not_received",
    "not_assigned",
    "excluded",
  ];
  if (
    !validStates.includes(input.goldState) ||
    !validStates.includes(input.blueState)
  ) {
    throw new Error(`Field-relative star state is invalid.`);
  }
  if (input.gateCount <= 3 && input.goldState !== "excluded") {
    throw new Error(
      "Gold must be excluded from field-relative evidence at three gates or fewer.",
    );
  }

  const fieldQualityCutoffAt = timestamp(
    input.fieldQualityCutoffAt,
    "Field-quality cutoff",
  );
  const featureCutoffAt = timestamp(input.featureCutoffAt, "Feature cutoff");
  const eventAt = timestamp(input.eventAt, "Event time");
  const outcomeRecordedAt = timestamp(
    input.outcomeRecordedAt,
    "Outcome recorded time",
  );
  if (
    Date.parse(fieldQualityCutoffAt) > Date.parse(featureCutoffAt) ||
    Date.parse(featureCutoffAt) >= Date.parse(eventAt) ||
    Date.parse(eventAt) >= Date.parse(outcomeRecordedAt)
  ) {
    throw new Error(
      `Field quality, feature and outcome chronology is invalid for ${observationId}.`,
    );
  }

  return {
    ...input,
    observationId,
    eventId,
    coreId,
    fieldQualityCutoffAt,
    featureCutoffAt,
    eventAt,
    outcomeRecordedAt,
  };
}

function outcomeGroup(values: readonly NormalizedObservation[]): OutcomeGroup {
  const competitiveOutcomeCount = values.filter(
    ({ competitiveTimeOutcome }) => competitiveTimeOutcome,
  ).length;
  return {
    observationCount: values.length,
    competitiveOutcomeCount,
    competitiveOutcomeRate:
      values.length === 0
        ? null
        : rounded(competitiveOutcomeCount / values.length),
  };
}

function association(
  values: readonly NormalizedObservation[],
  signal: "goldState" | "blueState",
  minimumGroupObservations: number,
): SignalFieldAssociation {
  const eligible = values.filter(
    (value) =>
      value.starDataStatus === "complete" &&
      (signal === "blueState" || value.gateCount > 3),
  );
  const select = (
    band: "strong" | "weak",
    state: "received" | "not_received",
  ) =>
    eligible.filter(
      (value) => value.fieldQualityBand === band && value[signal] === state,
    );
  const strongFieldReceived = outcomeGroup(select("strong", "received"));
  const strongFieldNotReceived = outcomeGroup(select("strong", "not_received"));
  const weakFieldReceived = outcomeGroup(select("weak", "received"));
  const weakFieldNotReceived = outcomeGroup(select("weak", "not_received"));
  const strongFieldRateDifference =
    strongFieldReceived.competitiveOutcomeRate === null ||
    strongFieldNotReceived.competitiveOutcomeRate === null
      ? null
      : rounded(
          strongFieldReceived.competitiveOutcomeRate -
            strongFieldNotReceived.competitiveOutcomeRate,
        );
  const weakFieldNoStarRateDifference =
    weakFieldReceived.competitiveOutcomeRate === null ||
    weakFieldNotReceived.competitiveOutcomeRate === null
      ? null
      : rounded(
          weakFieldNotReceived.competitiveOutcomeRate -
            weakFieldReceived.competitiveOutcomeRate,
        );
  return {
    strongFieldReceived,
    strongFieldNotReceived,
    weakFieldReceived,
    weakFieldNotReceived,
    strongFieldRateDifference,
    weakFieldNoStarRateDifference,
    strongFieldStatus:
      strongFieldReceived.observationCount >= minimumGroupObservations &&
      strongFieldNotReceived.observationCount >= minimumGroupObservations
        ? "descriptive_ready"
        : "insufficient_sample",
    weakFieldStatus:
      weakFieldReceived.observationCount >= minimumGroupObservations &&
      weakFieldNotReceived.observationCount >= minimumGroupObservations
        ? "descriptive_ready"
        : "insufficient_sample",
    interpretation: "association_only",
  };
}

function summarize(
  values: readonly NormalizedObservation[],
  minimumGroupObservations: number,
  mode: FieldRelativeStarSummary["mode"],
  distanceMeters: number | null,
): FieldRelativeStarSummary {
  const complete = values.filter(
    ({ starDataStatus }) => starDataStatus === "complete",
  );
  return {
    mode,
    distanceMeters,
    totalObservationCount: values.length,
    completeObservationCount: complete.length,
    excludedObservationCount: values.length - complete.length,
    goldIneligibleObservationCount: complete.filter(
      ({ gateCount }) => gateCount <= 3,
    ).length,
    gold: association(values, "goldState", minimumGroupObservations),
    blue: association(values, "blueState", minimumGroupObservations),
  };
}

export function validateFieldRelativeStars(
  inputs: readonly FieldRelativeStarObservation[],
  configuration: FieldRelativeStarConfiguration,
): FieldRelativeStarReport {
  if (
    !Number.isSafeInteger(configuration.minimumGroupObservations) ||
    configuration.minimumGroupObservations < 2
  ) {
    throw new Error("Minimum group observations must be at least two.");
  }
  if (
    !["synthetic", "historical_holdout"].includes(configuration.evidenceSource)
  ) {
    throw new Error("Field-relative evidence source is invalid.");
  }
  const observations = inputs.map(normalizeObservation);
  if (
    new Set(observations.map(({ observationId }) => observationId)).size !==
    observations.length
  ) {
    throw new Error("Field-relative observation IDs must be unique.");
  }
  const eventCoreKeys = observations.map(({ eventId, coreId }) =>
    JSON.stringify([eventId, coreId]),
  );
  if (new Set(eventCoreKeys).size !== eventCoreKeys.length) {
    throw new Error(
      "Field-relative evidence must be unique by event and core.",
    );
  }

  const overall = summarize(
    observations,
    configuration.minimumGroupObservations,
    "all",
    null,
  );
  const grouped = new Map<string, NormalizedObservation[]>();
  for (const observation of observations) {
    const key = JSON.stringify([observation.mode, observation.distanceMeters]);
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }
  const exactCells = [...grouped.values()]
    .map((group) =>
      summarize(
        group,
        configuration.minimumGroupObservations,
        group[0]!.mode,
        group[0]!.distanceMeters,
      ),
    )
    .sort(
      (left, right) =>
        fieldRelativeModes.indexOf(left.mode as FieldRelativeMode) -
          fieldRelativeModes.indexOf(right.mode as FieldRelativeMode) ||
        left.distanceMeters! - right.distanceMeters!,
    );

  const warnings: FieldRelativeStarReport["warnings"][number][] = [
    "GATE_C_NOT_PASSED",
  ];
  if (configuration.evidenceSource === "synthetic") {
    warnings.push("SYNTHETIC_EVIDENCE_NON_DISPOSITIVE");
  }
  if (
    observations.some(({ starDataStatus }) => starDataStatus !== "complete")
  ) {
    warnings.push("PARTIAL_OR_INVALID_OBSERVATIONS_EXCLUDED");
  }
  if (
    overall.gold.strongFieldStatus === "insufficient_sample" ||
    overall.blue.strongFieldStatus === "insufficient_sample"
  ) {
    warnings.push("INSUFFICIENT_STRONG_FIELD_COMPARISON");
  }
  if (
    overall.gold.weakFieldStatus === "insufficient_sample" ||
    overall.blue.weakFieldStatus === "insufficient_sample"
  ) {
    warnings.push("INSUFFICIENT_WEAK_FIELD_COMPARISON");
  }

  return {
    overall,
    exactCells,
    evidenceSource: configuration.evidenceSource,
    warnings,
    causalClaimAllowed: false,
    stopOrBurnDecisionAllowed: false,
    gateCStatus: "evidence_only",
    gateCPassed: false,
    actionableRecommendationsAllowed: false,
  };
}
