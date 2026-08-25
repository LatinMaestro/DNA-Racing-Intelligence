import { describe, expect, it } from "vitest";

import type { RaceArchiveCoreAnalyticalObservation } from "../lib/race-archive-core-analytical-observations";
import { starProfilesFromRaceArchive } from "../lib/race-archive-star-profiles";

function observation(input: {
  eventId: string;
  coreId: string;
  eventAt: string;
  gateCount?: number;
  goldStarEligible?: boolean;
  goldStar: boolean | null;
  blueStar: boolean | null;
  starDataStatus?: "complete" | "partial" | "missing" | "invalid";
  mode?: "bike" | "car" | "horse";
  distance?: number;
}): RaceArchiveCoreAnalyticalObservation {
  const gateCount = input.gateCount ?? 8;
  return {
    datasetVersionId: "version-1",
    importBatchId: "batch-1",
    versionNumber: 1,
    partitionNumber: 0,
    sourceRowNumber: 1,
    naturalKey: `${input.eventId}:${input.coreId}`,
    fingerprintSha256: "a".repeat(64),
    sourceEventId: input.eventId,
    sourceCoreId: input.coreId,
    eventAt: input.eventAt,
    mode: input.mode ?? "bike",
    distance: input.distance ?? 1000,
    gateCount,
    goldStarEligible: input.goldStarEligible ?? gateCount > 3,
    goldStar: input.goldStar,
    blueStar: input.blueStar,
    starDataStatus: input.starDataStatus ?? "complete",
    finishPosition: 1,
    elapsedMilliseconds: 10_000,
    payoutMechanismSourceValue: "Top 3",
    sourceFormat: "Sprint",
    sourceRaceClass: "A",
  };
}

describe("archive-backed star profiles", () => {
  it("preserves valid assignment opportunities and same-Core dual stars", () => {
    const refresh = starProfilesFromRaceArchive({
      observations: [
        observation({
          eventId: "event-1",
          coreId: "core-1",
          eventAt: "2026-08-01T00:00:00.000Z",
          goldStar: true,
          blueStar: true,
        }),
        observation({
          eventId: "event-1",
          coreId: "core-2",
          eventAt: "2026-08-01T00:00:00.000Z",
          goldStar: false,
          blueStar: false,
        }),
      ],
      maximumObservations: 10,
      maximumEvents: 10,
      maximumProfiles: 10,
    });

    expect(refresh.eventValidations).toEqual([
      expect.objectContaining({
        eventId: "event-1",
        status: "valid",
        goldAssignmentCount: 1,
        blueAssignmentCount: 1,
        goldAssignedCoreIds: ["core-1"],
        blueAssignedCoreIds: ["core-1"],
        goldAssignmentOpportunity: true,
        blueAssignmentOpportunity: true,
        sameCoreReceivedBoth: true,
      }),
    ]);
    expect(refresh.profiles).toEqual([
      expect.objectContaining({
        coreId: "core-1",
        raceCount: 1,
        goldEligibleRaceCount: 1,
        goldAssignmentOpportunityCount: 1,
        goldReceivedCount: 1,
        goldNegativeOpportunityCount: 0,
        blueAssignmentOpportunityCount: 1,
        blueReceivedCount: 1,
        blueNegativeOpportunityCount: 0,
        sameCoreReceivedBothCount: 1,
      }),
      expect.objectContaining({
        coreId: "core-2",
        raceCount: 1,
        goldEligibleRaceCount: 1,
        goldAssignmentOpportunityCount: 1,
        goldReceivedCount: 0,
        goldNegativeOpportunityCount: 1,
        blueAssignmentOpportunityCount: 1,
        blueReceivedCount: 0,
        blueNegativeOpportunityCount: 1,
        sameCoreReceivedBothCount: 0,
      }),
    ]);
  });

  it("preserves multi-assignment and incomplete-data anomaly exclusion semantics", () => {
    const refresh = starProfilesFromRaceArchive({
      observations: [
        observation({
          eventId: "event-multi",
          coreId: "core-1",
          eventAt: "2026-08-01T00:00:00.000Z",
          goldStar: true,
          blueStar: false,
        }),
        observation({
          eventId: "event-multi",
          coreId: "core-2",
          eventAt: "2026-08-01T00:00:00.000Z",
          goldStar: true,
          blueStar: true,
        }),
        observation({
          eventId: "event-missing",
          coreId: "core-1",
          eventAt: "2026-08-02T00:00:00.000Z",
          goldStar: null,
          blueStar: null,
          starDataStatus: "missing",
        }),
        observation({
          eventId: "event-missing",
          coreId: "core-2",
          eventAt: "2026-08-02T00:00:00.000Z",
          goldStar: false,
          blueStar: false,
          starDataStatus: "partial",
        }),
      ],
      maximumObservations: 10,
      maximumEvents: 10,
      maximumProfiles: 10,
    });

    const multiple = refresh.eventValidations.find(
      ({ eventId }) => eventId === "event-multi",
    );
    expect(multiple).toMatchObject({
      status: "invalid",
      goldAssignmentCount: 2,
      goldAssignmentOpportunity: false,
      blueAssignmentOpportunity: true,
      warningCodes: ["MULTIPLE_GOLD_ASSIGNMENTS"],
    });
    const missing = refresh.eventValidations.find(
      ({ eventId }) => eventId === "event-missing",
    );
    expect(missing).toMatchObject({
      status: "warning",
      goldAssignmentOpportunity: false,
      blueAssignmentOpportunity: false,
      warningCodes: ["INCOMPLETE_STAR_DATA"],
    });

    const core1 = refresh.profiles.find(({ coreId }) => coreId === "core-1");
    expect(core1).toMatchObject({
      raceCount: 2,
      completeStarDataRaceCount: 1,
      missingStarDataRaceCount: 1,
      goldExcludedAnomalyCount: 2,
      blueAssignmentOpportunityCount: 1,
      blueNegativeOpportunityCount: 1,
      blueExcludedAnomalyCount: 1,
    });
  });

  it("preserves ineligible assignments without treating them as opportunities", () => {
    const refresh = starProfilesFromRaceArchive({
      observations: [
        observation({
          eventId: "event-1",
          coreId: "core-1",
          eventAt: "2026-08-01T00:00:00.000Z",
          gateCount: 3,
          goldStarEligible: false,
          goldStar: true,
          blueStar: true,
        }),
        observation({
          eventId: "event-1",
          coreId: "core-2",
          eventAt: "2026-08-01T00:00:00.000Z",
          gateCount: 3,
          goldStarEligible: false,
          goldStar: false,
          blueStar: false,
        }),
      ],
      maximumObservations: 10,
      maximumEvents: 10,
      maximumProfiles: 10,
    });

    expect(refresh.eventValidations[0]).toMatchObject({
      status: "warning",
      goldStarEligible: false,
      goldAssignmentOpportunity: false,
      warningCodes: ["GOLD_INELIGIBLE_ASSIGNMENT"],
    });
    expect(refresh.profiles[0]).toMatchObject({
      coreId: "core-1",
      goldEligibleRaceCount: 0,
      goldAssignmentOpportunityCount: 0,
      goldIneligibleAssignmentCount: 1,
      goldExcludedAnomalyCount: 0,
    });
  });

  it("fails closed on replay, event metadata conflict and game-rule eligibility conflict", () => {
    const row = observation({
      eventId: "event-1",
      coreId: "core-1",
      eventAt: "2026-08-01T00:00:00.000Z",
      goldStar: true,
      blueStar: false,
    });

    expect(() =>
      starProfilesFromRaceArchive({
        observations: [row, row],
        maximumObservations: 10,
        maximumEvents: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/duplicate Race evidence/);

    expect(() =>
      starProfilesFromRaceArchive({
        observations: [
          row,
          {
            ...observation({
              eventId: "event-1",
              coreId: "core-2",
              eventAt: "2026-08-02T00:00:00.000Z",
              goldStar: false,
              blueStar: true,
            }),
          },
        ],
        maximumObservations: 10,
        maximumEvents: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/metadata changed/);

    expect(() =>
      starProfilesFromRaceArchive({
        observations: [{ ...row, goldStarEligible: false }],
        maximumObservations: 10,
        maximumEvents: 10,
        maximumProfiles: 10,
      }),
    ).toThrow(/eligibility conflicts with game rules/);
  });
});
