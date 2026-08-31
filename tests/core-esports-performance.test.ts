import { describe, expect, it } from "vitest";

import { buildCorePerformanceProfiles } from "@/domain/core-performance";
import {
  buildCoreAnalysisEvidenceCoverage,
  buildCoreEsportsPerformanceProfiles,
  coreEsportsProfileAuthority,
  coreEsportsResultRule,
  type CoreEsportsRaceObservation,
} from "@/domain/core-esports-performance";

function observation(
  overrides: Partial<CoreEsportsRaceObservation> = {},
): CoreEsportsRaceObservation {
  return {
    sourceRaceId: "esports-race-1",
    sourceCoreId: "22148",
    status: "completed",
    raceType: "6 gate madness",
    distanceMetres: 1_200,
    gateCount: 6,
    completedAt: "2026-08-30T02:00:00.000Z",
    finishPosition: 2,
    elapsedTimeMilliseconds: 60_000,
    matchId: "match-1",
    mapId: "map-1",
    observedAt: "2026-08-30T03:00:00.000Z",
    sourceAuthority: "dna-open-lab/esports-races",
    ...overrides,
  };
}

describe("Core Esports performance evidence", () => {
  it("records the owner-confirmed public-profile omission as missing coverage", () => {
    expect(coreEsportsProfileAuthority).toMatchObject({
      competition: "pro_league_esports",
      publicCoreProfileCoverage: "omitted",
      traitsSharedWithNormalRacing: true,
    });
  });

  it.each([
    ["1v1", "first_place"],
    ["12 gate WTA", "first_place"],
    ["24 gate madness", "top_three"],
    ["unclassified format", "unknown"],
  ] as const)("uses %s result semantics", (raceType, expected) => {
    expect(coreEsportsResultRule(raceType)).toBe(expected);
  });

  it("partitions Esports by Core, exact race type and exact distance", () => {
    const profiles = buildCoreEsportsPerformanceProfiles({
      observations: [
        observation(),
        observation({
          sourceRaceId: "esports-race-2",
          completedAt: "2026-08-30T02:10:00.000Z",
          observedAt: "2026-08-30T03:00:00.000Z",
          finishPosition: 4,
          elapsedTimeMilliseconds: 66_000,
        }),
        observation({
          sourceRaceId: "esports-race-3",
          raceType: "1v1",
          gateCount: 2,
          finishPosition: 1,
          completedAt: "2026-08-30T02:20:00.000Z",
          observedAt: "2026-08-30T03:00:00.000Z",
        }),
        observation({
          sourceRaceId: "esports-race-4",
          distanceMetres: 1_400,
          completedAt: "2026-08-30T02:30:00.000Z",
          observedAt: "2026-08-30T03:00:00.000Z",
        }),
      ],
      now: new Date("2026-08-31T00:00:00.000Z"),
    });

    expect(profiles).toHaveLength(3);
    expect(profiles[0]).toMatchObject({
      sourceCoreId: "22148",
      raceType: "1v1",
      distanceMetres: 1_200,
      raceCount: 1,
      resultRule: "first_place",
      successCount: 1,
    });
    expect(profiles[1]).toMatchObject({
      raceType: "6 gate madness",
      distanceMetres: 1_200,
      raceCount: 2,
      resultRule: "top_three",
      successCount: 1,
      timedRaceCount: 2,
      elapsedTime: {
        bestMilliseconds: 60_000,
        medianMilliseconds: 63_000,
        meanMilliseconds: 63_000,
        standardDeviationMilliseconds: 3_000,
      },
    });
  });

  it("excludes scheduled and running races from completed Core statistics", () => {
    const profiles = buildCoreEsportsPerformanceProfiles({
      observations: [
        observation({
          sourceRaceId: "scheduled",
          status: "scheduled",
          completedAt: null,
          finishPosition: null,
          elapsedTimeMilliseconds: null,
        }),
        observation({
          sourceRaceId: "running",
          status: "running",
          completedAt: null,
          finishPosition: null,
          elapsedTimeMilliseconds: null,
        }),
      ],
      now: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(profiles).toEqual([]);
  });

  it("retains outcome-only Esports evidence without inventing elapsed metrics", () => {
    const [profile] = buildCoreEsportsPerformanceProfiles({
      observations: [observation({ elapsedTimeMilliseconds: null })],
      now: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(profile).toMatchObject({
      raceCount: 1,
      knownFinishCount: 1,
      timedRaceCount: 0,
      elapsedTime: null,
    });
  });

  it("deduplicates identical API evidence and rejects conflicting duplicates", () => {
    const first = observation();
    expect(
      buildCoreEsportsPerformanceProfiles({
        observations: [first, first],
        now: new Date("2026-08-31T00:00:00.000Z"),
      })[0]?.raceCount,
    ).toBe(1);
    expect(() =>
      buildCoreEsportsPerformanceProfiles({
        observations: [first, { ...first, finishPosition: 3 }],
        now: new Date("2026-08-31T00:00:00.000Z"),
      }),
    ).toThrow(/Conflicting duplicate Esports/);
  });

  it("includes Esports in whole-Core coverage while keeping lane counts separate", () => {
    const normalProfiles = buildCorePerformanceProfiles(
      [
        {
          eventId: "normal-race-1",
          eventAt: "2026-08-29T00:00:00.000Z",
          coreId: "22148",
          mode: "bike",
          distance: 1_200,
          elapsedTimeMilliseconds: 61_000,
        },
      ],
      [],
      new Date("2026-08-31T00:00:00.000Z"),
    );
    const esportsProfiles = buildCoreEsportsPerformanceProfiles({
      observations: [observation()],
      now: new Date("2026-08-31T00:00:00.000Z"),
    });
    expect(
      buildCoreAnalysisEvidenceCoverage({
        normalProfiles,
        esportsProfiles,
      }),
    ).toEqual([
      {
        sourceCoreId: "22148",
        normalRaceCount: 1,
        esportsRaceCount: 1,
        allAnalysedRaceCount: 2,
        intrinsicEvidenceScope: "normal_and_esports",
        esportsPublicProfileCoverage: "omitted",
      },
    ]);
  });
});
