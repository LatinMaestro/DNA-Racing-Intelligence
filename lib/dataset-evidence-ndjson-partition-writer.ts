import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import type {
  PrivateDatasetEvidenceObjectWriter,
  PrivateDatasetEvidenceObjectWrite,
} from "./private-dataset-evidence-object-writer";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const encoder = new TextEncoder();

export type DatasetEvidenceNdjsonRow = Readonly<{
  naturalKey: string | null;
  value: unknown;
}>;

export type DatasetEvidenceNdjsonPartition = Readonly<{
  partitionNumber: number;
  rowCount: number;
  byteSize: number;
  checksumSha256: string;
  firstNaturalKey: string | null;
  lastNaturalKey: string | null;
  evidenceObjectId: string;
  objectKey: string;
  status: "created" | "existing";
  storageStatus: "created" | "existing";
}>;

function positiveInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(field + " must be a positive safe integer");
  }
  return value;
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const record = value as Record<string, unknown>;
  return `{${Object.keys(record)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(record[key])}`)
    .join(",")}}`;
}

function naturalKey(value: string | null): string | null {
  if (value === null) return null;
  if (
    value.length < 1 ||
    value.length > 512 ||
    CONTROL_CHARACTER_PATTERN.test(value)
  ) {
    throw new Error("naturalKey is invalid");
  }
  return value;
}

function bytes(input: readonly Uint8Array[], byteLength: number): Uint8Array {
  const output = new Uint8Array(byteLength);
  let offset = 0;
  for (const chunk of input) {
    output.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return output;
}

function stream(value: Uint8Array): AsyncIterable<Uint8Array> {
  return (async function* () {
    yield value;
  })();
}

export function createDatasetEvidenceNdjsonPartitionWriter(input: {
  writer: PrivateDatasetEvidenceObjectWriter;
  ownerId: string;
  importBatchId: string;
  sourceType: PrivateDatasetEvidenceObjectWrite["sourceType"];
  objectKind: Extract<
    PrivateDatasetEvidenceObjectWrite["objectKind"],
    "staged_rows" | "accepted_contributions"
  >;
  maximumUncompressedBytes: number;
  maximumRowsPerPartition: number;
  createdAt: string;
}): Readonly<{
  append: (rows: readonly DatasetEvidenceNdjsonRow[]) => Promise<void>;
  finish: () => Promise<readonly DatasetEvidenceNdjsonPartition[]>;
}> {
  const maximumUncompressedBytes = positiveInteger(
    input.maximumUncompressedBytes,
    "maximumUncompressedBytes",
  );
  const maximumRowsPerPartition = positiveInteger(
    input.maximumRowsPerPartition,
    "maximumRowsPerPartition",
  );
  let partitionNumber = 0;
  let partitionBytes: Uint8Array[] = [];
  let partitionByteLength = 0;
  let partitionRows: DatasetEvidenceNdjsonRow[] = [];
  const results: DatasetEvidenceNdjsonPartition[] = [];
  let tail: Promise<void> = Promise.resolve();
  let failure: unknown;
  let finishRequested = false;
  let finished = false;

  const flush = async () => {
    if (partitionRows.length === 0) return;
    if (partitionNumber >= 10_000) {
      throw new Error("evidence partition count exceeds manifest capacity");
    }
    const compressed = gzipSync(bytes(partitionBytes, partitionByteLength), {
      level: 9,
    });
    const checksumSha256 = createHash("sha256")
      .update(compressed)
      .digest("hex");
    const keyed = partitionRows.filter((row) => row.naturalKey !== null);
    const firstNaturalKey = keyed[0]?.naturalKey ?? null;
    const lastNaturalKey = keyed.at(-1)?.naturalKey ?? null;
    const written = await input.writer.write({
      ownerId: input.ownerId,
      importBatchId: input.importBatchId,
      sourceType: input.sourceType,
      objectKind: input.objectKind,
      partitionNumber,
      objectFormat: "ndjson_gzip",
      body: stream(compressed),
      byteSize: compressed.byteLength,
      rowCount: partitionRows.length,
      checksumSha256,
      firstNaturalKey,
      lastNaturalKey,
      createdAt: input.createdAt,
    });
    results.push({
      partitionNumber,
      rowCount: partitionRows.length,
      byteSize: compressed.byteLength,
      checksumSha256,
      firstNaturalKey,
      lastNaturalKey,
      ...written,
    });
    partitionNumber += 1;
    partitionBytes = [];
    partitionByteLength = 0;
    partitionRows = [];
  };

  const enqueue = <Result>(
    operation: () => Promise<Result>,
  ): Promise<Result> => {
    const current = tail.then(async () => {
      if (failure !== undefined) throw failure;
      return operation();
    });
    tail = current.then(
      () => undefined,
      (error: unknown) => {
        failure = error;
      },
    );
    return current;
  };

  return Object.freeze({
    append(rows) {
      if (finishRequested) {
        return Promise.reject(
          new Error("evidence partition writer is finished"),
        );
      }
      const pending = [...rows];
      return enqueue(async () => {
        for (const raw of pending) {
          if (
            typeof raw !== "object" ||
            raw === null ||
            !("naturalKey" in raw) ||
            !("value" in raw)
          ) {
            throw new Error("evidence row is invalid");
          }
          const row = {
            naturalKey: naturalKey(raw.naturalKey),
            value: raw.value,
          };
          const encoded = encoder.encode(canonicalJson(row) + "\n");
          if (encoded.byteLength > maximumUncompressedBytes) {
            throw new Error("one evidence row exceeds partition capacity");
          }
          if (
            partitionRows.length >= maximumRowsPerPartition ||
            partitionByteLength + encoded.byteLength > maximumUncompressedBytes
          ) {
            await flush();
          }
          partitionRows.push(row);
          partitionBytes.push(encoded);
          partitionByteLength += encoded.byteLength;
        }
      });
    },
    finish() {
      if (!finishRequested) finishRequested = true;
      return enqueue(async () => {
        if (!finished) {
          await flush();
          finished = true;
        }
        return [...results];
      });
    },
  });
}
