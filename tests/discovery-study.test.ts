import { describe, expect, it } from "vitest";
import {
  buildDiscoveryDistanceRecommendations,
  calculateNormalFreeMetrics,
  classifyDiscoveryEvidence,
  contributesToDisplayedProfile,
  currentBikeDiscoveryDistanceConfiguration,
  deduplicateDiscoveryObservations,
  partitionDiscoveryObservations,
  validateDiscoveryModeConfiguration,
  type DiscoveryDistanceSignal,
  type DiscoveryModeDistanceConfiguration,
  type DiscoveryRaceObservation,
} from "@/domain/discovery-study";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

const modes = ["horse", "car", "bike"] as const;

function observation(
  overrides: Partial<DiscoveryRaceObservation> = {},
): DiscoveryRaceObservation {
  return {
    ownerId: "owner-1",
    coreId: "core-1",
    coreName: "Core One",
    raceId: "race-1",
    raceName: "Free Bike",
    mode: "bike",
    distanceMetres: 1_000,
    recordedTimeMilliseconds: 50_000,
    position: 2,
    gateOrFieldSize: 12,
    evidenceClass: "normal_free",
    eventOrTournamentId: null,
    observedAt: "2026-08-28T00:00:00.000Z",
    retrievedAt: "2026-08-29T00:00:00.000Z",
    sourceAuthority: "synthetic-test-authority",
    ...overrides,
  };
}

function configuration(mode: ProbeMode): DiscoveryModeDistanceConfiguration {
  return {
    mode,
    supportedDistancesMetres: [1_000, 1_200, 1_400, 1_600, 1_800, 2_000],
    bands: {
      short: [1_000, 1_200],
      middle: [1_400, 1_600],
      long: [1_800, 2_000],
    },
    authority: `${mode} test authority`,
    reviewedAt: "2026-08-29T00:00:00.000Z",
  };
}

function signal(
  distanceMetres: number,
  overrides: Partial<DiscoveryDistanceSignal> = {},
): DiscoveryDistanceSignal {
  return {
    distanceMetres,
    ownCompetitiveAssessment: "unknown",
    ownCompetitiveObservations: 0,
    normalFreeAssessment: "unknown",
    normalFreeObservations: 0,
    parentAssessment: "unknown",
    parentObservations: 0,
    familyDistanceRank: null,
    otherEvidenceAssessment: "unknown",
    preferredEvidenceGatePassed: false,
    screeningScore: null,
    evidenceBasis: ["none"],
    reason: "Synthetic auditable reason.",
    ...overrides,
  };
}

describe("normal-Free discovery authority", () => {
  it("classifies Free Bike from the standalone race-name token", () => {
    expect(classifyDiscoveryEvidence({ raceName: "Free Bike" })).toBe(
      "normal_free",
    );
  });

  it("matches free bike case-insensitively", () => {
    expect(classifyDiscoveryEvidence({ raceName: "free bike" })).toBe(
      "normal_free",
    );
  });

  it("does not classify Freedom Cup as normal-Free", () => {
    expect(classifyDiscoveryEvidence({ raceName: "Freedom Cup" })).toBe(
      "unknown",
    );
  });

  it("keeps a zero-entry tournament without Free in its name as tournament evidence", () => {
    expect(
      classifyDiscoveryEvidence({
        raceName: "Summer Trial",
        explicitEventClass: "tournament",
        entryPrice: 0,
      }),
    ).toBe("tournament");
  });

  it("does not infer normal-Free from zero entry price", () => {
    expect(
      classifyDiscoveryEvidence({
        raceName: "Subsidised Trial",
        entryPrice: 0,
      }),
    ).toBe("unknown");
  });

  it("normal-Free evidence cannot update displayed power, variance or adjusted odds", () => {
    expect(contributesToDisplayedProfile("normal_free")).toBe(false);
    expect(contributesToDisplayedProfile("competitive")).toBe(true);
    expect(contributesToDisplayedProfile("tournament")).toBe(true);
  });

  it("rejects a normal-Free class that conflicts with the authoritative race name", () => {
    expect(() =>
      deduplicateDiscoveryObservations([
        observation({ raceName: "Freedom Cup" }),
      ]),
    ).toThrow(/conflicts with its authoritative race name/);
  });

  it.each(modes)("applies the same classification rules to %s", (mode) => {
    const classified = classifyDiscoveryEvidence({
      raceName: `Free ${mode}`,
      explicitEventClass: "competitive",
    });
    expect(classified).toBe("normal_free");
  });
});

describe("mode-aware normal-Free samples", () => {
  it("never combines evidence from different racing modes", () => {
    const observations = modes.map((mode, index) =>
      observation({ mode, raceId: `race-${index}` }),
    );
    expect(partitionDiscoveryObservations(observations).size).toBe(3);
    expect(() =>
      calculateNormalFreeMetrics({
        ownerId: "owner-1",
        coreId: "core-1",
        mode: "bike",
        distanceMetres: 1_000,
        observations,
      }),
    ).toThrow(/one owner, Core, mode and exact distance/);
  });

  it.each([
    [0, 20],
    [8, 12],
    [19, 1],
    [20, 0],
    [24, 0],
  ] as const)(
    "%i existing observations leave %i additional observations",
    (existing, remaining) => {
      const observations = Array.from({ length: existing }, (_, index) =>
        observation({ raceId: `race-${index}` }),
      );
      const metrics = calculateNormalFreeMetrics({
        ownerId: "owner-1",
        coreId: "core-1",
        mode: "bike",
        distanceMetres: 1_000,
        observations,
      });
      expect(metrics.additionalObservationsNeeded).toBe(remaining);
      expect(metrics.usableObservationCount).toBe(existing);
    },
  );

  it("calculates transparent speed and dispersion measurements", () => {
    const metrics = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations: [
        observation({ raceId: "race-a", recordedTimeMilliseconds: 50_000 }),
        observation({ raceId: "race-b", recordedTimeMilliseconds: 40_000 }),
        observation({ raceId: "race-c", recordedTimeMilliseconds: 100_000 }),
      ],
    });
    expect(metrics.meanSpeedMetresPerSecond).toBeCloseTo(55 / 3);
    expect(metrics.medianSpeedMetresPerSecond).toBe(20);
    expect(metrics.bestSpeedMetresPerSecond).toBe(25);
    expect(metrics.worstSpeedMetresPerSecond).toBe(10);
    expect(metrics.speedRangeMetresPerSecond).toBe(15);
    expect(metrics.standardDeviationMetresPerSecond).toBeGreaterThan(0);
    expect(metrics.coefficientOfVariation).toBeGreaterThan(0);
  });

  it("keeps wins and positions secondary by excluding them from speed measurements", () => {
    const first = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations: [observation({ position: 1 })],
    });
    const last = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations: [observation({ position: 12 })],
    });
    expect(last.medianSpeedMetresPerSecond).toBe(
      first.medianSpeedMetresPerSecond,
    );
  });

  it("deduplicates identical authoritative race observations", () => {
    const duplicate = observation();
    const metrics = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations: [duplicate, duplicate],
    });
    expect(
      deduplicateDiscoveryObservations([duplicate, duplicate]),
    ).toHaveLength(1);
    expect(metrics.usableObservationCount).toBe(1);
  });

  it("rejects contradictory duplicates instead of increasing the sample", () => {
    expect(() =>
      deduplicateDiscoveryObservations([
        observation(),
        observation({ recordedTimeMilliseconds: 49_000 }),
      ]),
    ).toThrow(/Conflicting duplicate/);
  });

  it("keeps normal-Free, competitive, tournament and esports evidence auditable", () => {
    const observations = [
      "normal_free",
      "competitive",
      "tournament",
      "esports",
    ].map((evidenceClass, index) =>
      observation({
        raceId: `race-${index}`,
        raceName:
          evidenceClass === "normal_free"
            ? "Free Bike"
            : `${evidenceClass} event`,
        evidenceClass:
          evidenceClass as DiscoveryRaceObservation["evidenceClass"],
      }),
    );
    expect(partitionDiscoveryObservations(observations).size).toBe(4);
    const metrics = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations,
    });
    expect(metrics.usableObservationCount).toBe(1);
  });

  it("marks a twenty-observation test complete without reopening it", () => {
    const metrics = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      observations: Array.from({ length: 25 }, (_, index) =>
        observation({ raceId: `race-${index}` }),
      ),
    });
    expect(metrics.testStatus).toBe("complete");
    expect(metrics.additionalObservationsNeeded).toBe(0);
    expect(metrics.completionPercentage).toBe(100);
  });

  it("uses an owner-configurable target without a schema dependency", () => {
    const metrics = calculateNormalFreeMetrics({
      ownerId: "owner-1",
      coreId: "core-1",
      mode: "bike",
      distanceMetres: 1_000,
      targetSampleSize: 24,
      observations: Array.from({ length: 20 }, (_, index) =>
        observation({ raceId: `race-${index}` }),
      ),
    });
    expect(metrics.additionalObservationsNeeded).toBe(4);
    expect(metrics.testStatus).toBe("in_progress");
  });
});

describe("preferred tests and exploratory fallback", () => {
  it.each(modes)("accepts a mode-specific configuration for %s", (mode) => {
    expect(validateDiscoveryModeConfiguration(configuration(mode)).mode).toBe(
      mode,
    );
  });

  it("preserves the owner-authorised Bike distances and bands", () => {
    expect(currentBikeDiscoveryDistanceConfiguration.bands).toEqual({
      short: [1_000, 1_200, 1_400],
      middle: [1_600, 1_800],
      long: [2_000, 2_200],
    });
  });

  it("allows any number of preferred distances without forced band coverage", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "bike",
      configuration: configuration("bike"),
      historyComplete: true,
      signals: [
        signal(1_000, {
          preferredEvidenceGatePassed: true,
          evidenceBasis: ["normal_free_speed"],
          normalFreeAssessment: "encouraging",
          normalFreeObservations: 4,
        }),
        signal(1_200, {
          preferredEvidenceGatePassed: true,
          evidenceBasis: ["own_competitive"],
          ownCompetitiveAssessment: "encouraging",
          ownCompetitiveObservations: 2,
        }),
      ],
    });
    expect(
      result.recommendations.filter(
        ({ recommendationType }) => recommendationType === "preferred",
      ),
    ).toHaveLength(2);
    expect(
      result.recommendations.filter(
        ({ recommendationType }) =>
          recommendationType === "exploratory_fallback",
      ),
    ).toHaveLength(0);
  });

  it("assigns exactly one short, middle and long SCREEN when no distance is preferred", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "horse",
      configuration: configuration("horse"),
      historyComplete: true,
      signals: [],
    });
    const screens = result.recommendations.filter(
      ({ recommendationType }) => recommendationType === "exploratory_fallback",
    );
    expect(screens).toHaveLength(3);
    expect(screens.map(({ displayLabel }) => displayLabel)).toEqual([
      "SCREEN",
      "SCREEN",
      "SCREEN",
    ]);
  });

  it("never displays fallback screens as preferred TEST distances", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "car",
      configuration: configuration("car"),
      historyComplete: true,
      signals: [],
    });
    for (const recommendation of result.recommendations) {
      if (recommendation.recommendationType === "exploratory_fallback") {
        expect(recommendation.displayLabel).toBe("SCREEN");
        expect(recommendation.displayLabel).not.toBe("TEST");
      }
    }
  });

  it("lets clearly negative own evidence block a parent-only preferred recommendation", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "bike",
      configuration: configuration("bike"),
      historyComplete: true,
      signals: [
        signal(1_000, {
          preferredEvidenceGatePassed: true,
          evidenceBasis: ["parent_exact_distance"],
          parentAssessment: "strong",
          parentObservations: 30,
          ownCompetitiveAssessment: "clearly_negative",
          ownCompetitiveObservations: 6,
        }),
      ],
    });
    expect(
      result.recommendations.find(
        ({ distanceMetres }) => distanceMetres === 1_000,
      )?.recommendationType,
    ).not.toBe("preferred");
  });

  it("treats zero parent observations as unknown rather than preferred evidence", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "bike",
      configuration: configuration("bike"),
      historyComplete: true,
      signals: [
        signal(1_000, {
          preferredEvidenceGatePassed: true,
          evidenceBasis: ["parent_exact_distance"],
          parentAssessment: "unknown",
          parentObservations: 0,
        }),
      ],
    });
    expect(
      result.recommendations.some(
        ({ recommendationType }) => recommendationType === "preferred",
      ),
    ).toBe(false);
  });

  it("selects the least-weak fallback while avoiding clearly negative own evidence", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "bike",
      configuration: configuration("bike"),
      historyComplete: true,
      signals: [
        signal(1_000, {
          screeningScore: 99,
          ownCompetitiveAssessment: "clearly_negative",
        }),
        signal(1_200, { screeningScore: 2 }),
      ],
    });
    expect(
      result.recommendations.find(
        ({ distanceMetres }) => distanceMetres === 1_200,
      )?.recommendationType,
    ).toBe("exploratory_fallback");
  });

  it("blocks recommendation publication when pagination is incomplete", () => {
    const result = buildDiscoveryDistanceRecommendations({
      mode: "bike",
      configuration: configuration("bike"),
      historyComplete: false,
      signals: [signal(1_000)],
    });
    expect(result.published).toBe(false);
    expect(result.recommendations).toEqual([]);
    expect(result.blockedReason).toMatch(/Complete paginated history/);
  });

  it("rejects a mode-specific signal that uses an invalid exact distance", () => {
    expect(() =>
      buildDiscoveryDistanceRecommendations({
        mode: "horse",
        configuration: configuration("horse"),
        historyComplete: true,
        signals: [signal(2_200)],
      }),
    ).toThrow(/invalid mode-specific distance/);
  });

  it("rejects configurations that assign an unsupported band distance", () => {
    expect(() =>
      validateDiscoveryModeConfiguration({
        ...configuration("car"),
        bands: {
          ...configuration("car").bands,
          long: [1_800, 2_200],
        },
      }),
    ).toThrow(/unsupported exact distance/);
  });
});
