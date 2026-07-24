import {
  rankLifecycleActions,
  type LifecycleActionRankingInput,
  type LifecycleActionRankingResult,
} from "@/domain/lifecycle-action-ranking";

export type LifecycleRankingRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadRankingEvidenceByOwner: (
        ownerId: string,
      ) => Promise<LifecycleActionRankingInput | null>;
    }>;

export type LifecycleWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type LifecycleWorkspacePageState = Readonly<{
  ranking: LifecycleActionRankingResult | null;
  connectionStatus: LifecycleWorkspaceConnectionStatus;
}>;

export const unavailableLifecycleRankingRepository: LifecycleRankingRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadLifecycleWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: LifecycleRankingRepository;
  }>,
): Promise<LifecycleWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      ranking: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Lifecycle workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      ranking: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const evidence =
    await input.repository.loadRankingEvidenceByOwner(authenticatedOwnerId);
  return {
    ranking: evidence === null ? null : rankLifecycleActions(evidence),
    connectionStatus: "read_model_connected",
  };
}
