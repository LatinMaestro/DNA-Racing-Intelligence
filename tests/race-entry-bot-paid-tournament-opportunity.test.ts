import { describe, expect, it } from "vitest";

import type { OpenRacePreEntryRankingInput } from "@/domain/open-race-pre-entry-ranking";
import {
  evaluatePaidTournamentOpponentField,
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
          mode: "horse",
          distanceMetres: 1600,
          format: "normal",
          raceClassSourceValue: 2,
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

function timeProfile(
  medianTimeMs: number,
  overrides: Partial<
    OpenRacePreEntryRankingInput["candidates"][number]["profile"]
  > = {},
) {
  return {
    optimisticTimeMs: medianTimeMs - 100,
    medianTimeMs,
    conservativeTimeMs: medianTimeMs + 100,
    sampleCount: 12,
    sampleStatus: "minimally_analytical" as const,
    ...overrides,
  };
}

function ranking(
  overrides: Partial<OpenRacePreEntryRankingInput> = {},
): OpenRacePreEntryRankingInput {
  return {
    rankingId: "tournament-race-qualification-1",
    evaluatedAt: time,
    dataCurrentThrough: "2026-11-20T13:00:00.000Z",
    freshness: "current",
    fieldStage: "forming",
    mode: "horse",
    distanceMeters: 1600,
    materialGapMs: 20,
    candidates: [
      {
        coreId: "10457",
        eligibilityStatus: "eligible",
        mode: "horse",
        distanceMeters: 1600,
        profile: timeProfile(10_000),
        historicalStars: {
          goldReceived: 2,
          goldOpportunities: 12,
          blueReceived: 1,
          blueOpportunities: 12,
          evidenceStatus: "complete",
          rationale: [
            "Historical stars are supporting evidence and do not alter the time rank.",
          ],
        },
      },
    ],
    opponents: [
      {
        coreId: "9001",
        identityStatus: "confirmed",
        mode: "horse",
        distanceMeters: 1600,
        profile: timeProfile(10_100),
      },
    ],
    ...overrides,
  };
}

describe("shared paid tournament opponent evaluation", () => {
  it("returns a development-only provisional favourable decision from the existing time-led method", () => {
    const opportunity = screen().opportunities[0]!;
    expect(
      evaluatePaidTournamentOpponentField({
        opportunity,
        ranking: ranking(),
      }),
    ).toMatchObject({
      raceId: race.raceId,
      selectedCoreId: "10457",
      decision: "provisional_favourable",
      strongestOpponentCoreId: "9001",
      selectedCoreMarginToStrongestOpponentMs: 100,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("returns avoid only when the existing distribution rule finds the selected Core slower throughout", () => {
    const opportunity = screen().opportunities[0]!;
    const candidate = ranking().candidates[0]!;
    const opponent = ranking().opponents[0]!;
    const result = evaluatePaidTournamentOpponentField({
      opportunity,
      ranking: ranking({
        candidates: [
          {
            ...candidate,
            profile: timeProfile(10_500, {
              optimisticTimeMs: 10_400,
              conservativeTimeMs: 10_600,
            }),
          },
        ],
        opponents: [
          {
            ...opponent,
            profile: timeProfile(10_000, {
              optimisticTimeMs: 9_900,
              conservativeTimeMs: 10_100,
            }),
          },
        ],
      }),
    });
    expect(result.decision).toBe("avoid");
    expect(result.queueAllowed).toBe(false);
    expect(result.gameEntryAllowed).toBe(false);
  });

  it("marks unknown opponent evidence unavailable rather than favourable", () => {
    const opportunity = screen().opportunities[0]!;
    const opponent = ranking().opponents[0]!;
    const result = evaluatePaidTournamentOpponentField({
      opportunity,
      ranking: ranking({
        opponents: [
          {
            ...opponent,
            identityStatus: "unresolved",
            profile: null,
          },
        ],
      }),
    });
    expect(result.decision).toBe("unavailable");
    expect(result.ranking.status).toBe("insufficient_evidence");
  });

  it("rejects ranking data that does not match the screened live field", () => {
    const opportunity = screen().opportunities[0]!;
    const opponent = ranking().opponents[0]!;
    expect(() =>
      evaluatePaidTournamentOpponentField({
        opportunity,
        ranking: ranking({
          opponents: [{ ...opponent, coreId: "different-opponent" }],
        }),
      }),
    ).toThrow("do not match the screened live field");
  });
});
