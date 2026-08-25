import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { discoveryExactDistanceBenchmarksFromRaceArchive } from "../lib/race-archive-discovery-benchmarks";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableDiscoveryExactDistanceBenchmarksFromRaceArchive } from "../lib/race-archive-spillable-discovery-benchmarks";

function observation(input: {
  event: string;
  core: string;
  mode: "bike" | "car" | "horse";
  distance: number;
  elapsed: number;
  finish: number;
  eventAt: string;
  row: number;
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: "11111111-1111-1111-1111-111111111111",
    importBatchId: "22222222-2222-2222-2222-222222222222",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: `${input.event}:${input.core}`,
    fingerprintSha256: "b".repeat(64),
    sourceEventId: input.event,
    sourceCoreId: input.core,
    eventAt: input.eventAt,
    mode: input.mode,
    distance: input.distance,
    gateCount: 12,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finish,
    elapsedMilliseconds: input.elapsed,
    payoutMechanismSourceValue: "Winner Take All",
    sourceFormat: "standard",
    sourceRaceClass: "open",
  });
}

function records<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records: source }) {
      if (runs.has(runId)) throw new Error("run conflict");
      const values: T[] = [];
      for await (const value of source) values.push(value);
      runs.set(runId, Object.freeze(values));
    },
    readRun({ runId }) {
      const values = runs.get(runId);
      if (values === undefined) throw new Error("run unavailable");
      return records(values);
    },
    async deleteRun({ runId }) {
      runs.delete(runId);
    },
  });
  return { store, runs };
}

async function collect<T>(source: AsyncIterable<T>): Promise<readonly T[]> {
  const values: T[] = [];
  for await (const value of source) values.push(value);
  return values;
}

describe("spillable Race archive Discovery benchmarks", () => {
  it("matches resident exact-distance percentile semantics and removes scratch", async () => {
    const input = [
      observation({ event: "event-5", core: "core-e", mode: "car", distance: 1200, elapsed: 51_000, finish: 1, eventAt: "2026-04-05T00:00:00Z", row: 5 }),
      observation({ event: "event-3", core: "core-c", mode: "bike", distance: 1000, elapsed: 43_000, finish: 3, eventAt: "2026-04-03T00:00:00Z", row: 3 }),
      observation({ event: "event-1", core: "core-a", mode: "bike", distance: 1000, elapsed: 40_000, finish: 1, eventAt: "2026-04-01T00:00:00Z", row: 1 }),
      observation({ event: "event-6", core: "core-f", mode: "car", distance: 1200, elapsed: 53_000, finish: 4, eventAt: "2026-04-06T00:00:00Z", row: 6 }),
      observation({ event: "event-2", core: "core-b", mode: "bike", distance: 1000, elapsed: 42_000, finish: 2, eventAt: "2026-04-02T00:00:00Z", row: 2 }),
      observation({ event: "event-4", core: "core-d", mode: "bike", distance: 1000, elapsed: 44_000, finish: 5, eventAt: "2026-04-04T00:00:00Z", row: 4 }),
      observation({ event: "event-7", core: "core-g", mode: "horse", distance: 1400, elapsed: 61_000, finish: 4, eventAt: "2026-04-07T00:00:00Z", row: 7 }),
    ] as const;
    const refreshedAt = "2026-04-08T00:00:00Z";
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableDiscoveryExactDistanceBenchmarksFromRaceArchive({
      observations: records(input),
      store: scratch.store,
      runPrefix: "test/discovery",
      refreshedAt,
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumBenchmarks: 20,
    });

    expect(spillable.inputObservationCount).toBe(input.length);
    expect(spillable.initialRunCount).toBe(4);
    expect(await collect(spillable.readBenchmarks())).toEqual(
      discoveryExactDistanceBenchmarksFromRaceArchive({
        observations: input,
        refreshedAt,
        maximumObservations: 100,
        maximumBenchmarks: 20,
      }),
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on the benchmark bound and cleans all owned runs", async () => {
    const input = [
      observation({ event: "event-1", core: "core-a", mode: "bike", distance: 1000, elapsed: 40_000, finish: 1, eventAt: "2026-04-01T00:00:00Z", row: 1 }),
      observation({ event: "event-2", core: "core-b", mode: "car", distance: 1200, elapsed: 50_000, finish: 1, eventAt: "2026-04-02T00:00:00Z", row: 2 }),
    ] as const;
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableDiscoveryExactDistanceBenchmarksFromRaceArchive({
      observations: records(input),
      store: scratch.store,
      runPrefix: "test/discovery-bound",
      refreshedAt: "2026-04-03T00:00:00Z",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumBenchmarks: 1,
    });

    await expect(collect(spillable.readBenchmarks())).rejects.toThrow(
      "Race archive Discovery benchmark bound was exceeded.",
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("rejects invalid natural-key identity before writing sorted scratch", async () => {
    const invalid = {
      ...observation({ event: "event-1", core: "core-a", mode: "bike", distance: 1000, elapsed: 40_000, finish: 1, eventAt: "2026-04-01T00:00:00Z", row: 1 }),
      naturalKey: "event-1:other-core",
    } satisfies RaceArchiveCoreAnalyticalObservation;
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();

    await expect(
      spillableDiscoveryExactDistanceBenchmarksFromRaceArchive({
        observations: records([invalid]),
        store: scratch.store,
        runPrefix: "test/discovery-invalid",
        refreshedAt: "2026-04-02T00:00:00Z",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumBenchmarks: 10,
      }),
    ).rejects.toThrow("Race archive Discovery natural key is inconsistent.");
    expect(scratch.runs.size).toBe(0);
  });
});
