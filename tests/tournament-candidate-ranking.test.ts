import { describe, expect, it } from "vitest";

import {
  rankTournamentCandidates,
  type TournamentCandidateInput,
} from "@/domain/tournament-candidate-ranking";

function candidate(
  coreId: string,
  metricRank: number | null,
  overrides: Partial<TournamentCandidateInput> = {},
): TournamentCandidateInput {
  return {
    coreId,
    leaderboardGroupId: "fire",
    eligibility: "eligible",
    metricStatus: metricRank === null ? "unavailable" : "complete",
    metricRank,
    metricEvidenceLabel: metricRank === null ? null : `Rank ${metricRank}`,
    timeEvidence: "competitive",
    historicalStarSupport: "neutral",
    evidenceConfidence: "high",
    maidenState: "not_eligible",
    maidenModeDisposition: "not_applicable",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

function ranking(candidates: readonly TournamentCandidateInput[]) {
  return rankTournamentCandidates({
    tournamentId: "season-12",
    bracketId: "horse-fire",
    candidates,
  });
}

describe("tournament candidate ranking", () => {
  it("uses only the configured metric rank for review ordering", () => {
    const result = ranking([
      candidate("metric-first", 1, {
        historicalStarSupport: "neutral",
      }),
      candidate("star-supported", 2, {
        historicalStarSupport: "supports",
      }),
    ]);

    expect(
      result.candidates.map((item) => [
        item.coreId,
        item.configuredMetricRank,
        item.reviewOrder,
      ]),
    ).toEqual([
      ["metric-first", 1, 1],
      ["star-supported", 2, 2],
    ]);
    expect(result).toEqual(
      expect.objectContaining({
        orderingAuthority: "configured_qualification_metric",
        historicalStarsRole: "supporting_rationale_only",
        actionableRecommendationAllowed: false,
      }),
    );
    expect(result.candidates.every((item) => !item.starUsedForOrdering)).toBe(
      true,
    );
  });

  it("keeps leaderboard groups separate", () => {
    const result = ranking([
      candidate("fire-one", 1),
      candidate("water-one", 1, { leaderboardGroupId: "water" }),
    ]);

    expect(
      result.candidates.map((item) => [
        item.leaderboardGroupId,
        item.reviewOrder,
      ]),
    ).toEqual([
      ["fire", 1],
      ["water", 1],
    ]);
  });

  it("preserves legitimate ties from the configured metric", () => {
    const result = ranking([
      candidate("tied-a", 1),
      candidate("tied-b", 1, { historicalStarSupport: "supports" }),
    ]);

    expect(
      result.candidates.map((item) => [
        item.configuredMetricRank,
        item.reviewOrder,
      ]),
    ).toEqual([
      [1, 1],
      [1, 1],
    ]);
  });

  it("labels a weaker Maiden mode preserve ME even when metric-ranked first", () => {
    const result = ranking([
      candidate("me-core", 1, {
        maidenState: "eligible",
        maidenModeDisposition: "preserve_for_stronger_mode",
      }),
    ]);

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        disposition: "preserve_me",
        reviewOrder: null,
        warnings: expect.arrayContaining(["PRESERVE_ME"]),
      }),
    );
  });

  it("does not let star support override weak time evidence", () => {
    const result = ranking([
      candidate("weak-time", 1, {
        timeEvidence: "weak",
        historicalStarSupport: "supports",
      }),
    ]);

    expect(result.candidates[0]).toEqual(
      expect.objectContaining({
        disposition: "hold",
        reviewOrder: null,
        warnings: expect.arrayContaining(["TIME_EVIDENCE_WEAK"]),
      }),
    );
  });

  it("holds partial, unresolved, low-confidence or stale evidence", () => {
    const cases: TournamentCandidateInput[] = [
      candidate("partial", 1, { metricStatus: "partial" }),
      candidate("eligibility", 2, { eligibility: "review_required" }),
      candidate("low-confidence", 3, { evidenceConfidence: "low" }),
      candidate("stale", 4, { freshness: "stale" }),
    ];

    expect(
      ranking(cases).candidates.every((item) => item.disposition === "hold"),
    ).toBe(true);
  });

  it("keeps ineligible and unavailable candidates out of review ordering", () => {
    const result = ranking([
      candidate("ineligible", 1, { eligibility: "ineligible" }),
      candidate("unavailable", null),
    ]);

    expect(
      result.candidates.map((item) => [item.coreId, item.disposition]),
    ).toEqual([
      ["ineligible", "ineligible"],
      ["unavailable", "hold"],
    ]);
    expect(result.candidates.every((item) => item.reviewOrder === null)).toBe(
      true,
    );
  });

  it("preserves separate freshness timestamps and rejects inverted order", () => {
    expect(() =>
      ranking([
        candidate("core", 1, {
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ]),
    ).toThrow("Last imported cannot precede data current through.");
  });

  it("fails closed on duplicate core identities", () => {
    expect(() => ranking([candidate("same", 1), candidate("same", 2)])).toThrow(
      "must appear only once",
    );
  });

  it("requires rank and metric availability to agree", () => {
    expect(() =>
      ranking([candidate("bad", null, { metricStatus: "complete" })]),
    ).toThrow("requires a rank");
    expect(() =>
      ranking([candidate("bad", 1, { metricStatus: "unavailable" })]),
    ).toThrow("cannot carry a rank");
  });
});
