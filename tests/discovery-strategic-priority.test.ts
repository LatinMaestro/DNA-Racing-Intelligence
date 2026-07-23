import { describe, expect, it } from "vitest";

import {
  buildDiscoveryStrategicPlan,
  type DiscoveryStrategicCellInput,
  type StrategicDiscoveryMode,
} from "@/domain/discovery-strategic-priority";

const thresholds = {
  strongestModeGapPoints: 5,
  version: "synthetic-v1",
} as const;

function cell(
  mode: StrategicDiscoveryMode,
  percentile: number,
  overrides: Partial<DiscoveryStrategicCellInput> = {},
): DiscoveryStrategicCellInput {
  return {
    coreId: "core-me",
    mode,
    distanceMetres: 1600,
    directRaceCount: 8,
    successfulTimePercentile: percentile,
    evidenceStatus: "complete",
    confidence: "moderate",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00Z",
    lastImported: "2026-07-20T01:00:00Z",
    maidenState: "eligible",
    tournaments: [],
    ...overrides,
  };
}

describe("Discovery strategic priority", () => {
  it("compares all modes before identifying a strongest ME mode", () => {
    const plan = buildDiscoveryStrategicPlan(
      [cell("bike", 65), cell("car", 90), cell("horse", 70)],
      thresholds,
    );
    expect(plan.strongestCredibleModes["core-me"]).toBe("car");
    expect(plan.actionable).toBe(false);
    expect(plan.gateDRequiredForMaiden).toBe(true);
  });

  it("labels a weaker available Maiden as preserve ME", () => {
    const horseMaiden = {
      tournamentId: "horse-maiden",
      mode: "horse",
      maiden: true,
      availability: "upcoming",
      relevance: "priority",
      leaderboardObjective: "fastest_single_time",
    } as const;
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65),
        cell("car", 90),
        cell("horse", 70, { tournaments: [horseMaiden] }),
      ],
      thresholds,
    );
    const horse = plan.cells.find(({ mode }) => mode === "horse")!;
    expect(horse.maidenSignal).toBe("preserve_me_from_this_mode");
    expect(horse.warnings).toContain("PRESERVE_ME");
    expect(horse.maidenCommitmentAllowed).toBe(false);
  });

  it("keeps the strongest-mode Maiden provisional behind Gate D", () => {
    const carMaiden = {
      tournamentId: "car-maiden",
      mode: "car",
      maiden: true,
      availability: "qualifying",
      relevance: "priority",
      leaderboardObjective: "median_time",
    } as const;
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65),
        cell("car", 90, { tournaments: [carMaiden] }),
        cell("horse", 70),
      ],
      thresholds,
    );
    const car = plan.cells.find(({ mode }) => mode === "car")!;
    expect(car.maidenSignal).toBe("strongest_mode_candidate_requires_gate_d");
    expect(car.reviewPriority).toBe("high");
    expect(car.automaticEntryAllowed).toBe(false);
  });

  it("requires credible evidence in bike, car and horse", () => {
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65),
        cell("car", 90),
        cell("horse", 70, { confidence: "low" }),
      ],
      thresholds,
    );
    expect(plan.strongestCredibleModes["core-me"]).toBeNull();
    expect(plan.cells[0]!.maidenSignal).toBe(
      "more_cross_mode_discovery_required",
    );
    expect(plan.cells[0]!.warnings).toContain("CROSS_MODE_EVIDENCE_INCOMPLETE");
  });

  it("does not force a strongest mode when the gap is immaterial", () => {
    const plan = buildDiscoveryStrategicPlan(
      [cell("bike", 85), cell("car", 88), cell("horse", 70)],
      thresholds,
    );
    expect(plan.strongestCredibleModes["core-me"]).toBeNull();
  });

  it("uses active tournament relevance only for review priority", () => {
    const tournament = {
      tournamentId: "bike-open",
      mode: "bike",
      maiden: false,
      availability: "upcoming",
      relevance: "priority",
      leaderboardObjective: "points",
    } as const;
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65, {
          maidenState: "not_eligible",
          tournaments: [tournament],
        }),
        cell("car", 90, { maidenState: "not_eligible" }),
        cell("horse", 70, { maidenState: "not_eligible" }),
      ],
      thresholds,
    );
    expect(plan.cells[0]!.reviewPriority).toBe("high");
    expect(plan.cells[0]!.actionable).toBe(false);
  });

  it("prioritises an important evidence gap without admitting it to ME comparison", () => {
    const tournament = {
      tournamentId: "horse-priority",
      mode: "horse",
      maiden: false,
      availability: "upcoming",
      relevance: "priority",
      leaderboardObjective: "top_x",
    } as const;
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65),
        cell("car", 90),
        cell("horse", 70, {
          confidence: "low",
          tournaments: [tournament],
        }),
      ],
      thresholds,
    );
    const horse = plan.cells.find(({ mode }) => mode === "horse")!;
    expect(horse.credibleForCrossModeComparison).toBe(false);
    expect(horse.reviewPriority).toBe("high");
    expect(plan.strongestCredibleModes["core-me"]).toBeNull();
  });

  it("fails closed on stale evidence and missing timestamps", () => {
    const plan = buildDiscoveryStrategicPlan(
      [
        cell("bike", 65, {
          freshness: "stale",
          dataCurrentThrough: null,
        }),
        cell("car", 90),
        cell("horse", 70),
      ],
      thresholds,
    );
    expect(plan.cells[0]!.reviewPriority).toBe("defer");
    expect(plan.cells[0]!.warnings).toEqual(
      expect.arrayContaining(["DATA_CUTOFF_UNKNOWN", "DATA_STALE"]),
    );
  });

  it("rejects inconsistent core state and invalid tournament context", () => {
    expect(() =>
      buildDiscoveryStrategicPlan(
        [
          cell("bike", 65),
          cell("car", 90, { maidenState: "not_eligible" }),
          cell("horse", 70),
        ],
        thresholds,
      ),
    ).toThrow("Maiden state must be consistent");
    expect(() =>
      buildDiscoveryStrategicPlan(
        [
          cell("bike", 65, {
            tournaments: [
              {
                tournamentId: "wrong-mode",
                mode: "horse",
                maiden: false,
                availability: "upcoming",
                relevance: "eligible",
                leaderboardObjective: "custom",
              },
            ],
          }),
        ],
        thresholds,
      ),
    ).toThrow("must match");
  });

  it("validates exact cell uniqueness and versioned thresholds", () => {
    expect(() =>
      buildDiscoveryStrategicPlan(
        [cell("bike", 65), cell("bike", 70)],
        thresholds,
      ),
    ).toThrow("must be unique");
    expect(() =>
      buildDiscoveryStrategicPlan([cell("bike", 65)], {
        ...thresholds,
        strongestModeGapPoints: 0,
      }),
    ).toThrow("greater than zero");
  });
});
