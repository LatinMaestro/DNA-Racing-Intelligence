import {
  allocateMaidenVaultOpportunities,
  type MaidenAllocationBracketInput,
  type MaidenAllocationCandidateInput,
  type MaidenVaultAllocation,
} from "@/domain/maiden-vault-allocation";
import { deriveFreshness } from "@/domain/freshness";
import type {
  OwnerVaultCatalogueCoverage,
  OwnerVaultCatalogueRepository,
} from "@/lib/owner-vault-catalogue-service";

export type MaidenAllocationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadAllocationEvidenceByOwner: (
        ownerId: string,
      ) => Promise<MaidenAllocationEvidenceEnvelope | null>;
    }>;

export type MaidenAllocationEvidence = Readonly<{
  brackets: readonly MaidenAllocationBracketInput[];
  candidates: readonly MaidenAllocationCandidateInput[];
  lastImportedAt: string | null;
}>;

export type MaidenAllocationEvidenceEnvelope = Readonly<{
  evidence: MaidenAllocationEvidence;
  sourceEvidenceSha256: string;
  snapshotSha256: string;
  materializedAt: string;
}>;

export type MaidenWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type MaidenWorkspacePageState = Readonly<{
  allocation: MaidenVaultAllocation | null;
  lastImportedAt: string | null;
  sourceEvidenceSha256: string | null;
  snapshotSha256: string | null;
  materializedAt: string | null;
  connectionStatus: MaidenWorkspaceConnectionStatus;
  eligibilitySummary?: MaidenEligibilitySummary;
}>;

export type MaidenEligibilitySummary = Readonly<{
  ownedCoreCount: number;
  knownEligibleCount: number;
  knownNotEligibleCount: number;
  unknownEligibilityCount: number;
  coverage: OwnerVaultCatalogueCoverage | null;
  generationId: string | null;
  oldestObservedAt: string | null;
  newestObservedAt: string | null;
  cores: readonly MaidenEligibilityCore[];
}>;

export type MaidenEligibilityCore = Readonly<{
  sourceCoreId: string;
  displayName: string;
  coreClass: string;
  element: string;
  fNumber: number;
  sex: string;
  meEligible: boolean | null;
}>;

export const unavailableMaidenAllocationRepository: MaidenAllocationRepository =
  Object.freeze({ status: "not_configured" });

async function loadEligibilitySummary(
  repository: OwnerVaultCatalogueRepository | undefined,
  ownerId: string,
): Promise<MaidenEligibilitySummary | null> {
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
  const eligibilityOrder = (value: boolean | null) =>
    value === true ? 0 : value === null ? 1 : 2;
  const cores = owned
    .map(
      ({
        sourceCoreId,
        displayName,
        coreClass,
        element,
        fNumber,
        sex,
        meEligible,
      }) => ({
        sourceCoreId,
        displayName,
        coreClass,
        element,
        fNumber,
        sex,
        meEligible,
      }),
    )
    .sort(
      (left, right) =>
        eligibilityOrder(left.meEligible) -
          eligibilityOrder(right.meEligible) ||
        left.displayName.localeCompare(right.displayName, "en-AU") ||
        left.sourceCoreId.localeCompare(right.sourceCoreId, "en-AU", {
          numeric: true,
        }),
    );
  return {
    ownedCoreCount: owned.length,
    knownEligibleCount: owned.filter(({ meEligible }) => meEligible === true)
      .length,
    knownNotEligibleCount: owned.filter(
      ({ meEligible }) => meEligible === false,
    ).length,
    unknownEligibilityCount: owned.filter(
      ({ meEligible }) => meEligible === null,
    ).length,
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
    cores: Object.freeze(cores),
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
    throw new Error("Maiden now must be valid.");
  }
  return value;
}

function normalizeCandidates(
  candidates: readonly MaidenAllocationCandidateInput[],
  lastImportedAt: string | null,
  now: Date,
): readonly MaidenAllocationCandidateInput[] {
  const importedAtMillis =
    lastImportedAt === null ? null : Date.parse(lastImportedAt);
  return candidates.map((candidate) => {
    if (typeof candidate !== "object" || candidate === null) {
      throw new Error("Maiden candidate evidence is invalid.");
    }
    const dataCurrentThrough = canonicalTimestamp(
      candidate.dataCurrentThrough,
      "Maiden data current through",
    );
    if (dataCurrentThrough !== null) {
      const cutoffMillis = Date.parse(dataCurrentThrough);
      if (
        cutoffMillis > now.getTime() ||
        (importedAtMillis !== null && cutoffMillis > importedAtMillis)
      ) {
        throw new Error(
          "Maiden data cutoff cannot be in the future or follow its import.",
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
              dataCurrentThrough === null ? null : new Date(dataCurrentThrough),
              now,
            ),
    };
  });
}

export function normalizeMaidenAllocationEvidence(
  evidence: unknown,
  nowInput: Date,
): MaidenAllocationEvidence {
  const now = validNow(nowInput);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray((evidence as MaidenAllocationEvidence).brackets) ||
    !Array.isArray((evidence as MaidenAllocationEvidence).candidates)
  ) {
    throw new Error("Maiden evidence is invalid.");
  }
  const input = evidence as MaidenAllocationEvidence;
  const lastImportedAt = canonicalTimestamp(
    input.lastImportedAt,
    "Maiden import timestamp",
  );
  if (lastImportedAt !== null && Date.parse(lastImportedAt) > now.getTime()) {
    throw new Error("Maiden import timestamp cannot be in the future.");
  }
  if (input.brackets.length === 0 && input.candidates.length > 0) {
    throw new Error("Maiden candidates require configured brackets.");
  }
  const candidates = normalizeCandidates(input.candidates, lastImportedAt, now);
  if (input.brackets.length > 0) {
    // Reuse the approved allocator as the complete evidence/version validator.
    // Its output is deliberately discarded; callers decide when to allocate.
    allocateMaidenVaultOpportunities(input.brackets, candidates);
  }
  return {
    brackets: input.brackets,
    candidates,
    lastImportedAt,
  };
}

export async function loadMaidenWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: MaidenAllocationRepository;
    vaultRepository?: OwnerVaultCatalogueRepository;
    now: Date;
  }>,
): Promise<MaidenWorkspacePageState> {
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Maiden workspace access denied.");
  }
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Maiden repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return {
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }
  if (typeof input.repository.loadAllocationEvidenceByOwner !== "function") {
    throw new Error("Maiden repository is invalid.");
  }

  const [persistedEvidence, eligibilitySummary] = await Promise.all([
    input.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId),
    loadEligibilitySummary(input.vaultRepository, authenticatedOwnerId),
  ]);
  if (persistedEvidence === null) {
    return {
      allocation: null,
      lastImportedAt: null,
      sourceEvidenceSha256: null,
      snapshotSha256: null,
      materializedAt: null,
      connectionStatus: "read_model_connected",
      ...(eligibilitySummary === null ? {} : { eligibilitySummary }),
    };
  }
  if (
    !/^[a-f0-9]{64}$/.test(persistedEvidence.sourceEvidenceSha256) ||
    !/^[a-f0-9]{64}$/.test(persistedEvidence.snapshotSha256)
  ) {
    throw new Error("Maiden publication identity is invalid.");
  }
  const materializedAt = canonicalTimestamp(
    persistedEvidence.materializedAt,
    "Maiden materialization timestamp",
  );
  if (materializedAt === null || Date.parse(materializedAt) > now.getTime()) {
    throw new Error("Maiden materialization timestamp is invalid.");
  }
  const evidence = normalizeMaidenAllocationEvidence(
    persistedEvidence.evidence,
    now,
  );

  return {
    allocation:
      evidence.brackets.length === 0
        ? null
        : allocateMaidenVaultOpportunities(
            evidence.brackets,
            evidence.candidates,
          ),
    lastImportedAt: evidence.lastImportedAt,
    sourceEvidenceSha256: persistedEvidence.sourceEvidenceSha256,
    snapshotSha256: persistedEvidence.snapshotSha256,
    materializedAt,
    connectionStatus: "read_model_connected",
    ...(eligibilitySummary === null ? {} : { eligibilitySummary }),
  };
}
