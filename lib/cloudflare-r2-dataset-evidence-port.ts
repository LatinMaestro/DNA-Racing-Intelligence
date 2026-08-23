import { Buffer } from "node:buffer";

import {
  DeleteObjectCommand,
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import type { PrivateDatasetEvidenceObjectDeletionPort } from "./private-dataset-evidence-object-writer";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const DEFAULT_MAXIMUM_BUFFERED_PUT_BYTES = 8 * 1024 * 1024;

type EvidenceHeadResult = Readonly<{
  contentLength: number | undefined;
  contentType: string | undefined;
  checksumSha256: string | undefined;
  metadata: Readonly<Record<string, string | undefined>> | undefined;
}>;

export type CloudflareR2DatasetEvidenceDriver = Readonly<{
  putObjectIfAbsent: (input: {
    bucketName: string;
    key: string;
    body: Uint8Array;
    contentType: string;
    byteLength: number;
    checksumSha256Base64: string;
    metadata: Readonly<Record<string, string>>;
  }) => Promise<void>;
  headObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<EvidenceHeadResult>;
  deleteObject: (input: { bucketName: string; key: string }) => Promise<void>;
}>;

export type CloudflareR2DatasetEvidencePortConfiguration = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
  maximumBufferedPutBytes?: number;
  fetch?: typeof globalThis.fetch;
  createDriver?: (input: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => CloudflareR2DatasetEvidenceDriver;
}>;

function secret(value: string, field: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error(field + " is invalid");
  }
  return normalized;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " is invalid");
  }
  return value;
}

async function collectExactBody(input: {
  body: AsyncIterable<Uint8Array>;
  byteLength: number;
  maximumBufferedPutBytes: number;
}): Promise<Uint8Array> {
  const byteLength = positiveSafeInteger(input.byteLength, "byteLength");
  if (byteLength > input.maximumBufferedPutBytes) {
    throw new Error(
      "Cloudflare R2 evidence write exceeds bounded memory capacity.",
    );
  }
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for await (const chunk of input.body) {
    if (
      !(chunk instanceof Uint8Array) ||
      offset + chunk.byteLength > byteLength
    ) {
      throw new Error("Cloudflare R2 evidence body length is invalid.");
    }
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  if (offset !== byteLength) {
    throw new Error("Cloudflare R2 evidence body length is invalid.");
  }
  return output;
}

function defaultDriver(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
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
  return {
    async putObjectIfAbsent(request) {
      await client.send(
        new PutObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
          Body: request.body,
          ContentType: request.contentType,
          ContentLength: request.byteLength,
          ChecksumSHA256: request.checksumSha256Base64,
          Metadata: request.metadata,
          IfNoneMatch: "*",
        }),
      );
    },
    async headObject(request) {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
          ChecksumMode: "ENABLED",
        }),
      );
      return {
        contentLength: result.ContentLength,
        contentType: result.ContentType,
        checksumSha256: result.ChecksumSHA256,
        metadata: result.Metadata,
      };
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

function status(error: unknown, code: number): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: Readonly<{ httpStatusCode?: unknown }>;
  };
  return (
    candidate.$metadata?.httpStatusCode === code ||
    (code === 404 &&
      (candidate.name === "NotFound" || candidate.name === "NoSuchKey")) ||
    (code === 412 && candidate.name === "PreconditionFailed")
  );
}

function checksumHex(value: string | undefined): string {
  if (typeof value !== "string" || value.trim() === "") {
    throw new Error("Cloudflare R2 evidence checksum is unavailable.");
  }
  const decoded = Buffer.from(value, "base64");
  const canonical = decoded.toString("base64");
  const hex = decoded.toString("hex");
  if (
    decoded.byteLength !== 32 ||
    canonical.replace(/=+$/u, "") !== value.trim().replace(/=+$/u, "") ||
    !SHA_256_PATTERN.test(hex)
  ) {
    throw new Error("Cloudflare R2 evidence checksum is invalid.");
  }
  return hex;
}

export function createCloudflareR2DatasetEvidencePort(
  configuration: CloudflareR2DatasetEvidencePortConfiguration,
): PrivateDatasetEvidenceObjectDeletionPort {
  const accountId = configuration.accountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    throw new Error("accountId is invalid");
  }
  const accessKeyId = secret(configuration.accessKeyId, "accessKeyId");
  const secretAccessKey = secret(
    configuration.secretAccessKey,
    "secretAccessKey",
  );
  const apiToken = secret(configuration.apiToken, "apiToken");
  const maximumBufferedPutBytes = positiveSafeInteger(
    configuration.maximumBufferedPutBytes ??
      DEFAULT_MAXIMUM_BUFFERED_PUT_BYTES,
    "maximumBufferedPutBytes",
  );
  const endpoint = "https://" + accountId + ".r2.cloudflarestorage.com";
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint,
    accessKeyId,
    secretAccessKey,
  });
  const privacy = createCloudflareR2S3Port({
    accountId,
    accessKeyId,
    secretAccessKey,
    apiToken,
    ...(configuration.fetch ? { fetch: configuration.fetch } : {}),
  });

  return Object.freeze({
    readBucketPrivacy: privacy.readBucketPrivacy,

    async putObjectIfAbsent(input) {
      if (!SHA_256_PATTERN.test(input.checksumSha256)) {
        throw new Error("Cloudflare R2 evidence checksum is invalid.");
      }
      const bufferedBody = await collectExactBody({
        body: input.body,
        byteLength: input.byteLength,
        maximumBufferedPutBytes,
      });
      try {
        await driver.putObjectIfAbsent({
          bucketName: input.bucketName,
          key: input.key,
          body: bufferedBody,
          contentType: input.contentType,
          byteLength: input.byteLength,
          checksumSha256Base64: Buffer.from(
            input.checksumSha256,
            "hex",
          ).toString("base64"),
          metadata: input.metadata,
        });
        return { status: "created" };
      } catch (error) {
        if (status(error, 412)) return { status: "existing" };
        throw new Error("Cloudflare R2 evidence write failed.");
      }
    },

    async headObject(input) {
      try {
        const result = await driver.headObject(input);
        return {
          status: "ready",
          contentType: result.contentType ?? "",
          byteLength: result.contentLength ?? Number.NaN,
          checksumSha256: checksumHex(result.checksumSha256),
          metadata: result.metadata ?? {},
        };
      } catch (error) {
        if (status(error, 404)) return { status: "missing" };
        if (
          error instanceof Error &&
          error.message.startsWith("Cloudflare R2 evidence checksum")
        ) {
          throw error;
        }
        throw new Error("Cloudflare R2 evidence inspection failed.");
      }
    },

    async deleteObject(input) {
      try {
        await driver.deleteObject(input);
        return { status: "deleted" };
      } catch (error) {
        if (status(error, 404)) return { status: "missing" };
        throw new Error("Cloudflare R2 evidence deletion failed.");
      }
    },
  });
}
