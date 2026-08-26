import { createHash } from "node:crypto";
import { gzipSync } from "node:zlib";

import { describe, expect, it } from "vitest";

import type { DatasetEvidenceObjectRegistration } from "../lib/neon-dataset-evidence-object-repository";
import type {
  RacePreactivationEvidenceManifest,
  RacePreactivationEvidenceManifestRepository,
} from "../lib/neon-race-preactivation-evidence-manifest";
import type { PrivateDatasetEvidenceObjectReader } from "../lib/private-dataset-evidence-object-reader";
import type { RaceArchiveAcceptanceCandidate } from "../lib/race-archive-acceptance-stream";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { prepareRacePreactivationArchiveAcceptance } from "../lib/race-preactivation-acceptance-coordinator";

const ownerId = "owner-1";
const importBatchId = "11111111-1111-1111-1111-111111111111";
const datasetVersionId = "22222222-2222-2222-2222-222222222222";

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

function asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

async function collect<T>(values: AsyncIterable<T>): Promise<T[]> {
  const result: T[] = [];
  for await (const value of values) result.push(value);
  return result;
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun(input) {
      runs.set(input.runId, Object.freeze(await collect(input.records)));
    },
    readRun(input) {
      const records = runs.get(input.runId);
      if (records === undefined) throw new Error("run is missing");
      return asyncValues(records);
    },
    async deleteRun(input) {
      runs.delete(input.runId);
    },
  });
  return { store, runs };
}

function readyStagedRow(sourceRowNumber: number) {
  const record = Object.freeze({
    sourceType: "race_merge" as const,
    sourceEventId: "event-1",
    sourceCoreId: "core-1",
  });
  return Object.freeze({
    sourceRowNumber,
    naturalKey: "event-1:core-1",
    fingerprintSha256: createHash("sha256")
      .update(canonicalJson(record))
      .digest("hex"),
    row: Object.freeze({
      status: "ready" as const,
      sourceType: "race_merge" as const,
      provenance: Object.freeze([]),
      issues: Object.freeze([]),
      record,
    }),
  });
}

function quarantinedStagedRow(sourceRowNumber: number) {
  return Object.freeze({
    sourceRowNumber,
    naturalKey: null,
    fingerprintSha256: null,
    row: Object.freeze({
      status: "quarantined" as const,
      sourceType: "race_merge" as const,
      provenance: Object.freeze([]),
      issues: Object.freeze([]),
      record: null,
    }),
  });
}

function evidence(input?: {
  acceptedRowCount?: number;
  rejectedRowCount?: number;
}) {
  const ready = readyStagedRow(1);
  const quarantined = quarantinedStagedRow(2);
  const lines = [
    JSON.stringify({ naturalKey: ready.naturalKey, value: ready }),
    JSON.stringify({ naturalKey: null, value: quarantined }),
  ];
  const body = gzipSync(Buffer.from(`${lines.join("\n")}\n`, "utf8"));
  const registration: DatasetEvidenceObjectRegistration = Object.freeze({
    ownerId,
    importBatchId,
    sourceType: "race_merge" as const,
    objectKind: "staged_rows" as const,
    partitionNumber: 0,
    objectFormat: "ndjson_gzip" as const,
    objectKey: "private/race/part-0.ndjson.gz",
    checksumSha256: "a".repeat(64),
    byteSize: body.byteLength,
    rowCount: 2,
    firstNaturalKey: "event-1:core-1",
    lastNaturalKey: "event-1:core-1",
    createdAt: "2026-08-26T00:00:00.000Z",
  });
  const acceptedRowCount = input?.acceptedRowCount ?? 1;
  const rejectedRowCount = input?.rejectedRowCount ?? 1;
  const manifest: RacePreactivationEvidenceManifest = Object.freeze({
    importBatchId,
    sourceRowCount: 2,
    acceptedRowCount,
    rejectedRowCount,
    warningRowCount: 0,
    partitionCount: 1,
    byteSize: body.byteLength,
    objects: Object.freeze([registration]),
  });
  const manifestRepository: RacePreactivationEvidenceManifestRepository =
    Object.freeze({
      async list() {
        return Object.freeze({ status: "ready" as const, manifest });
      },
    });
  const objectReader: PrivateDatasetEvidenceObjectReader = Object.freeze({
    async read(requested) {
      return Object.freeze({
        registration: requested,
        body: new Uint8Array(body),
      });
    },
  });
  return { manifestRepository, objectReader };
}

const bounds = Object.freeze({
  maximumArchivePartitions: 10,
  maximumUncompressedBytesPerPartition: 1024 * 1024,
  maximumRowsPerPartition: 100,
  maximumRecordsInMemory: 1,
  mergeFanIn: 2,
  maximumSourceRows: 100,
  maximumRunObjects: 100,
});

describe("Race preactivation acceptance coordinator", () => {
  it("binds finalized preactivation evidence to the future version and classifies it spillably", async () => {
    const source = evidence();
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    const stream = await prepareRacePreactivationArchiveAcceptance({
      ownerId,
      importBatchId,
      datasetVersionId,
      manifestRepository: source.manifestRepository,
      objectReader: source.objectReader,
      store: storage.store,
      runPrefix: "preactivation/race-version-1",
      ...bounds,
    });

    expect(stream.sourceRowCount).toBe(2);
    expect(stream.readyRowCount).toBe(1);
    expect(stream.quarantinedRowCount).toBe(1);
    expect(await collect(stream.readGroups())).toMatchObject([
      {
        status: "accepted",
        naturalKey: "event-1:core-1",
        sourceRowCount: 1,
        duplicateRowCount: 0,
      },
    ]);
    expect(storage.runs.size).toBe(0);
  });

  it("fails closed when archived row statuses disagree with the finalized Preview receipt", async () => {
    const source = evidence({ acceptedRowCount: 2, rejectedRowCount: 0 });
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();

    await expect(
      prepareRacePreactivationArchiveAcceptance({
        ownerId,
        importBatchId,
        datasetVersionId,
        manifestRepository: source.manifestRepository,
        objectReader: source.objectReader,
        store: storage.store,
        runPrefix: "preactivation/race-version-2",
        ...bounds,
      }),
    ).rejects.toThrow(
      "Race preactivation archived row status conflicts with its finalized Preview receipt.",
    );
    expect(storage.runs.size).toBe(0);
  });

  it("fails closed before R2 reads when finalized preactivation evidence is missing", async () => {
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    const manifestRepository: RacePreactivationEvidenceManifestRepository =
      Object.freeze({
        async list() {
          return Object.freeze({ status: "missing" as const });
        },
      });
    let objectRead = false;
    const objectReader: PrivateDatasetEvidenceObjectReader = Object.freeze({
      async read() {
        objectRead = true;
        throw new Error("unexpected read");
      },
    });

    await expect(
      prepareRacePreactivationArchiveAcceptance({
        ownerId,
        importBatchId,
        datasetVersionId,
        manifestRepository,
        objectReader,
        store: storage.store,
        runPrefix: "preactivation/race-version-3",
        ...bounds,
      }),
    ).rejects.toThrow("Race preactivation evidence is unavailable.");
    expect(objectRead).toBe(false);
    expect(storage.runs.size).toBe(0);
  });
});
