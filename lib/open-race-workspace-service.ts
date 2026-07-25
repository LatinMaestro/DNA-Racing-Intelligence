import {
  evaluateOpenRaceEligibility,
  type OpenRaceEligibilityInput,
  type OpenRaceEligibilityResult,
} from "@/domain/open-race-eligibility";
import {
  validateOpenRaceField,
  type OpenRaceFieldInput,
  type OpenRaceFieldResult,
} from "@/domain/open-race-field-input";
import {
  lockOpenRaceField,
  type OpenRaceFieldLockInput,
  type OpenRaceFieldLockResult,
} from "@/domain/open-race-field-lock";
import {
  rankOpenRacePreEntry,
  type OpenRacePreEntryRankingInput,
  type OpenRacePreEntryRankingResult,
} from "@/domain/open-race-pre-entry-ranking";
import {
  compareOpenRaceStars,
  type OpenRaceStarComparisonInput,
  type OpenRaceStarComparisonResult,
} from "@/domain/open-race-star-comparison";
import {
  recordOpenRaceStarObservation,
  type OpenRaceStarObservationInput,
  type OpenRaceStarObservationResult,
} from "@/domain/open-race-star-observation";

export type OpenRaceWorkspaceEvidence = Readonly<{
  field: OpenRaceFieldInput;
  eligibility: OpenRaceEligibilityInput;
  ranking: OpenRacePreEntryRankingInput | null;
  lock: OpenRaceFieldLockInput | null;
  observation: OpenRaceStarObservationInput | null;
  comparison: OpenRaceStarComparisonInput | null;
}>;

export type OpenRaceWorkspaceSession = Readonly<{
  stage:
    | "field_forming"
    | "provisional_selection"
    | "locked_observation"
    | "observation_recorded"
    | "observation_compared";
  field: OpenRaceFieldResult;
  eligibility: OpenRaceEligibilityResult;
  ranking: OpenRacePreEntryRankingResult | null;
  lock: OpenRaceFieldLockResult | null;
  observation: OpenRaceStarObservationResult | null;
  comparison: OpenRaceStarComparisonResult | null;
  mutationAllowed: false;
  liveGameConnection: false;
  gateCPassed: false;
}>;

export type OpenRaceWorkspaceRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listSessionEvidenceByOwner: (
        ownerId: string,
      ) => Promise<readonly OpenRaceWorkspaceEvidence[]>;
    }>;

export type OpenRaceWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type OpenRaceWorkspacePageState = Readonly<{
  sessions: readonly OpenRaceWorkspaceSession[];
  connectionStatus: OpenRaceWorkspaceConnectionStatus;
}>;

export const unavailableOpenRaceWorkspaceRepository: OpenRaceWorkspaceRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function sameValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  const sortedLeft = [...left].sort();
  const sortedRight = [...right].sort();
  return (
    sortedLeft.length === sortedRight.length &&
    sortedLeft.every((value, index) => value === sortedRight[index])
  );
}

function baseSession(
  field: OpenRaceFieldResult,
  eligibility: OpenRaceEligibilityResult,
) {
  return {
    field,
    eligibility,
    mutationAllowed: false as const,
    liveGameConnection: false as const,
    gateCPassed: false as const,
  };
}

function composeSession(
  evidence: OpenRaceWorkspaceEvidence,
): OpenRaceWorkspaceSession {
  const field = validateOpenRaceField(evidence.field);
  const eligibility = evaluateOpenRaceEligibility(evidence.eligibility);
  const base = baseSession(field, eligibility);

  if (evidence.ranking === null) {
    if (
      evidence.lock !== null ||
      evidence.observation !== null ||
      evidence.comparison !== null
    ) {
      throw new Error(
        "Open Race field lock and observations require a pre-entry ranking.",
      );
    }
    return {
      ...base,
      stage: "field_forming",
      ranking: null,
      lock: null,
      observation: null,
      comparison: null,
    };
  }

  const ranking = rankOpenRacePreEntry(evidence.ranking);
  if (
    evidence.ranking.mode !== field.mode ||
    evidence.ranking.distanceMeters !== field.distanceMeters ||
    ranking.dataCurrentThrough !== field.dataCurrentThrough
  ) {
    throw new Error(
      "Open Race ranking must match the field mode, exact distance and historical cutoff.",
    );
  }
  if (
    evidence.ranking.candidates.some(
      ({ coreId }) => !eligibility.eligibleCoreIds.includes(coreId),
    )
  ) {
    throw new Error(
      "Open Race ranking contains a core without confirmed eligibility.",
    );
  }
  if (
    !sameValues(
      evidence.ranking.opponents.map(({ coreId }) => coreId),
      field.opponentCoreIds,
    )
  ) {
    throw new Error(
      "Open Race ranking opponents must match the manually captured field.",
    );
  }
  if (evidence.lock === null) {
    if (evidence.observation !== null || evidence.comparison !== null) {
      throw new Error("Open Race observations require a locked field.");
    }
    return {
      ...base,
      stage: "provisional_selection",
      ranking,
      lock: null,
      observation: null,
      comparison: null,
    };
  }

  if (
    evidence.lock.requestId !== field.requestId ||
    evidence.lock.preEntryRankingId !== ranking.rankingId ||
    evidence.lock.gateCount !== field.gateCount ||
    evidence.lock.provisionalRecommendedCoreId !==
      ranking.provisionalRecommendedCoreId ||
    evidence.lock.preEntryStatus !== ranking.status
  ) {
    throw new Error(
      "Open Race field lock must reference the exact captured field and frozen ranking.",
    );
  }
  if (
    !ranking.rankedCandidates.some(
      ({ coreId }) => coreId === evidence.lock?.selectedOwnedCoreId,
    )
  ) {
    throw new Error(
      "Open Race committed core must be present in the frozen candidate ranking.",
    );
  }
  const lock = lockOpenRaceField(evidence.lock);

  if (evidence.observation === null) {
    if (evidence.comparison !== null) {
      throw new Error(
        "Open Race star comparison requires a recorded observation.",
      );
    }
    return {
      ...base,
      stage: "locked_observation",
      ranking,
      lock,
      observation: null,
      comparison: null,
    };
  }

  if (
    evidence.observation.lockId !== lock.lockId ||
    evidence.observation.lockedAt !== lock.lockedAt ||
    evidence.observation.gateCount !== lock.gateCount ||
    evidence.observation.selectedOwnedCoreId !== lock.selectedOwnedCoreId ||
    !sameValues(evidence.observation.enteredCoreIds, lock.enteredCoreIds)
  ) {
    throw new Error(
      "Open Race star observation must reference the exact locked field.",
    );
  }
  const observation = recordOpenRaceStarObservation(evidence.observation);

  if (evidence.comparison === null) {
    return {
      ...base,
      stage: "observation_recorded",
      ranking,
      lock,
      observation,
      comparison: null,
    };
  }

  if (
    evidence.comparison.lockId !== lock.lockId ||
    evidence.comparison.observationId !== observation.observationId ||
    evidence.comparison.selectedOwnedCoreId !== lock.selectedOwnedCoreId ||
    evidence.comparison.provisionalRecommendedCoreId !==
      ranking.provisionalRecommendedCoreId ||
    !sameValues(
      evidence.comparison.rankedCandidateCoreIds,
      ranking.rankedCandidates.map(({ coreId }) => coreId),
    )
  ) {
    throw new Error(
      "Open Race comparison must use the frozen ranking, lock and observation.",
    );
  }
  return {
    ...base,
    stage: "observation_compared",
    ranking,
    lock,
    observation,
    comparison: compareOpenRaceStars(evidence.comparison),
  };
}

export async function loadOpenRaceWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: OpenRaceWorkspaceRepository;
  }>,
): Promise<OpenRaceWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { sessions: [], connectionStatus: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Open Race workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return { sessions: [], connectionStatus: "persistence_not_configured" };
  }

  const evidence =
    await input.repository.listSessionEvidenceByOwner(authenticatedOwnerId);
  const requestIds = evidence.map(({ field }) => field.requestId.trim());
  if (
    requestIds.some((requestId) => requestId === "") ||
    new Set(requestIds).size !== requestIds.length
  ) {
    throw new Error(
      "Open Race session request IDs must be non-empty and unique.",
    );
  }

  return {
    sessions: evidence
      .map(composeSession)
      .sort((left, right) =>
        right.field.capturedAt.localeCompare(left.field.capturedAt),
      ),
    connectionStatus: "read_model_connected",
  };
}
