import { renderToStaticMarkup } from "react-dom/server";
import { describe, expect, it } from "vitest";
import {
  DiscoveryStudyWorkspace,
  type DiscoveryStudyFilters,
  type DiscoveryStudyView,
} from "@/components/discovery-study-workspace";
import { currentBikeDiscoveryDistanceConfiguration } from "@/domain/discovery-study";

const filters: DiscoveryStudyFilters = {
  mode: "bike",
  squad: "all",
  recommendation: "all",
  distanceMetres: null,
  evidenceBasis: null,
  completion: "all",
  coreStatus: null,
};

const study: DiscoveryStudyView = {
  targetSampleSize: 20,
  historyStatus: "complete",
  historyExplanation: "Complete synthetic history.",
  modeConfigurations: [currentBikeDiscoveryDistanceConfiguration],
  candidates: [
    {
      coreName: "Synthetic Bike",
      coreId: "bike-hid-1",
      gender: "female",
      mode: "bike",
      discoverySquadMember: true,
      modeRaceStarts: 8,
      normalFreeObservations: 8,
      distanceRecommendations: [
        {
          mode: "bike",
          distanceMetres: 1_000,
          recommendationType: "preferred",
          displayLabel: "TEST",
          evidenceBasis: ["normal_free_speed"],
          reason: "Encouraging same-distance speed.",
          uncertain: true,
        },
        {
          mode: "bike",
          distanceMetres: 1_600,
          recommendationType: "exploratory_fallback",
          displayLabel: "SCREEN",
          evidenceBasis: ["none"],
          reason: "Broad screen.",
          uncertain: true,
        },
      ],
      decision: "Continue bounded test",
      sampleCompletionState: "in_progress",
      coreStatus: "candidate",
    },
  ],
  distanceRows: [
    {
      priority: 1,
      coreName: "Synthetic Bike",
      coreId: "bike-hid-1",
      gender: "female",
      mode: "bike",
      discoverySquadMember: true,
      distanceMetres: 1_000,
      recommendationType: "preferred",
      evidenceBasis: ["normal_free_speed"],
      existingNormalFreeObservations: 8,
      additionalObservationsNeeded: 12,
      competitiveStarts: 2,
      competitiveWinPercentage: 0,
      competitivePodiumPercentage: 50,
      competitiveFinishMeasure: 3.5,
      normalFreeMedianSpeedMetresPerSecond: 20,
      normalFreeBestSpeedMetresPerSecond: 21,
      speedDispersionMetresPerSecond: 1.2,
      speedCoefficientOfVariation: 0.06,
      parentExactDistanceObservations: 24,
      familyDistanceSignal: "2 of 7",
      testingReason: "Validate encouraging repeatable speed.",
      testStatus: "in_progress",
      ownerNotes: "Protect starts outside this cell.",
      postTestDecision: "pending",
      coreStatus: "candidate",
    },
  ],
};

describe("normal-Free Discovery workspace", () => {
  it("renders mode and audit filters plus distinct TEST and SCREEN states", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStudyWorkspace filters={filters} study={study} />,
    );
    expect(html).toContain("Horse");
    expect(html).toContain("Car");
    expect(html).toContain("Bike");
    expect(html).toContain("Discovery squad");
    expect(html).toContain("Evidence basis");
    expect(html).toContain("Sample completion");
    expect(html).toContain("Core status");
    expect(html).toContain("Candidate matrix · bike");
    expect(html).toContain("Synthetic Bike");
    expect(html).toContain("TEST");
    expect(html).toContain("SCREEN");
    expect(html).toContain("8");
    expect(html).toContain("12");
    expect(html).toContain("20.000 m/s");
    expect(html).toContain("Validate encouraging repeatable speed.");
  });

  it("renders an explicit unknown state when authoritative history is unavailable", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStudyWorkspace filters={filters} study={null} />,
    );
    expect(html).toContain("Normal-Free history not publishable");
    expect(html).toContain("race-name plus finished-time history");
    expect(html).toContain(
      "unknown rather than being inferred from zero entry price",
    );
    expect(html).toContain("1,000 m");
    expect(html).toContain("2,200 m");
  });

  it("keeps Horse selected without inventing Bike distances for Horse", () => {
    const html = renderToStaticMarkup(
      <DiscoveryStudyWorkspace
        filters={{ ...filters, mode: "horse" }}
        study={null}
      />,
    );
    expect(html).toContain("Candidate matrix · horse");
    expect(html).not.toContain("2,200 m testing table");
  });
});
