import {
  allocateMaidenVaultOpportunities,
  type MaidenAllocationBracketInput,
  type MaidenAllocationCandidateInput,
  type MaidenVaultAllocation,
} from "@/domain/maiden-vault-allocation";

export type MaidenAllocationRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadAllocationEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          brackets: readonly MaidenAllocationBracketInput[];
          candidates: readonly MaidenAllocationCandidateInput[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type MaidenWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type MaidenWorkspacePageState = Readonly<{
  allocation: MaidenVaultAllocation | null;
  lastImportedAt: string | null;
  connectionStatus: MaidenWorkspaceConnectionStatus;
}>;

export const unavailableMaidenAllocationRepository: MaidenAllocationRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function validTimestamp(value: string | null): boolean {
  return value === null || !Number.isNaN(Date.parse(value));
}

export async function loadMaidenWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: MaidenAllocationRepository;
  }>,
): Promise<MaidenWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Maiden workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      allocation: null,
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const evidence =
    await input.repository.loadAllocationEvidenceByOwner(authenticatedOwnerId);
  if (!validTimestamp(evidence.lastImportedAt)) {
    throw new Error("Maiden import timestamp is invalid.");
  }
  if (evidence.brackets.length === 0 && evidence.candidates.length > 0) {
    throw new Error("Maiden candidates require configured brackets.");
  }

  return {
    allocation:
      evidence.brackets.length === 0
        ? null
        : allocateMaidenVaultOpportunities(
            evidence.brackets,
            evidence.candidates,
          ),
    lastImportedAt: evidence.lastImportedAt,
    connectionStatus: "read_model_connected",
  };
}
