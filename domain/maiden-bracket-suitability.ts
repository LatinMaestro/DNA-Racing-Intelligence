export const maidenSuitabilityModes = ["bike", "car", "horse"] as const;
export type MaidenSuitabilityMode = (typeof maidenSuitabilityModes)[number];

export type MaidenDistanceSuitabilityInput = Readonly<{
  distanceMetres: number;
  timeEvidence: "strong" | "competitive" | "weak" | "unknown";
  configuredMetricFit: "strong" | "competitive" | "weak" | "unknown";
  sampleStatus: "sufficient" | "limited" | "insufficient" | "unavailable";
  historicalStarSupport: "supports" | "neutral" | "conflicts" | "unavailable";
}>;

export type MaidenBracketSuitabilityInput = Readonly<{
  coreId: string;
  tournamentId: string;
  bracketId: string;
  mode: MaidenSuitabilityMode;
  leaderboardObjective:
    | "fastest_single_time"
    | "median_time"
    | "average_time"
    | "wins"
    | "top_x"
    | "points"
    | "custom";
  configuredDistancesMetres: readonly number[];
  distanceEvidence: readonly MaidenDistanceSuitabilityInput[];
  tournamentAvailability: "upcoming" | "qualifying" | "closed";
  tournamentStructureStatus: "complete" | "partial" | "unknown";
  eligibility: "eligible" | "ineligible" | "review_required";
  crossModeDisposition: "strongest_mode" | "weaker_mode" | "unresolved";
  lifecycleState:
    | "eligible"
    | "planned"
    | "committed"
    | "consumed"
    | "not_eligible"
    | "unknown"
    | "invalid";
  lifecycleTournamentId: string | null;
  evidenceConfidence: "high" | "moderate" | "low" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type MaidenBracketWarning =
  | "GATE_C_NOT_PASSED"
  | "GATE_D_NOT_PASSED"
  | "PRESERVE_ME"
  | "CROSS_MODE_COMPARISON_UNRESOLVED"
  | "TOURNAMENT_STRUCTURE_INCOMPLETE"
  | "ELIGIBILITY_REVIEW_REQUIRED"
  | "MAIDEN_STATE_UNRESOLVED"
  | "DISTANCE_EVIDENCE_INCOMPLETE"
  | "LIMITED_SAMPLE"
  | "TIME_EVIDENCE_WEAK"
  | "TIME_EVIDENCE_UNKNOWN"
  | "METRIC_FIT_WEAK"
  | "METRIC_FIT_UNKNOWN"
  | "STAR_TIME_CONFLICT"
  | "PLANNED_FOR_THIS_TOURNAMENT"
  | "COMMITTED_TO_THIS_TOURNAMENT"
  | "COMMITTED_ELSEWHERE"
  | "TOURNAMENT_CLOSED"
  | "LOW_EVIDENCE_CONFIDENCE"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE";

export type MaidenBracketSuitability = Readonly<{
  coreId: string;
  tournamentId: string;
  bracketId: string;
  mode: MaidenSuitabilityMode;
  leaderboardObjective: MaidenBracketSuitabilityInput["leaderboardObjective"];
  disposition:
    | "review_candidate"
    | "preserve_me"
    | "hold"
    | "ineligible"
    | "committed_elsewhere"
    | "already_consumed"
    | "closed";
  configuredDistancesMetres: readonly number[];
  evaluatedDistances: readonly Readonly<{
    distanceMetres: number;
    status: "suitable" | "hold" | "missing";
    historicalStarSupport:
      "supports" | "neutral" | "conflicts" | "unavailable" | null;
    starsUsedToOverrideTime: false;
  }>[];
  warnings: readonly MaidenBracketWarning[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: MaidenBracketSuitabilityInput["freshness"];
  importedHistoricalSnapshot: true;
  liveFieldAvailable: false;
  actionableRecommendationAllowed: false;
  maidenCommitmentAllowed: false;
  automaticEntryAllowed: false;
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

function distance(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

export function evaluateMaidenBracketSuitability(
  input: MaidenBracketSuitabilityInput,
): MaidenBracketSuitability {
  const coreId = required(input.coreId, "Core ID");
  const tournamentId = required(input.tournamentId, "Tournament ID");
  const bracketId = required(input.bracketId, "Bracket ID");
  if (!maidenSuitabilityModes.includes(input.mode)) {
    throw new Error("Maiden suitability mode is invalid.");
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
    !["upcoming", "qualifying", "closed"].includes(input.tournamentAvailability)
  ) {
    throw new Error("Tournament availability is invalid.");
  }
  if (
    !["complete", "partial", "unknown"].includes(
      input.tournamentStructureStatus,
    )
  ) {
    throw new Error("Tournament structure status is invalid.");
  }
  if (
    !["eligible", "ineligible", "review_required"].includes(input.eligibility)
  ) {
    throw new Error("Tournament eligibility is invalid.");
  }
  if (
    !["strongest_mode", "weaker_mode", "unresolved"].includes(
      input.crossModeDisposition,
    )
  ) {
    throw new Error("Cross-mode disposition is invalid.");
  }
  if (
    ![
      "eligible",
      "planned",
      "committed",
      "consumed",
      "not_eligible",
      "unknown",
      "invalid",
    ].includes(input.lifecycleState)
  ) {
    throw new Error("Maiden lifecycle state is invalid.");
  }
  if (
    !["high", "moderate", "low", "unknown"].includes(input.evidenceConfidence)
  ) {
    throw new Error("Evidence confidence is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Freshness is invalid.");
  }

  const lifecycleTournamentId =
    input.lifecycleTournamentId === null
      ? null
      : required(input.lifecycleTournamentId, "Lifecycle tournament ID");
  if (
    ["planned", "committed", "consumed"].includes(input.lifecycleState) !==
    (lifecycleTournamentId !== null)
  ) {
    throw new Error(
      "Planned, committed and consumed states require one lifecycle tournament.",
    );
  }

  const configuredDistancesMetres = input.configuredDistancesMetres
    .map((value) => distance(value, "Configured distance"))
    .sort((left, right) => left - right);
  if (configuredDistancesMetres.length === 0) {
    throw new Error("At least one configured Maiden distance is required.");
  }
  if (
    new Set(configuredDistancesMetres).size !== configuredDistancesMetres.length
  ) {
    throw new Error("Configured Maiden distances must be unique.");
  }

  const evidence = input.distanceEvidence.map((item) => {
    const distanceMetres = distance(item.distanceMetres, "Evidence distance");
    if (!configuredDistancesMetres.includes(distanceMetres)) {
      throw new Error("Distance evidence must match a configured distance.");
    }
    if (
      !["strong", "competitive", "weak", "unknown"].includes(item.timeEvidence)
    ) {
      throw new Error("Distance time evidence is invalid.");
    }
    if (
      !["strong", "competitive", "weak", "unknown"].includes(
        item.configuredMetricFit,
      )
    ) {
      throw new Error("Configured metric fit is invalid.");
    }
    if (
      !["sufficient", "limited", "insufficient", "unavailable"].includes(
        item.sampleStatus,
      )
    ) {
      throw new Error("Distance sample status is invalid.");
    }
    if (
      !["supports", "neutral", "conflicts", "unavailable"].includes(
        item.historicalStarSupport,
      )
    ) {
      throw new Error("Historical star support is invalid.");
    }
    return { ...item, distanceMetres };
  });
  if (
    new Set(evidence.map(({ distanceMetres }) => distanceMetres)).size !==
    evidence.length
  ) {
    throw new Error("Distance evidence must be unique.");
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

  const warnings = new Set<MaidenBracketWarning>([
    "GATE_C_NOT_PASSED",
    "GATE_D_NOT_PASSED",
  ]);
  if (input.crossModeDisposition === "weaker_mode") warnings.add("PRESERVE_ME");
  if (input.crossModeDisposition === "unresolved") {
    warnings.add("CROSS_MODE_COMPARISON_UNRESOLVED");
  }
  if (input.tournamentStructureStatus !== "complete") {
    warnings.add("TOURNAMENT_STRUCTURE_INCOMPLETE");
  }
  if (input.eligibility === "review_required") {
    warnings.add("ELIGIBILITY_REVIEW_REQUIRED");
  }
  if (["unknown", "invalid"].includes(input.lifecycleState)) {
    warnings.add("MAIDEN_STATE_UNRESOLVED");
  }
  if (input.tournamentAvailability === "closed")
    warnings.add("TOURNAMENT_CLOSED");
  if (["low", "unknown"].includes(input.evidenceConfidence)) {
    warnings.add("LOW_EVIDENCE_CONFIDENCE");
  }
  if (dataCurrentThrough === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (lastImported === null) warnings.add("LAST_IMPORTED_UNKNOWN");
  if (input.freshness === "ageing") warnings.add("IMPORTED_DATA_AGEING");
  if (input.freshness === "stale") warnings.add("IMPORTED_DATA_STALE");
  if (
    input.lifecycleState === "planned" &&
    lifecycleTournamentId === tournamentId
  ) {
    warnings.add("PLANNED_FOR_THIS_TOURNAMENT");
  }
  if (
    input.lifecycleState === "committed" &&
    lifecycleTournamentId === tournamentId
  ) {
    warnings.add("COMMITTED_TO_THIS_TOURNAMENT");
  }

  const byDistance = new Map(
    evidence.map((item) => [item.distanceMetres, item] as const),
  );
  const evaluatedDistances = configuredDistancesMetres.map((distanceMetres) => {
    const item = byDistance.get(distanceMetres);
    if (!item) {
      warnings.add("DISTANCE_EVIDENCE_INCOMPLETE");
      return {
        distanceMetres,
        status: "missing" as const,
        historicalStarSupport: null,
        starsUsedToOverrideTime: false as const,
      };
    }
    if (item.sampleStatus !== "sufficient") warnings.add("LIMITED_SAMPLE");
    if (item.timeEvidence === "weak") warnings.add("TIME_EVIDENCE_WEAK");
    if (item.timeEvidence === "unknown") warnings.add("TIME_EVIDENCE_UNKNOWN");
    if (item.configuredMetricFit === "weak") warnings.add("METRIC_FIT_WEAK");
    if (item.configuredMetricFit === "unknown")
      warnings.add("METRIC_FIT_UNKNOWN");
    if (item.historicalStarSupport === "conflicts") {
      warnings.add("STAR_TIME_CONFLICT");
    }
    const suitable =
      item.sampleStatus === "sufficient" &&
      ["strong", "competitive"].includes(item.timeEvidence) &&
      ["strong", "competitive"].includes(item.configuredMetricFit);
    return {
      distanceMetres,
      status: suitable ? ("suitable" as const) : ("hold" as const),
      historicalStarSupport: item.historicalStarSupport,
      starsUsedToOverrideTime: false as const,
    };
  });

  const committedElsewhere =
    ["planned", "committed"].includes(input.lifecycleState) &&
    lifecycleTournamentId !== tournamentId;
  if (committedElsewhere) warnings.add("COMMITTED_ELSEWHERE");

  const evidenceReady =
    evaluatedDistances.every(({ status }) => status === "suitable") &&
    input.tournamentStructureStatus === "complete" &&
    input.eligibility === "eligible" &&
    input.crossModeDisposition === "strongest_mode" &&
    ["eligible", "planned", "committed"].includes(input.lifecycleState) &&
    ["high", "moderate"].includes(input.evidenceConfidence) &&
    dataCurrentThrough !== null &&
    lastImported !== null &&
    ["current", "ageing"].includes(input.freshness);

  let disposition: MaidenBracketSuitability["disposition"];
  if (input.lifecycleState === "consumed") {
    disposition = "already_consumed";
  } else if (
    input.eligibility === "ineligible" ||
    input.lifecycleState === "not_eligible"
  ) {
    disposition = "ineligible";
  } else if (committedElsewhere) {
    disposition = "committed_elsewhere";
  } else if (input.tournamentAvailability === "closed") {
    disposition = "closed";
  } else if (input.crossModeDisposition === "weaker_mode") {
    disposition = "preserve_me";
  } else if (evidenceReady) {
    disposition = "review_candidate";
  } else {
    disposition = "hold";
  }

  return {
    coreId,
    tournamentId,
    bracketId,
    mode: input.mode,
    leaderboardObjective: input.leaderboardObjective,
    disposition,
    configuredDistancesMetres,
    evaluatedDistances,
    warnings: [...warnings],
    dataCurrentThrough,
    lastImported,
    freshness: input.freshness,
    importedHistoricalSnapshot: true,
    liveFieldAvailable: false,
    actionableRecommendationAllowed: false,
    maidenCommitmentAllowed: false,
    automaticEntryAllowed: false,
  };
}
