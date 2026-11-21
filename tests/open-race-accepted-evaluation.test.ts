import { describe, expect, it } from "vitest";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import { evaluateOpenRaceAcceptedEvidence } from "@/domain/open-race-accepted-evaluation";
import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";
import type { OpenRacePerformanceEvidence } from "@/domain/open-race-performance-evidence";
import type {
  OpenRaceRankedCandidate,
  OpenRaceRankedOpponent,
} from "@/domain/open-race-pre-entry-ranking";

const opportunity: OpenRaceScanOpportunity = {
  raceId: "race-99",
  mode: "bike",
  distanceMetres: 1600,
  format: "normal",
  gateCount: 6,
  filledGateCount: 3,
  vacantGates: 3,
  enteredOpponentCoreIds: ["9001", "9002", "9003"],
  observedAt: "2026-11-21T09:29:00.000Z",
  eligibility: "needs_owner_core_restriction_check",
  rank: "not_evaluated",
  gameEntryAllowed: false,
};

function acceptedProfile(
  coreId: string,
  medianMilliseconds: number,
): CorePerformanceProfile {
  return {
    coreId,
    mode: "bike",
    distance: 1600,
    dataCurrentThrough: "2026-11-20T09:30:00.000Z",
    freshness: "current",
    raceCount: 12,
    sampleStatus: "minimally_analytical",
    elapsedTime: {
      bestMilliseconds: medianMilliseconds - 1_000,
      medianMilliseconds,
      meanMilliseconds: medianMilliseconds + 100,
      trimmedMeanMilliseconds: medianMilliseconds + 50,
      standardDeviationMilliseconds: 500,
      interquartileRangeMilliseconds: 700,
    },
    speed: {
      bestMetresPerSecond: 27.119,
      medianMetresPerSecond: 26.667,
    },
    starProfile: null,
    analyticalStatus: "experimental",
  };
}

function timeProfile(medianTimeMs: number) {
  return {
    optimisticTimeMs: medianTimeMs - 1_000,
    medianTimeMs,
    conservativeTimeMs: medianTimeMs + 1_000,
    sampleCount: 12,
    sampleStatus: "minimally_analytical" as const,
  };
}

function candidate(
  coreId: string,
  medianTimeMs: number,
): OpenRaceRankedCandidate {
  return {
    coreId,
    eligibilityStatus: "eligible",
    mode: "bike",
    distanceMeters: 1600,
    profile: timeProfile(medianTimeMs),
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
    mode: "bike",
    distanceMeters: 1600,
    profile: timeProfile(medianTimeMs),
  };
}

const acceptedCandidates = [acceptedProfile("10457", 60_000)];
const acceptedOpponents = [
  acceptedProfile("9001", 61_000),
  acceptedProfile("9002", 63_000),
  acceptedProfile("9003", 64_000),
];
const eligibleCandidates = [candidate("10457", 60_000)];
const opponents = [
  opponent("9001", 61_000),
  opponent("9002", 63_000),
  opponent("9003", 64_000),
];

function evidence(
  overrides: Partial<OpenRacePerformanceEvidence> = {},
): OpenRacePerformanceEvidence {
  return {
    raceId: "race-99",
    authority: "accepted_profile_read_model",
    status: "ready",
    candidateProfiles: acceptedCandidates,
    opponentProfiles: acceptedOpponents.map((profile) => ({
      coreId: profile.coreId,
      profile,
    })),
    missingCandidateCoreIds: [],
    missingOpponentCoreIds: [],
    staleOrUnknownCoreIds: [],
    hypothesisOnlyCoreIds: [],
    reasons: [],
    readyForRanking: true,
    gameEntryAllowed: false,
    ...overrides,
  };
}

function evaluate(
  overrides: Partial<
    Parameters<typeof evaluateOpenRaceAcceptedEvidence>[0]
  > = {},
) {
  return evaluateOpenRaceAcceptedEvidence({
    evidence: evidence(),
    evaluation: {
      rankingId: "ranking-race-99",
      evaluatedAt: "2026-11-21T09:30:00.000Z",
      dataCurrentThrough: "2026-11-20T09:30:00.000Z",
      freshness: "current",
      materialGapMs: 50,
      opportunity,
      eligibleCandidates,
      opponents,
    },
    ...overrides,
  });
}

describe("Open Race accepted evidence evaluation", () => {
  it("passes matched accepted evidence into the existing advisory evaluator", () => {
    expect(evaluate()).toMatchObject({
      raceId: "race-99",
      decision: "provisional_pick",
      recommendedCoreId: "10457",
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("returns unavailable without invoking ranking when evidence is incomplete", () => {
    const result = evaluate({
      evidence: evidence({
        status: "unavailable",
        reasons: ["One entered opponent lacks exact-context history."],
        readyForRanking: false,
      }),
    });
    expect(result).toMatchObject({
      decision: "unavailable",
      recommendedCoreId: null,
      ranking: null,
      gameEntryAllowed: false,
    });
  });

  it("rejects a ranked median that does not match accepted history", () => {
    expect(() =>
      evaluate({
        evaluation: {
          rankingId: "ranking-race-99",
          evaluatedAt: "2026-11-21T09:30:00.000Z",
          dataCurrentThrough: "2026-11-20T09:30:00.000Z",
          freshness: "current",
          materialGapMs: 50,
          opportunity,
          eligibleCandidates: [candidate("10457", 59_999)],
          opponents,
        },
      }),
    ).toThrow("does not match accepted exact-context history");
  });

  it("rejects candidate or opponent identity changes", () => {
    expect(() =>
      evaluate({
        evidence: evidence({ candidateProfiles: [] }),
      }),
    ).toThrow("ranked candidates do not match");
    expect(() =>
      evaluate({
        evidence: evidence({ opponentProfiles: [] }),
      }),
    ).toThrow("ranked opponents do not match");
  });
});
