import { describe, expect, it } from "vitest";

import {
  classifyHistoricalTournamentRace,
  type HistoricalRaceClassificationInput,
  type TournamentStageRuleInput,
} from "@/domain/tournament-race-classification";

const qualificationRule: TournamentStageRuleInput = {
  ruleId: "horse-maiden-qualification",
  tournamentId: "horse-maiden",
  bracketId: "top-two",
  segment: "qualification",
  startsAt: "2026-07-01T00:00:00Z",
  endsAt: "2026-07-07T23:59:59Z",
  mode: "horse",
  exactDistancesMetres: [1200, 1600],
  gateCounts: [4],
  entryFeeAsset: "DEZ",
  entryFeeAmount: "0.01",
  ruleStatus: "confirmed",
};

function race(
  overrides: Partial<HistoricalRaceClassificationInput> = {},
): HistoricalRaceClassificationInput {
  return {
    raceId: "race-1",
    occurredAt: "2026-07-03T10:00:00Z",
    mode: "horse",
    distanceMetres: 1600,
    gateCount: 4,
    entryFeeAsset: "dez",
    entryFeeAmount: "0.0100",
    sourceSegment: null,
    sourceTournamentId: null,
    sourceBracketId: null,
    sourceEvidence: "absent",
    ...overrides,
  };
}

describe("historical tournament race classification", () => {
  it("confirms an authoritative source stage only when configuration agrees", () => {
    const result = classifyHistoricalTournamentRace(
      race({
        sourceSegment: "qualification",
        sourceTournamentId: "horse-maiden",
        sourceBracketId: "top-two",
        sourceEvidence: "authoritative",
      }),
      [qualificationRule],
    );

    expect(result).toEqual(
      expect.objectContaining({
        segment: "qualification",
        tournamentId: "horse-maiden",
        bracketId: "top-two",
        status: "confirmed",
        aggregateEligible: true,
        requiresReview: false,
      }),
    );
  });

  it("confirms authoritative open-racing evidence without inventing a campaign", () => {
    const result = classifyHistoricalTournamentRace(
      race({
        sourceSegment: "open_racing",
        sourceEvidence: "authoritative",
      }),
      [qualificationRule],
    );

    expect(result).toEqual(
      expect.objectContaining({
        segment: "open_racing",
        tournamentId: null,
        status: "confirmed",
        aggregateEligible: true,
      }),
    );
  });

  it("keeps one exact configured match as a review proposal", () => {
    const result = classifyHistoricalTournamentRace(race(), [
      qualificationRule,
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        segment: "qualification",
        status: "review_proposed",
        confidence: "inferred",
        aggregateEligible: false,
        requiresReview: true,
      }),
    );
    expect(result.warnings).toContain("SOURCE_TOURNAMENT_ID_MISSING");
  });

  it("holds an uncertain configured rule for review", () => {
    const result = classifyHistoricalTournamentRace(race(), [
      { ...qualificationRule, ruleStatus: "uncertain" },
    ]);

    expect(result.warnings).toContain("CONFIGURED_RULE_UNCERTAIN");
    expect(result.aggregateEligible).toBe(false);
  });

  it("does not select between overlapping configured matches", () => {
    const result = classifyHistoricalTournamentRace(race(), [
      qualificationRule,
      {
        ...qualificationRule,
        ruleId: "horse-maiden-double-up",
        bracketId: "double-up",
      },
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        segment: null,
        status: "ambiguous",
        matchedRuleIds: [
          "horse-maiden-double-up",
          "horse-maiden-qualification",
        ],
        aggregateEligible: false,
      }),
    );
  });

  it("surfaces authoritative source and configuration conflict", () => {
    const result = classifyHistoricalTournamentRace(
      race({
        sourceSegment: "final",
        sourceTournamentId: "horse-maiden",
        sourceEvidence: "authoritative",
      }),
      [qualificationRule],
    );

    expect(result.status).toBe("conflict");
    expect(result.warnings).toContain("SOURCE_CONFIGURATION_CONFLICT");
  });

  it("leaves unmatched races unclassified rather than assuming open racing", () => {
    const result = classifyHistoricalTournamentRace(
      race({ occurredAt: "2026-08-03T10:00:00Z" }),
      [qualificationRule],
    );

    expect(result).toEqual(
      expect.objectContaining({
        segment: null,
        status: "unclassified",
        aggregateEligible: false,
      }),
    );
  });

  it("matches exact normalized fee evidence without floating point", () => {
    expect(
      classifyHistoricalTournamentRace(
        race({ entryFeeAmount: "0.010000000000000000" }),
        [qualificationRule],
      ).status,
    ).toBe("review_proposed");
  });

  it("rejects incomplete fee identity and duplicate rule IDs", () => {
    expect(() =>
      classifyHistoricalTournamentRace(
        race({ entryFeeAsset: "DEZ", entryFeeAmount: null }),
        [qualificationRule],
      ),
    ).toThrow("supplied together");

    expect(() =>
      classifyHistoricalTournamentRace(race(), [
        qualificationRule,
        qualificationRule,
      ]),
    ).toThrow("rule IDs must be unique");
  });

  it("rejects source classification hidden behind absent evidence", () => {
    expect(() =>
      classifyHistoricalTournamentRace(
        race({
          sourceEvidence: "absent",
          sourceSegment: "qualification",
        }),
        [qualificationRule],
      ),
    ).toThrow("Absent source evidence");

    expect(() =>
      classifyHistoricalTournamentRace(
        race({
          sourceEvidence: "authoritative",
          sourceSegment: "qualification",
          sourceTournamentId: null,
        }),
        [qualificationRule],
      ),
    ).toThrow("requires a tournament ID");
  });

  it("never claims live tournament state", () => {
    const result = classifyHistoricalTournamentRace(race(), [
      qualificationRule,
    ]);

    expect(result.historicalSnapshotOnly).toBe(true);
    expect(result.liveTournamentStateClaimAllowed).toBe(false);
  });
});
