import {
  GetObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";

import type {
  CloudflareR2ImportObjectStoragePort,
  CloudflareR2ObjectMetadata,
} from "./cloudflare-r2-import-object-storage";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const MAX_SIGNED_URL_LIFETIME_SECONDS = 3600;
const CLOUDFLARE_API_ORIGIN = "https://api.cloudflare.com";

type S3ObjectResult = Readonly<{
  contentLength: number | undefined;
  contentType: string | undefined;
  etag: string | undefined;
  versionId: string | undefined;
  metadata: Readonly<Record<string, string | undefined>> | undefined;
  body?: unknown;
}>;

export type CloudflareR2S3Driver = Readonly<{
  createPresignedPut: (input: {
    bucketName: string;
    key: string;
    contentType: string;
    byteLength: number;
    expiresInSeconds: number;
    signingDate: Date;
  }) => Promise<string>;
  headObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<S3ObjectResult>;
  getObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<S3ObjectResult>;
}>;

export type CloudflareR2S3PortConfiguration = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  createDriver?: (input: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => CloudflareR2S3Driver;
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
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function record(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    throw new Error("Cloudflare R2 response is invalid.");
  }
  return value as Record<string, unknown>;
}

function boolean(value: unknown): boolean {
  if (typeof value !== "boolean") {
    throw new Error("Cloudflare R2 response is invalid.");
  }
  return value;
}

function missingObject(error: unknown): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: Readonly<{ httpStatusCode?: unknown }>;
  };
  return (
    candidate.name === "NotFound" ||
    candidate.name === "NoSuchKey" ||
    candidate.$metadata?.httpStatusCode === 404
  );
}

function objectMetadata(result: S3ObjectResult): CloudflareR2ObjectMetadata {
  return {
    byteLength: result.contentLength ?? Number.NaN,
    contentType: result.contentType ?? "",
    etag: result.etag ?? "",
    version: result.versionId ?? null,
    sha256: result.metadata?.sha256 ?? null,
  };
}

function objectBody(value: unknown): AsyncIterable<Uint8Array> {
  if (
    value === null ||
    typeof value !== "object" ||
    !(Symbol.asyncIterator in value) ||
    typeof value[Symbol.asyncIterator] !== "function"
  ) {
    throw new Error("Cloudflare R2 object body is unavailable.");
  }
  return value as AsyncIterable<Uint8Array>;
}

function defaultDriver(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): CloudflareR2S3Driver {
  const client = new S3Client({
    region: "auto",
    endpoint: input.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });

  return {
    async createPresignedPut(request) {
      return getSignedUrl(
        client,
        new PutObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
          ContentType: request.contentType,
          ContentLength: request.byteLength,
        }),
        {
          expiresIn: request.expiresInSeconds,
          signingDate: request.signingDate,
          signableHeaders: new Set(["content-type"]),
        },
      );
    },
    async headObject(request) {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
        }),
      );
      return {
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        versionId: result.VersionId,
        metadata: result.Metadata,
      };
    },
    async getObject(request) {
      const result = await client.send(
        new GetObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
        }),
      );
      return {
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        etag: result.ETag,
        versionId: result.VersionId,
        metadata: result.Metadata,
        body: result.Body,
      };
    },
  };
}

export function createCloudflareR2S3Port(
  configuration: CloudflareR2S3PortConfiguration,
): CloudflareR2ImportObjectStoragePort {
  const accountId = configuration.accountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("accountId is invalid");
  }
  const accessKeyId = requireSecret(configuration.accessKeyId, "accessKeyId");
  const secretAccessKey = requireSecret(
    configuration.secretAccessKey,
    "secretAccessKey",
  );
  const apiToken = requireSecret(configuration.apiToken, "apiToken");
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const now = configuration.now ?? (() => new Date());
  const fetcher = configuration.fetch ?? globalThis.fetch;
  if (typeof fetcher !== "function") {
    throw new Error("Cloudflare API transport is unavailable.");
  }
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint,
    accessKeyId,
    secretAccessKey,
  });

  async function cloudflareResult(path: string): Promise<unknown> {
    const response = await fetcher(`${CLOUDFLARE_API_ORIGIN}${path}`, {
      method: "GET",
      headers: {
        Accept: "application/json",
        Authorization: `Bearer ${apiToken}`,
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

  return Object.freeze({
    async readBucketPrivacy(input) {
      const bucketName = encodeURIComponent(input.bucketName);
      const prefix = `/client/v4/accounts/${accountId}/r2/buckets/${bucketName}/domains`;
      const [managedValue, customValue] = await Promise.all([
        cloudflareResult(`${prefix}/managed`),
        cloudflareResult(`${prefix}/custom`),
      ]);
      const managed = record(managedValue);
      const custom = record(customValue);
      if (!Array.isArray(custom.domains)) {
        throw new Error("Cloudflare R2 privacy verification failed.");
      }
      const customDomains = custom.domains.map(record);
      const managedEnabled = boolean(managed.enabled);
      const enabledCustomDomain = customDomains.some((domain) =>
        boolean(domain.enabled),
      );
      return {
        publicAccessDisabled: !managedEnabled && !enabledCustomDomain,
        r2DevDisabled: !managedEnabled,
        customDomainCount: customDomains.length,
      };
    },

    async createPresignedPut(input) {
      if (input.endpoint !== endpoint) {
        throw new Error("Cloudflare R2 endpoint is inconsistent.");
      }
      const signingDate = now();
      if (Number.isNaN(signingDate.getTime())) {
        throw new Error("Cloudflare R2 signing time is invalid.");
      }
      const remainingMilliseconds =
        Date.parse(input.expiresAt) - signingDate.getTime();
      const expiresInSeconds = Math.floor(remainingMilliseconds / 1000);
      if (
        !Number.isSafeInteger(expiresInSeconds) ||
        expiresInSeconds < 1 ||
        expiresInSeconds > MAX_SIGNED_URL_LIFETIME_SECONDS
      ) {
        throw new Error("Cloudflare R2 signed URL lifetime is invalid.");
      }
      return {
        url: await driver.createPresignedPut({
          bucketName: input.bucketName,
          key: input.key,
          contentType: input.contentType,
          byteLength: input.byteLength,
          expiresInSeconds,
          signingDate,
        }),
      };
    },

    async headObject(input) {
      try {
        const result = await driver.headObject(input);
        return { status: "ready", metadata: objectMetadata(result) };
      } catch (error) {
        if (missingObject(error)) return { status: "missing" };
        throw new Error("Cloudflare R2 object inspection failed.");
      }
    },

    async getObject(input) {
      try {
        const result = await driver.getObject(input);
        return {
          status: "ready",
          advertisedByteLength: result.contentLength ?? Number.NaN,
          body: objectBody(result.body),
        };
      } catch (error) {
        if (missingObject(error)) return { status: "missing" };
        if (
          error instanceof Error &&
          error.message === "Cloudflare R2 object body is unavailable."
        ) {
          throw error;
        }
        throw new Error("Cloudflare R2 object read failed.");
      }
    },
  });
}
