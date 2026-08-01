import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingPairRankingResult,
} from "@/domain/breeding-pair-ranking";
import { deriveFreshness } from "@/domain/freshness";

type BreedingRankingEvidence = Readonly<{
  rankings: readonly BreedingPairRankingInput[];
  latestAcceptedPerformanceImportAt: string | null;
  latestAcceptedArenaImportAt: string | null;
}>;

export type BreedingRankingRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadRankingEvidenceByOwner: (
        ownerId: string,
      ) => Promise<BreedingRankingEvidence>;
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
    throw new Error("Breeding now must be valid.");
  }
  return value;
}

function normalizedRanking(
  ranking: BreedingPairRankingInput,
  performanceImportAt: string | null,
  arenaImportAt: string | null,
  now: Date,
): BreedingPairRankingInput {
  if (typeof ranking !== "object" || ranking === null) {
    throw new Error("Breeding ranking evidence is invalid.");
  }
  const evaluatedAt = canonicalTimestamp(
    ranking.evaluatedAt,
    "Breeding evaluation time",
  );
  const dataCurrentThrough = canonicalTimestamp(
    ranking.dataCurrentThrough,
    "Breeding data current through",
  );
  const arenaDataCurrentThrough = canonicalTimestamp(
    ranking.arenaDataCurrentThrough,
    "Arena data current through",
  );
  if (evaluatedAt === null || Date.parse(evaluatedAt) > now.getTime()) {
    throw new Error("Breeding evaluation time cannot be missing or future.");
  }
  for (const [cutoff, importedAt, label] of [
    [dataCurrentThrough, performanceImportAt, "Breeding"],
    [arenaDataCurrentThrough, arenaImportAt, "Arena"],
  ] as const) {
    if (
      cutoff !== null &&
      (Date.parse(cutoff) > now.getTime() ||
        (importedAt !== null && Date.parse(cutoff) > Date.parse(importedAt)))
    ) {
      throw new Error(`${label} cutoff cannot be future or post-import.`);
    }
  }
  return {
    ...ranking,
    evaluatedAt,
    dataCurrentThrough,
    lastImported: performanceImportAt,
    freshness:
      performanceImportAt === null
        ? "unknown"
        : deriveFreshness(
            dataCurrentThrough === null ? null : new Date(dataCurrentThrough),
            now,
          ),
    arenaDataCurrentThrough,
    arenaLastImported: arenaImportAt,
    arenaFreshness:
      arenaImportAt === null
        ? "unknown"
        : deriveFreshness(
            arenaDataCurrentThrough === null
              ? null
              : new Date(arenaDataCurrentThrough),
            now,
          ),
  };
}

export async function loadBreedingWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: BreedingRankingRepository;
    now: Date;
  }>,
): Promise<BreedingWorkspacePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { rankings: [], connectionStatus: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Breeding workspace access denied.");
  }
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Breeding repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return { rankings: [], connectionStatus: "persistence_not_configured" };
  }
  if (typeof input.repository.loadRankingEvidenceByOwner !== "function") {
    throw new Error("Breeding repository is invalid.");
  }

  const evidence =
    await input.repository.loadRankingEvidenceByOwner(authenticatedOwnerId);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray(evidence.rankings)
  ) {
    throw new Error("Breeding ranking evidence is invalid.");
  }
  const performanceImportAt = canonicalTimestamp(
    evidence.latestAcceptedPerformanceImportAt,
    "Breeding accepted import",
  );
  const arenaImportAt = canonicalTimestamp(
    evidence.latestAcceptedArenaImportAt,
    "Arena accepted import",
  );
  if (
    [performanceImportAt, arenaImportAt].some(
      (value) => value !== null && Date.parse(value) > now.getTime(),
    )
  ) {
    throw new Error("Breeding accepted import cannot be future.");
  }
  const rankings = evidence.rankings.map((ranking) =>
    rankBreedingPairs(
      normalizedRanking(ranking, performanceImportAt, arenaImportAt, now),
    ),
  );
  if (
    new Set(rankings.map(({ rankingId }) => rankingId)).size !== rankings.length
  ) {
    throw new Error("Breeding ranking evidence must use unique IDs.");
  }
  if (
    new Set(rankings.map(({ rankingLabel }) => rankingLabel)).size !==
    rankings.length
  ) {
    throw new Error("Breeding ranking labels must map to unique IDs.");
  }

  return {
    rankings: rankings.sort((left, right) =>
      left.rankingId.localeCompare(right.rankingId),
    ),
    connectionStatus: "read_model_connected",
  };
}
