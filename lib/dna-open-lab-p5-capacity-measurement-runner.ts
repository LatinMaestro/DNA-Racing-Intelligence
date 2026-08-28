import {
  buildDnaOpenLabP5CapacityMeasurementReport,
  DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
  type DnaOpenLabP5CapacityMeasurementReport,
  type DnaOpenLabP5CapacityProviderScope,
} from "./dna-open-lab-p5-capacity-measurement";

const SHA_256_PATTERN = /^[0-9a-f]{64}$/u;
const DEFAULT_PAGE_LIMIT = 1_000;
const DEFAULT_MAXIMUM_PAGES = 1_000;
const DEFAULT_MAXIMUM_OBJECTS = 100_000;
const MAXIMUM_TRANSIENT_SAMPLES = 128;

export type DnaOpenLabP5PostgresCapacityPort = Readonly<{
  readMajorVersion: () => Promise<number>;
  readDatabaseBytes: () => Promise<number>;
  readOwnerRelationBytes: () => Promise<
    Readonly<{
      heapBytes: number;
      indexBytes: number;
      toastBytes: number;
    }>
  >;
}>;

export type DnaOpenLabP5R2FootprintObject = Readonly<{
  objectIdentitySha256: string;
  payloadBytes: number;
  metadataBytes: number;
}>;

export type DnaOpenLabP5R2FootprintPort = Readonly<{
  readBucketPrivacy: () => Promise<
    Readonly<{
      publicAccessDisabled: boolean;
      r2DevDisabled: boolean;
      customDomainCount: number;
    }>
  >;
  listRetainedObjects: (input: {
    cursor: string | null;
    limit: number;
  }) => Promise<
    Readonly<{
      objects: readonly DnaOpenLabP5R2FootprintObject[];
      nextCursor: string | null;
    }>
  >;
}>;

export type DnaOpenLabP5R2Footprint = Readonly<{
  retainedObjectCount: number;
  retainedPayloadBytes: number;
  retainedMetadataBytes: number;
  pageCount: number;
}>;

export type DnaOpenLabP5SyntheticCleanupResult = Readonly<{
  persistentOwnerDataWriteCount: number;
  residueObjectCount: number;
  rawPayloadIncluded: boolean;
  secretMaterialIncluded: boolean;
}>;

function runnerError(message: string): never {
  throw new Error(`DNA Open Lab P5 capacity runner: ${message}`);
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    runnerError(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function positiveCount(value: number, field: string): number {
  const normalized = count(value, field);
  if (normalized < 1) runnerError(`${field} must be positive`);
  return normalized;
}

function add(left: number, right: number, field: string): number {
  const result = left + right;
  if (!Number.isSafeInteger(result)) {
    runnerError(`${field} exceeds safe integer range`);
  }
  return result;
}

function cursor(value: string, field: string): string {
  const normalized = value.trim();
  if (normalized.length < 1 || normalized.length > 4_096) {
    runnerError(`${field} is invalid`);
  }
  return normalized;
}

function verifyPrivateBucket(input: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    !input.publicAccessDisabled ||
    !input.r2DevDisabled ||
    count(input.customDomainCount, "customDomainCount") !== 0
  ) {
    runnerError("R2 measurement bucket is not private");
  }
}

/** Collects a bounded, identity-deduplicated private R2 footprint. */
export async function collectDnaOpenLabP5R2Footprint(input: {
  port: DnaOpenLabP5R2FootprintPort;
  pageLimit?: number;
  maximumPages?: number;
  maximumObjects?: number;
}): Promise<DnaOpenLabP5R2Footprint> {
  const pageLimit = positiveCount(
    input.pageLimit ?? DEFAULT_PAGE_LIMIT,
    "pageLimit",
  );
  const maximumPages = positiveCount(
    input.maximumPages ?? DEFAULT_MAXIMUM_PAGES,
    "maximumPages",
  );
  const maximumObjects = positiveCount(
    input.maximumObjects ?? DEFAULT_MAXIMUM_OBJECTS,
    "maximumObjects",
  );
  verifyPrivateBucket(await input.port.readBucketPrivacy());

  const seenObjects = new Set<string>();
  const seenCursors = new Set<string>();
  let retainedPayloadBytes = 0;
  let retainedMetadataBytes = 0;
  let nextCursor: string | null = null;
  let pageCount = 0;

  do {
    if (pageCount >= maximumPages) {
      runnerError("R2 footprint pagination exceeds maximumPages");
    }
    const page = await input.port.listRetainedObjects({
      cursor: nextCursor,
      limit: pageLimit,
    });
    pageCount += 1;
    if (!Array.isArray(page.objects) || page.objects.length > pageLimit) {
      runnerError("R2 footprint page exceeds pageLimit");
    }
    for (const [index, object] of page.objects.entries()) {
      const identity = object.objectIdentitySha256.trim();
      if (!SHA_256_PATTERN.test(identity)) {
        runnerError(
          `R2 object identity at page ${pageCount} index ${index} is invalid`,
        );
      }
      if (seenObjects.has(identity)) {
        runnerError("R2 footprint repeats an object identity");
      }
      seenObjects.add(identity);
      if (seenObjects.size > maximumObjects) {
        runnerError("R2 footprint exceeds maximumObjects");
      }
      retainedPayloadBytes = add(
        retainedPayloadBytes,
        count(object.payloadBytes, "payloadBytes"),
        "retainedPayloadBytes",
      );
      retainedMetadataBytes = add(
        retainedMetadataBytes,
        count(object.metadataBytes, "metadataBytes"),
        "retainedMetadataBytes",
      );
    }
    if (page.nextCursor === null) {
      nextCursor = null;
    } else {
      nextCursor = cursor(page.nextCursor, "nextCursor");
      if (seenCursors.has(nextCursor)) {
        runnerError("R2 footprint pagination repeats a cursor");
      }
      seenCursors.add(nextCursor);
    }
  } while (nextCursor !== null);

  return Object.freeze({
    retainedObjectCount: seenObjects.size,
    retainedPayloadBytes,
    retainedMetadataBytes,
    pageCount,
  });
}

function validateCleanup(
  cleanup: DnaOpenLabP5SyntheticCleanupResult,
): DnaOpenLabP5SyntheticCleanupResult {
  if (
    count(
      cleanup.persistentOwnerDataWriteCount,
      "persistentOwnerDataWriteCount",
    ) !== 0 ||
    count(cleanup.residueObjectCount, "residueObjectCount") !== 0 ||
    cleanup.rawPayloadIncluded ||
    cleanup.secretMaterialIncluded
  ) {
    runnerError("synthetic cleanup or evidence safety failed");
  }
  return cleanup;
}

/**
 * Measures one complete synthetic API-only cycle. The cycle controls when a
 * transient sample is meaningful but the runner reads the database itself,
 * bounds sample count, enumerates R2 itself and always executes cleanup.
 */
export async function runDnaOpenLabP5CapacityMeasurement(input: {
  codeHeadSha: string;
  planChecksum: string;
  providerScope: DnaOpenLabP5CapacityProviderScope;
  measurementAuthorityRef: string;
  measuredAt: string;
  postgres: DnaOpenLabP5PostgresCapacityPort;
  r2: DnaOpenLabP5R2FootprintPort;
  runSyntheticCycle: (input: {
    captureTransientSample: () => Promise<number>;
  }) => Promise<void>;
  cleanupSyntheticEvidence: () => Promise<DnaOpenLabP5SyntheticCleanupResult>;
  projectedMonthlyClassAOperations: number;
  projectedMonthlyClassBOperations: number;
  priceAuthorityRef: string;
  priceEffectiveAt: string;
  bytesPerBillableGb: number;
  storageMicroUsdPerGbMonth: number;
  classAMicroUsdPerMillion: number;
  classBMicroUsdPerMillion: number;
  r2PageLimit?: number;
  r2MaximumPages?: number;
  r2MaximumObjects?: number;
}): Promise<DnaOpenLabP5CapacityMeasurementReport> {
  const samples: number[] = [];
  let transientSampleCount = 0;
  let measured:
    | Readonly<{
        postgresMajorVersion: number;
        baselineDatabaseBytes: number;
        settledDatabaseBytes: number;
        ownerHeapBytes: number;
        ownerIndexBytes: number;
        ownerToastBytes: number;
        footprint: DnaOpenLabP5R2Footprint;
      }>
    | undefined;
  let cycleFailure: unknown;

  try {
    const postgresMajorVersion = await input.postgres.readMajorVersion();
    const baselineDatabaseBytes = count(
      await input.postgres.readDatabaseBytes(),
      "baselineDatabaseBytes",
    );
    samples.push(baselineDatabaseBytes);
    await input.runSyntheticCycle({
      captureTransientSample: async () => {
        transientSampleCount += 1;
        if (transientSampleCount > MAXIMUM_TRANSIENT_SAMPLES) {
          runnerError("transient sample count exceeds the bounded maximum");
        }
        const observed = count(
          await input.postgres.readDatabaseBytes(),
          `transientDatabaseBytes[${transientSampleCount - 1}]`,
        );
        samples.push(observed);
        return observed;
      },
    });
    if (transientSampleCount < 1) {
      runnerError("synthetic cycle did not capture a transient sample");
    }
    const settledDatabaseBytes = count(
      await input.postgres.readDatabaseBytes(),
      "settledDatabaseBytes",
    );
    samples.push(settledDatabaseBytes);
    const owner = await input.postgres.readOwnerRelationBytes();
    const footprint = await collectDnaOpenLabP5R2Footprint({
      port: input.r2,
      ...(input.r2PageLimit === undefined
        ? {}
        : { pageLimit: input.r2PageLimit }),
      ...(input.r2MaximumPages === undefined
        ? {}
        : { maximumPages: input.r2MaximumPages }),
      ...(input.r2MaximumObjects === undefined
        ? {}
        : { maximumObjects: input.r2MaximumObjects }),
    });
    measured = Object.freeze({
      postgresMajorVersion,
      baselineDatabaseBytes,
      settledDatabaseBytes,
      ownerHeapBytes: count(owner.heapBytes, "ownerHeapBytes"),
      ownerIndexBytes: count(owner.indexBytes, "ownerIndexBytes"),
      ownerToastBytes: count(owner.toastBytes, "ownerToastBytes"),
      footprint,
    });
  } catch (error) {
    cycleFailure = error;
  }

  let cleanup: DnaOpenLabP5SyntheticCleanupResult | undefined;
  let cleanupFailure: unknown;
  try {
    cleanup = validateCleanup(await input.cleanupSyntheticEvidence());
  } catch (error) {
    cleanupFailure = error;
  }
  if (cycleFailure !== undefined && cleanupFailure !== undefined) {
    throw new AggregateError(
      [cycleFailure, cleanupFailure],
      "DNA Open Lab P5 capacity runner failed and cleanup was unsafe",
    );
  }
  if (cycleFailure !== undefined) throw cycleFailure;
  if (cleanupFailure !== undefined) throw cleanupFailure;
  if (measured === undefined || cleanup === undefined) {
    return runnerError("measurement did not produce complete evidence");
  }

  return buildDnaOpenLabP5CapacityMeasurementReport({
    codeHeadSha: input.codeHeadSha,
    planChecksum: input.planChecksum,
    providerScope: input.providerScope,
    measurementAuthorityRef: input.measurementAuthorityRef,
    measuredAt: input.measuredAt,
    postgresMajorVersion: measured.postgresMajorVersion,
    persistentOwnerDataWriteCount: cleanup.persistentOwnerDataWriteCount,
    residueObjectCount: cleanup.residueObjectCount,
    rawPayloadIncluded: cleanup.rawPayloadIncluded,
    secretMaterialIncluded: cleanup.secretMaterialIncluded,
    postgres: {
      limitBytes: DNA_OPEN_LAB_P5_NEON_LIMIT_BYTES,
      baselineDatabaseBytes: measured.baselineDatabaseBytes,
      settledDatabaseBytes: measured.settledDatabaseBytes,
      peakDatabaseBytes: Math.max(...samples),
      ownerHeapBytes: measured.ownerHeapBytes,
      ownerIndexBytes: measured.ownerIndexBytes,
      ownerToastBytes: measured.ownerToastBytes,
      measurementSamples: samples.length,
    },
    r2: {
      retainedObjectCount: measured.footprint.retainedObjectCount,
      retainedPayloadBytes: measured.footprint.retainedPayloadBytes,
      retainedMetadataBytes: measured.footprint.retainedMetadataBytes,
      projectedMonthlyClassAOperations: input.projectedMonthlyClassAOperations,
      projectedMonthlyClassBOperations: input.projectedMonthlyClassBOperations,
      priceAuthorityRef: input.priceAuthorityRef,
      priceEffectiveAt: input.priceEffectiveAt,
      bytesPerBillableGb: input.bytesPerBillableGb,
      storageMicroUsdPerGbMonth: input.storageMicroUsdPerGbMonth,
      classAMicroUsdPerMillion: input.classAMicroUsdPerMillion,
      classBMicroUsdPerMillion: input.classBMicroUsdPerMillion,
    },
  });
}
