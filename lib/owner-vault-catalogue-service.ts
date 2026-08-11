export const ownerVaultElements = ["Metal", "Fire", "Earth", "Water"] as const;
export type OwnerVaultElement = (typeof ownerVaultElements)[number];

export const ownerVaultClasses = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
] as const;
export type OwnerVaultClass = (typeof ownerVaultClasses)[number];

export const ownerVaultSexes = ["male", "female"] as const;
export type OwnerVaultSex = (typeof ownerVaultSexes)[number];

export type OwnerVaultCatalogueFilters = Readonly<{
  scope: "vault" | "catalogue";
  query: string | null;
  element: OwnerVaultElement | null;
  coreClass: OwnerVaultClass | null;
  sex: OwnerVaultSex | null;
  fNumber: number | null;
}>;

export type OwnerVaultCatalogueCore = Readonly<{
  sourceCoreId: string;
  displayName: string;
  coreClass: OwnerVaultClass;
  element: OwnerVaultElement;
  fNumber: number;
  sex: OwnerVaultSex;
  inMyVault: boolean;
  meEligible: boolean;
  version: number;
  updatedAt: string | null;
}>;

export type OwnerVaultCatalogueRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCoresByOwner: (
        ownerId: string,
        filters: OwnerVaultCatalogueFilters,
      ) => Promise<readonly OwnerVaultCatalogueCore[]>;
    }>;

export type OwnerVaultCataloguePageState = Readonly<{
  connectionStatus:
    "identity_not_connected" | "persistence_not_configured" | "connected";
  filters: OwnerVaultCatalogueFilters;
  cores: readonly OwnerVaultCatalogueCore[];
}>;

const SAFE_OWNER_ID = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function ownerId(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  if (normalized === "") return null;
  if (!SAFE_OWNER_ID.test(normalized))
    throw new Error("Vault owner identity is invalid.");
  return normalized;
}

function query(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "string")
    throw new Error("Vault search query is invalid.");
  const normalized = value.trim();
  if (normalized === "") return null;
  if (normalized.length > 128)
    throw new Error("Vault search query is too long.");
  return normalized;
}

function enumValue<T extends readonly string[]>(
  value: unknown,
  values: T,
  label: string,
): T[number] | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value !== "string" || !values.includes(value)) {
    throw new Error(`Vault ${label} filter is invalid.`);
  }
  return value as T[number];
}

function fNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  const parsed =
    typeof value === "string" && /^\d+$/.test(value) ? Number(value) : value;
  if (!Number.isSafeInteger(parsed) || (parsed as number) <= 0) {
    throw new Error("Vault F-number filter is invalid.");
  }
  return parsed as number;
}

export function normalizeOwnerVaultCatalogueFilters(
  input: Readonly<{
    scope?: unknown;
    query?: unknown;
    element?: unknown;
    coreClass?: unknown;
    sex?: unknown;
    fNumber?: unknown;
  }>,
): OwnerVaultCatalogueFilters {
  const scope = input.scope ?? "vault";
  if (scope !== "vault" && scope !== "catalogue") {
    throw new Error("Vault search scope is invalid.");
  }
  return {
    scope,
    query: query(input.query),
    element: enumValue(input.element, ownerVaultElements, "element"),
    coreClass: enumValue(input.coreClass, ownerVaultClasses, "class"),
    sex: enumValue(input.sex, ownerVaultSexes, "sex"),
    fNumber: fNumber(input.fNumber),
  };
}

function validateCore(value: OwnerVaultCatalogueCore): OwnerVaultCatalogueCore {
  if (
    typeof value.sourceCoreId !== "string" ||
    value.sourceCoreId.trim() === "" ||
    typeof value.displayName !== "string" ||
    value.displayName.trim() === "" ||
    !ownerVaultClasses.includes(value.coreClass) ||
    !ownerVaultElements.includes(value.element) ||
    !ownerVaultSexes.includes(value.sex) ||
    !Number.isSafeInteger(value.fNumber) ||
    value.fNumber <= 0 ||
    typeof value.inMyVault !== "boolean" ||
    typeof value.meEligible !== "boolean" ||
    !Number.isSafeInteger(value.version) ||
    value.version < 0 ||
    (!value.inMyVault && value.meEligible)
  ) {
    throw new Error("Vault catalogue core is invalid.");
  }
  if (value.updatedAt !== null) {
    const parsed = new Date(value.updatedAt);
    if (
      Number.isNaN(parsed.getTime()) ||
      parsed.toISOString() !== value.updatedAt
    ) {
      throw new Error("Vault catalogue timestamp is invalid.");
    }
  }
  if (value.version === 0 && value.updatedAt !== null) {
    throw new Error(
      "Unedited Vault catalogue core cannot have an update timestamp.",
    );
  }
  return value;
}

export async function loadOwnerVaultCataloguePageState(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    repository: OwnerVaultCatalogueRepository;
    filters: Readonly<{
      scope?: unknown;
      query?: unknown;
      element?: unknown;
      coreClass?: unknown;
      sex?: unknown;
      fNumber?: unknown;
    }>;
  }>,
): Promise<OwnerVaultCataloguePageState> {
  const filters = normalizeOwnerVaultCatalogueFilters(input.filters);
  const authenticatedOwnerId = ownerId(input.authenticatedOwnerId);
  const configuredOwnerId = ownerId(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { connectionStatus: "identity_not_connected", filters, cores: [] };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Vault catalogue access denied.");
  }
  if (input.repository.status === "not_configured") {
    return {
      connectionStatus: "persistence_not_configured",
      filters,
      cores: [],
    };
  }
  if (typeof input.repository.listCoresByOwner !== "function") {
    throw new Error("Vault catalogue repository is invalid.");
  }
  const cores = (
    await input.repository.listCoresByOwner(authenticatedOwnerId, filters)
  ).map(validateCore);
  const seen = new Set<string>();
  for (const core of cores) {
    if (seen.has(core.sourceCoreId))
      throw new Error("Vault catalogue contains a duplicate core.");
    seen.add(core.sourceCoreId);
    if (filters.scope === "vault" && !core.inMyVault) {
      throw new Error(
        "Vault catalogue returned an inactive core for My Vault.",
      );
    }
  }
  return { connectionStatus: "connected", filters, cores };
}
