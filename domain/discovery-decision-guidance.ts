import type { DiscoveryBenchmarkedCandidate } from "./discovery-benchmark";

export type DiscoveryDecisionGuidance =
  | "continue_targeted_probe"
  | "continue_single_confirmation"
  | "pause_conflicting_evidence"
  | "stop_prioritising_this_cell"
  | "review_minimum_sample"
  | "defer_stale_or_unresolved";

export type DiscoveryDecisionReason =
  | "competitive_winner_range"
  | "competitive_top_three_range"
  | "benchmark_not_available"
  | "small_sample_needs_confirmation"
  | "weak_times_but_positive_star_signal"
  | "weak_times_without_positive_star_signal"
  | "minimum_sample_reached"
  | "evidence_stale_or_unresolved";

export type DiscoveryDecisionCandidate = DiscoveryBenchmarkedCandidate &
  Readonly<{
    decisionGuidance: DiscoveryDecisionGuidance;
    decisionReason: DiscoveryDecisionReason;
    recommendedDecisionProbeSize: number;
    decisionActionable: boolean;
  }>;

function hasPositiveStarSignal(
  candidate: DiscoveryBenchmarkedCandidate,
): boolean {
  const star = candidate.starEvidence;
  return (
    star !== null && (star.goldReceivedCount > 0 || star.blueReceivedCount > 0)
  );
}

export function deriveDiscoveryDecisionGuidance(
  candidates: readonly DiscoveryBenchmarkedCandidate[],
): readonly DiscoveryDecisionCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.guidance === "defer_stale_or_unresolved") {
      return {
        ...candidate,
        decisionGuidance: "defer_stale_or_unresolved",
        decisionReason: "evidence_stale_or_unresolved",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
      };
    }

    if (candidate.observationsToMinimum === 0) {
      return {
        ...candidate,
        decisionGuidance: "review_minimum_sample",
        decisionReason: "minimum_sample_reached",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
      };
    }

    if (candidate.benchmarkAssessment === "winning_range") {
      return {
        ...candidate,
        decisionGuidance: "continue_targeted_probe",
        decisionReason: "competitive_winner_range",
        recommendedDecisionProbeSize: candidate.recommendedInitialProbeSize,
        decisionActionable: candidate.actionable,
      };
    }

    if (candidate.benchmarkAssessment === "top_three_range") {
      return {
        ...candidate,
        decisionGuidance: "continue_targeted_probe",
        decisionReason: "competitive_top_three_range",
        recommendedDecisionProbeSize: candidate.recommendedInitialProbeSize,
        decisionActionable: candidate.actionable,
      };
    }

    if (candidate.benchmarkAssessment === "not_available") {
      return {
        ...candidate,
        decisionGuidance: "continue_targeted_probe",
        decisionReason: "benchmark_not_available",
        recommendedDecisionProbeSize: candidate.recommendedInitialProbeSize,
        decisionActionable: candidate.actionable,
      };
    }

    if (candidate.directRaceCount < 4) {
      return {
        ...candidate,
        decisionGuidance: "continue_single_confirmation",
        decisionReason: "small_sample_needs_confirmation",
        recommendedDecisionProbeSize: Math.min(
          1,
          candidate.observationsToMinimum,
        ),
        decisionActionable: true,
      };
    }

    if (hasPositiveStarSignal(candidate)) {
      return {
        ...candidate,
        decisionGuidance: "pause_conflicting_evidence",
        decisionReason: "weak_times_but_positive_star_signal",
        recommendedDecisionProbeSize: 0,
        decisionActionable: false,
      };
    }

    return {
      ...candidate,
      decisionGuidance: "stop_prioritising_this_cell",
      decisionReason: "weak_times_without_positive_star_signal",
      recommendedDecisionProbeSize: 0,
      decisionActionable: false,
    };
  });
}
