import type {
  CorePerformanceProfile,
  PerformanceSampleStatus,
} from "@/domain/core-performance";
import { raceModes } from "@/domain/core-performance";
import type { FreshnessState } from "@/domain/freshness";

export const validationResults = [
  "not_run",
  "incomplete",
  "passed",
  "failed",
] as const;
export type ValidationResult = (typeof validationResults)[number];

export type BenchmarkCoverageInput = {
  comparisonEventCount: number;
  completeOutcomeEventCount: number;
  partialOutcomeEventCount: number;
  dataCurrentThrough: string | null;
};

export type LineageCoverageInput = {
  resolvedRelationshipCount: number;
  unresolvedRelationshipCount: number;
};

export type AnalyticalValidationInput = {
  chronologicalHoldout: ValidationResult;
  baselineComparison: ValidationResult;
  calibration: ValidationResult;
};

export type EvidenceConfidenceInput = {
  profile: CorePerformanceProfile;
  lastImportedAt: string | null;
  benchmark: BenchmarkCoverageInput;
  lineage: LineageCoverageInput;
  validation: AnalyticalValidationInput;
};

export type CoverageStatus = "unavailable" | "partial" | "complete";
export type EvidenceConfidenceLevel =
  "insufficient" | "low" | "moderate" | "high";

export type EvidenceWarning =
  | "DIRECT_EVIDENCE_UNAVAILABLE"
  | "DIRECT_SAMPLE_BELOW_MINIMUM"
  | "DATA_STALE"
  | "FRESHNESS_UNKNOWN"
  | "IMPORT_TIME_UNKNOWN"
  | "STAR_EVIDENCE_UNAVAILABLE"
  | "STAR_EVIDENCE_PARTIAL"
  | "STAR_EVIDENCE_ANOMALOUS"
  | "BENCHMARK_EVIDENCE_UNAVAILABLE"
  | "BENCHMARK_OUTCOMES_PARTIAL"
  | "LINEAGE_EVIDENCE_UNAVAILABLE"
  | "LINEAGE_EVIDENCE_PARTIAL"
  | "CHRONOLOGICAL_VALIDATION_INCOMPLETE"
  | "CHRONOLOGICAL_VALIDATION_FAILED";

export type EvidenceConfidenceAssessment = {
  coreId: string;
  mode: CorePerformanceProfile["mode"];
  distance: number;
  level: EvidenceConfidenceLevel;
  analyticalReadiness: "experimental" | "validated_evidence";
  dataCurrentThrough: string;
  lastImportedAt: string | null;
  freshness: FreshnessState;
  direct: {
    raceCount: number;
    minimumRaceCount: 10;
    sampleStatus: PerformanceSampleStatus;
  };
  stars: {
    status: CoverageStatus;
    raceCount: number;
    completeRaceCount: number;
    partialRaceCount: number;
    missingRaceCount: number;
    invalidRaceCount: number;
    anomalyCount: number;
    goldEligibleRaceCount: number;
    goldReceived: { numerator: number; denominator: number };
    blueReceived: { numerator: number; denominator: number };
  };
  benchmark: BenchmarkCoverageInput & {
    status: CoverageStatus;
  };
  lineage: LineageCoverageInput & {
    status: CoverageStatus;
  };
  validation: AnalyticalValidationInput;
  warnings: readonly EvidenceWarning[];
};

const MINIMUM_ANALYTICAL_RACES = 10 as const;
const freshnessStates = ["current", "ageing", "stale", "unknown"] as const;

function assertNonNegativeInteger(value: number, label: string): void {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
}

function assertTimestamp(value: string, label: string): number {
  const parsed = Date.parse(value);
  if (Number.isNaN(parsed))
    throw new Error(`${label} must be a valid timestamp.`);
  return parsed;
}

function assertSampleStatus(
  raceCount: number,
  sampleStatus: PerformanceSampleStatus,
): void {
  const expected =
    raceCount >= MINIMUM_ANALYTICAL_RACES
      ? "minimally_analytical"
      : "hypothesis_only";
  if (sampleStatus !== expected) {
    throw new Error(
      `Performance sample status ${sampleStatus} does not match race count ${raceCount}.`,
    );
  }
}

function coverageStatus(
  availableCount: number,
  unresolvedCount: number,
): CoverageStatus {
  if (availableCount === 0 && unresolvedCount === 0) return "unavailable";
  return unresolvedCount === 0 ? "complete" : "partial";
}

function assessStarCoverage(
  profile: CorePerformanceProfile,
): EvidenceConfidenceAssessment["stars"] {
  const stars = profile.starProfile;
  if (stars === null) {
    return {
      status: "unavailable",
      raceCount: 0,
      completeRaceCount: 0,
      partialRaceCount: 0,
      missingRaceCount: 0,
      invalidRaceCount: 0,
      anomalyCount: 0,
      goldEligibleRaceCount: 0,
      goldReceived: { numerator: 0, denominator: 0 },
      blueReceived: { numerator: 0, denominator: 0 },
    };
  }

  if (
    stars.coreId !== profile.coreId ||
    stars.mode !== profile.mode ||
    stars.distance !== profile.distance
  ) {
    throw new Error(
      "Star evidence does not match the performance profile key.",
    );
  }

  const countFields = {
    raceCount: stars.raceCount,
    completeRaceCount: stars.completeStarDataRaceCount,
    partialRaceCount: stars.partialStarDataRaceCount,
    missingRaceCount: stars.missingStarDataRaceCount,
    invalidRaceCount: stars.invalidStarDataRaceCount,
    goldEligibleRaceCount: stars.goldEligibleRaceCount,
    goldReceivedCount: stars.goldReceivedCount,
    goldOpportunityCount: stars.goldAssignmentOpportunityCount,
    blueReceivedCount: stars.blueReceivedCount,
    blueOpportunityCount: stars.blueAssignmentOpportunityCount,
  };
  for (const [label, value] of Object.entries(countFields)) {
    assertNonNegativeInteger(value, `Star ${label}`);
  }

  const statusTotal =
    stars.completeStarDataRaceCount +
    stars.partialStarDataRaceCount +
    stars.missingStarDataRaceCount +
    stars.invalidStarDataRaceCount;
  if (statusTotal !== stars.raceCount) {
    throw new Error(
      "Star coverage counts must equal the star-profile race count.",
    );
  }
  if (
    stars.goldReceivedRate.numerator !== stars.goldReceivedCount ||
    stars.goldReceivedRate.denominator !==
      stars.goldAssignmentOpportunityCount ||
    stars.blueReceivedRate.numerator !== stars.blueReceivedCount ||
    stars.blueReceivedRate.denominator !== stars.blueAssignmentOpportunityCount
  ) {
    throw new Error(
      "Star rate counts do not match their explicit denominators.",
    );
  }
  if (
    stars.goldReceivedCount > stars.goldAssignmentOpportunityCount ||
    stars.blueReceivedCount > stars.blueAssignmentOpportunityCount
  ) {
    throw new Error(
      "A star numerator cannot exceed its opportunity denominator.",
    );
  }

  const anomalyCount =
    stars.goldIneligibleAssignmentCount +
    stars.goldExcludedAnomalyCount +
    stars.blueExcludedAnomalyCount;
  assertNonNegativeInteger(anomalyCount, "Star anomaly count");
  const incompleteCount =
    stars.partialStarDataRaceCount +
    stars.missingStarDataRaceCount +
    stars.invalidStarDataRaceCount;

  return {
    status:
      stars.raceCount === 0
        ? "unavailable"
        : incompleteCount === 0
          ? "complete"
          : "partial",
    raceCount: stars.raceCount,
    completeRaceCount: stars.completeStarDataRaceCount,
    partialRaceCount: stars.partialStarDataRaceCount,
    missingRaceCount: stars.missingStarDataRaceCount,
    invalidRaceCount: stars.invalidStarDataRaceCount,
    anomalyCount,
    goldEligibleRaceCount: stars.goldEligibleRaceCount,
    goldReceived: {
      numerator: stars.goldReceivedCount,
      denominator: stars.goldAssignmentOpportunityCount,
    },
    blueReceived: {
      numerator: stars.blueReceivedCount,
      denominator: stars.blueAssignmentOpportunityCount,
    },
  };
}

function assessBenchmarkCoverage(
  benchmark: BenchmarkCoverageInput,
): EvidenceConfidenceAssessment["benchmark"] {
  assertNonNegativeInteger(
    benchmark.comparisonEventCount,
    "Benchmark comparison event count",
  );
  assertNonNegativeInteger(
    benchmark.completeOutcomeEventCount,
    "Benchmark complete outcome event count",
  );
  assertNonNegativeInteger(
    benchmark.partialOutcomeEventCount,
    "Benchmark partial outcome event count",
  );
  if (
    benchmark.completeOutcomeEventCount + benchmark.partialOutcomeEventCount !==
    benchmark.comparisonEventCount
  ) {
    throw new Error(
      "Complete and partial benchmark outcomes must equal comparison events.",
    );
  }
  if (benchmark.dataCurrentThrough !== null) {
    assertTimestamp(
      benchmark.dataCurrentThrough,
      "Benchmark data-current-through",
    );
  } else if (benchmark.comparisonEventCount > 0) {
    throw new Error(
      "Benchmark coverage requires a data-current-through timestamp.",
    );
  }

  return {
    ...benchmark,
    status:
      benchmark.comparisonEventCount === 0
        ? "unavailable"
        : benchmark.partialOutcomeEventCount === 0
          ? "complete"
          : "partial",
  };
}

function assessLineageCoverage(
  lineage: LineageCoverageInput,
): EvidenceConfidenceAssessment["lineage"] {
  assertNonNegativeInteger(
    lineage.resolvedRelationshipCount,
    "Resolved lineage relationship count",
  );
  assertNonNegativeInteger(
    lineage.unresolvedRelationshipCount,
    "Unresolved lineage relationship count",
  );
  return {
    ...lineage,
    status: coverageStatus(
      lineage.resolvedRelationshipCount,
      lineage.unresolvedRelationshipCount,
    ),
  };
}

function allValidationPassed(validation: AnalyticalValidationInput): boolean {
  return Object.values(validation).every((result) => result === "passed");
}

function anyValidationFailed(validation: AnalyticalValidationInput): boolean {
  return Object.values(validation).some((result) => result === "failed");
}

function deriveWarnings(input: {
  raceCount: number;
  freshness: FreshnessState;
  lastImportedAt: string | null;
  stars: EvidenceConfidenceAssessment["stars"];
  benchmark: EvidenceConfidenceAssessment["benchmark"];
  lineage: EvidenceConfidenceAssessment["lineage"];
  validation: AnalyticalValidationInput;
}): EvidenceWarning[] {
  const warnings: EvidenceWarning[] = [];
  if (input.raceCount === 0) warnings.push("DIRECT_EVIDENCE_UNAVAILABLE");
  else if (input.raceCount < MINIMUM_ANALYTICAL_RACES)
    warnings.push("DIRECT_SAMPLE_BELOW_MINIMUM");
  if (input.freshness === "stale") warnings.push("DATA_STALE");
  if (input.freshness === "unknown") warnings.push("FRESHNESS_UNKNOWN");
  if (input.lastImportedAt === null) warnings.push("IMPORT_TIME_UNKNOWN");
  if (input.stars.status === "unavailable")
    warnings.push("STAR_EVIDENCE_UNAVAILABLE");
  if (input.stars.status === "partial") warnings.push("STAR_EVIDENCE_PARTIAL");
  if (input.stars.anomalyCount > 0) warnings.push("STAR_EVIDENCE_ANOMALOUS");
  if (input.benchmark.status === "unavailable")
    warnings.push("BENCHMARK_EVIDENCE_UNAVAILABLE");
  if (input.benchmark.status === "partial")
    warnings.push("BENCHMARK_OUTCOMES_PARTIAL");
  if (input.lineage.status === "unavailable")
    warnings.push("LINEAGE_EVIDENCE_UNAVAILABLE");
  if (input.lineage.status === "partial")
    warnings.push("LINEAGE_EVIDENCE_PARTIAL");
  if (anyValidationFailed(input.validation))
    warnings.push("CHRONOLOGICAL_VALIDATION_FAILED");
  else if (!allValidationPassed(input.validation))
    warnings.push("CHRONOLOGICAL_VALIDATION_INCOMPLETE");
  return warnings;
}

function deriveLevel(input: {
  raceCount: number;
  freshness: FreshnessState;
  hasImportTime: boolean;
  benchmarkStatus: CoverageStatus;
  validation: AnalyticalValidationInput;
}): EvidenceConfidenceLevel {
  if (input.raceCount === 0) return "insufficient";
  if (
    input.raceCount < MINIMUM_ANALYTICAL_RACES ||
    input.freshness === "stale" ||
    input.freshness === "unknown" ||
    anyValidationFailed(input.validation)
  ) {
    return "low";
  }
  if (
    input.hasImportTime &&
    allValidationPassed(input.validation) &&
    input.benchmarkStatus === "complete"
  ) {
    return "high";
  }
  return "moderate";
}

export function assessEvidenceConfidence(
  input: EvidenceConfidenceInput,
): EvidenceConfidenceAssessment {
  const { profile } = input;
  if (
    profile.coreId.trim() === "" ||
    !raceModes.includes(profile.mode) ||
    !Number.isSafeInteger(profile.distance) ||
    profile.distance <= 0 ||
    !freshnessStates.includes(profile.freshness)
  ) {
    throw new Error("Performance profile identity or freshness is invalid.");
  }
  assertNonNegativeInteger(profile.raceCount, "Direct race count");
  assertSampleStatus(profile.raceCount, profile.sampleStatus);
  const profileCutoff = assertTimestamp(
    profile.dataCurrentThrough,
    "Profile data-current-through",
  );
  if (input.lastImportedAt !== null) {
    const importedAt = assertTimestamp(input.lastImportedAt, "Last imported");
    if (importedAt < profileCutoff) {
      throw new Error("Last imported cannot precede the profile data cutoff.");
    }
  }
  for (const [label, result] of Object.entries(input.validation)) {
    if (!validationResults.includes(result)) {
      throw new Error(`Unsupported ${label} validation result.`);
    }
  }

  const stars = assessStarCoverage(profile);
  const benchmark = assessBenchmarkCoverage(input.benchmark);
  const lineage = assessLineageCoverage(input.lineage);
  const warnings = deriveWarnings({
    raceCount: profile.raceCount,
    freshness: profile.freshness,
    lastImportedAt: input.lastImportedAt,
    stars,
    benchmark,
    lineage,
    validation: input.validation,
  });
  const level = deriveLevel({
    raceCount: profile.raceCount,
    freshness: profile.freshness,
    hasImportTime: input.lastImportedAt !== null,
    benchmarkStatus: benchmark.status,
    validation: input.validation,
  });

  return {
    coreId: profile.coreId,
    mode: profile.mode,
    distance: profile.distance,
    level,
    analyticalReadiness:
      level === "high" ? "validated_evidence" : "experimental",
    dataCurrentThrough: profile.dataCurrentThrough,
    lastImportedAt: input.lastImportedAt,
    freshness: profile.freshness,
    direct: {
      raceCount: profile.raceCount,
      minimumRaceCount: MINIMUM_ANALYTICAL_RACES,
      sampleStatus: profile.sampleStatus,
    },
    stars,
    benchmark,
    lineage,
    validation: { ...input.validation },
    warnings,
  };
}
