export const strategicDiscoveryModes = ["bike", "car", "horse"] as const;
export type StrategicDiscoveryMode = (typeof strategicDiscoveryModes)[number];

export type DiscoveryTournamentContext = Readonly<{
  tournamentId: string;
  mode: StrategicDiscoveryMode;
  maiden: boolean;
  availability: "upcoming" | "qualifying" | "closed";
  relevance: "eligible" | "priority";
  leaderboardObjective:
    | "fastest_single_time"
    | "median_time"
    | "points"
    | "wins"
    | "top_x"
    | "custom";
}>;

export type DiscoveryStrategicCellInput = Readonly<{
  coreId: string;
  mode: StrategicDiscoveryMode;
  distanceMetres: number;
  directRaceCount: number;
  successfulTimePercentile: number | null;
  evidenceStatus: "complete" | "partial" | "missing" | "invalid";
  confidence: "high" | "moderate" | "low" | "unavailable";
  freshness: "current" | "ageing" | "stale" | "unknown";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  maidenState: "eligible" | "not_eligible" | "unknown" | "invalid";
  tournaments: readonly DiscoveryTournamentContext[];
}>;

export type DiscoveryStrategicThresholds = Readonly<{
  strongestModeGapPoints: number;
  version: string;
}>;

export type DiscoveryStrategicCell = Readonly<{
  coreId: string;
  mode: StrategicDiscoveryMode;
  distanceMetres: number;
  directRaceCount: number;
  racesToMinimum: number;
  successfulTimePercentile: number | null;
  credibleForCrossModeComparison: boolean;
  reviewPriority: "high" | "medium" | "low" | "defer";
  maidenSignal:
    | "not_applicable"
    | "maiden_state_unresolved"
    | "more_cross_mode_discovery_required"
    | "preserve_me_from_this_mode"
    | "strongest_mode_candidate_requires_gate_d"
    | "no_configured_maiden";
  strongestCredibleMode: StrategicDiscoveryMode | null;
  tournaments: readonly DiscoveryTournamentContext[];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  warnings: readonly (
    | "GATE_C_NOT_PASSED"
    | "GATE_D_NOT_PASSED"
    | "BELOW_MINIMUM_SAMPLE"
    | "CROSS_MODE_EVIDENCE_INCOMPLETE"
    | "MAIDEN_STATE_UNRESOLVED"
    | "PRESERVE_ME"
    | "DATA_CUTOFF_UNKNOWN"
    | "DATA_AGEING"
    | "DATA_STALE"
  )[];
  thresholdVersion: string;
  experimental: true;
  actionable: false;
  automaticEntryAllowed: false;
  maidenCommitmentAllowed: false;
}>;

export type DiscoveryStrategicPlan = Readonly<{
  cells: readonly DiscoveryStrategicCell[];
  strongestCredibleModes: Readonly<
    Record<string, StrategicDiscoveryMode | null>
  >;
  actionable: false;
  automaticEntryAllowed: false;
  gateCRequired: true;
  gateDRequiredForMaiden: true;
}>;

type NormalizedCell = Omit<
  DiscoveryStrategicCellInput,
  "coreId" | "dataCurrentThrough" | "lastImported" | "tournaments"
> & {
  coreId: string;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  tournaments: readonly DiscoveryTournamentContext[];
  credible: boolean;
};

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function normalizeTournament(
  value: DiscoveryTournamentContext,
  cellMode: StrategicDiscoveryMode,
): DiscoveryTournamentContext {
  const tournamentId = required(value.tournamentId, "Tournament ID");
  if (
    !strategicDiscoveryModes.includes(value.mode) ||
    value.mode !== cellMode
  ) {
    throw new Error("Tournament mode must match its Discovery cell.");
  }
  if (typeof value.maiden !== "boolean") {
    throw new Error("Tournament Maiden flag must be Boolean.");
  }
  if (!["upcoming", "qualifying", "closed"].includes(value.availability)) {
    throw new Error("Tournament availability is invalid.");
  }
  if (!["eligible", "priority"].includes(value.relevance)) {
    throw new Error("Tournament relevance is invalid.");
  }
  if (
    ![
      "fastest_single_time",
      "median_time",
      "points",
      "wins",
      "top_x",
      "custom",
    ].includes(value.leaderboardObjective)
  ) {
    throw new Error("Tournament leaderboard objective is invalid.");
  }
  return { ...value, tournamentId };
}

function normalizeCell(input: DiscoveryStrategicCellInput): NormalizedCell {
  const coreId = required(input.coreId, "Core ID");
  if (!strategicDiscoveryModes.includes(input.mode)) {
    throw new Error("Strategic Discovery mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error(
      "Strategic Discovery distance must be positive integer metres.",
    );
  }
  if (
    !Number.isSafeInteger(input.directRaceCount) ||
    input.directRaceCount < 0
  ) {
    throw new Error("Direct race count must be a non-negative safe integer.");
  }
  if (
    input.successfulTimePercentile !== null &&
    (!Number.isFinite(input.successfulTimePercentile) ||
      input.successfulTimePercentile < 0 ||
      input.successfulTimePercentile > 100)
  ) {
    throw new Error("Successful-time percentile must be between zero and 100.");
  }
  if (
    !["complete", "partial", "missing", "invalid"].includes(
      input.evidenceStatus,
    ) ||
    !["high", "moderate", "low", "unavailable"].includes(input.confidence) ||
    !["current", "ageing", "stale", "unknown"].includes(input.freshness) ||
    !["eligible", "not_eligible", "unknown", "invalid"].includes(
      input.maidenState,
    )
  ) {
    throw new Error("Strategic Discovery runtime state is invalid.");
  }
  if (
    (input.directRaceCount === 0 && input.successfulTimePercentile !== null) ||
    (input.evidenceStatus === "complete" &&
      input.directRaceCount > 0 &&
      input.successfulTimePercentile === null)
  ) {
    throw new Error("Strategic Discovery time evidence is inconsistent.");
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

  const tournaments = input.tournaments
    .map((value) => normalizeTournament(value, input.mode))
    .sort((left, right) => left.tournamentId.localeCompare(right.tournamentId));
  if (
    new Set(tournaments.map(({ tournamentId }) => tournamentId)).size !==
    tournaments.length
  ) {
    throw new Error("Tournament contexts must be unique within a cell.");
  }

  const credible =
    input.evidenceStatus === "complete" &&
    ["high", "moderate"].includes(input.confidence) &&
    input.successfulTimePercentile !== null &&
    dataCurrentThrough !== null &&
    lastImported !== null &&
    ["current", "ageing"].includes(input.freshness);

  return {
    ...input,
    coreId,
    dataCurrentThrough,
    lastImported,
    tournaments,
    credible,
  };
}

function strongestMode(
  cells: readonly NormalizedCell[],
  gapPoints: number,
): StrategicDiscoveryMode | null {
  const byMode = new Map<StrategicDiscoveryMode, number>();
  for (const cell of cells) {
    if (!cell.credible || cell.successfulTimePercentile === null) continue;
    byMode.set(
      cell.mode,
      Math.max(
        byMode.get(cell.mode) ?? Number.NEGATIVE_INFINITY,
        cell.successfulTimePercentile,
      ),
    );
  }
  if (byMode.size !== strategicDiscoveryModes.length) return null;
  const ordered = [...byMode.entries()].sort(
    (left, right) =>
      right[1] - left[1] ||
      strategicDiscoveryModes.indexOf(left[0]) -
        strategicDiscoveryModes.indexOf(right[0]),
  );
  const first = ordered[0]!;
  const second = ordered[1]!;
  return first[1] - second[1] >= gapPoints ? first[0] : null;
}

export function buildDiscoveryStrategicPlan(
  inputs: readonly DiscoveryStrategicCellInput[],
  thresholds: DiscoveryStrategicThresholds,
): DiscoveryStrategicPlan {
  if (
    !Number.isFinite(thresholds.strongestModeGapPoints) ||
    thresholds.strongestModeGapPoints <= 0 ||
    thresholds.strongestModeGapPoints > 100
  ) {
    throw new Error(
      "Strongest-mode gap must be greater than zero and at most 100.",
    );
  }
  const thresholdVersion = required(thresholds.version, "Threshold version");
  const normalized = inputs.map(normalizeCell);
  const keys = normalized.map((cell) =>
    JSON.stringify([cell.coreId, cell.mode, cell.distanceMetres]),
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "Strategic Discovery cells must be unique by core, mode and distance.",
    );
  }

  const byCore = new Map<string, NormalizedCell[]>();
  for (const cell of normalized) {
    const group = byCore.get(cell.coreId) ?? [];
    group.push(cell);
    byCore.set(cell.coreId, group);
  }

  const strongestCredibleModes: Record<string, StrategicDiscoveryMode | null> =
    {};
  for (const [coreId, cells] of byCore) {
    const maidenStates = new Set(cells.map(({ maidenState }) => maidenState));
    if (maidenStates.size !== 1) {
      throw new Error("Maiden state must be consistent for every core.");
    }
    strongestCredibleModes[coreId] = strongestMode(
      cells,
      thresholds.strongestModeGapPoints,
    );
  }

  const cells = normalized
    .map((cell): DiscoveryStrategicCell => {
      const strongestCredibleMode = strongestCredibleModes[cell.coreId] ?? null;
      const activeTournaments = cell.tournaments.filter(
        ({ availability }) => availability !== "closed",
      );
      const maidenTournament = activeTournaments.some(({ maiden }) => maiden);
      const priorityTournament = activeTournaments.some(
        ({ relevance }) => relevance === "priority",
      );
      const warnings = new Set<DiscoveryStrategicCell["warnings"][number]>([
        "GATE_C_NOT_PASSED",
      ]);
      if (cell.directRaceCount < 10) warnings.add("BELOW_MINIMUM_SAMPLE");
      if (cell.freshness === "ageing") warnings.add("DATA_AGEING");
      if (cell.freshness === "stale") warnings.add("DATA_STALE");
      if (
        cell.dataCurrentThrough === null ||
        cell.lastImported === null ||
        cell.freshness === "unknown"
      ) {
        warnings.add("DATA_CUTOFF_UNKNOWN");
      }
      if (["unknown", "invalid"].includes(cell.maidenState)) {
        warnings.add("MAIDEN_STATE_UNRESOLVED");
      }

      let maidenSignal: DiscoveryStrategicCell["maidenSignal"];
      if (cell.maidenState === "not_eligible") {
        maidenSignal = "not_applicable";
      } else if (["unknown", "invalid"].includes(cell.maidenState)) {
        maidenSignal = "maiden_state_unresolved";
      } else if (strongestCredibleMode === null) {
        maidenSignal = "more_cross_mode_discovery_required";
        warnings.add("CROSS_MODE_EVIDENCE_INCOMPLETE");
        warnings.add("GATE_D_NOT_PASSED");
      } else if (!maidenTournament) {
        maidenSignal = "no_configured_maiden";
      } else if (cell.mode !== strongestCredibleMode) {
        maidenSignal = "preserve_me_from_this_mode";
        warnings.add("PRESERVE_ME");
        warnings.add("GATE_D_NOT_PASSED");
      } else {
        maidenSignal = "strongest_mode_candidate_requires_gate_d";
        warnings.add("GATE_D_NOT_PASSED");
      }

      const unusable =
        ["missing", "invalid"].includes(cell.evidenceStatus) ||
        cell.successfulTimePercentile === null ||
        ["unknown", "invalid"].includes(cell.maidenState) ||
        cell.dataCurrentThrough === null ||
        cell.lastImported === null ||
        ["stale", "unknown"].includes(cell.freshness);
      const reviewPriority: DiscoveryStrategicCell["reviewPriority"] = unusable
        ? "defer"
        : maidenSignal === "strongest_mode_candidate_requires_gate_d" ||
            priorityTournament
          ? "high"
          : activeTournaments.length > 0 || cell.directRaceCount < 10
            ? "medium"
            : "low";

      return {
        coreId: cell.coreId,
        mode: cell.mode,
        distanceMetres: cell.distanceMetres,
        directRaceCount: cell.directRaceCount,
        racesToMinimum: Math.max(0, 10 - cell.directRaceCount),
        successfulTimePercentile: cell.successfulTimePercentile,
        credibleForCrossModeComparison: cell.credible,
        reviewPriority,
        maidenSignal,
        strongestCredibleMode,
        tournaments: activeTournaments,
        dataCurrentThrough: cell.dataCurrentThrough,
        lastImported: cell.lastImported,
        warnings: [...warnings].sort(),
        thresholdVersion,
        experimental: true,
        actionable: false,
        automaticEntryAllowed: false,
        maidenCommitmentAllowed: false,
      };
    })
    .sort(
      (left, right) =>
        left.coreId.localeCompare(right.coreId) ||
        strategicDiscoveryModes.indexOf(left.mode) -
          strategicDiscoveryModes.indexOf(right.mode) ||
        left.distanceMetres - right.distanceMetres,
    );

  return {
    cells,
    strongestCredibleModes,
    actionable: false,
    automaticEntryAllowed: false,
    gateCRequired: true,
    gateDRequiredForMaiden: true,
  };
}
