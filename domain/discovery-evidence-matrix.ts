export const discoveryModes = ["bike", "car", "horse"] as const;
export type DiscoveryMode = (typeof discoveryModes)[number];

export const lineageRelationshipPriority = [
  "parent",
  "grandparent",
  "full_sibling",
  "half_sibling",
  "offspring",
  "wider_lineage",
  "population_pattern",
] as const;
export type LineageRelationship = (typeof lineageRelationshipPriority)[number];

export type DiscoveryLineageEvidenceInput = {
  sourceCoreId: string | null;
  relationship: LineageRelationship;
  raceCount: number;
  successfulTimePercentile: number | null;
  evidenceCutoff: string;
  resolved: boolean;
};

export type DiscoveryStarEvidenceInput = {
  dataStatus: "complete" | "partial" | "missing" | "invalid";
  goldEligibleRaces: number;
  goldAssignmentOpportunities: number;
  goldReceived: number;
  blueAssignmentOpportunities: number;
  blueReceived: number;
  earlyStrongFieldStars: number;
  weakFieldEligibleNoStarCount: number;
};

export type DiscoveryEvidenceCellInput = {
  coreId: string;
  mode: DiscoveryMode;
  distanceMetres: number;
  directRaceCount: number;
  directBestTimeMs: number | null;
  directMedianTimeMs: number | null;
  directSuccessfulTimePercentile: number | null;
  lineageEvidence: readonly DiscoveryLineageEvidenceInput[];
  starEvidence: DiscoveryStarEvidenceInput;
  maidenEligible: boolean;
  upcomingTournamentRelevance: "none" | "eligible" | "priority";
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshnessState: "current" | "ageing" | "stale" | "unknown";
};

export type DiscoveryEvidenceWarning =
  | "DIRECT_TIME_UNAVAILABLE"
  | "BELOW_MINIMUM_SAMPLE"
  | "LINEAGE_EVIDENCE_UNAVAILABLE"
  | "LINEAGE_EVIDENCE_UNRESOLVED"
  | "STAR_EVIDENCE_INCOMPLETE"
  | "DATA_CUTOFF_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "GATE_C_NOT_PASSED";

export type DiscoveryEvidenceCell = {
  coreId: string;
  mode: DiscoveryMode;
  distanceMetres: number;
  directRaceCount: number;
  sampleStatus:
    "no_direct_evidence" | "hypothesis_only" | "minimally_analytical";
  additionalRacesToMinimum: number;
  directBestTimeMs: number | null;
  directMedianTimeMs: number | null;
  directSuccessfulTimePercentile: number | null;
  lineageEvidence: readonly {
    sourceCoreId: string | null;
    relationship: LineageRelationship;
    priority: number;
    raceCount: number;
    successfulTimePercentile: number | null;
    evidenceCutoff: string;
    resolved: boolean;
  }[];
  starEvidence: DiscoveryStarEvidenceInput;
  maidenEligible: boolean;
  upcomingTournamentRelevance: DiscoveryEvidenceCellInput["upcomingTournamentRelevance"];
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshnessState: DiscoveryEvidenceCellInput["freshnessState"];
  warnings: readonly DiscoveryEvidenceWarning[];
  experimental: true;
  actionableRecommendationAllowed: false;
  automaticStopAllowed: false;
  compositeQualityScoreAvailable: false;
};

export type DiscoveryEvidenceMatrix = {
  cells: readonly DiscoveryEvidenceCell[];
  coreCount: number;
  cellCount: number;
  actionableRecommendationAllowed: false;
  gateCRequired: true;
};

const relationshipPriority = new Map<LineageRelationship, number>(
  lineageRelationshipPriority.map((relationship, index) => [
    relationship,
    index + 1,
  ]),
);

function requiredTrimmed(value: string, label: string): string {
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`${label} is required.`);
  return trimmed;
}

function normalizeTimestamp(value: string, label: string): string {
  const trimmed = requiredTrimmed(value, label);
  const parsed = Date.parse(trimmed);
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : normalizeTimestamp(value, label);
}

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function normalizePositiveMetric(
  value: number | null,
  label: string,
): number | null {
  if (value === null) return null;
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizePercentile(
  value: number | null,
  label: string,
): number | null {
  if (value === null) return null;
  if (!Number.isFinite(value) || value < 0 || value > 100) {
    throw new Error(`${label} must be between zero and 100.`);
  }
  return value;
}

function normalizeStarEvidence(
  input: DiscoveryStarEvidenceInput,
): DiscoveryStarEvidenceInput {
  if (
    !["complete", "partial", "missing", "invalid"].includes(input.dataStatus)
  ) {
    throw new Error("Discovery star data status is invalid.");
  }
  const counts = [
    ["Gold-eligible races", input.goldEligibleRaces],
    ["Gold assignment opportunities", input.goldAssignmentOpportunities],
    ["Gold received", input.goldReceived],
    ["Blue assignment opportunities", input.blueAssignmentOpportunities],
    ["Blue received", input.blueReceived],
    ["Early strong-field stars", input.earlyStrongFieldStars],
    ["Weak-field eligible no-star count", input.weakFieldEligibleNoStarCount],
  ] as const;
  for (const [label, value] of counts) {
    assertNonNegativeInteger(value, label);
  }
  if (
    input.goldAssignmentOpportunities > input.goldEligibleRaces ||
    input.goldReceived > input.goldAssignmentOpportunities ||
    input.blueReceived > input.blueAssignmentOpportunities ||
    input.earlyStrongFieldStars > input.goldReceived + input.blueReceived ||
    input.weakFieldEligibleNoStarCount > input.goldAssignmentOpportunities
  ) {
    throw new Error("Discovery star denominators are inconsistent.");
  }
  return { ...input };
}

function normalizeCell(
  input: DiscoveryEvidenceCellInput,
): DiscoveryEvidenceCell {
  const coreId = requiredTrimmed(input.coreId, "Core ID");
  if (!discoveryModes.includes(input.mode)) {
    throw new Error("Discovery mode is invalid.");
  }
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error("Discovery distance must be positive integer metres.");
  }
  assertNonNegativeInteger(input.directRaceCount, "Direct race count");
  if (
    !["none", "eligible", "priority"].includes(
      input.upcomingTournamentRelevance,
    )
  ) {
    throw new Error("Tournament relevance is invalid.");
  }
  if (
    !["current", "ageing", "stale", "unknown"].includes(input.freshnessState)
  ) {
    throw new Error("Discovery freshness state is invalid.");
  }
  if (typeof input.maidenEligible !== "boolean") {
    throw new Error("Maiden eligibility must be Boolean.");
  }

  const dataCurrentThrough = optionalTimestamp(
    input.dataCurrentThrough,
    "Data current through",
  );
  const lastImported = optionalTimestamp(input.lastImported, "Last imported");
  const cutoffMs =
    dataCurrentThrough === null ? null : Date.parse(dataCurrentThrough);

  const lineageEvidence = input.lineageEvidence
    .map((evidence) => {
      if (!lineageRelationshipPriority.includes(evidence.relationship)) {
        throw new Error("Lineage relationship is invalid.");
      }
      assertNonNegativeInteger(evidence.raceCount, "Lineage race count");
      if (typeof evidence.resolved !== "boolean") {
        throw new Error("Lineage resolution must be Boolean.");
      }
      const evidenceCutoff = normalizeTimestamp(
        evidence.evidenceCutoff,
        "Lineage evidence cutoff",
      );
      if (cutoffMs !== null && Date.parse(evidenceCutoff) > cutoffMs) {
        throw new Error(
          "Lineage evidence cannot extend beyond the cell data cutoff.",
        );
      }
      return {
        sourceCoreId:
          evidence.sourceCoreId === null
            ? null
            : requiredTrimmed(evidence.sourceCoreId, "Lineage source core ID"),
        relationship: evidence.relationship,
        priority: relationshipPriority.get(evidence.relationship)!,
        raceCount: evidence.raceCount,
        successfulTimePercentile: normalizePercentile(
          evidence.successfulTimePercentile,
          "Lineage successful-time percentile",
        ),
        evidenceCutoff,
        resolved: evidence.resolved,
      };
    })
    .sort(
      (left, right) =>
        left.priority - right.priority ||
        (left.sourceCoreId ?? "").localeCompare(right.sourceCoreId ?? "") ||
        left.evidenceCutoff.localeCompare(right.evidenceCutoff),
    );

  const lineageKeys = lineageEvidence.map((evidence) =>
    JSON.stringify([
      evidence.relationship,
      evidence.sourceCoreId ?? "unresolved",
    ]),
  );
  if (new Set(lineageKeys).size !== lineageKeys.length) {
    throw new Error("Discovery lineage evidence must be unique.");
  }

  const directBestTimeMs = normalizePositiveMetric(
    input.directBestTimeMs,
    "Direct best time",
  );
  const directMedianTimeMs = normalizePositiveMetric(
    input.directMedianTimeMs,
    "Direct median time",
  );
  const directSuccessfulTimePercentile = normalizePercentile(
    input.directSuccessfulTimePercentile,
    "Direct successful-time percentile",
  );
  if (
    input.directRaceCount === 0 &&
    (directBestTimeMs !== null ||
      directMedianTimeMs !== null ||
      directSuccessfulTimePercentile !== null)
  ) {
    throw new Error("Direct metrics require direct race evidence.");
  }
  if (
    input.directRaceCount > 0 &&
    (directBestTimeMs === null || directMedianTimeMs === null)
  ) {
    throw new Error("Direct race evidence requires time metrics.");
  }

  const starEvidence = normalizeStarEvidence(input.starEvidence);
  const warnings = new Set<DiscoveryEvidenceWarning>(["GATE_C_NOT_PASSED"]);
  if (input.directRaceCount === 0) warnings.add("DIRECT_TIME_UNAVAILABLE");
  if (input.directRaceCount < 10) warnings.add("BELOW_MINIMUM_SAMPLE");
  if (lineageEvidence.length === 0) {
    warnings.add("LINEAGE_EVIDENCE_UNAVAILABLE");
  }
  if (lineageEvidence.some((evidence) => !evidence.resolved)) {
    warnings.add("LINEAGE_EVIDENCE_UNRESOLVED");
  }
  if (starEvidence.dataStatus !== "complete") {
    warnings.add("STAR_EVIDENCE_INCOMPLETE");
  }
  if (dataCurrentThrough === null || lastImported === null) {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (input.freshnessState === "ageing") {
    warnings.add("IMPORTED_DATA_AGEING");
  }
  if (["stale", "unknown"].includes(input.freshnessState)) {
    warnings.add("IMPORTED_DATA_STALE");
  }

  return {
    coreId,
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    directRaceCount: input.directRaceCount,
    sampleStatus:
      input.directRaceCount === 0
        ? "no_direct_evidence"
        : input.directRaceCount < 10
          ? "hypothesis_only"
          : "minimally_analytical",
    additionalRacesToMinimum: Math.max(0, 10 - input.directRaceCount),
    directBestTimeMs,
    directMedianTimeMs,
    directSuccessfulTimePercentile,
    lineageEvidence,
    starEvidence,
    maidenEligible: input.maidenEligible,
    upcomingTournamentRelevance: input.upcomingTournamentRelevance,
    dataCurrentThrough,
    lastImported,
    freshnessState: input.freshnessState,
    warnings: [...warnings].sort(),
    experimental: true,
    actionableRecommendationAllowed: false,
    automaticStopAllowed: false,
    compositeQualityScoreAvailable: false,
  };
}

export function buildDiscoveryEvidenceMatrix(
  inputs: readonly DiscoveryEvidenceCellInput[],
): DiscoveryEvidenceMatrix {
  const cells = inputs.map(normalizeCell);
  const keys = cells.map((cell) =>
    JSON.stringify([cell.coreId, cell.mode, cell.distanceMetres]),
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "Discovery evidence cells must be unique by core, mode and exact distance.",
    );
  }
  cells.sort(
    (left, right) =>
      left.coreId.localeCompare(right.coreId) ||
      discoveryModes.indexOf(left.mode) - discoveryModes.indexOf(right.mode) ||
      left.distanceMetres - right.distanceMetres,
  );
  return {
    cells,
    coreCount: new Set(cells.map((cell) => cell.coreId)).size,
    cellCount: cells.length,
    actionableRecommendationAllowed: false,
    gateCRequired: true,
  };
}
