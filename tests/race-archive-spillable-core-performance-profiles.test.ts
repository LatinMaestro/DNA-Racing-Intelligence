import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { corePerformanceProfilesFromRaceArchive } from "../lib/race-archive-core-performance-profiles";
import type { RaceArchiveExternalSortedRunStore } from "../lib/race-archive-external-sort";
import {
  decodeRaceArchiveCorePerformanceSummaryLine,
  encodeRaceArchiveCorePerformanceSummary,
  spillableCorePerformanceProfilesFromRaceArchive,
  type RaceArchiveCorePerformanceSummary,
} from "../lib/race-archive-spillable-core-performance-profiles";

function iterable<T>(values: readonly T[]): AsyncIterable<T> {
  return (async function* () {
    for (const value of values) yield value;
  })();
}

function memoryStore<T>() {
  const runs = new Map<string, readonly T[]>();
  const store: RaceArchiveExternalSortedRunStore<T> = Object.freeze({
    async writeRun({ runId, records }) {
      if (runs.has(runId)) throw new Error("test run already exists");
      const values: T[] = [];
      for await (const value of records) values.push(value);
      if (values.length < 1) throw new Error("test run cannot be empty");
      runs.set(runId, Object.freeze(values));
    },
    readRun({ runId }) {
      return (async function* () {
        const values = runs.get(runId);
        if (values === undefined) throw new Error("test run is unavailable");
        for (const value of values) yield value;
      })();
    },
    async deleteRun({ runId }) {
      runs.delete(runId);
    },
  });
  return { store, runs };
}

function observation(input: {
  core: string;
  event: string;
  mode?: "bike" | "car" | "horse";
  distance?: number;
  elapsed: number;
  eventAt: string;
  finishPosition?: number;
}): RaceArchiveCoreAnalyticalObservation {
  return Object.freeze({
    datasetVersionId: "dataset-version-1",
    importBatchId: "import-batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: Number(input.event.replace(/\D/gu, "")) || 1,
    naturalKey: `${input.event}:${input.core}`,
    fingerprintSha256: "a".repeat(64),
    sourceEventId: input.event,
    sourceCoreId: input.core,
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finishPosition ?? 4,
    elapsedMilliseconds: input.elapsed,
    payoutMechanismSourceValue: null,
    sourceFormat: null,
    sourceRaceClass: null,
  });
}

function residentProfiles(
  observations: readonly RaceArchiveCoreAnalyticalObservation[],
) {
  return [...new Set(observations.map((value) => value.sourceCoreId))]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((sourceCoreId) =>
      corePerformanceProfilesFromRaceArchive({
        observationSet: Object.freeze({
          sourceCoreId,
          locatorVersionCount: 1,
          selectedPartitionCount: 1,
          observations: Object.freeze(
            observations.filter((value) => value.sourceCoreId === sourceCoreId),
          ),
        }),
        maximumObservations: 10_000,
        maximumProfiles: 100,
      }),
    );
}

const FIXTURE = Object.freeze([
  observation({
    core: "core-b",
    event: "event-21",
    mode: "horse",
    distance: 1600,
    elapsed: 92_000,
    eventAt: "2026-02-03T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-10",
    elapsed: 10_900,
    eventAt: "2026-01-10T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-01",
    elapsed: 10_000,
    eventAt: "2026-01-01T00:00:00Z",
  }),
  observation({
    core: "core-b",
    event: "event-20",
    mode: "horse",
    distance: 1600,
    elapsed: 90_000,
    eventAt: "2026-02-01T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-05",
    elapsed: 10_400,
    eventAt: "2026-01-05T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-03",
    elapsed: 10_200,
    eventAt: "2026-01-03T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-12",
    elapsed: 11_100,
    eventAt: "2026-01-12T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-08",
    elapsed: 10_700,
    eventAt: "2026-01-08T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-02",
    elapsed: 10_100,
    eventAt: "2026-01-02T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-11",
    elapsed: 11_000,
    eventAt: "2026-01-11T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-07",
    elapsed: 10_600,
    eventAt: "2026-01-07T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-04",
    elapsed: 10_300,
    eventAt: "2026-01-04T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-09",
    elapsed: 10_800,
    eventAt: "2026-01-09T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-06",
    elapsed: 10_500,
    eventAt: "2026-01-06T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-30",
    mode: "car",
    distance: 1200,
    elapsed: 20_000,
    eventAt: "2026-03-01T00:00:00Z",
  }),
  observation({
    core: "core-a",
    event: "event-31",
    mode: "car",
    distance: 1200,
    elapsed: 19_500,
    eventAt: "2026-03-02T00:00:00Z",
  }),
]);

describe("spillable Race archive Core Performance profiles", () => {
  it("matches the resident Core Performance formulas across spilled runs", async () => {
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const summaries = memoryStore<RaceArchiveCorePerformanceSummary>();
    const actual = await spillableCorePerformanceProfilesFromRaceArchive({
      observations: iterable(FIXTURE),
      observationStore: observations.store,
      summaryStore: summaries.store,
      runPrefix: "refresh-1",
      maximumRecordsInMemory: 3,
      mergeFanIn: 2,
      maximumInputObservations: 100,
      maximumRunObjects: 100,
      maximumProfiles: 100,
    });

    expect(actual).toEqual(residentProfiles(FIXTURE));
    expect(observations.runs.size).toBe(0);
    expect(summaries.runs.size).toBe(0);
  });

  it("round-trips the compact summary codec exactly", () => {
    const summary: RaceArchiveCorePerformanceSummary = Object.freeze({
      sourceCoreId: "core-a",
      mode: "bike",
      distance: 1000,
      raceCount: 12,
      elapsedSum: 126_600,
      dataCurrentThrough: "2026-01-12T00:00:00.000Z",
    });
    const encoded = encodeRaceArchiveCorePerformanceSummary(summary);
    expect(new TextDecoder().decode(encoded).endsWith("\n")).toBe(true);
    expect(
      decodeRaceArchiveCorePerformanceSummaryLine(
        new TextDecoder().decode(encoded).trimEnd(),
      ),
    ).toEqual(summary);
  });

  it("fails closed at the profile bound and cleans both scratch stores", async () => {
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const summaries = memoryStore<RaceArchiveCorePerformanceSummary>();
    await expect(
      spillableCorePerformanceProfilesFromRaceArchive({
        observations: iterable(FIXTURE),
        observationStore: observations.store,
        summaryStore: summaries.store,
        runPrefix: "refresh-profile-bound",
        maximumRecordsInMemory: 4,
        mergeFanIn: 2,
        maximumInputObservations: 100,
        maximumRunObjects: 100,
        maximumProfiles: 1,
      }),
    ).rejects.toThrow(
      "Race archive Core Performance profile bound was exceeded.",
    );
    expect(observations.runs.size).toBe(0);
    expect(summaries.runs.size).toBe(0);
  });

  it("fails closed at the input bound and cleans external-sort scratch", async () => {
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const summaries = memoryStore<RaceArchiveCorePerformanceSummary>();
    await expect(
      spillableCorePerformanceProfilesFromRaceArchive({
        observations: iterable(FIXTURE.slice(0, 4)),
        observationStore: observations.store,
        summaryStore: summaries.store,
        runPrefix: "refresh-input-bound",
        maximumRecordsInMemory: 2,
        mergeFanIn: 2,
        maximumInputObservations: 3,
        maximumRunObjects: 100,
        maximumProfiles: 100,
      }),
    ).rejects.toThrow("Race archive external-sort input bound was exceeded.");
    expect(observations.runs.size).toBe(0);
    expect(summaries.runs.size).toBe(0);
  });

  it("orders same-mode profiles by numeric distance rather than lexical distance", async () => {
    const fixture = Object.freeze([
      observation({
        core: "core-distance",
        event: "event-91",
        mode: "bike",
        distance: 1000,
        elapsed: 11_000,
        eventAt: "2026-04-02T00:00:00Z",
      }),
      observation({
        core: "core-distance",
        event: "event-90",
        mode: "bike",
        distance: 900,
        elapsed: 10_000,
        eventAt: "2026-04-01T00:00:00Z",
      }),
    ]);
    const observations = memoryStore<RaceArchiveCoreAnalyticalObservation>();
    const summaries = memoryStore<RaceArchiveCorePerformanceSummary>();
    const actual = await spillableCorePerformanceProfilesFromRaceArchive({
      observations: iterable(fixture),
      observationStore: observations.store,
      summaryStore: summaries.store,
      runPrefix: "refresh-distance-order",
      maximumRecordsInMemory: 1,
      mergeFanIn: 2,
      maximumInputObservations: 10,
      maximumRunObjects: 20,
      maximumProfiles: 10,
    });
    expect(actual.map((profile) => profile.distance)).toEqual([900, 1000]);
    expect(actual).toEqual(residentProfiles(fixture));
    expect(observations.runs.size).toBe(0);
    expect(summaries.runs.size).toBe(0);
  });
});
