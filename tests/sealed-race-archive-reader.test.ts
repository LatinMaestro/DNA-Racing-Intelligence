import { gzipSync } from "node:zlib";

import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";
import type {
  SealedRaceArchiveManifest,
  SealedRaceArchiveManifestRepository,
} from "@/lib/neon-sealed-race-archive-manifest-repository";
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
    checksumSha256: partitionNumber === 0 ? "a".repeat(64) : "b".repeat(64),
    byteSize: partitionNumber === 0 ? 100 : 120,
    rowCount: 2,
    firstNaturalKey: `event-${partitionNumber * 2 + 1}:core-1`,
    lastNaturalKey: `event-${partitionNumber * 2 + 2}:core-2`,
    createdAt: "2026-08-25T00:00:00.000Z",
    ...overrides,
  };
}

function manifest(
  objects: readonly DatasetEvidenceObjectRegistration[],
): SealedRaceArchiveManifest {
  return {
    datasetVersionId,
    importBatchId,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: objects.length,
    rowCount: objects.reduce((total, object) => total + object.rowCount, 0),
    byteSize: objects.reduce((total, object) => total + object.byteSize, 0),
    objects,
  };
}

function encodedRows(
  rows: readonly Readonly<{ naturalKey: string | null; value: unknown }>[],
): Uint8Array {
  return gzipSync(
    rows.map((row) => JSON.stringify(row)).join("\n") + "\n",
    { level: 9 },
  );
}

function harness(input: {
  manifest?: SealedRaceArchiveManifest;
  bodies?: ReadonlyMap<number, Uint8Array>;
  registrationOverride?: (
    registration: DatasetEvidenceObjectRegistration,
  ) => DatasetEvidenceObjectRegistration;
  maximumUncompressedBytesPerPartition?: number;
  maximumRowsPerPartition?: number;
}) {
  const list = vi.fn(
    async (): Promise<Awaited<ReturnType<SealedRaceArchiveManifestRepository["list"]>>> =>
      input.manifest === undefined
        ? { status: "missing" }
        : { status: "ready", manifest: input.manifest },
  );
  const read = vi.fn(
    async (object: DatasetEvidenceObjectRegistration) => ({
      registration: input.registrationOverride?.(object) ?? object,
      body: input.bodies?.get(object.partitionNumber) ?? new Uint8Array(),
    }),
  );
  const reader = createSealedRaceArchiveReader({
    manifestRepository: { list },
    objectReader: { read } as PrivateDatasetEvidenceObjectReader,
    maximumUncompressedBytesPerPartition:
      input.maximumUncompressedBytesPerPartition ?? 64 * 1024,
    maximumRowsPerPartition: input.maximumRowsPerPartition ?? 10,
  });
  return { list, read, reader };
}

describe("sealed Race archive reader", () => {
  it("returns missing without reading private object storage", async () => {
    const test = harness({});

    await expect(
      test.reader.open({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).resolves.toEqual({ status: "missing" });
    expect(test.list).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    expect(test.read).not.toHaveBeenCalled();
  });

  it("reads and decodes verified partitions lazily and sequentially", async () => {
    const first = registration(0);
    const second = registration(1);
    const firstRows = [
      { naturalKey: "event-1:core-1", value: { sourceRowNumber: 2 } },
      { naturalKey: "event-2:core-2", value: { sourceRowNumber: 3 } },
    ];
    const secondRows = [
      { naturalKey: "event-3:core-1", value: { sourceRowNumber: 4 } },
      { naturalKey: "event-4:core-2", value: { sourceRowNumber: 5 } },
    ];
    const firstBody = encodedRows(firstRows);
    const secondBody = encodedRows(secondRows);
    const test = harness({
      manifest: manifest([first, second]),
      bodies: new Map([
        [0, firstBody],
        [1, secondBody],
      ]),
    });

    const opened = await test.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("expected ready archive");
    expect(test.read).not.toHaveBeenCalled();

    const iterator = opened.partitions[Symbol.asyncIterator]();
    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        registration: first,
        rows: firstRows,
        uncompressedByteSize: expect.any(Number),
      },
    });
    expect(test.read).toHaveBeenCalledTimes(1);
    expect(test.read).toHaveBeenLastCalledWith(first);

    await expect(iterator.next()).resolves.toEqual({
      done: false,
      value: {
        registration: second,
        rows: secondRows,
        uncompressedByteSize: expect.any(Number),
      },
    });
    expect(test.read).toHaveBeenCalledTimes(2);
    expect(test.read).toHaveBeenLastCalledWith(second);
    await expect(iterator.next()).resolves.toEqual({
      done: true,
      value: undefined,
    });
  });

  it("rejects unsupported or over-bound partitions before touching object bytes", async () => {
    const parquet = registration(0, { objectFormat: "parquet" });
    const unsupported = harness({ manifest: manifest([parquet]) });
    await expect(
      unsupported.reader.open({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("outside the rebuild bounds");
    expect(unsupported.read).not.toHaveBeenCalled();

    const oversized = registration(0, { rowCount: 11 });
    const bounded = harness({
      manifest: manifest([oversized]),
      maximumRowsPerPartition: 10,
    });
    await expect(
      bounded.reader.open({
        ownerId,
        datasetVersionId,
        maximumPartitions: 10,
      }),
    ).rejects.toThrow("outside the rebuild bounds");
    expect(bounded.read).not.toHaveBeenCalled();
  });

  it("fails closed when decoded row or natural-key coverage conflicts with the manifest", async () => {
    const object = registration(0);
    const short = harness({
      manifest: manifest([object]),
      bodies: new Map([
        [
          0,
          encodedRows([
            { naturalKey: "event-1:core-1", value: { sourceRowNumber: 2 } },
          ]),
        ],
      ]),
    });
    const shortOpened = await short.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (shortOpened.status !== "ready") throw new Error("expected ready archive");
    await expect(
      shortOpened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("row coverage is invalid");

    const wrongRange = harness({
      manifest: manifest([object]),
      bodies: new Map([
        [
          0,
          encodedRows([
            { naturalKey: "wrong:first", value: { sourceRowNumber: 2 } },
            { naturalKey: "wrong:last", value: { sourceRowNumber: 3 } },
          ]),
        ],
      ]),
    });
    const rangeOpened = await wrongRange.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (rangeOpened.status !== "ready") throw new Error("expected ready archive");
    await expect(
      rangeOpened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("natural-key coverage is invalid");
  });

  it("fails closed on invalid gzip, UTF-8, envelopes, and decompression bounds", async () => {
    const object = registration(0);
    const invalidGzip = harness({
      manifest: manifest([object]),
      bodies: new Map([[0, new Uint8Array([1, 2, 3])]]),
    });
    const invalidGzipOpened = await invalidGzip.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (invalidGzipOpened.status !== "ready")
      throw new Error("expected ready archive");
    await expect(
      invalidGzipOpened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("gzip payload is invalid or too large");

    const invalidEnvelope = harness({
      manifest: manifest([object]),
      bodies: new Map([
        [
          0,
          gzipSync(
            `${JSON.stringify({ naturalKey: "event-1:core-1", value: {}, extra: true })}\n${JSON.stringify({ naturalKey: "event-2:core-2", value: {} })}\n`,
          ),
        ],
      ]),
    });
    const envelopeOpened = await invalidEnvelope.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (envelopeOpened.status !== "ready")
      throw new Error("expected ready archive");
    await expect(
      envelopeOpened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("row envelope is invalid");

    const bounded = harness({
      manifest: manifest([object]),
      bodies: new Map([
        [
          0,
          encodedRows([
            { naturalKey: "event-1:core-1", value: { text: "x".repeat(1024) } },
            { naturalKey: "event-2:core-2", value: { sourceRowNumber: 3 } },
          ]),
        ],
      ]),
      maximumUncompressedBytesPerPartition: 128,
    });
    const boundedOpened = await bounded.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (boundedOpened.status !== "ready") throw new Error("expected ready archive");
    await expect(
      boundedOpened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("gzip payload is invalid or too large");
  });

  it("rejects a verified read that no longer matches the sealed registration", async () => {
    const object = registration(0);
    const test = harness({
      manifest: manifest([object]),
      bodies: new Map([
        [
          0,
          encodedRows([
            { naturalKey: "event-1:core-1", value: { sourceRowNumber: 2 } },
            { naturalKey: "event-2:core-2", value: { sourceRowNumber: 3 } },
          ]),
        ],
      ]),
      registrationOverride: (value) => ({
        ...value,
        checksumSha256: "c".repeat(64),
      }),
    });
    const opened = await test.reader.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(
      opened.partitions[Symbol.asyncIterator]().next(),
    ).rejects.toThrow("does not match its sealed manifest");
  });
});
