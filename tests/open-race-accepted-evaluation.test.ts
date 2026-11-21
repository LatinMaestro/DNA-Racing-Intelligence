import { describe, expect, it } from "vitest";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import {
  evaluateOpenRaceAcceptedEvidence,
  evaluateOwnerVaultOpenRaceAdvisories,
} from "@/domain/open-race-accepted-evaluation";
import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";
import type { OwnerVaultOpenRaceScan } from "@/domain/open-race-owner-vault-scanner";
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

describe("whole-Vault Open Race advisory coordination", () => {
  const completeOwnedCoreIds = [
    ...Array.from({ length: 213 }, (_, index) => String(index + 1)),
    "10457",
  ];
  const ownerScan: OwnerVaultOpenRaceScan = {
    sourceGenerationId: "11111111-1111-4111-8111-111111111111",
    ownedCoreCount: 214,
    enteredOpponentCount: 3,
    scan: {
      opportunities: [opportunity],
      excluded: [{ raceId: "race-full", reason: "field_incomplete_or_full" }],
      gameEntryAllowed: false as const,
    },
    ownerCoreUniverse: "complete_serving_generation" as const,
    gameEntryAllowed: false as const,
  };
  const eligibilityCores = completeOwnedCoreIds.map((coreId) => ({
    coreId,
    activeOwnership: "confirmed" as const,
    availability:
      coreId === "10457" ? ("available" as const) : ("unavailable" as const),
    coreClass: "Genesis" as const,
    element: "Metal" as const,
    fNumber: 1,
    maidenState: "not_eligible" as const,
    attributeEvidence: "complete" as const,
  }));
  const field = {
    raceId: "race-99",
    eligibility: {
      evaluationId: "eligibility-race-99",
      evaluatedAt: "2026-11-21T09:30:00.000Z",
      vaultDataCurrentThrough: "2026-11-20T09:30:00.000Z",
      freshness: "current" as const,
      rules: {
        ruleSetId: "race-99-rules",
        evidenceStatus: "confirmed" as const,
        allowedClasses: ["Genesis" as const],
        allowedElements: ["Metal" as const],
        minimumFNumber: 1,
        maximumFNumber: 1,
        maidenRequirement: "not_restricted" as const,
      },
      cores: eligibilityCores,
    },
    rankingId: "ranking-race-99",
    evaluatedAt: "2026-11-21T09:30:00.000Z",
    dataCurrentThrough: "2026-11-20T09:30:00.000Z",
    freshness: "current" as const,
    materialGapMs: 50,
    eligibleCandidates,
    opponents,
  };

  function coordinate(
    overrides: Partial<
      Parameters<typeof evaluateOwnerVaultOpenRaceAdvisories>[0]
    > = {},
  ) {
    return evaluateOwnerVaultOpenRaceAdvisories({
      ownerScan,
      completeOwnedCoreIds,
      profiles: [...acceptedCandidates, ...acceptedOpponents],
      fields: [field],
      ...overrides,
    });
  }

  it("hard-filters all 214 owned Cores before one accepted advisory ranking", () => {
    expect(coordinate()).toMatchObject({
      racesScanned: 2,
      qualifyingRaceCount: 1,
      ownerCoreCount: 214,
      eligibleCandidateComparisons: 1,
      opponentComparisons: 3,
      evaluations: [
        {
          decision: "provisional_pick",
          recommendedCoreId: "10457",
        },
      ],
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("requires eligibility evidence for the complete owner Vault", () => {
    expect(() =>
      coordinate({
        fields: [
          {
            ...field,
            eligibility: {
              ...field.eligibility,
              cores: eligibilityCores.slice(0, 213),
            },
          },
        ],
      }),
    ).toThrow("does not cover the complete owner Vault");
  });

  it("rejects a ranked Core that did not pass hard eligibility", () => {
    expect(() =>
      coordinate({
        fields: [
          {
            ...field,
            eligibleCandidates: [candidate("1", 60_000)],
          },
        ],
      }),
    ).toThrow("do not match hard eligibility");
  });

  it("requires exactly one field package for every verified opportunity", () => {
    expect(() => coordinate({ fields: [] })).toThrow(
      "do not match the verified opportunities",
    );
  });
});
