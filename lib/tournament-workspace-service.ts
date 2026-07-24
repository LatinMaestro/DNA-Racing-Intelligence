import {
  rankTournamentCandidates,
  type TournamentCandidateRankingInput,
  type TournamentCandidateRankingResult,
} from "@/domain/tournament-candidate-ranking";

export type TournamentCandidateRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCandidateEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          brackets: readonly TournamentCandidateRankingInput[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type TournamentWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type TournamentWorkspacePageState = Readonly<{
  brackets: readonly TournamentCandidateRankingResult[];
  lastImportedAt: string | null;
  connectionStatus: TournamentWorkspaceConnectionStatus;
}>;

export const unavailableTournamentCandidateRepository: TournamentCandidateRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function validTimestamp(value: string | null): boolean {
  return value === null || !Number.isNaN(Date.parse(value));
}

export async function loadTournamentWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentCandidateRepository;
  }>,
): Promise<TournamentWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Tournament workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const evidence =
    await input.repository.listCandidateEvidenceByOwner(authenticatedOwnerId);
  if (!validTimestamp(evidence.lastImportedAt)) {
    throw new Error("Tournament import timestamp is invalid.");
  }

  const bracketKeys = evidence.brackets.map(({ tournamentId, bracketId }) =>
    JSON.stringify([tournamentId.trim(), bracketId.trim()]),
  );
  if (new Set(bracketKeys).size !== bracketKeys.length) {
    throw new Error("Tournament bracket evidence must be unique.");
  }

  return {
    brackets: evidence.brackets
      .map(rankTournamentCandidates)
      .sort(
        (left, right) =>
          left.tournamentId.localeCompare(right.tournamentId) ||
          left.bracketId.localeCompare(right.bracketId),
      ),
    lastImportedAt: evidence.lastImportedAt,
    connectionStatus: "read_model_connected",
  };
}
