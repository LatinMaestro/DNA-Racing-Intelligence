import { createHash } from "node:crypto";

import type {
  DatasetEvidenceObjectFormat,
  DatasetEvidenceObjectKind,
  DatasetEvidenceObjectRegistration,
  DatasetEvidenceObjectInspectionRepository,
  DatasetEvidenceObjectRepository,
  DatasetEvidenceSourceType,
} from "./neon-dataset-evidence-object-repository";

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const sourceTypes = new Set<DatasetEvidenceSourceType>([
  "race_merge",
  "core_details",
  "current_arena",
]);
const objectKinds = new Set<DatasetEvidenceObjectKind>([
  "staged_rows",
  "accepted_contributions",
  "normalized_partition",
]);
const objectFormats = new Set<DatasetEvidenceObjectFormat>([
  "ndjson_gzip",
  "parquet",
]);

const objectMediaTypes: Readonly<Record<DatasetEvidenceObjectFormat, string>> =
  {
    ndjson_gzip: "application/x-ndjson+gzip",
    parquet: "application/vnd.apache.parquet",
  };

const objectExtensions: Readonly<Record<DatasetEvidenceObjectFormat, string>> =
  {
    ndjson_gzip: "ndjson.gz",
    parquet: "parquet",
  };

export type PrivateDatasetEvidenceObjectStoragePort = Readonly<{
  readBucketPrivacy: (input: { bucketName: string }) => Promise<
    Readonly<{
      publicAccessDisabled: boolean;
      r2DevDisabled: boolean;
      customDomainCount: number;
    }>
  >;
  putObjectIfAbsent: (input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }) => Promise<Readonly<{ status: "created" | "existing" }>>;
  headObject: (input: { bucketName: string; key: string }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        contentType: string;
        byteLength: number;
        checksumSha256: string;
        metadata: Readonly<Record<string, string | undefined>>;
      }>
  >;
  deleteObject?: (input: {
    bucketName: string;
    key: string;
  }) => Promise<Readonly<{ status: "deleted" | "missing" }>>;
}>;

export type PrivateDatasetEvidenceObjectDeletionPort =
  PrivateDatasetEvidenceObjectStoragePort &
    Readonly<{
      deleteObject: NonNullable<
        PrivateDatasetEvidenceObjectStoragePort["deleteObject"]
      >;
    }>;

export type PrivateDatasetEvidenceObjectWrite = Readonly<{
  ownerId: string;
  importBatchId: string;
  sourceType: DatasetEvidenceSourceType;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
  body: AsyncIterable<Uint8Array>;
  byteSize: number;
  rowCount: number;
  checksumSha256: string;
  firstNaturalKey: string | null;
  lastNaturalKey: string | null;
  createdAt: string;
}>;

export type PrivateDatasetEvidenceObjectWriter = Readonly<{
  write: (input: PrivateDatasetEvidenceObjectWrite) => Promise<
    Readonly<{
      status: "created" | "existing";
      evidenceObjectId: string;
      objectKey: string;
      storageStatus: "created" | "existing";
    }>
  >;
}>;

function safeOwner(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error("ownerId is invalid");
  }
  return normalized;
}

function uuid(value: string, field: string): string {
  const normalized = value.trim().toLowerCase();
  if (!UUID_PATTERN.test(normalized))
    throw new Error(field + " must be a UUID");
  return normalized;
}

function positiveSafeInteger(
  value: number,
  field: string,
  maximum?: number,
): number {
  if (
    !Number.isSafeInteger(value) ||
    value <= 0 ||
    (maximum !== undefined && value > maximum)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function naturalKey(value: string | null, field: string): string | null {
  if (value === null) return null;
  if (
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function timestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("createdAt must be a canonical timestamp");
  }
  return value;
}

function body(value: AsyncIterable<Uint8Array>): AsyncIterable<Uint8Array> {
  if (
    typeof value !== "object" ||
    value === null ||
    typeof value[Symbol.asyncIterator] !== "function"
  ) {
    throw new Error("body must be an asynchronous byte stream");
  }
  return value;
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update("dna-evidence-owner\u0000" + ownerId)
    .digest("hex");
}

function objectKey(input: {
  ownerId: string;
  importBatchId: string;
  sourceType: DatasetEvidenceSourceType;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
}): string {
  const partition = String(input.partitionNumber).padStart(4, "0");
  return [
    "evidence",
    ownerPrefix(input.ownerId),
    input.importBatchId,
    input.sourceType,
    input.objectKind,
    "part-" + partition + "." + objectExtensions[input.objectFormat],
  ].join("/");
}

function assertPrivateBucket(evidence: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    evidence.publicAccessDisabled !== true ||
    evidence.r2DevDisabled !== true ||
    !Number.isSafeInteger(evidence.customDomainCount) ||
    evidence.customDomainCount !== 0
  ) {
    throw new Error("Evidence object bucket is not private.");
  }
}

function normalizeWrite(
  input: PrivateDatasetEvidenceObjectWrite,
  maximumObjectBytes: number,
): Omit<DatasetEvidenceObjectRegistration, "objectKey"> &
  Readonly<{ body: AsyncIterable<Uint8Array> }> {
  const ownerId = safeOwner(input.ownerId);
  const importBatchId = uuid(input.importBatchId, "importBatchId");
  if (!sourceTypes.has(input.sourceType)) {
    throw new Error("sourceType is unsupported");
  }
  if (!objectKinds.has(input.objectKind)) {
    throw new Error("objectKind is unsupported");
  }
  if (!objectFormats.has(input.objectFormat)) {
    throw new Error("objectFormat is unsupported");
  }
  const partitionNumber =
    positiveSafeInteger(input.partitionNumber + 1, "partitionNumber", 10_000) -
    1;
  const byteSize = positiveSafeInteger(
    input.byteSize,
    "byteSize",
    maximumObjectBytes,
  );
  const rowCount = positiveSafeInteger(input.rowCount, "rowCount");
  if (!SHA_256_PATTERN.test(input.checksumSha256)) {
    throw new Error("checksumSha256 is invalid");
  }
  const firstNaturalKey = naturalKey(input.firstNaturalKey, "firstNaturalKey");
  const lastNaturalKey = naturalKey(input.lastNaturalKey, "lastNaturalKey");
  if ((firstNaturalKey === null) !== (lastNaturalKey === null)) {
    throw new Error("natural key range must be complete");
  }
  return {
    ownerId,
    importBatchId,
    sourceType: input.sourceType,
    objectKind: input.objectKind,
    partitionNumber,
    objectFormat: input.objectFormat,
    body: body(input.body),
    byteSize,
    rowCount,
    checksumSha256: input.checksumSha256,
    firstNaturalKey,
    lastNaturalKey,
    createdAt: timestamp(input.createdAt),
  };
}

function exactObjectEvidence(
  value: Awaited<
    ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>
  >,
  expected: {
    contentType: string;
    byteSize: number;
    checksumSha256: string;
    rowCount: number;
    sourceType: DatasetEvidenceSourceType;
    objectKind: DatasetEvidenceObjectKind;
    partitionNumber: number;
  },
): void {
  if (
    value.status !== "ready" ||
    value.contentType.trim().toLowerCase() !== expected.contentType ||
    value.byteLength !== expected.byteSize ||
    value.checksumSha256 !== expected.checksumSha256 ||
    value.metadata.rows !== String(expected.rowCount) ||
    value.metadata.source !== expected.sourceType ||
    value.metadata.kind !== expected.objectKind ||
    value.metadata.partition !== String(expected.partitionNumber)
  ) {
    throw new Error("Stored evidence object failed exact verification.");
  }
}

export type StoredPrivateDatasetEvidenceObject = Readonly<{
  registration: DatasetEvidenceObjectRegistration;
  storageStatus: "created" | "existing";
}>;

export type PrivateDatasetEvidenceObjectStorageWriter = Readonly<{
  store: (
    input: PrivateDatasetEvidenceObjectWrite,
  ) => Promise<StoredPrivateDatasetEvidenceObject>;
}>;

export function createPrivateDatasetEvidenceObjectStorageWriter(input: {
  ownerId: string;
  bucketName: string;
  maximumObjectBytes: number;
  createPort: () =>
    | PrivateDatasetEvidenceObjectStoragePort
    | Promise<PrivateDatasetEvidenceObjectStoragePort>;
}): PrivateDatasetEvidenceObjectStorageWriter {
  const ownerId = safeOwner(input.ownerId);
  const bucketName = input.bucketName.trim();
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const maximumObjectBytes = positiveSafeInteger(
    input.maximumObjectBytes,
    "maximumObjectBytes",
  );
  let portPromise: Promise<PrivateDatasetEvidenceObjectStoragePort> | null =
    null;
  let privacyPromise: Promise<void> | null = null;

  async function privatePort(): Promise<PrivateDatasetEvidenceObjectStoragePort> {
    if (portPromise === null) {
      portPromise = Promise.resolve(input.createPort()).then((created) => {
        if (created === null || typeof created !== "object") {
          throw new Error("Evidence object storage initialization failed.");
        }
        return created;
      });
    }
    const created = await portPromise;
    if (privacyPromise === null) {
      privacyPromise = created
        .readBucketPrivacy({ bucketName })
        .then(assertPrivateBucket);
    }
    await privacyPromise;
    return created;
  }

  return Object.freeze({
    async store(writeInput) {
      const normalized = normalizeWrite(writeInput, maximumObjectBytes);
      if (normalized.ownerId !== ownerId) {
        throw new Error("Evidence object storage access denied.");
      }
      const key = objectKey(normalized);
      const contentType = objectMediaTypes[normalized.objectFormat];
      const port = await privatePort();
      const stored = await port.putObjectIfAbsent({
        bucketName,
        key,
        body: normalized.body,
        contentType,
        byteLength: normalized.byteSize,
        checksumSha256: normalized.checksumSha256,
        metadata: {
          rows: String(normalized.rowCount),
          source: normalized.sourceType,
          kind: normalized.objectKind,
          partition: String(normalized.partitionNumber),
        },
      });
      if (stored.status !== "created" && stored.status !== "existing") {
        throw new Error("Evidence object storage returned an invalid status.");
      }
      exactObjectEvidence(await port.headObject({ bucketName, key }), {
        contentType,
        byteSize: normalized.byteSize,
        checksumSha256: normalized.checksumSha256,
        rowCount: normalized.rowCount,
        sourceType: normalized.sourceType,
        objectKind: normalized.objectKind,
        partitionNumber: normalized.partitionNumber,
      });
      return {
        registration: {
          ownerId: normalized.ownerId,
          importBatchId: normalized.importBatchId,
          sourceType: normalized.sourceType,
          objectKind: normalized.objectKind,
          partitionNumber: normalized.partitionNumber,
          objectFormat: normalized.objectFormat,
          objectKey: key,
          checksumSha256: normalized.checksumSha256,
          byteSize: normalized.byteSize,
          rowCount: normalized.rowCount,
          firstNaturalKey: normalized.firstNaturalKey,
          lastNaturalKey: normalized.lastNaturalKey,
          createdAt: normalized.createdAt,
        },
        storageStatus: stored.status,
      };
    },
  });
}

export function createPrivateDatasetEvidenceObjectWriter(input: {
  ownerId: string;
  bucketName: string;
  maximumObjectBytes: number;
  createPort: () =>
    | PrivateDatasetEvidenceObjectStoragePort
    | Promise<PrivateDatasetEvidenceObjectStoragePort>;
  repository: Extract<
    DatasetEvidenceObjectRepository,
    Readonly<{ status: "ready" }>
  >;
}): PrivateDatasetEvidenceObjectWriter {
  const storageWriter = createPrivateDatasetEvidenceObjectStorageWriter(input);

  return Object.freeze({
    async write(writeInput) {
      const stored = await storageWriter.store(writeInput);
      const registered = await input.repository.register(stored.registration);
      return {
        ...registered,
        objectKey: stored.registration.objectKey,
        storageStatus: stored.storageStatus,
      };
    },
  });
}

export type PrivateDatasetEvidenceObjectRecoveryReceipt = Readonly<{
  objectKey: string;
  status: "deleted" | "missing" | "retained_registered";
}>;

function emptyBody(): AsyncIterable<Uint8Array> {
  return (async function* () {
    return;
  })();
}

function normalizeStoredEvidenceObject(
  stored: StoredPrivateDatasetEvidenceObject,
  maximumObjectBytes: number,
): StoredPrivateDatasetEvidenceObject {
  if (stored.storageStatus !== "created") {
    throw new Error("Only newly created evidence objects are recoverable.");
  }
  const normalized = normalizeWrite(
    {
      ...stored.registration,
      body: emptyBody(),
      byteSize: stored.registration.byteSize,
    },
    maximumObjectBytes,
  );
  const { body: _body, ...withoutBody } = normalized;
  const registration = {
    ...withoutBody,
    objectKey: objectKey(normalized),
  };
  if (registration.objectKey !== stored.registration.objectKey) {
    throw new Error("Evidence recovery object key is not owner-derived.");
  }
  return { registration, storageStatus: "created" };
}

export function createPrivateDatasetEvidenceObjectRecovery(input: {
  ownerId: string;
  bucketName: string;
  maximumObjectBytes: number;
  maximumObjects?: number;
  createPort: () =>
    | PrivateDatasetEvidenceObjectDeletionPort
    | Promise<PrivateDatasetEvidenceObjectDeletionPort>;
  inspectionRepository: DatasetEvidenceObjectInspectionRepository;
}): Readonly<{
  cleanup: (
    stored: readonly StoredPrivateDatasetEvidenceObject[],
  ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>;
}> {
  const ownerId = safeOwner(input.ownerId);
  const bucketName = input.bucketName.trim();
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const maximumObjectBytes = positiveSafeInteger(
    input.maximumObjectBytes,
    "maximumObjectBytes",
  );
  const maximumObjects = positiveSafeInteger(
    input.maximumObjects ?? 10_000,
    "maximumObjects",
    10_000,
  );
  let portPromise: Promise<PrivateDatasetEvidenceObjectDeletionPort> | null =
    null;

  async function privatePort() {
    if (portPromise === null) {
      portPromise = Promise.resolve(input.createPort()).then(
        async (created) => {
          if (
            created === null ||
            typeof created !== "object" ||
            typeof created.deleteObject !== "function"
          ) {
            throw new Error("Evidence object recovery initialization failed.");
          }
          assertPrivateBucket(await created.readBucketPrivacy({ bucketName }));
          return created;
        },
      );
    }
    return portPromise;
  }

  return Object.freeze({
    async cleanup(stored) {
      if (stored.length > maximumObjects) {
        throw new Error("evidence recovery set exceeds configured capacity");
      }
      const normalized = stored.map((object) =>
        normalizeStoredEvidenceObject(object, maximumObjectBytes),
      );
      const seen = new Set<string>();
      for (const object of normalized) {
        if (object.registration.ownerId !== ownerId) {
          throw new Error("Evidence object recovery access denied.");
        }
        if (seen.has(object.registration.objectKey)) {
          throw new Error("evidence recovery set contains a duplicate object");
        }
        seen.add(object.registration.objectKey);
      }

      const inspections = await Promise.all(
        normalized.map((object) =>
          input.inspectionRepository.inspect(object.registration),
        ),
      );
      if (inspections.some(({ status }) => status === "conflict")) {
        throw new Error("Conflicting evidence manifest blocks recovery.");
      }

      const port = await privatePort();
      const candidates = normalized.filter(
        (_object, index) => inspections[index]?.status === "missing",
      );
      const providerEvidence = await Promise.all(
        candidates.map((object) =>
          port.headObject({
            bucketName,
            key: object.registration.objectKey,
          }),
        ),
      );
      providerEvidence.forEach((evidence, index) => {
        if (evidence.status === "missing") return;
        const registration = candidates[index]!.registration;
        exactObjectEvidence(evidence, {
          contentType: objectMediaTypes[registration.objectFormat],
          byteSize: registration.byteSize,
          checksumSha256: registration.checksumSha256,
          rowCount: registration.rowCount,
          sourceType: registration.sourceType,
          objectKind: registration.objectKind,
          partitionNumber: registration.partitionNumber,
        });
      });

      const receipts: PrivateDatasetEvidenceObjectRecoveryReceipt[] = [];
      for (let index = 0; index < normalized.length; index += 1) {
        const object = normalized[index]!;
        if (inspections[index]?.status === "exact") {
          receipts.push({
            objectKey: object.registration.objectKey,
            status: "retained_registered",
          });
          continue;
        }
        const candidateIndex = candidates.indexOf(object);
        if (providerEvidence[candidateIndex]?.status === "missing") {
          receipts.push({
            objectKey: object.registration.objectKey,
            status: "missing",
          });
          continue;
        }
        await port.deleteObject({
          bucketName,
          key: object.registration.objectKey,
        });
        const after = await port.headObject({
          bucketName,
          key: object.registration.objectKey,
        });
        if (after.status !== "missing") {
          throw new Error(
            "Evidence object recovery deletion was not verified.",
          );
        }
        receipts.push({
          objectKey: object.registration.objectKey,
          status: "deleted",
        });
      }
      return receipts;
    },
  });
}
