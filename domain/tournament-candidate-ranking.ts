import type { FreshnessState } from "@/domain/freshness";

export type CandidateFreshness = FreshnessState;

export type TournamentCandidateInput = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  leaderboardGroupLabel: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  eligibility: "eligible" | "ineligible" | "review_required";
  metricStatus: "complete" | "partial" | "unavailable";
  metricRank: number | null;
  metricEvidenceLabel: string | null;
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  historicalStarSupport: "supports" | "neutral" | "conflicts" | "unavailable";
  evidenceConfidence: "high" | "medium" | "low" | "unknown";
  maidenState: "eligible" | "not_eligible" | "unknown";
  maidenModeDisposition:
    | "preferred_here"
    | "preserve_for_stronger_mode"
    | "not_applicable"
    | "unresolved";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: CandidateFreshness;
}>;

export type TournamentCandidateRankingInput = Readonly<{
  tournamentId: string;
  tournamentLabel: string;
  bracketId: string;
  splitLabel: string;
  qualificationMetricLabel: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  candidates: readonly TournamentCandidateInput[];
}>;

export type TournamentCandidateWarning =
  | "ELIGIBILITY_REVIEW_REQUIRED"
  | "METRIC_EVIDENCE_PARTIAL"
  | "METRIC_EVIDENCE_UNAVAILABLE"
  | "TIME_EVIDENCE_WEAK"
  | "TIME_EVIDENCE_UNKNOWN"
  | "STAR_TIME_CONFLICT"
  | "LOW_EVIDENCE_CONFIDENCE"
  | "EVIDENCE_CONFIDENCE_UNKNOWN"
  | "PRESERVE_ME"
  | "MAIDEN_DISPOSITION_UNRESOLVED"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "CURRENT_FIELD_UNAVAILABLE"
  | "GATE_C_NOT_PASSED";

export type TournamentCandidateRanking = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  leaderboardGroupLabel: string;
  configuredMetricRank: number | null;
  groupReviewRank: number | null;
  disposition: "review_candidate" | "hold" | "preserve_me" | "ineligible";
  timeEvidence: TournamentCandidateInput["timeEvidence"];
  historicalStarSupport: TournamentCandidateInput["historicalStarSupport"];
  starUsedForOrdering: false;
  evidenceConfidence: TournamentCandidateInput["evidenceConfidence"];
  maidenState: TournamentCandidateInput["maidenState"];
  warnings: readonly TournamentCandidateWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: CandidateFreshness;
  importedHistoricalSnapshot: true;
  currentQualifyingFieldAvailable: false;
  actionableRecommendationAllowed: false;
  automaticEntryAllowed: false;
}>;

export type TournamentLeaderboardGroup = Readonly<{
  leaderboardGroupId: string;
  leaderboardGroupLabel: string;
  candidates: readonly TournamentCandidateRanking[];
}>;

export type TournamentCandidateRankingResult = Readonly<{
  tournamentId: string;
  tournamentLabel: string;
  bracketId: string;
  splitLabel: string;
  qualificationMetricLabel: string;
  configurationVersion: string;
  candidateSnapshotVersion: string;
  leaderboardGroups: readonly TournamentLeaderboardGroup[];
  orderingAuthority: "configured_qualification_metric";
  historicalStarsRole: "supporting_rationale_only";
  gateCRequired: true;
  currentQualifyingFieldAvailable: false;
  actionableRecommendationAllowed: false;
}>;

const versions = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;

function required(value: string, label: string): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function version(value: string, label: string): string {
  const normalized = required(value, label);
  if (!versions.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function canonicalTimestamp(
  value: string | null,
  label: string,
): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} must be canonical.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be canonical.`);
  }
  return value;
}

function positiveRank(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error("Configured metric rank must be a positive safe integer.");
  }
  return value;
}

export function rankTournamentCandidates(
  input: TournamentCandidateRankingInput,
): TournamentCandidateRankingResult {
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const tournamentLabel = required(input.tournamentLabel, "Tournament label");
  const bracketId = required(input.bracketId, "Bracket ID");
  const splitLabel = required(input.splitLabel, "Split label");
  const qualificationMetricLabel = required(
    input.qualificationMetricLabel,
    "Qualification metric label",
  );
  const configurationVersion = version(
    input.configurationVersion,
    "Tournament configuration version",
  );
  const candidateSnapshotVersion = version(
    input.candidateSnapshotVersion,
    "Candidate snapshot version",
  );

  const groupLabels = new Map<string, string>();
  const labelGroups = new Map<string, string>();
  const normalized = input.candidates.map((candidate) => {
    const coreId = required(candidate.coreId, "Core ID");
    const leaderboardGroupId = required(
      candidate.leaderboardGroupId,
      "Leaderboard group ID",
    );
    const leaderboardGroupLabel = required(
      candidate.leaderboardGroupLabel,
      "Leaderboard group label",
    );
    if (
      candidate.configurationVersion !== configurationVersion ||
      candidate.candidateSnapshotVersion !== candidateSnapshotVersion
    ) {
      throw new Error(
        "Candidate evidence is not bound to the active versions.",
      );
    }
    if (
      (groupLabels.has(leaderboardGroupId) &&
        groupLabels.get(leaderboardGroupId) !== leaderboardGroupLabel) ||
      (labelGroups.has(leaderboardGroupLabel) &&
        labelGroups.get(leaderboardGroupLabel) !== leaderboardGroupId)
    ) {
      throw new Error("Leaderboard group labels are inconsistent.");
    }
    groupLabels.set(leaderboardGroupId, leaderboardGroupLabel);
    labelGroups.set(leaderboardGroupLabel, leaderboardGroupId);

    if (
      !["eligible", "ineligible", "review_required"].includes(
        candidate.eligibility,
      )
    ) {
      throw new Error("Candidate eligibility is invalid.");
    }
    if (
      !["complete", "partial", "unavailable"].includes(candidate.metricStatus)
    ) {
      throw new Error("Candidate metric status is invalid.");
    }
    if (
      !["strong", "competitive", "weak", "unknown"].includes(
        candidate.timeEvidence,
      )
    ) {
      throw new Error("Candidate time evidence is invalid.");
    }
    if (
      !["supports", "neutral", "conflicts", "unavailable"].includes(
        candidate.historicalStarSupport,
      )
    ) {
      throw new Error("Candidate star support is invalid.");
    }
    if (
      !["high", "medium", "low", "unknown"].includes(
        candidate.evidenceConfidence,
      )
    ) {
      throw new Error("Candidate evidence confidence is invalid.");
    }
    if (
      !["eligible", "not_eligible", "unknown"].includes(candidate.maidenState)
    ) {
      throw new Error("Candidate Maiden state is invalid.");
    }
    if (
      ![
        "preferred_here",
        "preserve_for_stronger_mode",
        "not_applicable",
        "unresolved",
      ].includes(candidate.maidenModeDisposition)
    ) {
      throw new Error("Candidate Maiden mode disposition is invalid.");
    }
    if (
      !["current", "ageing", "stale", "unknown"].includes(candidate.freshness)
    ) {
      throw new Error("Candidate freshness is invalid.");
    }

    const metricRank = positiveRank(candidate.metricRank);
    if (candidate.metricStatus === "unavailable") {
      if (metricRank !== null || candidate.metricEvidenceLabel !== null) {
        throw new Error(
          "Unavailable metric evidence cannot carry a rank or label.",
        );
      }
    } else if (
      metricRank === null ||
      required(candidate.metricEvidenceLabel ?? "", "Metric evidence label") !==
        qualificationMetricLabel
    ) {
      throw new Error(
        "Available metric evidence must match the configured metric.",
      );
    }
    if (
      candidate.maidenModeDisposition === "preserve_for_stronger_mode" &&
      candidate.maidenState !== "eligible"
    ) {
      throw new Error("Only a Maiden-eligible core can preserve ME.");
    }

    const dataCurrentThrough = canonicalTimestamp(
      candidate.dataCurrentThrough,
      "Data current through",
    );
    const lastImported = canonicalTimestamp(
      candidate.lastImported,
      "Last imported",
    );
    if (
      dataCurrentThrough !== null &&
      lastImported !== null &&
      Date.parse(lastImported) < Date.parse(dataCurrentThrough)
    ) {
      throw new Error("Last imported cannot precede data current through.");
    }
    return {
      ...candidate,
      coreId,
      leaderboardGroupId,
      leaderboardGroupLabel,
      metricRank,
      dataCurrentThrough,
      lastImported,
    };
  });

  const coreIds = normalized.map(({ coreId }) => coreId);
  if (new Set(coreIds).size !== coreIds.length) {
    throw new Error("A candidate core must appear only once per bracket.");
  }

  const preliminary = normalized.map((candidate) => {
    const warnings = new Set<TournamentCandidateWarning>([
      "CURRENT_FIELD_UNAVAILABLE",
      "GATE_C_NOT_PASSED",
    ]);
    if (candidate.eligibility === "review_required")
      warnings.add("ELIGIBILITY_REVIEW_REQUIRED");
    if (candidate.metricStatus === "partial")
      warnings.add("METRIC_EVIDENCE_PARTIAL");
    if (candidate.metricStatus === "unavailable")
      warnings.add("METRIC_EVIDENCE_UNAVAILABLE");
    if (candidate.timeEvidence === "weak") warnings.add("TIME_EVIDENCE_WEAK");
    if (candidate.timeEvidence === "unknown")
      warnings.add("TIME_EVIDENCE_UNKNOWN");
    if (candidate.historicalStarSupport === "conflicts")
      warnings.add("STAR_TIME_CONFLICT");
    if (candidate.evidenceConfidence === "low")
      warnings.add("LOW_EVIDENCE_CONFIDENCE");
    if (candidate.evidenceConfidence === "unknown")
      warnings.add("EVIDENCE_CONFIDENCE_UNKNOWN");
    if (candidate.maidenModeDisposition === "preserve_for_stronger_mode")
      warnings.add("PRESERVE_ME");
    if (
      candidate.maidenState === "eligible" &&
      candidate.maidenModeDisposition === "unresolved"
    ) {
      warnings.add("MAIDEN_DISPOSITION_UNRESOLVED");
    }
    if (
      candidate.dataCurrentThrough === null ||
      candidate.freshness === "unknown"
    )
      warnings.add("DATA_CUTOFF_UNKNOWN");
    if (candidate.lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
    if (candidate.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
    if (candidate.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");

    const disposition: TournamentCandidateRanking["disposition"] =
      candidate.eligibility === "ineligible"
        ? "ineligible"
        : candidate.maidenModeDisposition === "preserve_for_stronger_mode"
          ? "preserve_me"
          : candidate.eligibility !== "eligible" ||
              candidate.metricStatus !== "complete" ||
              ["weak", "unknown"].includes(candidate.timeEvidence) ||
              candidate.historicalStarSupport === "conflicts" ||
              ["low", "unknown"].includes(candidate.evidenceConfidence) ||
              candidate.freshness !== "current" ||
              candidate.dataCurrentThrough === null ||
              candidate.lastImported === null ||
              (candidate.maidenState === "eligible" &&
                candidate.maidenModeDisposition === "unresolved")
            ? "hold"
            : "review_candidate";

    return {
      coreId: candidate.coreId,
      leaderboardGroupId: candidate.leaderboardGroupId,
      leaderboardGroupLabel: candidate.leaderboardGroupLabel,
      configuredMetricRank: candidate.metricRank,
      groupReviewRank: null,
      disposition,
      timeEvidence: candidate.timeEvidence,
      historicalStarSupport: candidate.historicalStarSupport,
      starUsedForOrdering: false as const,
      evidenceConfidence: candidate.evidenceConfidence,
      maidenState: candidate.maidenState,
      warnings: [...warnings].sort(),
      dataCurrentThrough: candidate.dataCurrentThrough,
      lastImported: candidate.lastImported,
      freshness: candidate.freshness,
      importedHistoricalSnapshot: true as const,
      currentQualifyingFieldAvailable: false as const,
      actionableRecommendationAllowed: false as const,
      automaticEntryAllowed: false as const,
    };
  });

  const groups = new Map<string, TournamentCandidateRanking[]>();
  for (const item of preliminary) {
    const candidate: TournamentCandidateRanking = {
      ...item,
      groupReviewRank:
        item.disposition === "review_candidate"
          ? item.configuredMetricRank
          : null,
    };
    const group = groups.get(candidate.leaderboardGroupId) ?? [];
    group.push(candidate);
    groups.set(candidate.leaderboardGroupId, group);
  }

  return {
    tournamentId,
    tournamentLabel,
    bracketId,
    splitLabel,
    qualificationMetricLabel,
    configurationVersion,
    candidateSnapshotVersion,
    leaderboardGroups: [...groups.entries()]
      .map(([leaderboardGroupId, candidates]) => ({
        leaderboardGroupId,
        leaderboardGroupLabel: groupLabels.get(leaderboardGroupId)!,
        candidates: candidates.sort(
          (left, right) =>
            (left.groupReviewRank ?? Number.MAX_SAFE_INTEGER) -
              (right.groupReviewRank ?? Number.MAX_SAFE_INTEGER) ||
            (left.configuredMetricRank ?? Number.MAX_SAFE_INTEGER) -
              (right.configuredMetricRank ?? Number.MAX_SAFE_INTEGER) ||
            left.coreId.localeCompare(right.coreId),
        ),
      }))
      .sort(
        (left, right) =>
          left.leaderboardGroupLabel.localeCompare(
            right.leaderboardGroupLabel,
          ) || left.leaderboardGroupId.localeCompare(right.leaderboardGroupId),
      ),
    orderingAuthority: "configured_qualification_metric",
    historicalStarsRole: "supporting_rationale_only",
    gateCRequired: true,
    currentQualifyingFieldAvailable: false,
    actionableRecommendationAllowed: false,
  };
}
