import { createHash } from "node:crypto";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import type {
  DatasetEvidenceObjectFormat,
  DatasetEvidenceObjectKind,
} from "./neon-dataset-evidence-object-repository";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAX_OBJECT_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_PARTITION_NUMBER = 9999;
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";

export type DatasetEvidenceObjectWrite = Readonly<{
  ownerId: string;
  importBatchId: string;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
  checksumSha256: string;
  byteSize: number;
  body: AsyncIterable<Uint8Array>;
}>;

export type WrittenDatasetEvidenceObject = Readonly<{
  objectKey: string;
  checksumSha256: string;
  byteSize: number;
  objectFormat: DatasetEvidenceObjectFormat;
}>;

export type CloudflareR2DatasetEvidenceDriver = Readonly<{
  readBucketPrivacy: (input: {
    bucketName: string;
  }) => Promise<Readonly<{
    publicAccessDisabled: boolean;
    r2DevDisabled: boolean;
    customDomainCount: number;
  }>>;
  putObject: (input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    byteSize: number;
    contentType: string;
    contentEncoding: string | null;
    metadata: Readonly<Record<string, string>>;
  }) => Promise<void>;
  headObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        byteSize: number;
        contentType: string;
        contentEncoding: string | null;
        metadata: Readonly<Record<string, string | undefined>>;
      }>
  >;
  deleteObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<void>;
}>;

export type CloudflareR2DatasetEvidenceObjectStorage = Readonly<{
  writeVerifiedObject: (
    input: DatasetEvidenceObjectWrite,
  ) => Promise<WrittenDatasetEvidenceObject>;
}>;

export type CloudflareR2DatasetEvidenceStorageConfiguration = Readonly<{
  accountId: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
  fetch?: typeof globalThis.fetch;
  createDriver?: (input: {
    endpoint: string;
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    apiToken: string;
    fetch: typeof globalThis.fetch;
  }) => CloudflareR2DatasetEvidenceDriver;
}>;

type CloudflareEnvelope = Readonly<{
  success?: unknown;
  result?: unknown;
}>;

function requireSecret(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 4096 ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requireOwner(value: string): string {
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

function requireWrite(input: DatasetEvidenceObjectWrite) {
  const ownerId = requireOwner(input.ownerId);
  const importBatchId = input.importBatchId.trim();
  if (!UUID_PATTERN.test(importBatchId)) {
    throw new Error("importBatchId must be a UUID");
  }
  if (
    !Number.isSafeInteger(input.partitionNumber) ||
    input.partitionNumber < 0 ||
    input.partitionNumber > MAX_PARTITION_NUMBER
  ) {
    throw new Error("partitionNumber is invalid");
  }
  if (
    input.objectKind !== "staged_rows" &&
    input.objectKind !== "accepted_contributions" &&
    input.objectKind !== "normalized_partition"
  ) {
    throw new Error("objectKind is unsupported");
  }
  if (input.objectFormat !== "ndjson_gzip" && input.objectFormat !== "parquet") {
    throw new Error("objectFormat is unsupported");
  }
  if (!SHA_256_PATTERN.test(input.checksumSha256)) {
    throw new Error("checksumSha256 is invalid");
  }
  if (
    !Number.isSafeInteger(input.byteSize) ||
    input.byteSize <= 0 ||
    input.byteSize > MAX_OBJECT_BYTES
  ) {
    throw new Error("byteSize is invalid");
  }
  if (
    input.body === null ||
    typeof input.body !== "object" ||
    typeof input.body[Symbol.asyncIterator] !== "function"
  ) {
    throw new Error("body must be an async byte stream");
  }
  return {
    ownerId,
    importBatchId,
    objectKind: input.objectKind,
    partitionNumber: input.partitionNumber,
    objectFormat: input.objectFormat,
    checksumSha256: input.checksumSha256,
    byteSize: input.byteSize,
    body: input.body,
  };
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-evidence-owner\u0000${ownerId}`)
    .digest("hex");
}

function extension(format: DatasetEvidenceObjectFormat): string {
  return format === "parquet" ? "parquet" : "ndjson.gz";
}

function objectKey(input: {
  ownerId: string;
  importBatchId: string;
  objectKind: DatasetEvidenceObjectKind;
  partitionNumber: number;
  objectFormat: DatasetEvidenceObjectFormat;
}): string {
  const partition = String(input.partitionNumber).padStart(4, "0");
  return [
    "evidence",
    ownerPrefix(input.ownerId),
    input.importBatchId.toLowerCase(),
    input.objectKind,
    `part-${partition}.${extension(input.objectFormat)}`,
  ].join("/");
}

function formatMetadata(format: DatasetEvidenceObjectFormat): Readonly<{
  contentType: string;
  contentEncoding: string | null;
}> {
  return format === "parquet"
    ? { contentType: "application/vnd.apache.parquet", contentEncoding: null }
    : { contentType: "application/x-ndjson", contentEncoding: "gzip" };
}

function assertPrivateBucket(evidence: {
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}) {
  if (
    evidence.publicAccessDisabled !== true ||
    evidence.r2DevDisabled !== true ||
    !Number.isSafeInteger(evidence.customDomainCount) ||
    evidence.customDomainCount !== 0
  ) {
    throw new Error("R2 private evidence bucket verification failed.");
  }
}

function defaultDriver(input: {
  endpoint: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
  fetch: typeof globalThis.fetch;
}): CloudflareR2DatasetEvidenceDriver {
  const client = new S3Client({
    region: "auto",
    endpoint: input.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });

  async function cloudflareResult(path: string): Promise<unknown> {
    const response = await input.fetch(`${CLOUDFLARE_API_ORIGIN}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${input.apiToken}`,
      },
      cache: "no-store",
    });
    if (!response.ok) {
      throw new Error("Cloudflare R2 privacy verification failed.");
    }
    const envelope = (await response.json()) as CloudflareEnvelope;
    if (envelope.success !== true) {
      throw new Error("Cloudflare R2 privacy verification failed.");
    }
    return envelope.result;
  }

  function record(value: unknown): Record<string, unknown> {
    if (value === null || typeof value !== "object" || Array.isArray(value)) {
      throw new Error("Cloudflare R2 privacy verification failed.");
    }
    return value as Record<string, unknown>;
  }

  return {
    async readBucketPrivacy(request) {
      const bucketName = encodeURIComponent(request.bucketName);
      const prefix = `/client/v4/accounts/${input.accountId}/r2/buckets/${bucketName}/domains`;
      const [managedValue, customValue] = await Promise.all([
        cloudflareResult(`${prefix}/managed`),
        cloudflareResult(`${prefix}/custom`),
      ]);
      const managed = record(managedValue);
      const custom = record(customValue);
      if (
        typeof managed.enabled !== "boolean" ||
        !Array.isArray(custom.domains)
      ) {
        throw new Error("Cloudflare R2 privacy verification failed.");
      }
      const customDomains = custom.domains.map(record);
      if (customDomains.some((domain) => typeof domain.enabled !== "boolean")) {
        throw new Error("Cloudflare R2 privacy verification failed.");
      }
      return {
        publicAccessDisabled:
          managed.enabled === false &&
          !customDomains.some((domain) => domain.enabled === true),
        r2DevDisabled: managed.enabled === false,
        customDomainCount: customDomains.length,
      };
    },
    async putObject(request) {
      await client.send(
        new PutObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
          Body: request.body,
          ContentLength: request.byteSize,
          ContentType: request.contentType,
          ...(request.contentEncoding === null
            ? {}
            : { ContentEncoding: request.contentEncoding }),
          Metadata: { ...request.metadata },
        }),
      );
    },
    async headObject(request) {
      try {
        const result = await client.send(
          new HeadObjectCommand({
            Bucket: request.bucketName,
            Key: request.key,
          }),
        );
        return {
          status: "ready",
          byteSize: result.ContentLength ?? Number.NaN,
          contentType: result.ContentType ?? "",
          contentEncoding: result.ContentEncoding ?? null,
          metadata: result.Metadata ?? {},
        };
      } catch (error) {
        if (
          error !== null &&
          typeof error === "object" &&
          ((error as { name?: unknown }).name === "NotFound" ||
            (error as { name?: unknown }).name === "NoSuchKey" ||
            (error as { $metadata?: { httpStatusCode?: unknown } }).$metadata
              ?.httpStatusCode === 404)
        ) {
          return { status: "missing" };
        }
        throw new Error("Cloudflare R2 evidence object inspection failed.");
      }
    },
    async deleteObject(request) {
      await client.send(
        new DeleteObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
        }),
      );
    },
  };
}

export function createCloudflareR2DatasetEvidenceObjectStorage(
  configuration: CloudflareR2DatasetEvidenceStorageConfiguration,
): CloudflareR2DatasetEvidenceObjectStorage {
  const accountId = configuration.accountId.trim().toLowerCase();
  const bucketName = configuration.bucketName.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("accountId is invalid");
  }
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("bucketName is invalid");
  }
  const accessKeyId = requireSecret(configuration.accessKeyId, "accessKeyId");
  const secretAccessKey = requireSecret(
    configuration.secretAccessKey,
    "secretAccessKey",
  );
  const apiToken = requireSecret(configuration.apiToken, "apiToken");
  const fetcher = configuration.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Cloudflare API transport is unavailable.");
  }
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint,
    accountId,
    accessKeyId,
    secretAccessKey,
    apiToken,
    fetch: fetcher,
  });
  let privacyPromise: Promise<void> | null = null;

  async function verifyPrivateBucket(): Promise<void> {
    if (privacyPromise === null) {
      privacyPromise = driver
        .readBucketPrivacy({ bucketName })
        .then(assertPrivateBucket);
    }
    return privacyPromise;
  }

  return Object.freeze({
    async writeVerifiedObject(writeInput) {
      const write = requireWrite(writeInput);
      await verifyPrivateBucket();
      const key = objectKey(write);
      const format = formatMetadata(write.objectFormat);
      const hash = createHash("sha256");
      let streamedBytes = 0;
      let finalized = false;

      async function* verifiedBody() {
        for await (const chunk of write.body) {
          if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
            throw new Error("Evidence object stream returned an invalid chunk.");
          }
          streamedBytes += chunk.byteLength;
          if (streamedBytes > write.byteSize) {
            throw new Error("Evidence object stream exceeds declared byte size.");
          }
          hash.update(chunk);
          yield chunk;
        }
      }

      async function cleanup(): Promise<void> {
        await driver.deleteObject({ bucketName, key });
      }

      try {
        await driver.putObject({
          bucketName,
          key,
          body: verifiedBody(),
          byteSize: write.byteSize,
          contentType: format.contentType,
          contentEncoding: format.contentEncoding,
          metadata: {
            sha256: write.checksumSha256,
            objectkind: write.objectKind,
            objectformat: write.objectFormat,
          },
        });
        if (streamedBytes !== write.byteSize) {
          throw new Error("Evidence object stream byte size does not reconcile.");
        }
        const actualSha256 = hash.digest("hex");
        finalized = true;
        if (actualSha256 !== write.checksumSha256) {
          throw new Error("Evidence object stream checksum does not reconcile.");
        }
        const head = await driver.headObject({ bucketName, key });
        if (
          head.status !== "ready" ||
          head.byteSize !== write.byteSize ||
          head.contentType !== format.contentType ||
          head.contentEncoding !== format.contentEncoding ||
          head.metadata.sha256 !== write.checksumSha256 ||
          head.metadata.objectkind !== write.objectKind ||
          head.metadata.objectformat !== write.objectFormat
        ) {
          throw new Error("Evidence object provider verification failed.");
        }
        return {
          objectKey: key,
          checksumSha256: actualSha256,
          byteSize: streamedBytes,
          objectFormat: write.objectFormat,
        };
      } catch (error) {
        try {
          await cleanup();
        } catch {
          throw new Error("Evidence object cleanup failed after write failure.");
        }
        if (error instanceof Error) throw error;
        throw new Error("Evidence object write failed.");
      } finally {
        if (!finalized) hash.destroy();
      }
    },
  });
}
