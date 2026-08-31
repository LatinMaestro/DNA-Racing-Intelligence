import { describe, expect, it } from "vitest";

import {
  buildBreederQualityBenchmark,
  findBreederAssessment,
  type BreederOffspringOutcome,
  type BreederScope,
} from "@/domain/breeder-quality";
import {
  assessBreedingIntelligenceParent,
  type BreedingIntelligenceParentCandidate,
} from "@/domain/breeding-intelligence";
import {
  assessBreedingParent,
  type BreedingParentCandidate,
} from "@/domain/breeding-recommendation";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

function racingCandidate(input: {
  mode: ProbeMode;
  distanceMetres: number;
  coreId?: string;
  source?: "vault" | "arena";
  elite?: boolean;
}): BreedingParentCandidate {
  const elite = input.elite ?? true;
  return {
    coreId: input.coreId ?? `${input.mode}-${input.distanceMetres}`,
    coreName: "Cross-mode contract Core",
    sex: "male",
    source: input.source ?? "arena",
    performance: [
      {
        mode: input.mode,
        distanceMetres: input.distanceMetres,
        sampleSize: 12,
        medianElapsedTimeMilliseconds: 100_000,
        medianSpeedMetresPerSecond: 20,
        medianSpeedPercentile: elite ? 98 : 70,
        upperTailSpeedPercentile: elite ? 96 : 72,
        bestSpeedPercentile: elite ? 99 : 80,
        benchmarkPopulationSize: 300,
        latestObservedAt: "2026-08-31T00:00:00.000Z",
      },
    ],
    currentStrength: {
      power: elite ? 86 : 75,
      adjustedOdds: elite ? 83 : 70,
      variance: 70,
      observedAt: "2026-08-31T00:00:00.000Z",
    },
    distanceProfile: [
      { distanceMetres: input.distanceMetres, raceCount: 12 },
    ],
    lineage: { parents: [], grandparents: [] },
    freshness: "current",
    available: true,
    starEvidenceAuthority: "unavailable",
  };
}

function breederUniverse(
  scope: BreederScope,
  eliteParent: string,
): BreederOffspringOutcome[] {
  const outcomes: BreederOffspringOutcome[] = [];
  for (let index = 0; index < 3; index++) {
    outcomes.push({
      parentCoreId: eliteParent,
      coParentCoreId: `elite-mate-${index}`,
      offspringCoreId: `${eliteParent}-child-${index}`,
      scope,
      offspringQualityPercentile: 99,
      expectedQualityPercentile: 60,
      residualPercentile: 99,
      offspringRaceSampleSize: 12,
      benchmarkPopulationSize: 300,
      offspringCreatedAt: `2025-01-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
      expectedModelCutoff: "2025-01-01T00:00:00.000Z",
      evaluationCutoff: "2026-08-31T00:00:00.000Z",
    });
  }
  for (let parentIndex = 0; parentIndex < 10; parentIndex++) {
    for (let childIndex = 0; childIndex < 3; childIndex++) {
      outcomes.push({
        parentCoreId: `baseline-${parentIndex}`,
        coParentCoreId: `baseline-mate-${parentIndex}-${childIndex}`,
        offspringCoreId: `baseline-${parentIndex}-child-${childIndex}`,
        scope,
        offspringQualityPercentile: 50,
        expectedQualityPercentile: 55,
        residualPercentile: 40,
        offspringRaceSampleSize: 12,
        benchmarkPopulationSize: 300,
        offspringCreatedAt: `2025-02-${String(childIndex + 10).padStart(2, "0")}T00:00:00.000Z`,
        expectedModelCutoff: "2025-02-01T00:00:00.000Z",
        evaluationCutoff: "2026-08-31T00:00:00.000Z",
      });
    }
  }
  return outcomes;
}

describe("breeding methodology cross-mode and distance contract", () => {
  it.each([
    ["bike", 900],
    ["bike", 2_300],
    ["car", 900],
    ["car", 2_300],
    ["horse", 900],
    ["horse", 2_300],
  ] as const)(
    "applies the elite-racer gate to %s at %im without a hard-coded distance whitelist",
    (mode, distanceMetres) => {
      const candidate = racingCandidate({ mode, distanceMetres, source: "arena" });
      const result = assessBreedingParent(candidate, { mode, distanceMetres });
      expect(result.status).toBe("target");
      expect(result.mode).toBe(mode);
      expect(result.distanceMetres).toBe(distanceMetres);
    },
  );

  it.each([
    ["bike", 1_400],
    ["car", 2_200],
    ["horse", 1_000],
  ] as const)(
    "applies the same offspring-lift breeder gate to %s at %im",
    (mode, distanceMetres) => {
      const scope: BreederScope = { mode, distanceMetres };
      const benchmark = buildBreederQualityBenchmark({
        scope,
        outcomes: breederUniverse(scope, "elite-breeder"),
      });
      const result = findBreederAssessment(benchmark, "elite-breeder");
      expect(result?.status).toBe("target");
      expect(result?.scope).toEqual(scope);
    },
  );

  it("allows an average Horse racer to qualify through exact-distance breeder evidence", () => {
    const mode: ProbeMode = "horse";
    const distanceMetres = 2_300;
    const coreId = "horse-breeder";
    const scope: BreederScope = { mode, distanceMetres };
    const racing = racingCandidate({
      mode,
      distanceMetres,
      coreId,
      source: "arena",
      elite: false,
    });
    const candidate: BreedingIntelligenceParentCandidate = {
      racing,
      breederBenchmarks: [
        buildBreederQualityBenchmark({
          scope,
          outcomes: breederUniverse(scope, coreId),
        }),
      ],
    };

    const result = assessBreedingIntelligenceParent(candidate, {
      mode,
      distanceMetres,
    });
    expect(result.racer.status).not.toBe("target");
    expect(result.breeder?.status).toBe("target");
    expect(result.status).toBe("target");
    expect(result.qualificationPath).toBe("elite_breeder");
  });
});
