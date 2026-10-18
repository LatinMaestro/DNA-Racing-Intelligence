import type { RacePredictionReconciliation } from "@/domain/race-prediction-reconciliation";
import type { FrozenRacePredictionSnapshot } from "@/domain/race-prediction-snapshot";
import type { ConfiguredOpenRacePredictionRepository } from "@/lib/neon-open-race-prediction-repository";
import type { OpenRaceWorkspaceSession } from "@/lib/open-race-workspace-service";

export type OpenRacePredictionEvidenceItem = Readonly<{
  snapshot: FrozenRacePredictionSnapshot;
  latestReconciliation: RacePredictionReconciliation | null;
}>;

export type OpenRaceSessionPredictionEvidence = Readonly<{
  requestId: string;
  status: "available" | "unavailable";
  reason:
    | null
    | "FIELD_NOT_LOCKED"
    | "EVENT_IDENTITY_UNAVAILABLE"
    | "FROZEN_PREDICTION_UNAVAILABLE";
  items: readonly OpenRacePredictionEvidenceItem[];
}>;

export type OpenRacePredictionPageState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "read_model_connected";
  evidence: readonly OpenRaceSessionPredictionEvidence[];
}>;

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function sameValues(left: readonly string[], right: readonly string[]) {
  return (
    left.length === right.length &&
    left.every((value, index) => value === right[index])
  );
}

function sameContext(
  snapshot: FrozenRacePredictionSnapshot,
  session: OpenRaceWorkspaceSession,
): boolean {
  const context = session.field.probabilityContext;
  return (
    context !== null &&
    snapshot.context.mode === context.mode &&
    snapshot.context.distanceMeters === context.distanceMeters &&
    snapshot.context.competition === context.competition &&
    snapshot.context.format === context.format &&
    snapshot.context.gateCount === context.gateCount &&
    snapshot.context.element.status === context.element.status &&
    snapshot.context.element.value === context.element.value
  );
}

function snapshotMatchesSession(
  snapshot: FrozenRacePredictionSnapshot,
  session: OpenRaceWorkspaceSession,
): boolean {
  const lock = session.lock;
  if (
    lock === null ||
    lock.eventIdentity.status !== "confirmed" ||
    session.bindings.lockVersion === null
  ) {
    return false;
  }
  return (
    snapshot.eventId === lock.eventIdentity.eventId &&
    snapshot.sources.sessionVersion === session.bindings.sessionVersion &&
    snapshot.field.fieldVersion === session.bindings.fieldVersion &&
    snapshot.sources.eligibilityVersion ===
      session.bindings.eligibilityVersion &&
    snapshot.sources.raceImportVersion === session.bindings.raceImportVersion &&
    snapshot.sources.vaultSnapshotVersion ===
      session.bindings.vaultSnapshotVersion &&
    snapshot.sources.historicalAggregateVersion ===
      session.bindings.historicalAggregateVersion &&
    snapshot.sources.lockVersion === session.bindings.lockVersion &&
    snapshot.eventStartsAt === lock.eventStartsAt &&
    snapshot.field.fieldCapturedAt === session.field.capturedAt &&
    sameContext(snapshot, session) &&
    sameValues(snapshot.field.enteredCoreIds, lock.enteredCoreIds)
  );
}

function latestReconciliationBySnapshot(
  reconciliations: readonly RacePredictionReconciliation[],
): ReadonlyMap<string, RacePredictionReconciliation> {
  const latest = new Map<string, RacePredictionReconciliation>();
  const revisions = new Set<string>();
  for (const reconciliation of reconciliations) {
    const key = `${reconciliation.snapshotId}\u0000${reconciliation.revision}`;
    if (revisions.has(key)) {
      throw new Error(
        "Open Race prediction reconciliation revision is ambiguous.",
      );
    }
    revisions.add(key);
    const previous = latest.get(reconciliation.snapshotId);
    if (previous === undefined || reconciliation.revision > previous.revision) {
      latest.set(reconciliation.snapshotId, reconciliation);
    }
  }
  return latest;
}

export function composeOpenRacePredictionPageEvidence(
  sessions: readonly OpenRaceWorkspaceSession[],
  snapshots: readonly FrozenRacePredictionSnapshot[],
  reconciliations: readonly RacePredictionReconciliation[],
): readonly OpenRaceSessionPredictionEvidence[] {
  const snapshotIds = snapshots.map(({ snapshotId }) => snapshotId);
  if (new Set(snapshotIds).size !== snapshotIds.length) {
    throw new Error("Open Race frozen prediction IDs must be unique.");
  }
  const snapshotsById = new Map(
    snapshots.map((snapshot) => [snapshot.snapshotId, snapshot]),
  );
  for (const reconciliation of reconciliations) {
    const snapshot = snapshotsById.get(reconciliation.snapshotId);
    if (snapshot !== undefined && reconciliation.eventId !== snapshot.eventId) {
      throw new Error(
        "Open Race prediction reconciliation event does not match its snapshot.",
      );
    }
  }
  const latest = latestReconciliationBySnapshot(reconciliations);

  return sessions.map((session) => {
    const requestId = session.field.requestId;
    if (session.lock === null || session.bindings.lockVersion === null) {
      return {
        requestId,
        status: "unavailable",
        reason: "FIELD_NOT_LOCKED",
        items: [],
      };
    }
    if (session.lock.eventIdentity.status !== "confirmed") {
      return {
        requestId,
        status: "unavailable",
        reason: "EVENT_IDENTITY_UNAVAILABLE",
        items: [],
      };
    }
    const items = snapshots
      .filter((snapshot) => snapshotMatchesSession(snapshot, session))
      .map((snapshot) => ({
        snapshot,
        latestReconciliation: latest.get(snapshot.snapshotId) ?? null,
      }))
      .sort((left, right) =>
        right.snapshot.predictedAt.localeCompare(left.snapshot.predictedAt),
      );
    if (items.length === 0) {
      return {
        requestId,
        status: "unavailable",
        reason: "FROZEN_PREDICTION_UNAVAILABLE",
        items: [],
      };
    }
    return { requestId, status: "available", reason: null, items };
  });
}

export async function loadOpenRacePredictionPageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: ConfiguredOpenRacePredictionRepository;
    sessions: readonly OpenRaceWorkspaceSession[];
  }>,
): Promise<OpenRacePredictionPageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { connectionStatus: "identity_not_connected", evidence: [] };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Open Race prediction evidence access denied.");
  }
  if (input.repository.status === "not_configured") {
    return { connectionStatus: "persistence_not_configured", evidence: [] };
  }
  if (input.sessions.length === 0) {
    return { connectionStatus: "read_model_connected", evidence: [] };
  }
  const [snapshots, reconciliations] = await Promise.all([
    input.repository.listSnapshotsByOwner(authenticatedOwnerId),
    input.repository.listReconciliationsByOwner(authenticatedOwnerId),
  ]);
  return {
    connectionStatus: "read_model_connected",
    evidence: composeOpenRacePredictionPageEvidence(
      input.sessions,
      snapshots,
      reconciliations,
    ),
  };
}
