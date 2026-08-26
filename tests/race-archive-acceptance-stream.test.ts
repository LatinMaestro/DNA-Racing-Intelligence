import { describe, expect, it } from "vitest";

import {
  prepareSpillableRaceArchiveAcceptanceStream,
  type RaceArchiveAcceptanceCandidate,
} from "../lib/race-archive-acceptance-stream";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import type {
  RaceStagedRowRehydrator,
  RehydratedRaceStagedRow,
} from "../lib/race-staged-row-rehydrator";
import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";

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
      if (runs.has(input.runId)) throw new Error("run already exists");
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

function stagedRow(input: {
  sourceRowNumber: number;
  naturalKey: string | null;
  fingerprintSha256: string | null;
  status: "ready" | "quarantined";
}): DurablePreviewStagedRow {
  return Object.freeze({
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: input.naturalKey,
    fingerprintSha256: input.fingerprintSha256,
    row: Object.freeze({ status: input.status }) as DurablePreviewStagedRow["row"],
  });
}

function rehydrated(input: {
  sourceRowNumber: number;
  naturalKey: string | null;
  fingerprintSha256: string | null;
  status: "ready" | "quarantined";
  partitionNumber?: number;
}): RehydratedRaceStagedRow {
  return Object.freeze({
    datasetVersionId: "11111111-1111-4111-8111-111111111111",
    importBatchId: "22222222-2222-4222-8222-222222222222",
    partitionNumber: input.partitionNumber ?? 0,
    stagedRow: stagedRow(input),
  });
}

function rehydrator(
  rows: readonly RehydratedRaceStagedRow[],
): RaceStagedRowRehydrator {
  return Object.freeze({
    async open(input) {
      return Object.freeze({
        status: "ready" as const,
        manifest: Object.freeze({
          datasetVersionId: input.datasetVersionId,
          importBatchId: "22222222-2222-4222-8222-222222222222",
          sourceType: "race_merge" as const,
          evidenceKind: "staged_rows" as const,
          partitionCount: 1,
          rowCount: rows.length,
          byteSize: 1,
          objects: Object.freeze([]),
        }),
        rows: asyncValues(rows),
      });
    },
  });
}

function missingRehydrator(): RaceStagedRowRehydrator {
  return Object.freeze({
    async open() {
      return Object.freeze({ status: "missing" as const });
    },
  });
}

const BASE_INPUT = Object.freeze({
  ownerId: "owner-1",
  datasetVersionId: "11111111-1111-4111-8111-111111111111",
  runPrefix: "acceptance/race-version-1",
  maximumArchivePartitions: 100,
  maximumRecordsInMemory: 1,
  mergeFanIn: 2,
  maximumSourceRows: 100,
  maximumRunObjects: 100,
});

describe("Race archive acceptance stream", () => {
  it("collapses exact ready-row replays and counts archived quarantined rows", async () => {
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    const stream = await prepareSpillableRaceArchiveAcceptanceStream({
      ...BASE_INPUT,
      rehydrator: rehydrator([
        rehydrated({
          sourceRowNumber: 1,
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          status: "ready",
        }),
        rehydrated({
          sourceRowNumber: 2,
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          status: "ready",
        }),
        rehydrated({
          sourceRowNumber: 3,
          naturalKey: "event-2:core-2",
          fingerprintSha256: "b".repeat(64),
          status: "ready",
        }),
        rehydrated({
          sourceRowNumber: 4,
          naturalKey: null,
          fingerprintSha256: null,
          status: "quarantined",
        }),
      ]),
      store: storage.store,
    });

    expect(stream.sourceRowCount).toBe(4);
    expect(stream.readyRowCount).toBe(3);
    expect(stream.quarantinedRowCount).toBe(1);
    expect(stream.initialRunCount).toBe(3);

    const groups = await collect(stream.readGroups());
    expect(groups).toHaveLength(2);
    expect(groups[0]).toMatchObject({
      status: "accepted",
      naturalKey: "event-1:core-1",
      fingerprintSha256: "a".repeat(64),
      sourceRowCount: 2,
      duplicateRowCount: 1,
    });
    if (groups[0]?.status !== "accepted") {
      throw new Error("expected accepted group");
    }
    expect(groups[0].canonicalRow.sourceRowNumber).toBe(1);
    expect(groups[1]).toMatchObject({
      status: "accepted",
      naturalKey: "event-2:core-2",
      sourceRowCount: 1,
      duplicateRowCount: 0,
    });
    expect(storage.runs.size).toBe(0);
  });

  it("classifies conflicting fingerprints without choosing a canonical row", async () => {
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    const stream = await prepareSpillableRaceArchiveAcceptanceStream({
      ...BASE_INPUT,
      rehydrator: rehydrator([
        rehydrated({
          sourceRowNumber: 3,
          naturalKey: "event-1:core-1",
          fingerprintSha256: "b".repeat(64),
          status: "ready",
        }),
        rehydrated({
          sourceRowNumber: 1,
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          status: "ready",
        }),
        rehydrated({
          sourceRowNumber: 2,
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          status: "ready",
        }),
      ]),
      store: storage.store,
    });

    expect(await collect(stream.readGroups())).toEqual([
      {
        status: "fingerprint_conflict",
        naturalKey: "event-1:core-1",
        sourceRowCount: 3,
        distinctFingerprintCount: 2,
      },
    ]);
    expect(storage.runs.size).toBe(0);
  });

  it("fails closed when archived Race evidence is unavailable", async () => {
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    await expect(
      prepareSpillableRaceArchiveAcceptanceStream({
        ...BASE_INPUT,
        rehydrator: missingRehydrator(),
        store: storage.store,
      }),
    ).rejects.toThrow("Race archive acceptance evidence is unavailable.");
    expect(storage.runs.size).toBe(0);
  });

  it("rejects a manifest before reading when source rows exceed the bound", async () => {
    const storage = memoryStore<RaceArchiveAcceptanceCandidate>();
    await expect(
      prepareSpillableRaceArchiveAcceptanceStream({
        ...BASE_INPUT,
        maximumSourceRows: 2,
        rehydrator: rehydrator([
          rehydrated({
            sourceRowNumber: 1,
            naturalKey: "event-1:core-1",
            fingerprintSha256: "a".repeat(64),
            status: "ready",
          }),
          rehydrated({
            sourceRowNumber: 2,
            naturalKey: "event-2:core-2",
            fingerprintSha256: "b".repeat(64),
            status: "ready",
          }),
          rehydrated({
            sourceRowNumber: 3,
            naturalKey: "event-3:core-3",
            fingerprintSha256: "c".repeat(64),
            status: "ready",
          }),
        ]),
        store: storage.store,
      }),
    ).rejects.toThrow("Race archive acceptance source-row bound was exceeded.");
    expect(storage.runs.size).toBe(0);
  });
});
