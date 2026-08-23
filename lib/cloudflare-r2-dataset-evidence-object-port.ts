import { Readable } from "node:stream";

import {
  HeadObjectCommand,
  PutObjectCommand,
  S3Client,
} from "@aws-sdk/client-s3";

import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import type { PrivateDatasetEvidenceObjectStoragePort } from "./private-dataset-evidence-object-writer";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

type DriverHeadResult = Readonly<{
  contentLength: number | undefined;
  contentType: string | undefined;
  metadata: Readonly<Record<string, string | undefined>> | undefined;
}>;

export type CloudflareR2DatasetEvidenceObjectDriver = Readonly<{
  putObjectIfAbsent: (input: {
    bucketName: string;
    key: string;
    body: AsyncIterable<Uint8Array>;
    contentType: string;
    byteLength: number;
    checksumSha256: string;
    metadata: Readonly<Record<string, string>>;
  }) => Promise<Readonly<{ status: "created" | "existing" }>>;
  headObject: (input: {
    bucketName: string;
    key: string;
  }) => Promise<DriverHeadResult>;
}>;

export type CloudflareR2DatasetEvidenceObjectPortConfiguration = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  apiToken: string;
  createDriver?: (input: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => CloudflareR2DatasetEvidenceObjectDriver;
  createPrivacyPort?: () => Pick<
    PrivateDatasetEvidenceObjectStoragePort,
    "readBucketPrivacy"
  >;
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

function requestFailedWith(error: unknown, statusCode: number): boolean {
  if (error === null || typeof error !== "object") return false;
  const candidate = error as {
    name?: unknown;
    $metadata?: Readonly<{ httpStatusCode?: unknown }>;
  };
  return (
    candidate.$metadata?.httpStatusCode === statusCode ||
    (statusCode === 404 &&
      (candidate.name === "NotFound" || candidate.name === "NoSuchKey")) ||
    (statusCode === 412 && candidate.name === "PreconditionFailed")
  );
}

function defaultDriver(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): CloudflareR2DatasetEvidenceObjectDriver {
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
      try {
        await client.send(
          new PutObjectCommand({
            Bucket: request.bucketName,
            Key: request.key,
            Body: Readable.from(request.body),
            ContentType: request.contentType,
            ContentLength: request.byteLength,
            IfNoneMatch: "*",
            Metadata: {
              ...request.metadata,
              sha256: request.checksumSha256,
            },
          }),
        );
        return { status: "created" };
      } catch (error) {
        if (requestFailedWith(error, 412)) return { status: "existing" };
        throw new Error("Cloudflare R2 evidence object write failed.");
      }
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
        metadata: result.Metadata,
      };
    },
  };
}

export function createCloudflareR2DatasetEvidenceObjectPort(
  configuration: CloudflareR2DatasetEvidenceObjectPortConfiguration,
): PrivateDatasetEvidenceObjectStoragePort {
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
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint,
    accessKeyId,
    secretAccessKey,
  });
  const privacyPort =
    configuration.createPrivacyPort?.() ??
    createCloudflareR2S3Port({
      accountId,
      accessKeyId,
      secretAccessKey,
      apiToken,
    });

  return Object.freeze({
    readBucketPrivacy: privacyPort.readBucketPrivacy,

    async putObjectIfAbsent(input) {
      return driver.putObjectIfAbsent(input);
    },

    async headObject(input) {
      try {
        const result = await driver.headObject(input);
        return {
          status: "ready",
          contentType: result.contentType ?? "",
          byteLength: result.contentLength ?? Number.NaN,
          checksumSha256: result.metadata?.sha256 ?? "",
          metadata: result.metadata ?? {},
        };
      } catch (error) {
        if (requestFailedWith(error, 404)) return { status: "missing" };
        throw new Error("Cloudflare R2 evidence object inspection failed.");
      }
    },
  });
}
