import type { ImportCapacityGate } from "./import-activation-service";
import {
  importUploadSourceFamilies,
  maxImportUploadFilesPerBatch,
  type ImportUploadCapacityGate,
  type ImportUploadSourceFamily,
} from "./import-upload-intake-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_MEASUREMENT_AGE_MILLISECONDS = 15 * 60 * 1000;

export const importCapacityResources = [
  "r2_storage_bytes",
  "r2_class_a_operations",
  "r2_class_b_operations",
  "neon_storage_bytes",
  "queue_backlog_messages",
] as const;

export type ImportCapacityResource = (typeof importCapacityResources)[number];

export type ImportCapacityResourceProjection = Readonly<{
  resource: ImportCapacityResource;
  currentUsage: number;
  projectedIncrement: number;
}>;

export type ImportCapacityProjection = Readonly<{
  evidenceSource: "provider_api";
  measuredAt: string;
  resources: readonly ImportCapacityResourceProjection[];
}>;

export type ImportProviderCapacityPort = Readonly<{
  measureUploadProjection: (input: {
    ownerId: string;
    fileCount: number;
    totalByteLength: number;
    sourceFamilies: readonly ImportUploadSourceFamily[];
  }) => Promise<ImportCapacityProjection>;
  measureActivationProjection: (input: {
    ownerId: string;
    previewId: string;
  }) => Promise<ImportCapacityProjection>;
}>;

export type ImportCapacityApprovedLimits = Readonly<
  Record<ImportCapacityResource, number>
>;

export type ImportProviderCapacityConfiguration = Readonly<{
  approvedLimits: ImportCapacityApprovedLimits;
  minimumHeadroomBasisPoints: number;
  maximumMeasurementAgeMilliseconds: number;
  now: () => Date;
  createPort: () =>
    ImportProviderCapacityPort | Promise<ImportProviderCapacityPort>;
}>;

export type OwnerImportProviderCapacityGate = ImportUploadCapacityGate &
  ImportCapacityGate;

type CapacityRequest =
  | Parameters<ImportUploadCapacityGate["assertWithinApprovedCapacity"]>[0]
  | Parameters<ImportCapacityGate["assertWithinApprovedCapacity"]>[0];

function requireOwner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requireNonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} is invalid`);
  }
  return value;
}

function validateApprovedLimits(
  value: ImportCapacityApprovedLimits,
): ImportCapacityApprovedLimits {
  const result = {} as Record<ImportCapacityResource, number>;
  for (const resource of importCapacityResources) {
    result[resource] = requirePositiveSafeInteger(
      value[resource],
      `approvedLimits.${resource}`,
    );
  }
  return Object.freeze(result);
}

function usableLimit(
  approvedLimit: number,
  minimumHeadroomBasisPoints: number,
): number {
  return Number(
    (BigInt(approvedLimit) * BigInt(10_000 - minimumHeadroomBasisPoints)) /
      10_000n,
  );
}

function validateProjection(
  projection: ImportCapacityProjection,
  configuration: ImportProviderCapacityConfiguration,
): void {
  if (
    projection === null ||
    typeof projection !== "object" ||
    projection.evidenceSource !== "provider_api" ||
    !Array.isArray(projection.resources)
  ) {
    throw new Error("Provider capacity evidence source is invalid.");
  }
  const measuredAt = new Date(projection.measuredAt);
  const now = configuration.now();
  if (Number.isNaN(now.getTime())) throw new Error("now must be valid");
  if (
    Number.isNaN(measuredAt.getTime()) ||
    measuredAt.toISOString() !== projection.measuredAt ||
    measuredAt.getTime() > now.getTime() ||
    now.getTime() - measuredAt.getTime() >
      configuration.maximumMeasurementAgeMilliseconds
  ) {
    throw new Error("Provider capacity evidence is stale or invalid.");
  }

  const expected = new Set<ImportCapacityResource>(importCapacityResources);
  const observed = new Set<ImportCapacityResource>();
  for (const item of projection.resources) {
    if (
      item === null ||
      typeof item !== "object" ||
      !expected.has(item.resource) ||
      observed.has(item.resource)
    ) {
      throw new Error("Provider capacity resource set is invalid.");
    }
    const resource = item.resource as ImportCapacityResource;
    observed.add(resource);
    const currentUsage = requireNonNegativeSafeInteger(
      item.currentUsage,
      `${resource}.currentUsage`,
    );
    const projectedIncrement = requireNonNegativeSafeInteger(
      item.projectedIncrement,
      `${resource}.projectedIncrement`,
    );
    const configuredLimit = usableLimit(
      configuration.approvedLimits[resource],
      configuration.minimumHeadroomBasisPoints,
    );
    if (
      configuredLimit <= 0 ||
      currentUsage > configuredLimit ||
      projectedIncrement > configuredLimit - currentUsage
    ) {
      throw new Error(`Provider capacity unavailable for ${resource}.`);
    }
  }
  if (observed.size !== importCapacityResources.length) {
    throw new Error("Provider capacity evidence is incomplete.");
  }
}

export function createImportProviderCapacityGateForOwner(input: {
  ownerId: string;
  configuration: ImportProviderCapacityConfiguration;
}): OwnerImportProviderCapacityGate {
  const ownerId = requireOwner(input.ownerId);
  const approvedLimits = validateApprovedLimits(
    input.configuration.approvedLimits,
  );
  const configuration = Object.freeze({
    ...input.configuration,
    approvedLimits,
  });
  if (
    !Number.isSafeInteger(configuration.minimumHeadroomBasisPoints) ||
    configuration.minimumHeadroomBasisPoints < 0 ||
    configuration.minimumHeadroomBasisPoints >= 10_000
  ) {
    throw new Error("minimumHeadroomBasisPoints is invalid");
  }
  const maximumAge = requirePositiveSafeInteger(
    configuration.maximumMeasurementAgeMilliseconds,
    "maximumMeasurementAgeMilliseconds",
  );
  if (maximumAge > MAX_MEASUREMENT_AGE_MILLISECONDS) {
    throw new Error("maximumMeasurementAgeMilliseconds is too large");
  }
  let portPromise: Promise<ImportProviderCapacityPort> | null = null;

  function assertOwner(candidate: string): void {
    if (requireOwner(candidate) !== ownerId) {
      throw new Error("Import provider capacity access denied.");
    }
  }

  async function port(): Promise<ImportProviderCapacityPort> {
    if (portPromise === null) {
      portPromise = Promise.resolve(configuration.createPort()).then(
        (created) => {
          if (created === null || typeof created !== "object") {
            throw new Error("Import provider capacity initialization failed.");
          }
          return created;
        },
      );
    }
    return portPromise;
  }

  return Object.freeze({
    async assertWithinApprovedCapacity(
      request: CapacityRequest,
    ): Promise<void> {
      assertOwner(request.ownerId);
      const created = await port();
      const projection =
        "previewId" in request
          ? await created.measureActivationProjection({
              ownerId,
              previewId: requireSafeIdentifier(request.previewId, "previewId"),
            })
          : await created.measureUploadProjection(
              validateUploadCapacityRequest(request, ownerId),
            );
      validateProjection(projection, configuration);
    },
  });
}

function validateUploadCapacityRequest(
  request: Extract<CapacityRequest, { fileCount: number }>,
  ownerId: string,
): Readonly<{
  ownerId: string;
  fileCount: number;
  totalByteLength: number;
  sourceFamilies: readonly ImportUploadSourceFamily[];
}> {
  if (
    !Number.isSafeInteger(request.fileCount) ||
    request.fileCount <= 0 ||
    request.fileCount > maxImportUploadFilesPerBatch
  ) {
    throw new Error("fileCount is invalid");
  }
  if (
    !Number.isSafeInteger(request.totalByteLength) ||
    request.totalByteLength <= 0 ||
    request.totalByteLength > maxImportUploadFilesPerBatch * MAX_FILE_BYTES
  ) {
    throw new Error("totalByteLength is invalid");
  }
  const sourceFamilySet = new Set<ImportUploadSourceFamily>();
  for (const family of request.sourceFamilies) {
    if (!importUploadSourceFamilies.includes(family)) {
      throw new Error("sourceFamilies is invalid");
    }
    sourceFamilySet.add(family);
  }
  if (sourceFamilySet.size === 0) {
    throw new Error("sourceFamilies is invalid");
  }
  return {
    ownerId,
    fileCount: request.fileCount,
    totalByteLength: request.totalByteLength,
    sourceFamilies: [...sourceFamilySet],
  };
}

function parsePositiveSafeInteger(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function importProviderCapacityConfigurationFromEnvironment(
  input: Readonly<{
    approvedLimits: Readonly<
      Partial<Record<ImportCapacityResource, string | undefined>>
    >;
    minimumHeadroomBasisPoints: string | undefined;
    maximumMeasurementAgeMilliseconds: string | undefined;
    now: () => Date;
    createPort: ImportProviderCapacityConfiguration["createPort"];
  }>,
): ImportProviderCapacityConfiguration | null {
  const headroomText = input.minimumHeadroomBasisPoints?.trim() ?? "";
  const maximumAge = parsePositiveSafeInteger(
    input.maximumMeasurementAgeMilliseconds,
  );
  if (!/^[0-9]+$/.test(headroomText) || maximumAge === null) return null;
  const headroom = Number(headroomText);
  if (!Number.isSafeInteger(headroom)) return null;

  const approvedLimits = {} as Record<ImportCapacityResource, number>;
  for (const resource of importCapacityResources) {
    const limit = parsePositiveSafeInteger(input.approvedLimits[resource]);
    if (limit === null) return null;
    approvedLimits[resource] = limit;
  }
  return Object.freeze({
    approvedLimits: Object.freeze(approvedLimits),
    minimumHeadroomBasisPoints: headroom,
    maximumMeasurementAgeMilliseconds: maximumAge,
    now: input.now,
    createPort: input.createPort,
  });
}
