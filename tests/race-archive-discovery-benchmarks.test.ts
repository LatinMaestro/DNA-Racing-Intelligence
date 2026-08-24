import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { discoveryExactDistanceBenchmarksFromRaceArchive } from "../lib/race-archive-discovery-benchmarks";

function observation(input: {
  naturalKey: string;
  sourceCoreId: string;
  elapsedMilliseconds: number;
  finishPosition: number;
  eventAt: string;
  mode?: "bike" | "car" | "horse";
  distance?: number;
}): RaceArchiveCoreAnalyticalObservation {
  return {
    datasetVersionId: "version-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: 1,
    naturalKey: input.naturalKey,
    fingerprintSha256: "a".repeat(64),
    sourceEventId: input.naturalKey.split(":")[0] ?? "event",
    sourceCoreId: input.sourceCoreId,
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finishPosition,
    elapsedMilliseconds: input.elapsedMilliseconds,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

describe("archive-backed Discovery exact-distance benchmarks", () => {
  it("matches SQL count, chronology and percentile_cont semantics", () => {
    const observations = [
      observation({
        naturalKey: "event-1:core-1",
        sourceCoreId: "core-1",
        elapsedMilliseconds: 1000,
        finishPosition: 1,
        eventAt: "2026-08-01T00:00:00.000Z",
      }),
      observation({
        naturalKey: "event-2:core-2",
        sourceCoreId: "core-2",
        elapsedMilliseconds: 2000,
        finishPosition: 2,
        eventAt: "2026-08-02T00:00:00.000Z",
      }),
      observation({
        naturalKey: "event-3:core-3",
        sourceCoreId: "core-3",
        elapsedMilliseconds: 3000,
        finishPosition: 3,
        eventAt: "2026-08-03T00:00:00.000Z",
      }),
      observation({
        naturalKey: "event-4:core-4",
        sourceCoreId: "core-4",
        elapsedMilliseconds: 5000,
        finishPosition: 1,
        eventAt: "2026-08-04T00:00:00.000Z",
      }),
      observation({
        naturalKey: "event-5:core-5",
        sourceCoreId: "core-5",
        elapsedMilliseconds: 9000,
        finishPosition: 4,
        eventAt: "2026-08-05T00:00:00.000Z",
      }),
    ];

    const benchmarks = discoveryExactDistanceBenchmarksFromRaceArchive({
      observations,
      refreshedAt: "2026-08-25T00:00:00.000Z",
      maximumObservations: 100,
      maximumBenchmarks: 10,
    });

    expect(benchmarks).toEqual([
      {
        mode: "bike",
        distanceMetres: 1000,
        dataCurrentThrough: "2026-08-05T00:00:00.000Z",
        raceEntryCount: 5,
        winningEntryCount: 2,
        topThreeEntryCount: 4,
        winningP25Milliseconds: 2000,
        winningMedianMilliseconds: 3000,
        winningP75Milliseconds: 4000,
        topThreeP25Milliseconds: 1750,
        topThreeMedianMilliseconds: 2500,
        topThreeP75Milliseconds: 3500,
        refreshedAt: "2026-08-25T00:00:00.000Z",
      },
    ]);
  });

  it("keeps mode and exact distance separate and omits groups without winners", () => {
    const benchmarks = discoveryExactDistanceBenchmarksFromRaceArchive({
      observations: [
        observation({
          naturalKey: "event-1:core-1",
          sourceCoreId: "core-1",
          elapsedMilliseconds: 2000,
          finishPosition: 1,
          eventAt: "2026-08-01T00:00:00.000Z",
        }),
        observation({
          naturalKey: "event-2:core-2",
          sourceCoreId: "core-2",
          elapsedMilliseconds: 3000,
          finishPosition: 2,
          eventAt: "2026-08-02T00:00:00.000Z",
          mode: "car",
          distance: 1500,
        }),
      ],
      refreshedAt: "2026-08-25T00:00:00.000Z",
      maximumObservations: 10,
      maximumBenchmarks: 10,
    });

    expect(benchmarks).toHaveLength(1);
    expect(benchmarks[0]).toMatchObject({
      mode: "bike",
      distanceMetres: 1000,
      raceEntryCount: 1,
      winningEntryCount: 1,
      topThreeEntryCount: 1,
      winningMedianMilliseconds: 2000,
      topThreeMedianMilliseconds: 2000,
    });
  });

  it("fails closed on duplicate Race evidence and configured bounds", () => {
    const row = observation({
      naturalKey: "event-1:core-1",
      sourceCoreId: "core-1",
      elapsedMilliseconds: 2000,
      finishPosition: 1,
      eventAt: "2026-08-01T00:00:00.000Z",
    });

    expect(() =>
      discoveryExactDistanceBenchmarksFromRaceArchive({
        observations: [row, row],
        refreshedAt: "2026-08-25T00:00:00.000Z",
        maximumObservations: 10,
        maximumBenchmarks: 10,
      }),
    ).toThrow(/duplicate Race evidence/);

    expect(() =>
      discoveryExactDistanceBenchmarksFromRaceArchive({
        observations: [row, { ...row, naturalKey: "event-2:core-2" }],
        refreshedAt: "2026-08-25T00:00:00.000Z",
        maximumObservations: 1,
        maximumBenchmarks: 10,
      }),
    ).toThrow(/observation bound/);
  });
});
