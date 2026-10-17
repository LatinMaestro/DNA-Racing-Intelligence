import type {
  FrozenRacePredictionSnapshot,
  RacePredictionTarget,
} from "@/domain/race-prediction-snapshot";

export type AcceptedRacePredictionEntry = Readonly<{
  coreId: string;
  finishPosition: number | null;
  goldStar: boolean | null;
  blueStar: boolean | null;
}>;

export type AcceptedRacePredictionResult = Readonly<{
  eventId: string;
  sourceEvidenceId: string;
  sourceVersion: string;
  acceptedAt: string;
  eventCompletedAt: string;
  outcomeStatus: "complete" | "partial";
  starDataStatus: "complete" | "partial" | "missing" | "invalid";
  entries: readonly AcceptedRacePredictionEntry[];
}>;

export type RacePredictionScoreReason =
  | "prediction_available"
  | "prediction_unavailable"
  | "prediction_review_required"
  | "target_not_applicable"
  | "target_definition_unresolved"
  | "outcome_incomplete"
  | "star_data_incomplete"
  | "star_data_invalid";

export type RacePredictionTargetScore = Readonly<{
  coreId: string;
  target: RacePredictionTarget;
  predictionProbabilityMillionths: number | null;
  actual: boolean | null;
  scoringStatus: "scored" | "unscored";
  reason: RacePredictionScoreReason;
}>;

export type RacePredictionReconciliationProvenance = Readonly<{
  revision: number;
  sourceEvidenceId: string;
  sourceVersion: string;
  acceptedAt: string;
}>;

export type RacePredictionReconciliation = Readonly<{
  reconciliationId: string;
  snapshotId: string;
  eventId: string;
  sourceEvidenceId: string;
  sourceVersion: string;
  acceptedAt: string;
  eventCompletedAt: string;
  outcomeStatus: AcceptedRacePredictionResult["outcomeStatus"];
  starDataStatus: AcceptedRacePredictionResult["starDataStatus"];
  entries: readonly AcceptedRacePredictionEntry[];
  scores: readonly RacePredictionTargetScore[];
  recordStatus: "reconciled" | "review_required";
  issues: readonly string[];
  revision: number;
  correctsSourceEvidenceId: string | null;
  correctionHistory: readonly RacePredictionReconciliationProvenance[];
  frozenPredictionMutated: false;
  historyUpdateAllowed: boolean;
}>;

export type ApplyRacePredictionReconciliationInput = Readonly<{
  reconciliationId: string;
  snapshot: FrozenRacePredictionSnapshot;
  acceptedResult: AcceptedRacePredictionResult;
  revision: number;
  correctsSourceEvidenceId: string | null;
  previous: RacePredictionReconciliation | null;
}>;

export type ApplyRacePredictionReconciliationResult = Readonly<{
  applicationStatus: "created" | "idempotent" | "corrected";
  reconciliation: RacePredictionReconciliation;
}>;

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

function normalizeEntries(
  acceptedResult: AcceptedRacePredictionResult,
  snapshot: FrozenRacePredictionSnapshot,
): readonly AcceptedRacePredictionEntry[] {
  const byCoreId = new Map<string, AcceptedRacePredictionEntry>();
  for (const entry of acceptedResult.entries) {
    const coreId = required(entry.coreId, "Accepted-result Core ID");
    if (!snapshot.field.enteredCoreIds.includes(coreId)) {
      throw new Error("Accepted-result Core must belong to the frozen field.");
    }
    if (byCoreId.has(coreId)) {
      throw new Error("Accepted-result Core IDs must be unique.");
    }
    if (
      entry.finishPosition !== null &&
      (!Number.isSafeInteger(entry.finishPosition) ||
        entry.finishPosition <= 0 ||
        entry.finishPosition > snapshot.context.gateCount)
    ) {
      throw new Error("Accepted finish position is invalid.");
    }
    if (
      (entry.goldStar !== null && typeof entry.goldStar !== "boolean") ||
      (entry.blueStar !== null && typeof entry.blueStar !== "boolean")
    ) {
      throw new Error("Accepted star values must be Boolean or null.");
    }
    byCoreId.set(coreId, { ...entry, coreId });
  }

  return snapshot.field.enteredCoreIds.flatMap((coreId) => {
    const entry = byCoreId.get(coreId);
    return entry === undefined ? [] : [entry];
  });
}

function factsEqual(
  previous: RacePredictionReconciliation,
  candidate: Omit<
    RacePredictionReconciliation,
    "correctionHistory" | "revision"
  >,
): boolean {
  return (
    previous.reconciliationId === candidate.reconciliationId &&
    previous.snapshotId === candidate.snapshotId &&
    previous.eventId === candidate.eventId &&
    previous.sourceEvidenceId === candidate.sourceEvidenceId &&
    previous.sourceVersion === candidate.sourceVersion &&
    previous.acceptedAt === candidate.acceptedAt &&
    previous.eventCompletedAt === candidate.eventCompletedAt &&
    previous.outcomeStatus === candidate.outcomeStatus &&
    previous.starDataStatus === candidate.starDataStatus &&
    JSON.stringify(previous.entries) === JSON.stringify(candidate.entries) &&
    JSON.stringify(previous.scores) === JSON.stringify(candidate.scores) &&
    previous.recordStatus === candidate.recordStatus &&
    JSON.stringify(previous.issues) === JSON.stringify(candidate.issues) &&
    previous.correctsSourceEvidenceId === candidate.correctsSourceEvidenceId
  );
}

function scoreReason(
  status: FrozenRacePredictionSnapshot["predictions"][number]["status"],
): RacePredictionScoreReason | null {
  if (status === "unavailable") return "prediction_unavailable";
  if (status === "review_required") return "prediction_review_required";
  if (status === "not_applicable") return "target_not_applicable";
  return null;
}

export function applyRacePredictionReconciliation(
  input: ApplyRacePredictionReconciliationInput,
): ApplyRacePredictionReconciliationResult {
  const reconciliationId = required(
    input.reconciliationId,
    "Reconciliation ID",
  );
  const snapshotId = required(input.snapshot.snapshotId, "Snapshot ID");
  if (
    !input.snapshot.frozen ||
    input.snapshot.reconciliationStatus !== "pending"
  ) {
    throw new Error("Only a frozen pending prediction snapshot can reconcile.");
  }
  const eventId = required(input.acceptedResult.eventId, "Event ID");
  if (eventId !== input.snapshot.eventId) {
    throw new Error("Accepted result must match the frozen event identity.");
  }
  const sourceEvidenceId = required(
    input.acceptedResult.sourceEvidenceId,
    "Source evidence ID",
  );
  const sourceVersion = required(
    input.acceptedResult.sourceVersion,
    "Source version",
  );
  const acceptedAt = timestamp(
    input.acceptedResult.acceptedAt,
    "Accepted time",
  );
  const eventCompletedAt = timestamp(
    input.acceptedResult.eventCompletedAt,
    "Event completion time",
  );
  if (Date.parse(eventCompletedAt) < Date.parse(input.snapshot.predictedAt)) {
    throw new Error("Accepted result cannot predate the frozen prediction.");
  }
  if (Date.parse(acceptedAt) < Date.parse(eventCompletedAt)) {
    throw new Error("Accepted time cannot predate event completion.");
  }
  if (
    !(["complete", "partial"] as const).includes(
      input.acceptedResult.outcomeStatus,
    )
  ) {
    throw new Error("Outcome status is invalid.");
  }
  if (
    !(["complete", "partial", "missing", "invalid"] as const).includes(
      input.acceptedResult.starDataStatus,
    )
  ) {
    throw new Error("Star-data status is invalid.");
  }
  if (!Number.isSafeInteger(input.revision) || input.revision < 0) {
    throw new Error(
      "Reconciliation revision must be a non-negative safe integer.",
    );
  }

  const entries = normalizeEntries(input.acceptedResult, input.snapshot);
  const issues: string[] = [];
  const completeOutcome =
    input.acceptedResult.outcomeStatus === "complete" &&
    entries.length === input.snapshot.context.gateCount &&
    entries.every(({ finishPosition }) => finishPosition !== null) &&
    new Set(entries.map(({ finishPosition }) => finishPosition)).size ===
      input.snapshot.context.gateCount;
  if (!completeOutcome) {
    issues.push("Accepted finish outcomes are incomplete or inconsistent.");
  }

  const yellowAssignments = entries.filter(({ goldStar }) => goldStar === true);
  const blueAssignments = entries.filter(({ blueStar }) => blueStar === true);
  const completeStars =
    input.acceptedResult.starDataStatus === "complete" &&
    entries.length === input.snapshot.context.gateCount &&
    entries.every(
      ({ goldStar, blueStar }) => goldStar !== null && blueStar !== null,
    );
  let validYellow = completeStars && yellowAssignments.length <= 1;
  const validBlue = completeStars && blueAssignments.length <= 1;
  if (input.snapshot.context.gateCount <= 3 && yellowAssignments.length > 0) {
    validYellow = false;
    issues.push(
      "Accepted Yellow/source-Gold assignment is anomalous at three gates or fewer.",
    );
  }
  if (yellowAssignments.length > 1) {
    issues.push(
      "Accepted result contains multiple Yellow/source-Gold assignments.",
    );
  }
  if (blueAssignments.length > 1) {
    issues.push("Accepted result contains multiple Blue assignments.");
  }
  if (input.acceptedResult.starDataStatus === "invalid") {
    issues.push("Accepted star data is marked invalid.");
  } else if (!completeStars) {
    issues.push("Accepted star data is incomplete.");
  }

  const entryByCoreId = new Map(entries.map((entry) => [entry.coreId, entry]));
  const scores = input.snapshot.predictions.map((prediction) => {
    const unavailableReason = scoreReason(prediction.status);
    if (unavailableReason !== null) {
      return {
        coreId: prediction.coreId,
        target: prediction.target,
        predictionProbabilityMillionths: prediction.probabilityMillionths,
        actual: null,
        scoringStatus: "unscored" as const,
        reason: unavailableReason,
      };
    }
    if (prediction.target === "place") {
      return {
        coreId: prediction.coreId,
        target: prediction.target,
        predictionProbabilityMillionths: prediction.probabilityMillionths,
        actual: null,
        scoringStatus: "unscored" as const,
        reason: "target_definition_unresolved" as const,
      };
    }
    const entry = entryByCoreId.get(prediction.coreId);
    if (prediction.target === "win") {
      return completeOutcome && entry?.finishPosition !== null
        ? {
            coreId: prediction.coreId,
            target: prediction.target,
            predictionProbabilityMillionths: prediction.probabilityMillionths,
            actual: entry?.finishPosition === 1,
            scoringStatus: "scored" as const,
            reason: "prediction_available" as const,
          }
        : {
            coreId: prediction.coreId,
            target: prediction.target,
            predictionProbabilityMillionths: prediction.probabilityMillionths,
            actual: null,
            scoringStatus: "unscored" as const,
            reason: "outcome_incomplete" as const,
          };
    }
    const validStarTarget =
      prediction.target === "yellow_star" ? validYellow : validBlue;
    return validStarTarget && entry !== undefined
      ? {
          coreId: prediction.coreId,
          target: prediction.target,
          predictionProbabilityMillionths: prediction.probabilityMillionths,
          actual:
            prediction.target === "yellow_star"
              ? entry.goldStar === true
              : entry.blueStar === true,
          scoringStatus: "scored" as const,
          reason: "prediction_available" as const,
        }
      : {
          coreId: prediction.coreId,
          target: prediction.target,
          predictionProbabilityMillionths: prediction.probabilityMillionths,
          actual: null,
          scoringStatus: "unscored" as const,
          reason:
            input.acceptedResult.starDataStatus === "invalid" ||
            (prediction.target === "yellow_star" &&
              input.snapshot.context.gateCount <= 3 &&
              yellowAssignments.length > 0) ||
            (prediction.target === "yellow_star" &&
              yellowAssignments.length > 1) ||
            (prediction.target === "blue_star" && blueAssignments.length > 1)
              ? ("star_data_invalid" as const)
              : ("star_data_incomplete" as const),
        };
  });

  const recordStatus =
    issues.length === 0
      ? ("reconciled" as const)
      : ("review_required" as const);
  const candidate = {
    reconciliationId,
    snapshotId,
    eventId,
    sourceEvidenceId,
    sourceVersion,
    acceptedAt,
    eventCompletedAt,
    outcomeStatus: input.acceptedResult.outcomeStatus,
    starDataStatus: input.acceptedResult.starDataStatus,
    entries,
    scores,
    recordStatus,
    issues,
    correctsSourceEvidenceId: input.correctsSourceEvidenceId,
    frozenPredictionMutated: false as const,
    historyUpdateAllowed: recordStatus === "reconciled",
  };

  if (input.previous === null) {
    if (input.revision !== 0 || input.correctsSourceEvidenceId !== null) {
      throw new Error(
        "Initial reconciliation must use revision zero without correction.",
      );
    }
    return {
      applicationStatus: "created",
      reconciliation: {
        ...candidate,
        revision: 0,
        correctionHistory: [],
      },
    };
  }

  if (
    input.previous.snapshotId !== snapshotId ||
    input.previous.eventId !== eventId ||
    input.previous.reconciliationId !== reconciliationId
  ) {
    throw new Error("Previous reconciliation identity does not match.");
  }
  if (input.previous.sourceEvidenceId === sourceEvidenceId) {
    if (
      input.revision === input.previous.revision &&
      input.correctsSourceEvidenceId ===
        input.previous.correctsSourceEvidenceId &&
      factsEqual(input.previous, candidate)
    ) {
      return {
        applicationStatus: "idempotent",
        reconciliation: input.previous,
      };
    }
    throw new Error(
      "Source evidence identity was reused with conflicting facts.",
    );
  }
  if (
    input.revision !== input.previous.revision + 1 ||
    input.correctsSourceEvidenceId !== input.previous.sourceEvidenceId
  ) {
    throw new Error(
      "Correction must extend the exact previous reconciliation.",
    );
  }
  if (Date.parse(acceptedAt) < Date.parse(input.previous.acceptedAt)) {
    throw new Error(
      "Correction acceptance cannot predate previous acceptance.",
    );
  }

  return {
    applicationStatus: "corrected",
    reconciliation: {
      ...candidate,
      revision: input.revision,
      correctionHistory: [
        ...input.previous.correctionHistory,
        {
          revision: input.previous.revision,
          sourceEvidenceId: input.previous.sourceEvidenceId,
          sourceVersion: input.previous.sourceVersion,
          acceptedAt: input.previous.acceptedAt,
        },
      ],
    },
  };
}
