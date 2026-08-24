import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";
import type { SealedRaceArchiveManifestRepository } from "@/lib/neon-sealed-race-archive-manifest-repository";
import type { PrivateDatasetEvidenceObjectReader } from "@/lib/private-dataset-evidence-object-reader";
import { createSealedRaceArchiveReader } from "@/lib/sealed-race-archive-reader";

const ownerId = "user_owner";
const datasetVersionId = "11111111-1111-4111-8111-111111111111";
const importBatchId = "22222222-2222-4222-8222-222222222222";

function registration(
  partitionNumber: number,
  overrides: Partial<DatasetEvidenceObjectRegistration> = {},
): DatasetEvidenceObjectRegistration {
  return {
    ownerId,
    importBatchId,
    sourceType: "race_merge",
    objectKind: "staged_rows",
    partitionNumber,
    objectFormat: "ndjson_gzip",
    objectKey: `evidence/private/${importBatchId}/race_merge/staged_rows/part-${String(
      partitionNumber,
    ).padStart(4, "0")}.ndjson.gz`,
    checksumSha256: String(partitionNumber + 1)
      .repeat(64)
      .slice(0, 64),
    byteSize: 100 + partitionNumber,
    rowCount: 1,
    firstNaturalKey: `event-${partitionNumber}:core-1`,
    lastNaturalKey: `event-${partitionNumber}:core-1`,
    createdAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function body(partitionNumber: number): Uint8Array {
  return gzipSync(
    `${JSON.stringify({
      naturalKey: `event-${partitionNumber}:core-1`,
      value: { sourceRowNumber: partitionNumber + 1 },
    })}\n`,
  );
}

function harness(input: {
  objects: readonly DatasetEvidenceObjectRegistration[];
  maximumSelectedPartitions?: number;
}) {
  const manifest = {
    datasetVersionId,
    importBatchId,
    sourceType: "race_merge" as const,
    evidenceKind: "staged_rows" as const,
    partitionCount: input.objects.length,
    rowCount: input.objects.reduce((sum, object) => sum + object.rowCount, 0),
    byteSize: input.objects.reduce((sum, object) => sum + object.byteSize, 0),
    objects: input.objects,
  };
  const list = vi.fn<SealedRaceArchiveManifestRepository["list"]>(async () => ({
    status: "ready",
    manifest,
  }));
  const read = vi.fn<PrivateDatasetEvidenceObjectReader["read"]>(
    async (object) => ({
      registration: object,
      body: body(object.partitionNumber),
    }),
  );
  return {
    list,
    read,
    reader: createSealedRaceArchiveReader({
      manifestRepository: { list },
      objectReader: { read },
      maximumUncompressedBytesPerPartition: 64 * 1024,
      maximumRowsPerPartition: 10,
      maximumSelectedPartitions: input.maximumSelectedPartitions ?? 2,
    }),
  };
}

async function collectPartitionNumbers(
  partitions: AsyncIterable<{
    registration: DatasetEvidenceObjectRegistration;
  }>,
): Promise<number[]> {
  const result: number[] = [];
  for await (const partition of partitions) {
    result.push(partition.registration.partitionNumber);
  }
  return result;
}

describe("selected sealed Race archive reads", () => {
  it("reads only the locator-selected immutable partitions", async () => {
    const first = registration(0);
    const middle = registration(1);
    const last = registration(2);
    const test = harness({ objects: [first, middle, last] });

    const opened = await test.reader.openSelected({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
      partitionNumbers: [0, 2],
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("expected selected archive");
    expect(test.read).not.toHaveBeenCalled();

    await expect(collectPartitionNumbers(opened.partitions)).resolves.toEqual([
      0, 2,
    ]);
    expect(test.list).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    expect(test.read).toHaveBeenCalledTimes(2);
    expect(test.read).toHaveBeenNthCalledWith(1, first);
    expect(test.read).toHaveBeenNthCalledWith(2, last);
    expect(test.read).not.toHaveBeenCalledWith(middle);
  });

  it("does not let an unselected unsupported archive object trigger a read", async () => {
    const selected = registration(0);
    const unselected = registration(1, { objectFormat: "parquet" });
    const test = harness({ objects: [selected, unselected] });

    const opened = await test.reader.openSelected({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
      partitionNumbers: [0],
    });
    if (opened.status !== "ready") throw new Error("expected selected archive");

    await expect(collectPartitionNumbers(opened.partitions)).resolves.toEqual([
      0,
    ]);
    expect(test.read).toHaveBeenCalledTimes(1);
    expect(test.read).toHaveBeenCalledWith(selected);
  });

  it("fails closed on missing selections before touching private object bytes", async () => {
    const test = harness({ objects: [registration(0), registration(1)] });

    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [0, 2],
      }),
    ).rejects.toThrow("partition is missing from the sealed manifest");
    expect(test.read).not.toHaveBeenCalled();
  });

  it("requires a non-empty, bounded, strictly increasing locator selection", async () => {
    const test = harness({
      objects: [registration(0), registration(1), registration(2)],
      maximumSelectedPartitions: 2,
    });

    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [],
      }),
    ).rejects.toThrow("partition count is outside its bound");
    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [0, 1, 2],
      }),
    ).rejects.toThrow("partition count is outside its bound");
    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [1, 1],
      }),
    ).rejects.toThrow("must be strictly increasing");
    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [1, 0],
      }),
    ).rejects.toThrow("must be strictly increasing");

    expect(test.list).not.toHaveBeenCalled();
    expect(test.read).not.toHaveBeenCalled();
  });

  it("fails closed on duplicate sealed partition identities", async () => {
    const test = harness({
      objects: [registration(0), registration(0, { objectKey: "duplicate" })],
    });

    await expect(
      test.reader.openSelected({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
        partitionNumbers: [0],
      }),
    ).rejects.toThrow("duplicate partition numbers");
    expect(test.read).not.toHaveBeenCalled();
  });
});
