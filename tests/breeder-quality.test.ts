import { describe, expect, it } from "vitest";
import {
  buildBreederQualityBenchmark,
  deduplicateBreederOffspringOutcomes,
  findBreederAssessment,
  type BreederOffspringOutcome,
  type BreederScope,
} from "@/domain/breeder-quality";
import {
  assessBreedingIntelligencePair,
  assessBreedingIntelligenceParent,
  buildBreedingIntelligenceBoard,
  type BreedingIntelligenceParentCandidate,
} from "@/domain/breeding-intelligence";
import type { BreedingParentCandidate } from "@/domain/breeding-recommendation";

const bikeScope: BreederScope = { mode: "bike", distanceMetres: null };
const bike1400Scope: BreederScope = { mode: "bike", distanceMetres: 1_400 };

function offspringOutcome(
  parentCoreId: string,
  index: number,
  overrides: Partial<BreederOffspringOutcome> = {},
): BreederOffspringOutcome {
  return {
    parentCoreId,
    coParentCoreId: `mate-${index % 2}`,
    offspringCoreId: `${parentCoreId}-child-${index}`,
    scope: bikeScope,
    offspringQualityPercentile: 50,
    expectedQualityPercentile: 55,
    residualPercentile: 40,
    offspringRaceSampleSize: 12,
    benchmarkPopulationSize: 300,
    offspringCreatedAt: `2025-01-${String(index + 10).padStart(2, "0")}T00:00:00.000Z`,
    expectedModelCutoff: "2024-12-31T00:00:00.000Z",
    evaluationCutoff: "2026-08-30T00:00:00.000Z",
    ...overrides,
  };
}

function eliteBreederUniverse(
  eliteParent = "breeder-elite",
  scope: BreederScope = bikeScope,
): BreederOffspringOutcome[] {
  const outcomes: BreederOffspringOutcome[] = [];
  for (let index = 0; index < 3; index++) {
    outcomes.push(
      offspringOutcome(eliteParent, index, {
        scope,
        coParentCoreId: `elite-mate-${index % 2}`,
        offspringQualityPercentile: 98 + index * 0.2,
        expectedQualityPercentile: 62,
        residualPercentile: 98,
      }),
    );
  }
  for (let parentIndex = 0; parentIndex < 9; parentIndex++) {
    const parentId = `baseline-${parentIndex}`;
    for (let childIndex = 0; childIndex < 3; childIndex++) {
      outcomes.push(
        offspringOutcome(parentId, childIndex, {
          scope,
          coParentCoreId: `${parentId}-mate-${childIndex % 2}`,
          offspringQualityPercentile: 48 + parentIndex * 0.3,
          expectedQualityPercentile: 55,
          residualPercentile: 35 + parentIndex,
        }),
      );
    }
  }
  return outcomes;
}

function racingParent(
  overrides: Partial<BreedingParentCandidate> = {},
): BreedingParentCandidate {
  return {
    coreId: "racer-1",
    coreName: "Racer One",
    sex: "male",
    source: "vault",
    performance: [
      {
        mode: "bike",
        distanceMetres: 1_400,
        sampleSize: 12,
        medianElapsedTimeMilliseconds: 83_000,
        medianSpeedMetresPerSecond: 16.87,
        medianSpeedPercentile: 80,
        upperTailSpeedPercentile: 82,
        bestSpeedPercentile: 90,
        benchmarkPopulationSize: 300,
        latestObservedAt: "2026-08-29T00:00:00.000Z",
      },
    ],
    currentStrength: {
      power: 82,
      adjustedOdds: 80,
      variance: 70,
      observedAt: "2026-08-30T00:00:00.000Z",
    },
    distanceProfile: [{ distanceMetres: 1_400, raceCount: 30 }],
    lineage: { parents: ["p1", "p2"], grandparents: ["g1", "g2"] },
    freshness: "current",
    available: true,
    starEvidenceAuthority: "unavailable",
    ...overrides,
  };
}

function eliteRacingParent(
  overrides: Partial<BreedingParentCandidate> = {},
): BreedingParentCandidate {
  const base = racingParent(overrides);
  return {
    ...base,
    performance: [
      {
        ...base.performance[0]!,
        medianSpeedPercentile: 98,
        upperTailSpeedPercentile: 96,
        bestSpeedPercentile: 99,
      },
    ],
    currentStrength: {
      ...base.currentStrength,
      power: 86,
      adjustedOdds: 83,
    },
  };
}

function intelligenceParent(
  racing: BreedingParentCandidate,
  breederBenchmarks = [
    buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: eliteBreederUniverse(racing.coreId),
    }),
  ],
): BreedingIntelligenceParentCandidate {
  return { racing, breederBenchmarks };
}

describe("offspring breeder-quality model", () => {
  it("identifies repeated exceptional offspring across multiple co-parents as an elite breeder", () => {
    const benchmark = buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: eliteBreederUniverse(),
    });
    const elite = findBreederAssessment(benchmark, "breeder-elite");
    expect(elite?.status).toBe("target");
    expect(elite?.qualifiedOffspringCount).toBe(3);
    expect(elite?.distinctCoParentCount).toBe(2);
    expect(elite?.exceptionalOffspringCount).toBe(3);
    expect(elite?.medianLiftBenchmarkPercentile).toBeGreaterThanOrEqual(95);
    expect(elite?.exceptionalRateBenchmarkPercentile).toBeGreaterThanOrEqual(
      90,
    );
  });

  it("keeps one supernatural offspring on WATCH rather than calling one lucky roll an elite breeder", () => {
    const outcomes = eliteBreederUniverse().filter(
      (outcome) => outcome.parentCoreId !== "breeder-elite",
    );
    outcomes.push(
      offspringOutcome("one-hit-parent", 0, {
        offspringQualityPercentile: 99.5,
        expectedQualityPercentile: 55,
        residualPercentile: 99.5,
      }),
    );
    const assessment = findBreederAssessment(
      buildBreederQualityBenchmark({ scope: bikeScope, outcomes }),
      "one-hit-parent",
    );
    expect(assessment?.status).toBe("watch");
    expect(assessment?.exceptionalOffspringCount).toBe(1);
    expect(assessment?.warnings).toContain(
      "OFFSPRING_SAMPLE_TOO_SMALL_FOR_TARGET",
    );
  });

  it("does not reward a prolific parent whose offspring are consistently average or weaker than expected", () => {
    const outcomes = eliteBreederUniverse().filter(
      (outcome) => outcome.parentCoreId !== "breeder-elite",
    );
    for (let index = 0; index < 20; index++) {
      outcomes.push(
        offspringOutcome("prolific-average", index, {
          coParentCoreId: `mate-${index % 5}`,
          offspringQualityPercentile: 52,
          expectedQualityPercentile: 58,
          residualPercentile: 30,
        }),
      );
    }
    const assessment = findBreederAssessment(
      buildBreederQualityBenchmark({ scope: bikeScope, outcomes }),
      "prolific-average",
    );
    expect(assessment?.qualifiedOffspringCount).toBe(20);
    expect(assessment?.status).toBe("wait");
    expect(assessment?.medianLiftPercentilePoints).toBeLessThan(0);
  });

  it("does not call an elite child exceptional when an elite result was already expected from the mating", () => {
    const outcomes = eliteBreederUniverse().filter(
      (outcome) => outcome.parentCoreId !== "breeder-elite",
    );
    for (let index = 0; index < 4; index++) {
      outcomes.push(
        offspringOutcome("elite-mate-beneficiary", index, {
          coParentCoreId: `elite-mate-${index % 2}`,
          offspringQualityPercentile: 97,
          expectedQualityPercentile: 96,
          residualPercentile: 55,
        }),
      );
    }
    const assessment = findBreederAssessment(
      buildBreederQualityBenchmark({ scope: bikeScope, outcomes }),
      "elite-mate-beneficiary",
    );
    expect(assessment?.eliteOffspringCount).toBe(4);
    expect(assessment?.exceptionalOffspringCount).toBe(0);
    expect(assessment?.status).not.toBe("target");
  });

  it("requires co-parent diversity before promoting repeatable outcomes to TARGET", () => {
    const outcomes = eliteBreederUniverse().filter(
      (outcome) => outcome.parentCoreId !== "breeder-elite",
    );
    for (let index = 0; index < 4; index++) {
      outcomes.push(
        offspringOutcome("single-mate-star", index, {
          coParentCoreId: "same-elite-mate",
          offspringQualityPercentile: 99,
          expectedQualityPercentile: 60,
          residualPercentile: 99,
        }),
      );
    }
    const assessment = findBreederAssessment(
      buildBreederQualityBenchmark({ scope: bikeScope, outcomes }),
      "single-mate-star",
    );
    expect(assessment?.distinctCoParentCount).toBe(1);
    expect(assessment?.status).toBe("watch");
    expect(assessment?.warnings).toContain(
      "CO_PARENT_DIVERSITY_TOO_LOW_FOR_TARGET",
    );
  });

  it("keeps Bike, Car and Horse breeder evidence separated", () => {
    const bikeOutcomes = eliteBreederUniverse();
    const horseOutcomes = eliteBreederUniverse("horse-star", {
      mode: "horse",
      distanceMetres: null,
    });
    const benchmark = buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: [...bikeOutcomes, ...horseOutcomes],
    });
    expect(findBreederAssessment(benchmark, "breeder-elite")?.status).toBe(
      "target",
    );
    expect(findBreederAssessment(benchmark, "horse-star")).toBeNull();
  });

  it("rejects future leakage in the expected-offspring baseline", () => {
    expect(() =>
      deduplicateBreederOffspringOutcomes([
        offspringOutcome("leaky-parent", 0, {
          offspringCreatedAt: "2025-01-10T00:00:00.000Z",
          expectedModelCutoff: "2025-01-11T00:00:00.000Z",
        }),
      ]),
    ).toThrow(/baseline must be frozen no later than offspring creation/i);
  });

  it("rejects contradictory duplicate offspring evidence", () => {
    const original = offspringOutcome("duplicate-parent", 0);
    expect(() =>
      deduplicateBreederOffspringOutcomes([
        original,
        { ...original, offspringQualityPercentile: 99 },
      ]),
    ).toThrow(/Conflicting duplicate breeder offspring outcome/);
  });
});

describe("integrated racer and breeder identification", () => {
  it("allows an average racer to become a breeding TARGET through proven breeder lift", () => {
    const racing = racingParent({
      coreId: "breeder-elite",
      coreName: "Average Racer Great Breeder",
    });
    const assessment = assessBreedingIntelligenceParent(
      intelligenceParent(racing),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(assessment.racer.status).toBe("wait");
    expect(assessment.breeder?.status).toBe("target");
    expect(assessment.status).toBe("target");
    expect(assessment.qualificationPath).toBe("elite_breeder");
  });

  it("preserves elite racers as TARGETs even when they have no offspring history yet", () => {
    const assessment = assessBreedingIntelligenceParent(
      { racing: eliteRacingParent(), breederBenchmarks: [] },
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(assessment.status).toBe("target");
    expect(assessment.qualificationPath).toBe("elite_racer");
    expect(assessment.warnings).toContain(
      "BREEDER_QUALITY_EVIDENCE_UNAVAILABLE",
    );
  });

  it("labels a Core that is both an elite racer and elite breeder as dual", () => {
    const racing = eliteRacingParent({ coreId: "breeder-elite" });
    const assessment = assessBreedingIntelligenceParent(
      intelligenceParent(racing),
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(assessment.status).toBe("target");
    expect(assessment.qualificationPath).toBe("dual");
  });

  it("prefers exact-distance breeder evidence over mode-wide breeder evidence when exact evidence exists", () => {
    const racing = racingParent({ coreId: "breeder-elite" });
    const modeWide = buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: eliteBreederUniverse("breeder-elite", bikeScope),
    });
    const exactOutcomes = eliteBreederUniverse(
      "other-exact-star",
      bike1400Scope,
    );
    for (let index = 0; index < 4; index++) {
      exactOutcomes.push(
        offspringOutcome("breeder-elite", index, {
          scope: bike1400Scope,
          coParentCoreId: `exact-mate-${index % 2}`,
          offspringQualityPercentile: 50,
          expectedQualityPercentile: 60,
          residualPercentile: 25,
        }),
      );
    }
    const exact = buildBreederQualityBenchmark({
      scope: bike1400Scope,
      outcomes: exactOutcomes,
    });
    const assessment = assessBreedingIntelligenceParent(
      { racing, breederBenchmarks: [modeWide, exact] },
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(assessment.breederScopeSource).toBe("exact_distance");
    expect(assessment.breeder?.status).toBe("wait");
    expect(assessment.status).toBe("wait");
  });

  it("supports elite racer x elite breeder TARGET pairings", () => {
    const father = {
      racing: eliteRacingParent({
        coreId: "elite-father",
        coreName: "Elite Racer Father",
        lineage: { parents: ["fa", "fb"], grandparents: [] },
      }),
      breederBenchmarks: [],
    };
    const motherRacing = racingParent({
      coreId: "breeder-elite",
      coreName: "Elite Breeder Mother",
      sex: "female",
      lineage: { parents: ["ma", "mb"], grandparents: [] },
    });
    const result = assessBreedingIntelligencePair(
      {
        father,
        mother: intelligenceParent(motherRacing),
        officialValidation: "unknown",
        pairInfo: null,
      },
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.status).toBe("target");
    expect(result.pairingStrategy).toBe("racer_x_breeder");
  });

  it("supports elite breeder x elite breeder TARGET pairings even when both are average racers", () => {
    const fatherRacing = racingParent({
      coreId: "breeder-father",
      coreName: "Breeder Father",
      lineage: { parents: ["fa", "fb"], grandparents: [] },
    });
    const motherRacing = racingParent({
      coreId: "breeder-mother",
      coreName: "Breeder Mother",
      sex: "female",
      lineage: { parents: ["ma", "mb"], grandparents: [] },
    });
    const fatherBenchmark = buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: eliteBreederUniverse("breeder-father"),
    });
    const motherBenchmark = buildBreederQualityBenchmark({
      scope: bikeScope,
      outcomes: eliteBreederUniverse("breeder-mother"),
    });
    const result = assessBreedingIntelligencePair(
      {
        father: { racing: fatherRacing, breederBenchmarks: [fatherBenchmark] },
        mother: { racing: motherRacing, breederBenchmarks: [motherBenchmark] },
        officialValidation: "unknown",
        pairInfo: null,
      },
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(result.father.racer.status).toBe("wait");
    expect(result.mother.racer.status).toBe("wait");
    expect(result.status).toBe("target");
    expect(result.pairingStrategy).toBe("breeder_x_breeder");
  });

  it("still returns WAIT when neither parent clears racer nor breeder quality", () => {
    const father = { racing: racingParent(), breederBenchmarks: [] };
    const mother = {
      racing: racingParent({
        coreId: "weak-mother",
        sex: "female",
        lineage: { parents: ["ma", "mb"], grandparents: [] },
      }),
      breederBenchmarks: [],
    };
    const board = buildBreedingIntelligenceBoard({
      mode: "bike",
      distanceMetres: 1_400,
      pairs: [
        {
          father,
          mother,
          officialValidation: "unknown",
          pairInfo: null,
        },
      ],
    });
    expect(board.action).toBe("wait");
    expect(board.targets).toHaveLength(0);
  });

  it("keeps pair_info descriptors outside the racer/breeder opportunity score", () => {
    const father = {
      racing: eliteRacingParent({
        coreId: "elite-father",
        lineage: { parents: ["fa", "fb"], grandparents: [] },
      }),
      breederBenchmarks: [],
    };
    const motherRacing = racingParent({
      coreId: "breeder-elite",
      sex: "female",
      lineage: { parents: ["ma", "mb"], grandparents: [] },
    });
    const mother = intelligenceParent(motherRacing);
    const fire = assessBreedingIntelligencePair(
      {
        father,
        mother,
        officialValidation: "unknown",
        pairInfo: { element: "fire", fNumber: 5, offspringType: "Freak" },
      },
      { mode: "bike", distanceMetres: 1_400 },
    );
    const water = assessBreedingIntelligencePair(
      {
        father,
        mother,
        officialValidation: "unknown",
        pairInfo: { element: "water", fNumber: 40, offspringType: "X-Class" },
      },
      { mode: "bike", distanceMetres: 1_400 },
    );
    expect(water.opportunityScore).toBe(fire.opportunityScore);
    expect(water.status).toBe(fire.status);
  });
});
