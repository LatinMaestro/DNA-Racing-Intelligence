import { createHash } from "node:crypto";

import type { DatasetEvidenceObjectRegistration } from "./neon-dataset-evidence-object-repository";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

const objectMediaTypes = Object.freeze({
  ndjson_gzip: "application/x-ndjson+gzip",
  parquet: "application/vnd.apache.parquet",
} as const);

export type PrivateDatasetEvidenceObjectReadableStoragePort = Pick<
  PrivateDatasetEvidenceObjectStoragePort,
  "readBucketPrivacy" | "headObject"
> &
  Readonly<{
    getObject: (input: { bucketName: string; key: string }) => Promise<
      | Readonly<{ status: "missing" }>
      | Readonly<{
          status: "ready";
          body: AsyncIterable<Uint8Array>;
        }>
    >;
  }>;

export type VerifiedPrivateDatasetEvidenceObject = Readonly<{
  registration: DatasetEvidenceObjectRegistration;
  body: Uint8Array;
}>;

export type PrivateDatasetEvidenceObjectReader = Readonly<{
  read: (
    registration: DatasetEvidenceObjectRegistration,
  ) => Promise<VerifiedPrivateDatasetEvidenceObject>;
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

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " is invalid");
  }
  return value;
}

function assertPrivateBucket(evidence: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}): void {
  if (
    evidence.publicAccessDisabled !== true ||
    evidence.r2DevDisabled !== true ||
    evidence.customDomainCount !== 0
  ) {
    throw new Error("Evidence object bucket is not private.");
  }
}

function validateRegistration(
  input: DatasetEvidenceObjectRegistration,
  maximumObjectBytes: number,
): DatasetEvidenceObjectRegistration {
  const ownerId = safeOwner(input.ownerId);
  const objectKey = input.objectKey.trim();
  if (
    objectKey === "" ||
    objectKey.length > 1024 ||
    objectKey.startsWith("/") ||
    objectKey.split("/").includes("..") ||
    CONTROL_CHARACTER_PATTERN.test(objectKey)
  ) {
    throw new Error("objectKey is invalid");
  }
  if (!SHA_256_PATTERN.test(input.checksumSha256)) {
    throw new Error("checksumSha256 is invalid");
  }
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    input.byteSize > maximumObjectBytes
  ) {
    throw new Error("Evidence object exceeds bounded read capacity.");
  }
  if (!Number.isSafeInteger(input.rowCount) || input.rowCount <= 0) {
    throw new Error("rowCount is invalid");
  }
  if (
    input.objectFormat !== "ndjson_gzip" &&
    input.objectFormat !== "parquet"
  ) {
    throw new Error("objectFormat is unsupported");
  }
  return { ...input, ownerId, objectKey };
}

function exactHead(
  value: Awaited<
    ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>
  >,
  registration: DatasetEvidenceObjectRegistration,
): void {
  if (
    value.status !== "ready" ||
    value.contentType.trim().toLowerCase() !==
      objectMediaTypes[registration.objectFormat] ||
    value.byteLength !== registration.byteSize ||
    value.checksumSha256 !== registration.checksumSha256 ||
    value.metadata.rows !== String(registration.rowCount) ||
    value.metadata.source !== registration.sourceType ||
    value.metadata.kind !== registration.objectKind ||
    value.metadata.partition !== String(registration.partitionNumber)
  ) {
    throw new Error("Stored evidence object failed exact verification.");
  }
}

async function collectVerifiedBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteSize: number;
  checksumSha256: string;
}): Promise<Uint8Array> {
  const output = new Uint8Array(input.byteSize);
  const hash = createHash("sha256");
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > input.byteSize
    ) {
      throw new Error("Evidence object body length is invalid.");
    }
    output.set(chunk, offset);
    hash.update(chunk);
    offset += chunk.byteLength;
  }
  if (offset !== input.byteSize) {
    throw new Error("Evidence object body length is invalid.");
  }
  if (hash.digest("hex") !== input.checksumSha256) {
    throw new Error("Evidence object body checksum is invalid.");
  }
  return output;
}

export function createPrivateDatasetEvidenceObjectReader(input: {
  ownerId: string;
  bucketName: string;
  maximumObjectBytes: number;
  createPort: () =>
    | PrivateDatasetEvidenceObjectReadableStoragePort
    | Promise<PrivateDatasetEvidenceObjectReadableStoragePort>;
}): PrivateDatasetEvidenceObjectReader {
  const ownerId = safeOwner(input.ownerId);
  const bucketName = input.bucketName.trim();
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const maximumObjectBytes = positiveSafeInteger(
    input.maximumObjectBytes,
    "maximumObjectBytes",
  );
  let portPromise: Promise<PrivateDatasetEvidenceObjectReadableStoragePort> | null =
    null;
  let privacyPromise: Promise<void> | null = null;

  async function privatePort(): Promise<PrivateDatasetEvidenceObjectReadableStoragePort> {
    if (portPromise === null) {
      portPromise = Promise.resolve(input.createPort()).then((port) => {
        if (port === null || typeof port !== "object") {
          throw new Error("Evidence object reader initialization failed.");
        }
        return port;
      });
    }
    const port = await portPromise;
    if (privacyPromise === null) {
      privacyPromise = port
        .readBucketPrivacy({ bucketName })
        .then(assertPrivateBucket);
    }
    await privacyPromise;
    return port;
  }

  return Object.freeze({
    async read(registrationInput) {
      const registration = validateRegistration(
        registrationInput,
        maximumObjectBytes,
      );
      if (registration.ownerId !== ownerId) {
        throw new Error("Evidence object read access denied.");
      }
      const port = await privatePort();
      exactHead(
        await port.headObject({
          bucketName,
          key: registration.objectKey,
        }),
        registration,
      );
      const object = await port.getObject({
        bucketName,
        key: registration.objectKey,
      });
      if (object.status !== "ready") {
        throw new Error("Verified evidence object became unavailable.");
      }
      return {
        registration,
        body: await collectVerifiedBody({
          body: object.body,
          byteSize: registration.byteSize,
          checksumSha256: registration.checksumSha256,
        }),
      };
    },
  });
}
