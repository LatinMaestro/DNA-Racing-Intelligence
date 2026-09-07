import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "@/lib/race-archive-core-analytical-observations";
import {
  proLeagueExactFormatEvidenceFromRaceArchive,
  publishedProLeagueRaceTypeFromArchive,
} from "@/lib/race-archive-pro-league-exact-format";

function observation(input: {
  row: number;
  coreId?: string;
  mode?: "bike" | "car" | "horse";
  distance?: number;
  gateCount?: number;
  payout?: string | null;
  finishPosition?: number;
  milliseconds?: number;
  eventAt?: string;
}): RaceArchiveCoreAnalyticalObservation {
  const coreId = input.coreId ?? "core-a";
  return {
    datasetVersionId: "dataset-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: input.row,
    naturalKey: `race-${input.row}:${coreId}`,
    fingerprintSha256: "a".repeat(64),
    sourceEventId: `race-${input.row}`,
    sourceCoreId: coreId,
    eventAt:
      input.eventAt ??
      `2026-09-06T00:00:${String(input.row).padStart(2, "0")}.000Z`,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1_000,
    gateCount: input.gateCount ?? 6,
    goldStarEligible: true,
    goldStar: false,
    blueStar: false,
    starDataStatus: "complete",
    finishPosition: input.finishPosition ?? 1,
    elapsedMilliseconds: input.milliseconds ?? 90_000 + input.row,
    payoutMechanismSourceValue:
      input.payout === undefined ? "Top 3" : input.payout,
    sourceFormat: "NORMAL",
    sourceRaceClass: null,
  };
}

const bounds = {
  maximumObservations: 1_000,
  maximumBenchmarks: 100,
  maximumProfiles: 100,
};

describe("Race archive Pro League exact-format evidence", () => {
  it.each([
    ["Winner Take All", 2, 1_000, "1v1"],
    ["wta", 4, 1_000, "4 gate WTA"],
    ["Top 3", 6, 1_000, "6 gate madness"],
    ["top-three", 24, 2_200, "24 gate madness"],
  ] as const)(
    "maps %s / %i gates / %im only through a published race cell",
    (payout, gateCount, distanceMetres, raceType) => {
      expect(
        publishedProLeagueRaceTypeFromArchive({
          payoutMechanismSourceValue: payout,
          gateCount,
          distanceMetres,
        }),
      ).toMatchObject({ status: "accepted", cell: { raceType } });
    },
  );

  it("does not invent unsupported or unpublished race-type authority", () => {
    expect(
      publishedProLeagueRaceTypeFromArchive({
        payoutMechanismSourceValue: null,
        gateCount: 6,
        distanceMetres: 1_000,
      }),
    ).toEqual({ status: "missing_format" });
    expect(
      publishedProLeagueRaceTypeFromArchive({
        payoutMechanismSourceValue: "Double Up",
        gateCount: 6,
        distanceMetres: 1_000,
      }),
    ).toEqual({ status: "unsupported_format" });
    expect(
      publishedProLeagueRaceTypeFromArchive({
        payoutMechanismSourceValue: "Top 3",
        gateCount: 8,
        distanceMetres: 1_000,
      }),
    ).toEqual({ status: "unpublished_cell" });
  });

  it("builds independent population and Core evidence for one exact published cell", () => {
    const coreA = Array.from({ length: 10 }, (_, index) =>
      observation({
        row: index + 1,
        milliseconds: 90_000 + index * 1_000,
        finishPosition: (index % 3) + 1,
      }),
    );
    const coreB = Array.from({ length: 3 }, (_, index) =>
      observation({
        row: index + 20,
        coreId: "core-b",
        milliseconds: 110_000 + index * 1_000,
        finishPosition: index + 1,
      }),
    );
    const result = proLeagueExactFormatEvidenceFromRaceArchive({
      observations: [...coreA, ...coreB],
      refreshedAt: "2026-09-07T00:00:00.000Z",
      ...bounds,
    });

    expect(result).toMatchObject({
      inputObservationCount: 13,
      acceptedPublishedCellEntryCount: 13,
      nonBikeEntryCount: 0,
      missingFormatEntryCount: 0,
      unsupportedFormatEntryCount: 0,
      unpublishedCellEntryCount: 0,
      unbenchmarkedPublishedCellEntryCount: 0,
    });
    expect(result.benchmarks).toHaveLength(1);
    expect(result.benchmarks[0]).toMatchObject({
      raceType: "6 gate madness",
      distanceMetres: 1_000,
      resultRule: "top_three",
      mapIds: ["map-1", "map-3"],
      raceEntryCount: 13,
      coreCount: 2,
      winningEntryCount: 5,
      topThreeEntryCount: 13,
      winningP25Milliseconds: 93_000,
      winningMedianMilliseconds: 96_000,
      winningP75Milliseconds: 99_000,
    });
    expect(result.profiles).toHaveLength(2);
    expect(result.profiles[0]).toMatchObject({
      sourceCoreId: "core-a",
      raceType: "6 gate madness",
      distanceMetres: 1_000,
      raceCount: 10,
      sampleStatus: "minimally_analytical",
      freshness: "current",
      benchmarkAssessment: "winning_range",
      elapsedTime: {
        bestMilliseconds: 90_000,
        medianMilliseconds: 94_500,
        trimmedMeanMilliseconds: 94_500,
      },
      speed: {
        bestMetresPerSecond: 11.111,
        medianMetresPerSecond: 10.582,
      },
      supportingEvidence: {
        outcomes: { status: "available", winCount: 4, topThreeCount: 10 },
        goldStar: { status: "unavailable" },
        blueStar: { status: "unavailable" },
        oppositionAdjustedStars: { status: "unavailable" },
        strongOpposition: { status: "unavailable" },
      },
    });
    expect(result.profiles[1]).toMatchObject({
      sourceCoreId: "core-b",
      raceCount: 3,
      sampleStatus: "hypothesis_only",
      benchmarkAssessment: "outside_top_three_range",
    });
  });

  it("keeps race type and exact distance in separate benchmark cells", () => {
    const observations = [
      observation({ row: 1, payout: "Top 3", gateCount: 6, distance: 1_000 }),
      observation({ row: 2, payout: "Top 3", gateCount: 6, distance: 1_200 }),
      observation({
        row: 3,
        payout: "Winner Take All",
        gateCount: 4,
        distance: 1_000,
      }),
    ];
    const result = proLeagueExactFormatEvidenceFromRaceArchive({
      observations,
      refreshedAt: "2026-09-07T00:00:00.000Z",
      ...bounds,
    });
    expect(
      result.benchmarks.map(({ raceType, distanceMetres }) => [
        raceType,
        distanceMetres,
      ]),
    ).toEqual([
      ["4 gate WTA", 1_000],
      ["6 gate madness", 1_000],
      ["6 gate madness", 1_200],
    ]);
  });

  it("reports excluded evidence classes without treating them as favourable", () => {
    const result = proLeagueExactFormatEvidenceFromRaceArchive({
      observations: [
        observation({ row: 1, mode: "horse" }),
        observation({ row: 2, payout: null }),
        observation({ row: 3, payout: "Double Up" }),
        observation({ row: 4, gateCount: 8 }),
        observation({ row: 5, finishPosition: 4 }),
      ],
      refreshedAt: "2026-09-07T00:00:00.000Z",
      ...bounds,
    });
    expect(result).toMatchObject({
      inputObservationCount: 5,
      acceptedPublishedCellEntryCount: 1,
      nonBikeEntryCount: 1,
      missingFormatEntryCount: 1,
      unsupportedFormatEntryCount: 1,
      unpublishedCellEntryCount: 1,
      unbenchmarkedPublishedCellEntryCount: 1,
      benchmarks: [],
      profiles: [],
    });
  });

  it("fails closed on duplicate, future or over-bound evidence", () => {
    const duplicate = observation({ row: 1 });
    expect(() =>
      proLeagueExactFormatEvidenceFromRaceArchive({
        observations: [duplicate, duplicate],
        refreshedAt: "2026-09-07T00:00:00.000Z",
        ...bounds,
      }),
    ).toThrow("duplicate race entry");
    expect(() =>
      proLeagueExactFormatEvidenceFromRaceArchive({
        observations: [
          observation({ row: 1, eventAt: "2026-09-08T00:00:00.000Z" }),
        ],
        refreshedAt: "2026-09-07T00:00:00.000Z",
        ...bounds,
      }),
    ).toThrow("point-in-time cutoff");
    expect(() =>
      proLeagueExactFormatEvidenceFromRaceArchive({
        observations: [observation({ row: 1 }), observation({ row: 2 })],
        refreshedAt: "2026-09-07T00:00:00.000Z",
        ...bounds,
        maximumObservations: 1,
      }),
    ).toThrow("observation bound");
    expect(() =>
      proLeagueExactFormatEvidenceFromRaceArchive({
        observations: [
          observation({ row: 1, gateCount: 6, finishPosition: 7 }),
        ],
        refreshedAt: "2026-09-07T00:00:00.000Z",
        ...bounds,
      }),
    ).toThrow("cannot exceed observation.gateCount");
  });
});
