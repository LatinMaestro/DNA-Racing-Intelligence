import type { ProLeagueDraftCommissioningState } from "@/lib/pro-league-draft-commissioning-service";

export type ProLeaguePlanPersistenceState = Readonly<{
  status:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "plan_unavailable"
    | "not_saved"
    | "saved"
    | "read_failed";
  generationId: string | null;
  rosterVersionId: string | null;
  rosterSavedAt: string | null;
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

const empty = (
  status: ProLeaguePlanPersistenceState["status"],
): ProLeaguePlanPersistenceState => ({
  status,
  generationId: null,
  rosterVersionId: null,
  rosterSavedAt: null,
});

export async function loadProLeaguePlanPersistenceState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    commissioning: ProLeagueDraftCommissioningState;
    rosterRepository: RosterReadRepository | null;
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
  const ownerPlan = input.commissioning.ownerPlan;
  const generationId = input.commissioning.evidence?.generationId ?? null;
  if (
    input.commissioning.connectionStatus !== "read_model_connected" ||
    roster === null ||
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
  };
  if (input.rosterRepository === null) {
    return { ...empty("persistence_not_configured"), ...identity };
  }
  try {
    const storedRoster = await input.rosterRepository.loadVersion(
      authenticatedOwnerId,
      roster.rosterVersionId,
    );
    if (storedRoster === null) {
      return { ...empty("not_saved"), ...identity };
    }
    if (storedRoster.version.rosterVersionId !== roster.rosterVersionId) {
      return { ...empty("read_failed"), ...identity };
    }
    return {
      status: "saved",
      ...identity,
      rosterSavedAt: storedRoster.createdAt,
    };
  } catch {
    return { ...empty("read_failed"), ...identity };
  }
}
