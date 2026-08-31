import { createHash } from "node:crypto";

import {
  DeleteObjectsCommand,
  ListObjectsV2Command,
  S3Client,
} from "@aws-sdk/client-s3";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/u;
const MAXIMUM_OBJECTS = 10_000;
const PAGE_LIMIT = 1_000;

export type DnaOpenLabP5RecoveryR2SafetySnapshot = Readonly<{
  retainedEvidenceSha256: string;
  syntheticResidueObjectCount: number;
}>;

export type CloudflareDnaOpenLabP5RecoveryDriver = Readonly<{
  list: (input: {
    bucketName: string;
    prefix: string;
    cursor?: string;
    limit: number;
  }) => Promise<
    Readonly<{
      objects: readonly Readonly<{ key: string; etag: string; size: number }>[];
      truncated: boolean;
      cursor?: string;
    }>
  >;
  deleteMany: (input: {
    bucketName: string;
    keys: readonly string[];
  }) => Promise<void>;
}>;

export type CloudflareDnaOpenLabP5RecoverySafetyConfiguration = Readonly<{
  ownerId: string;
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
  createDriver?: (input: {
    endpoint: string;
    accessKeyId: string;
    secretAccessKey: string;
  }) => CloudflareDnaOpenLabP5RecoveryDriver;
}>;

function r2Error(message: string): never {
  throw new Error(`DNA Open Lab P5 R2 recovery safety port: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    /[\u0000-\u001f\u007f-\u009f]/u.test(normalized)
  ) {
    r2Error(`${field} is invalid`);
  }
  return normalized;
}

function objectSize(value: number): number {
  if (!Number.isSafeInteger(value) || value < 0)
    r2Error("provider response is invalid");
  return value;
}

function defaultDriver(input: {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
}): CloudflareDnaOpenLabP5RecoveryDriver {
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
      const response = await client.send(
        new ListObjectsV2Command({
          Bucket: request.bucketName,
          Prefix: request.prefix,
          MaxKeys: request.limit,
          ...(request.cursor === undefined
            ? {}
            : { ContinuationToken: request.cursor }),
        }),
      );
      return Object.freeze({
        objects: Object.freeze(
          (response.Contents ?? []).map((object) =>
            Object.freeze({
              key: object.Key ?? "",
              etag: object.ETag ?? "",
              size: object.Size ?? Number.NaN,
            }),
          ),
        ),
        truncated: response.IsTruncated === true,
        ...(response.NextContinuationToken === undefined
          ? {}
          : { cursor: response.NextContinuationToken }),
      });
    },
    async deleteMany(request) {
      if (request.keys.length === 0) return;
      const response = await client.send(
        new DeleteObjectsCommand({
          Bucket: request.bucketName,
          Delete: {
            Quiet: true,
            Objects: request.keys.map((Key) => ({ Key })),
          },
        }),
      );
      if ((response.Errors ?? []).length > 0) r2Error("cleanup failed");
    },
  });
}

function ownerHash(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

function retainedHash(identities: readonly string[]): string {
  return createHash("sha256")
    .update(
      `dna-open-lab-p5-r2-retained-evidence\u0000${JSON.stringify([...identities].sort())}`,
      "utf8",
    )
    .digest("hex");
}

/**
 * Inspects only the hashed owner prefix and permits cleanup only beneath the
 * fixed P5 recovery prefix. It never deletes retained evidence.
 */
export function createCloudflareDnaOpenLabP5RecoverySafetyPort(
  configuration: CloudflareDnaOpenLabP5RecoverySafetyConfiguration,
): Readonly<{
  inspect: () => Promise<DnaOpenLabP5RecoveryR2SafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}> {
  const ownerId = safeText(configuration.ownerId, "ownerId", 512);
  const accountId = configuration.accountId.trim().toLowerCase();
  if (!ACCOUNT_ID_PATTERN.test(accountId)) r2Error("accountId is invalid");
  const accessKeyId = safeText(configuration.accessKeyId, "accessKeyId", 4096);
  const secretAccessKey = safeText(
    configuration.secretAccessKey,
    "secretAccessKey",
    4096,
  );
  const bucketName = safeText(configuration.bucketName, "bucketName", 255);
  const driver = (configuration.createDriver ?? defaultDriver)({
    endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
    accessKeyId,
    secretAccessKey,
  });
  const ownerPrefix = `dna-open-lab/v1/${ownerHash(ownerId)}/`;
  const syntheticPrefix = `${ownerPrefix}p5-recovery/`;

  async function list(
    prefix: string,
  ): Promise<readonly Readonly<{ key: string; etag: string; size: number }>[]> {
    const objects: Readonly<{ key: string; etag: string; size: number }>[] = [];
    const keys = new Set<string>();
    const cursors = new Set<string>();
    let cursor: string | undefined;
    do {
      let page: Awaited<
        ReturnType<CloudflareDnaOpenLabP5RecoveryDriver["list"]>
      >;
      try {
        page = await driver.list({
          bucketName,
          prefix,
          limit: PAGE_LIMIT,
          ...(cursor === undefined ? {} : { cursor }),
        });
      } catch {
        return r2Error("inspection failed");
      }
      if (
        page === null ||
        typeof page !== "object" ||
        !Array.isArray(page.objects) ||
        typeof page.truncated !== "boolean" ||
        page.objects.length > PAGE_LIMIT ||
        (page.truncated && page.cursor === undefined) ||
        (!page.truncated && page.cursor !== undefined)
      ) {
        r2Error("provider response is invalid");
      }
      for (const candidate of page.objects) {
        const key = safeText(candidate.key, "object key", 1024);
        const etag = safeText(candidate.etag, "object etag", 512);
        if (!key.startsWith(prefix) || key.length === prefix.length) {
          r2Error("object escaped the requested prefix");
        }
        if (keys.has(key)) r2Error("provider response is invalid");
        keys.add(key);
        objects.push(
          Object.freeze({ key, etag, size: objectSize(candidate.size) }),
        );
        if (objects.length > MAXIMUM_OBJECTS) r2Error("object limit exceeded");
      }
      if (page.truncated) {
        const nextCursor = safeText(page.cursor ?? "", "cursor", 4096);
        if (cursors.has(nextCursor)) r2Error("provider response is invalid");
        cursors.add(nextCursor);
        cursor = nextCursor;
      } else {
        cursor = undefined;
      }
    } while (cursor !== undefined);
    return Object.freeze(objects);
  }

  async function inspect(): Promise<DnaOpenLabP5RecoveryR2SafetySnapshot> {
    const objects = await list(ownerPrefix);
    const synthetic = objects.filter((object) =>
      object.key.startsWith(syntheticPrefix),
    );
    const retained = objects
      .filter((object) => !object.key.startsWith(syntheticPrefix))
      .map((object) =>
        createHash("sha256")
          .update(
            `dna-open-lab-p5-r2-object\u0000${object.key}\u0000${object.etag}\u0000${object.size}`,
            "utf8",
          )
          .digest("hex"),
      );
    return Object.freeze({
      retainedEvidenceSha256: retainedHash(retained),
      syntheticResidueObjectCount: synthetic.length,
    });
  }

  async function cleanupSyntheticCase(): Promise<void> {
    const objects = await list(syntheticPrefix);
    try {
      for (let offset = 0; offset < objects.length; offset += PAGE_LIMIT) {
        await driver.deleteMany({
          bucketName,
          keys: objects
            .slice(offset, offset + PAGE_LIMIT)
            .map((object) => object.key),
        });
      }
    } catch {
      return r2Error("cleanup failed");
    }
    if ((await list(syntheticPrefix)).length !== 0)
      r2Error("cleanup left residue");
  }

  return Object.freeze({ inspect, cleanupSyntheticCase });
}
