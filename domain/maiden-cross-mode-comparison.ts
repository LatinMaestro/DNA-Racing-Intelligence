export const maidenComparisonModes = ["bike", "car", "horse"] as const;
export type MaidenComparisonMode = (typeof maidenComparisonModes)[number];

export type MaidenModeProjectionInput = Readonly<{
  coreId: string;
  mode: MaidenComparisonMode;
  bestDistanceMetres: number | null;
  leaderboardObjective:
    | "fastest_single_time"
    | "median_time"
    | "average_time"
    | "wins"
    | "top_x"
    | "points"
    | "custom";
  projectedMaidenValueScore: number | null;
  projectionStatus: "complete" | "partial" | "unavailable";
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  historicalStarSupport: "supports" | "neutral" | "conflicts" | "unavailable";
  evidenceConfidence: "high" | "moderate" | "low" | "unknown";
  tournamentStructureStatus: "complete" | "partial" | "unknown";
  availableMaidenTournamentId: string | null;
  availableMaidenStatus: "upcoming" | "qualifying" | "closed" | null;
  alternativeEligibleCoreCount: number;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type MaidenCrossModeThresholds = Readonly<{
  strongestModeGapPoints: number;
  projectionVersion: string;
}>;

export type MaidenComparisonWarning =
  | "GATE_C_NOT_PASSED"
  | "GATE_D_NOT_PASSED"
  | "CROSS_MODE_EVIDENCE_INCOMPLETE"
  | "PROJECTION_PARTIAL"
  | "PROJECTION_UNAVAILABLE"
  | "TIME_EVIDENCE_WEAK"
  | "TIME_EVIDENCE_UNKNOWN"
  | "STAR_TIME_CONFLICT"
  | "TOURNAMENT_STRUCTURE_INCOMPLETE"
  | "LOW_EVIDENCE_CONFIDENCE"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "ALTERNATIVE_ME_SCARCE"
  | "PRESERVE_ME";

export type MaidenModeComparison = Readonly<{
  coreId: string;
  mode: MaidenComparisonMode;
  bestDistanceMetres: number | null;
  leaderboardObjective: MaidenModeProjectionInput["leaderboardObjective"];
  projectedMaidenValueScore: number | null;
  credibleForComparison: boolean;
  projectedRank: number | null;
  disposition:
    | "strongest_mode_review"
    | "preserve_me"
    | "wait_for_strongest_mode"
    | "more_evidence_required"
    | "no_active_maiden";
  availableMaidenTournamentId: string | null;
  alternativeEligibleCoreCount: number;
  historicalStarSupport: MaidenModeProjectionInput["historicalStarSupport"];
  starsUsedForProjectionScore: false;
  warnings: readonly MaidenComparisonWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: MaidenModeProjectionInput["freshness"];
  actionableRecommendationAllowed: false;
  maidenCommitmentAllowed: false;
}>;

export type MaidenCrossModeComparison = Readonly<{
  coreId: string;
  strongestProjectedMode: MaidenComparisonMode | null;
  modes: readonly MaidenModeComparison[];
  comparisonAuthority: "configured_time_led_projection_score";
  historicalStarsRole: "supporting_rationale_only";
  projectionVersion: string;
  gateCRequired: true;
  gateDRequired: true;
  actionableRecommendationAllowed: false;
  maidenCommitmentAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function score(value: number | null): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error("Projected Maiden value score must be from zero to 100.");
  }
  return value;
}

export function compareMaidenModes(
  inputs: readonly MaidenModeProjectionInput[],
  thresholds: MaidenCrossModeThresholds,
): MaidenCrossModeComparison {
  if (
    !Number.isFinite(thresholds.strongestModeGapPoints) ||
    thresholds.strongestModeGapPoints <= 0 ||
    thresholds.strongestModeGapPoints > 100
  ) {
    throw new Error(
      "Strongest-mode gap must be greater than zero and at most 100.",
    );
  }
  const projectionVersion = required(
    thresholds.projectionVersion,
    "Projection version",
  );
  if (inputs.length !== maidenComparisonModes.length) {
    throw new Error("Cross-mode comparison requires Bike, Car and Horse.");
  }

  const normalized = inputs.map((input) => {
    const coreId = required(input.coreId, "Core ID");
    if (!maidenComparisonModes.includes(input.mode)) {
      throw new Error("Maiden comparison mode is invalid.");
    }
    if (
      ![
        "fastest_single_time",
        "median_time",
        "average_time",
        "wins",
        "top_x",
        "points",
        "custom",
      ].includes(input.leaderboardObjective)
    ) {
      throw new Error("Leaderboard objective is invalid.");
    }
    if (
      !["complete", "partial", "unavailable"].includes(input.projectionStatus)
    ) {
      throw new Error("Projection status is invalid.");
    }
    if (
      !["strong", "competitive", "weak", "unknown"].includes(input.timeEvidence)
    ) {
      throw new Error("Time evidence is invalid.");
    }
    if (
      !["supports", "neutral", "conflicts", "unavailable"].includes(
        input.historicalStarSupport,
      )
    ) {
      throw new Error("Historical star support is invalid.");
    }
    if (
      !["high", "moderate", "low", "unknown"].includes(input.evidenceConfidence)
    ) {
      throw new Error("Evidence confidence is invalid.");
    }
    if (
      !["complete", "partial", "unknown"].includes(
        input.tournamentStructureStatus,
      )
    ) {
      throw new Error("Tournament structure status is invalid.");
    }
    if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
      throw new Error("Freshness is invalid.");
    }
    if (
      !Number.isSafeInteger(input.alternativeEligibleCoreCount) ||
      input.alternativeEligibleCoreCount < 0
    ) {
      throw new Error(
        "Alternative eligible core count must be a non-negative safe integer.",
      );
    }

    const projectedMaidenValueScore = score(input.projectedMaidenValueScore);
    if (
      input.projectionStatus === "unavailable" &&
      projectedMaidenValueScore !== null
    ) {
      throw new Error("Unavailable projection cannot carry a score.");
    }
    if (
      input.projectionStatus !== "unavailable" &&
      projectedMaidenValueScore === null
    ) {
      throw new Error("Available projection requires a score.");
    }
    if (
      input.bestDistanceMetres !== null &&
      (!Number.isSafeInteger(input.bestDistanceMetres) ||
        input.bestDistanceMetres <= 0)
    ) {
      throw new Error("Best distance must be a positive safe integer.");
    }
    if (
      input.projectionStatus === "complete" &&
      input.bestDistanceMetres === null
    ) {
      throw new Error("Complete projection requires a best distance.");
    }

    const tournamentId =
      input.availableMaidenTournamentId === null
        ? null
        : required(input.availableMaidenTournamentId, "Maiden tournament ID");
    if ((tournamentId === null) !== (input.availableMaidenStatus === null)) {
      throw new Error(
        "Maiden tournament identity and availability must be supplied together.",
      );
    }
    if (
      input.availableMaidenStatus !== null &&
      !["upcoming", "qualifying", "closed"].includes(
        input.availableMaidenStatus,
      )
    ) {
      throw new Error("Maiden tournament availability is invalid.");
    }

    const dataCurrentThrough = timestamp(
      input.dataCurrentThrough,
      "Data current through",
    );
    const lastImported = timestamp(input.lastImported, "Last imported");
    if (
      dataCurrentThrough !== null &&
      lastImported !== null &&
      Date.parse(lastImported) < Date.parse(dataCurrentThrough)
    ) {
      throw new Error("Last imported cannot precede data current through.");
    }

    const credible =
      input.projectionStatus === "complete" &&
      projectedMaidenValueScore !== null &&
      ["strong", "competitive"].includes(input.timeEvidence) &&
      ["high", "moderate"].includes(input.evidenceConfidence) &&
      input.tournamentStructureStatus === "complete" &&
      dataCurrentThrough !== null &&
      lastImported !== null &&
      ["current", "ageing"].includes(input.freshness);

    return {
      ...input,
      coreId,
      projectedMaidenValueScore,
      availableMaidenTournamentId: tournamentId,
      dataCurrentThrough,
      lastImported,
      credible,
    };
  });

  const coreIds = new Set(normalized.map(({ coreId }) => coreId));
  if (coreIds.size !== 1) {
    throw new Error("Cross-mode comparison must concern one core.");
  }
  if (
    new Set(normalized.map(({ mode }) => mode)).size !==
    maidenComparisonModes.length
  ) {
    throw new Error("Cross-mode comparison requires each mode exactly once.");
  }

  const allCredible = normalized.every(({ credible }) => credible);
  const ordered = [...normalized].sort(
    (left, right) =>
      (right.projectedMaidenValueScore ?? -1) -
        (left.projectedMaidenValueScore ?? -1) ||
      maidenComparisonModes.indexOf(left.mode) -
        maidenComparisonModes.indexOf(right.mode),
  );
  const strongestProjectedMode =
    allCredible &&
    ordered[0]!.projectedMaidenValueScore! -
      ordered[1]!.projectedMaidenValueScore! >=
      thresholds.strongestModeGapPoints
      ? ordered[0]!.mode
      : null;

  const rankByMode = new Map<MaidenComparisonMode, number>();
  if (allCredible) {
    for (const [index, item] of ordered.entries()) {
      const previous = ordered[index - 1];
      rankByMode.set(
        item.mode,
        previous?.projectedMaidenValueScore === item.projectedMaidenValueScore
          ? rankByMode.get(previous.mode)!
          : index + 1,
      );
    }
  }

  const modes = normalized
    .map((item): MaidenModeComparison => {
      const warnings = new Set<MaidenComparisonWarning>([
        "GATE_C_NOT_PASSED",
        "GATE_D_NOT_PASSED",
      ]);
      if (!allCredible) warnings.add("CROSS_MODE_EVIDENCE_INCOMPLETE");
      if (item.projectionStatus === "partial")
        warnings.add("PROJECTION_PARTIAL");
      if (item.projectionStatus === "unavailable") {
        warnings.add("PROJECTION_UNAVAILABLE");
      }
      if (item.timeEvidence === "weak") warnings.add("TIME_EVIDENCE_WEAK");
      if (item.timeEvidence === "unknown")
        warnings.add("TIME_EVIDENCE_UNKNOWN");
      if (item.historicalStarSupport === "conflicts") {
        warnings.add("STAR_TIME_CONFLICT");
      }
      if (item.tournamentStructureStatus !== "complete") {
        warnings.add("TOURNAMENT_STRUCTURE_INCOMPLETE");
      }
      if (["low", "unknown"].includes(item.evidenceConfidence)) {
        warnings.add("LOW_EVIDENCE_CONFIDENCE");
      }
      if (item.dataCurrentThrough === null || item.freshness === "unknown") {
        warnings.add("DATA_CUTOFF_UNKNOWN");
      }
      if (item.lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
      if (item.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
      if (item.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");
      if (item.alternativeEligibleCoreCount === 0) {
        warnings.add("ALTERNATIVE_ME_SCARCE");
      }

      const activeMaiden =
        item.availableMaidenTournamentId !== null &&
        item.availableMaidenStatus !== "closed";
      let disposition: MaidenModeComparison["disposition"];
      if (strongestProjectedMode === null) {
        disposition = "more_evidence_required";
      } else if (item.mode === strongestProjectedMode) {
        disposition = activeMaiden
          ? "strongest_mode_review"
          : "wait_for_strongest_mode";
      } else if (activeMaiden) {
        disposition = "preserve_me";
        warnings.add("PRESERVE_ME");
      } else {
        disposition = "no_active_maiden";
      }

      return {
        coreId: item.coreId,
        mode: item.mode,
        bestDistanceMetres: item.bestDistanceMetres,
        leaderboardObjective: item.leaderboardObjective,
        projectedMaidenValueScore: item.projectedMaidenValueScore,
        credibleForComparison: item.credible,
        projectedRank: allCredible ? rankByMode.get(item.mode)! : null,
        disposition,
        availableMaidenTournamentId: item.availableMaidenTournamentId,
        alternativeEligibleCoreCount: item.alternativeEligibleCoreCount,
        historicalStarSupport: item.historicalStarSupport,
        starsUsedForProjectionScore: false,
        warnings: [...warnings],
        dataCurrentThrough: item.dataCurrentThrough,
        lastImported: item.lastImported,
        freshness: item.freshness,
        actionableRecommendationAllowed: false,
        maidenCommitmentAllowed: false,
      };
    })
    .sort(
      (left, right) =>
        maidenComparisonModes.indexOf(left.mode) -
        maidenComparisonModes.indexOf(right.mode),
    );

  return {
    coreId: normalized[0]!.coreId,
    strongestProjectedMode,
    modes,
    comparisonAuthority: "configured_time_led_projection_score",
    historicalStarsRole: "supporting_rationale_only",
    projectionVersion,
    gateCRequired: true,
    gateDRequired: true,
    actionableRecommendationAllowed: false,
    maidenCommitmentAllowed: false,
  };
}
