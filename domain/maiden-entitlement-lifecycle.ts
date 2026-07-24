export const maidenLifecycleFreshnessStates = [
  "current",
  "ageing",
  "stale",
  "unknown",
] as const;
export type MaidenLifecycleFreshness =
  (typeof maidenLifecycleFreshnessStates)[number];

export type MaidenSnapshotState =
  "eligible" | "not_eligible" | "unknown" | "invalid";

export type MaidenLifecycleState =
  MaidenSnapshotState | "planned" | "committed" | "consumed";

export type MaidenLifecycleAction =
  "plan" | "cancel_plan" | "commit" | "release_commitment" | "consume";

export type MaidenLifecycleEventInput = Readonly<{
  eventId: string;
  revision: number;
  action: MaidenLifecycleAction;
  tournamentId: string | null;
  reason: string;
  occurredAt: string;
}>;

export type MaidenEntitlementLifecycleInput = Readonly<{
  coreId: string;
  snapshotState: MaidenSnapshotState;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: MaidenLifecycleFreshness;
  events: readonly MaidenLifecycleEventInput[];
}>;

export type MaidenLifecycleWarning =
  | "SNAPSHOT_STATE_UNKNOWN"
  | "SNAPSHOT_STATE_INVALID"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "PLANNED_NOT_COMMITTED"
  | "COMMITMENT_RECORDED"
  | "ENTITLEMENT_CONSUMED"
  | "GATE_D_NOT_PASSED";

export type MaidenEntitlementLifecycle = Readonly<{
  coreId: string;
  snapshotState: MaidenSnapshotState;
  currentState: MaidenLifecycleState;
  tournamentId: string | null;
  currentRevision: number;
  history: readonly Readonly<{
    eventId: string;
    revision: number;
    action: MaidenLifecycleAction;
    stateBefore: MaidenLifecycleState;
    stateAfter: MaidenLifecycleState;
    tournamentId: string | null;
    reason: string;
    occurredAt: string;
  }>[];
  warnings: readonly MaidenLifecycleWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: MaidenLifecycleFreshness;
  importedHistoricalSnapshot: true;
  actionableRecommendationAllowed: false;
  automaticEntryAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function transition(
  state: MaidenLifecycleState,
  tournamentId: string | null,
  event: MaidenLifecycleEventInput,
): Readonly<{ state: MaidenLifecycleState; tournamentId: string | null }> {
  const eventTournamentId =
    event.tournamentId === null
      ? null
      : required(event.tournamentId, "Tournament ID");

  switch (event.action) {
    case "plan":
      if (state !== "eligible" || eventTournamentId === null) {
        throw new Error(
          "Planning requires an eligible entitlement and a tournament.",
        );
      }
      return { state: "planned", tournamentId: eventTournamentId };
    case "cancel_plan":
      if (
        state !== "planned" ||
        eventTournamentId === null ||
        eventTournamentId !== tournamentId
      ) {
        throw new Error(
          "Cancelling a plan must target the currently planned tournament.",
        );
      }
      return { state: "eligible", tournamentId: null };
    case "commit":
      if (
        state !== "planned" ||
        eventTournamentId === null ||
        eventTournamentId !== tournamentId
      ) {
        throw new Error(
          "Commitment must target the currently planned tournament.",
        );
      }
      return { state: "committed", tournamentId: eventTournamentId };
    case "release_commitment":
      if (
        state !== "committed" ||
        eventTournamentId === null ||
        eventTournamentId !== tournamentId
      ) {
        throw new Error(
          "Releasing a commitment must target the committed tournament.",
        );
      }
      return { state: "eligible", tournamentId: null };
    case "consume":
      if (
        state !== "committed" ||
        eventTournamentId === null ||
        eventTournamentId !== tournamentId
      ) {
        throw new Error("Consumption must target the committed tournament.");
      }
      return { state: "consumed", tournamentId: eventTournamentId };
    default:
      throw new Error("Maiden lifecycle action is invalid.");
  }
}

export function buildMaidenEntitlementLifecycle(
  input: MaidenEntitlementLifecycleInput,
): MaidenEntitlementLifecycle {
  const coreId = required(input.coreId, "Core ID");
  if (
    !["eligible", "not_eligible", "unknown", "invalid"].includes(
      input.snapshotState,
    )
  ) {
    throw new Error("Snapshot Maiden state is invalid.");
  }
  if (!maidenLifecycleFreshnessStates.includes(input.freshness)) {
    throw new Error("Maiden lifecycle freshness is invalid.");
  }

  const dataCurrentThrough = timestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = timestamp(input.lastImported, "Last imported");
  if (
    dataCurrentThrough !== null &&
    lastImported !== null &&
    Date.parse(lastImported) < Date.parse(dataCurrentThrough)
  ) {
    throw new Error("Last imported cannot precede data current through.");
  }

  const eventIds = input.events.map(({ eventId }) =>
    required(eventId, "Lifecycle event ID"),
  );
  if (new Set(eventIds).size !== eventIds.length) {
    throw new Error("Lifecycle event IDs must be unique.");
  }

  let currentState: MaidenLifecycleState = input.snapshotState;
  let tournamentId: string | null = null;
  let previousOccurredAt = Number.NEGATIVE_INFINITY;
  const history: MaidenEntitlementLifecycle["history"][number][] = [];

  for (const [index, event] of input.events.entries()) {
    if (!Number.isSafeInteger(event.revision) || event.revision !== index + 1) {
      throw new Error("Lifecycle revisions must be sequential from one.");
    }
    const occurredAt = timestamp(event.occurredAt, "Lifecycle event time");
    if (occurredAt === null)
      throw new Error("Lifecycle event time is required.");
    if (Date.parse(occurredAt) < previousOccurredAt) {
      throw new Error("Lifecycle events must be chronological.");
    }
    if (
      dataCurrentThrough !== null &&
      Date.parse(occurredAt) < Date.parse(dataCurrentThrough)
    ) {
      throw new Error(
        "Lifecycle events cannot predate the imported snapshot cutoff.",
      );
    }
    previousOccurredAt = Date.parse(occurredAt);

    const stateBefore = currentState;
    const next = transition(currentState, tournamentId, event);
    currentState = next.state;
    tournamentId = next.tournamentId;
    history.push({
      eventId: eventIds[index]!,
      revision: event.revision,
      action: event.action,
      stateBefore,
      stateAfter: currentState,
      tournamentId,
      reason: required(event.reason, "Lifecycle event reason"),
      occurredAt,
    });
  }

  const warnings = new Set<MaidenLifecycleWarning>(["GATE_D_NOT_PASSED"]);
  if (input.snapshotState === "unknown") warnings.add("SNAPSHOT_STATE_UNKNOWN");
  if (input.snapshotState === "invalid") warnings.add("SNAPSHOT_STATE_INVALID");
  if (dataCurrentThrough === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (input.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
  if (input.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");
  if (currentState === "planned") warnings.add("PLANNED_NOT_COMMITTED");
  if (currentState === "committed") warnings.add("COMMITMENT_RECORDED");
  if (currentState === "consumed") warnings.add("ENTITLEMENT_CONSUMED");

  return {
    coreId,
    snapshotState: input.snapshotState,
    currentState,
    tournamentId,
    currentRevision: history.length,
    history,
    warnings: [...warnings],
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    importedHistoricalSnapshot: true,
    actionableRecommendationAllowed: false,
    automaticEntryAllowed: false,
  };
}
