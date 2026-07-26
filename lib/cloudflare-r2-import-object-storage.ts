import { createHash } from "node:crypto";

import type { PrivateImportUploadTargetStore } from "./import-upload-intake-service";
import type { PrivateUploadedObjectInspector } from "./import-upload-completion-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;

export type CloudflareR2BucketPrivacyEvidence = Readonly<{
  publicAccessDisabled: boolean;
  r2DevDisabled: boolean;
  customDomainCount: number;
}>;

export type CloudflareR2ObjectMetadata = Readonly<{
  byteLength: number;
  contentType: string;
  etag: string;
  version: string | null;
  sha256: string | null;
}>;

export type CloudflareR2ImportObjectStoragePort = Readonly<{
  readBucketPrivacy: (input: {
    bucketName: string;
  }) => Promise<CloudflareR2BucketPrivacyEvidence>;
  createPresignedPut: (input: {
    endpoint: string;
    bucketName: string;
    key: string;
    contentType: string;
    byteLength: number;
    sha256: string;
    expiresAt: string;
  }) => Promise<Readonly<{ url: string }>>;
  headObject: (input: { bucketName: string; key: string }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        metadata: CloudflareR2ObjectMetadata;
      }>
  >;
  getObject: (input: { bucketName: string; key: string }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        advertisedByteLength: number;
        body: AsyncIterable<Uint8Array>;
      }>
  >;
}>;

export type CloudflareR2PrivateImportObjectStorage =
  PrivateImportUploadTargetStore &
    PrivateUploadedObjectInspector &
    Readonly<{
      openObject: (input: { ownerId: string; objectId: string }) => Promise<
        | Readonly<{ status: "missing" }>
        | Readonly<{
            status: "ready";
            advertisedByteLength: number;
            body: AsyncIterable<Uint8Array>;
          }>
      >;
    }>;

export type CloudflareR2ImportObjectStorageConfiguration = Readonly<{
  accountId: string;
  bucketName: string;
  createPort: () =>
    | CloudflareR2ImportObjectStoragePort
    | Promise<CloudflareR2ImportObjectStoragePort>;
}>;

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

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

function requireContentType(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (normalized === "" || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("contentType is invalid");
  }
  return normalized;
}

function requireByteLength(value: number): number {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_FILE_BYTES) {
    throw new Error("byteLength is invalid");
  }
  return value;
}

function requireSha256(value: string): string {
  if (!SHA_256_PATTERN.test(value)) {
    throw new Error("sha256 is invalid");
  }
  return value;
}

function requireTimestamp(value: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error("expiresAt is invalid");
  }
  return value;
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256").update(`dna-owner\u0000${ownerId}`).digest("hex");
}

function objectKey(ownerId: string, objectId: string): string {
  return `quarantine/${ownerPrefix(ownerId)}/${objectId}.csv`;
}

function requireMetadata(
  metadata: CloudflareR2ObjectMetadata,
): CloudflareR2ObjectMetadata {
  const contentType = requireContentType(metadata.contentType);
  const byteLength = requireByteLength(metadata.byteLength);
  const etag = metadata.etag.trim().replace(/^"|"$/g, "");
  const version = metadata.version?.trim() ?? "";
  const objectVersion = version || etag;
  if (
    objectVersion === "" ||
    objectVersion.length > 512 ||
    /[\u0000-\u001f\u007f]/.test(objectVersion)
  ) {
    throw new Error("R2 object version is invalid");
  }
  const sha256 =
    metadata.sha256 === null ? null : requireSha256(metadata.sha256);
  return {
    byteLength,
    contentType,
    etag,
    version: objectVersion,
    sha256,
  };
}

function assertPrivateBucket(
  evidence: CloudflareR2BucketPrivacyEvidence,
): void {
  if (
    evidence.publicAccessDisabled !== true ||
    evidence.r2DevDisabled !== true ||
    !Number.isSafeInteger(evidence.customDomainCount) ||
    evidence.customDomainCount !== 0
  ) {
    throw new Error("R2 private bucket verification failed.");
  }
}

function validatePresignedTarget(input: {
  value: string;
  accountId: string;
  bucketName: string;
  key: string;
}): string {
  const target = new URL(input.value);
  const expectedHost = `${input.accountId}.r2.cloudflarestorage.com`;
  const expectedPath = `/${input.bucketName}/${input.key}`;
  const algorithm = target.searchParams.get("X-Amz-Algorithm");
  const signature = target.searchParams.get("X-Amz-Signature") ?? "";
  const signedHeaders =
    target.searchParams.get("X-Amz-SignedHeaders")?.split(";") ?? [];
  const expiresIn = Number(target.searchParams.get("X-Amz-Expires"));
  if (
    target.protocol !== "https:" ||
    target.hostname !== expectedHost ||
    decodeURIComponent(target.pathname) !== expectedPath ||
    target.username !== "" ||
    target.password !== "" ||
    target.hash !== "" ||
    algorithm !== "AWS4-HMAC-SHA256" ||
    !/^[a-f0-9]{64}$/.test(signature) ||
    !signedHeaders.includes("host") ||
    !signedHeaders.includes("content-type") ||
    !Number.isSafeInteger(expiresIn) ||
    expiresIn < 1 ||
    expiresIn > 604_800
  ) {
    throw new Error("R2 presigned target is outside the private S3 endpoint.");
  }
  return target.toString();
}

async function* validateBody(
  body: AsyncIterable<Uint8Array>,
): AsyncIterable<Uint8Array> {
  for await (const chunk of body) {
    if (!(chunk instanceof Uint8Array) || chunk.byteLength === 0) {
      throw new Error("R2 object stream returned an invalid chunk.");
    }
    yield chunk;
  }
}

export function createCloudflareR2ImportObjectStorageForOwner(input: {
  ownerId: string;
  configuration: CloudflareR2ImportObjectStorageConfiguration;
}): CloudflareR2PrivateImportObjectStorage {
  const ownerId = requireOwner(input.ownerId);
  const accountId = input.configuration.accountId.trim().toLowerCase();
  const bucketName = input.configuration.bucketName.trim();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("R2 accountId is invalid");
  }
  if (!BUCKET_NAME_PATTERN.test(bucketName)) {
    throw new Error("R2 bucketName is invalid");
  }

  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  let portPromise: Promise<CloudflareR2ImportObjectStoragePort> | null = null;
  let privacyPromise: Promise<void> | null = null;

  function assertOwner(candidate: string): void {
    if (requireOwner(candidate) !== ownerId) {
      throw new Error("R2 import object storage access denied.");
    }
  }

  async function port(): Promise<CloudflareR2ImportObjectStoragePort> {
    if (portPromise === null) {
      portPromise = Promise.resolve(input.configuration.createPort()).then(
        (created) => {
          if (created === null || typeof created !== "object") {
            throw new Error("R2 import object storage initialization failed.");
          }
          return created;
        },
      );
    }
    return portPromise;
  }

  async function privatePort(): Promise<CloudflareR2ImportObjectStoragePort> {
    const created = await port();
    if (privacyPromise === null) {
      privacyPromise = created
        .readBucketPrivacy({ bucketName })
        .then(assertPrivateBucket);
    }
    await privacyPromise;
    return created;
  }

  return Object.freeze({
    async createDirectUploadTarget(targetInput) {
      assertOwner(targetInput.ownerId);
      requireSafeIdentifier(targetInput.uploadBatchId, "uploadBatchId");
      const objectId = requireSafeIdentifier(
        targetInput.uploadFileId,
        "uploadFileId",
      );
      const contentType = requireContentType(targetInput.contentType);
      const byteLength = requireByteLength(targetInput.byteLength);
      const sha256 = requireSha256(targetInput.sha256);
      const expiresAt = requireTimestamp(targetInput.expiresAt);
      const key = objectKey(ownerId, objectId);
      const created = await privatePort();
      const signed = await created.createPresignedPut({
        endpoint,
        bucketName,
        key,
        contentType,
        byteLength,
        sha256,
        expiresAt,
      });
      return {
        method: "PUT",
        targetToken: validatePresignedTarget({
          value: signed.url,
          accountId,
          bucketName,
          key,
        }),
      };
    },

    async inspectObject(inspectInput) {
      assertOwner(inspectInput.ownerId);
      const objectId = requireSafeIdentifier(inspectInput.objectId, "objectId");
      const created = await privatePort();
      const result = await created.headObject({
        bucketName,
        key: objectKey(ownerId, objectId),
      });
      if (result.status === "missing") return result;
      const metadata = requireMetadata(result.metadata);
      return {
        status: "ready",
        private: true,
        objectVersion: metadata.version ?? metadata.etag,
        advertisedByteLength: metadata.byteLength,
        advertisedContentType: metadata.contentType,
        providerSha256: metadata.sha256,
      };
    },

    async openObject(openInput) {
      assertOwner(openInput.ownerId);
      const objectId = requireSafeIdentifier(openInput.objectId, "objectId");
      const created = await privatePort();
      const result = await created.getObject({
        bucketName,
        key: objectKey(ownerId, objectId),
      });
      if (result.status === "missing") return result;
      return {
        status: "ready",
        advertisedByteLength: requireByteLength(result.advertisedByteLength),
        body: validateBody(result.body),
      };
    },
  });
}

export function cloudflareR2ImportObjectStorageConfigurationFromEnvironment(
  input: Readonly<{
    accountId: string | undefined;
    bucketName: string | undefined;
    createPort: CloudflareR2ImportObjectStorageConfiguration["createPort"];
  }>,
): CloudflareR2ImportObjectStorageConfiguration | null {
  const accountId = input.accountId?.trim() ?? "";
  const bucketName = input.bucketName?.trim() ?? "";
  if (accountId === "" || bucketName === "") return null;
  return Object.freeze({
    accountId,
    bucketName,
    createPort: input.createPort,
  });
}
