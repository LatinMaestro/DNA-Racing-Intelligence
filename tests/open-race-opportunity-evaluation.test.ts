import { describe, expect, it } from "vitest";

import { evaluateOpenRaceOpportunity } from "@/domain/open-race-opportunity-evaluation";
import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";
import type {
  OpenRaceRankedCandidate,
  OpenRaceRankedOpponent,
  OpenRaceTimeProfile,
} from "@/domain/open-race-pre-entry-ranking";

const opportunity: OpenRaceScanOpportunity = {
  raceId: "race-77",
  mode: "horse",
  distanceMetres: 1600,
  format: "normal",
  gateCount: 6,
  filledGateCount: 3,
  vacantGates: 3,
  enteredOpponentCoreIds: ["9001", "9002", "9003"],
  observedAt: "2026-11-21T08:29:00.000Z",
  eligibility: "needs_owner_core_restriction_check",
  rank: "not_evaluated",
  gameEntryAllowed: false,
};

function profile(medianTimeMs: number): OpenRaceTimeProfile {
  return {
    optimisticTimeMs: medianTimeMs - 1_000,
    medianTimeMs,
    conservativeTimeMs: medianTimeMs + 1_000,
    sampleCount: 12,
    sampleStatus: "minimally_analytical",
  };
}

function candidate(
  coreId: string,
  medianTimeMs: number,
): OpenRaceRankedCandidate {
  return {
    coreId,
    eligibilityStatus: "eligible",
    mode: "horse",
    distanceMeters: 1600,
    profile: profile(medianTimeMs),
    historicalStars: {
      goldReceived: 2,
      goldOpportunities: 10,
      blueReceived: 3,
      blueOpportunities: 12,
      evidenceStatus: "complete",
      rationale: ["Accepted historical star support only."],
    },
  };
}

function opponent(
  coreId: string,
  medianTimeMs: number,
): OpenRaceRankedOpponent {
  return {
    coreId,
    identityStatus: "confirmed",
    mode: "horse",
    distanceMeters: 1600,
    profile: profile(medianTimeMs),
  };
}

const candidates = [candidate("10457", 60_000), candidate("10458", 62_000)];
const opponents = [
  opponent("9001", 61_000),
  opponent("9002", 63_000),
  opponent("9003", 64_000),
];

function evaluate(
  overrides: Partial<Parameters<typeof evaluateOpenRaceOpportunity>[0]> = {},
) {
  return evaluateOpenRaceOpportunity({
    rankingId: "ranking-race-77",
    evaluatedAt: "2026-11-21T08:30:00.000Z",
    dataCurrentThrough: "2026-11-20T08:30:00.000Z",
    freshness: "current",
    materialGapMs: 50,
    opportunity,
    eligibleCandidates: candidates,
    opponents,
    ...overrides,
  });
}

describe("Open Race verified opportunity evaluation", () => {
  it("selects the strongest eligible Core without enabling queue or entry", () => {
    expect(evaluate()).toMatchObject({
      raceId: "race-77",
      decision: "provisional_pick",
      recommendedCoreId: "10457",
      viableAlternativeCoreIds: ["10458"],
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
      ranking: {
        currentRaceStarsUsed: false,
        raceEntryAllowed: false,
      },
    });
  });

  it("returns AVOID when the best eligible Core is clearly slower", () => {
    const result = evaluate({
      eligibleCandidates: [candidate("10457", 68_000)],
    });
    expect(result.decision).toBe("avoid");
    expect(result.recommendedCoreId).toBeNull();
    expect(result.gameEntryAllowed).toBe(false);
  });

  it("returns unavailable for unresolved opponent evidence", () => {
    const result = evaluate({
      opponents: [
        opponents[0]!,
        opponents[1]!,
        {
          ...opponents[2]!,
          identityStatus: "unresolved",
          profile: null,
        },
      ],
    });
    expect(result.decision).toBe("unavailable");
    expect(result.recommendedCoreId).toBeNull();
    expect(result.explanation).toContain(
      "One or more entered opponents lack confirmed identity and exact-distance history.",
    );
  });

  it("fails closed when evidence does not match the entered field", () => {
    expect(() => evaluate({ opponents: opponents.slice(0, 2) })).toThrow(
      "does not match the current field",
    );
  });
});
