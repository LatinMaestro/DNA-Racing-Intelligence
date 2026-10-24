import {
  rankBreedingPairs,
  type BreedingPairRankingInput,
  type BreedingPairRankingResult,
} from "@/domain/breeding-pair-ranking";
import { deriveFreshness } from "@/domain/freshness";
import {
  ownerVaultClasses,
  ownerVaultElements,
  ownerVaultSexes,
  type OwnerVaultCatalogueCoverage,
  type OwnerVaultCatalogueRepository,
} from "@/lib/owner-vault-catalogue-service";

type BreedingRankingEvidence = Readonly<{
  rankings: readonly BreedingPairRankingInput[];
  latestAcceptedPerformanceImportAt: string | null;
  latestAcceptedArenaImportAt: string | null;
  generationId: string | null;
  payloadSha256: string | null;
  publishedAt: string | null;
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
  | "read_failed"
  | "integrity_failed"
  | "read_model_connected";

export type BreedingWorkspacePageState = Readonly<{
  rankings: readonly BreedingPairRankingResult[];
  connectionStatus: BreedingWorkspaceConnectionStatus;
  generationId: string | null;
  payloadSha256: string | null;
  publishedAt: string | null;
  vaultInventory?: BreedingVaultInventory;
}>;

export type BreedingVaultInventory = Readonly<{
  ownedCoreCount: number;
  sexCounts: Readonly<Record<(typeof ownerVaultSexes)[number], number>>;
  elementCounts: Readonly<Record<(typeof ownerVaultElements)[number], number>>;
  classCounts: Readonly<Record<(typeof ownerVaultClasses)[number], number>>;
  minimumFNumber: number | null;
  maximumFNumber: number | null;
  coverage: OwnerVaultCatalogueCoverage | null;
  generationId: string | null;
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
}>;

export const unavailableBreedingRankingRepository: BreedingRankingRepository =
  Object.freeze({ status: "not_configured" });

async function loadVaultInventory(
  repository: OwnerVaultCatalogueRepository | undefined,
  ownerId: string,
): Promise<BreedingVaultInventory | null> {
  if (repository === undefined || repository.status !== "ready") return null;
  const filters = {
    scope: "vault" as const,
    query: null,
    element: null,
    coreClass: null,
    sex: null,
    fNumber: null,
  };
  const read = repository.readCataloguePageByOwner
    ? await repository.readCataloguePageByOwner(ownerId, filters)
    : {
        cores: await repository.listCoresByOwner(ownerId, filters),
        publication: null,
      };
  const owned = read.cores.filter(({ inMyVault }) => inMyVault);
  const fNumbers = owned.map(({ fNumber }) => fNumber);
  return {
    ownedCoreCount: owned.length,
    sexCounts: Object.fromEntries(
      ownerVaultSexes.map((sex) => [
        sex,
        owned.filter((core) => core.sex === sex).length,
      ]),
    ) as Record<(typeof ownerVaultSexes)[number], number>,
    elementCounts: Object.fromEntries(
      ownerVaultElements.map((element) => [
        element,
        owned.filter((core) => core.element === element).length,
      ]),
    ) as Record<(typeof ownerVaultElements)[number], number>,
    classCounts: Object.fromEntries(
      ownerVaultClasses.map((coreClass) => [
        coreClass,
        owned.filter((core) => core.coreClass === coreClass).length,
      ]),
    ) as Record<(typeof ownerVaultClasses)[number], number>,
    minimumFNumber: fNumbers.length === 0 ? null : Math.min(...fNumbers),
    maximumFNumber: fNumbers.length === 0 ? null : Math.max(...fNumbers),
    coverage: "coverage" in read ? (read.coverage ?? null) : null,
    generationId:
      "apiSnapshot" in read ? (read.apiSnapshot?.generationId ?? null) : null,
    oldestObservedAt:
      "apiSnapshot" in read
        ? (read.apiSnapshot?.oldestObservedAt ?? null)
        : null,
    newestObservedAt:
      "apiSnapshot" in read
        ? (read.apiSnapshot?.newestObservedAt ?? null)
        : null,
  };
}

function withheldEvidence(
  connectionStatus: "read_failed" | "integrity_failed",
): BreedingWorkspacePageState {
  return {
    rankings: [],
    connectionStatus,
    generationId: null,
    payloadSha256: null,
    publishedAt: null,
  };
}

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
    vaultRepository?: OwnerVaultCatalogueRepository;
    now: Date;
  }>,
): Promise<BreedingWorkspacePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      rankings: [],
      connectionStatus: "identity_not_connected",
      generationId: null,
      payloadSha256: null,
      publishedAt: null,
    };
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
    return {
      rankings: [],
      connectionStatus: "persistence_not_configured",
      generationId: null,
      payloadSha256: null,
      publishedAt: null,
    };
  }
  if (typeof input.repository.loadRankingEvidenceByOwner !== "function") {
    throw new Error("Breeding repository is invalid.");
  }

  let evidence: BreedingRankingEvidence;
  try {
    evidence =
      await input.repository.loadRankingEvidenceByOwner(authenticatedOwnerId);
  } catch (error) {
    if (
      error instanceof Error &&
      /(access denied|owner scope denied)/i.test(error.message)
    ) {
      throw error;
    }
    // Withhold the whole owner-scoped snapshot and provider error details.
    // A failed read must never fall back to stale or inferred pair rankings.
    return withheldEvidence("read_failed");
  }

  try {
    if (
      typeof evidence !== "object" ||
      evidence === null ||
      !Array.isArray(evidence.rankings) ||
      !("generationId" in evidence) ||
      !("payloadSha256" in evidence) ||
      !("publishedAt" in evidence)
    ) {
      throw new Error("Breeding ranking evidence is invalid.");
    }
    const generationId = evidence.generationId;
    const payloadSha256 = evidence.payloadSha256;
    const publishedAt = canonicalTimestamp(
      evidence.publishedAt,
      "Breeding publication time",
    );
    const hasPublicationIdentity =
      generationId !== null || payloadSha256 !== null || publishedAt !== null;
    if (
      hasPublicationIdentity &&
      (typeof generationId !== "string" ||
        !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(
          generationId,
        ) ||
        typeof payloadSha256 !== "string" ||
        !/^[a-f0-9]{64}$/.test(payloadSha256) ||
        publishedAt === null ||
        Date.parse(publishedAt) > now.getTime())
    ) {
      throw new Error("Breeding publication identity is invalid.");
    }
    if (!hasPublicationIdentity && evidence.rankings.length > 0) {
      throw new Error("Breeding rankings require publication identity.");
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
    if (
      publishedAt !== null &&
      [performanceImportAt, arenaImportAt].some(
        (value) =>
          value !== null && Date.parse(value) > Date.parse(publishedAt),
      )
    ) {
      throw new Error("Breeding accepted import cannot postdate publication.");
    }
    const rankings = evidence.rankings.map((ranking) =>
      rankBreedingPairs(
        normalizedRanking(ranking, performanceImportAt, arenaImportAt, now),
      ),
    );
    if (
      new Set(rankings.map(({ rankingId }) => rankingId)).size !==
      rankings.length
    ) {
      throw new Error("Breeding ranking evidence must use unique IDs.");
    }
    if (
      new Set(rankings.map(({ rankingLabel }) => rankingLabel)).size !==
      rankings.length
    ) {
      throw new Error("Breeding ranking labels must map to unique IDs.");
    }
    if (
      publishedAt !== null &&
      rankings.some(
        ({ evaluatedAt }) => Date.parse(evaluatedAt) > Date.parse(publishedAt),
      )
    ) {
      throw new Error("Breeding evaluation cannot postdate publication.");
    }

    const vaultInventory = await loadVaultInventory(
      input.vaultRepository,
      authenticatedOwnerId,
    );
    return {
      rankings: rankings.sort((left, right) =>
        left.rankingId.localeCompare(right.rankingId),
      ),
      connectionStatus: "read_model_connected",
      generationId,
      payloadSha256,
      publishedAt,
      ...(vaultInventory === null ? {} : { vaultInventory }),
    };
  } catch {
    // Invalid or mixed-version evidence is not a partly usable ranking.
    return withheldEvidence("integrity_failed");
  }
}
