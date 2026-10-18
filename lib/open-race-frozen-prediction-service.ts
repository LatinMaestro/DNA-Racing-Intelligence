import {
  freezeRacePredictionSnapshot,
  type FrozenRacePredictionSnapshot,
  type RacePredictionValue,
} from "@/domain/race-prediction-snapshot";
import {
  normalizeExactRaceProbabilityContext,
  type ExactRaceProbabilityContext,
} from "@/domain/race-probability-baseline";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const SHA_256 = /^[a-f0-9]{64}$/u;
const REQUIRED_TARGETS = ["win", "place", "blue_star", "yellow_star"] as const;

export type AcceptedOpenRacePredictionEvidence = Readonly<{
  authenticatedOwnerId: string;
  sessionVersion: string;
  fieldVersion: string;
  eligibilityVersion: string;
  rankingVersion: string;
  lockVersion: string;
  raceImportVersion: string;
  vaultSnapshotVersion: string;
  historicalAggregateVersion: string;
  historyGenerationVersion: string;
  historySourceIdentitySha256: string;
  predictedAt: string;
  evidenceCutoff: string;
  modelVersion: string;
  context: ExactRaceProbabilityContext;
  predictions: readonly RacePredictionValue[];
}>;

export type PersistedOpenRaceFrozenPredictionView =
  | Readonly<{
      status: "unavailable";
      reason:
        | "NOT_LOCKED"
        | "EVENT_IDENTITY_UNAVAILABLE"
        | "EVENT_SCHEDULE_UNAVAILABLE"
        | "EXACT_CONTEXT_UNAVAILABLE"
        | "PREDICTION_EVIDENCE_UNAVAILABLE";
      snapshot: null;
    }>
  | Readonly<{
      status: "frozen";
      reason: null;
      snapshot: FrozenRacePredictionSnapshot;
    }>;

type UnavailableReason = Extract<
  PersistedOpenRaceFrozenPredictionView,
  { status: "unavailable" }
>["reason"];

function unavailable(
  reason: UnavailableReason,
): PersistedOpenRaceFrozenPredictionView {
  return { status: "unavailable", reason, snapshot: null };
}

function sameContext(
  left: ExactRaceProbabilityContext,
  right: ExactRaceProbabilityContext,
): boolean {
  return (
    left.mode === right.mode &&
    left.distanceMeters === right.distanceMeters &&
    left.competition === right.competition &&
    left.format === right.format &&
    left.gateCount === right.gateCount &&
    left.element.status === right.element.status &&
    left.element.value === right.element.value
  );
}

/**
 * Binds already-accepted target evidence to one complete, immutable Open Race
 * field. This service does not calculate or substitute probabilities. Missing
 * targets must remain explicit unavailable/not-applicable states.
 */
export function freezePersistedOpenRacePrediction(
  authenticatedOwnerId: string,
  session: OpenRaceWorkspaceSession,
  accepted: AcceptedOpenRacePredictionEvidence | null,
): PersistedOpenRaceFrozenPredictionView {
  const ownerId = authenticatedOwnerId.trim();
  if (ownerId === "") {
    throw new Error(
      "Open Race prediction freeze requires an authenticated owner.",
    );
  }
  if (
    session.stage !== "locked_observation" ||
    session.lock === null ||
    session.ranking === null ||
    session.observation !== null ||
    session.comparison !== null ||
    session.bindings.rankingVersion === null ||
    session.bindings.lockVersion === null
  ) {
    return unavailable("NOT_LOCKED");
  }
  if (session.field.eventIdentity.status !== "confirmed") {
    return unavailable("EVENT_IDENTITY_UNAVAILABLE");
  }
  if (session.field.eventStartsAt === null) {
    return unavailable("EVENT_SCHEDULE_UNAVAILABLE");
  }
  if (session.field.probabilityContext === null) {
    return unavailable("EXACT_CONTEXT_UNAVAILABLE");
  }
  if (accepted === null) {
    return unavailable("PREDICTION_EVIDENCE_UNAVAILABLE");
  }
  if (accepted.authenticatedOwnerId !== ownerId) {
    throw new Error("Open Race prediction source owner mismatch.");
  }

  const bindings = session.bindings;
  if (
    accepted.sessionVersion !== bindings.sessionVersion ||
    accepted.fieldVersion !== bindings.fieldVersion ||
    accepted.eligibilityVersion !== bindings.eligibilityVersion ||
    accepted.rankingVersion !== bindings.rankingVersion ||
    accepted.lockVersion !== bindings.lockVersion ||
    accepted.raceImportVersion !== bindings.raceImportVersion ||
    accepted.vaultSnapshotVersion !== bindings.vaultSnapshotVersion ||
    accepted.historicalAggregateVersion !==
      bindings.historicalAggregateVersion ||
    accepted.evidenceCutoff !== session.field.dataCurrentThrough
  ) {
    throw new Error(
      "Open Race accepted prediction source identity has changed.",
    );
  }
  if (
    accepted.historyGenerationVersion.trim() === "" ||
    !SHA_256.test(accepted.historySourceIdentitySha256)
  ) {
    throw new Error("Open Race prediction history source identity is invalid.");
  }
  const context = normalizeExactRaceProbabilityContext(accepted.context);
  if (
    !sameContext(
      context,
      normalizeExactRaceProbabilityContext(session.field.probabilityContext),
    )
  ) {
    throw new Error(
      "Open Race accepted prediction context differs from the locked field.",
    );
  }
  if (Date.parse(accepted.predictedAt) < Date.parse(session.lock.lockedAt)) {
    throw new Error(
      "Open Race prediction cannot predate the complete field lock.",
    );
  }

  const selectedCoreId = session.lock.selectedOwnedCoreId;
  const predictionTargets = accepted.predictions.map((prediction) => {
    if (prediction.coreId !== selectedCoreId) {
      throw new Error(
        "Open Race frozen targets must belong to the committed owned Core.",
      );
    }
    return prediction.target;
  });
  if (
    accepted.predictions.length !== REQUIRED_TARGETS.length ||
    !REQUIRED_TARGETS.every((target) => predictionTargets.includes(target))
  ) {
    throw new Error(
      "Open Race freeze requires every target to have an explicit state.",
    );
  }

  const snapshot = freezeRacePredictionSnapshot({
    snapshotId: JSON.stringify([
      session.field.eventIdentity.eventId,
      bindings.sessionVersion,
      bindings.lockVersion,
      accepted.modelVersion,
      accepted.historySourceIdentitySha256,
    ]),
    eventId: session.field.eventIdentity.eventId,
    predictedAt: accepted.predictedAt,
    eventStartsAt: session.field.eventStartsAt,
    evidenceCutoff: accepted.evidenceCutoff,
    modelVersion: accepted.modelVersion,
    context,
    field: {
      fieldVersion: bindings.fieldVersion,
      fieldCapturedAt: session.field.capturedAt,
      enteredCoreIds: session.lock.enteredCoreIds,
    },
    sources: {
      raceImportVersion: bindings.raceImportVersion,
      historicalAggregateVersion: bindings.historicalAggregateVersion,
      historyGenerationVersion: accepted.historyGenerationVersion,
      historySourceIdentitySha256: accepted.historySourceIdentitySha256,
      fieldSourceVersion: bindings.lockVersion,
    },
    predictions: accepted.predictions,
  });
  return { status: "frozen", reason: null, snapshot };
}
