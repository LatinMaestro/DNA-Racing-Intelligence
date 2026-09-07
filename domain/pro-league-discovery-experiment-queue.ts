import type { ProLeagueCoverageGap } from "@/domain/pro-league-matchup";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";
import { proLeagueCurrentRules } from "@/domain/pro-league-roster";

const MAXIMUM_CANDIDATES = 500;
const MAXIMUM_PRIORITY_GAPS = 100;
const MAXIMUM_EXPERIMENTS = 100;
const MINIMUM_EXACT_DISTANCE_RACES = 10;

type Gap = ProLeagueCoverageGap;
type Candidate = ProLeagueRosterCandidateScore;
type Cell = ProLeagueCandidateCellScore;

export type ProLeagueDiscoveryExperiment = Readonly<{
  coreId: string;
  displayName: string;
  raceType: string;
  distanceMetres: number;
  mapIds: Gap["mapIds"];
  raceLineCount: number;
  gapPriority: Exclude<Gap["discoveryPriority"], "maintain">;
  gapStatus: Gap["status"];
  rosterImpact:
    | "challenge_provisional_roster_slot"
    | "prove_provisional_member_before_lock"
    | "improve_marginal_member_confidence";
  hypothesisSource:
    "exact_distance_sample" | "adjacent_distance_same_race_type";
  sourceDistanceMetres: number;
  benchmarkSignal: Cell["benchmarkAssessment"];
  directRaceCount: number;
  observationsToMinimum: number;
  recommendedNextRaceCount: number;
  decision: "complete_exact_minimum" | "single_confirmation";
  evidenceCurrentThrough: string;
  warnings: readonly (
    | "EXPERIMENTAL_SMALL_SAMPLE"
    | "ADJACENT_DISTANCE_IS_HYPOTHESIS_ONLY"
    | "LINEAGE_EVIDENCE_UNAVAILABLE"
    | "OPPOSITION_QUALITY_UNAVAILABLE"
    | "SUBSTITUTION_BUDGET_USAGE_UNAVAILABLE"
  )[];
  automaticRaceEntryAllowed: false;
  automaticRosterMutationAllowed: false;
}>;

export type ProLeagueDiscoveryExperimentQueue = Readonly<{
  authority: "active_verified_exact_format_generation";
  evidenceCutoffAt: string;
  exactDistanceMinimumRaceCount: 10;
  experiments: readonly ProLeagueDiscoveryExperiment[];
  diagnostics: Readonly<{
    priorityGapCount: number;
    eligibleExperimentCount: number;
    truncatedExperimentCount: number;
    stoppedWeakPathCount: number;
    conflictingEvidenceCount: number;
    unresolvedCandidateCellCount: number;
  }>;
  substitutionBudget: Readonly<{
    maximumPerYear: 10;
    usedCount: null;
    remainingCount: null;
    initialRosterCountingPolicy: "unresolved";
    guidance: string;
  }>;
  automaticRaceEntryAllowed: false;
  automaticRosterMutationAllowed: false;
}>;

function key(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.trim().toLowerCase(), distanceMetres]);
}

function strongSupportingSignal(cell: Cell): boolean {
  const opposition = cell.supportingOpposition;
  const stars = cell.supportingStars;
  return (
    (opposition.status === "available" &&
      (opposition.winCount > 0 || opposition.topThreeCount > 0)) ||
    (stars.status === "available" &&
      (stars.strongFieldYellowReceivedCount > 0 ||
        stars.strongFieldBlueReceivedCount > 0 ||
        stars.eliteOpponentYellowReceivedCount > 0 ||
        stars.eliteOpponentBlueReceivedCount > 0))
  );
}

function impact(
  candidate: Candidate,
  rosterRoles: ReadonlyMap<string, string>,
): ProLeagueDiscoveryExperiment["rosterImpact"] | null {
  const role = rosterRoles.get(candidate.core.coreId);
  if (role === undefined) return "challenge_provisional_roster_slot";
  if (role === "structural_coverage") {
    return "prove_provisional_member_before_lock";
  }
  if (role === "optional") return "improve_marginal_member_confidence";
  return null;
}

function adjacentCell(candidate: Candidate, gap: Gap): Cell | null {
  return (
    candidate.cells
      .filter(
        (cell) =>
          cell.raceType.trim().toLowerCase() ===
            gap.raceType.trim().toLowerCase() &&
          cell.distanceMetres !== gap.distanceMetres &&
          cell.evidenceUse !== "stale_unavailable" &&
          (cell.benchmarkAssessment === "winning_range" ||
            cell.benchmarkAssessment === "top_three_range"),
      )
      .sort(
        (left, right) =>
          Math.abs(left.distanceMetres - gap.distanceMetres) -
            Math.abs(right.distanceMetres - gap.distanceMetres) ||
          { winning_range: 0, top_three_range: 1, outside_top_three_range: 2 }[
            left.benchmarkAssessment
          ] -
            {
              winning_range: 0,
              top_three_range: 1,
              outside_top_three_range: 2,
            }[right.benchmarkAssessment] ||
          right.raceCount - left.raceCount ||
          left.distanceMetres - right.distanceMetres,
      )[0] ?? null
  );
}

function experiment(
  candidate: Candidate,
  gap: Gap,
  rosterImpact: ProLeagueDiscoveryExperiment["rosterImpact"],
  diagnostics: {
    stoppedWeakPathCount: number;
    conflictingEvidenceCount: number;
    unresolvedCandidateCellCount: number;
  },
): ProLeagueDiscoveryExperiment | null {
  const exact = candidate.cells.find(
    (cell) =>
      key(cell.raceType, cell.distanceMetres) ===
      key(gap.raceType, gap.distanceMetres),
  );
  if (exact?.evidenceUse === "stale_unavailable") {
    diagnostics.unresolvedCandidateCellCount += 1;
    return null;
  }
  if (exact !== undefined && exact.raceCount >= MINIMUM_EXACT_DISTANCE_RACES) {
    if (exact.benchmarkAssessment === "outside_top_three_range") {
      diagnostics.stoppedWeakPathCount += 1;
    }
    return null;
  }
  if (
    exact !== undefined &&
    exact.benchmarkAssessment === "outside_top_three_range" &&
    exact.raceCount >= 4
  ) {
    if (strongSupportingSignal(exact)) {
      diagnostics.conflictingEvidenceCount += 1;
    } else {
      diagnostics.stoppedWeakPathCount += 1;
    }
    return null;
  }

  const source = exact ?? adjacentCell(candidate, gap);
  if (source === null || source === undefined) {
    diagnostics.unresolvedCandidateCellCount += 1;
    return null;
  }
  const directRaceCount = exact?.raceCount ?? 0;
  const observationsToMinimum = MINIMUM_EXACT_DISTANCE_RACES - directRaceCount;
  const decision =
    source.benchmarkAssessment === "outside_top_three_range"
      ? "single_confirmation"
      : "complete_exact_minimum";
  const warnings = new Set<ProLeagueDiscoveryExperiment["warnings"][number]>([
    "EXPERIMENTAL_SMALL_SAMPLE",
    "LINEAGE_EVIDENCE_UNAVAILABLE",
    "SUBSTITUTION_BUDGET_USAGE_UNAVAILABLE",
  ]);
  if (exact === undefined) warnings.add("ADJACENT_DISTANCE_IS_HYPOTHESIS_ONLY");
  if (
    source.supportingOpposition.status === "unavailable" ||
    source.supportingStars.status === "unavailable"
  ) {
    warnings.add("OPPOSITION_QUALITY_UNAVAILABLE");
  }
  return Object.freeze({
    coreId: candidate.core.coreId,
    displayName: candidate.core.displayName,
    raceType: gap.raceType,
    distanceMetres: gap.distanceMetres,
    mapIds: gap.mapIds,
    raceLineCount: gap.raceLineCount,
    gapPriority: gap.discoveryPriority as Exclude<
      Gap["discoveryPriority"],
      "maintain"
    >,
    gapStatus: gap.status,
    rosterImpact,
    hypothesisSource:
      exact === undefined
        ? "adjacent_distance_same_race_type"
        : "exact_distance_sample",
    sourceDistanceMetres: source.distanceMetres,
    benchmarkSignal: source.benchmarkAssessment,
    directRaceCount,
    observationsToMinimum,
    recommendedNextRaceCount:
      decision === "single_confirmation"
        ? 1
        : Math.min(3, observationsToMinimum),
    decision,
    evidenceCurrentThrough: source.dataCurrentThrough,
    warnings: Object.freeze([...warnings].sort()),
    automaticRaceEntryAllowed: false,
    automaticRosterMutationAllowed: false,
  });
}

export function buildProLeagueDiscoveryExperimentQueue(
  roster: ProLeagueDraftRosterRecommendation,
): ProLeagueDiscoveryExperimentQueue {
  const priorityGaps = roster.coverageGaps.filter(
    (gap): gap is Gap & { discoveryPriority: "high" | "medium" } =>
      gap.discoveryPriority !== "maintain",
  );
  if (
    roster.candidates.length > MAXIMUM_CANDIDATES ||
    priorityGaps.length > MAXIMUM_PRIORITY_GAPS
  ) {
    throw new Error("Pro League Discovery queue input bound was exceeded.");
  }
  const rosterRoles = new Map(
    (roster.draftRoster?.members ?? [])
      .filter(({ disposition }) => disposition === "rostered")
      .map(({ core, role }) => [core.coreId, role]),
  );
  const diagnostics = {
    stoppedWeakPathCount: 0,
    conflictingEvidenceCount: 0,
    unresolvedCandidateCellCount: 0,
  };
  const experiments = priorityGaps.flatMap((gap) =>
    roster.candidates.flatMap((candidate) => {
      const rosterImpact = impact(candidate, rosterRoles);
      if (rosterImpact === null) return [];
      const value = experiment(candidate, gap, rosterImpact, diagnostics);
      return value === null ? [] : [value];
    }),
  );
  const priority = { high: 0, medium: 1 } as const;
  const impactPriority = {
    challenge_provisional_roster_slot: 0,
    prove_provisional_member_before_lock: 1,
    improve_marginal_member_confidence: 2,
  } as const;
  experiments.sort(
    (left, right) =>
      priority[left.gapPriority] - priority[right.gapPriority] ||
      right.raceLineCount - left.raceLineCount ||
      impactPriority[left.rosterImpact] - impactPriority[right.rosterImpact] ||
      left.observationsToMinimum - right.observationsToMinimum ||
      left.displayName.localeCompare(right.displayName) ||
      left.coreId.localeCompare(right.coreId) ||
      left.raceType.localeCompare(right.raceType) ||
      left.distanceMetres - right.distanceMetres,
  );
  const selectedExperiments = experiments.slice(0, MAXIMUM_EXPERIMENTS);
  return Object.freeze({
    authority: "active_verified_exact_format_generation",
    evidenceCutoffAt: roster.evidenceCutoffAt,
    exactDistanceMinimumRaceCount: MINIMUM_EXACT_DISTANCE_RACES,
    experiments: Object.freeze(selectedExperiments),
    diagnostics: Object.freeze({
      priorityGapCount: priorityGaps.length,
      eligibleExperimentCount: experiments.length,
      truncatedExperimentCount: experiments.length - selectedExperiments.length,
      ...diagnostics,
    }),
    substitutionBudget: Object.freeze({
      maximumPerYear: proLeagueCurrentRules.maximumSubstitutionsPerYear,
      usedCount: null,
      remainingCount: null,
      initialRosterCountingPolicy: "unresolved",
      guidance:
        "Substitution usage is not connected to this read model. Preserve all ten annual substitutions until the ledger and initial-roster counting rule are confirmed.",
    }),
    automaticRaceEntryAllowed: false,
    automaticRosterMutationAllowed: false,
  });
}
