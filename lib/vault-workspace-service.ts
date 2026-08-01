import {
  buildCurrentVaultRegistry,
  maidenStates,
  manualMaidenStates,
  ownershipActions,
  type CurrentVaultRegistry,
  type CurrentVaultSnapshot,
  type ManualMaidenOverride,
  type ManualOwnershipEdit,
} from "@/domain/vault-registry";

type VaultRepositoryEvidence = Readonly<{
  snapshot: CurrentVaultSnapshot | null;
  ownershipEdits: readonly ManualOwnershipEdit[];
  maidenOverrides: readonly ManualMaidenOverride[];
  knownCoreIds: readonly string[];
}>;

export type VaultRegistryRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      loadVaultEvidenceByOwner: (
        ownerId: string,
      ) => Promise<VaultRepositoryEvidence>;
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

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function object(value: unknown, field: string): Record<string, unknown> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${field} is invalid`);
  }
  return value as Record<string, unknown>;
}

function array(value: unknown, field: string): readonly unknown[] {
  if (!Array.isArray(value)) throw new Error(`${field} must be an array`);
  return value;
}

function safeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function nullableIdentifier(value: unknown, field: string): string | null {
  return value === null ? null : safeIdentifier(value, field);
}

function text(value: unknown, field: string): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error(`${field} is required`);
  }
  return value.trim();
}

function timestamp(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
  return value;
}

function allowlistedValue<const Values extends readonly string[]>(
  value: unknown,
  values: Values,
  field: string,
): Values[number] {
  if (
    typeof value !== "string" ||
    !values.some((candidate) => candidate === value)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return value as Values[number];
}

function normalizeSnapshot(value: unknown): CurrentVaultSnapshot | null {
  if (value === null) return null;
  const snapshot = object(value, "Vault snapshot");
  return {
    snapshotId: safeIdentifier(snapshot.snapshotId, "snapshotId"),
    dataCurrentThrough: timestamp(
      snapshot.dataCurrentThrough,
      "dataCurrentThrough",
    ),
    lastImportedAt: timestamp(snapshot.lastImportedAt, "lastImportedAt"),
    entries: array(snapshot.entries, "Vault snapshot entries").map(
      (value, index) => {
        const entry = object(value, `Vault snapshot entry ${index}`);
        return {
          entryId: safeIdentifier(entry.entryId, "entryId"),
          proposedCoreId: nullableIdentifier(
            entry.proposedCoreId,
            "proposedCoreId",
          ),
          confirmedCoreId: nullableIdentifier(
            entry.confirmedCoreId,
            "confirmedCoreId",
          ),
          maidenState: allowlistedValue(
            entry.maidenState,
            maidenStates,
            `Vault snapshot entry ${index} Maiden state`,
          ),
        };
      },
    ),
  };
}

function normalizeOwnershipEdits(
  value: unknown,
): readonly ManualOwnershipEdit[] {
  return array(value, "ownershipEdits").map((value, index) => {
    const edit = object(value, `ownership edit ${index}`);
    return {
      editId: safeIdentifier(edit.editId, "editId"),
      coreId: safeIdentifier(edit.coreId, "coreId"),
      action: allowlistedValue(
        edit.action,
        ownershipActions,
        `ownership edit ${index} action`,
      ),
      effectiveAt: timestamp(edit.effectiveAt, "ownership effectiveAt"),
      reason: text(edit.reason, "ownership edit reason"),
    };
  });
}

function normalizeMaidenOverrides(
  value: unknown,
): readonly ManualMaidenOverride[] {
  return array(value, "maidenOverrides").map((value, index) => {
    const override = object(value, `Maiden override ${index}`);
    return {
      overrideId: safeIdentifier(override.overrideId, "overrideId"),
      coreId: safeIdentifier(override.coreId, "coreId"),
      maidenState: allowlistedValue(
        override.maidenState,
        manualMaidenStates,
        `Maiden override ${index} state`,
      ),
      effectiveAt: timestamp(override.effectiveAt, "Maiden effectiveAt"),
      reason: text(override.reason, "Maiden override reason"),
    };
  });
}

function normalizeRepositoryEvidence(value: unknown): VaultRepositoryEvidence {
  const evidence = object(value, "Vault repository evidence");
  return {
    snapshot: normalizeSnapshot(evidence.snapshot),
    ownershipEdits: normalizeOwnershipEdits(evidence.ownershipEdits),
    maidenOverrides: normalizeMaidenOverrides(evidence.maidenOverrides),
    knownCoreIds: array(evidence.knownCoreIds, "knownCoreIds").map((coreId) =>
      safeIdentifier(coreId, "known coreId"),
    ),
  };
}

function normalizedIdentity(value: unknown): string | null {
  if (value === null) return null;
  return safeIdentifier(value, "owner identity");
}

function validNow(value: unknown): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error("now must be valid");
  }
  return value;
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
  const now = validNow(input.now);
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return {
      registry: emptyRegistry(now),
      connectionStatus: "identity_not_connected",
    };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Vault workspace access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      registry: emptyRegistry(now),
      connectionStatus: "persistence_not_configured",
    };
  }
  if (
    input.repository.status !== "ready" ||
    typeof input.repository.loadVaultEvidenceByOwner !== "function"
  ) {
    throw new Error("Vault repository is invalid");
  }

  const evidence = normalizeRepositoryEvidence(
    await input.repository.loadVaultEvidenceByOwner(authenticatedOwnerId),
  );
  return {
    registry: buildCurrentVaultRegistry({ ...evidence, now }),
    connectionStatus: "read_model_connected",
  };
}
