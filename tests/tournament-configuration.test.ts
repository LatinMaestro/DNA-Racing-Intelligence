import { describe, expect, it } from "vitest";

import {
  buildTournamentConfiguration,
  type TournamentBracketInput,
} from "@/domain/tournament-configuration";

function bracket(
  overrides: Partial<TournamentBracketInput> = {},
): TournamentBracketInput {
  return {
    bracketId: "top-2",
    name: "Top 2",
    qualificationOpensAt: "2026-08-01T00:00:00Z",
    qualificationClosesAt: "2026-08-08T00:00:00Z",
    mode: "horse",
    exactDistancesMetres: [2200, 1000, 1600],
    gateCount: 4,
    entryFeeAmount: "0.0100",
    entryFeeAsset: "usd",
    raceFormat: "paid",
    eligibleClasses: [],
    eligibleElements: ["Water", "Metal"],
    eligibleFNumbers: [],
    leaderboardSplit: "element",
    leaderboardSplitDescription: null,
    minimumRaceCount: 1,
    rankingMetric: { kind: "fastest_single_time" },
    qualificationThreshold: { kind: "percentage", value: 70 },
    qualificationRacePool: "separate",
    sharedRacePoolId: null,
    ruleStatus: "confirmed",
    ruleEvidence: "Owner-entered tournament rules",
    ...overrides,
  };
}

function configuration(brackets: readonly TournamentBracketInput[]) {
  return buildTournamentConfiguration({
    tournamentId: "horse-maiden-1",
    name: "Horse Maiden",
    season: "Season 1",
    brackets,
  });
}

describe("tournament configuration", () => {
  it("normalizes a confirmed variable bracket deterministically", () => {
    const result = configuration([bracket()]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "confirmed",
        readyForQualificationEvaluation: true,
        warnings: [],
      }),
    );
    expect(result.brackets[0]).toEqual(
      expect.objectContaining({
        exactDistancesMetres: [1000, 1600, 2200],
        entryFeeAmount: "0.01",
        entryFeeAsset: "USD",
      }),
    );
  });

  it("supports median and points leaderboards without code changes", () => {
    const result = configuration([
      bracket({
        bracketId: "double-up",
        name: "Double Up",
        minimumRaceCount: 9,
        rankingMetric: { kind: "median_time" },
      }),
      bracket({
        bracketId: "grand-final",
        name: "Grand Final",
        minimumRaceCount: 7,
        rankingMetric: {
          kind: "points",
          pointsByFinish: ["10", "9.0", "3.5800", "0"],
        },
      }),
    ]);

    expect(result.brackets[0]?.rankingMetric).toEqual({
      kind: "median_time",
    });
    expect(result.brackets[1]?.rankingMetric).toEqual({
      kind: "points",
      pointsByFinish: ["10", "9", "3.58", "0"],
    });
  });

  it("retains unknown shared-race semantics as review-required", () => {
    const result = configuration([
      bracket({ qualificationRacePool: "unknown", ruleStatus: "uncertain" }),
    ]);

    expect(result).toEqual(
      expect.objectContaining({
        status: "review_required",
        readyForQualificationEvaluation: false,
        warnings: ["RACE_POOL_UNKNOWN", "UNCERTAIN_RULE"],
      }),
    );
  });

  it("requires at least two brackets in a declared shared pool", () => {
    expect(() =>
      configuration([
        bracket({
          qualificationRacePool: "shared",
          sharedRacePoolId: "shared-a",
        }),
      ]),
    ).toThrow("at least two brackets");
  });

  it("accepts a genuine shared qualification pool", () => {
    const result = configuration([
      bracket({
        bracketId: "top-2",
        qualificationRacePool: "shared",
        sharedRacePoolId: "shared-a",
      }),
      bracket({
        bracketId: "double-up",
        name: "Double Up",
        minimumRaceCount: 9,
        rankingMetric: { kind: "median_time" },
        qualificationRacePool: "shared",
        sharedRacePoolId: "shared-a",
      }),
    ]);

    expect(result.readyForQualificationEvaluation).toBe(true);
  });

  it("rejects inconsistent race conditions within a shared pool", () => {
    expect(() =>
      configuration([
        bracket({
          bracketId: "top-2",
          qualificationRacePool: "shared",
          sharedRacePoolId: "shared-a",
        }),
        bracket({
          bracketId: "double-up",
          gateCount: 8,
          qualificationRacePool: "shared",
          sharedRacePoolId: "shared-a",
        }),
      ]),
    ).toThrow("same qualification race conditions");
  });

  it("rejects inverted qualification windows and overlapping F-number ranges", () => {
    expect(() =>
      configuration([
        bracket({
          qualificationClosesAt: "2026-07-31T00:00:00Z",
        }),
      ]),
    ).toThrow("close after");
    expect(() =>
      configuration([
        bracket({
          eligibleFNumbers: [
            { minimum: 1, maximum: 8 },
            { minimum: 8, maximum: 12 },
          ],
        }),
      ]),
    ).toThrow("must not overlap");
  });

  it("rejects duplicate exact distances and invalid qualification thresholds", () => {
    expect(() =>
      configuration([bracket({ exactDistancesMetres: [1600, 1600] })]),
    ).toThrow("duplicates");
    expect(() =>
      configuration([
        bracket({
          qualificationThreshold: { kind: "percentage", value: 101 },
        }),
      ]),
    ).toThrow("at most 100");
  });

  it("keeps entry fees exact and rejects negative values", () => {
    expect(
      configuration([bracket({ entryFeeAmount: "0.000000000000000001" })])
        .brackets[0]?.entryFeeAmount,
    ).toBe("0.000000000000000001");
    expect(() => configuration([bracket({ entryFeeAmount: "-0.01" })])).toThrow(
      "cannot be negative",
    );
  });

  it("requires explicit descriptions for custom rules", () => {
    expect(() =>
      configuration([
        bracket({
          rankingMetric: { kind: "custom", description: " " },
        }),
      ]),
    ).toThrow("Custom ranking description");
    expect(() =>
      configuration([
        bracket({
          leaderboardSplit: "custom",
          leaderboardSplitDescription: null,
        }),
      ]),
    ).toThrow("custom leaderboard split");
  });

  it("requires ranking structures to fit the configured gate count", () => {
    expect(() =>
      configuration([
        bracket({
          gateCount: 4,
          rankingMetric: { kind: "top_x_finishes", topX: 5 },
        }),
      ]),
    ).toThrow("cannot exceed gate count");
    expect(() =>
      configuration([
        bracket({
          gateCount: 4,
          rankingMetric: { kind: "points", pointsByFinish: ["3", "2", "1"] },
        }),
      ]),
    ).toThrow("one value per gate");
  });
});
