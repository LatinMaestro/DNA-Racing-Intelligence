import { describe, expect, it } from "vitest";
import {
  buildDiscoveryCoreMethodologyPlan,
  classifyDiscoveryRunnerArchetype,
  noStarEvidenceSupportsCaution,
  selectDiscoveryTwoBandTestPlan,
  type DiscoveryDistanceMethodologyEvidence,
} from "@/domain/discovery-methodology";
import {
  currentBikeDiscoveryDistanceConfiguration,
  validateDiscoveryModeConfiguration,
  type DiscoveryModeDistanceConfiguration,
} from "@/domain/discovery-study";
import type { ProbeMode } from "@/domain/discovery-probe-plan";

const reviewedAt = "2026-09-07T00:00:00.000Z";

function syntheticConfiguration(
  mode: Exclude<ProbeMode, "bike">,
): DiscoveryModeDistanceConfiguration {
  return validateDiscoveryModeConfiguration({
    mode,
    supportedDistancesMetres: [800, 1_000, 1_200, 1_400, 1_600, 1_800],
    bands: {
      short: [800, 1_000],
      middle: [1_200, 1_400],
      long: [1_600, 1_800],
    },
    authority: "synthetic cross-mode methodology test fixture",
    reviewedAt,
  });
}

function evidence(
  mode: ProbeMode,
  distanceMetres: number,
  overrides: Partial<DiscoveryDistanceMethodologyEvidence> = {},
): DiscoveryDistanceMethodologyEvidence {
  return {
    mode,
    distanceMetres,
    usableObservationCount: 12,
    centralPace: "average",
    ceilingPace: "average",
    repeatability: "moderate",
    starSupport: "neutral",
    exactFormatSupport: "neutral",
    ...overrides,
  };
}

describe("cross-mode discovery methodology", () => {
  it("classifies repeatable elite, volatile ceiling and format-specialist archetypes", () => {
    expect(
      classifyDiscoveryRunnerArchetype(
        evidence("bike", 1_600, {
          centralPace: "elite",
          ceilingPace: "elite",
          repeatability: "tight",
        }),
      ),
    ).toBe("repeatable_elite");

    expect(
      classifyDiscoveryRunnerArchetype(
        evidence("bike", 1_600, {
          centralPace: "average",
          ceilingPace: "elite",
          repeatability: "wide",
        }),
      ),
    ).toBe("volatile_ceiling");

    expect(
      classifyDiscoveryRunnerArchetype(
        evidence("bike", 1_600, {
          centralPace: "average",
          ceilingPace: "average",
          starSupport: "strong_support",
        }),
      ),
    ).toBe("format_specialist_candidate");
  });

  it("keeps low-sample elite ceiling evidence in discovery instead of benching it", () => {
    expect(
      classifyDiscoveryRunnerArchetype(
        evidence("bike", 2_000, {
          usableObservationCount: 3,
          centralPace: "average",
          ceilingPace: "elite",
          repeatability: "unknown_low_sample",
        }),
      ),
    ).toBe("high_upside_low_sample");

    const plan = buildDiscoveryCoreMethodologyPlan({
      coreId: "core-low-sample",
      coreName: "Low Sample Ceiling",
      mode: "bike",
      configuration: currentBikeDiscoveryDistanceConfiguration,
      distanceEvidence: [
        evidence("bike", 2_000, {
          usableObservationCount: 3,
          centralPace: "average",
          ceilingPace: "elite",
          repeatability: "unknown_low_sample",
        }),
      ],
      mainDistanceMetres: 2_000,
      mainDistanceSettled: false,
      sideDistanceQuestionOpen: false,
    });

    expect(plan.discoveryClass).toBe("promote");
    expect(plan.excludeFromDiscoveryRoster).toBe(false);
    expect(plan.automaticPromotionAllowed).toBe(false);
    expect(plan.automaticBenchAllowed).toBe(false);
  });

  it("uses side-distance confirmation instead of wasting slots on a settled main distance", () => {
    const plan = buildDiscoveryCoreMethodologyPlan({
      coreId: "core-side",
      coreName: "Known Main",
      mode: "bike",
      configuration: currentBikeDiscoveryDistanceConfiguration,
      distanceEvidence: [
        evidence("bike", 1_600, {
          centralPace: "elite",
          ceilingPace: "elite",
          repeatability: "tight",
        }),
        evidence("bike", 2_000, {
          usableObservationCount: 3,
          ceilingPace: "strong",
          repeatability: "unknown_low_sample",
        }),
      ],
      mainDistanceMetres: 1_600,
      mainDistanceSettled: true,
      sideDistanceQuestionOpen: true,
    });

    expect(plan.discoveryClass).toBe("confirm_side_distance");
    expect(plan.excludeFromDiscoveryRoster).toBe(false);
    expect(plan.recommendedTestDistancesMetres).not.toContain(1_600);
    expect(plan.recommendedTestBands).toHaveLength(2);
  });

  it("excludes a fully settled Core when no side-distance question remains", () => {
    const plan = buildDiscoveryCoreMethodologyPlan({
      coreId: "core-settled",
      coreName: "Settled Elite",
      mode: "bike",
      configuration: currentBikeDiscoveryDistanceConfiguration,
      distanceEvidence: [
        evidence("bike", 1_000, {
          centralPace: "elite",
          ceilingPace: "elite",
          repeatability: "tight",
        }),
      ],
      mainDistanceMetres: 1_000,
      mainDistanceSettled: true,
      sideDistanceQuestionOpen: false,
    });

    expect(plan.discoveryClass).toBe("settled");
    expect(plan.excludeFromDiscoveryRoster).toBe(true);
    expect(plan.recommendedTestDistancesMetres).toEqual([]);
  });

  it("requires a two-band rule-out plan before an ordinary Core can be benched", () => {
    const plan = buildDiscoveryCoreMethodologyPlan({
      coreId: "core-rule-out",
      coreName: "Rule Out Candidate",
      mode: "bike",
      configuration: currentBikeDiscoveryDistanceConfiguration,
      distanceEvidence: [
        evidence("bike", 1_600, {
          centralPace: "weak",
          ceilingPace: "average",
          repeatability: "moderate",
          starSupport: "caution",
          exactFormatSupport: "neutral",
        }),
        evidence("bike", 2_000, {
          usableObservationCount: 5,
          centralPace: "average",
          ceilingPace: "average",
          repeatability: "moderate",
        }),
      ],
      mainDistanceMetres: 1_600,
      mainDistanceSettled: false,
      sideDistanceQuestionOpen: false,
    });

    expect(plan.discoveryClass).toBe("rule_out");
    expect(plan.recommendedTestBands).toEqual(["middle", "long"]);
    expect(plan.recommendedTestDistancesMetres).toEqual(
      expect.arrayContaining([1_600, 1_800, 2_000, 2_200]),
    );
    expect(plan.automaticBenchAllowed).toBe(false);
  });

  it("applies the same methodology contract to Horse and Car without copying Bike distances", () => {
    for (const mode of ["horse", "car"] as const) {
      const configuration = syntheticConfiguration(mode);
      const plan = buildDiscoveryCoreMethodologyPlan({
        coreId: `${mode}-core`,
        coreName: `${mode} candidate`,
        mode,
        configuration,
        distanceEvidence: [
          evidence(mode, 1_200, {
            centralPace: "average",
            ceilingPace: "strong",
            repeatability: "wide",
            exactFormatSupport: "supporting",
          }),
        ],
        mainDistanceMetres: 1_200,
        mainDistanceSettled: false,
        sideDistanceQuestionOpen: false,
      });

      expect(plan.mode).toBe(mode);
      expect(plan.discoveryClass).toBe("variance_format");
      expect(plan.recommendedTestDistancesMetres.every((distance) =>
        configuration.supportedDistancesMetres.includes(distance),
      )).toBe(true);
    }
  });

  it("uses known no-star opportunities as caution only after repeated strong-opposition chances", () => {
    expect(
      noStarEvidenceSupportsCaution({
        qualityKnownRaceCount: 6,
        strongOrEliteOppositionOpportunityCount: 5,
        blueOpportunityCount: 5,
        blueReceivedCount: 0,
        yellowOrGoldOpportunityCount: 5,
        yellowOrGoldReceivedCount: 0,
      }),
    ).toBe(true);

    expect(
      noStarEvidenceSupportsCaution({
        qualityKnownRaceCount: 6,
        strongOrEliteOppositionOpportunityCount: 5,
        blueOpportunityCount: 5,
        blueReceivedCount: 1,
        yellowOrGoldOpportunityCount: 5,
        yellowOrGoldReceivedCount: 0,
      }),
    ).toBe(false);

    expect(
      noStarEvidenceSupportsCaution({
        qualityKnownRaceCount: 3,
        strongOrEliteOppositionOpportunityCount: 3,
        blueOpportunityCount: 3,
        blueReceivedCount: 0,
        yellowOrGoldOpportunityCount: 3,
        yellowOrGoldReceivedCount: 0,
      }),
    ).toBe(false);
  });

  it("selects the stronger adjacent side when a middle-band Core needs two-category rule-out testing", () => {
    const plan = selectDiscoveryTwoBandTestPlan({
      configuration: currentBikeDiscoveryDistanceConfiguration,
      anchorDistanceMetres: 1_600,
      distanceEvidence: [
        evidence("bike", 1_200, {
          centralPace: "weak",
          ceilingPace: "weak",
        }),
        evidence("bike", 2_000, {
          centralPace: "average",
          ceilingPace: "strong",
          exactFormatSupport: "supporting",
        }),
      ],
    });

    expect(plan.bands).toEqual(["middle", "long"]);
    expect(plan.distancesMetres).toEqual(
      expect.arrayContaining([1_600, 1_800, 2_000, 2_200]),
    );
  });
});
