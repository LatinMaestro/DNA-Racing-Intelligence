import {
  HeadObjectCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

import type { DnaOpenLabP5R2ListBinding } from "./cloudflare-dna-open-lab-p5-r2-footprint-port";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_PAGE_LIMIT = 1_000;

type ListedObject = Readonly<{
  key: string;
  etag: string;
  size: number;
}>;

type HeadedObject = Readonly<{
  versionId?: string;
  contentType?: string;
  cacheControl?: string;
  contentDisposition?: string;
  contentEncoding?: string;
  contentLanguage?: string;
  metadata?: Readonly<Record<string, string | undefined>>;
}>;

export type CloudflareDnaOpenLabP5R2S3ListDriver = Readonly<{
  list: (input: {
    bucketName: string;
    prefix: string;
    cursor?: string;
    limit: number;
  }) => Promise<
    Readonly<{
      objects: readonly ListedObject[];
      truncated: boolean;
      cursor?: string;
    }>
  >;
  head: (input: { bucketName: string; key: string }) => Promise<HeadedObject>;
}>;

export type CloudflareDnaOpenLabP5R2S3ListBindingConfiguration = Readonly<{
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  createDriver?: (input: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => CloudflareDnaOpenLabP5R2S3ListDriver;
}>;

function bindingError(message: string): never {
  throw new Error(`DNA Open Lab P5 R2 S3 list binding: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_PATTERN.test(normalized)
  ) {
    bindingError(`${field} is invalid`);
  }
  return normalized;
}

function count(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    bindingError(`${field} is invalid`);
  }
  return value;
}

function metadata(
  head: HeadedObject,
): Readonly<Record<string, string | undefined>> {
  return Object.freeze({
    ...(head.contentType === undefined
      ? {}
      : { contentType: head.contentType }),
    ...(head.cacheControl === undefined
      ? {}
      : { cacheControl: head.cacheControl }),
    ...(head.contentDisposition === undefined
      ? {}
      : { contentDisposition: head.contentDisposition }),
    ...(head.contentEncoding === undefined
      ? {}
      : { contentEncoding: head.contentEncoding }),
    ...(head.contentLanguage === undefined
      ? {}
      : { contentLanguage: head.contentLanguage }),
  });
}

function defaultDriver(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): CloudflareDnaOpenLabP5R2S3ListDriver {
  const client = new S3Client({
    region: "auto",
    endpoint: input.endpoint,
    forcePathStyle: true,
    credentials: {
      accessKeyId: input.accessKeyId,
      secretAccessKey: input.secretAccessKey,
    },
  });
  return Object.freeze({
    async list(request) {
      const result = await client.send(
        new ListObjectsV2Command({
          Bucket: request.bucketName,
          Prefix: request.prefix,
          ...(request.cursor === undefined
            ? {}
            : { ContinuationToken: request.cursor }),
          MaxKeys: request.limit,
        }),
      );
      const objects = (result.Contents ?? []).map((object) => ({
        key: object.Key ?? "",
        etag: object.ETag ?? "",
        size: object.Size ?? Number.NaN,
      }));
      return Object.freeze({
        objects: Object.freeze(objects),
        truncated: result.IsTruncated === true,
        ...(result.NextContinuationToken === undefined
          ? {}
          : { cursor: result.NextContinuationToken }),
      });
    },
    async head(request) {
      const result = await client.send(
        new HeadObjectCommand({
          Bucket: request.bucketName,
          Key: request.key,
        }),
      );
      return Object.freeze({
        ...(result.VersionId === undefined
          ? {}
          : { versionId: result.VersionId }),
        ...(result.ContentType === undefined
          ? {}
          : { contentType: result.ContentType }),
        ...(result.CacheControl === undefined
          ? {}
          : { cacheControl: result.CacheControl }),
        ...(result.ContentDisposition === undefined
          ? {}
          : { contentDisposition: result.ContentDisposition }),
        ...(result.ContentEncoding === undefined
          ? {}
          : { contentEncoding: result.ContentEncoding }),
        ...(result.ContentLanguage === undefined
          ? {}
          : { contentLanguage: result.ContentLanguage }),
        ...(result.Metadata === undefined ? {} : { metadata: result.Metadata }),
      });
    },
  });
}

/**
 * Adapts the private R2 S3 API to the existing owner-prefix footprint port.
 * Provider failures are reduced to one stable error and raw object identities
 * remain inside the downstream hash-reduction boundary.
 */
export function createCloudflareDnaOpenLabP5R2S3ListBinding(
  configuration: CloudflareDnaOpenLabP5R2S3ListBindingConfiguration,
): DnaOpenLabP5R2ListBinding {
  const accountId = configuration.accountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) {
    bindingError("accountId is invalid");
  }
  const accessKeyId = safeText(configuration.accessKeyId, "accessKeyId", 4_096);
  const secretAccessKey = safeText(
    configuration.secretAccessKey,
    "secretAccessKey",
    4_096,
  );
  const bucketName = safeText(configuration.bucketName, "bucketName", 255);
  const endpoint = `https://${accountId}.r2.cloudflarestorage.com`;
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint,
    accessKeyId,
    secretAccessKey,
  });

  return Object.freeze({
    async list(input) {
      const prefix = safeText(input.prefix, "prefix", 1_024);
      const cursor =
        input.cursor === undefined
          ? undefined
          : safeText(input.cursor, "cursor", 4_096);
      if (
        !Number.isSafeInteger(input.limit) ||
        input.limit < 1 ||
        input.limit > MAXIMUM_PAGE_LIMIT
      ) {
        bindingError("limit is invalid");
      }
      let page: Awaited<
        ReturnType<CloudflareDnaOpenLabP5R2S3ListDriver["list"]>
      >;
      try {
        page = await driver.list({
          bucketName,
          prefix,
          ...(cursor === undefined ? {} : { cursor }),
          limit: input.limit,
        });
      } catch {
        return bindingError("provider listing failed");
      }
      if (
        page === null ||
        typeof page !== "object" ||
        !Array.isArray(page.objects) ||
        typeof page.truncated !== "boolean" ||
        page.objects.length > input.limit ||
        (page.truncated && page.cursor === undefined) ||
        (!page.truncated && page.cursor !== undefined)
      ) {
        bindingError("provider response is invalid");
      }

      const objects = await Promise.all(
        page.objects.map(async (object) => {
          if (object === null || typeof object !== "object") {
            bindingError("provider object is invalid");
          }
          const key = safeText(object.key, "object key", 1_024);
          const etag = safeText(object.etag, "object etag", 512);
          if (!key.startsWith(prefix) || key.length === prefix.length) {
            bindingError("object escaped the requested prefix");
          }
          let head: HeadedObject;
          try {
            head = await driver.head({ bucketName, key });
          } catch {
            return bindingError("provider inspection failed");
          }
          return Object.freeze({
            key,
            version: safeText(
              head.versionId ?? `etag:${etag}`,
              "object version",
              512,
            ),
            etag,
            size: count(object.size, "object size"),
            httpMetadata: metadata(head),
            customMetadata: Object.freeze({ ...(head.metadata ?? {}) }),
          });
        }),
      );
      return Object.freeze({
        objects: Object.freeze(objects),
        truncated: page.truncated,
        ...(page.cursor === undefined ? {} : { cursor: page.cursor }),
      });
    },
  });
}
