import { describe, expect, it } from "vitest";

import {
  rankTournamentCandidates,
  tournamentDiscoveryRelevanceForExactDistance,
  type TournamentCandidateInput,
  type TournamentCandidateRankingInput,
} from "@/domain/tournament-candidate-ranking";
import type { TournamentRuleConfiguration } from "@/domain/tournament-configuration";

function canonicalRule(): TournamentRuleConfiguration {
  return {
    tournamentId: "season-12",
    tournamentLabel: "Season 12",
    seasonLabel: "Season 12",
    qualificationStartsAt: "2026-08-01T00:00:00.000Z",
    qualificationEndsAt: "2026-08-31T00:00:00.000Z",
    bracketId: "horse-sprint",
    splitLabel: "Horse Sprint Split",
    mode: "horse",
    eligibleDistancesMetres: [1_200, 1_600],
    gateCount: 4,
    entryFee: { amount: "2.5", asset: "ETH" },
    raceFormat: "Four gates; best two results count",
    eligibility: {
      breeds: [],
      classes: [],
      elements: ["Fire"],
      fNumbers: [],
      fNumberRanges: [],
      groups: [],
    },
    leaderboard: {
      splitDimension: "element",
      groups: [{ id: "fire", label: "Fire Group" }],
      qualifyingRaceSemantics: "separate",
    },
    qualification: {
      minimumRaceCount: 10,
      target: { kind: "count", value: 5 },
      rankingMetric: "points",
      topFinishPosition: null,
      pointsTable: { "1": "10" },
      customScoringConfiguration: {},
    },
    discoveryRelevance: "priority",
    evidence: {
      status: "confirmed",
      notes: "",
      sourceEvidence: "Owner-reviewed rules",
      provenance: { source: "owner" },
    },
    campaignAction: null,
    configurationVersion: "config-v3",
    candidateSnapshotVersion: "snapshot-v9",
    updatedAt: "2026-07-31T12:00:00.000Z",
  };
}

function candidate(
  coreId: string,
  metricRank: number | null,
  overrides: Partial<TournamentCandidateInput> = {},
): TournamentCandidateInput {
  return {
    coreId,
    leaderboardGroupId: "fire",
    leaderboardGroupLabel: "Fire Group",
    configurationVersion: "config-v3",
    candidateSnapshotVersion: "snapshot-v9",
    eligibility: "eligible",
    metricStatus: metricRank === null ? "unavailable" : "complete",
    metricRank,
    metricEvidenceLabel: metricRank === null ? null : "Qualification points",
    timeEvidence: "competitive",
    historicalStarSupport: "neutral",
    evidenceConfidence: "high",
    maidenState: "not_eligible",
    maidenModeDisposition: "not_applicable",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    lastImported: "2026-07-21T00:00:00.000Z",
    freshness: "current",
    ...overrides,
  };
}

function input(
  candidates: readonly TournamentCandidateInput[],
  overrides: Partial<TournamentCandidateRankingInput> = {},
): TournamentCandidateRankingInput {
  return {
    tournamentId: "season-12",
    tournamentLabel: "Season 12",
    bracketId: "horse-sprint",
    splitLabel: "Horse Sprint Split",
    mode: "horse",
    eligibleDistancesMetres: [1_600, 1_200],
    discoveryRelevance: "priority",
    qualificationMetricLabel: "Qualification points",
    configurationVersion: "config-v3",
    candidateSnapshotVersion: "snapshot-v9",
    candidates,
    ...overrides,
  };
}

describe("tournament candidate ranking", () => {
  it("keeps leaderboard groups separate and preserves group-scoped ties", () => {
    const result = rankTournamentCandidates(
      input([
        candidate("fire-a", 1),
        candidate("fire-b", 1),
        candidate("water-a", 1, {
          leaderboardGroupId: "water",
          leaderboardGroupLabel: "Water Group",
        }),
      ]),
    );

    expect(
      result.leaderboardGroups.map((group) => [
        group.leaderboardGroupLabel,
        group.candidates.map((item) => [item.coreId, item.groupReviewRank]),
      ]),
    ).toEqual([
      [
        "Fire Group",
        [
          ["fire-a", 1],
          ["fire-b", 1],
        ],
      ],
      ["Water Group", [["water-a", 1]]],
    ]);
  });

  it("binds output to the configured metric, configuration and snapshot", () => {
    const result = rankTournamentCandidates(input([candidate("core", 2)]));
    expect(result).toMatchObject({
      tournamentLabel: "Season 12",
      splitLabel: "Horse Sprint Split",
      qualificationMetricLabel: "Qualification points",
      configurationVersion: "config-v3",
      candidateSnapshotVersion: "snapshot-v9",
      mode: "horse",
      eligibleDistancesMetres: [1_200, 1_600],
      discoveryRelevance: "priority",
      orderingAuthority: "configured_qualification_metric",
      historicalStarsRole: "supporting_rationale_only",
      actionableRecommendationAllowed: false,
    });
    expect(result.leaderboardGroups[0]?.candidates[0]).toMatchObject({
      configuredMetricRank: 2,
      groupReviewRank: 2,
      starUsedForOrdering: false,
      automaticEntryAllowed: false,
    });
  });

  it("binds canonical rule authority and rejects a drifted projection", () => {
    const result = rankTournamentCandidates(
      input([candidate("core", 2, { metricEvidenceLabel: "points" })], {
        qualificationMetricLabel: "points",
        ruleConfiguration: canonicalRule(),
      }),
    );
    expect(result.configurationAuthority).toEqual({
      status: "authoritative",
      reasons: [],
      actionableRecommendationAllowed: true,
    });
    expect(result.ruleConfiguration?.entryFee).toEqual({
      amount: "2.5",
      asset: "ETH",
    });

    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 2, { metricEvidenceLabel: "points" })], {
          qualificationMetricLabel: "points",
          ruleConfiguration: {
            ...canonicalRule(),
            configurationVersion: "config-drifted",
          },
        }),
      ),
    ).toThrow(/does not match the canonical rule configuration/);
  });

  it("matches Discovery relevance by explicit mode and exact distance", () => {
    const configurations = [
      input([], {
        mode: "bike",
        eligibleDistancesMetres: [1_200, 1_400],
        discoveryRelevance: "eligible",
      }),
      input([], {
        tournamentId: "priority-cup",
        bracketId: "priority-split",
        mode: "bike",
        eligibleDistancesMetres: [1_400],
        discoveryRelevance: "priority",
      }),
      input([], {
        tournamentId: "horse-cup",
        bracketId: "horse-split",
        mode: "horse",
        eligibleDistancesMetres: [1_600],
        discoveryRelevance: "priority",
      }),
    ];

    expect(
      tournamentDiscoveryRelevanceForExactDistance(
        configurations,
        "bike",
        1_200,
      ),
    ).toBe("eligible");
    expect(
      tournamentDiscoveryRelevanceForExactDistance(
        configurations,
        "bike",
        1_400,
      ),
    ).toBe("priority");
    expect(
      tournamentDiscoveryRelevanceForExactDistance(
        configurations,
        "bike",
        1_600,
      ),
    ).toBe("none");
  });

  it("rejects invalid or ambiguous Discovery configuration", () => {
    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 1)], {
          mode: "plane" as TournamentCandidateRankingInput["mode"],
        }),
      ),
    ).toThrow("mode is invalid");
    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 1)], { eligibleDistancesMetres: [] }),
      ),
    ).toThrow("positive integer metres");
    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 1)], {
          eligibleDistancesMetres: [1_200, 1_200],
        }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 1)], {
          discoveryRelevance:
            "guessed" as TournamentCandidateRankingInput["discoveryRelevance"],
        }),
      ),
    ).toThrow("relevance is invalid");
  });

  it("rejects candidate evidence bound to different versions", () => {
    expect(() =>
      rankTournamentCandidates(
        input([candidate("core", 1, { configurationVersion: "config-v2" })]),
      ),
    ).toThrow("active versions");
    expect(() =>
      rankTournamentCandidates(
        input([
          candidate("core", 1, { candidateSnapshotVersion: "snapshot-v8" }),
        ]),
      ),
    ).toThrow("active versions");
  });

  it("rejects inconsistent group and metric labels", () => {
    expect(() =>
      rankTournamentCandidates(
        input([
          candidate("first", 1),
          candidate("second", 2, { leaderboardGroupLabel: "Other Group" }),
        ]),
      ),
    ).toThrow("group labels");
    expect(() =>
      rankTournamentCandidates(
        input([
          candidate("core", 1, { metricEvidenceLabel: "Different metric" }),
        ]),
      ),
    ).toThrow("configured metric");
  });

  it("preserves Maiden eligibility for a stronger mode", () => {
    const result = rankTournamentCandidates(
      input([
        candidate("me-core", 1, {
          maidenState: "eligible",
          maidenModeDisposition: "preserve_for_stronger_mode",
        }),
      ]),
    );
    expect(result.leaderboardGroups[0]?.candidates[0]).toMatchObject({
      disposition: "preserve_me",
      groupReviewRank: null,
      warnings: expect.arrayContaining(["PRESERVE_ME"]),
    });
  });

  it("does not let star support override weak time evidence", () => {
    const result = rankTournamentCandidates(
      input([
        candidate("weak-time", 1, {
          timeEvidence: "weak",
          historicalStarSupport: "supports",
        }),
      ]),
    );
    expect(result.leaderboardGroups[0]?.candidates[0]).toMatchObject({
      disposition: "hold",
      groupReviewRank: null,
      warnings: expect.arrayContaining(["TIME_EVIDENCE_WEAK"]),
    });
  });

  it("keeps unavailable and ineligible evidence out of review ordering", () => {
    const result = rankTournamentCandidates(
      input([
        candidate("ineligible", 1, { eligibility: "ineligible" }),
        candidate("unavailable", null),
      ]),
    );
    expect(
      result.leaderboardGroups[0]?.candidates.map((item) => [
        item.coreId,
        item.disposition,
        item.groupReviewRank,
      ]),
    ).toEqual([
      ["ineligible", "ineligible", null],
      ["unavailable", "hold", null],
    ]);
  });

  it("rejects duplicate cores and non-canonical chronology", () => {
    expect(() =>
      rankTournamentCandidates(
        input([candidate("same", 1), candidate("same", 2)]),
      ),
    ).toThrow("only once");
    expect(() =>
      rankTournamentCandidates(
        input([
          candidate("core", 1, {
            dataCurrentThrough: "2026-07-22T00:00:00.000Z",
          }),
        ]),
      ),
    ).toThrow("cannot precede");
  });
});
