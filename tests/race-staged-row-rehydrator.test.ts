import { createHash } from "node:crypto";

import { describe, expect, it, vi } from "vitest";

import type { DatasetEvidenceNdjsonRow } from "@/lib/dataset-evidence-ndjson-partition-writer";
import type { DatasetEvidenceObjectRegistration } from "@/lib/neon-dataset-evidence-object-repository";
import type { SealedRaceArchiveManifest } from "@/lib/neon-sealed-race-archive-manifest-repository";
import { createRaceStagedRowRehydrator } from "@/lib/race-staged-row-rehydrator";
import type {
  DecodedSealedRaceArchivePartition,
  SealedRaceArchiveReader,
} from "@/lib/sealed-race-archive-reader";

const ownerId = "user_owner";
const datasetVersionId = "11111111-1111-4111-8111-111111111111";
const importBatchId = "22222222-2222-4222-8222-222222222222";

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function fingerprint(value: unknown): string {
  return createHash("sha256").update(canonicalJson(value)).digest("hex");
}

function readyValue(
  sourceRowNumber: number,
  eventId: string,
  coreId: string,
): Record<string, unknown> {
  const record = {
    sourceType: "race_merge",
    sourceEventId: eventId,
    sourceCoreId: coreId,
    elapsedTimeSourceValue: "12.345",
  };
  return {
    sourceRowNumber,
    naturalKey: `${eventId}:${coreId}`,
    fingerprintSha256: fingerprint(record),
    row: {
      status: "ready",
      sourceType: "race_merge",
      record,
      provenance: [],
      issues: [],
    },
  };
}

function quarantinedValue(sourceRowNumber: number): Record<string, unknown> {
  return {
    sourceRowNumber,
    naturalKey: null,
    fingerprintSha256: null,
    row: {
      status: "quarantined",
      sourceType: "race_merge",
      record: null,
      provenance: [],
      issues: [{ code: "ROW_COLUMN_COUNT_MISMATCH", severity: "error" }],
    },
  };
}

function registration(
  partitionNumber: number,
  rows: readonly DatasetEvidenceNdjsonRow[],
): DatasetEvidenceObjectRegistration {
  const keyed = rows.flatMap(({ naturalKey }) =>
    naturalKey === null ? [] : [naturalKey],
  );
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
    checksumSha256: String(partitionNumber + 1).repeat(64),
    byteSize: 100 + partitionNumber,
    rowCount: rows.length,
    firstNaturalKey: keyed[0] ?? null,
    lastNaturalKey: keyed.at(-1) ?? null,
    createdAt: "2026-08-25T00:00:00.000Z",
  };
}

function partition(
  partitionNumber: number,
  values: readonly Record<string, unknown>[],
): DecodedSealedRaceArchivePartition {
  const rows = values.map((value) => ({
    naturalKey: typeof value.naturalKey === "string" ? value.naturalKey : null,
    value,
  }));
  return {
    registration: registration(partitionNumber, rows),
    rows,
    uncompressedByteSize: 1024,
  };
}

function manifest(
  partitions: readonly DecodedSealedRaceArchivePartition[],
  overrides: Partial<SealedRaceArchiveManifest> = {},
): SealedRaceArchiveManifest {
  return {
    datasetVersionId,
    importBatchId,
    sourceType: "race_merge",
    evidenceKind: "staged_rows",
    partitionCount: partitions.length,
    rowCount: partitions.reduce((total, item) => total + item.rows.length, 0),
    byteSize: partitions.reduce(
      (total, item) => total + item.registration.byteSize,
      0,
    ),
    objects: partitions.map(({ registration: object }) => object),
    ...overrides,
  };
}

function archiveReader(input: {
  manifest?: SealedRaceArchiveManifest;
  partitions?: readonly DecodedSealedRaceArchivePartition[];
}) {
  const iterated = vi.fn();
  const open = vi.fn(async () => {
    if (input.manifest === undefined) return { status: "missing" as const };
    return {
      status: "ready" as const,
      manifest: input.manifest,
      partitions: (async function* () {
        iterated();
        for (const item of input.partitions ?? []) yield item;
      })(),
    };
  });
  const openSelected = vi.fn(async () => ({ status: "missing" as const }));
  return {
    reader: { open, openSelected } as SealedRaceArchiveReader,
    open,
    openSelected,
    iterated,
  };
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const output: T[] = [];
  for await (const value of values) output.push(value);
  return output;
}

describe("Race staged-row archive rehydrator", () => {
  it("returns missing without iterating archive partitions", async () => {
    const archive = archiveReader({});
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });

    await expect(
      rehydrator.open({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).resolves.toEqual({ status: "missing" });
    expect(archive.open).toHaveBeenCalledWith({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    expect(archive.openSelected).not.toHaveBeenCalled();
    expect(archive.iterated).not.toHaveBeenCalled();
  });

  it("rehydrates ready and quarantined Race staged rows in source order", async () => {
    const first = partition(0, [readyValue(1, "event-1", "core-1")]);
    const second = partition(1, [quarantinedValue(2)]);
    const sealed = manifest([first, second]);
    const archive = archiveReader({
      manifest: sealed,
      partitions: [first, second],
    });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });

    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    expect(opened.status).toBe("ready");
    if (opened.status !== "ready") throw new Error("expected ready archive");
    expect(archive.iterated).not.toHaveBeenCalled();

    const rows = await collect(opened.rows);
    expect(rows).toHaveLength(2);
    expect(rows[0]).toMatchObject({
      datasetVersionId,
      importBatchId,
      partitionNumber: 0,
      stagedRow: {
        sourceRowNumber: 1,
        naturalKey: "event-1:core-1",
      },
    });
    expect(rows[1]).toMatchObject({
      datasetVersionId,
      importBatchId,
      partitionNumber: 1,
      stagedRow: {
        sourceRowNumber: 2,
        naturalKey: null,
        fingerprintSha256: null,
        row: { status: "quarantined" },
      },
    });
    expect(archive.openSelected).not.toHaveBeenCalled();
    expect(archive.iterated).toHaveBeenCalledTimes(1);
  });

  it("rejects a non-staged evidence manifest before touching partition bytes", async () => {
    const item = partition(0, [readyValue(1, "event-1", "core-1")]);
    const sealed = manifest([item], { evidenceKind: "normalized_partition" });
    const archive = archiveReader({ manifest: sealed, partitions: [item] });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });

    await expect(
      rehydrator.open({ ownerId, datasetVersionId, maximumPartitions: 10 }),
    ).rejects.toThrow("does not contain staged-row evidence");
    expect(archive.iterated).not.toHaveBeenCalled();
  });

  it("fails closed when archived source row numbers are not contiguous", async () => {
    const item = partition(0, [readyValue(2, "event-1", "core-1")]);
    const archive = archiveReader({
      manifest: manifest([item]),
      partitions: [item],
    });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });
    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(collect(opened.rows)).rejects.toThrow(
      "source-row sequence is not contiguous",
    );
  });

  it("fails closed when envelope and staged-row natural keys diverge", async () => {
    const value = readyValue(1, "event-1", "core-1");
    const item = partition(0, [value]);
    value.naturalKey = "event-1:other-core";
    const archive = archiveReader({
      manifest: manifest([item]),
      partitions: [item],
    });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });
    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(collect(opened.rows)).rejects.toThrow(
      "natural key conflicts with its envelope",
    );
  });

  it("recomputes ready-row identity and rejects a record fingerprint conflict", async () => {
    const value = readyValue(1, "event-1", "core-1");
    value.fingerprintSha256 = "f".repeat(64);
    const item = partition(0, [value]);
    const archive = archiveReader({
      manifest: manifest([item]),
      partitions: [item],
    });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });
    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(collect(opened.rows)).rejects.toThrow(
      "fingerprint does not match its record",
    );
  });

  it("rejects identity evidence on quarantined archived rows", async () => {
    const value = quarantinedValue(1);
    value.naturalKey = "event-1:core-1";
    value.fingerprintSha256 = "a".repeat(64);
    const item = partition(0, [value]);
    const archive = archiveReader({
      manifest: manifest([item]),
      partitions: [item],
    });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });
    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(collect(opened.rows)).rejects.toThrow(
      "unexpectedly contains identity evidence",
    );
  });

  it("requires full row coverage when the archive iterator completes", async () => {
    const item = partition(0, [readyValue(1, "event-1", "core-1")]);
    const sealed = manifest([item], { rowCount: 2 });
    const archive = archiveReader({ manifest: sealed, partitions: [item] });
    const rehydrator = createRaceStagedRowRehydrator({
      archiveReader: archive.reader,
    });
    const opened = await rehydrator.open({
      ownerId,
      datasetVersionId,
      maximumPartitions: 10,
    });
    if (opened.status !== "ready") throw new Error("expected ready archive");

    await expect(collect(opened.rows)).rejects.toThrow(
      "coverage conflicts with the sealed manifest",
    );
  });
});
