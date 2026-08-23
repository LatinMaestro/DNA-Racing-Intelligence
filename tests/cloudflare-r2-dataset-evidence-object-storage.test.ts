import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareR2DatasetEvidenceObjectStorage,
  type CloudflareR2DatasetEvidenceDriver,
} from "@/lib/cloudflare-r2-dataset-evidence-object-storage";

const accountId = "a".repeat(32);
const bucketName = "dna-racing-import-preview";
const ownerId = "user_private_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";

function bytes(value: string): Uint8Array {
  return new TextEncoder().encode(value);
}

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function* stream(...chunks: Uint8Array[]) {
  for (const chunk of chunks) yield chunk;
}

function harness(overrides: {
  privacy?: {
    publicAccessDisabled: boolean;
    r2DevDisabled: boolean;
    customDomainCount: number;
  };
  head?: CloudflareR2DatasetEvidenceDriver["headObject"];
  deleteFailure?: boolean;
} = {}) {
  let stored:
    | {
        key: string;
        byteSize: number;
        contentType: string;
        contentEncoding: string | null;
        metadata: Readonly<Record<string, string>>;
      }
    | undefined;
  const readBucketPrivacy = vi.fn(async () =>
    Promise.resolve(
      overrides.privacy ?? {
        publicAccessDisabled: true,
        r2DevDisabled: true,
        customDomainCount: 0,
      },
    ),
  );
  const putObject = vi.fn(
    async (input: Parameters<CloudflareR2DatasetEvidenceDriver["putObject"]>[0]) => {
      let consumed = 0;
      for await (const chunk of input.body) consumed += chunk.byteLength;
      expect(consumed).toBe(input.byteSize);
      stored = {
        key: input.key,
        byteSize: input.byteSize,
        contentType: input.contentType,
        contentEncoding: input.contentEncoding,
        metadata: input.metadata,
      };
    },
  );
  const defaultHead = vi.fn(async () => {
    if (stored === undefined) return { status: "missing" as const };
    return {
      status: "ready" as const,
      byteSize: stored.byteSize,
      contentType: stored.contentType,
      contentEncoding: stored.contentEncoding,
      metadata: stored.metadata,
    };
  });
  const headObject = vi.fn(overrides.head ?? defaultHead);
  const deleteObject = vi.fn(async () => {
    if (overrides.deleteFailure) throw new Error("synthetic delete failure");
    stored = undefined;
  });
  const driver: CloudflareR2DatasetEvidenceDriver = {
    readBucketPrivacy,
    putObject,
    headObject,
    deleteObject,
  };
  const createDriver = vi.fn(() => driver);
  const storage = createCloudflareR2DatasetEvidenceObjectStorage({
    accountId,
    bucketName,
    accessKeyId: "synthetic-access-key",
    secretAccessKey: "synthetic-secret-key",
    apiToken: "synthetic-api-token",
    createDriver,
  });
  return {
    storage,
    readBucketPrivacy,
    putObject,
    headObject,
    deleteObject,
  };
}

function validWrite(body = bytes("alpha\nbeta\n")) {
  return {
    ownerId,
    importBatchId,
    objectKind: "normalized_partition" as const,
    partitionNumber: 7,
    objectFormat: "parquet" as const,
    checksumSha256: sha256(body),
    byteSize: body.byteLength,
    body: stream(body),
  };
}

describe("Cloudflare R2 dataset evidence object storage", () => {
  it("streams, verifies and returns an opaque owner-scoped object key", async () => {
    const test = harness();
    const written = await test.storage.writeVerifiedObject(validWrite());

    expect(written).toMatchObject({
      checksumSha256: validWrite().checksumSha256,
      byteSize: validWrite().byteSize,
      objectFormat: "parquet",
    });
    expect(written.objectKey).toMatch(
      /^evidence\/[a-f0-9]{64}\/11111111-1111-4111-8111-111111111111\/normalized_partition\/part-0007\.parquet$/,
    );
    expect(written.objectKey).not.toContain(ownerId);
    expect(test.readBucketPrivacy).toHaveBeenCalledTimes(1);
    expect(test.putObject).toHaveBeenCalledTimes(1);
    expect(test.headObject).toHaveBeenCalledTimes(1);
    expect(test.deleteObject).not.toHaveBeenCalled();
  });

  it("verifies bucket privacy once across multiple writes", async () => {
    const test = harness();
    await test.storage.writeVerifiedObject(validWrite(bytes("one")));
    await test.storage.writeVerifiedObject({
      ...validWrite(bytes("two")),
      partitionNumber: 8,
    });
    expect(test.readBucketPrivacy).toHaveBeenCalledTimes(1);
  });

  it("deletes the object when streamed checksum evidence disagrees", async () => {
    const test = harness();
    const input = validWrite(bytes("actual"));
    await expect(
      test.storage.writeVerifiedObject({
        ...input,
        checksumSha256: sha256(bytes("different")),
      }),
    ).rejects.toThrow("stream checksum does not reconcile");
    expect(test.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("deletes the object when provider metadata cannot be verified", async () => {
    const test = harness({
      head: async () => ({
        status: "ready",
        byteSize: bytes("alpha\nbeta\n").byteLength,
        contentType: "application/octet-stream",
        contentEncoding: null,
        metadata: {},
      }),
    });
    await expect(test.storage.writeVerifiedObject(validWrite())).rejects.toThrow(
      "provider verification failed",
    );
    expect(test.deleteObject).toHaveBeenCalledTimes(1);
  });

  it("fails closed before upload when the R2 bucket is public", async () => {
    const test = harness({
      privacy: {
        publicAccessDisabled: false,
        r2DevDisabled: false,
        customDomainCount: 1,
      },
    });
    await expect(test.storage.writeVerifiedObject(validWrite())).rejects.toThrow(
      "private evidence bucket verification failed",
    );
    expect(test.putObject).not.toHaveBeenCalled();
    expect(test.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects malformed authority before touching the provider", async () => {
    const test = harness();
    for (const malformed of [
      { importBatchId: "not-a-uuid" },
      { partitionNumber: 10_000 },
      { checksumSha256: "bad" },
      { byteSize: 0 },
      { ownerId: "owner\ninvalid" },
    ]) {
      await expect(
        test.storage.writeVerifiedObject({ ...validWrite(), ...malformed }),
      ).rejects.toThrow();
    }
    expect(test.readBucketPrivacy).not.toHaveBeenCalled();
    expect(test.putObject).not.toHaveBeenCalled();
  });

  it("surfaces cleanup failure instead of hiding possible residue", async () => {
    const test = harness({ deleteFailure: true });
    const input = validWrite(bytes("actual"));
    await expect(
      test.storage.writeVerifiedObject({
        ...input,
        checksumSha256: sha256(bytes("different")),
      }),
    ).rejects.toThrow("cleanup failed after write failure");
  });
});
