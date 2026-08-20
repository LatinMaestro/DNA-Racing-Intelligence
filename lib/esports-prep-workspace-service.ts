import {
  prepareEsportsProLeague,
  type EsportsProLeaguePreparation,
  type EsportsRosterCandidateInput,
} from "@/domain/esports-pro-league";
import type { CorePerformanceProfileRepository } from "@/lib/core-intelligence-workspace-service";
import type { OwnerVaultCatalogueRepository } from "@/lib/owner-vault-catalogue-service";

export type EsportsPrepRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadPreparationEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          candidates: readonly EsportsRosterCandidateInput[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type EsportsPrepConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type EsportsPrepWorkspacePageState = Readonly<{
  connectionStatus: EsportsPrepConnectionStatus;
  preparation: EsportsProLeaguePreparation | null;
  lastImportedAt: string | null;
}>;

export const unavailableEsportsPrepRepository: EsportsPrepRepository =
  Object.freeze({ status: "not_configured" });

export function createEsportsPrepRepository(
  input: Readonly<{
    vaultRepository: OwnerVaultCatalogueRepository;
    performanceRepository: CorePerformanceProfileRepository;
  }>,
): EsportsPrepRepository {
  if (
    input.vaultRepository.status !== "ready" ||
    input.performanceRepository.status !== "ready"
  ) {
    return unavailableEsportsPrepRepository;
  }
  const vaultRepository = input.vaultRepository;
  const performanceRepository = input.performanceRepository;
  return {
    status: "ready",
    async loadPreparationEvidenceByOwner(ownerId) {
      const [ownedCores, performance] = await Promise.all([
        vaultRepository.listCoresByOwner(ownerId, {
          scope: "vault",
          query: null,
          element: null,
          coreClass: null,
          sex: null,
          fNumber: null,
        }),
        performanceRepository.listProfilesByOwner(ownerId),
      ]);
      const bikeProfilesByCore = new Map<
        string,
        EsportsRosterCandidateInput["bikeProfiles"]
      >();
      for (const profile of performance.profiles) {
        if (profile.mode !== "bike") continue;
        const existing = bikeProfilesByCore.get(profile.coreId) ?? [];
        bikeProfilesByCore.set(profile.coreId, [
          ...existing,
          {
            distanceMetres: profile.distance,
            raceCount: profile.raceCount,
            sampleStatus: profile.sampleStatus,
            freshness: profile.freshness,
            dataCurrentThrough: profile.dataCurrentThrough,
          },
        ]);
      }
      const candidates = ownedCores
        .filter(({ inMyVault }) => inMyVault)
        .map(
          (core): EsportsRosterCandidateInput => ({
            coreId: core.sourceCoreId,
            displayName: core.displayName,
            coreClass: core.coreClass,
            element: core.element,
            fNumber: core.fNumber,
            sex: core.sex,
            bikeProfiles: bikeProfilesByCore.get(core.sourceCoreId) ?? [],
          }),
        );
      return { candidates, lastImportedAt: performance.lastImportedAt };
    },
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

export async function loadEsportsPrepWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: EsportsPrepRepository;
  }>,
): Promise<EsportsPrepWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      connectionStatus: "identity_not_connected",
      preparation: null,
      lastImportedAt: null,
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Esports preparation workspace access denied.");
  }
  if (
    typeof input.repository !== "object" ||
    input.repository === null ||
    !["not_configured", "ready"].includes(input.repository.status)
  ) {
    throw new Error("Esports preparation repository status is invalid.");
  }
  if (input.repository.status === "not_configured") {
    return {
      connectionStatus: "persistence_not_configured",
      preparation: null,
      lastImportedAt: null,
    };
  }
  if (typeof input.repository.loadPreparationEvidenceByOwner !== "function") {
    throw new Error("Esports preparation repository is invalid.");
  }
  const evidence =
    await input.repository.loadPreparationEvidenceByOwner(authenticatedOwnerId);
  if (
    typeof evidence !== "object" ||
    evidence === null ||
    !Array.isArray(evidence.candidates)
  ) {
    throw new Error("Esports preparation evidence is invalid.");
  }
  return {
    connectionStatus: "read_model_connected",
    preparation: prepareEsportsProLeague(evidence.candidates),
    lastImportedAt: canonicalTimestamp(
      evidence.lastImportedAt,
      "Esports preparation import timestamp",
    ),
  };
}
