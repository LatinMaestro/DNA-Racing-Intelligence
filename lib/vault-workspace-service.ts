import {
  buildCurrentVaultRegistry,
  type CurrentVaultRegistry,
  type CurrentVaultSnapshot,
  type ManualMaidenOverride,
  type ManualOwnershipEdit,
} from "@/domain/vault-registry";

export type VaultRegistryRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadVaultEvidenceByOwner: (ownerId: string) => Promise<
        Readonly<{
          snapshot: CurrentVaultSnapshot | null;
          ownershipEdits: readonly ManualOwnershipEdit[];
          maidenOverrides: readonly ManualMaidenOverride[];
          knownCoreIds: readonly string[];
        }>
      >;
    }>;

export type VaultWorkspaceConnectionStatus =
  | "identity_not_connected"
  | "persistence_not_configured"
  | "read_model_connected";

export type VaultWorkspacePageState = Readonly<{
  registry: CurrentVaultRegistry;
  connectionStatus: VaultWorkspaceConnectionStatus;
}>;

export const unavailableVaultRegistryRepository: VaultRegistryRepository =
  Object.freeze({ status: "not_configured" });

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function emptyRegistry(now: Date): CurrentVaultRegistry {
  return buildCurrentVaultRegistry({
    snapshot: null,
    ownershipEdits: [],
    maidenOverrides: [],
    knownCoreIds: [],
    now,
  });
}

export async function loadVaultWorkspacePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: VaultRegistryRepository;
    now: Date;
  }>,
): Promise<VaultWorkspacePageState> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      registry: emptyRegistry(input.now),
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Vault workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      registry: emptyRegistry(input.now),
      connectionStatus: "persistence_not_configured",
    };
  }

  const evidence =
    await input.repository.loadVaultEvidenceByOwner(authenticatedOwnerId);
  return {
    registry: buildCurrentVaultRegistry({ ...evidence, now: input.now }),
    connectionStatus: "read_model_connected",
  };
}
