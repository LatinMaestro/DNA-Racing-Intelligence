import {
  buildDiscoveryProbePlan,
  type DiscoveryProbeCandidate,
  type DiscoveryProbeCandidateInput,
} from "@/domain/discovery-probe-plan";

export type DiscoveryProbeRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCandidateEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          candidates: readonly DiscoveryProbeCandidateInput[];
          lastImportedAt: string | null;
        }>
      >;
    }>;

export type DiscoveryWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type DiscoveryWorkspacePageState = Readonly<{
  candidates: readonly DiscoveryProbeCandidate[];
  lastImportedAt: string | null;
  connectionStatus: DiscoveryWorkspaceConnectionStatus;
}>;

export const unavailableDiscoveryProbeRepository: DiscoveryProbeRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function validTimestamp(value: string | null): boolean {
  return value === null || !Number.isNaN(Date.parse(value));
}

export async function loadDiscoveryWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: DiscoveryProbeRepository;
  }>,
): Promise<DiscoveryWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      candidates: [],
      lastImportedAt: null,
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Discovery workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      candidates: [],
      lastImportedAt: null,
      connectionStatus: "persistence_not_configured",
    };
  }

  const evidence =
    await input.repository.listCandidateEvidenceByOwner(authenticatedOwnerId);
  if (!validTimestamp(evidence.lastImportedAt)) {
    throw new Error("Discovery import timestamp is invalid.");
  }
  return {
    candidates: buildDiscoveryProbePlan(evidence.candidates),
    lastImportedAt: evidence.lastImportedAt,
    connectionStatus: "read_model_connected",
  };
}
