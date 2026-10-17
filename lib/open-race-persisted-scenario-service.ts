import {
  evaluateOpenRaceCandidateScenarios,
  type OpenRaceCandidateScenarioResult,
} from "@/domain/open-race-candidate-scenarios";
import {
  normalizeExactRaceProbabilityContext,
  type EmpiricalRaceTimeObservation,
  type ExactRaceProbabilityContext,
} from "@/domain/race-probability-baseline";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

const SHA_256 = /^[a-f0-9]{64}$/u;

type CoreHistory = Readonly<{
  coreId: string;
  observations: readonly EmpiricalRaceTimeObservation[];
}>;

/**
 * This input may be supplied only by a future accepted, version-bound
 * historical-evidence reader. The compact Open Race session is not a raw
 * historical time source and cannot itself establish competition or element.
 */
export type AcceptedOpenRaceScenarioEvidence = Readonly<{
  authenticatedOwnerId: string;
  sessionVersion: string;
  fieldVersion: string;
  eligibilityVersion: string;
  rankingVersion: string;
  raceImportVersion: string;
  vaultSnapshotVersion: string;
  historicalAggregateVersion: string;
  historyGenerationVersion: string;
  historySourceIdentitySha256: string;
  evidenceCutoff: string;
  modelVersion: string;
  context: ExactRaceProbabilityContext | null;
  candidateHistories: readonly CoreHistory[];
  opponentHistories: readonly CoreHistory[];
}>;

export type PersistedOpenRaceScenarioView =
  | Readonly<{
      status: "unavailable";
      reason:
        | "NOT_FORMING"
        | "NO_ACCEPTED_RANKING"
        | "FIELD_REVIEW_REQUIRED"
        | "HISTORICAL_EVIDENCE_UNAVAILABLE"
        | "EXACT_CONTEXT_UNAVAILABLE"
        | "INCOMPLETE_CORE_HISTORY";
      scenario: null;
    }>
  | Readonly<{
      status: "experimental";
      reason: null;
      scenario: OpenRaceCandidateScenarioResult;
    }>;

type UnavailableReason = Extract<
  PersistedOpenRaceScenarioView,
  { status: "unavailable" }
>["reason"];

function unavailable(reason: UnavailableReason): PersistedOpenRaceScenarioView {
  return { status: "unavailable", reason, scenario: null };
}

function exactHistorySet(
  histories: readonly CoreHistory[],
  coreIds: readonly string[],
): boolean {
  return (
    histories.length === coreIds.length &&
    new Set(histories.map(({ coreId }) => coreId)).size === histories.length &&
    histories.every(
      ({ coreId, observations }) =>
        coreIds.includes(coreId) && Array.isArray(observations),
    )
  );
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
 * Compose the already-approved empirical pairwise diagnostics from a
 * validated persisted Stage A session, but only with separate, complete
 * accepted exact-context historical observations.
 *
 * No provider access, UI activation, combined field probability,
 * recommendation, race entry, odds, star prediction or economic action.
 */
export function composePersistedOpenRaceCandidateScenario(
  authenticatedOwnerId: string,
  session: OpenRaceWorkspaceSession,
  accepted: AcceptedOpenRaceScenarioEvidence | null,
): PersistedOpenRaceScenarioView {
  if (authenticatedOwnerId.trim() === "") {
    throw new Error("Open Race scenario requires an authenticated owner.");
  }
  if (session.stage !== "provisional_selection" || session.lock !== null) {
    return unavailable("NOT_FORMING");
  }
  if (session.ranking === null || session.bindings.rankingVersion === null) {
    return unavailable("NO_ACCEPTED_RANKING");
  }
  if (
    session.field.status !== "ready_for_provisional_selection" ||
    session.field.freshness !== "current" ||
    session.eligibility.freshness !== "current"
  ) {
    return unavailable("FIELD_REVIEW_REQUIRED");
  }
  if (session.field.probabilityContext === null) {
    return unavailable("EXACT_CONTEXT_UNAVAILABLE");
  }
  if (accepted === null) {
    return unavailable("HISTORICAL_EVIDENCE_UNAVAILABLE");
  }
  if (accepted.authenticatedOwnerId !== authenticatedOwnerId) {
    throw new Error("Open Race scenario source owner mismatch.");
  }
  if (
    accepted.historyGenerationVersion.trim() === "" ||
    !SHA_256.test(accepted.historySourceIdentitySha256)
  ) {
    throw new Error("Open Race scenario history source identity is invalid.");
  }

  const bindings = session.bindings;
  if (
    accepted.sessionVersion !== bindings.sessionVersion ||
    accepted.fieldVersion !== bindings.fieldVersion ||
    accepted.eligibilityVersion !== bindings.eligibilityVersion ||
    accepted.rankingVersion !== bindings.rankingVersion ||
    accepted.raceImportVersion !== bindings.raceImportVersion ||
    accepted.vaultSnapshotVersion !== bindings.vaultSnapshotVersion ||
    accepted.historicalAggregateVersion !==
      bindings.historicalAggregateVersion ||
    accepted.evidenceCutoff !== session.field.dataCurrentThrough
  ) {
    throw new Error("Open Race accepted scenario source identity has changed.");
  }

  const context =
    accepted.context === null
      ? null
      : normalizeExactRaceProbabilityContext(accepted.context);
  if (context === null) return unavailable("EXACT_CONTEXT_UNAVAILABLE");
  if (
    !sameContext(
      context,
      normalizeExactRaceProbabilityContext(session.field.probabilityContext),
    )
  ) {
    throw new Error(
      "Open Race accepted scenario context differs from the saved field.",
    );
  }

  const candidateCoreIds = session.ranking.rankedCandidates.map(
    ({ coreId }) => coreId,
  );
  const opponentCoreIds = session.field.opponentCoreIds;
  if (
    candidateCoreIds.length === 0 ||
    !candidateCoreIds.every((coreId) =>
      session.eligibility.eligibleCoreIds.includes(coreId),
    )
  ) {
    return unavailable("FIELD_REVIEW_REQUIRED");
  }
  if (
    !exactHistorySet(accepted.candidateHistories, candidateCoreIds) ||
    !exactHistorySet(accepted.opponentHistories, opponentCoreIds)
  ) {
    return unavailable("INCOMPLETE_CORE_HISTORY");
  }
  const candidateHistories = new Map(
    accepted.candidateHistories.map(({ coreId, observations }) => [
      coreId,
      observations,
    ]),
  );
  const opponentHistories = new Map(
    accepted.opponentHistories.map(({ coreId, observations }) => [
      coreId,
      observations,
    ]),
  );
  const scenario = evaluateOpenRaceCandidateScenarios({
    scenarioId: JSON.stringify([
      session.field.requestId,
      bindings.sessionVersion,
      bindings.fieldVersion,
      bindings.rankingVersion,
      bindings.historicalAggregateVersion,
      accepted.historyGenerationVersion,
      accepted.historySourceIdentitySha256,
      accepted.modelVersion,
    ]),
    modelVersion: accepted.modelVersion,
    evaluatedAt: session.ranking.evaluatedAt,
    evidenceCutoff: accepted.evidenceCutoff,
    context,
    field: {
      fieldVersion: bindings.fieldVersion,
      fieldCapturedAt: session.field.capturedAt,
      stage: "forming",
      enteredOpponents: opponentCoreIds.map((coreId, index) => ({
        // This is an internal stable ordinal, not an inferred game gate ID.
        entryId: JSON.stringify([bindings.fieldVersion, index]),
        identityStatus: "confirmed" as const,
        coreId,
        observations: opponentHistories.get(coreId)!,
      })),
    },
    candidates: candidateCoreIds.map((coreId) => ({
      coreId,
      eligibilityStatus: "eligible" as const,
      observations: candidateHistories.get(coreId)!,
    })),
  });
  return { status: "experimental", reason: null, scenario };
}
