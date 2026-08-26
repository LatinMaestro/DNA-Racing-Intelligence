import { describe, expect, it, vi } from "vitest";

import type { DurablePreviewStagedRow } from "../lib/durable-import-preview-staging-sink";
import {
  materializePreparedRacePreactivation,
  type RaceBoundedMaterializationSession,
  type RaceBoundedMaterializationSink,
} from "../lib/race-bounded-materializer";
import type {
  PreparedRacePreactivationMaterialization,
  RacePreactivationMaterializationRecord,
} from "../lib/race-preactivation-materialization-spool";

function asyncValues<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function record(index: number): RacePreactivationMaterializationRecord {
  const naturalKey = `event-${index}:core-${index}`;
  const fingerprintSha256 = index.toString(16).padStart(64, "0").slice(-64);
  const canonicalRow: DurablePreviewStagedRow = Object.freeze({
    sourceRowNumber: index,
    naturalKey,
    fingerprintSha256,
    row: Object.freeze({ status: "ready" }) as DurablePreviewStagedRow["row"],
  });
  return Object.freeze({ naturalKey, fingerprintSha256, canonicalRow });
}

function prepared(input: {
  batches: readonly (readonly RacePreactivationMaterializationRecord[])[];
  sourceRowCount: number;
  readyRowCount: number;
  quarantinedRowCount: number;
  acceptedNaturalKeyCount: number;
  duplicateReadyRowCount: number;
}) {
  const cleanup = vi.fn(async () => undefined);
  const value: PreparedRacePreactivationMaterialization = Object.freeze({
    sourceRowCount: input.sourceRowCount,
    readyRowCount: input.readyRowCount,
    quarantinedRowCount: input.quarantinedRowCount,
    acceptedNaturalKeyCount: input.acceptedNaturalKeyCount,
    duplicateReadyRowCount: input.duplicateReadyRowCount,
    readBatches: () => asyncValues(input.batches),
    cleanup,
  });
  return { value, cleanup };
}

function sinkHarness() {
  const writeBatch = vi.fn(async () => undefined);
  const commit = vi.fn(async () => undefined);
  const rollback = vi.fn(async () => undefined);
  const session: RaceBoundedMaterializationSession = Object.freeze({
    writeBatch,
    commit,
    rollback,
  });
  const begin = vi.fn(async () => session);
  const sink: RaceBoundedMaterializationSink = Object.freeze({ begin });
  return { sink, begin, writeBatch, commit, rollback };
}

describe("bounded Race materialization coordinator", () => {
  it("writes sequential bounded batches and commits exact coverage", async () => {
    const source = prepared({
      batches: [[record(1), record(2)], [record(3)]],
      sourceRowCount: 5,
      readyRowCount: 4,
      quarantinedRowCount: 1,
      acceptedNaturalKeyCount: 3,
      duplicateReadyRowCount: 1,
    });
    const target = sinkHarness();

    await expect(
      materializePreparedRacePreactivation({
        prepared: source.value,
        sink: target.sink,
      }),
    ).resolves.toEqual({
      sourceRowCount: 5,
      readyRowCount: 4,
      quarantinedRowCount: 1,
      acceptedNaturalKeyCount: 3,
      duplicateReadyRowCount: 1,
      materializationBatchCount: 2,
      materializedNaturalKeyCount: 3,
    });

    expect(target.begin).toHaveBeenCalledWith({
      sourceRowCount: 5,
      readyRowCount: 4,
      quarantinedRowCount: 1,
      acceptedNaturalKeyCount: 3,
      duplicateReadyRowCount: 1,
    });
    expect(target.writeBatch).toHaveBeenNthCalledWith(1, {
      batchNumber: 1,
      records: [record(1), record(2)],
    });
    expect(target.writeBatch).toHaveBeenNthCalledWith(2, {
      batchNumber: 2,
      records: [record(3)],
    });
    expect(target.commit).toHaveBeenCalledOnce();
    expect(target.rollback).not.toHaveBeenCalled();
    expect(source.cleanup).toHaveBeenCalledOnce();
  });

  it("rolls back and cleans the spool when a later bounded write fails", async () => {
    const source = prepared({
      batches: [[record(1)], [record(2)]],
      sourceRowCount: 2,
      readyRowCount: 2,
      quarantinedRowCount: 0,
      acceptedNaturalKeyCount: 2,
      duplicateReadyRowCount: 0,
    });
    const target = sinkHarness();
    const failure = new Error("bounded Neon write failed");
    target.writeBatch
      .mockRejectedValueOnce(undefined)
      .mockRejectedValueOnce(failure);

    await expect(
      materializePreparedRacePreactivation({
        prepared: source.value,
        sink: target.sink,
      }),
    ).rejects.toBe(failure);

    expect(target.commit).not.toHaveBeenCalled();
    expect(target.rollback).toHaveBeenCalledWith({
      reason: "materialization_failed",
    });
    expect(source.cleanup).toHaveBeenCalledOnce();
  });

  it("rejects an oversized batch before passing it to the sink", async () => {
    const oversized = Array.from({ length: 5_001 }, (_, index) =>
      record(index + 1),
    );
    const source = prepared({
      batches: [oversized],
      sourceRowCount: oversized.length,
      readyRowCount: oversized.length,
      quarantinedRowCount: 0,
      acceptedNaturalKeyCount: oversized.length,
      duplicateReadyRowCount: 0,
    });
    const target = sinkHarness();

    await expect(
      materializePreparedRacePreactivation({
        prepared: source.value,
        sink: target.sink,
      }),
    ).rejects.toThrow("batch is outside its safe bound");

    expect(target.writeBatch).not.toHaveBeenCalled();
    expect(target.commit).not.toHaveBeenCalled();
    expect(target.rollback).toHaveBeenCalledOnce();
  });

  it("fails before opening a sink when prepared coverage is inconsistent", async () => {
    const source = prepared({
      batches: [[record(1)]],
      sourceRowCount: 3,
      readyRowCount: 1,
      quarantinedRowCount: 1,
      acceptedNaturalKeyCount: 1,
      duplicateReadyRowCount: 0,
    });
    const target = sinkHarness();

    await expect(
      materializePreparedRacePreactivation({
        prepared: source.value,
        sink: target.sink,
      }),
    ).rejects.toThrow("source coverage is invalid");

    expect(target.begin).not.toHaveBeenCalled();
    expect(source.cleanup).toHaveBeenCalledOnce();
  });
});
