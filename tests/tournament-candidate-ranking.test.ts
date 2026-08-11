import { describe, expect, it } from "vitest";

import {
  rankTournamentCandidates,
  type TournamentCandidateInput,
  type TournamentCandidateRankingInput,
} from "@/domain/tournament-candidate-ranking";

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
