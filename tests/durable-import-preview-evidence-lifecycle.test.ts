import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceManifestRegistrationService } from "@/lib/dataset-evidence-manifest-registration-service";
import {
  createDurableImportPreviewEvidenceLifecycle,
  type DurableImportPreviewEvidenceSession,
} from "@/lib/durable-import-preview-evidence-lifecycle";
import type { DurablePreviewStagedRow } from "@/lib/durable-import-preview-staging-sink";
import type {
  PrivateDatasetEvidenceObjectRecoveryReceipt,
  PrivateDatasetEvidenceObjectStorageWriter,
  StoredPrivateDatasetEvidenceObject,
} from "@/lib/private-dataset-evidence-object-writer";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";
const evidenceObjectId = "22222222-2222-4222-8222-222222222222";

function row(index: number): DurablePreviewStagedRow {
  return {
    sourceRowNumber: index,
    naturalKey: `event-${index}:core-${index}`,
    fingerprintSha256: "a".repeat(64),
    row: {
      status: "quarantined",
      sourceType: "race_merge",
      record: null,
      provenance: [],
      issues: [],
    },
  };
}

function harness() {
  const order: string[] = [];
  let failPartition: number | null = null;
  const store = vi.fn<PrivateDatasetEvidenceObjectStorageWriter["store"]>(
    async (write) => {
      order.push(`store-${write.partitionNumber}`);
      if (write.partitionNumber === failPartition) {
        throw new Error("R2 write interrupted");
      }
      return {
        registration: {
          ownerId: write.ownerId,
          importBatchId: write.importBatchId,
          sourceType: write.sourceType,
          objectKind: write.objectKind,
          partitionNumber: write.partitionNumber,
          objectFormat: write.objectFormat,
          objectKey: `evidence/part-${write.partitionNumber}.ndjson.gz`,
          checksumSha256: write.checksumSha256,
          byteSize: write.byteSize,
          rowCount: write.rowCount,
          firstNaturalKey: write.firstNaturalKey,
          lastNaturalKey: write.lastNaturalKey,
          createdAt: write.createdAt,
        },
        storageStatus: "created" as const,
      };
    },
  );
  const validate =
    vi.fn<DatasetEvidenceManifestRegistrationService["validate"]>(() => {
      order.push("validate");
    });
  const register =
    vi.fn<DatasetEvidenceManifestRegistrationService["register"]>(
      async (stored) => {
        order.push("register");
        return stored.map((object) => ({
          evidenceObjectId,
          objectKey: object.registration.objectKey,
          status: "created" as const,
          storageStatus: object.storageStatus,
        }));
      },
    );
  const cleanup =
    vi.fn<
      (
        stored: readonly StoredPrivateDatasetEvidenceObject[],
      ) => Promise<readonly PrivateDatasetEvidenceObjectRecoveryReceipt[]>
    >(async (stored) => {
      order.push("cleanup");
      return stored.map((object) => ({
        objectKey: object.registration.objectKey,
        status: "deleted" as const,
      }));
    });
  const lifecycle = createDurableImportPreviewEvidenceLifecycle({
    ownerId,
    storageWriter: { store },
    registrationService: { validate, register },
    recovery: { cleanup },
    maximumUncompressedBytes: 1024,
    maximumRowsPerPartition: 1,
    now: () => new Date("2026-08-23T10:00:00.000Z"),
  });
  const session = lifecycle.beginObject({
    ownerId,
    importBatchId,
    sourceFamily: "race_merge",
  });
  return {
    lifecycle,
    session,
    order,
    store,
    validate,
    register,
    cleanup,
    failAt(partition: number) {
      failPartition = partition;
    },
  };
}

async function appendTwo(session: DurableImportPreviewEvidenceSession) {
  await session.append([row(1), row(2)]);
}

describe("durable import Preview evidence lifecycle", () => {
  it("stores bounded partitions, commits, then registers manifests", async () => {
    const test = harness();
    await appendTwo(test.session);

    await expect(
      test.session.commitAndRegister(async () => {
        test.order.push("commit");
        return { importBatchId };
      }),
    ).resolves.toEqual({ importBatchId });

    expect(test.order).toEqual([
      "store-0",
      "store-1",
      "validate",
      "commit",
      "register",
    ]);
    expect(test.cleanup).not.toHaveBeenCalled();
  });

  it("cleans newly created partitions when the database commit fails", async () => {
    const test = harness();
    await appendTwo(test.session);
    const commitError = new Error("Neon commit failed");

    await expect(
      test.session.commitAndRegister(async () => {
        throw commitError;
      }),
    ).rejects.toBe(commitError);
    expect(test.cleanup).toHaveBeenCalledWith([
      expect.objectContaining({
        registration: expect.objectContaining({ partitionNumber: 0 }),
      }),
      expect.objectContaining({
        registration: expect.objectContaining({ partitionNumber: 1 }),
      }),
    ]);
    expect(test.register).not.toHaveBeenCalled();
  });

  it("recovers earlier receipts when a later partition write fails", async () => {
    const test = harness();
    test.failAt(1);
    await appendTwo(test.session);

    await expect(
      test.session.commitAndRegister(async () => ({ importBatchId })),
    ).rejects.toThrow("R2 write interrupted");
    expect(test.cleanup).toHaveBeenCalledWith([
      expect.objectContaining({
        registration: expect.objectContaining({ partitionNumber: 0 }),
      }),
    ]);
    expect(test.register).not.toHaveBeenCalled();
  });

  it("preserves every object after commit when registration is interrupted", async () => {
    const test = harness();
    await appendTwo(test.session);
    test.register.mockRejectedValueOnce(
      new Error("manifest registration interrupted"),
    );

    await expect(
      test.session.commitAndRegister(async () => {
        test.order.push("commit");
        return { importBatchId };
      }),
    ).rejects.toThrow("manifest registration interrupted");
    await test.session.abort();

    expect(test.order).toContain("commit");
    expect(test.cleanup).not.toHaveBeenCalled();
  });

  it("aborts without flushing the buffered final partition", async () => {
    const test = harness();
    await appendTwo(test.session);

    await test.session.abort();

    expect(test.store).toHaveBeenCalledOnce();
    expect(test.cleanup).toHaveBeenCalledWith([
      expect.objectContaining({
        registration: expect.objectContaining({ partitionNumber: 0 }),
      }),
    ]);
    expect(test.register).not.toHaveBeenCalled();
  });

  it("blocks another owner before storing any evidence", () => {
    const test = harness();

    expect(() =>
      test.lifecycle.beginObject({
        ownerId: "other_owner",
        importBatchId,
        sourceFamily: "race_merge",
      }),
    ).toThrow("access denied");
    expect(test.store).not.toHaveBeenCalled();
  });

  it("rejects a second commit request", async () => {
    const test = harness();
    await test.session.append([row(1)]);
    await test.session.commitAndRegister(async () => ({ importBatchId }));

    await expect(
      test.session.commitAndRegister(async () => ({ importBatchId })),
    ).rejects.toThrow("already requested");
  });
});
