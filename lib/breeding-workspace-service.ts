import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingPairRankingResult,
} from "@/domain/breeding-pair-ranking";

export type BreedingRankingRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listRankingInputsByOwner: (
        ownerId: string,
      ) => Promise<readonly BreedingPairRankingInput[]>;
    }>;

export type BreedingWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type BreedingWorkspacePageState = Readonly<{
  rankings: readonly BreedingPairRankingResult[];
  connectionStatus: BreedingWorkspaceConnectionStatus;
}>;

export const unavailableBreedingRankingRepository: BreedingRankingRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

export async function loadBreedingWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: BreedingRankingRepository;
  }>,
): Promise<BreedingWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { rankings: [], connectionStatus: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Breeding workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return { rankings: [], connectionStatus: "persistence_not_configured" };
  }

  const rankingInputs =
    await input.repository.listRankingInputsByOwner(authenticatedOwnerId);
  const rankings = rankingInputs.map(rankBreedingPairs);
  if (
    new Set(rankings.map(({ rankingId }) => rankingId)).size !== rankings.length
  ) {
    throw new Error("Breeding ranking evidence must use unique IDs.");
  }

  return {
    rankings: rankings.sort((left, right) =>
      left.rankingId.localeCompare(right.rankingId),
    ),
    connectionStatus: "read_model_connected",
  };
}
