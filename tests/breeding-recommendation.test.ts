import { describe, expect, it } from "vitest";
import {
  assessBreedingPair,
  assessBreedingParent,
  buildBreedingRecommendationBoard,
  defaultEliteBreedingPolicy,
  evaluateConfirmedFamilyRestriction,
  type BreedingExactPerformanceEvidence,
  type BreedingPairCandidate,
  type BreedingParentCandidate,
} from "@/domain/breeding-recommendation";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

function evidence(
  overrides: Partial<BreedingExactPerformanceEvidence> = {},
): BreedingExactPerformanceEvidence {
  return {
    mode: "bike",
    distanceMetres: 1_400,
    sampleSize: 12,
    medianElapsedTimeMilliseconds: 82_000,
    medianSpeedMetresPerSecond: 17.073,
    medianSpeedPercentile: 97,
    upperTailSpeedPercentile: 96,
    bestSpeedPercentile: 99,
    benchmarkPopulationSize: 294,
    latestObservedAt: "2026-08-29T00:00:00.000Z",
    ...overrides,
  };
}

function parent(
  overrides: Partial<BreedingParentCandidate> = {},
): BreedingParentCandidate {
  return {
    coreId: "100",
    coreName: "Elite Core",
    sex: "male",
    source: "vault",
    performance: [evidence()],
    currentStrength: {
      power: 85,
      adjustedOdds: 84,
      variance: 70,
      observedAt: "2026-08-29T00:00:00.000Z",
    },
    distanceProfile: [
      { distanceMetres: 1_000, raceCount: 5 },
      { distanceMetres: 1_400, raceCount: 12 },
      { distanceMetres: 2_200, raceCount: 80 },
    ],
    lineage: { parents: ["1", "2"], grandparents: ["3", "4", "5", "6"] },
    freshness: "current",
    available: true,
    starEvidenceAuthority: "unavailable",
    ...overrides,
  };
}

function pair(
  overrides: Partial<BreedingPairCandidate> = {},
): BreedingPairCandidate {
  return {
    father: parent(),
    mother: parent({
      coreId: "200",
      coreName: "Elite Dam",
      sex: "female",
      lineage: {
        parents: ["11", "12"],
        grandparents: ["13", "14", "15", "16"],
      },
    }),
    officialValidation: "unknown",
    pairInfo: null,
    ...overrides,
  };
}

const modes: readonly ProbeMode[] = ["bike", "car", "horse"];

describe("elite breeding parent gate", () => {
  it.each(modes)("applies the same elite gate to %s", (mode: ProbeMode) => {
    const result = assessBreedingParent(
      parent({ performance: [evidence({ mode })] }),
      { mode, distanceMetres: 1_400 },
    );
    expect(result.status).toBe("target");
  });

  it("keeps Bike, Car and Horse evidence strictly separated", () => {
    const result = assessBreedingParent(
      parent({ performance: [evidence({ mode: "horse" })] }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("wait");
    expect(result.exactEvidence).toBeNull();
  });

  it("does not let a large race count rescue mediocre raw performance", () => {
    const result = assessBreedingParent(
      parent({
        performance: [
          evidence({
            sampleSize: 500,
            medianSpeedPercentile: 80,
            upperTailSpeedPercentile: 85,
            bestSpeedPercentile: 91,
          }),
        ],
        distanceProfile: [{ distanceMetres: 1_400, raceCount: 500 }],
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("wait");
    expect(result.reasons.join(" ")).toMatch(
      /race volume.*cannot rescue average/i,
    );
  });

  it("uses race count for confidence but not quality once minimum evidence is met", () => {
    const small = assessBreedingParent(
      parent({ performance: [evidence({ sampleSize: 10 })] }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    const large = assessBreedingParent(
      parent({ performance: [evidence({ sampleSize: 100 })] }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(small.qualityScore).toBe(large.qualityScore);
    expect(small.status).toBe("target");
    expect(large.status).toBe("target");
    expect(small.confidence).toBe("moderate");
    expect(large.confidence).toBe("high");
  });

  it("treats a mid/marathon-shaped career as context rather than a veto on elite exact-distance performance", () => {
    const result = assessBreedingParent(
      parent({
        distanceProfile: [
          { distanceMetres: 1_400, raceCount: 8 },
          { distanceMetres: 1_800, raceCount: 90 },
          { distanceMetres: 2_200, raceCount: 120 },
        ],
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("target");
    expect(result.warnings).toContain(
      "TARGET_DISTANCE_IS_MINOR_PART_OF_CAREER_PROFILE",
    );
    expect(result.warnings).toContain(
      "CAREER_PROFILE_DOMINATED_BY_ANOTHER_DISTANCE",
    );
  });

  it("does not promote an isolated elite ceiling when the repeatable median is ordinary", () => {
    const result = assessBreedingParent(
      parent({
        performance: [
          evidence({
            sampleSize: 20,
            medianSpeedPercentile: 72,
            upperTailSpeedPercentile: 84,
            bestSpeedPercentile: 99.5,
          }),
        ],
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("watch");
    expect(result.reasons.join(" ")).toMatch(
      /elite ceiling.*repeatable median/i,
    );
  });

  it("keeps an elite but too-small sample on watch", () => {
    const result = assessBreedingParent(
      parent({ performance: [evidence({ sampleSize: 3 })] }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("watch");
    expect(result.warnings).toContain(
      "EXACT_DISTANCE_SAMPLE_TOO_SMALL_FOR_TARGET",
    );
  });

  it("requires supporting power and adjusted odds for a target", () => {
    const result = assessBreedingParent(
      parent({
        currentStrength: {
          power: 79,
          adjustedOdds: 74,
          variance: 99,
          observedAt: "2026-08-29T00:00:00.000Z",
        },
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("watch");
  });

  it("keeps missing supporting strength on watch rather than inventing it", () => {
    const result = assessBreedingParent(
      parent({
        currentStrength: {
          power: null,
          adjustedOdds: null,
          variance: null,
          observedAt: null,
        },
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("watch");
    expect(result.warnings).toContain("SUPPORTING_STRENGTH_INCOMPLETE");
  });

  it("does not promote stale evidence to a target", () => {
    const result = assessBreedingParent(parent({ freshness: "stale" }), {
      mode: "bike",
      distanceMetres: 1_400,
    });
    expect(result.status).toBe("watch");
    expect(result.confidence).toBe("low");
  });

  it("does not rank unavailable parents as targets", () => {
    const result = assessBreedingParent(parent({ available: false }), {
      mode: "bike",
      distanceMetres: 1_400,
    });
    expect(result.status).toBe("wait");
    expect(result.warnings).toContain("PARENT_CURRENTLY_UNAVAILABLE");
  });

  it("does not give Arena ownership or star availability a performance bonus", () => {
    const vault = assessBreedingParent(parent({ source: "vault" }), {
      mode: "bike",
      distanceMetres: 1_400,
    });
    const arena = assessBreedingParent(
      parent({
        source: "arena",
        starEvidenceAuthority: "authoritative",
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(arena.qualityScore).toBe(vault.qualityScore);
    expect(arena.performanceScore).toBe(vault.performanceScore);
  });

  it("keeps exact-distance evidence primary when another distance has more races", () => {
    const result = assessBreedingParent(
      parent({
        performance: [
          evidence(),
          evidence({
            distanceMetres: 2_200,
            sampleSize: 200,
            medianSpeedPercentile: 99.9,
            upperTailSpeedPercentile: 99.9,
            bestSpeedPercentile: 99.9,
          }),
        ],
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.exactEvidence?.distanceMetres).toBe(1_400);
    expect(result.performanceScore).toBeCloseTo(96.8);
  });
});

describe("confirmed family restrictions", () => {
  it("rejects parent-child pairs", () => {
    const father = parent({ coreId: "100" });
    const mother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["100", "9"], grandparents: [] },
    });
    expect(evaluateConfirmedFamilyRestriction(father, mother)).toEqual({
      eligible: false,
      reason: "parent_child",
    });
  });

  it("rejects grandparent-grandchild pairs", () => {
    const father = parent({ coreId: "100" });
    const mother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["8", "9"], grandparents: ["100"] },
    });
    expect(evaluateConfirmedFamilyRestriction(father, mother)).toEqual({
      eligible: false,
      reason: "grandparent_grandchild",
    });
  });

  it("rejects full siblings sharing both parents", () => {
    const father = parent({
      lineage: { parents: ["1", "2"], grandparents: [] },
    });
    const mother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["2", "1"], grandparents: [] },
    });
    expect(evaluateConfirmedFamilyRestriction(father, mother)).toEqual({
      eligible: false,
      reason: "full_siblings",
    });
  });

  it("does not invent a restriction for half siblings", () => {
    const father = parent({
      lineage: { parents: ["1", "2"], grandparents: [] },
    });
    const mother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["1", "3"], grandparents: [] },
    });
    expect(evaluateConfirmedFamilyRestriction(father, mother)).toEqual({
      eligible: true,
      reason: null,
    });
  });
});

describe("elite breeding pair recommendations", () => {
  it("requires both parents to clear the elite target gate", () => {
    const result = assessBreedingPair(pair(), {
      mode: "bike",
      distanceMetres: 1_400,
    });
    expect(result.status).toBe("target");
  });

  it("returns WAIT rather than force a best-available pair with a mediocre parent", () => {
    const mediocreMother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["11", "12"], grandparents: [] },
      performance: [
        evidence({
          medianSpeedPercentile: 82,
          upperTailSpeedPercentile: 86,
          bestSpeedPercentile: 90,
        }),
      ],
    });
    const board = buildBreedingRecommendationBoard({
      mode: "bike",
      distanceMetres: 1_400,
      pairs: [pair({ mother: mediocreMother })],
    });
    expect(board.targets).toHaveLength(0);
    expect(board.action).toBe("wait");
    expect(board.waits).toHaveLength(1);
  });

  it("keeps watch-only pairings out of the breed-candidate action", () => {
    const watchMother = parent({
      coreId: "200",
      sex: "female",
      lineage: { parents: ["11", "12"], grandparents: [] },
      performance: [
        evidence({
          medianSpeedPercentile: 92,
          upperTailSpeedPercentile: 95,
          bestSpeedPercentile: 99,
        }),
      ],
    });
    const board = buildBreedingRecommendationBoard({
      mode: "bike",
      distanceMetres: 1_400,
      pairs: [pair({ mother: watchMother })],
    });
    expect(board.action).toBe("wait");
    expect(board.watches).toHaveLength(1);
  });

  it("rejects officially invalid pairs regardless of performance", () => {
    const result = assessBreedingPair(pair({ officialValidation: "invalid" }), {
      mode: "bike",
      distanceMetres: 1_400,
    });
    expect(result.status).toBe("wait");
    expect(result.warnings).toContain("OFFICIAL_PAIR_VALIDATION_INVALID");
  });

  it("does not let offspring element, F-number or type affect pair quality", () => {
    const fire = assessBreedingPair(
      pair({
        pairInfo: { element: "fire", fNumber: 6, offspringType: "Freak" },
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    const water = assessBreedingPair(
      pair({
        pairInfo: { element: "water", fNumber: 50, offspringType: "X-Class" },
      }),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(water.qualityScore).toBe(fire.qualityScore);
    expect(water.status).toBe(fire.status);
  });

  it("sorts target pairs by performance-led pair quality", () => {
    const strongerMother = parent({
      coreId: "201",
      coreName: "Stronger Dam",
      sex: "female",
      lineage: { parents: ["21", "22"], grandparents: [] },
      performance: [
        evidence({
          medianSpeedPercentile: 99,
          upperTailSpeedPercentile: 99,
          bestSpeedPercentile: 100,
        }),
      ],
    });
    const board = buildBreedingRecommendationBoard({
      mode: "bike",
      distanceMetres: 1_400,
      pairs: [pair(), pair({ mother: strongerMother })],
    });
    expect(board.targets).toHaveLength(2);
    expect(board.targets[0]?.mother.coreId).toBe("201");
  });

  it("returns WAIT for an empty Arena/pair set instead of fabricating an option", () => {
    const board = buildBreedingRecommendationBoard({
      mode: "horse",
      distanceMetres: 1_200,
      pairs: [],
    });
    expect(board.action).toBe("wait");
    expect(board.targets).toHaveLength(0);
  });

  it("exposes the strict top-five-percent default gate explicitly", () => {
    expect(defaultEliteBreedingPolicy.eliteMedianPercentile).toBe(95);
    expect(defaultEliteBreedingPolicy.watchMedianPercentile).toBe(90);
  });
});
