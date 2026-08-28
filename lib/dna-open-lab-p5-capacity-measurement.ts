export const DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES = 536_870_912;

export type DnaOpenLabP5CapacityProviderScope =
  "synthetic_local" | "private_preview";

export type DnaOpenLabP5CapacityMeasurementInput = Readonly<{
  codeHeadSha: string;
  planChecksum: string;
  providerScope: DnaOpenLabP5CapacityProviderScope;
  measurementAuthorityRef: string;
  measuredAt: string;
  postgresMajorVersion: number;
  persistentOwnerDataWriteCount: number;
  residueObjectCount: number;
  rawPayloadIncluded: boolean;
  secretMaterialIncluded: boolean;
  postgres: Readonly<{
    limitBytes: number;
    baselineDatabaseBytes: number;
    settledDatabaseBytes: number;
    peakDatabaseBytes: number;
    ownerHeapBytes: number;
    ownerIndexBytes: number;
    ownerToastBytes: number;
    measurementSamples: number;
  }>;
  r2: Readonly<{
    retainedObjectCount: number;
    retainedPayloadBytes: number;
    retainedMetadataBytes: number;
    projectedMonthlyClassAOperations: number;
    projectedMonthlyClassBOperations: number;
    priceAuthorityRef: string;
    priceEffectiveAt: string;
    bytesPerBillableGb: number;
    storageMicroUsdPerGbMonth: number;
    classAMicroUsdPerMillion: number;
    classBMicroUsdPerMillion: number;
  }>;
}>;

export type DnaOpenLabP5CapacityMeasurementReport = Readonly<{
  version: 1;
  codeHeadSha: string;
  planChecksum: string;
  providerScope: DnaOpenLabP5CapacityProviderScope;
  measurementAuthorityRef: string;
  measuredAt: string;
  postgresMajorVersion: 18;
  persistentOwnerDataWriteCount: 0;
  residueObjectCount: 0;
  rawPayloadIncluded: false;
  secretMaterialIncluded: false;
  postgres: Readonly<{
    limitBytes: number;
    baselineDatabaseBytes: number;
    settledDatabaseBytes: number;
    peakDatabaseBytes: number;
    ownerHeapBytes: number;
    ownerIndexBytes: number;
    ownerToastBytes: number;
    ownerPhysicalBytes: number;
    measurementSamples: number;
    peakHeadroomBytes: number;
    positivePeakHeadroom: boolean;
  }>;
  r2: Readonly<{
    retainedObjectCount: number;
    retainedPayloadBytes: number;
    retainedMetadataBytes: number;
    retainedTotalBytes: number;
    projectedMonthlyClassAOperations: number;
    projectedMonthlyClassBOperations: number;
    priceAuthorityRef: string;
    priceEffectiveAt: string;
    bytesPerBillableGb: number;
    storageMicroUsdPerGbMonth: number;
    classAMicroUsdPerMillion: number;
    classBMicroUsdPerMillion: number;
    projectedMonthlyCostMicroUsd: number;
  }>;
  connectedCapacityEvidenceComplete: boolean;
  readyToUpdateP5CapacityRows: boolean;
  firstPersistentPrivatePreviewSyncAllowed: false;
  productionChangesAllowed: false;
}>;

function measurementError(message: string): never {
  throw new Error(`DNA Open Lab P5 capacity measurement: ${message}`);
}

function exactSha(value: string, field: string, length: number): string {
  const normalized = value.trim();
  if (!new RegExp(`^[0-9a-f]{${length}}$`, "u").test(normalized)) {
    measurementError(`${field} must be an exact lowercase hexadecimal value`);
  }
  return normalized;
}

function timestamp(value: string, field: string): string {
  const normalized = value.trim();
  const parsed = new Date(normalized);
  if (
    Number.isNaN(parsed.getTime()) ||
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    )
  ) {
    measurementError(`${field} must be a timezone-qualified ISO timestamp`);
  }
  return parsed.toISOString();
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    measurementError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveCount(value: number, field: string): number {
  const normalized = count(value, field);
  if (normalized < 1) measurementError(`${field} must be positive`);
  return normalized;
}

function add(values: readonly number[], field: string): number {
  const result = values.reduce((total, value) => total + value, 0);
  if (!Number.isSafeInteger(result)) {
    measurementError(`${field} exceeds safe integer range`);
  }
  return result;
}

function monthlyCost(input: {
  retainedTotalBytes: number;
  bytesPerBillableGb: number;
  storageMicroUsdPerGbMonth: number;
  classAOperations: number;
  classAMicroUsdPerMillion: number;
  classBOperations: number;
  classBMicroUsdPerMillion: number;
}): number {
  const divisor = BigInt(input.bytesPerBillableGb);
  const million = 1_000_000n;
  const ceil = (numerator: bigint, denominator: bigint): bigint =>
    (numerator + denominator - 1n) / denominator;
  const storage = ceil(
    BigInt(input.retainedTotalBytes) * BigInt(input.storageMicroUsdPerGbMonth),
    divisor,
  );
  const classA = ceil(
    BigInt(input.classAOperations) * BigInt(input.classAMicroUsdPerMillion),
    million,
  );
  const classB = ceil(
    BigInt(input.classBOperations) * BigInt(input.classBMicroUsdPerMillion),
    million,
  );
  const total = storage + classA + classB;
  if (total > BigInt(Number.MAX_SAFE_INTEGER)) {
    measurementError("projected monthly R2 cost exceeds safe integer range");
  }
  return Number(total);
}

/**
 * Canonicalizes a capacity observation only. A passing report may update the
 * three capacity rows in the P5 readiness matrix after review, but can never
 * authorize persistence or Production.
 */
export function buildDnaOpenLabP5CapacityMeasurementReport(
  input: DnaOpenLabP5CapacityMeasurementInput,
): DnaOpenLabP5CapacityMeasurementReport {
  const codeHeadSha = exactSha(input.codeHeadSha, "codeHeadSha", 40);
  const planChecksum = exactSha(input.planChecksum, "planChecksum", 64);
  if (
    input.providerScope !== "synthetic_local" &&
    input.providerScope !== "private_preview"
  ) {
    measurementError("providerScope is unsupported");
  }
  const measuredAt = timestamp(input.measuredAt, "measuredAt");
  const measurementAuthorityRef = input.measurementAuthorityRef.trim();
  if (
    measurementAuthorityRef.length < 1 ||
    measurementAuthorityRef.length > 2_048
  ) {
    measurementError("measurementAuthorityRef is invalid");
  }
  if (input.postgresMajorVersion !== 18) {
    measurementError("PostgreSQL 18 evidence is required");
  }
  if (input.persistentOwnerDataWriteCount !== 0) {
    measurementError("persistent owner-data writes are prohibited");
  }
  if (input.residueObjectCount !== 0) {
    measurementError("synthetic provider residue must be zero");
  }
  if (input.rawPayloadIncluded !== false) {
    measurementError("raw payloads are prohibited in capacity evidence");
  }
  if (input.secretMaterialIncluded !== false) {
    measurementError("secret material is prohibited in capacity evidence");
  }

  const limitBytes = positiveCount(input.postgres.limitBytes, "limitBytes");
  if (limitBytes !== DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES) {
    measurementError("limitBytes does not match the approved Neon boundary");
  }
  const baselineDatabaseBytes = count(
    input.postgres.baselineDatabaseBytes,
    "baselineDatabaseBytes",
  );
  const settledDatabaseBytes = count(
    input.postgres.settledDatabaseBytes,
    "settledDatabaseBytes",
  );
  const peakDatabaseBytes = count(
    input.postgres.peakDatabaseBytes,
    "peakDatabaseBytes",
  );
  if (
    peakDatabaseBytes < baselineDatabaseBytes ||
    peakDatabaseBytes < settledDatabaseBytes
  ) {
    measurementError("peakDatabaseBytes must cover baseline and settled size");
  }
  if (settledDatabaseBytes <= baselineDatabaseBytes) {
    measurementError("settledDatabaseBytes must prove a complete cycle");
  }
  const ownerHeapBytes = count(input.postgres.ownerHeapBytes, "ownerHeapBytes");
  const ownerIndexBytes = count(
    input.postgres.ownerIndexBytes,
    "ownerIndexBytes",
  );
  const ownerToastBytes = count(
    input.postgres.ownerToastBytes,
    "ownerToastBytes",
  );
  const ownerPhysicalBytes = add(
    [ownerHeapBytes, ownerIndexBytes, ownerToastBytes],
    "ownerPhysicalBytes",
  );
  if (ownerPhysicalBytes > settledDatabaseBytes) {
    measurementError("owner relation bytes exceed settled database size");
  }
  if (ownerPhysicalBytes === 0) {
    measurementError("owner relation measurement must be substantive");
  }
  const measurementSamples = positiveCount(
    input.postgres.measurementSamples,
    "measurementSamples",
  );
  if (measurementSamples < 2) {
    measurementError("measurementSamples must capture transient overlap");
  }
  const peakHeadroomBytes = limitBytes - peakDatabaseBytes;
  if (!Number.isSafeInteger(peakHeadroomBytes)) {
    measurementError("peakHeadroomBytes exceeds safe integer range");
  }

  const retainedPayloadBytes = count(
    input.r2.retainedPayloadBytes,
    "retainedPayloadBytes",
  );
  const retainedMetadataBytes = count(
    input.r2.retainedMetadataBytes,
    "retainedMetadataBytes",
  );
  const retainedTotalBytes = add(
    [retainedPayloadBytes, retainedMetadataBytes],
    "retainedTotalBytes",
  );
  const retainedObjectCount = count(
    input.r2.retainedObjectCount,
    "retainedObjectCount",
  );
  if (retainedObjectCount === 0 || retainedTotalBytes === 0) {
    measurementError("R2 footprint measurement must be substantive");
  }
  const projectedMonthlyClassAOperations = count(
    input.r2.projectedMonthlyClassAOperations,
    "projectedMonthlyClassAOperations",
  );
  const projectedMonthlyClassBOperations = count(
    input.r2.projectedMonthlyClassBOperations,
    "projectedMonthlyClassBOperations",
  );
  if (
    projectedMonthlyClassAOperations === 0 &&
    projectedMonthlyClassBOperations === 0
  ) {
    measurementError("R2 operation projection must be substantive");
  }
  const priceAuthorityRef = input.r2.priceAuthorityRef.trim();
  if (priceAuthorityRef.length < 1 || priceAuthorityRef.length > 2_048) {
    measurementError("priceAuthorityRef is invalid");
  }
  const priceEffectiveAt = timestamp(
    input.r2.priceEffectiveAt,
    "priceEffectiveAt",
  );
  if (Date.parse(priceEffectiveAt) > Date.parse(measuredAt)) {
    measurementError("R2 price authority cannot postdate the measurement");
  }
  if (Date.parse(measuredAt) - Date.parse(priceEffectiveAt) > 31 * 86_400_000) {
    measurementError("R2 price authority is stale");
  }
  const bytesPerBillableGb = positiveCount(
    input.r2.bytesPerBillableGb,
    "bytesPerBillableGb",
  );
  const storageMicroUsdPerGbMonth = count(
    input.r2.storageMicroUsdPerGbMonth,
    "storageMicroUsdPerGbMonth",
  );
  const classAMicroUsdPerMillion = count(
    input.r2.classAMicroUsdPerMillion,
    "classAMicroUsdPerMillion",
  );
  const classBMicroUsdPerMillion = count(
    input.r2.classBMicroUsdPerMillion,
    "classBMicroUsdPerMillion",
  );
  const projectedMonthlyCostMicroUsd = monthlyCost({
    retainedTotalBytes,
    bytesPerBillableGb,
    storageMicroUsdPerGbMonth,
    classAOperations: projectedMonthlyClassAOperations,
    classAMicroUsdPerMillion,
    classBOperations: projectedMonthlyClassBOperations,
    classBMicroUsdPerMillion,
  });
  const positivePeakHeadroom = peakHeadroomBytes > 0;
  const connectedCapacityEvidenceComplete =
    input.providerScope === "private_preview";

  return Object.freeze({
    version: 1 as const,
    codeHeadSha,
    planChecksum,
    providerScope: input.providerScope,
    measurementAuthorityRef,
    measuredAt,
    postgresMajorVersion: 18 as const,
    persistentOwnerDataWriteCount: 0 as const,
    residueObjectCount: 0 as const,
    rawPayloadIncluded: false as const,
    secretMaterialIncluded: false as const,
    postgres: Object.freeze({
      limitBytes,
      baselineDatabaseBytes,
      settledDatabaseBytes,
      peakDatabaseBytes,
      ownerHeapBytes,
      ownerIndexBytes,
      ownerToastBytes,
      ownerPhysicalBytes,
      measurementSamples,
      peakHeadroomBytes,
      positivePeakHeadroom,
    }),
    r2: Object.freeze({
      retainedObjectCount,
      retainedPayloadBytes,
      retainedMetadataBytes,
      retainedTotalBytes,
      projectedMonthlyClassAOperations,
      projectedMonthlyClassBOperations,
      priceAuthorityRef,
      priceEffectiveAt,
      bytesPerBillableGb,
      storageMicroUsdPerGbMonth,
      classAMicroUsdPerMillion,
      classBMicroUsdPerMillion,
      projectedMonthlyCostMicroUsd,
    }),
    connectedCapacityEvidenceComplete,
    readyToUpdateP5CapacityRows:
      connectedCapacityEvidenceComplete && positivePeakHeadroom,
    firstPersistentPrivatePreviewSyncAllowed: false as const,
    productionChangesAllowed: false as const,
  });
}
