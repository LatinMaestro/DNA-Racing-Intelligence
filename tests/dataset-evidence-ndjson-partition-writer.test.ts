import { gunzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import {
  createDatasetEvidenceNdjsonPartitionWriter,
  type DatasetEvidenceNdjsonRow,
} from "@/lib/dataset-evidence-ndjson-partition-writer";
import type { PrivateDatasetEvidenceObjectWriter } from "@/lib/private-dataset-evidence-object-writer";

const ownerId = "user_owner";
const importBatchId = "11111111-1111-4111-8111-111111111111";

function harness() {
  const bodies: Uint8Array[] = [];
  const write = vi.fn<PrivateDatasetEvidenceObjectWriter["write"]>(
    async (input) => {
      const chunks: Uint8Array[] = [];
      let byteLength = 0;
      for await (const chunk of input.body) {
        chunks.push(chunk);
        byteLength += chunk.byteLength;
      }
      const body = new Uint8Array(byteLength);
      let offset = 0;
      for (const chunk of chunks) {
        body.set(chunk, offset);
        offset += chunk.byteLength;
      }
      bodies.push(body);
      return {
        status: "created" as const,
        evidenceObjectId: `22222222-2222-4222-8222-${String(
          input.partitionNumber,
        ).padStart(12, "0")}`,
        objectKey: `evidence/part-${input.partitionNumber}.ndjson.gz`,
        storageStatus: "created" as const,
      };
    },
  );
  const writer: PrivateDatasetEvidenceObjectWriter = { write };
  return { writer, write, bodies };
}

function partitionWriter(
  test: ReturnType<typeof harness>,
  overrides: Partial<{
    maximumUncompressedBytes: number;
    maximumRowsPerPartition: number;
  }> = {},
) {
  return createDatasetEvidenceNdjsonPartitionWriter({
    writer: test.writer,
    ownerId,
    importBatchId,
    sourceType: "race_merge",
    objectKind: "staged_rows",
    maximumUncompressedBytes: overrides.maximumUncompressedBytes ?? 1024,
    maximumRowsPerPartition: overrides.maximumRowsPerPartition ?? 2,
    createdAt: "2026-08-23T09:00:00.000Z",
  });
}

function decoded(value: Uint8Array): unknown[] {
  return new TextDecoder()
    .decode(gunzipSync(value))
    .trimEnd()
    .split("\n")
    .map((line) => JSON.parse(line) as unknown);
}

describe("dataset evidence NDJSON partition writer", () => {
  it("writes deterministic gzip partitions within the configured row bound", async () => {
    const test = harness();
    const writer = partitionWriter(test);
    const rows: DatasetEvidenceNdjsonRow[] = [
      { naturalKey: "event-1:core-1", value: { z: 2, a: 1 } },
      { naturalKey: null, value: { reason: "quarantined" } },
      { naturalKey: "event-2:core-2", value: { a: 3 } },
    ];

    await writer.append(rows);
    const result = await writer.finish();

    expect(result).toHaveLength(2);
    expect(result.map((partition) => partition.rowCount)).toEqual([2, 1]);
    expect(result.map((partition) => partition.partitionNumber)).toEqual([
      0, 1,
    ]);
    expect(result[0]).toMatchObject({
      firstNaturalKey: "event-1:core-1",
      lastNaturalKey: "event-1:core-1",
      checksumSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
    });
    expect(result[1]).toMatchObject({
      firstNaturalKey: "event-2:core-2",
      lastNaturalKey: "event-2:core-2",
    });
    expect(decoded(test.bodies[0]!)).toEqual([
      { naturalKey: "event-1:core-1", value: { a: 1, z: 2 } },
      { naturalKey: null, value: { reason: "quarantined" } },
    ]);
    expect(decoded(test.bodies[1]!)).toEqual([
      { naturalKey: "event-2:core-2", value: { a: 3 } },
    ]);
  });

  it("flushes before the uncompressed byte bound is exceeded", async () => {
    const test = harness();
    const writer = partitionWriter(test, {
      maximumUncompressedBytes: 80,
      maximumRowsPerPartition: 100,
    });
    await writer.append([
      { naturalKey: "key-1", value: { payload: "x".repeat(20) } },
      { naturalKey: "key-2", value: { payload: "y".repeat(20) } },
    ]);

    const result = await writer.finish();

    expect(result.map((partition) => partition.rowCount)).toEqual([1, 1]);
    expect(test.write).toHaveBeenCalledTimes(2);
  });

  it("is byte-stable across input object key order and append boundaries", async () => {
    const first = harness();
    const firstWriter = partitionWriter(first);
    await firstWriter.append([
      { naturalKey: "key-1", value: { beta: 2, alpha: 1 } },
    ]);
    const firstResult = await firstWriter.finish();

    const second = harness();
    const secondWriter = partitionWriter(second);
    await secondWriter.append([]);
    await secondWriter.append([
      { naturalKey: "key-1", value: { alpha: 1, beta: 2 } },
    ]);
    const secondResult = await secondWriter.finish();

    expect(secondResult[0]?.checksumSha256).toBe(
      firstResult[0]?.checksumSha256,
    );
    expect(second.bodies[0]).toEqual(first.bodies[0]);
  });

  it("fails closed when one row exceeds capacity and preserves the failure", async () => {
    const test = harness();
    const writer = partitionWriter(test, {
      maximumUncompressedBytes: 40,
      maximumRowsPerPartition: 100,
    });

    await expect(
      writer.append([
        { naturalKey: "key-1", value: { payload: "x".repeat(100) } },
      ]),
    ).rejects.toThrow("one evidence row exceeds partition capacity");
    await expect(writer.finish()).rejects.toThrow(
      "one evidence row exceeds partition capacity",
    );
    expect(test.write).not.toHaveBeenCalled();
  });

  it("makes finish idempotent and rejects later rows", async () => {
    const test = harness();
    const writer = partitionWriter(test);
    await writer.append([
      { naturalKey: null, value: { status: "quarantined" } },
    ]);

    const first = await writer.finish();
    const replay = await writer.finish();

    expect(replay).toEqual(first);
    expect(test.write).toHaveBeenCalledOnce();
    await expect(
      writer.append([{ naturalKey: "late", value: { status: "ready" } }]),
    ).rejects.toThrow("writer is finished");
  });

  it("emits no object for an empty evidence stream", async () => {
    const test = harness();
    await expect(partitionWriter(test).finish()).resolves.toEqual([]);
    expect(test.write).not.toHaveBeenCalled();
  });
});
