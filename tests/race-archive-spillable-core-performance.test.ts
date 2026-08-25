import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { corePerformanceProfilesFromRaceArchive } from "../lib/race-archive-core-performance-profiles";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import { spillableCorePerformanceProfilesFromRaceArchive } from "../lib/race-archive-spillable-core-performance";

function observation(input: {
  event: string;
  core: string;
  mode: "bike" | "car" | "horse";
  distance: number;
  elapsed: number;
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
    fingerprintSha256: "a".repeat(64),
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
    finishPosition: 2,
    elapsedMilliseconds: input.elapsed,
    payoutMechanismSourceValue: "Top 3",
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

function residentProfiles(
  observations: readonly RaceArchiveCoreAnalyticalObservation[],
) {
  const byCore = new Map<string, RaceArchiveCoreAnalyticalObservation[]>();
  for (const value of observations) {
    const core = byCore.get(value.sourceCoreId) ?? [];
    core.push(value);
    byCore.set(value.sourceCoreId, core);
  }
  return [...byCore.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .flatMap(([sourceCoreId, values]) =>
      corePerformanceProfilesFromRaceArchive({
        observationSet: Object.freeze({
          sourceCoreId,
          locatorVersionCount: 1,
          selectedPartitionCount: 1,
          observations: Object.freeze(values),
        }),
        maximumObservations: 1_000,
        maximumProfiles: 100,
      }),
    );
}

describe("spillable Race archive Core Performance", () => {
  it("matches resident Core Performance semantics across shuffled groups and cleans scratch", async () => {
    const input = [
      observation({
        event: "event-4",
        core: "core-b",
        mode: "horse",
        distance: 1400,
        elapsed: 62_000,
        eventAt: "2026-03-04T00:00:00Z",
        row: 4,
      }),
      observation({
        event: "event-2",
        core: "core-a",
        mode: "bike",
        distance: 1000,
        elapsed: 41_000,
        eventAt: "2026-03-02T00:00:00Z",
        row: 2,
      }),
      observation({
        event: "event-5",
        core: "core-a",
        mode: "bike",
        distance: 1200,
        elapsed: 49_000,
        eventAt: "2026-03-05T00:00:00Z",
        row: 5,
      }),
      observation({
        event: "event-1",
        core: "core-a",
        mode: "bike",
        distance: 1000,
        elapsed: 40_000,
        eventAt: "2026-03-01T00:00:00Z",
        row: 1,
      }),
      observation({
        event: "event-3",
        core: "core-a",
        mode: "bike",
        distance: 1000,
        elapsed: 42_000,
        eventAt: "2026-03-03T00:00:00Z",
        row: 3,
      }),
    ] as const;
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePerformanceProfilesFromRaceArchive({
      observations: records(input),
      store: scratch.store,
      runPrefix: "test/core-performance",
      maximumRecordsInMemory: 2,
      mergeFanIn: 2,
      maximumObservations: 100,
      maximumRunObjects: 100,
      maximumProfiles: 20,
    });

    expect(spillable.inputObservationCount).toBe(input.length);
    expect(spillable.initialRunCount).toBe(3);
    expect(await collect(spillable.readProfiles())).toEqual(residentProfiles(input));
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed on the profile bound and still removes owned scratch", async () => {
    const input = [
      observation({
        event: "event-1",
        core: "core-a",
        mode: "bike",
        distance: 1000,
        elapsed: 40_000,
        eventAt: "2026-03-01T00:00:00Z",
        row: 1,
      }),
      observation({
        event: "event-2",
        core: "core-b",
        mode: "bike",
        distance: 1000,
        elapsed: 41_000,
        eventAt: "2026-03-02T00:00:00Z",
        row: 2,
      }),
    ] as const;
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const spillable = await spillableCorePerformanceProfilesFromRaceArchive({
      observations: records(input),
      store: scratch.store,
      runPrefix: "test/profile-bound",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 1,
    });

    await expect(collect(spillable.readProfiles())).rejects.toThrow(
      "Race archive Core Performance profile bound was exceeded.",
    );
    expect(scratch.runs.size).toBe(0);
  });

  it("fails closed before sorting invalid Core Performance identity", async () => {
    const invalid = {
      ...observation({
        event: "event-1",
        core: "core-a",
        mode: "bike",
        distance: 1000,
        elapsed: 40_000,
        eventAt: "2026-03-01T00:00:00Z",
        row: 1,
      }),
      naturalKey: "event-1:other-core",
    } satisfies RaceArchiveCoreAnalyticalObservation;
    const scratch = memoryStore<RaceArchiveCoreAnalyticalObservation>();

    await expect(
      spillableCorePerformanceProfilesFromRaceArchive({
        observations: records([invalid]),
        store: scratch.store,
        runPrefix: "test/invalid",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumObservations: 10,
        maximumRunObjects: 20,
        maximumProfiles: 10,
      }),
    ).rejects.toThrow("Race archive Core Performance natural key is inconsistent.");
    expect(scratch.runs.size).toBe(0);
  });
});
