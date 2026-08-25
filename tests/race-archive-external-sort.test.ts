import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedRunStore,
} from "../lib/race-archive-external-sort";
import { spillAndDeduplicateRaceArchiveObservations } from "../lib/race-archive-spillable-natural-key-deduplicator";

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
  const writes: Array<Readonly<{ runId: string; recordCount: number }>> = [];
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun(input) {
      if (runs.has(input.runId)) throw new Error("run already exists");
      const records = await collect(input.records);
      runs.set(input.runId, Object.freeze(records));
      writes.push(
        Object.freeze({ runId: input.runId, recordCount: records.length }),
      );
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
  return { store, runs, writes };
}

function observation(input: {
  eventId: string;
  coreId: string;
  fingerprint: string;
  versionNumber: number;
  sourceRowNumber: number;
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: `version-${input.versionNumber}`,
    importBatchId: `batch-${input.versionNumber}`,
    versionNumber: input.versionNumber,
    partitionNumber: 0,
    sourceRowNumber: input.sourceRowNumber,
    naturalKey: `${input.eventId}:${input.coreId}`,
    fingerprintSha256: input.fingerprint,
    sourceEventId: input.eventId,
    sourceCoreId: input.coreId,
    eventAt: "2026-08-20T01:02:03.000Z",
    mode: "bike",
    distance: 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedMilliseconds: 60_000,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  });
}

describe("Race archive external sort", () => {
  it("sorts exactly through bounded initial runs and multi-pass merges", async () => {
    const storage = memoryStore<number>();
    const result = await spillExactSortedRaceArchiveRecords({
      records: asyncValues([9, 1, 7, 2, 8, 3, 6, 4, 5, 0]),
      store: storage.store,
      compare: (left, right) => left - right,
      runPrefix: "refresh-1/natural-key",
      maximumRecordsInMemory: 3,
      mergeFanIn: 2,
      maximumInputRecords: 100,
      maximumRunObjects: 100,
    });

    expect(result.recordCount).toBe(10);
    expect(result.initialRunCount).toBe(4);
    expect(await collect(result.read())).toEqual([
      0, 1, 2, 3, 4, 5, 6, 7, 8, 9,
    ]);
    expect(storage.runs.size).toBe(1);
    expect(
      storage.writes.slice(0, 4).map((write) => write.recordCount),
    ).toEqual([3, 3, 3, 1]);

    await result.cleanup();
    expect(storage.runs.size).toBe(0);
    await result.cleanup();
  });

  it("preserves deterministic input order when comparison keys tie", async () => {
    type StableRecord = Readonly<{ key: number; sequence: number }>;
    const storage = memoryStore<StableRecord>();
    const records: readonly StableRecord[] = Object.freeze([
      Object.freeze({ key: 2, sequence: 0 }),
      Object.freeze({ key: 1, sequence: 1 }),
      Object.freeze({ key: 1, sequence: 2 }),
      Object.freeze({ key: 2, sequence: 3 }),
      Object.freeze({ key: 1, sequence: 4 }),
    ]);
    const result = await spillExactSortedRaceArchiveRecords({
      records: asyncValues(records),
      store: storage.store,
      compare: (left, right) => left.key - right.key,
      runPrefix: "refresh-2/stable",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumInputRecords: 100,
      maximumRunObjects: 100,
    });

    expect(
      (await collect(result.read())).map((value) => value.sequence),
    ).toEqual([1, 2, 4, 0, 3]);
    await result.cleanup();
  });

  it("deduplicates identical replays after external natural-key ordering", async () => {
    const storage = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const first = observation({
      eventId: "event-1",
      coreId: "core-1",
      fingerprint: "1".repeat(64),
      versionNumber: 1,
      sourceRowNumber: 1,
    });
    const replay = observation({
      eventId: "event-1",
      coreId: "core-1",
      fingerprint: "1".repeat(64),
      versionNumber: 2,
      sourceRowNumber: 2,
    });
    const second = observation({
      eventId: "event-2",
      coreId: "core-1",
      fingerprint: "2".repeat(64),
      versionNumber: 2,
      sourceRowNumber: 3,
    });
    const deduplicated = await spillAndDeduplicateRaceArchiveObservations({
      observations: asyncValues([second, replay, first]),
      store: storage.store,
      runPrefix: "refresh-3/dedup",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumInputObservations: 100,
      maximumRunObjects: 100,
    });

    expect(deduplicated.inputObservationCount).toBe(3);
    expect(deduplicated.initialRunCount).toBe(3);
    expect(
      (await collect(deduplicated.readUnique())).map(
        (value) => value.naturalKey,
      ),
    ).toEqual(["event-1:core-1", "event-2:core-1"]);
    expect(storage.runs.size).toBe(0);
  });

  it("fails closed on conflicting replay fingerprints and still cleans scratch", async () => {
    const storage = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const first = observation({
      eventId: "event-1",
      coreId: "core-1",
      fingerprint: "1".repeat(64),
      versionNumber: 1,
      sourceRowNumber: 1,
    });
    const conflict = observation({
      eventId: "event-1",
      coreId: "core-1",
      fingerprint: "2".repeat(64),
      versionNumber: 2,
      sourceRowNumber: 2,
    });
    const deduplicated = await spillAndDeduplicateRaceArchiveObservations({
      observations: asyncValues([conflict, first]),
      store: storage.store,
      runPrefix: "refresh-4/conflict",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumInputObservations: 100,
      maximumRunObjects: 100,
    });

    await expect(collect(deduplicated.readUnique())).rejects.toThrow(
      "Race archive history contains conflicting replay evidence.",
    );
    expect(storage.runs.size).toBe(0);
  });
});
