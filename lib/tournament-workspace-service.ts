import {
  rankTournamentCandidates,
  type TournamentCandidateRankingInput,
  type TournamentCandidateRankingResult,
} from "@/domain/tournament-candidate-ranking";
import { deriveFreshness } from "@/domain/freshness";

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

function canonicalTimestamp(value: unknown, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("Tournament now must be valid.");
  }
  return value;
}

function normalizeBracket(
  bracket: TournamentCandidateRankingInput,
  lastImportedAt: string | null,
  now: Date,
): TournamentCandidateRankingInput {
  if (
    typeof bracket !== "object" ||
    bracket === null ||
    !Array.isArray(bracket.candidates)
  ) {
    throw new Error("Tournament bracket evidence is invalid.");
  }
  const importedAtMillis =
    lastImportedAt === null ? null : Date.parse(lastImportedAt);

  return {
    ...bracket,
    candidates: bracket.candidates.map((candidate) => {
      if (typeof candidate !== "object" || candidate === null) {
        throw new Error("Tournament candidate evidence is invalid.");
      }
      const dataCurrentThrough = canonicalTimestamp(
        candidate.dataCurrentThrough,
        "Tournament data current through",
      );
      if (dataCurrentThrough !== null) {
        const cutoffMillis = Date.parse(dataCurrentThrough);
        if (
          cutoffMillis > now.getTime() ||
          (importedAtMillis !== null && cutoffMillis > importedAtMillis)
        ) {
          throw new Error(
            "Tournament data cutoff cannot be in the future or follow its import.",
          );
        }
      }
      return {
        ...candidate,
        dataCurrentThrough,
        lastImported: lastImportedAt,
        freshness:
          lastImportedAt === null
            ? "unknown"
            : deriveFreshness(
                dataCurrentThrough === null
                  ? null
                  : new Date(dataCurrentThrough),
                now,
              ),
      };
    }),
  };
}

function assertConsistentLabels(
  brackets: readonly TournamentCandidateRankingResult[],
): void {
  const tournamentLabels = new Map<string, string>();
  const tournamentIds = new Map<string, string>();
  const splitLabelsById = new Map<string, string>();
  const splitIdsByLabel = new Map<string, string>();
  for (const bracket of brackets) {
    const tournamentBinding = JSON.stringify([
      bracket.tournamentLabel,
      bracket.configurationVersion,
      bracket.candidateSnapshotVersion,
    ]);
    if (
      (tournamentLabels.has(bracket.tournamentId) &&
        tournamentLabels.get(bracket.tournamentId) !== tournamentBinding) ||
      (tournamentIds.has(bracket.tournamentLabel) &&
        tournamentIds.get(bracket.tournamentLabel) !== bracket.tournamentId)
    ) {
      throw new Error(
        "Tournament labels or version bindings are inconsistent.",
      );
    }
    tournamentLabels.set(bracket.tournamentId, tournamentBinding);
    tournamentIds.set(bracket.tournamentLabel, bracket.tournamentId);

    const splitKey = JSON.stringify([bracket.tournamentId, bracket.bracketId]);
    const labelKey = JSON.stringify([bracket.tournamentId, bracket.splitLabel]);
    if (
      (splitLabelsById.has(splitKey) &&
        splitLabelsById.get(splitKey) !== bracket.splitLabel) ||
      (splitIdsByLabel.has(labelKey) &&
        splitIdsByLabel.get(labelKey) !== bracket.bracketId)
    ) {
      throw new Error("Tournament split labels are inconsistent.");
    }
    splitLabelsById.set(splitKey, bracket.splitLabel);
    splitIdsByLabel.set(labelKey, bracket.bracketId);
  }
}

export async function loadTournamentWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: TournamentCandidateRepository;
    now: Date;
  }>,
): Promise<TournamentWorkspacePageState> {
  const now = validNow(input.now);
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
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Tournament repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return {
      brackets: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }
  if (typeof input.repository.listCandidateEvidenceByOwner !== "function") {
    throw new Error("Tournament repository is invalid.");
  }

  const evidence =
    await input.repository.listCandidateEvidenceByOwner(authenticatedOwnerId);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray(evidence.brackets)
  ) {
    throw new Error("Tournament evidence is invalid.");
  }
  const lastImportedAt = canonicalTimestamp(
    evidence.lastImportedAt,
    "Tournament import timestamp",
  );
  if (lastImportedAt !== null && Date.parse(lastImportedAt) > now.getTime()) {
    throw new Error("Tournament import timestamp cannot be in the future.");
  }

  const brackets = evidence.brackets.map((bracket) =>
    rankTournamentCandidates(normalizeBracket(bracket, lastImportedAt, now)),
  );
  const bracketKeys = brackets.map(({ tournamentId, bracketId }) =>
    JSON.stringify([tournamentId, bracketId]),
  );
  if (new Set(bracketKeys).size !== bracketKeys.length) {
    throw new Error("Tournament bracket evidence must be unique.");
  }
  assertConsistentLabels(brackets);

  return {
    brackets: brackets.sort(
      (left, right) =>
        left.tournamentLabel.localeCompare(right.tournamentLabel) ||
        left.splitLabel.localeCompare(right.splitLabel) ||
        left.bracketId.localeCompare(right.bracketId),
    ),
    lastImportedAt,
    connectionStatus: "read_model_connected",
  };
}
