import { describe, expect, it } from "vitest";

import type {
  RaceArchiveCoreAnalyticalObservation,
  RaceArchiveCoreAnalyticalObservationSet,
} from "../lib/race-archive-core-analytical-observations";
import { corePerformanceProfilesFromRaceArchive } from "../lib/race-archive-core-performance-profiles";

function observation(input: {
  naturalKey: string;
  elapsedMilliseconds: number;
  eventAt: string;
  mode?: "bike" | "car" | "horse";
  distance?: number;
}): RaceArchiveCoreAnalyticalObservation {
  return {
    datasetVersionId: "version-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: Number(input.naturalKey.replace(/\D/g, "")) || 1,
    naturalKey: input.naturalKey,
    fingerprintSha256: "a".repeat(64),
    sourceEventId: input.naturalKey.split(":")[0] ?? "event",
    sourceCoreId: "core-7",
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount: 8,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: 1,
    elapsedMilliseconds: input.elapsedMilliseconds,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

function set(
  observations: readonly RaceArchiveCoreAnalyticalObservation[],
): RaceArchiveCoreAnalyticalObservationSet {
  return {
    sourceCoreId: "core-7",
    locatorVersionCount: 1,
    selectedPartitionCount: 1,
    observations,
  };
}

describe("archive-backed Core Performance profiles", () => {
  it("matches the SQL median, trimmed-mean and population-dispersion semantics", () => {
    const observations = Array.from({ length: 10 }, (_, index) =>
      observation({
        naturalKey: `event-${index + 1}:core-7`,
        elapsedMilliseconds: (index + 1) * 1000,
        eventAt: `2026-08-${String(index + 1).padStart(2, "0")}T00:00:00.000Z`,
      }),
    );

    const profiles = corePerformanceProfilesFromRaceArchive({
      observationSet: set(observations),
      maximumObservations: 100,
      maximumProfiles: 10,
    });

    expect(profiles).toHaveLength(1);
    expect(profiles[0]).toMatchObject({
      sourceCoreId: "core-7",
      mode: "bike",
      distance: 1000,
      dataCurrentThrough: "2026-08-10T00:00:00.000Z",
      raceCount: 10,
      bestMilliseconds: 1000,
      medianMilliseconds: 5500,
      meanMilliseconds: 5500,
      trimmedMeanMilliseconds: 5500,
      interquartileRangeMilliseconds: 4500,
      bestMetresPerSecond: 1000,
    });
    expect(profiles[0]?.standardDeviationMilliseconds).toBeCloseTo(
      2872.2813232690143,
      9,
    );
    expect(profiles[0]?.medianMetresPerSecond).toBeCloseTo(
      181.8181818181818,
      9,
    );
  });

  it("keeps mode-distance profiles separate and preserves latest chronology", () => {
    const profiles = corePerformanceProfilesFromRaceArchive({
      observationSet: set([
        observation({
          naturalKey: "event-1:core-7",
          elapsedMilliseconds: 2000,
          eventAt: "2026-08-01T00:00:00.000Z",
        }),
        observation({
          naturalKey: "event-2:core-7",
          elapsedMilliseconds: 1800,
          eventAt: "2026-08-03T00:00:00.000Z",
        }),
        observation({
          naturalKey: "event-3:core-7",
          elapsedMilliseconds: 3000,
          eventAt: "2026-08-02T00:00:00.000Z",
          mode: "car",
          distance: 1500,
        }),
      ]),
      maximumObservations: 10,
      maximumProfiles: 10,
    });

    expect(profiles).toHaveLength(2);
    expect(profiles[0]).toMatchObject({
      mode: "bike",
      distance: 1000,
      dataCurrentThrough: "2026-08-03T00:00:00.000Z",
      raceCount: 2,
      bestMilliseconds: 1800,
      medianMilliseconds: 1900,
    });
    expect(profiles[1]).toMatchObject({
      mode: "car",
      distance: 1500,
      dataCurrentThrough: "2026-08-02T00:00:00.000Z",
      raceCount: 1,
      medianMilliseconds: 3000,
    });
  });

  it("fails closed on duplicate evidence, Core drift and configured bounds", () => {
    const duplicate = observation({
      naturalKey: "event-1:core-7",
      elapsedMilliseconds: 2000,
      eventAt: "2026-08-01T00:00:00.000Z",
    });
    expect(() =>
      corePerformanceProfilesFromRaceArchive({
        observationSet: set([duplicate, duplicate]),
        maximumObservations: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/duplicate Race evidence/);

    expect(() =>
      corePerformanceProfilesFromRaceArchive({
        observationSet: {
          ...set([duplicate]),
          sourceCoreId: "other-core",
        },
        maximumObservations: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/changed Core identity/);

    expect(() =>
      corePerformanceProfilesFromRaceArchive({
        observationSet: set([duplicate, { ...duplicate, naturalKey: "event-2:core-7" }]),
        maximumObservations: 1,
        maximumProfiles: 10,
      }),
    ).toThrow(/observation bound/);
  });
});
