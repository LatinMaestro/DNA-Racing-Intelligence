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

export type DiscoveryDecisionCandidate = Omit<
  DiscoveryBenchmarkedCandidate,
  "guidance" | "recommendedInitialProbeSize" | "actionable"
> &
  Readonly<{
    guidance: DiscoveryDecisionGuidance;
    decisionReason: DiscoveryDecisionReason;
    recommendedInitialProbeSize: number;
    actionable: boolean;
  }>;

function hasPositiveStarSignal(candidate: DiscoveryBenchmarkedCandidate): boolean {
  const star = candidate.starEvidence;
  return star !== null && (star.goldReceivedCount > 0 || star.blueReceivedCount > 0);
}

export function deriveDiscoveryDecisionGuidance(
  candidates: readonly DiscoveryBenchmarkedCandidate[],
): readonly DiscoveryDecisionCandidate[] {
  return candidates.map((candidate) => {
    if (candidate.guidance === "defer_stale_or_unresolved") {
      return {
        ...candidate,
        guidance: "defer_stale_or_unresolved",
        decisionReason: "evidence_stale_or_unresolved",
        recommendedInitialProbeSize: 0,
        actionable: false,
      };
    }

    if (candidate.observationsToMinimum === 0) {
      return {
        ...candidate,
        guidance: "review_minimum_sample",
        decisionReason: "minimum_sample_reached",
        recommendedInitialProbeSize: 0,
        actionable: false,
      };
    }

    if (candidate.benchmarkAssessment === "winning_range") {
      return {
        ...candidate,
        guidance: "continue_targeted_probe",
        decisionReason: "competitive_winner_range",
      };
    }

    if (candidate.benchmarkAssessment === "top_three_range") {
      return {
        ...candidate,
        guidance: "continue_targeted_probe",
        decisionReason: "competitive_top_three_range",
      };
    }

    if (candidate.benchmarkAssessment === "not_available") {
      return {
        ...candidate,
        guidance: "continue_targeted_probe",
        decisionReason: "benchmark_not_available",
      };
    }

    if (candidate.directRaceCount < 4) {
      return {
        ...candidate,
        guidance: "continue_single_confirmation",
        decisionReason: "small_sample_needs_confirmation",
        recommendedInitialProbeSize: Math.min(1, candidate.observationsToMinimum),
        actionable: true,
      };
    }

    if (hasPositiveStarSignal(candidate)) {
      return {
        ...candidate,
        guidance: "pause_conflicting_evidence",
        decisionReason: "weak_times_but_positive_star_signal",
        recommendedInitialProbeSize: 0,
        actionable: false,
      };
    }

    return {
      ...candidate,
      guidance: "stop_prioritising_this_cell",
      decisionReason: "weak_times_without_positive_star_signal",
      recommendedInitialProbeSize: 0,
      actionable: false,
    };
  });
}
