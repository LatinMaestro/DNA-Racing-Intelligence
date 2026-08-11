export const probeModes = ["bike", "car", "horse"] as const;
export type ProbeMode = (typeof probeModes)[number];

export const probeLineageRelationships = [
  "parent",
  "grandparent",
  "full_sibling",
  "half_sibling",
  "offspring",
  "wider_lineage",
  "population_pattern",
] as const;
export type ProbeLineageRelationship =
  (typeof probeLineageRelationships)[number];

export type DiscoveryProbeCandidateInput = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  distanceMetres: number;
  directRaceCount: number;
  lineageRelationship: ProbeLineageRelationship | null;
  lineageResolved: boolean;
  lineageRaceCount: number;
  tournamentRelevance: "none" | "eligible" | "priority";
  maidenState: "not_eligible" | "eligible" | "unknown" | "invalid";
  freshness: "current" | "ageing" | "stale" | "unknown";
  dataCurrentThrough: string | null;
}>;

export type DiscoveryProbeCandidate = Readonly<{
  coreId: string;
  coreName: string;
  mode: ProbeMode;
  distanceMetres: number;
  directRaceCount: number;
  observationsToMinimum: number;
  recommendedInitialProbeSize: number;
  guidance:
    | "continue_targeted_probe"
    | "review_minimum_sample"
    | "defer_stale_or_unresolved";
  evidencePurpose:
    | "establish_direct_sample"
    | "complete_direct_sample"
    | "validate_lineage_hypothesis"
    | "no_probe_gap";
  reviewPriority: "high" | "medium" | "low" | "defer";
  lineageRelationship: ProbeLineageRelationship | null;
  lineageRaceCount: number;
  tournamentRelevance: DiscoveryProbeCandidateInput["tournamentRelevance"];
  maidenState: DiscoveryProbeCandidateInput["maidenState"];
  freshness: DiscoveryProbeCandidateInput["freshness"];
  dataCurrentThrough: string | null;
  warnings: readonly (
    | "MAIDEN_COMMITMENT_REVIEW_REQUIRED"
    | "MAIDEN_STATE_UNRESOLVED"
    | "LINEAGE_UNRESOLVED"
    | "LINEAGE_SAMPLE_UNAVAILABLE"
    | "DATA_CUTOFF_UNKNOWN"
    | "DATA_STALE"
  )[];
  experimental: true;
  actionable: boolean;
  automaticEntryAllowed: false;
  automaticStopAllowed: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function timestamp(value: string | null): string | null {
  if (value === null) return null;
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed)) {
    throw new Error("Data current through must be valid.");
  }
  return new Date(parsed).toISOString();
}

function normalize(
  input: DiscoveryProbeCandidateInput,
): DiscoveryProbeCandidate {
  const coreId = required(input.coreId, "Core ID");
  const coreName = required(input.coreName, "Core name");
  if (!probeModes.includes(input.mode))
    throw new Error("Probe mode is invalid.");
  if (
    !Number.isSafeInteger(input.distanceMetres) ||
    input.distanceMetres <= 0
  ) {
    throw new Error("Probe distance must be positive integer metres.");
  }
  if (
    input.lineageRelationship !== null &&
    !probeLineageRelationships.includes(input.lineageRelationship)
  ) {
    throw new Error("Probe lineage relationship is invalid.");
  }
  if (typeof input.lineageResolved !== "boolean") {
    throw new Error("Lineage resolution must be Boolean.");
  }
  if (!["none", "eligible", "priority"].includes(input.tournamentRelevance)) {
    throw new Error("Tournament relevance is invalid.");
  }
  if (
    !["not_eligible", "eligible", "unknown", "invalid"].includes(
      input.maidenState,
    )
  ) {
    throw new Error("Maiden state is invalid.");
  }
  if (!["current", "ageing", "stale", "unknown"].includes(input.freshness)) {
    throw new Error("Probe freshness is invalid.");
  }

  const directRaceCount = count(input.directRaceCount, "Direct race count");
  const lineageRaceCount = count(input.lineageRaceCount, "Lineage race count");
  if (input.lineageRelationship === null && lineageRaceCount !== 0) {
    throw new Error("Lineage race count requires a lineage relationship.");
  }
  if (!input.lineageResolved && lineageRaceCount !== 0) {
    throw new Error("Unresolved lineage cannot provide a race sample.");
  }

  const dataCurrentThrough = timestamp(input.dataCurrentThrough);
  const observationsToMinimum = Math.max(0, 10 - directRaceCount);
  const warnings = new Set<DiscoveryProbeCandidate["warnings"][number]>();
  if (input.maidenState === "eligible") {
    warnings.add("MAIDEN_COMMITMENT_REVIEW_REQUIRED");
  }
  if (["unknown", "invalid"].includes(input.maidenState)) {
    warnings.add("MAIDEN_STATE_UNRESOLVED");
  }
  if (!input.lineageResolved) warnings.add("LINEAGE_UNRESOLVED");
  if (input.lineageRelationship !== null && lineageRaceCount === 0) {
    warnings.add("LINEAGE_SAMPLE_UNAVAILABLE");
  }
  if (dataCurrentThrough === null || input.freshness === "unknown") {
    warnings.add("DATA_CUTOFF_UNKNOWN");
  }
  if (input.freshness === "stale") warnings.add("DATA_STALE");

  const unusable =
    dataCurrentThrough === null ||
    ["stale", "unknown"].includes(input.freshness) ||
    ["unknown", "invalid"].includes(input.maidenState);
  const strategic =
    input.tournamentRelevance === "priority" ||
    input.maidenState === "eligible";
  const actionable = !unusable && observationsToMinimum > 0;
  const recommendedInitialProbeSize = actionable
    ? Math.min(3, observationsToMinimum)
    : 0;

  return {
    coreId,
    coreName,
    mode: input.mode,
    distanceMetres: input.distanceMetres,
    directRaceCount,
    observationsToMinimum,
    recommendedInitialProbeSize,
    guidance: unusable
      ? "defer_stale_or_unresolved"
      : observationsToMinimum === 0
        ? "review_minimum_sample"
        : "continue_targeted_probe",
    evidencePurpose:
      directRaceCount === 0
        ? "establish_direct_sample"
        : observationsToMinimum > 0
          ? "complete_direct_sample"
          : input.lineageRelationship !== null && input.lineageResolved
            ? "validate_lineage_hypothesis"
            : "no_probe_gap",
    reviewPriority: unusable
      ? "defer"
      : observationsToMinimum === 0
        ? "low"
        : strategic
          ? "high"
          : input.lineageRelationship !== null && input.lineageResolved
            ? "medium"
            : "low",
    lineageRelationship: input.lineageRelationship,
    lineageRaceCount,
    tournamentRelevance: input.tournamentRelevance,
    maidenState: input.maidenState,
    freshness: input.freshness,
    dataCurrentThrough,
    warnings: [...warnings].sort(),
    experimental: true,
    actionable,
    automaticEntryAllowed: false,
    automaticStopAllowed: false,
  };
}

export function buildDiscoveryProbePlan(
  inputs: readonly DiscoveryProbeCandidateInput[],
): readonly DiscoveryProbeCandidate[] {
  const candidates = inputs.map(normalize);
  const keys = candidates.map((candidate) =>
    JSON.stringify([
      candidate.coreId,
      candidate.mode,
      candidate.distanceMetres,
    ]),
  );
  if (new Set(keys).size !== keys.length) {
    throw new Error(
      "Probe candidates must be unique by core, mode and exact distance.",
    );
  }
  const priority = new Map([
    ["high", 0],
    ["medium", 1],
    ["low", 2],
    ["defer", 3],
  ]);
  return [...candidates].sort(
    (left, right) =>
      priority.get(left.reviewPriority)! -
        priority.get(right.reviewPriority)! ||
      left.observationsToMinimum - right.observationsToMinimum ||
      left.coreName.localeCompare(right.coreName) ||
      left.coreId.localeCompare(right.coreId) ||
      probeModes.indexOf(left.mode) - probeModes.indexOf(right.mode) ||
      left.distanceMetres - right.distanceMetres,
  );
}
