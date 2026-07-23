import { describe, expect, it } from "vitest";
import {
  buildCorePerformanceProfiles,
  type PerformanceObservation,
  type RaceMode,
} from "@/domain/core-performance";
import { refreshStarProfiles } from "@/domain/star-signals";

const observedAt = "2026-07-20T00:00:00Z";
const now = new Date("2026-07-23T00:00:00Z");

function observation(
  eventId: string,
  elapsedTimeMilliseconds: number,
  overrides: Partial<PerformanceObservation> = {},
): PerformanceObservation {
  return {
    eventId,
    eventAt: observedAt,
    coreId: "core-a",
    mode: "bike",
    distance: 1_000,
    elapsedTimeMilliseconds,
    ...overrides,
  };
}

function series(
  count: number,
  mode: RaceMode = "bike",
  distance = 1_000,
): PerformanceObservation[] {
  return Array.from({ length: count }, (_, index) =>
    observation(`event-${mode}-${distance}-${index}`, 50_000 + index * 1_000, {
      eventAt: `2026-07-${String(index + 1).padStart(2, "0")}T00:00:00Z`,
      mode,
      distance,
    }),
  );
}

describe("Phase 2 core performance profiles", () => {
  it("keeps Bike, Car and Horse exact-distance evidence separate", () => {
    const profiles = buildCorePerformanceProfiles(
      [
        observation("bike-1000", 60_000),
        observation("bike-1200", 62_000, { distance: 1_200 }),
        observation("car-1000", 51_000, { mode: "car" }),
        observation("horse-1000", 70_000, { mode: "horse" }),
      ],
      [],
      now,
    );

    expect(
      profiles.map(({ mode, distance, raceCount }) => ({
        mode,
        distance,
        raceCount,
      })),
    ).toEqual([
      { mode: "bike", distance: 1_000, raceCount: 1 },
      { mode: "bike", distance: 1_200, raceCount: 1 },
      { mode: "car", distance: 1_000, raceCount: 1 },
      { mode: "horse", distance: 1_000, raceCount: 1 },
    ]);
  });

  it("makes lower elapsed time and higher derived speed the better direction", () => {
    const [profile] = buildCorePerformanceProfiles(
      [observation("slower", 60_000), observation("faster", 50_000)],
      [],
      now,
    );

    expect(profile).toMatchObject({
      elapsedTime: {
        bestMilliseconds: 50_000,
        medianMilliseconds: 55_000,
        meanMilliseconds: 55_000,
      },
      speed: {
        bestDistanceUnitsPerSecond: 20,
        medianDistanceUnitsPerSecond: 18.182,
      },
      analyticalStatus: "experimental",
    });
  });

  it("keeps fewer than ten exact-distance races hypothesis-only", () => {
    expect(
      buildCorePerformanceProfiles(series(9), [], now)[0]?.sampleStatus,
    ).toBe("hypothesis_only");
    expect(
      buildCorePerformanceProfiles(series(10), [], now)[0]?.sampleStatus,
    ).toBe("minimally_analytical");
  });

  it("uses transparent robust distribution statistics", () => {
    const observations = [
      observation("event-1", 10_000),
      observation("event-2", 20_000),
      observation("event-3", 30_000),
      observation("event-4", 40_000),
    ];
    const [profile] = buildCorePerformanceProfiles(observations, [], now);

    expect(profile?.elapsedTime).toEqual({
      bestMilliseconds: 10_000,
      medianMilliseconds: 25_000,
      meanMilliseconds: 25_000,
      trimmedMeanMilliseconds: 25_000,
      standardDeviationMilliseconds: 11_180.34,
      interquartileRangeMilliseconds: 15_000,
    });
  });

  it("links only the matching mode-distance star profile with its denominators", () => {
    const refresh = refreshStarProfiles([
      {
        eventId: "star-event",
        eventAt: observedAt,
        mode: "bike",
        distance: 1_000,
        gateCount: 6,
        entries: [
          {
            coreId: "core-a",
            goldStar: true,
            blueStar: false,
            starDataStatus: "complete",
          },
          {
            coreId: "core-b",
            goldStar: false,
            blueStar: true,
            starDataStatus: "complete",
          },
        ],
      },
    ]);

    const [profile] = buildCorePerformanceProfiles(
      [observation("performance-event", 50_000)],
      refresh.profiles,
      now,
    );

    expect(profile?.starProfile).toMatchObject({
      coreId: "core-a",
      mode: "bike",
      distance: 1_000,
      goldReceivedRate: { numerator: 1, denominator: 1 },
      blueReceivedRate: { numerator: 0, denominator: 1 },
      goldEligibleRaceCount: 1,
    });
  });

  it("exposes the historical cutoff and stale state independently", () => {
    const [profile] = buildCorePerformanceProfiles(
      [
        observation("older", 60_000, { eventAt: "2026-07-09T00:00:00Z" }),
        observation("latest", 59_000, { eventAt: "2026-07-10T00:00:00Z" }),
      ],
      [],
      now,
    );

    expect(profile).toMatchObject({
      dataCurrentThrough: "2026-07-10T00:00:00Z",
      freshness: "stale",
    });
  });

  it("is deterministic and rejects invalid or duplicate accepted facts", () => {
    const observations = [
      observation("event-b", 60_000),
      observation("event-a", 50_000),
    ];
    expect(buildCorePerformanceProfiles(observations, [], now)).toEqual(
      buildCorePerformanceProfiles([...observations].reverse(), [], now),
    );
    expect(() =>
      buildCorePerformanceProfiles(
        [observation("same", 60_000), observation("same", 50_000)],
        [],
        now,
      ),
    ).toThrow("Duplicate performance observation");
    expect(() =>
      buildCorePerformanceProfiles([observation("invalid", 0)], [], now),
    ).toThrow("Invalid normalized performance observation");
  });
});
