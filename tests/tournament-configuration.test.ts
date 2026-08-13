import { describe, expect, it } from "vitest";

import {
  assessTournamentConfigurationAuthority,
  normalizeTournamentRuleConfiguration,
  type TournamentRuleConfiguration,
} from "@/domain/tournament-configuration";

function configuration(
  overrides: Partial<TournamentRuleConfiguration> = {},
): TournamentRuleConfiguration {
  return {
    tournamentId: "season-12-cup",
    tournamentLabel: "Season 12 Cup",
    seasonLabel: "Season 12",
    qualificationStartsAt: "2026-09-01T00:00:00.000Z",
    qualificationEndsAt: "2026-09-07T23:59:59.000Z",
    bracketId: "bike-metal-fire",
    splitLabel: "Bike Metal + Fire",
    mode: "bike",
    eligibleDistancesMetres: [1_600, 1_200],
    gateCount: 8,
    entryFee: { amount: "0.010000000000000000", asset: "USD" },
    raceFormat: "paid qualification",
    eligibility: {
      breeds: ["Genesis", "Elite"],
      classes: ["Bike"],
      elements: ["Metal", "Fire"],
      fNumbers: [3, 1, 2],
      fNumberRanges: [{ minimum: 4, maximum: 6 }],
      groups: [
        {
          id: "metal-fire",
          label: "Metal + Fire",
          breeds: [],
          classes: ["Bike"],
          elements: ["Metal", "Fire"],
          fNumbers: [],
          fNumberRanges: [],
        },
      ],
    },
    leaderboard: {
      splitDimension: "element_group",
      groups: [{ id: "metal-fire", label: "Metal + Fire" }],
      qualifyingRaceSemantics: "shared",
    },
    qualification: {
      minimumRaceCount: 5,
      target: { kind: "percentage", value: "10.0000" },
      rankingMetric: "top_x_finishes",
      topFinishPosition: 3,
      pointsTable: {},
      customScoringConfiguration: {},
    },
    discoveryRelevance: "priority",
    evidence: {
      status: "confirmed",
      notes: "Confirmed owner-entered rules.",
      sourceEvidence: "Rules screenshot 2026-08-10.",
      provenance: { source: "owner_entry", revision: 1 },
    },
    campaignAction: {
      kind: "configured",
      action: "Review the strongest eligible candidates.",
      ownerAcknowledgedAt: "2026-08-11T10:00:00.000Z",
      evidence: "Bound to the confirmed rule entry.",
      configurationVersion: "rules-v1",
      candidateSnapshotVersion: "snapshot-v3",
    },
    configurationVersion: "rules-v1",
    candidateSnapshotVersion: "snapshot-v3",
    updatedAt: "2026-08-11T10:00:00.000Z",
    ...overrides,
  };
}

describe("Tournament rule configuration", () => {
  it("normalizes exact values, ordering, grouping and percentage targets", () => {
    expect(normalizeTournamentRuleConfiguration(configuration())).toMatchObject(
      {
        eligibleDistancesMetres: [1_200, 1_600],
        entryFee: { amount: "0.01", asset: "USD" },
        eligibility: {
          elements: ["Fire", "Metal"],
          fNumbers: [1, 2, 3],
          fNumberRanges: [{ minimum: 4, maximum: 6 }],
        },
        qualification: {
          target: { kind: "percentage", value: "10" },
          rankingMetric: "top_x_finishes",
          topFinishPosition: 3,
        },
      },
    );
  });

  it("accepts each supported ranking metric with its required configuration", () => {
    for (const rankingMetric of [
      "fastest_single_time",
      "median_time",
      "average_time",
      "wins",
      "best_finish",
    ] as const) {
      expect(
        normalizeTournamentRuleConfiguration(
          configuration({
            qualification: {
              ...configuration().qualification,
              rankingMetric,
              topFinishPosition: null,
            },
          }),
        ).qualification.rankingMetric,
      ).toBe(rankingMetric);
    }

    expect(
      normalizeTournamentRuleConfiguration(
        configuration({
          qualification: {
            ...configuration().qualification,
            rankingMetric: "points",
            topFinishPosition: null,
            pointsTable: { "1": "10.00", "2": "6" },
          },
        }),
      ).qualification.pointsTable,
    ).toEqual({ "1": "10", "2": "6" });

    expect(
      normalizeTournamentRuleConfiguration(
        configuration({
          qualification: {
            ...configuration().qualification,
            rankingMetric: "custom",
            topFinishPosition: null,
            customScoringConfiguration: { formula: "best_three" },
          },
        }),
      ).qualification.customScoringConfiguration,
    ).toEqual({ formula: "best_three" });
  });

  it("fails closed for uncertain, incomplete or unbound rule evidence", () => {
    expect(
      assessTournamentConfigurationAuthority(
        configuration({
          qualificationStartsAt: null,
          evidence: {
            status: "uncertain",
            notes: "",
            sourceEvidence: "",
            provenance: {},
          },
          leaderboard: {
            splitDimension: "element_group",
            groups: [],
            qualifyingRaceSemantics: "separate",
          },
          candidateSnapshotVersion: null,
        }),
      ),
    ).toEqual({
      status: "review_required",
      reasons: [
        "CAMPAIGN_ACTION_BINDING_DRIFT",
        "CANDIDATE_SNAPSHOT_UNBOUND",
        "LEADERBOARD_GROUPS_MISSING",
        "QUALIFICATION_WINDOW_INCOMPLETE",
        "RULE_EVIDENCE_UNCERTAIN",
        "SOURCE_EVIDENCE_MISSING",
      ],
      actionableRecommendationAllowed: false,
    });
  });

  it("rejects safe schema placeholders as authoritative rules", () => {
    expect(
      assessTournamentConfigurationAuthority(
        configuration({
          seasonLabel: "Unspecified",
          entryFee: { amount: "0", asset: "Unspecified" },
          raceFormat: "Unspecified",
          candidateSnapshotVersion: "snapshot-unbound",
        }),
      ),
    ).toMatchObject({
      status: "review_required",
      reasons: [
        "CAMPAIGN_ACTION_BINDING_DRIFT",
        "CANDIDATE_SNAPSHOT_UNBOUND",
        "ENTRY_FEE_RULE_INCOMPLETE",
        "RACE_FORMAT_RULE_INCOMPLETE",
        "SEASON_RULE_INCOMPLETE",
      ],
      actionableRecommendationAllowed: false,
    });
  });

  it("keeps free-text campaign actions review-only until bound", () => {
    const result = assessTournamentConfigurationAuthority(
      configuration({
        campaignAction: {
          kind: "review_only_free_text",
          action: "Run more attempts",
          ownerAcknowledgedAt: null,
          evidence: null,
        },
      }),
    );
    expect(result).toMatchObject({
      status: "review_required",
      actionableRecommendationAllowed: false,
      reasons: ["FREE_TEXT_CAMPAIGN_ACTION", "OWNER_ACKNOWLEDGEMENT_MISSING"],
    });
  });

  it("fails closed when a configured action is bound to older evidence", () => {
    expect(
      assessTournamentConfigurationAuthority(
        configuration({
          campaignAction: {
            kind: "configured",
            action: "Review candidates",
            ownerAcknowledgedAt: "2026-08-11T10:00:00.000Z",
            evidence: "Owner-reviewed evidence.",
            configurationVersion: "rules-v0",
            candidateSnapshotVersion: "snapshot-v2",
          },
        }),
      ),
    ).toMatchObject({
      status: "review_required",
      actionableRecommendationAllowed: false,
      reasons: ["CAMPAIGN_ACTION_BINDING_DRIFT"],
    });
  });

  it("allows an authoritative confirmed configuration", () => {
    expect(assessTournamentConfigurationAuthority(configuration())).toEqual({
      status: "authoritative",
      reasons: [],
      actionableRecommendationAllowed: true,
    });
  });

  it("rejects missing required timestamps at runtime", () => {
    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          updatedAt: null as unknown as string,
        }),
      ),
    ).toThrow("Tournament update timestamp is required");

    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          campaignAction: {
            kind: "configured",
            action: "Continue",
            ownerAcknowledgedAt: null as unknown as string,
            evidence: "Owner-confirmed evidence.",
            configurationVersion: "rules-v1",
            candidateSnapshotVersion: "snapshot-v3",
          },
        }),
      ),
    ).toThrow("Campaign action owner acknowledgement is required");
  });

  it("rejects ambiguous qualification, grouping and scoring boundaries", () => {
    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          qualificationEndsAt: "2026-08-31T00:00:00.000Z",
        }),
      ),
    ).toThrow("window is reversed");

    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          qualification: {
            ...configuration().qualification,
            target: { kind: "percentage", value: "100.01" },
          },
        }),
      ),
    ).toThrow("cannot exceed 100");

    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          qualification: {
            ...configuration().qualification,
            rankingMetric: "top_x_finishes",
            topFinishPosition: null,
          },
        }),
      ),
    ).toThrow("requires exactly one X");

    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          eligibility: {
            ...configuration().eligibility,
            fNumberRanges: [
              { minimum: 1, maximum: 3 },
              { minimum: 3, maximum: 5 },
            ],
          },
        }),
      ),
    ).toThrow("must not overlap");

    expect(() =>
      normalizeTournamentRuleConfiguration(
        configuration({
          leaderboard: {
            ...configuration().leaderboard,
            groups: [
              { id: "one", label: "Same" },
              { id: "two", label: "Same" },
            ],
          },
        }),
      ),
    ).toThrow("must be unambiguous");
  });
});
