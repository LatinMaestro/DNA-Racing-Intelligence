import { describe, expect, it } from "vitest";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import { evaluateOwnerVaultOpenRaceEnvelope } from "@/domain/open-race-accepted-evaluation";
import type { OpenRaceEligibilityCore } from "@/domain/open-race-eligibility";
import type { DnaCurrentRaceMaterializationRow } from "@/lib/dna-open-lab-current-race-materialization";
import type {
  CanonicalActiveRaceSnapshot,
  CanonicalRaceDocumentMetadata,
  CanonicalRaceFillSnapshot,
} from "@/lib/dna-open-lab-v1-adapters";
import type { DnaOpenLabServingOwnedCore } from "@/lib/neon-dna-open-lab-sync-publication";

const generationId = "11111111-1111-4111-8111-111111111111";
const observedAt = "2026-11-21T10:59:00.000Z";
const hash = "a".repeat(64);
const opponents = ["9001", "9002", "9003"];

function row<T>(sourceRaceId: string, canonical: T) {
  return {
    sourceRaceId,
    observedAt,
    rawEvidenceSha256: hash,
    canonical,
  } satisfies DnaCurrentRaceMaterializationRow<T>;
}

function active(
  raceId: string,
): DnaCurrentRaceMaterializationRow<CanonicalActiveRaceSnapshot> {
  return row(raceId, {
    sourceType: "active_race_snapshot",
    sourceRaceId: raceId,
    status: "open",
    displayName: `Open Bike ${raceId}`,
    mode: "bike",
    format: "normal",
    raceClassSourceValue: 2,
    startAt: null,
    endAt: null,
  });
}

function fill(
  raceId: string,
  entrantCoreIds: readonly string[],
): DnaCurrentRaceMaterializationRow<CanonicalRaceFillSnapshot> {
  return row(raceId, {
    sourceType: "race_fill_snapshot",
    sourceRaceId: raceId,
    status: "open",
    gateCount: 6,
    filledGateCount: entrantCoreIds.length,
    entrantCoreIds,
    entryConfirmationsBySourceKey: {},
  });
}

function document(
  raceId: string,
  entrantCoreIds: readonly string[],
): DnaCurrentRaceMaterializationRow<CanonicalRaceDocumentMetadata> {
  return row(raceId, {
    sourceType: "race_document",
    sourceRaceId: raceId,
    status: "open",
    mode: "bike",
    format: "normal",
    raceClassSourceValue: 2,
    distanceMetres: 1600,
    gateCount: 6,
    filledGateCount: entrantCoreIds.length,
    entrantCoreIds,
  });
}

function ownedCore(sourceCoreId: string): DnaOpenLabServingOwnedCore {
  return {
    generationId,
    observedAt,
    rawEvidenceSha256: hash,
    canonical: {
      sourceType: "core_details",
      sourceCoreId,
      displayName: `Owned ${sourceCoreId}`,
      coreClass: "Genesis",
      element: "Metal",
      fNumber: 1,
      sex: "female",
      colorSourceValue: null,
      fatherSourceCoreId: null,
      fatherNameSourceValue: null,
      motherSourceCoreId: null,
      motherNameSourceValue: null,
    },
  };
}

function performance(
  coreId: string,
  medianMilliseconds: number,
): CorePerformanceProfile {
  return {
    coreId,
    mode: "bike",
    distance: 1600,
    dataCurrentThrough: "2026-11-20T11:00:00.000Z",
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

const ownedCores = [
  ...Array.from({ length: 213 }, (_, index) => ownedCore(String(index + 1))),
  ownedCore("10457"),
];
const eligibilityCores: readonly OpenRaceEligibilityCore[] = ownedCores.map(
  ({ canonical }) => ({
    coreId: canonical.sourceCoreId,
    activeOwnership: "confirmed",
    availability:
      canonical.sourceCoreId === "10457" ? "available" : "unavailable",
    coreClass: "Genesis",
    element: "Metal",
    fNumber: 1,
    maidenState: "not_eligible",
    attributeEvidence: "complete",
  }),
);
const profiles = [
  performance("10457", 60_000),
  performance("9001", 61_000),
  performance("9002", 63_000),
  performance("9003", 64_000),
];

function evaluate(
  overrides: Partial<
    Parameters<typeof evaluateOwnerVaultOpenRaceEnvelope>[0]
  > = {},
) {
  return evaluateOwnerVaultOpenRaceEnvelope({
    scan: {
      evaluatedAt: "2026-11-21T11:00:00.000Z",
      maximumAgeMinutes: 5,
      ownedCores,
      currentRaces: {
        generationId,
        activeRaces: [active("race-open")],
        raceFills: [fill("race-open", opponents)],
      },
      documents: [document("race-open", opponents)],
    },
    profiles,
    fields: [
      {
        raceId: "race-open",
        eligibility: {
          evaluationId: "eligibility-race-open",
          evaluatedAt: "2026-11-21T11:00:00.000Z",
          vaultDataCurrentThrough: "2026-11-20T11:00:00.000Z",
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
        evaluatedAt: "2026-11-21T11:00:00.000Z",
        dataCurrentThrough: "2026-11-20T11:00:00.000Z",
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
    ...overrides,
  });
}

describe("Open Race canonical owner-envelope evaluation", () => {
  it("runs the complete read-only replay without an intermediate scan handoff", () => {
    expect(evaluate()).toMatchObject({
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
      advisoryOnly: true,
      queueAllowed: false,
      gameEntryAllowed: false,
    });
  });

  it("fails closed if the canonical field no longer meets the half-filled rule", () => {
    const result = evaluate({
      scan: {
        evaluatedAt: "2026-11-21T11:00:00.000Z",
        maximumAgeMinutes: 5,
        ownedCores,
        currentRaces: {
          generationId,
          activeRaces: [active("race-open")],
          raceFills: [fill("race-open", ["9001", "9002"])],
        },
        documents: [document("race-open", ["9001", "9002"])],
      },
      fields: [],
    });
    expect(result).toMatchObject({
      racesScanned: 1,
      qualifyingRaceCount: 0,
      evaluations: [],
      gameEntryAllowed: false,
    });
  });
});
