import { describe, expect, it } from "vitest";

import {
  compareMaidenModes,
  type MaidenComparisonMode,
  type MaidenModeProjectionInput,
} from "@/domain/maiden-cross-mode-comparison";

const thresholds = {
  strongestModeGapPoints: 5,
  projectionVersion: "synthetic-v1",
} as const;

function projection(
  mode: MaidenComparisonMode,
  value: number,
  overrides: Partial<MaidenModeProjectionInput> = {},
): MaidenModeProjectionInput {
  return {
    coreId: "core-me",
    mode,
    bestDistanceMetres: 1600,
    leaderboardObjective: "fastest_single_time",
    projectedMaidenValueScore: value,
    projectionStatus: "complete",
    timeEvidence: "competitive",
    historicalStarSupport: "neutral",
    evidenceConfidence: "moderate",
    tournamentStructureStatus: "complete",
    availableMaidenTournamentId: null,
    availableMaidenStatus: null,
    alternativeEligibleCoreCount: 2,
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-21T00:00:00Z",
    freshness: "current",
    ...overrides,
  };
}

function compare(inputs?: readonly MaidenModeProjectionInput[]) {
  return compareMaidenModes(
    inputs ?? [
      projection("bike", 68),
      projection("car", 90),
      projection("horse", 72),
    ],
    thresholds,
  );
}

describe("Maiden cross-mode comparison", () => {
  it("compares Bike, Car and Horse before identifying the strongest mode", () => {
    const result = compare();
    expect(result.strongestProjectedMode).toBe("car");
    expect(
      result.modes.map(({ mode, projectedRank }) => [mode, projectedRank]),
    ).toEqual([
      ["bike", 3],
      ["car", 1],
      ["horse", 2],
    ]);
    expect(result.actionableRecommendationAllowed).toBe(false);
  });

  it("preserves a weaker available Maiden and waits for the strongest mode", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90),
      projection("horse", 72, {
        availableMaidenTournamentId: "horse-maiden",
        availableMaidenStatus: "upcoming",
      }),
    ]);
    expect(result.modes.find(({ mode }) => mode === "horse")).toEqual(
      expect.objectContaining({
        disposition: "preserve_me",
        warnings: expect.arrayContaining(["PRESERVE_ME"]),
      }),
    );
    expect(result.modes.find(({ mode }) => mode === "car")?.disposition).toBe(
      "wait_for_strongest_mode",
    );
  });

  it("keeps the strongest-mode Maiden behind Gates C and D", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90, {
        availableMaidenTournamentId: "car-maiden",
        availableMaidenStatus: "qualifying",
      }),
      projection("horse", 72),
    ]);
    const car = result.modes.find(({ mode }) => mode === "car")!;
    expect(car.disposition).toBe("strongest_mode_review");
    expect(car.maidenCommitmentAllowed).toBe(false);
    expect(car.warnings).toEqual(
      expect.arrayContaining(["GATE_C_NOT_PASSED", "GATE_D_NOT_PASSED"]),
    );
  });

  it("requires credible evidence in all three modes", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90),
      projection("horse", 72, {
        projectionStatus: "partial",
        evidenceConfidence: "low",
      }),
    ]);
    expect(result.strongestProjectedMode).toBeNull();
    expect(
      result.modes.every(
        ({ disposition }) => disposition === "more_evidence_required",
      ),
    ).toBe(true);
    expect(result.modes[2]!.warnings).toEqual(
      expect.arrayContaining([
        "CROSS_MODE_EVIDENCE_INCOMPLETE",
        "PROJECTION_PARTIAL",
        "LOW_EVIDENCE_CONFIDENCE",
      ]),
    );
  });

  it("does not select a strongest mode when the configured gap is unmet", () => {
    expect(
      compare([
        projection("bike", 86),
        projection("car", 90),
        projection("horse", 72),
      ]).strongestProjectedMode,
    ).toBeNull();
  });

  it("does not let historical star support improve a projected rank", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90, { historicalStarSupport: "neutral" }),
      projection("horse", 72, { historicalStarSupport: "supports" }),
    ]);
    expect(result.strongestProjectedMode).toBe("car");
    expect(
      result.modes.every(
        ({ starsUsedForProjectionScore }) => !starsUsedForProjectionScore,
      ),
    ).toBe(true);
  });

  it("tracks scarce alternative ME cores without changing the strongest mode", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90),
      projection("horse", 72, { alternativeEligibleCoreCount: 0 }),
    ]);
    expect(result.strongestProjectedMode).toBe("car");
    expect(result.modes[2]!.warnings).toContain("ALTERNATIVE_ME_SCARCE");
  });

  it("fails closed on stale or structurally incomplete evidence", () => {
    const result = compare([
      projection("bike", 68),
      projection("car", 90),
      projection("horse", 72, {
        freshness: "stale",
        tournamentStructureStatus: "partial",
      }),
    ]);
    expect(result.strongestProjectedMode).toBeNull();
    expect(result.modes[2]!.warnings).toEqual(
      expect.arrayContaining([
        "IMPORTED_DATA_STALE",
        "TOURNAMENT_STRUCTURE_INCOMPLETE",
      ]),
    );
  });

  it("requires one core and each mode exactly once", () => {
    expect(() =>
      compare([
        projection("bike", 68),
        projection("car", 90, { coreId: "other" }),
        projection("horse", 72),
      ]),
    ).toThrow("must concern one core");
    expect(() =>
      compare([
        projection("bike", 68),
        projection("bike", 90),
        projection("horse", 72),
      ]),
    ).toThrow("each mode exactly once");
  });

  it("validates score, distance, tournament and timestamp consistency", () => {
    expect(() =>
      compare([
        projection("bike", 101),
        projection("car", 90),
        projection("horse", 72),
      ]),
    ).toThrow("zero to 100");
    expect(() =>
      compare([
        projection("bike", 68),
        projection("car", 90),
        projection("horse", 72, {
          availableMaidenTournamentId: "horse-maiden",
        }),
      ]),
    ).toThrow("must be supplied together");
    expect(() =>
      compare([
        projection("bike", 68),
        projection("car", 90),
        projection("horse", 72, {
          dataCurrentThrough: "2026-07-22T00:00:00Z",
          lastImported: "2026-07-21T00:00:00Z",
        }),
      ]),
    ).toThrow("Last imported cannot precede");
  });
});
