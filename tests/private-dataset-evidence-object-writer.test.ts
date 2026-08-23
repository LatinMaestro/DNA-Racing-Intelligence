import { describe, expect, it, vi } from "vitest";

import {
  createPrivateDatasetEvidenceObjectRecovery,
  createPrivateDatasetEvidenceObjectStorageWriter,
  createPrivateDatasetEvidenceObjectWriter,
  type PrivateDatasetEvidenceObjectDeletionPort,
} from "@/lib/private-dataset-evidence-object-writer";
import type {
  DatasetEvidenceObjectInspectionRepository,
  DatasetEvidenceObjectRepository,
} from "@/lib/neon-dataset-evidence-object-repository";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";
const evidenceObjectId = "22222222-2222-4222-8222-222222222222";
const checksumSha256 = "a".repeat(64);

async function* bytes() {
  yield new Uint8Array([1, 2, 3]);
}

function harness() {
  let storageStatus: "created" | "existing" = "created";
  let stored:
    | Parameters<
        PrivateDatasetEvidenceObjectDeletionPort["putObjectIfAbsent"]
      >[0]
    | undefined;
  const readBucketPrivacy = vi.fn(async () => ({
    publicAccessDisabled: true,
    r2DevDisabled: true,
    customDomainCount: 0,
  }));
  const putObjectIfAbsent = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["putObjectIfAbsent"]
  >(async (input) => {
    stored = input;
    return { status: storageStatus };
  });
  const headObject = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["headObject"]
  >(async () =>
    stored === undefined
      ? { status: "missing" }
      : {
          status: "ready",
          contentType: stored.contentType,
          byteLength: stored.byteLength,
          checksumSha256: stored.checksumSha256,
          metadata: stored.metadata,
        },
  );
  const deleteObject = vi.fn<
    PrivateDatasetEvidenceObjectDeletionPort["deleteObject"]
  >(async () => {
    stored = undefined;
    return { status: "deleted" };
  });
  const port: PrivateDatasetEvidenceObjectDeletionPort = {
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
    deleteObject,
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
  const inspect = vi.fn<DatasetEvidenceObjectInspectionRepository["inspect"]>();
  inspect.mockResolvedValue({ status: "missing" });
  const inspectionRepository: DatasetEvidenceObjectInspectionRepository = {
    inspect,
  };
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
    port,
    createPort,
    readBucketPrivacy,
    putObjectIfAbsent,
    headObject,
    deleteObject,
    register,
    inspect,
    inspectionRepository,
    setStorageStatus(status: "created" | "existing") {
      storageStatus = status;
    },
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
    test.setStorageStatus("existing");
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

  it("can defer manifest registration until the import batch commits", async () => {
    const test = harness();
    const storageWriter = createPrivateDatasetEvidenceObjectStorageWriter({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => test.port,
    });

    const stored = await storageWriter.store(writeInput());

    expect(stored).toEqual({
      registration: expect.objectContaining({
        ownerId,
        importBatchId,
        objectKey: expect.stringMatching(/part-0000\.parquet$/),
        checksumSha256,
      }),
      storageStatus: "created",
    });
    expect(test.register).not.toHaveBeenCalled();

    await expect(test.register(stored.registration)).resolves.toEqual({
      status: "created",
      evidenceObjectId,
    });
  });

  it("initializes the provider and private-bucket check only once", async () => {
    const test = harness();
    await test.writer.write(writeInput());
    await test.writer.write({
      ...writeInput(),
      partitionNumber: 1,
      body: bytes(),
    });
    expect(test.createPort).toHaveBeenCalledOnce();
    expect(test.readBucketPrivacy).toHaveBeenCalledOnce();
  });

  it("deletes only newly created objects with no durable manifest", async () => {
    const test = harness();
    const storageWriter = createPrivateDatasetEvidenceObjectStorageWriter({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => test.port,
    });
    const stored = await storageWriter.store(writeInput());
    const recovery = createPrivateDatasetEvidenceObjectRecovery({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => test.port,
      inspectionRepository: test.inspectionRepository,
    });

    await expect(recovery.cleanup([stored])).resolves.toEqual([
      {
        objectKey: stored.registration.objectKey,
        status: "deleted",
      },
    ]);
    expect(test.inspect).toHaveBeenCalledWith(stored.registration);
    expect(test.deleteObject).toHaveBeenCalledOnce();
    await expect(recovery.cleanup([stored])).resolves.toEqual([
      {
        objectKey: stored.registration.objectKey,
        status: "missing",
      },
    ]);
    expect(test.deleteObject).toHaveBeenCalledOnce();
  });

  it("retains exact durable manifests and blocks conflicts before R2 access", async () => {
    const exact = harness();
    exact.inspect.mockResolvedValueOnce({ status: "exact" });
    const recovery = createPrivateDatasetEvidenceObjectRecovery({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => exact.port,
      inspectionRepository: exact.inspectionRepository,
    });
    const storageWriter = createPrivateDatasetEvidenceObjectStorageWriter({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => exact.port,
    });
    const stored = await storageWriter.store(writeInput());

    await expect(recovery.cleanup([stored])).resolves.toEqual([
      {
        objectKey: stored.registration.objectKey,
        status: "retained_registered",
      },
    ]);
    expect(exact.deleteObject).not.toHaveBeenCalled();

    const conflict = harness();
    conflict.inspect.mockResolvedValueOnce({ status: "conflict" });
    const blocked = createPrivateDatasetEvidenceObjectRecovery({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => conflict.port,
      inspectionRepository: conflict.inspectionRepository,
    });
    await expect(blocked.cleanup([stored])).rejects.toThrow(
      "Conflicting evidence manifest",
    );
    expect(conflict.createPort).not.toHaveBeenCalled();
    expect(conflict.deleteObject).not.toHaveBeenCalled();
  });

  it("rejects replayed or non-owner-derived cleanup receipts", async () => {
    const test = harness();
    const recovery = createPrivateDatasetEvidenceObjectRecovery({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => test.port,
      inspectionRepository: test.inspectionRepository,
    });
    const storageWriter = createPrivateDatasetEvidenceObjectStorageWriter({
      ownerId,
      bucketName: "dna-private-preview",
      maximumObjectBytes: 64,
      createPort: async () => test.port,
    });
    const stored = await storageWriter.store(writeInput());

    await expect(
      recovery.cleanup([{ ...stored, storageStatus: "existing" }]),
    ).rejects.toThrow("newly created");
    await expect(
      recovery.cleanup([
        {
          ...stored,
          registration: {
            ...stored.registration,
            objectKey: "evidence/other/part-0000.parquet",
          },
        },
      ]),
    ).rejects.toThrow("not owner-derived");
    expect(test.inspect).not.toHaveBeenCalled();
    expect(test.deleteObject).not.toHaveBeenCalled();
  });
});
