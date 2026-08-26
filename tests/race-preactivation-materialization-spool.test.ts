import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import type {
  RaceArchiveAcceptanceGroup,
  SpillableRaceArchiveAcceptanceStream,
} from "../lib/race-archive-acceptance-stream";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import {
  prepareRacePreactivationMaterializationSpool,
  type RacePreactivationMaterializationRecord,
} from "../lib/race-preactivation-materialization-spool";

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

function readyRow(input: {
  sourceRowNumber: number;
  naturalKey: string;
  fingerprintSha256: string;
}): DurablePreviewStagedRow {
  return Object.freeze({
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: input.naturalKey,
    fingerprintSha256: input.fingerprintSha256,
    row: Object.freeze({ status: "ready" }) as DurablePreviewStagedRow["row"],
  });
}

function accepted(input: {
  naturalKey: string;
  fingerprintSha256: string;
  sourceRowNumber: number;
  sourceRowCount?: number;
  duplicateRowCount?: number;
}): RaceArchiveAcceptanceGroup {
  const sourceRowCount = input.sourceRowCount ?? 1;
  const duplicateRowCount = input.duplicateRowCount ?? sourceRowCount - 1;
  return Object.freeze({
    status: "accepted" as const,
    naturalKey: input.naturalKey,
    fingerprintSha256: input.fingerprintSha256,
    canonicalRow: readyRow(input),
    sourceRowCount,
    duplicateRowCount,
  });
}

function acceptance(input: {
  groups: readonly RaceArchiveAcceptanceGroup[];
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
}) {
  const cleanup = vi.fn(async () => undefined);
  const stream: SpillableRaceArchiveAcceptanceStream = Object.freeze({
    sourceRowCount: input.sourceRowCount,
    readyRowCount: input.readyRowCount,
    quarantinedRowCount: input.quarantinedRowCount,
    initialRunCount: 1,
    readGroups: () => asyncValues(input.groups),
    cleanup,
  });
  return { stream, cleanup };
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun(input) {
      if (runs.has(input.runId)) throw new Error("run already exists");
      runs.set(input.runId, Object.freeze(await collect(input.records)));
    },
    readRun(input) {
      const values = runs.get(input.runId);
      if (values === undefined) throw new Error("run is missing");
      return asyncValues(values);
    },
    async deleteRun(input) {
      runs.delete(input.runId);
    },
  });
  return { store, runs };
}

const BASE = Object.freeze({
  runId: "preactivation/version-1/accepted",
  maximumMaterializationBatchRecords: 2,
});

describe("Race preactivation materialization spool", () => {
  it("spools only canonical accepted rows and exposes bounded batches", async () => {
    const source = acceptance({
      sourceRowCount: 5,
      readyRowCount: 4,
      quarantinedRowCount: 1,
      groups: [
        accepted({
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          sourceRowNumber: 1,
          sourceRowCount: 2,
          duplicateRowCount: 1,
        }),
        accepted({
          naturalKey: "event-2:core-2",
          fingerprintSha256: "b".repeat(64),
          sourceRowNumber: 3,
        }),
        accepted({
          naturalKey: "event-3:core-3",
          fingerprintSha256: "c".repeat(64),
          sourceRowNumber: 4,
        }),
      ],
    });
    const storage = memoryStore<RacePreactivationMaterializationRecord>();

    const prepared = await prepareRacePreactivationMaterializationSpool({
      ...BASE,
      acceptance: source.stream,
      store: storage.store,
    });

    expect(prepared).toMatchObject({
      sourceRowCount: 5,
      readyRowCount: 4,
      quarantinedRowCount: 1,
      acceptedNaturalKeyCount: 3,
      duplicateReadyRowCount: 1,
    });
    expect(storage.runs.get(BASE.runId)).toHaveLength(3);

    const batches = await collect(prepared.readBatches());
    expect(batches.map((batch) => batch.length)).toEqual([2, 1]);
    expect(batches.flat().map((row) => row.naturalKey)).toEqual([
      "event-1:core-1",
      "event-2:core-2",
      "event-3:core-3",
    ]);
    expect(storage.runs.size).toBe(0);
  });

  it("discovers all conflicts before exposing any materialization batches", async () => {
    const source = acceptance({
      sourceRowCount: 3,
      readyRowCount: 3,
      quarantinedRowCount: 0,
      groups: [
        accepted({
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          sourceRowNumber: 1,
        }),
        Object.freeze({
          status: "fingerprint_conflict" as const,
          naturalKey: "event-2:core-2",
          sourceRowCount: 2,
          distinctFingerprintCount: 2,
        }),
      ],
    });
    const storage = memoryStore<RacePreactivationMaterializationRecord>();

    await expect(
      prepareRacePreactivationMaterializationSpool({
        ...BASE,
        acceptance: source.stream,
        store: storage.store,
      }),
    ).rejects.toThrow("1 fingerprint conflict group");
    expect(storage.runs.size).toBe(0);
    expect(source.cleanup).toHaveBeenCalledOnce();
  });

  it("fails closed when acceptance-group coverage changes", async () => {
    const source = acceptance({
      sourceRowCount: 3,
      readyRowCount: 3,
      quarantinedRowCount: 0,
      groups: [
        accepted({
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          sourceRowNumber: 1,
          sourceRowCount: 2,
          duplicateRowCount: 1,
        }),
      ],
    });
    const storage = memoryStore<RacePreactivationMaterializationRecord>();

    await expect(
      prepareRacePreactivationMaterializationSpool({
        ...BASE,
        acceptance: source.stream,
        store: storage.store,
      }),
    ).rejects.toThrow("acceptance coverage changed");
    expect(storage.runs.size).toBe(0);
  });

  it("validates scratch records before yielding them to Neon materialization", async () => {
    const source = acceptance({
      sourceRowCount: 1,
      readyRowCount: 1,
      quarantinedRowCount: 0,
      groups: [
        accepted({
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          sourceRowNumber: 1,
        }),
      ],
    });
    const storage = memoryStore<RacePreactivationMaterializationRecord>();
    const prepared = await prepareRacePreactivationMaterializationSpool({
      ...BASE,
      acceptance: source.stream,
      store: storage.store,
    });
    const current = storage.runs.get(BASE.runId)?.[0];
    if (current === undefined) throw new Error("expected stored record");
    storage.runs.set(
      BASE.runId,
      Object.freeze([
        Object.freeze({
          ...current,
          fingerprintSha256: "d".repeat(64),
        }),
      ]),
    );

    await expect(collect(prepared.readBatches())).rejects.toThrow(
      "materialization record is inconsistent",
    );
    expect(storage.runs.size).toBe(0);
  });

  it("rejects an unsafe materialization batch bound", async () => {
    const source = acceptance({
      sourceRowCount: 1,
      readyRowCount: 1,
      quarantinedRowCount: 0,
      groups: [
        accepted({
          naturalKey: "event-1:core-1",
          fingerprintSha256: "a".repeat(64),
          sourceRowNumber: 1,
        }),
      ],
    });
    const storage = memoryStore<RacePreactivationMaterializationRecord>();

    await expect(
      prepareRacePreactivationMaterializationSpool({
        ...BASE,
        maximumMaterializationBatchRecords: 5_001,
        acceptance: source.stream,
        store: storage.store,
      }),
    ).rejects.toThrow(
      "maximumMaterializationBatchRecords is outside its bound",
    );
    expect(storage.runs.size).toBe(0);
  });
});
