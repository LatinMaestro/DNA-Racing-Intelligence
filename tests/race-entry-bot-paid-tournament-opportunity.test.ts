import { describe, expect, it } from "vitest";

import {
  screenPaidTournamentQualificationOpportunities,
  type PaidTournamentRaceCandidate,
  type PaidTournamentSegmentSelection,
} from "@/domain/race-entry-bot";

const time = "2026-11-20T14:00:00.000Z";

const segment: PaidTournamentSegmentSelection = {
  tournamentId: "tournament-2026-11",
  segmentId: "horse-1600-class-2",
  rulesetVersion: "rules-v3",
  selectedCoreId: "10457",
  allowedCoreIds: ["10457", "42"],
  mode: "horse",
  distanceMetres: 1600,
  format: "normal",
  raceClassSourceValue: 2,
};

const race: PaidTournamentRaceCandidate = {
  raceId: "race-qualification-1",
  status: "open",
  mode: "horse",
  distanceMetres: 1600,
  format: "normal",
  raceClassSourceValue: 2,
  gateCount: 6,
  filledGateCount: 1,
  entrantCoreIds: ["9001"],
  observedAt: time,
  segmentEligibility: {
    tournamentId: segment.tournamentId,
    segmentId: segment.segmentId,
    rulesetVersion: segment.rulesetVersion,
    status: "verified_eligible",
  },
};

function screen(
  overrides: Partial<
    Parameters<typeof screenPaidTournamentQualificationOpportunities>[0]
  > = {},
) {
  return screenPaidTournamentQualificationOpportunities({
    evaluatedAt: time,
    maximumAgeMinutes: 5,
    segment,
    currentOwnedCoreIds: ["10457", "42", "500"],
    races: [race],
    ...overrides,
  });
}

describe("shared race-entry bot paid tournament opportunity screen", () => {
  it("accepts a verified open race with a vacancy without applying the ordinary half-filled rule", () => {
    expect(screen()).toEqual({
      opportunities: [
        {
          raceId: race.raceId,
          selectedCoreId: "10457",
          enteredOpponentCoreIds: ["9001"],
          filledGateCount: 1,
          vacantGates: 5,
          evaluationStatus: "needs_opponent_comparison",
          queueStatus: "not_queued",
          gameEntryAllowed: false,
        },
      ],
      excluded: [],
      gameEntryAllowed: false,
    });
  });

  it("fails closed on unknown segment eligibility and exact-context mismatch", () => {
    expect(
      screen({
        races: [
          {
            ...race,
            segmentEligibility: {
              ...race.segmentEligibility,
              status: "unknown",
            },
          },
        ],
      }).excluded,
    ).toEqual([
      {
        raceId: race.raceId,
        reason: "segment_not_verified_eligible",
      },
    ]);

    expect(
      screen({
        races: [{ ...race, distanceMetres: 1800 }],
      }).excluded,
    ).toEqual([
      {
        raceId: race.raceId,
        reason: "segment_context_mismatch",
      },
    ]);
  });

  it("rejects a race containing any currently owned Core", () => {
    expect(
      screen({
        races: [
          {
            ...race,
            filledGateCount: 2,
            entrantCoreIds: ["9001", "42"],
          },
        ],
      }).excluded,
    ).toEqual([
      {
        raceId: race.raceId,
        reason: "owned_core_already_entered",
      },
    ]);
  });

  it("rejects closed, stale, full and malformed fields", () => {
    expect(
      screen({ races: [{ ...race, status: "finished" }] }).excluded[0]?.reason,
    ).toBe("not_open");
    expect(
      screen({
        races: [{ ...race, observedAt: "2026-11-20T13:50:00.000Z" }],
      }).excluded[0]?.reason,
    ).toBe("stale_or_invalid_evidence");
    expect(
      screen({
        races: [
          {
            ...race,
            gateCount: 2,
            filledGateCount: 2,
            entrantCoreIds: ["9001", "9002"],
          },
        ],
      }).excluded[0]?.reason,
    ).toBe("field_full_or_invalid");
    expect(
      screen({
        races: [{ ...race, filledGateCount: 2 }],
      }).excluded[0]?.reason,
    ).toBe("field_full_or_invalid");
  });

  it("requires the chosen Core to be both owner-selected and currently owned", () => {
    expect(() =>
      screen({
        segment: {
          ...segment,
          selectedCoreId: "500",
        },
      }),
    ).toThrow("both owner-selected and currently owned");

    expect(() =>
      screen({
        currentOwnedCoreIds: ["42", "500"],
      }),
    ).toThrow("both owner-selected and currently owned");
  });

  it("rejects duplicate race identities before any later queue or execution", () => {
    expect(() => screen({ races: [race, race] })).toThrow("duplicated");
  });
});
