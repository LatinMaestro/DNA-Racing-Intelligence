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

export type OpenRaceEvidenceBindings = Readonly<{
  sessionVersion: string;
  fieldVersion: string;
  eligibilityVersion: string;
  historicalAggregateVersion: string;
  raceImportVersion: string;
  vaultSnapshotVersion: string;
  rankingVersion: string | null;
  lockVersion: string | null;
  observationVersion: string | null;
  comparisonVersion: string | null;
}>;

export type OpenRaceWorkspaceEvidence = Readonly<{
  bindings: OpenRaceEvidenceBindings;
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
  bindings: OpenRaceEvidenceBindings;
  mutationAllowed: false;
  liveGameConnection: false;
  gateCPassed: false;
}>;

export type OpenRaceWorkspaceRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listSessionEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          sessions: readonly OpenRaceWorkspaceEvidence[];
          latestAcceptedRaceImportAt: string | null;
          latestAcceptedVaultImportAt: string | null;
          latestAcceptedRaceImportVersion: string | null;
          latestAcceptedVaultSnapshotVersion: string | null;
          latestPublishedHistoricalAggregateVersion: string | null;
        }>
      >;
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

function required(value: unknown, label: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${label} is required.`);
  }
  return value.trim();
}

function canonicalTimestamp(value: unknown, label: string): string {
  const supplied = required(value, label);
  const parsed = new Date(supplied);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== supplied) {
    throw new Error(`${label} must be a canonical UTC timestamp.`);
  }
  return supplied;
}

export function deriveOpenRaceFreshness(
  dataCurrentThrough: string,
  now: Date,
): OpenRaceFieldInput["freshness"] {
  if (Number.isNaN(now.getTime())) {
    throw new Error("Open Race server time must be valid.");
  }
  const cutoff = canonicalTimestamp(
    dataCurrentThrough,
    "Open Race data current through",
  );
  const ageMilliseconds = now.getTime() - Date.parse(cutoff);
  if (ageMilliseconds < 0) {
    throw new Error("Open Race evidence cutoff cannot be in the future.");
  }
  const ageDays = ageMilliseconds / 86_400_000;
  if (ageDays <= 3) return "current";
  if (ageDays <= 7) return "ageing";
  return "stale";
}

function sameOrderedValues(
  left: readonly string[],
  right: readonly string[],
): boolean {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameSignal(
  left: Readonly<{ status: string; coreId?: string }>,
  right: Readonly<{ status: string; coreId?: string }>,
): boolean {
  return left.status === right.status && left.coreId === right.coreId;
}

function validateBindings(
  bindings: OpenRaceEvidenceBindings,
  evidence: OpenRaceWorkspaceEvidence,
): OpenRaceEvidenceBindings {
  if (bindings === null || typeof bindings !== "object") {
    throw new Error("Open Race evidence bindings are required.");
  }
  const normalized: OpenRaceEvidenceBindings = {
    sessionVersion: required(bindings.sessionVersion, "Session version"),
    fieldVersion: required(bindings.fieldVersion, "Field version"),
    eligibilityVersion: required(
      bindings.eligibilityVersion,
      "Eligibility version",
    ),
    historicalAggregateVersion: required(
      bindings.historicalAggregateVersion,
      "Historical aggregate version",
    ),
    raceImportVersion: required(
      bindings.raceImportVersion,
      "Race import version",
    ),
    vaultSnapshotVersion: required(
      bindings.vaultSnapshotVersion,
      "Vault snapshot version",
    ),
    rankingVersion:
      bindings.rankingVersion === null
        ? null
        : required(bindings.rankingVersion, "Ranking version"),
    lockVersion:
      bindings.lockVersion === null
        ? null
        : required(bindings.lockVersion, "Lock version"),
    observationVersion:
      bindings.observationVersion === null
        ? null
        : required(bindings.observationVersion, "Observation version"),
    comparisonVersion:
      bindings.comparisonVersion === null
        ? null
        : required(bindings.comparisonVersion, "Comparison version"),
  };
  for (const [value, version, label] of [
    [evidence.ranking, normalized.rankingVersion, "ranking"],
    [evidence.lock, normalized.lockVersion, "lock"],
    [evidence.observation, normalized.observationVersion, "observation"],
    [evidence.comparison, normalized.comparisonVersion, "comparison"],
  ] as const) {
    if ((value === null) !== (version === null)) {
      throw new Error(`Open Race ${label} evidence and version must agree.`);
    }
  }
  return normalized;
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
  bindings: OpenRaceEvidenceBindings,
) {
  return {
    field,
    eligibility,
    bindings,
    mutationAllowed: false as const,
    liveGameConnection: false as const,
    gateCPassed: false as const,
  };
}

function composeSession(
  evidence: OpenRaceWorkspaceEvidence,
): OpenRaceWorkspaceSession {
  if (evidence === null || typeof evidence !== "object") {
    throw new Error("Open Race session evidence is invalid.");
  }
  const bindings = validateBindings(evidence.bindings, evidence);
  const field = validateOpenRaceField(evidence.field);
  const eligibility = evaluateOpenRaceEligibility(evidence.eligibility);
  const base = baseSession(field, eligibility, bindings);

  if (eligibility.evaluatedAt > field.capturedAt) {
    throw new Error(
      "Open Race eligibility must be available by field capture.",
    );
  }

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
    ranking.evaluatedAt < field.capturedAt ||
    ranking.dataCurrentThrough !== field.dataCurrentThrough ||
    ranking.freshness !== field.freshness
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
    evidence.lock.fieldCapturedAt !== field.capturedAt ||
    evidence.lock.rankingEvaluatedAt !== ranking.evaluatedAt ||
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
  if (
    !eligibility.eligibleCoreIds.includes(evidence.lock.selectedOwnedCoreId) ||
    !sameValues(evidence.lock.enteredCoreIds, [
      evidence.lock.selectedOwnedCoreId,
      ...field.opponentCoreIds,
    ])
  ) {
    throw new Error(
      "Open Race field lock must contain the committed eligible core and the exact captured opponents.",
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
    evidence.comparison.rankingEvaluatedAt !== ranking.evaluatedAt ||
    evidence.comparison.lockedAt !== lock.lockedAt ||
    evidence.comparison.observedAt !== observation.observedAt ||
    evidence.comparison.gateCount !== lock.gateCount ||
    evidence.comparison.selectedOwnedCoreId !== lock.selectedOwnedCoreId ||
    evidence.comparison.provisionalRecommendedCoreId !==
      ranking.provisionalRecommendedCoreId ||
    !sameOrderedValues(
      evidence.comparison.rankedCandidateCoreIds,
      ranking.rankedCandidates.map(({ coreId }) => coreId),
    ) ||
    !sameValues(evidence.comparison.enteredCoreIds, lock.enteredCoreIds) ||
    !sameSignal(evidence.comparison.gold, observation.gold) ||
    !sameSignal(evidence.comparison.blue, observation.blue) ||
    evidence.comparison.observationRecordStatus !== observation.recordStatus
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
    now: Date;
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
  if (input.repository.status !== "ready") {
    throw new Error("Open Race repository status is invalid.");
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Open Race server time must be valid.");
  }

  const readModel =
    await input.repository.listSessionEvidenceByOwner(authenticatedOwnerId);
  if (
    readModel === null ||
    typeof readModel !== "object" ||
    !Array.isArray(readModel.sessions)
  ) {
    throw new Error("Open Race repository evidence is invalid.");
  }
  if (readModel.sessions.length === 0) {
    return { sessions: [], connectionStatus: "read_model_connected" };
  }
  const latestAcceptedRaceImportAt = canonicalTimestamp(
    readModel.latestAcceptedRaceImportAt,
    "Latest accepted Race Merge import",
  );
  const latestAcceptedVaultImportAt = canonicalTimestamp(
    readModel.latestAcceptedVaultImportAt,
    "Latest accepted Vault import",
  );
  const latestAcceptedRaceImportVersion = required(
    readModel.latestAcceptedRaceImportVersion,
    "Latest accepted Race Merge version",
  );
  const latestAcceptedVaultSnapshotVersion = required(
    readModel.latestAcceptedVaultSnapshotVersion,
    "Latest accepted Vault snapshot version",
  );
  const latestPublishedHistoricalAggregateVersion = required(
    readModel.latestPublishedHistoricalAggregateVersion,
    "Latest published historical aggregate version",
  );
  if (
    Date.parse(latestAcceptedRaceImportAt) > input.now.getTime() ||
    Date.parse(latestAcceptedVaultImportAt) > input.now.getTime()
  ) {
    throw new Error("Accepted Open Race imports cannot be in the future.");
  }

  const evidence = readModel.sessions.map((session) => {
    if (session === null || typeof session !== "object") {
      throw new Error("Open Race session evidence is invalid.");
    }
    const fieldCapturedAt = canonicalTimestamp(
      session.field?.capturedAt,
      "Field capture time",
    );
    const raceCutoff = canonicalTimestamp(
      session.field?.dataCurrentThrough,
      "Race data current through",
    );
    const fieldLastImported = canonicalTimestamp(
      session.field?.lastImported,
      "Field last imported",
    );
    const eligibilityEvaluatedAt = canonicalTimestamp(
      session.eligibility?.evaluatedAt,
      "Eligibility evaluation time",
    );
    const vaultCutoff = canonicalTimestamp(
      session.eligibility?.vaultDataCurrentThrough,
      "Vault data current through",
    );
    for (const [value, label] of [
      [session.ranking?.evaluatedAt, "Ranking evaluation time"],
      [session.ranking?.dataCurrentThrough, "Ranking data current through"],
      [session.lock?.fieldCapturedAt, "Locked field capture time"],
      [session.lock?.rankingEvaluatedAt, "Locked ranking evaluation time"],
      [session.lock?.lockedAt, "Field lock time"],
      [session.observation?.lockedAt, "Observation lock time"],
      [session.observation?.observedAt, "Star observation time"],
      [session.comparison?.rankingEvaluatedAt, "Comparison ranking time"],
      [session.comparison?.lockedAt, "Comparison lock time"],
      [session.comparison?.observedAt, "Comparison observation time"],
      [session.comparison?.comparedAt, "Star comparison time"],
    ] as const) {
      if (value !== undefined) {
        const canonical = canonicalTimestamp(value, label);
        if (Date.parse(canonical) > input.now.getTime()) {
          throw new Error(`${label} cannot be in the future.`);
        }
      }
    }
    if (
      Date.parse(fieldCapturedAt) > input.now.getTime() ||
      Date.parse(eligibilityEvaluatedAt) > input.now.getTime()
    ) {
      throw new Error(
        "Open Race capture and evaluation times cannot be in the future.",
      );
    }
    if (
      fieldLastImported !== latestAcceptedRaceImportAt ||
      Date.parse(raceCutoff) > Date.parse(fieldLastImported) ||
      Date.parse(vaultCutoff) > Date.parse(latestAcceptedVaultImportAt) ||
      Date.parse(eligibilityEvaluatedAt) <
        Date.parse(latestAcceptedVaultImportAt)
    ) {
      throw new Error(
        "Open Race evidence is not bound to accepted import cutoffs.",
      );
    }
    if (
      session.bindings?.raceImportVersion !== latestAcceptedRaceImportVersion ||
      session.bindings?.vaultSnapshotVersion !==
        latestAcceptedVaultSnapshotVersion ||
      session.bindings?.historicalAggregateVersion !==
        latestPublishedHistoricalAggregateVersion
    ) {
      throw new Error("Open Race evidence versions are stale or inconsistent.");
    }
    const raceFreshness = deriveOpenRaceFreshness(raceCutoff, input.now);
    const vaultFreshness = deriveOpenRaceFreshness(vaultCutoff, input.now);
    if (
      session.field.freshness !== raceFreshness ||
      (session.ranking?.freshness !== undefined &&
        session.ranking.freshness !== raceFreshness) ||
      session.eligibility.freshness !== vaultFreshness
    ) {
      throw new Error(
        "Stored Open Race freshness does not match server-derived freshness.",
      );
    }
    return {
      ...session,
      field: { ...session.field, freshness: raceFreshness },
      eligibility: { ...session.eligibility, freshness: vaultFreshness },
      ranking:
        session.ranking === null
          ? null
          : { ...session.ranking, freshness: raceFreshness },
    };
  });

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
