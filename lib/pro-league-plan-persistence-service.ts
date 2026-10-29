import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

export type ProLeaguePlanPersistenceState = Readonly<{
  status:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "plan_unavailable"
    | "not_saved"
    | "lead_only_saved"
    | "saved"
    | "read_failed";
  generationId: string | null;
  rosterVersionId: string | null;
  lineupVersionId: string | null;
  rosterSavedAt: string | null;
  lineupSavedAt: string | null;
  persistedAssignmentCount?: number | null;
  requiredAssignmentCount?: number | null;
  failureStage?:
    "roster_read" | "lineup_read" | "full_gate_read" | "integrity" | null;
}>;

type RosterReadRepository = Readonly<{
  loadVersion: (
    ownerId: string,
    rosterVersionId: string,
  ) => Promise<Readonly<{
    version: Readonly<{ rosterVersionId: string }>;
    createdAt: string;
  }> | null>;
}>;

type LineupReadRepository = Readonly<{
  loadLineup: (
    ownerId: string,
    lineupVersionId: string,
  ) => Promise<Readonly<{
    version: Readonly<{
      lineupVersionId: string;
      rosterVersionId: string;
      maps: readonly Readonly<{ entries: readonly unknown[] }>[];
    }>;
    createdAt: string;
  }> | null>;
  loadFullGatePlan: (
    ownerId: string,
    lineupVersionId: string,
  ) => Promise<Readonly<{
    lineupVersionId: string;
    rosterVersionId: string;
    planId: string;
    assignments: readonly unknown[];
    createdAt: string;
  }> | null>;
}>;

const empty = (
  status: ProLeaguePlanPersistenceState["status"],
): ProLeaguePlanPersistenceState => ({
  status,
  generationId: null,
  rosterVersionId: null,
  lineupVersionId: null,
  rosterSavedAt: null,
  lineupSavedAt: null,
  persistedAssignmentCount: null,
  requiredAssignmentCount: null,
  failureStage: null,
});

const failed = (
  identity: Pick<
    ProLeaguePlanPersistenceState,
    "generationId" | "rosterVersionId" | "lineupVersionId"
  >,
  failureStage: NonNullable<ProLeaguePlanPersistenceState["failureStage"]>,
): ProLeaguePlanPersistenceState => ({
  ...empty("read_failed"),
  ...identity,
  failureStage,
});

export async function loadProLeaguePlanPersistenceState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    commissioning: ProLeagueDraftCommissioningState;
    rosterRepository: RosterReadRepository | null;
    lineupRepository: LineupReadRepository | null;
  }>,
): Promise<ProLeaguePlanPersistenceState> {
  const authenticatedOwnerId = input.authenticatedOwnerId?.trim() ?? "";
  const configuredOwnerId = input.configuredOwnerId?.trim() ?? "";
  if (
    authenticatedOwnerId === "" ||
    configuredOwnerId === "" ||
    authenticatedOwnerId !== configuredOwnerId
  ) {
    return empty("identity_not_connected");
  }
  const roster = input.commissioning.roster?.draftRoster ?? null;
  const lineup = input.commissioning.lineup?.lineup ?? null;
  const ownerPlan = input.commissioning.ownerPlan;
  const generationId = input.commissioning.evidence?.generationId ?? null;
  if (
    input.commissioning.connectionStatus !== "read_model_connected" ||
    roster === null ||
    lineup === null ||
    lineup.rosterVersionId !== roster.rosterVersionId ||
    lineup.maps.length !== 4 ||
    lineup.maps.flatMap(({ entries }) => entries).length !== 168 ||
    ownerPlan === undefined ||
    ownerPlan.roster.length !== 25 ||
    ownerPlan.allSlotsFilled !== true ||
    generationId === null
  ) {
    return empty("plan_unavailable");
  }
  const identity = {
    generationId,
    rosterVersionId: roster.rosterVersionId,
    lineupVersionId: lineup.lineupVersionId,
    persistedAssignmentCount: 0,
    requiredAssignmentCount: ownerPlan.requiredCoreEntries,
  };
  if (input.rosterRepository === null || input.lineupRepository === null) {
    return { ...empty("persistence_not_configured"), ...identity };
  }
  let storedRoster: Awaited<ReturnType<RosterReadRepository["loadVersion"]>>;
  try {
    storedRoster = await input.rosterRepository.loadVersion(
      authenticatedOwnerId,
      roster.rosterVersionId,
    );
  } catch {
    return failed(identity, "roster_read");
  }
  let storedLineup: Awaited<ReturnType<LineupReadRepository["loadLineup"]>>;
  try {
    storedLineup = await input.lineupRepository.loadLineup(
      authenticatedOwnerId,
      lineup.lineupVersionId,
    );
  } catch {
    return failed(identity, "lineup_read");
  }
  if (storedRoster === null || storedLineup === null) {
    return { ...empty("not_saved"), ...identity };
  }
  if (
    storedRoster.version.rosterVersionId !== roster.rosterVersionId ||
    storedLineup.version.lineupVersionId !== lineup.lineupVersionId ||
    storedLineup.version.rosterVersionId !== roster.rosterVersionId ||
    storedLineup.version.maps.length !== 4 ||
    storedLineup.version.maps.flatMap(({ entries }) => entries).length !== 168
  ) {
    return failed(identity, "integrity");
  }
  let storedFullGate: Awaited<
    ReturnType<LineupReadRepository["loadFullGatePlan"]>
  >;
  try {
    storedFullGate = await input.lineupRepository.loadFullGatePlan(
      authenticatedOwnerId,
      lineup.lineupVersionId,
    );
  } catch {
    return failed(identity, "full_gate_read");
  }
  if (storedFullGate === null) {
    return {
      status: "lead_only_saved",
      ...identity,
      persistedAssignmentCount: storedLineup.version.maps.flatMap(
        ({ entries }) => entries,
      ).length,
      rosterSavedAt: storedRoster.createdAt,
      lineupSavedAt: storedLineup.createdAt,
      failureStage: null,
    };
  }
  if (
    storedFullGate.lineupVersionId !== lineup.lineupVersionId ||
    storedFullGate.rosterVersionId !== roster.rosterVersionId ||
    storedFullGate.planId !== ownerPlan.planId ||
    storedFullGate.assignments.length !== ownerPlan.requiredCoreEntries
  ) {
    return failed(identity, "integrity");
  }
  return {
    status: "saved",
    ...identity,
    persistedAssignmentCount: storedFullGate.assignments.length,
    rosterSavedAt: storedRoster.createdAt,
    lineupSavedAt: storedFullGate.createdAt,
    failureStage: null,
  };
}
