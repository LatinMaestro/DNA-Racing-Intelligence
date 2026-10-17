import {
  evaluateOpenRaceCandidateScenarios,
  type OpenRaceCandidateScenarioResult,
} from "@/domain/open-race-candidate-scenarios";
import type {
  EmpiricalRaceTimeObservation,
  ExactRaceProbabilityContext,
} from "@/domain/race-probability-baseline";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

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
  sessionVersion: string;
  fieldVersion: string;
  eligibilityVersion: string;
  rankingVersion: string;
  raceImportVersion: string;
  vaultSnapshotVersion: string;
  historicalAggregateVersion: string;
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

function unavailable(
  reason: Extract<PersistedOpenRaceScenarioView, { status: "unavailable" }>["reason"],
): PersistedOpenRaceScenarioView {
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

/**
 * Compose the already-approved empirical pairwise diagnostics from a
 * validated persisted Stage A session, but only with separate, complete
 * accepted exact-context historical observations.
 *
 * No provider access, UI activation, combined field probability,
 * recommendation, race entry, odds, star prediction or economic action.
 */
export function composePersistedOpenRaceCandidateScenario(
  session: OpenRaceWorkspaceSession,
  accepted: AcceptedOpenRaceScenarioEvidence | null,
): PersistedOpenRaceScenarioView {
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
  if (accepted === null) {
    return unavailable("HISTORICAL_EVIDENCE_UNAVAILABLE");
  }

  const bindings = session.bindings;
  if (
    accepted.sessionVersion !== bindings.sessionVersion ||
    accepted.fieldVersion !== bindings.fieldVersion ||
    accepted.eligibilityVersion !== bindings.eligibilityVersion ||
    accepted.rankingVersion !== bindings.rankingVersion ||
    accepted.raceImportVersion !== bindings.raceImportVersion ||
    accepted.vaultSnapshotVersion !== bindings.vaultSnapshotVersion ||
    accepted.historicalAggregateVersion !== bindings.historicalAggregateVersion ||
    accepted.evidenceCutoff !== session.field.dataCurrentThrough
  ) {
    throw new Error("Open Race accepted scenario source identity has changed.");
  }

  const context = accepted.context;
  if (context === null) return unavailable("EXACT_CONTEXT_UNAVAILABLE");
  if (
    context.mode !== session.field.mode ||
    context.distanceMeters !== session.field.distanceMeters ||
    context.format !== session.field.raceFormat ||
    context.gateCount !== session.field.gateCount
  ) {
    throw new Error("Open Race accepted scenario context differs from the saved field.");
  }
  const elementRestrictions = session.field.restrictions.filter(
    ({ kind, evidenceStatus }) =>
      kind === "element" && evidenceStatus === "confirmed",
  );
  if (
    elementRestrictions.length > 0 &&
    (context.element.status !== "known" ||
      elementRestrictions.some(
        ({ value }) => context.element.status !== "known" || context.element.value !== value,
      ))
  ) {
    throw new Error("Open Race accepted element context differs from the saved restrictions.");
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
