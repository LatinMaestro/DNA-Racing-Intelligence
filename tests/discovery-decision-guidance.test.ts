import { describe, expect, it } from "vitest";

import {
  deriveDiscoveryDecisionGuidance,
  type DiscoveryDecisionGuidance,
  type DiscoveryDecisionReason,
} from "@/domain/discovery-decision-guidance";
import {
  attachDiscoveryBenchmarks,
  type DiscoveryExactDistanceBenchmarkEvidence,
} from "@/domain/discovery-benchmark";
import {
  buildDiscoveryProbePlan,
  type DiscoveryProbeCandidateInput,
} from "@/domain/discovery-probe-plan";

const benchmark: DiscoveryExactDistanceBenchmarkEvidence = {
  mode: "bike",
  distanceMetres: 1_400,
  dataCurrentThrough: "2026-07-20T00:00:00.000Z",
  raceEntryCount: 100,
  winningEntryCount: 25,
  topThreeEntryCount: 60,
  winningP25Milliseconds: 49_000,
  winningMedianMilliseconds: 50_000,
  winningP75Milliseconds: 51_500,
  topThreeP25Milliseconds: 50_000,
  topThreeMedianMilliseconds: 52_500,
  topThreeP75Milliseconds: 54_000,
  refreshedAt: "2026-07-20T01:00:00.000Z",
};

function candidate(
  overrides: Partial<DiscoveryProbeCandidateInput> = {},
): DiscoveryProbeCandidateInput {
  return {
    coreId: "core-a",
    coreName: "Synthetic Core",
    mode: "bike",
    distanceMetres: 1_400,
    directRaceCount: 4,
    directTimeEvidence: {
      bestMilliseconds: 56_000,
      medianMilliseconds: 57_000,
      meanMilliseconds: 57_250,
      standardDeviationMilliseconds: 750,
    },
    starEvidence: null,
    lineageRelationship: null,
    lineageResolved: true,
    lineageRaceCount: 0,
    tournamentRelevance: "none",
    maidenState: "not_eligible",
    freshness: "current",
    dataCurrentThrough: "2026-07-20T00:00:00.000Z",
    ...overrides,
  };
}

function guidance(
  input: DiscoveryProbeCandidateInput,
  benchmarks: readonly DiscoveryExactDistanceBenchmarkEvidence[] = [benchmark],
) {
  return deriveDiscoveryDecisionGuidance(
    attachDiscoveryBenchmarks(buildDiscoveryProbePlan([input]), benchmarks),
  )[0]!;
}

describe("Discovery decision guidance", () => {
  it.each([
    [
      {
        directTimeEvidence: {
          bestMilliseconds: 51_000,
          medianMilliseconds: 51_250,
          meanMilliseconds: 51_500,
          standardDeviationMilliseconds: 500,
        },
      },
      "continue_targeted_probe",
      "competitive_winner_range",
    ],
    [
      {
        directTimeEvidence: {
          bestMilliseconds: 53_000,
          medianMilliseconds: 53_500,
          meanMilliseconds: 53_750,
          standardDeviationMilliseconds: 500,
        },
      },
      "continue_targeted_probe",
      "competitive_top_three_range",
    ],
    [{}, "stop_prioritising_this_cell", "weak_times_without_positive_star_signal"],
  ] as const)(
    "maps exact-distance evidence to %s",
    (overrides, expectedGuidance, expectedReason) => {
      expect(guidance(candidate(overrides))).toEqual(
        expect.objectContaining({
          decisionGuidance: expectedGuidance satisfies DiscoveryDecisionGuidance,
          decisionReason: expectedReason satisfies DiscoveryDecisionReason,
          automaticEntryAllowed: false,
          automaticStopAllowed: false,
        }),
      );
    },
  );

  it("uses one confirmation race before deprioritising a very small weak sample", () => {
    expect(
      guidance(
        candidate({
          directRaceCount: 3,
          starEvidence: null,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        decisionGuidance: "continue_single_confirmation",
        decisionReason: "small_sample_needs_confirmation",
        recommendedDecisionProbeSize: 1,
        decisionActionable: true,
        automaticStopAllowed: false,
      }),
    );
  });

  it("pauses rather than stopping when weak direct times conflict with positive star support", () => {
    expect(
      guidance(
        candidate({
          starEvidence: {
            completeStarDataRaceCount: 4,
            goldEligibleRaceCount: 4,
            goldAssignmentOpportunityCount: 3,
            goldReceivedCount: 1,
            blueAssignmentOpportunityCount: 4,
            blueReceivedCount: 0,
          },
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        decisionGuidance: "pause_conflicting_evidence",
        decisionReason: "weak_times_but_positive_star_signal",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
        automaticStopAllowed: false,
      }),
    );
  });

  it("does not stop when the exact-distance benchmark is unavailable", () => {
    expect(guidance(candidate(), [])).toEqual(
      expect.objectContaining({
        decisionGuidance: "continue_targeted_probe",
        decisionReason: "benchmark_not_available",
        automaticStopAllowed: false,
      }),
    );
  });

  it("preserves stale deferral and the ten-race review boundary", () => {
    expect(
      guidance(
        candidate({
          freshness: "stale",
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        decisionGuidance: "defer_stale_or_unresolved",
        decisionReason: "evidence_stale_or_unresolved",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
      }),
    );

    expect(
      guidance(
        candidate({
          directRaceCount: 10,
        }),
      ),
    ).toEqual(
      expect.objectContaining({
        decisionGuidance: "review_minimum_sample",
        decisionReason: "minimum_sample_reached",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
      }),
    );
  });
});
