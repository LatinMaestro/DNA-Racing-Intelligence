import { describe, expect, it, vi } from "vitest";

import {
  createPrivateDatasetEvidenceObjectWriter,
  type PrivateDatasetEvidenceObjectStoragePort,
} from "@/lib/private-dataset-evidence-object-writer";
import type { DatasetEvidenceObjectRepository } from "@/lib/neon-dataset-evidence-object-repository";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";
const evidenceObjectId = "22222222-2222-4222-8222-222222222222";
const checksumSha256 = "a".repeat(64);

async function* bytes() {
  yield new Uint8Array([1, 2, 3]);
}

function harness() {
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const putObjectIfAbsent =
    vi.fn<PrivateDatasetEvidenceObjectStoragePort["putObjectIfAbsent"]>();
  putObjectIfAbsent.mockResolvedValue({ status: "created" });
  const headObject = vi.fn(
    async (): Promise<
      Awaited<ReturnType<PrivateDatasetEvidenceObjectStoragePort["headObject"]>>
    > => ({
      status: "ready",
      contentType: "application/vnd.apache.parquet",
      byteLength: 3,
      checksumSha256,
      metadata: {
        rows: "1",
        source: "race_merge",
        kind: "normalized_partition",
        partition: "0",
      },
    }),
  );
  const port: PrivateDatasetEvidenceObjectStoragePort = {
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
  };
  const register =
    vi.fn<
      Extract<
        DatasetEvidenceObjectRepository,
        Readonly<{ status: "ready" }>
      >["register"]
    >();
  register.mockResolvedValue({ status: "created", evidenceObjectId });
  const repository = {
    status: "ready" as const,
    register,
  } satisfies DatasetEvidenceObjectRepository;
  const createPort = vi.fn(async () => port);
  const writer = createPrivateDatasetEvidenceObjectWriter({
    ownerId,
    bucketName: "dna-private-preview",
    maximumObjectBytes: 64,
    createPort,
    repository,
  });
  return {
    writer,
    createPort,
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
    register,
  };
}

function writeInput() {
  return {
    ownerId,
    importBatchId,
    sourceType: "race_merge" as const,
    objectKind: "normalized_partition" as const,
    partitionNumber: 0,
    objectFormat: "parquet" as const,
    body: bytes(),
    byteSize: 3,
    rowCount: 1,
    checksumSha256,
    firstNaturalKey: "event-1:core-1",
    lastNaturalKey: "event-1:core-1",
    createdAt: "2026-08-23T07:00:00.000Z",
  };
}

describe("private dataset evidence object writer", () => {
  it("writes, verifies and registers an immutable owner-scoped object", async () => {
    const test = harness();
    const input = writeInput();
    await expect(test.writer.write(input)).resolves.toEqual({
      status: "created",
      evidenceObjectId,
      objectKey: expect.stringMatching(
        /^evidence\/[a-f0-9]{64}\/11111111-1111-4111-8111-111111111111\/race_merge\/normalized_partition\/part-0000\.parquet$/,
      ),
      storageStatus: "created",
    });
    const stored = test.putObjectIfAbsent.mock.calls[0]?.[0];
    expect(stored).toMatchObject({
      bucketName: "dna-private-preview",
      contentType: "application/vnd.apache.parquet",
      byteLength: 3,
      checksumSha256,
      metadata: {
        rows: "1",
        source: "race_merge",
        kind: "normalized_partition",
        partition: "0",
      },
    });
    expect(stored?.body).toBe(input.body);
    expect(test.register).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId,
        importBatchId,
        objectKey: stored?.key,
        checksumSha256,
        byteSize: 3,
        rowCount: 1,
      }),
    );
    expect(test.readBucketPrivacy).toHaveBeenCalledOnce();
  });

  it("supports exact storage and manifest replay", async () => {
    const test = harness();
    test.putObjectIfAbsent.mockResolvedValueOnce({ status: "existing" });
    test.register.mockResolvedValueOnce({
      status: "existing",
      evidenceObjectId,
    });
    await expect(test.writer.write(writeInput())).resolves.toMatchObject({
      status: "existing",
      storageStatus: "existing",
      evidenceObjectId,
    });
  });

  it("never registers missing or mismatched provider evidence", async () => {
    for (const evidence of [
      { status: "missing" as const },
      {
        status: "ready" as const,
        contentType: "application/vnd.apache.parquet",
        byteLength: 4,
        checksumSha256,
        metadata: {
          rows: "1",
          source: "race_merge",
          kind: "normalized_partition",
          partition: "0",
        },
      },
      {
        status: "ready" as const,
        contentType: "application/vnd.apache.parquet",
        byteLength: 3,
        checksumSha256: "b".repeat(64),
        metadata: {
          rows: "1",
          source: "race_merge",
          kind: "normalized_partition",
          partition: "0",
        },
      },
    ]) {
      const test = harness();
      test.headObject.mockResolvedValueOnce(evidence);
      await expect(test.writer.write(writeInput())).rejects.toThrow(
        "exact verification",
      );
      expect(test.register).not.toHaveBeenCalled();
    }
  });

  it("blocks a non-private bucket before writing", async () => {
    const test = harness();
    test.readBucketPrivacy.mockResolvedValueOnce({
      publicAccessDisabled: false,
      r2DevDisabled: true,
      customDomainCount: 0,
    });
    await expect(test.writer.write(writeInput())).rejects.toThrow(
      "not private",
    );
    expect(test.putObjectIfAbsent).not.toHaveBeenCalled();
  });

  it("fails before provider initialization on unsafe authority", async () => {
    for (const malformed of [
      { ownerId: "other_owner" },
      { importBatchId: "not-a-uuid" },
      { partitionNumber: -1 },
      { partitionNumber: 10_000 },
      { byteSize: 65 },
      { rowCount: 0 },
      { checksumSha256: "not-a-checksum" },
      { firstNaturalKey: "first", lastNaturalKey: null },
      { createdAt: "not-a-timestamp" },
    ]) {
      const test = harness();
      await expect(
        test.writer.write({ ...writeInput(), ...malformed }),
      ).rejects.toThrow();
      expect(test.createPort).not.toHaveBeenCalled();
    }
  });

  it("initializes the provider and private-bucket check only once", async () => {
    const test = harness();
    await test.writer.write(writeInput());
    test.headObject.mockResolvedValueOnce({
      status: "ready",
      contentType: "application/vnd.apache.parquet",
      byteLength: 3,
      checksumSha256,
      metadata: {
        rows: "1",
        source: "race_merge",
        kind: "normalized_partition",
        partition: "1",
      },
    });
    await test.writer.write({
      ...writeInput(),
      partitionNumber: 1,
      body: bytes(),
    });
    expect(test.createPort).toHaveBeenCalledOnce();
    expect(test.readBucketPrivacy).toHaveBeenCalledOnce();
  });
});
