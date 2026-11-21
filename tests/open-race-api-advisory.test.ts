import { describe, expect, it } from "vitest";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import { evaluateOpenRaceApiAdvisories } from "@/domain/open-race-api-advisory";
import type { OpenRaceEligibilityCore } from "@/domain/open-race-eligibility";
import type {
  DnaActiveRace,
  DnaOpenLabResponse,
  DnaRaceDocument,
  DnaRaceFill,
  DnaVaultCore,
} from "@/lib/dna-open-lab-v1-client";

const observedAt = "2026-11-21T12:59:00.000Z";
const evaluatedAt = "2026-11-21T13:00:00.000Z";
const dataCurrentThrough = "2026-11-20T13:00:00.000Z";
const opponents = ["9001", "9002", "9003"];

function response<T>(result: T): DnaOpenLabResponse<T> {
  return {
    result,
    httpStatus: 200,
    rateLimit: {
      limit: 30,
      remaining: 29,
      resetSeconds: 60,
      rateClass: "tier-1",
      retryAfterSeconds: null,
    },
  };
}

const vault: readonly DnaVaultCore[] = [
  ...Array.from({ length: 213 }, (_, index) => ({
    hid: index + 1,
    name: `Owned ${index + 1}`,
    type: "Genesis",
    element: "Metal",
    gender: "Female",
    fno: 1,
  })),
  {
    hid: 10457,
    name: "Owned 10457",
    type: "Genesis",
    element: "Metal",
    gender: "Female",
    fno: 1,
  },
];
const race: DnaActiveRace = {
  rid: "race-open",
  status: "open",
  race_name: "Open Bike race-open",
  format: "normal",
  class: 2,
  cb: 1600,
  rgate: 6,
  hs_in: 3,
  start_time: null,
  end_time: null,
  version: 1,
  rvmode: "bike",
};
const fill: DnaRaceFill = {
  rid: "race-open",
  status: "open",
  rgate: 6,
  hs_in: 3,
  hids: [9001, 9002, 9003],
  entry_txns_confirmed: {},
};
const document: DnaRaceDocument = {
  rid: "race-open",
  status: "open",
  race_name: "Open Bike race-open",
  format: "normal",
  class: 2,
  cb: 1600,
  rgate: 6,
  hs_in: 3,
  version: 1,
  rvmode: "bike",
  hids: [9001, 9002, 9003],
};

function performance(
  coreId: string,
  medianMilliseconds: number,
): CorePerformanceProfile {
  return {
    coreId,
    mode: "bike",
    distance: 1600,
    dataCurrentThrough,
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

const eligibilityCores: readonly OpenRaceEligibilityCore[] = vault.map(
  ({ hid }) => ({
    coreId: String(hid),
    activeOwnership: "confirmed",
    availability: hid === 10457 ? "available" : "unavailable",
    coreClass: "Genesis",
    element: "Metal",
    fNumber: 1,
    maidenState: "not_eligible",
    attributeEvidence: "complete",
  }),
);

function evaluate(raceDocs: readonly DnaRaceDocument[] = [document]) {
  return evaluateOpenRaceApiAdvisories({
    read: {
      client: {
        vaultCoresFull: async () => response(vault),
        racesActive: async () => response([race]),
        raceFills: async () => response([fill]),
        raceDocs: async () => response(raceDocs),
      },
      sourceStatus: "offline_replay",
      vault: "owner-vault",
      generationId: "11111111-1111-4111-8111-111111111111",
      observedAt,
      maximumAgeMinutes: 5,
      maximumActiveRaces: 100,
      maximumRequests: 12,
    },
    profiles: [
      performance("10457", 60_000),
      performance("9001", 61_000),
      performance("9002", 63_000),
      performance("9003", 64_000),
    ],
    fields: [
      {
        raceId: "race-open",
        eligibility: {
          evaluationId: "eligibility-race-open",
          evaluatedAt,
          vaultDataCurrentThrough: dataCurrentThrough,
          freshness: "current",
          rules: {
            ruleSetId: "race-open-rules",
            evidenceStatus: "confirmed",
            allowedClasses: ["Genesis"],
            allowedElements: ["Metal"],
            minimumFNumber: 1,
            maximumFNumber: 1,
            maidenRequirement: "not_restricted",
          },
          cores: eligibilityCores,
        },
        rankingId: "ranking-race-open",
        evaluatedAt,
        dataCurrentThrough,
        freshness: "current",
        materialGapMs: 50,
        eligibleCandidates: [
          {
            coreId: "10457",
            eligibilityStatus: "eligible",
            mode: "bike",
            distanceMeters: 1600,
            profile: timeProfile(60_000),
            historicalStars: {
              goldReceived: 2,
              goldOpportunities: 10,
              blueReceived: 3,
              blueOpportunities: 12,
              evidenceStatus: "complete",
              rationale: ["Accepted historical star support only."],
            },
          },
        ],
        opponents: opponents.map((coreId, index) => ({
          coreId,
          identityStatus: "confirmed" as const,
          mode: "bike" as const,
          distanceMeters: 1600,
          profile: timeProfile([61_000, 63_000, 64_000][index]!),
        })),
      },
    ],
  });
}

describe("Open Race API advisory orchestration", () => {
  it("reads, scans, hard-filters and evaluates the whole Vault", async () => {
    await expect(evaluate()).resolves.toMatchObject({
      status: "ready",
      sourceStatus: "offline_replay",
      requestCount: 4,
      activeRaceCount: 1,
      advisory: {
        racesScanned: 1,
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
        queueAllowed: false,
        gameEntryAllowed: false,
      },
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("fails closed before evaluation when API coverage is incomplete", async () => {
    await expect(evaluate([])).resolves.toMatchObject({
      status: "unavailable",
      reason: "incomplete_race_coverage",
      requestCount: 4,
      advisory: null,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });
});
