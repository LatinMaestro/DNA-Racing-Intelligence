import { raceModes } from "@/domain/core-performance";
import type { ExactRaceProbabilityContext } from "@/domain/race-probability-baseline";

export type RacePredictionTarget =
  "win" | "place" | "blue_star" | "yellow_star";

export type RacePredictionEvidenceStatus =
  "complete" | "partial" | "insufficient" | "unavailable" | "not_applicable";

export type RacePredictionValue = Readonly<{
  coreId: string;
  target: RacePredictionTarget;
  status: "available" | "unavailable" | "review_required" | "not_applicable";
  probabilityMillionths: number | null;
  evidenceStatus: RacePredictionEvidenceStatus;
  calculationId: string | null;
}>;

export type FreezeRacePredictionSnapshotInput = Readonly<{
  snapshotId: string;
  eventId: string;
  predictedAt: string;
  eventStartsAt: string;
  evidenceCutoff: string;
  modelVersion: string;
  context: ExactRaceProbabilityContext;
  field: Readonly<{
    fieldVersion: string;
    fieldCapturedAt: string;
    enteredCoreIds: readonly string[];
  }>;
  sources: Readonly<{
    raceImportVersion: string;
    historicalAggregateVersion: string;
    fieldSourceVersion: string;
  }>;
  predictions: readonly RacePredictionValue[];
}>;

export type FrozenRacePredictionSnapshot = Readonly<{
  snapshotId: string;
  eventId: string;
  predictedAt: string;
  eventStartsAt: string;
  evidenceCutoff: string;
  modelVersion: string;
  context: ExactRaceProbabilityContext;
  field: Readonly<{
    fieldVersion: string;
    fieldCapturedAt: string;
    enteredCoreIds: readonly string[];
  }>;
  sources: FreezeRacePredictionSnapshotInput["sources"];
  predictions: readonly RacePredictionValue[];
  frozen: true;
  predictionMutationAllowed: false;
  sameEventEvidenceIncluded: false;
  observedOutcomeIncluded: false;
  fairExOddsIncluded: false;
  reconciliationStatus: "pending";
}>;

const TARGETS: readonly RacePredictionTarget[] = [
  "win",
  "place",
  "blue_star",
  "yellow_star",
];

const EVIDENCE_STATUSES: readonly RacePredictionEvidenceStatus[] = [
  "complete",
  "partial",
  "insufficient",
  "unavailable",
  "not_applicable",
];

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

function positiveSafeInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeContext(
  context: ExactRaceProbabilityContext,
): ExactRaceProbabilityContext {
  if (!raceModes.includes(context.mode))
    throw new Error("Race mode is invalid.");
  const distanceMeters = positiveSafeInteger(
    context.distanceMeters,
    "Distance metres",
  );
  const gateCount = positiveSafeInteger(context.gateCount, "Gate count");
  if (!(
    context.competition === "normal" || context.competition === "esports"
  )) {
    throw new Error("Competition is invalid.");
  }
  const format = required(context.format, "Race format");
  if (context.element.status === "known") {
    return {
      ...context,
      distanceMeters,
      gateCount,
      format,
      element: {
        status: "known",
        value: required(context.element.value, "Element"),
      },
    };
  }
  if (
    context.element.status !== "unknown" &&
    context.element.status !== "not_applicable"
  ) {
    throw new Error("Element status is invalid.");
  }
  return {
    ...context,
    distanceMeters,
    gateCount,
    format,
    element: { status: context.element.status, value: null },
  };
}

function rejectPostPredictionEvidence(input: object): void {
  const forbiddenKey = Object.keys(input).find((key) =>
    /^(actual|observed|result|winner|finish|revealed|fairEx|odds)/i.test(key),
  );
  if (forbiddenKey !== undefined) {
    throw new Error(
      "Frozen predictions cannot contain outcomes, revealed stars or FairEx odds.",
    );
  }
}

function normalizePrediction(
  prediction: RacePredictionValue,
  enteredCoreIds: readonly string[],
  gateCount: number,
): RacePredictionValue {
  rejectPostPredictionEvidence(prediction);
  const coreId = required(prediction.coreId, "Prediction Core ID");
  if (!enteredCoreIds.includes(coreId)) {
    throw new Error("Every prediction Core must belong to the frozen field.");
  }
  if (!TARGETS.includes(prediction.target)) {
    throw new Error("Prediction target is invalid.");
  }
  if (
    !["available", "unavailable", "review_required", "not_applicable"].includes(
      prediction.status,
    )
  ) {
    throw new Error("Prediction status is invalid.");
  }
  if (!EVIDENCE_STATUSES.includes(prediction.evidenceStatus)) {
    throw new Error("Prediction evidence status is invalid.");
  }

  const available = prediction.status === "available";
  if (
    available !==
    (Number.isSafeInteger(prediction.probabilityMillionths) &&
      prediction.probabilityMillionths !== null &&
      prediction.probabilityMillionths >= 0 &&
      prediction.probabilityMillionths <= 1_000_000)
  ) {
    throw new Error(
      "Only available predictions may carry a valid millionth probability.",
    );
  }
  if (available !== (prediction.calculationId !== null)) {
    throw new Error(
      "Only available predictions may bind a calculation identifier.",
    );
  }
  const calculationId =
    prediction.calculationId === null
      ? null
      : required(prediction.calculationId, "Calculation ID");
  if (
    prediction.status === "not_applicable" &&
    prediction.evidenceStatus !== "not_applicable"
  ) {
    throw new Error(
      "Not-applicable predictions require not-applicable evidence status.",
    );
  }
  if (
    prediction.status !== "not_applicable" &&
    prediction.evidenceStatus === "not_applicable"
  ) {
    throw new Error(
      "Not-applicable evidence status requires a not-applicable prediction.",
    );
  }
  if (
    prediction.target === "yellow_star" &&
    gateCount <= 3 &&
    prediction.status !== "not_applicable"
  ) {
    throw new Error("Yellow star is not applicable at three gates or fewer.");
  }

  return { ...prediction, coreId, calculationId };
}

export function freezeRacePredictionSnapshot(
  input: FreezeRacePredictionSnapshotInput,
): FrozenRacePredictionSnapshot {
  rejectPostPredictionEvidence(input);
  const snapshotId = required(input.snapshotId, "Snapshot ID");
  const eventId = required(input.eventId, "Event ID");
  const predictedAt = timestamp(input.predictedAt, "Prediction time");
  const eventStartsAt = timestamp(input.eventStartsAt, "Event start time");
  const evidenceCutoff = timestamp(input.evidenceCutoff, "Evidence cutoff");
  if (Date.parse(evidenceCutoff) > Date.parse(predictedAt)) {
    throw new Error("Evidence cutoff cannot follow prediction time.");
  }
  if (Date.parse(predictedAt) >= Date.parse(eventStartsAt)) {
    throw new Error("Predictions must be frozen before the event starts.");
  }

  const modelVersion = required(input.modelVersion, "Model version");
  const context = normalizeContext(input.context);
  const fieldVersion = required(input.field.fieldVersion, "Field version");
  const fieldCapturedAt = timestamp(
    input.field.fieldCapturedAt,
    "Field capture time",
  );
  if (Date.parse(fieldCapturedAt) > Date.parse(predictedAt)) {
    throw new Error("Field capture cannot follow prediction time.");
  }
  const enteredCoreIds = input.field.enteredCoreIds.map((coreId) =>
    required(coreId, "Entered Core ID"),
  );
  if (enteredCoreIds.length !== context.gateCount) {
    throw new Error("Frozen predictions require the complete entered field.");
  }
  if (new Set(enteredCoreIds).size !== enteredCoreIds.length) {
    throw new Error("Frozen field Core IDs must be unique.");
  }

  const sources = {
    raceImportVersion: required(
      input.sources.raceImportVersion,
      "Race import version",
    ),
    historicalAggregateVersion: required(
      input.sources.historicalAggregateVersion,
      "Historical aggregate version",
    ),
    fieldSourceVersion: required(
      input.sources.fieldSourceVersion,
      "Field source version",
    ),
  };
  const predictions = input.predictions.map((prediction) =>
    normalizePrediction(prediction, enteredCoreIds, context.gateCount),
  );
  if (predictions.length === 0) {
    throw new Error("At least one explicit prediction state is required.");
  }
  const keys = predictions.map(
    (prediction) => `${prediction.coreId}\u0000${prediction.target}`,
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error("A Core target may appear only once in a frozen snapshot.");
  }

  return {
    snapshotId,
    eventId,
    predictedAt,
    eventStartsAt,
    evidenceCutoff,
    modelVersion,
    context,
    field: { fieldVersion, fieldCapturedAt, enteredCoreIds },
    sources,
    predictions,
    frozen: true,
    predictionMutationAllowed: false,
    sameEventEvidenceIncluded: false,
    observedOutcomeIncluded: false,
    fairExOddsIncluded: false,
    reconciliationStatus: "pending",
  };
}
