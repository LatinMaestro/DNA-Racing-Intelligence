import { describe, expect, it, vi } from "vitest";

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
  const cleanup = vi.fn<
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
  it("stores bounded partitions and passes exact receipts into the database commit", async () => {
    const test = harness();
    await appendTwo(test.session);
    const commit = vi.fn(
      async (stored: readonly StoredPrivateDatasetEvidenceObject[]) => {
        test.order.push("commit");
        return { importBatchId, stored };
      },
    );

    const result = await test.session.commitWithEvidenceReceipts(commit);

    expect(result.importBatchId).toBe(importBatchId);
    expect(result.stored).toHaveLength(2);
    expect(
      result.stored.map(({ registration }) => registration.partitionNumber),
    ).toEqual([0, 1]);
    expect(test.order).toEqual(["store-0", "store-1", "commit"]);
    expect(test.cleanup).not.toHaveBeenCalled();
  });

  it("cleans newly created partitions when the database receipt commit fails", async () => {
    const test = harness();
    await appendTwo(test.session);
    const commitError = new Error("Neon receipt commit failed");

    await expect(
      test.session.commitWithEvidenceReceipts(async () => {
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
  });

  it("recovers earlier stored receipts when a later partition write fails", async () => {
    const test = harness();
    test.failAt(1);
    await appendTwo(test.session);

    await expect(
      test.session.commitWithEvidenceReceipts(async () => ({ importBatchId })),
    ).rejects.toThrow("R2 write interrupted");
    expect(test.cleanup).toHaveBeenCalledWith([
      expect.objectContaining({
        registration: expect.objectContaining({ partitionNumber: 0 }),
      }),
    ]);
  });

  it("does not clean evidence after the receipt commit completes", async () => {
    const test = harness();
    await appendTwo(test.session);

    await test.session.commitWithEvidenceReceipts(async () => ({
      importBatchId,
    }));
    await test.session.abort();

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
    await test.session.commitWithEvidenceReceipts(async () => ({
      importBatchId,
    }));

    await expect(
      test.session.commitWithEvidenceReceipts(async () => ({ importBatchId })),
    ).rejects.toThrow("already requested");
  });
});
