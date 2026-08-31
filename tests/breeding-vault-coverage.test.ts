import { describe, expect, it } from "vitest";

import type {
  BreedingIntelligencePairAssessment,
  BreedingIntelligenceParentAssessment,
} from "@/domain/breeding-intelligence";
import type { BreedingParentAssessment } from "@/domain/breeding-recommendation";
import {
  assessVaultCoverageGaps,
  buildStrategicBreedingBoard,
  type VaultEliteRacer,
  type VaultFNumberSegment,
} from "@/domain/breeding-vault-coverage";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

function racerAssessment(
  coreId: string,
  mode: ProbeMode,
  distanceMetres: number,
  score: number,
): BreedingParentAssessment {
  return {
    coreId,
    coreName: coreId,
    mode,
    distanceMetres,
    status: "target",
    confidence: "high",
    performanceScore: score,
    supportingStrengthScore: score,
    qualityScore: score,
    exactEvidence: null,
    targetDistanceRaceCount: 20,
    totalProfileRaceCount: 100,
    targetDistanceShare: 0.2,
    dominantDistanceMetres: distanceMetres,
    warnings: [],
    reasons: [],
  };
}

function parentAssessment(
  coreId: string,
  mode: ProbeMode,
  distanceMetres: number,
  score: number,
): BreedingIntelligenceParentAssessment {
  return {
    coreId,
    coreName: coreId,
    mode,
    distanceMetres,
    status: "target",
    qualificationPath: "elite_racer",
    racer: racerAssessment(coreId, mode, distanceMetres, score),
    breeder: null,
    breederScopeSource: "unavailable",
    opportunityScore: score,
    warnings: [],
    reasons: [],
  };
}

function pairAssessment(input: {
  id: string;
  mode?: ProbeMode;
  distanceMetres?: number;
  status?: "target" | "watch" | "wait";
  score: number;
  element: string;
  offspringType: string;
  fNumber?: number;
}): BreedingIntelligencePairAssessment {
  const mode = input.mode ?? "bike";
  const distanceMetres = input.distanceMetres ?? 1_200;
  const father = parentAssessment(
    `${input.id}-father`,
    mode,
    distanceMetres,
    input.score,
  );
  const mother = parentAssessment(
    `${input.id}-mother`,
    mode,
    distanceMetres,
    input.score,
  );
  return {
    father,
    mother,
    status: input.status ?? "target",
    pairingStrategy: "racer_x_racer",
    opportunityScore: input.score,
    locallyEligible: true,
    localEligibilityReason: null,
    officialValidation: "valid",
    pairInfo: {
      element: input.element,
      fNumber: input.fNumber ?? 10,
      offspringType: input.offspringType,
    },
    warnings: [],
    reasons: [],
  };
}

function eliteCore(input: {
  coreId: string;
  element: string;
  coreClass: string;
  mode?: ProbeMode;
  distances: readonly number[];
  fNumber?: number;
}): VaultEliteRacer {
  const mode = input.mode ?? "bike";
  return {
    coreId: input.coreId,
    element: input.element,
    coreClass: input.coreClass,
    fNumber: input.fNumber ?? 8,
    eliteScopes: input.distances.map((distanceMetres) => ({
      mode,
      distanceMetres,
    })),
  };
}

describe("breeding vault coverage strategy", () => {
  it("detects a missing elite Water sprint capability", () => {
    const gaps = assessVaultCoverageGaps({
      mode: "bike",
      distanceMetres: 1_200,
      ownedEliteRacers: [
        eliteCore({
          coreId: "metal-sprinter",
          element: "Metal",
          coreClass: "Freak",
          distances: [1_000, 1_200],
        }),
        eliteCore({
          coreId: "fire-sprinter",
          element: "Fire",
          coreClass: "X-Class",
          distances: [1_200, 1_400],
        }),
      ],
    });

    const waterSprint = gaps.find(
      (gap) =>
        gap.window.kind === "band" &&
        gap.window.band === "sprint" &&
        gap.facet === "element" &&
        gap.element === "water",
    );
    expect(waterSprint?.severity).toBe("critical");
    expect(waterSprint?.eliteCoreCount).toBe(0);
  });

  it("detects missing bred-class marathon depth independently of Genesis coverage", () => {
    const gaps = assessVaultCoverageGaps({
      mode: "horse",
      distanceMetres: 2_000,
      ownedEliteRacers: [
        eliteCore({
          coreId: "genesis-mara",
          element: "Earth",
          coreClass: "Genesis",
          mode: "horse",
          distances: [1_800, 2_000, 2_200],
        }),
      ],
    });

    for (const coreClass of ["morphed", "freak", "xclass"] as const) {
      const gap = gaps.find(
        (candidate) =>
          candidate.window.kind === "band" &&
          candidate.window.band === "marathon" &&
          candidate.facet === "core_class" &&
          candidate.coreClass === coreClass,
      );
      expect(gap?.severity).toBe("critical");
      expect(gap?.fillableByBreeding).toBe(true);
    }

    const genesisGap = gaps.find(
      (candidate) =>
        candidate.window.kind === "band" &&
        candidate.window.band === "marathon" &&
        candidate.facet === "core_class" &&
        candidate.coreClass === "genesis",
    );
    expect(genesisGap?.severity).toBe("shallow");
    expect(genesisGap?.fillableByBreeding).toBe(false);
  });

  it("uses projected offspring element and class to prefer an elite pair that fills a critical vault gap", () => {
    const board = {
      mode: "bike" as const,
      distanceMetres: 1_200,
      action: "breed_candidate_available" as const,
      targets: [
        pairAssessment({
          id: "metal",
          score: 97,
          element: "Metal",
          offspringType: "Freak",
        }),
        pairAssessment({
          id: "water",
          score: 95,
          element: "Water",
          offspringType: "Freak",
        }),
      ],
      watches: [],
      waits: [],
    };
    const strategic = buildStrategicBreedingBoard({
      board,
      ownedEliteRacers: [
        eliteCore({
          coreId: "owned-metal",
          element: "Metal",
          coreClass: "Freak",
          distances: [1_000, 1_200, 1_400],
        }),
        eliteCore({
          coreId: "owned-fire",
          element: "Fire",
          coreClass: "Morphed",
          distances: [1_000, 1_200, 1_400],
        }),
      ],
    });

    expect(strategic.targets[0]?.pair.father.coreId).toBe("water-father");
    expect(strategic.targets[0]?.coverageImpact.priority).toBe("critical");
    expect(strategic.targets[0]?.coverageImpact.projectedElement).toBe("water");
  });

  it("never promotes WATCH or WAIT pairs merely because they fill a gap", () => {
    const watch = pairAssessment({
      id: "watch-water",
      status: "watch",
      score: 99,
      element: "Water",
      offspringType: "Xclass",
    });
    const wait = pairAssessment({
      id: "wait-water",
      status: "wait",
      score: 99,
      element: "Water",
      offspringType: "Xclass",
    });
    const strategic = buildStrategicBreedingBoard({
      board: {
        mode: "bike",
        distanceMetres: 1_200,
        action: "wait",
        targets: [],
        watches: [watch],
        waits: [wait],
      },
      ownedEliteRacers: [],
    });

    expect(strategic.action).toBe("wait");
    expect(strategic.targets).toHaveLength(0);
    expect(strategic.watches[0]?.pair.status).toBe("watch");
    expect(strategic.waits[0]?.pair.status).toBe("wait");
    expect(strategic.watches[0]?.coverageImpact.priority).toBe("critical");
  });

  it("supports configurable F-number tournament coverage segments", () => {
    const segments: VaultFNumberSegment[] = [
      {
        id: "f5-or-lower",
        label: "F5 or lower",
        minimumInclusive: 1,
        maximumInclusive: 5,
      },
      {
        id: "above-f15",
        label: "Above F15",
        minimumInclusive: 16,
        maximumInclusive: null,
      },
    ];
    const board = {
      mode: "car" as const,
      distanceMetres: 1_800,
      action: "breed_candidate_available" as const,
      targets: [
        pairAssessment({
          id: "high-f",
          mode: "car",
          distanceMetres: 1_800,
          score: 96,
          element: "Earth",
          offspringType: "X-Class",
          fNumber: 18,
        }),
      ],
      watches: [],
      waits: [],
    };
    const strategic = buildStrategicBreedingBoard({
      board,
      ownedEliteRacers: [],
      fNumberSegments: segments,
    });

    expect(
      strategic.targets[0]?.coverageImpact.matchedGaps.some(
        (gap) => gap.fNumberSegmentId === "above-f15",
      ),
    ).toBe(true);
  });

  it("applies the same gap analysis to Car and Horse modes", () => {
    for (const mode of ["car", "horse"] as const) {
      const gaps = assessVaultCoverageGaps({
        mode,
        distanceMetres: 2_000,
        ownedEliteRacers: [],
      });
      expect(
        gaps.some(
          (gap) =>
            gap.mode === mode &&
            gap.window.kind === "band" &&
            gap.window.band === "marathon" &&
            gap.facet === "element" &&
            gap.element === "water" &&
            gap.severity === "critical",
        ),
      ).toBe(true);
    }
  });
});
