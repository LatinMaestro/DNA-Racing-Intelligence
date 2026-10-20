export const OWNER_VAULT_LIST_LIMIT = 500;
export const OWNER_CORE_CATALOGUE_LIST_LIMIT = 50;

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
  meEligible: boolean | null;
  version: number | null;
  updatedAt: string | null;
  source?: "owner_registry" | "accepted_owner_api_snapshot";
}>;

export type OwnerVaultCatalogueCoverage =
  "accepted_core_details_catalogue" | "accepted_owner_api_snapshot";

export type OwnerVaultApiSnapshot = Readonly<{
  generationId: string;
  coreCount: number;
  oldestObservedAt: string;
  newestObservedAt: string;
}>;

export type OwnerVaultCataloguePublication = Readonly<{
  coreDatasetVersionId: string;
  importBatchId: string;
  sourceSha256: string;
  sourceRowCount: number;
  acceptedRowCount: number;
  coreCount: number;
  evidenceRowCount: number;
  activatedAt: string;
  dataCurrentThrough: string | null;
  aggregateRefreshedAt: string;
  evidenceSealedAt: string;
}>;

export type OwnerVaultCatalogueRead = Readonly<{
  cores: readonly OwnerVaultCatalogueCore[];
  publication: OwnerVaultCataloguePublication | null;
  coverage?: OwnerVaultCatalogueCoverage;
  apiSnapshot?: OwnerVaultApiSnapshot | null;
}>;

export type OwnerVaultCatalogueRepository =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      listCoresByOwner: (
        ownerId: string,
        filters: OwnerVaultCatalogueFilters,
      ) => Promise<readonly OwnerVaultCatalogueCore[]>;
      readCataloguePageByOwner?: (
        ownerId: string,
        filters: OwnerVaultCatalogueFilters,
      ) => Promise<OwnerVaultCatalogueRead>;
    }>;

export type OwnerVaultCataloguePageState = Readonly<{
  connectionStatus:
    | "identity_not_connected"
    | "persistence_not_configured"
    | "read_failed"
    | "integrity_failed"
    | "connected";
  filters: OwnerVaultCatalogueFilters;
  cores: readonly OwnerVaultCatalogueCore[];
  publication?: OwnerVaultCataloguePublication | null;
  coverage?: OwnerVaultCatalogueCoverage;
  apiSnapshot?: OwnerVaultApiSnapshot | null;
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
    (value.meEligible !== null && typeof value.meEligible !== "boolean") ||
    (value.version !== null &&
      (!Number.isSafeInteger(value.version) || value.version < 0)) ||
    (!value.inMyVault && value.meEligible === true)
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
  const source = value.source ?? "owner_registry";
  if (
    (source !== "owner_registry" && source !== "accepted_owner_api_snapshot") ||
    (source === "owner_registry" &&
      (value.meEligible === null || value.version === null)) ||
    (source === "accepted_owner_api_snapshot" &&
      (!value.inMyVault || value.meEligible !== null || value.version !== null))
  ) {
    throw new Error("Vault catalogue source state is invalid.");
  }
  if (value.version === 0 && value.updatedAt !== null) {
    throw new Error(
      "Unedited Vault catalogue core cannot have an update timestamp.",
    );
  }
  return value;
}

function validateApiSnapshot(
  value: OwnerVaultApiSnapshot,
  coreCount: number,
): OwnerVaultApiSnapshot {
  const oldest = new Date(value.oldestObservedAt);
  const newest = new Date(value.newestObservedAt);
  if (
    !UUID_PATTERN.test(value.generationId) ||
    !Number.isSafeInteger(value.coreCount) ||
    value.coreCount < coreCount ||
    Number.isNaN(oldest.getTime()) ||
    oldest.toISOString() !== value.oldestObservedAt ||
    Number.isNaN(newest.getTime()) ||
    newest.toISOString() !== value.newestObservedAt ||
    oldest.getTime() > newest.getTime()
  ) {
    throw new Error("Owner API snapshot is invalid.");
  }
  return value;
}

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function validatePublication(
  value: OwnerVaultCataloguePublication,
  coreCount: number,
): OwnerVaultCataloguePublication {
  const timestamps = [
    value.activatedAt,
    value.aggregateRefreshedAt,
    value.evidenceSealedAt,
    ...(value.dataCurrentThrough === null ? [] : [value.dataCurrentThrough]),
  ];
  if (
    !UUID_PATTERN.test(value.coreDatasetVersionId) ||
    !UUID_PATTERN.test(value.importBatchId) ||
    !SHA_256_PATTERN.test(value.sourceSha256) ||
    !Number.isSafeInteger(value.sourceRowCount) ||
    value.sourceRowCount < 1 ||
    !Number.isSafeInteger(value.acceptedRowCount) ||
    value.acceptedRowCount < 0 ||
    value.acceptedRowCount > value.sourceRowCount ||
    !Number.isSafeInteger(value.coreCount) ||
    value.coreCount < 0 ||
    value.coreCount !== value.acceptedRowCount ||
    value.coreCount < coreCount ||
    !Number.isSafeInteger(value.evidenceRowCount) ||
    value.evidenceRowCount !== value.sourceRowCount ||
    timestamps.some((timestamp) => {
      const parsed = new Date(timestamp);
      return (
        Number.isNaN(parsed.getTime()) || parsed.toISOString() !== timestamp
      );
    })
  ) {
    throw new Error("Vault catalogue publication is invalid.");
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
  let persistedCores: readonly OwnerVaultCatalogueCore[];
  let persistedPublication: OwnerVaultCataloguePublication | null = null;
  let persistedCoverage: OwnerVaultCatalogueCoverage =
    "accepted_core_details_catalogue";
  let persistedApiSnapshot: OwnerVaultApiSnapshot | null = null;
  try {
    if (input.repository.readCataloguePageByOwner) {
      const read = await input.repository.readCataloguePageByOwner(
        authenticatedOwnerId,
        filters,
      );
      persistedCores = read.cores;
      persistedPublication = read.publication;
      persistedCoverage = read.coverage ?? "accepted_core_details_catalogue";
      persistedApiSnapshot = read.apiSnapshot ?? null;
    } else {
      persistedCores = await input.repository.listCoresByOwner(
        authenticatedOwnerId,
        filters,
      );
    }
  } catch {
    return { connectionStatus: "read_failed", filters, cores: [] };
  }
  try {
    const cores = persistedCores.map(validateCore);
    const seen = new Set<string>();
    for (const core of cores) {
      if (seen.has(core.sourceCoreId)) {
        throw new Error("Vault catalogue contains a duplicate core.");
      }
      seen.add(core.sourceCoreId);
      if (filters.scope === "vault" && !core.inMyVault) {
        throw new Error(
          "Vault catalogue returned an inactive core for My Vault.",
        );
      }
    }
    const publication =
      persistedPublication === null
        ? null
        : validatePublication(persistedPublication, cores.length);
    const apiSnapshot =
      persistedApiSnapshot === null
        ? null
        : validateApiSnapshot(persistedApiSnapshot, cores.length);
    if (
      (persistedCoverage === "accepted_core_details_catalogue" &&
        apiSnapshot !== null) ||
      (persistedCoverage === "accepted_owner_api_snapshot" &&
        (publication !== null || apiSnapshot === null))
    ) {
      throw new Error("Vault catalogue coverage authority is invalid.");
    }
    return {
      connectionStatus: "connected",
      filters,
      cores,
      publication,
      coverage: persistedCoverage,
      apiSnapshot,
    };
  } catch {
    return { connectionStatus: "integrity_failed", filters, cores: [] };
  }
}
