import { createHash } from "node:crypto";

import type { DnaOpenLabP5R2FootprintPort } from "./dna-open-lab-p5-capacity-measurement-runner";

const CONTROL_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const MAXIMUM_PAGE_LIMIT = 1_000;

export type DnaOpenLabP5R2ListedObject = Readonly<{
  key: string;
  version: string;
  etag: string;
  size: number;
  httpMetadata?: Readonly<Record<string, string | Date | undefined>>;
  customMetadata?: Readonly<Record<string, string | undefined>>;
}>;

export type DnaOpenLabP5R2ListBinding = Readonly<{
  list: (input: {
    prefix: string;
    cursor?: string;
    limit: number;
    include: readonly ["httpMetadata", "customMetadata"];
  }) => Promise<
    Readonly<{
      objects: readonly DnaOpenLabP5R2ListedObject[];
      truncated: boolean;
      cursor?: string;
    }>
  >;
}>;

export type CloudflareDnaOpenLabP5R2FootprintPortConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  bucket: DnaOpenLabP5R2ListBinding;
  readBucketPrivacy: (input: { bucketName: string }) => Promise<
    Readonly<{
      publicAccessDisabled: boolean;
      r2DevDisabled: boolean;
      customDomainCount: number;
    }>
  >;
}>;

function footprintError(message: string): never {
  throw new Error(`DNA Open Lab P5 R2 footprint port: ${message}`);
}

function safeText(value: string, field: string, maximum: number): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximum ||
    CONTROL_PATTERN.test(normalized)
  ) {
    footprintError(`${field} is invalid`);
  }
  return normalized;
}

function byteCount(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    footprintError(`${field} is invalid`);
  }
  return value;
}

function ownerPrefix(ownerId: string): string {
  return createHash("sha256")
    .update(`dna-open-lab-owner\u0000${ownerId}`, "utf8")
    .digest("hex");
}

function metadataBytes(
  object: Pick<DnaOpenLabP5R2ListedObject, "httpMetadata" | "customMetadata">,
): number {
  let total = 0;
  for (const metadata of [object.httpMetadata, object.customMetadata]) {
    if (metadata === undefined) continue;
    for (const [key, rawValue] of Object.entries(metadata)) {
      if (rawValue === undefined) continue;
      const value = rawValue instanceof Date ? rawValue.toJSON() : rawValue;
      if (
        key.length < 1 ||
        CONTROL_PATTERN.test(key) ||
        value === null ||
        value.length < 1 ||
        CONTROL_PATTERN.test(value)
      ) {
        footprintError("object metadata is invalid");
      }
      total +=
        Buffer.byteLength(key, "utf8") + Buffer.byteLength(value, "utf8");
      if (!Number.isSafeInteger(total)) {
        footprintError("object metadata bytes exceed safe integer range");
      }
    }
  }
  return total;
}

/**
 * Adapts a private, owner-prefix-confined R2 binding to the capacity runner.
 * Raw object keys and metadata are reduced to a content-independent identity
 * hash and byte counts before leaving this boundary.
 */
export function createCloudflareDnaOpenLabP5R2FootprintPort(
  configuration: CloudflareDnaOpenLabP5R2FootprintPortConfiguration,
): DnaOpenLabP5R2FootprintPort {
  const ownerId = safeText(configuration.ownerId, "ownerId", 512);
  const bucketName = safeText(configuration.bucketName, "bucketName", 255);
  if (
    configuration.bucket === null ||
    typeof configuration.bucket !== "object"
  ) {
    footprintError("bucket binding is invalid");
  }
  const prefix = `dna-open-lab/v1/${ownerPrefix(ownerId)}/`;

  return Object.freeze({
    readBucketPrivacy: async () => {
      try {
        return await configuration.readBucketPrivacy({ bucketName });
      } catch {
        return footprintError("privacy verification failed");
      }
    },
    listRetainedObjects: async ({ cursor, limit }) => {
      if (
        !Number.isSafeInteger(limit) ||
        limit < 1 ||
        limit > MAXIMUM_PAGE_LIMIT
      ) {
        footprintError("page limit is invalid");
      }
      const normalizedCursor =
        cursor === null ? undefined : safeText(cursor, "cursor", 4_096);
      let page: Awaited<ReturnType<DnaOpenLabP5R2ListBinding["list"]>>;
      try {
        page = await configuration.bucket.list({
          prefix,
          ...(normalizedCursor === undefined
            ? {}
            : { cursor: normalizedCursor }),
          limit,
          include: ["httpMetadata", "customMetadata"],
        });
      } catch {
        return footprintError("listing failed");
      }
      if (
        page === null ||
        typeof page !== "object" ||
        !Array.isArray(page.objects) ||
        typeof page.truncated !== "boolean" ||
        page.objects.length > limit
      ) {
        footprintError("provider response is invalid");
      }
      const objects = page.objects.map((object) => {
        const key = safeText(object.key, "object key", 1_024);
        if (!key.startsWith(prefix) || key.length === prefix.length) {
          footprintError("object escaped the owner prefix");
        }
        const version = safeText(object.version, "object version", 512);
        const etag = safeText(object.etag, "object etag", 512);
        return Object.freeze({
          objectIdentitySha256: createHash("sha256")
            .update(
              `dna-open-lab-p5-r2-object\u0000${key}\u0000${version}\u0000${etag}`,
              "utf8",
            )
            .digest("hex"),
          payloadBytes: byteCount(object.size, "object size"),
          metadataBytes: metadataBytes(object),
        });
      });
      let nextCursor: string | null = null;
      if (page.truncated) {
        nextCursor = safeText(page.cursor ?? "", "next cursor", 4_096);
      } else if (page.cursor !== undefined) {
        footprintError("provider returned a cursor for a complete page");
      }
      return Object.freeze({ objects: Object.freeze(objects), nextCursor });
    },
  });
}
