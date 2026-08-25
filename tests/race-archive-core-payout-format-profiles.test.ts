import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { corePayoutFormatProfilesFromRaceArchive } from "../lib/race-archive-core-payout-format-profiles";

function observation(input: {
  naturalKey: string;
  sourceCoreId: string;
  eventAt: string;
  finishPosition: number;
  payout: string | null;
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
    elapsedMilliseconds: 10_000,
    payoutMechanismSourceValue: input.payout,
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

describe("archive-backed Core payout-format profiles", () => {
  it("preserves normalized format identity, chronology, results and distance diversity", () => {
    const result = corePayoutFormatProfilesFromRaceArchive({
      observations: [
        observation({
          naturalKey: "event-1:core-1",
          sourceCoreId: "core-1",
          eventAt: "2026-08-02T00:00:00.000Z",
          finishPosition: 2,
          payout: " Top   3 ",
          distance: 1000,
        }),
        observation({
          naturalKey: "event-2:core-1",
          sourceCoreId: "core-1",
          eventAt: "2026-08-01T00:00:00.000Z",
          finishPosition: 1,
          payout: "top 3",
          distance: 1500,
        }),
        observation({
          naturalKey: "event-3:core-1",
          sourceCoreId: "core-1",
          eventAt: "2026-08-03T00:00:00.000Z",
          finishPosition: 4,
          payout: "Top 3",
          distance: 1000,
        }),
        observation({
          naturalKey: "event-4:core-1",
          sourceCoreId: "core-1",
          eventAt: "2026-08-04T00:00:00.000Z",
          finishPosition: 3,
          payout: null,
          distance: 2000,
        }),
      ],
      refreshedAt: "2026-08-25T00:00:00.000Z",
      maximumObservations: 100,
      maximumProfiles: 10,
    });

    expect(result.acceptedFormatEntryCount).toBe(3);
    expect(result.profiles).toEqual([
      {
        sourceCoreId: "core-1",
        mode: "bike",
        payoutFormatKey: "top 3",
        payoutFormatLabel: "Top 3",
        dataCurrentThrough: "2026-08-03T00:00:00.000Z",
        firstEventAt: "2026-08-01T00:00:00.000Z",
        raceCount: 3,
        winCount: 1,
        topThreeCount: 2,
        exactDistanceCount: 2,
        timedRaceCount: 3,
        refreshedAt: "2026-08-25T00:00:00.000Z",
      },
    ]);
  });

  it("keeps Core, mode and payout format profiles separate", () => {
    const result = corePayoutFormatProfilesFromRaceArchive({
      observations: [
        observation({
          naturalKey: "event-1:core-1",
          sourceCoreId: "core-1",
          eventAt: "2026-08-01T00:00:00.000Z",
          finishPosition: 1,
          payout: "Winner Take All",
        }),
        observation({
          naturalKey: "event-2:core-2",
          sourceCoreId: "core-2",
          eventAt: "2026-08-02T00:00:00.000Z",
          finishPosition: 2,
          payout: "Top 3",
          mode: "car",
          distance: 1500,
        }),
      ],
      refreshedAt: "2026-08-25T00:00:00.000Z",
      maximumObservations: 10,
      maximumProfiles: 10,
    });

    expect(result.profiles).toHaveLength(2);
    expect(result.profiles.map((profile) => profile.payoutFormatKey)).toEqual([
      "winner take all",
      "top 3",
    ]);
  });

  it("fails closed on duplicate evidence and configured bounds", () => {
    const row = observation({
      naturalKey: "event-1:core-1",
      sourceCoreId: "core-1",
      eventAt: "2026-08-01T00:00:00.000Z",
      finishPosition: 1,
      payout: "Top 3",
    });

    expect(() =>
      corePayoutFormatProfilesFromRaceArchive({
        observations: [row, row],
        refreshedAt: "2026-08-25T00:00:00.000Z",
        maximumObservations: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/duplicate Race evidence/);

    expect(() =>
      corePayoutFormatProfilesFromRaceArchive({
        observations: [row, { ...row, naturalKey: "event-2:core-2" }],
        refreshedAt: "2026-08-25T00:00:00.000Z",
        maximumObservations: 1,
        maximumProfiles: 10,
      }),
    ).toThrow(/observation bound/);
  });
});
