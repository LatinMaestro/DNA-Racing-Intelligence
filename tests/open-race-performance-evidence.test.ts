import { describe, expect, it } from "vitest";

import type { CorePerformanceProfile } from "@/domain/core-performance";
import type { OpenRaceScanOpportunity } from "@/domain/open-race-live-opportunity-scanner";
import { resolveOpenRacePerformanceEvidence } from "@/domain/open-race-performance-evidence";

const opportunity: OpenRaceScanOpportunity = {
  raceId: "race-88",
  mode: "bike",
  distanceMetres: 1600,
  format: "normal",
  gateCount: 6,
  filledGateCount: 3,
  vacantGates: 3,
  enteredOpponentCoreIds: ["9001", "9002", "9003"],
  observedAt: "2026-11-21T08:59:00.000Z",
  eligibility: "needs_owner_core_restriction_check",
  rank: "not_evaluated",
  gameEntryAllowed: false,
};

function profile(
  coreId: string,
  overrides: Partial<CorePerformanceProfile> = {},
): CorePerformanceProfile {
  return {
    coreId,
    mode: "bike",
    distance: 1600,
    dataCurrentThrough: "2026-11-20T09:00:00.000Z",
    freshness: "current",
    raceCount: 12,
    sampleStatus: "minimally_analytical",
    elapsedTime: {
      bestMilliseconds: 59_000,
      medianMilliseconds: 60_000,
      meanMilliseconds: 60_100,
      trimmedMeanMilliseconds: 60_050,
      standardDeviationMilliseconds: 500,
      interquartileRangeMilliseconds: 700,
    },
    speed: {
      bestMetresPerSecond: 27.119,
      medianMetresPerSecond: 26.667,
    },
    starProfile: null,
    analyticalStatus: "experimental",
    ...overrides,
  };
}

const ownedCoreIds = [
  ...Array.from({ length: 213 }, (_, index) => String(index + 1)),
  "10457",
];
const exactProfiles = [
  profile("10457"),
  profile("9001"),
  profile("9002"),
  profile("9003"),
];

function resolve(
  overrides: Partial<
    Parameters<typeof resolveOpenRacePerformanceEvidence>[0]
  > = {},
) {
  return resolveOpenRacePerformanceEvidence({
    opportunity,
    authority: "accepted_profile_read_model",
    completeOwnedCoreIds: ownedCoreIds,
    eligibleOwnedCoreIds: ["10457"],
    profiles: exactProfiles,
    ...overrides,
  });
}

describe("Open Race accepted performance evidence", () => {
  it("resolves exact-context evidence for an eligible Core and every opponent", () => {
    expect(resolve()).toMatchObject({
      raceId: "race-88",
      status: "ready",
      candidateProfiles: [{ coreId: "10457", mode: "bike", distance: 1600 }],
      opponentProfiles: [
        { coreId: "9001", profile: { coreId: "9001" } },
        { coreId: "9002", profile: { coreId: "9002" } },
        { coreId: "9003", profile: { coreId: "9003" } },
      ],
      readyForRanking: true,
      gameEntryAllowed: false,
    });
  });

  it("does not treat missing opponent history as favourable", () => {
    const result = resolve({ profiles: exactProfiles.slice(0, 3) });
    expect(result.status).toBe("unavailable");
    expect(result.missingOpponentCoreIds).toEqual(["9003"]);
    expect(result.readyForRanking).toBe(false);
  });

  it("ignores off-distance evidence and withholds a strongest-Core claim", () => {
    const result = resolve({
      profiles: [
        ...exactProfiles.filter(({ coreId }) => coreId !== "10457"),
        profile("10457", { distance: 1800 }),
      ],
    });
    expect(result.status).toBe("unavailable");
    expect(result.missingCandidateCoreIds).toEqual(["10457"]);
  });

  it("withholds stale profiles and rejects non-owned eligible Cores", () => {
    const stale = resolve({
      profiles: [
        profile("10457", { freshness: "stale" }),
        ...exactProfiles.slice(1),
      ],
    });
    expect(stale.status).toBe("unavailable");
    expect(stale.staleOrUnknownCoreIds).toEqual(["10457"]);
    expect(() => resolve({ eligibleOwnedCoreIds: ["99999"] })).toThrow(
      "not in the complete owner Vault",
    );
  });

  it("returns unavailable when the hard eligibility check leaves no candidate", () => {
    const result = resolve({ eligibleOwnedCoreIds: [] });
    expect(result.status).toBe("unavailable");
    expect(result.reasons).toContain(
      "No owned Core is confirmed eligible for this race.",
    );
  });
});
