import { describe, expect, it } from "vitest";

import {
  evaluateMaidenBracketSuitability,
  type MaidenBracketSuitabilityInput,
} from "@/domain/maiden-bracket-suitability";

function input(
  overrides: Partial<MaidenBracketSuitabilityInput> = {},
): MaidenBracketSuitabilityInput {
  return {
    coreId: "core-me",
    tournamentId: "car-maiden",
    bracketId: "car-fire",
    mode: "car",
    leaderboardObjective: "median_time",
    configuredDistancesMetres: [1200, 1600],
    distanceEvidence: [
      {
        distanceMetres: 1200,
        timeEvidence: "strong",
        configuredMetricFit: "competitive",
        sampleStatus: "sufficient",
        historicalStarSupport: "supports",
      },
      {
        distanceMetres: 1600,
        timeEvidence: "competitive",
        configuredMetricFit: "strong",
        sampleStatus: "sufficient",
        historicalStarSupport: "neutral",
      },
    ],
    tournamentAvailability: "upcoming",
    tournamentStructureStatus: "complete",
    eligibility: "eligible",
    crossModeDisposition: "strongest_mode",
    lifecycleState: "eligible",
    lifecycleTournamentId: null,
    evidenceConfidence: "moderate",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

describe("Maiden bracket suitability", () => {
  it("creates only a review candidate for a fully supported strongest-mode bracket", () => {
    const result = evaluateMaidenBracketSuitability(input());
    expect(result).toEqual(
      expect.objectContaining({
        disposition: "review_candidate",
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
        liveFieldAvailable: false,
      }),
    );
    expect(
      result.evaluatedDistances.every(({ status }) => status === "suitable"),
    ).toBe(true);
  });

  it("labels a weaker-mode bracket preserve ME", () => {
    const result = evaluateMaidenBracketSuitability(
      input({ crossModeDisposition: "weaker_mode" }),
    );
    expect(result.disposition).toBe("preserve_me");
    expect(result.warnings).toContain("PRESERVE_ME");
  });

  it("holds when any configured distance is missing", () => {
    const result = evaluateMaidenBracketSuitability(
      input({ distanceEvidence: [input().distanceEvidence[0]!] }),
    );
    expect(result.disposition).toBe("hold");
    expect(result.evaluatedDistances[1]!.status).toBe("missing");
    expect(result.warnings).toContain("DISTANCE_EVIDENCE_INCOMPLETE");
  });

  it("does not let strong star support override weak time", () => {
    const evidence = [...input().distanceEvidence];
    evidence[0] = {
      ...evidence[0]!,
      timeEvidence: "weak",
      historicalStarSupport: "supports",
    };
    const result = evaluateMaidenBracketSuitability(
      input({ distanceEvidence: evidence }),
    );
    expect(result.disposition).toBe("hold");
    expect(result.warnings).toContain("TIME_EVIDENCE_WEAK");
    expect(result.evaluatedDistances[0]!.starsUsedToOverrideTime).toBe(false);
  });

  it("holds limited samples and weak configured-metric fit", () => {
    const evidence = [...input().distanceEvidence];
    evidence[1] = {
      ...evidence[1]!,
      sampleStatus: "limited",
      configuredMetricFit: "weak",
    };
    const result = evaluateMaidenBracketSuitability(
      input({ distanceEvidence: evidence }),
    );
    expect(result.disposition).toBe("hold");
    expect(result.warnings).toEqual(
      expect.arrayContaining(["LIMITED_SAMPLE", "METRIC_FIT_WEAK"]),
    );
  });

  it("distinguishes same-tournament commitment from commitment elsewhere", () => {
    const same = evaluateMaidenBracketSuitability(
      input({
        lifecycleState: "committed",
        lifecycleTournamentId: "car-maiden",
      }),
    );
    expect(same.disposition).toBe("review_candidate");
    expect(same.warnings).toContain("COMMITTED_TO_THIS_TOURNAMENT");

    const other = evaluateMaidenBracketSuitability(
      input({
        lifecycleState: "committed",
        lifecycleTournamentId: "horse-maiden",
      }),
    );
    expect(other.disposition).toBe("committed_elsewhere");
    expect(other.warnings).toContain("COMMITTED_ELSEWHERE");
  });

  it("keeps consumed, ineligible and closed states distinct", () => {
    expect(
      evaluateMaidenBracketSuitability(
        input({
          lifecycleState: "consumed",
          lifecycleTournamentId: "car-maiden",
        }),
      ).disposition,
    ).toBe("already_consumed");
    expect(
      evaluateMaidenBracketSuitability(input({ eligibility: "ineligible" }))
        .disposition,
    ).toBe("ineligible");
    expect(
      evaluateMaidenBracketSuitability(
        input({ tournamentAvailability: "closed" }),
      ).disposition,
    ).toBe("closed");
  });

  it("fails closed on incomplete structure, unresolved comparison or stale evidence", () => {
    const result = evaluateMaidenBracketSuitability(
      input({
        tournamentStructureStatus: "partial",
        crossModeDisposition: "unresolved",
        freshness: "stale",
      }),
    );
    expect(result.disposition).toBe("hold");
    expect(result.warnings).toEqual(
      expect.arrayContaining([
        "TOURNAMENT_STRUCTURE_INCOMPLETE",
        "CROSS_MODE_COMPARISON_UNRESOLVED",
        "IMPORTED_DATA_STALE",
      ]),
    );
  });

  it("requires valid lifecycle-to-tournament identity", () => {
    expect(() =>
      evaluateMaidenBracketSuitability(
        input({ lifecycleState: "committed", lifecycleTournamentId: null }),
      ),
    ).toThrow("require one lifecycle tournament");
    expect(() =>
      evaluateMaidenBracketSuitability(
        input({
          lifecycleState: "eligible",
          lifecycleTournamentId: "car-maiden",
        }),
      ),
    ).toThrow("require one lifecycle tournament");
  });

  it("validates configured distance identity and freshness order", () => {
    expect(() =>
      evaluateMaidenBracketSuitability(
        input({ configuredDistancesMetres: [1200, 1200] }),
      ),
    ).toThrow("must be unique");
    expect(() =>
      evaluateMaidenBracketSuitability(
        input({
          distanceEvidence: [
            ...input().distanceEvidence,
            {
              ...input().distanceEvidence[0]!,
              distanceMetres: 2000,
            },
          ],
        }),
      ),
    ).toThrow("must match a configured distance");
    expect(() =>
      evaluateMaidenBracketSuitability(
        input({
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ),
    ).toThrow("Last imported cannot precede");
  });
});
