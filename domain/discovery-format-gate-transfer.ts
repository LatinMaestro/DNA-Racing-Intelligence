import { probeModes, type ProbeMode } from "./discovery-probe-plan";

export const discoveryFormatGateTransferAssessments = [
  "strong_inferred_fit",
  "ceiling_inferred_fit",
  "central_inferred_fit",
  "mismatch",
  "unavailable",
] as const;
export type DiscoveryFormatGateTransferAssessment =
  (typeof discoveryFormatGateTransferAssessments)[number];

export const discoveryFormatGatePaceFits = [
  "matches_or_betters_elite_median",
  "matches_elite_lower_quartile",
  "below_elite_lower_quartile",
  "unavailable",
] as const;
export type DiscoveryFormatGatePaceFit =
  (typeof discoveryFormatGatePaceFits)[number];

export const discoveryFormatGateDispersionFits = [
  "tighter_than_elite_cohort",
  "within_elite_cohort",
  "wider_than_elite_cohort",
  "unavailable",
] as const;
export type DiscoveryFormatGateDispersionFit =
  (typeof discoveryFormatGateDispersionFits)[number];

export type DiscoveryFormatGateCohortRankingMetric =
  | "winning_outcome"
  | "top_three_outcome"
  | "speed"
  | "configured_format_metric";

export type DiscoveryDispersionKind =
  "coefficient_of_variation" | "normalized_range_proxy";

export type DiscoveryDispersionObservation = Readonly<{
  kind: DiscoveryDispersionKind;
  value: number;
}>;

export type DiscoveryFormatGateBenchmarkProfile = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  formatId: string;
  gateCount: number;
  benchmarkCoreCount: number;
  eliteCohortPercentileFloor: number;
  eliteCohortRankingMetric: DiscoveryFormatGateCohortRankingMetric;
  centralSpeedMetresPerSecond: Readonly<{
    p25: number;
    median: number;
    p75: number;
  }>;
  ceilingSpeedMetresPerSecond: Readonly<{
    p25: number;
    median: number;
    p75: number;
  }>;
  dispersion: Readonly<{
    kind: DiscoveryDispersionKind;
    p25: number;
    median: number;
    p75: number;
  }> | null;
  dataCurrentThrough: string;
  sourceAuthority: string;
}>;

export type DiscoveryFormatGateTransferInput = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  formatId: string;
  gateCount: number;
  usableDistanceObservationCount: number;
  centralSpeedMetresPerSecond: number | null;
  ceilingSpeedMetresPerSecond: number | null;
  dispersion: DiscoveryDispersionObservation | null;
  directFormatRaceCount: number;
  benchmark: DiscoveryFormatGateBenchmarkProfile | null;
  minimumDirectFormatSample?: number;
}>;

export type DiscoveryFormatGateTransferResult = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  formatId: string;
  gateCount: number;
  directFormatRaceCount: number;
  assessment: DiscoveryFormatGateTransferAssessment;
  centralPaceFit: DiscoveryFormatGatePaceFit;
  ceilingPaceFit: DiscoveryFormatGatePaceFit;
  dispersionFit: DiscoveryFormatGateDispersionFit;
  confidence: "low" | "moderate" | "high";
  recommendedAction:
    | "targeted_format_probe"
    | "prefer_direct_format_evidence"
    | "do_not_prioritise_from_transfer_alone"
    | "gather_distance_distribution_first";
  inferenceOnly: true;
  provenFormatSpecialist: false;
  reasons: readonly (
    | "central_distribution_matches_elite_format_cohort"
    | "ceiling_distribution_matches_elite_format_cohort"
    | "dispersion_matches_or_betters_elite_format_cohort"
    | "wider_than_elite_format_cohort"
    | "distance_sample_small"
    | "benchmark_sample_small"
    | "direct_format_sample_available"
    | "benchmark_unavailable"
    | "distance_distribution_unavailable"
  )[];
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function count(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${label} must be a non-negative safe integer.`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite.`);
  }
  return value;
}

function nonNegativeFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value < 0) {
    throw new Error(`${label} must be non-negative and finite.`);
  }
  return value;
}

function probability(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0 || value >= 1) {
    throw new Error(`${label} must be greater than zero and less than one.`);
  }
  return value;
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function validateAscendingQuartiles(
  value: Readonly<{ p25: number; median: number; p75: number }>,
  label: string,
  validator: (candidate: number, candidateLabel: string) => number,
): void {
  const p25 = validator(value.p25, `${label} p25`);
  const median = validator(value.median, `${label} median`);
  const p75 = validator(value.p75, `${label} p75`);
  if (p25 > median || median > p75) {
    throw new Error(`${label} quartiles must be ascending.`);
  }
}

function validateBenchmark(
  benchmark: DiscoveryFormatGateBenchmarkProfile,
): DiscoveryFormatGateBenchmarkProfile {
  if (!probeModes.includes(benchmark.mode)) {
    throw new Error("Format-gate benchmark mode is invalid.");
  }
  positiveInteger(benchmark.distanceMetres, "Format-gate benchmark distance");
  positiveInteger(benchmark.gateCount, "Format-gate benchmark gate count");
  positiveInteger(
    benchmark.benchmarkCoreCount,
    "Format-gate benchmark Core count",
  );
  probability(
    benchmark.eliteCohortPercentileFloor,
    "Format-gate elite cohort percentile floor",
  );
  required(benchmark.formatId, "Format-gate benchmark format ID");
  required(benchmark.sourceAuthority, "Format-gate benchmark source authority");
  canonicalTimestamp(
    benchmark.dataCurrentThrough,
    "Format-gate benchmark data current through",
  );
  validateAscendingQuartiles(
    benchmark.centralSpeedMetresPerSecond,
    "Format-gate central speed",
    positiveFinite,
  );
  validateAscendingQuartiles(
    benchmark.ceilingSpeedMetresPerSecond,
    "Format-gate ceiling speed",
    positiveFinite,
  );
  if (benchmark.dispersion !== null) {
    validateAscendingQuartiles(
      benchmark.dispersion,
      "Format-gate dispersion",
      nonNegativeFinite,
    );
  }
  return benchmark;
}

function paceFit(
  candidate: number | null,
  benchmark: Readonly<{ p25: number; median: number; p75: number }>,
): DiscoveryFormatGatePaceFit {
  if (candidate === null) return "unavailable";
  positiveFinite(candidate, "Candidate pace");
  if (candidate >= benchmark.median) {
    return "matches_or_betters_elite_median";
  }
  if (candidate >= benchmark.p25) return "matches_elite_lower_quartile";
  return "below_elite_lower_quartile";
}

function dispersionFit(
  candidate: DiscoveryDispersionObservation | null,
  benchmark: DiscoveryFormatGateBenchmarkProfile["dispersion"],
): DiscoveryFormatGateDispersionFit {
  if (candidate === null || benchmark === null) return "unavailable";
  if (candidate.kind !== benchmark.kind) {
    throw new Error(
      "Candidate and format-gate benchmark dispersion metrics must match.",
    );
  }
  nonNegativeFinite(candidate.value, "Candidate dispersion");
  if (candidate.value < benchmark.p25) return "tighter_than_elite_cohort";
  if (candidate.value <= benchmark.p75) return "within_elite_cohort";
  return "wider_than_elite_cohort";
}

function fitStrength(value: DiscoveryFormatGatePaceFit): number {
  switch (value) {
    case "matches_or_betters_elite_median":
      return 2;
    case "matches_elite_lower_quartile":
      return 1;
    case "below_elite_lower_quartile":
    case "unavailable":
      return 0;
  }
}

function confidenceFor(
  usableDistanceObservationCount: number,
  benchmarkCoreCount: number,
): DiscoveryFormatGateTransferResult["confidence"] {
  if (usableDistanceObservationCount >= 10 && benchmarkCoreCount >= 50) {
    return "high";
  }
  if (usableDistanceObservationCount >= 5 && benchmarkCoreCount >= 20) {
    return "moderate";
  }
  return "low";
}

export function inferDiscoveryFormatGateTransferFit(
  input: DiscoveryFormatGateTransferInput,
): DiscoveryFormatGateTransferResult {
  if (!probeModes.includes(input.mode)) {
    throw new Error("Format-gate transfer mode is invalid.");
  }
  const distanceMetres = positiveInteger(
    input.distanceMetres,
    "Format-gate transfer distance",
  );
  const gateCount = positiveInteger(
    input.gateCount,
    "Format-gate transfer gate count",
  );
  const formatId = required(input.formatId, "Format-gate transfer format ID");
  const usableDistanceObservationCount = count(
    input.usableDistanceObservationCount,
    "Format-gate distance observation count",
  );
  const directFormatRaceCount = count(
    input.directFormatRaceCount,
    "Direct format race count",
  );
  const minimumDirectFormatSample = positiveInteger(
    input.minimumDirectFormatSample ?? 5,
    "Minimum direct format sample",
  );
  if (input.centralSpeedMetresPerSecond !== null) {
    positiveFinite(
      input.centralSpeedMetresPerSecond,
      "Candidate central speed",
    );
  }
  if (input.ceilingSpeedMetresPerSecond !== null) {
    positiveFinite(
      input.ceilingSpeedMetresPerSecond,
      "Candidate ceiling speed",
    );
  }
  if (input.dispersion !== null) {
    nonNegativeFinite(input.dispersion.value, "Candidate dispersion");
  }

  const reasons = new Set<
    DiscoveryFormatGateTransferResult["reasons"][number]
  >();
  if (
    usableDistanceObservationCount === 0 ||
    input.centralSpeedMetresPerSecond === null ||
    input.ceilingSpeedMetresPerSecond === null
  ) {
    reasons.add("distance_distribution_unavailable");
    return Object.freeze({
      mode: input.mode,
      distanceMetres,
      formatId,
      gateCount,
      directFormatRaceCount,
      assessment: "unavailable",
      centralPaceFit: "unavailable",
      ceilingPaceFit: "unavailable",
      dispersionFit: "unavailable",
      confidence: "low",
      recommendedAction: "gather_distance_distribution_first",
      inferenceOnly: true,
      provenFormatSpecialist: false,
      reasons: Object.freeze([...reasons]),
    });
  }

  if (input.benchmark === null) {
    reasons.add("benchmark_unavailable");
    return Object.freeze({
      mode: input.mode,
      distanceMetres,
      formatId,
      gateCount,
      directFormatRaceCount,
      assessment: "unavailable",
      centralPaceFit: "unavailable",
      ceilingPaceFit: "unavailable",
      dispersionFit: "unavailable",
      confidence: "low",
      recommendedAction: "gather_distance_distribution_first",
      inferenceOnly: true,
      provenFormatSpecialist: false,
      reasons: Object.freeze([...reasons]),
    });
  }

  const benchmark = validateBenchmark(input.benchmark);
  if (
    benchmark.mode !== input.mode ||
    benchmark.distanceMetres !== distanceMetres ||
    benchmark.formatId !== formatId ||
    benchmark.gateCount !== gateCount
  ) {
    throw new Error(
      "Format-gate benchmark does not match the candidate mode, distance, format and gate count.",
    );
  }

  const centralPaceFit = paceFit(
    input.centralSpeedMetresPerSecond,
    benchmark.centralSpeedMetresPerSecond,
  );
  const ceilingPaceFit = paceFit(
    input.ceilingSpeedMetresPerSecond,
    benchmark.ceilingSpeedMetresPerSecond,
  );
  const repeatabilityFit = dispersionFit(
    input.dispersion,
    benchmark.dispersion,
  );
  const centralStrength = fitStrength(centralPaceFit);
  const ceilingStrength = fitStrength(ceilingPaceFit);

  if (centralStrength > 0) {
    reasons.add("central_distribution_matches_elite_format_cohort");
  }
  if (ceilingStrength > 0) {
    reasons.add("ceiling_distribution_matches_elite_format_cohort");
  }
  if (
    repeatabilityFit === "within_elite_cohort" ||
    repeatabilityFit === "tighter_than_elite_cohort"
  ) {
    reasons.add("dispersion_matches_or_betters_elite_format_cohort");
  }
  if (repeatabilityFit === "wider_than_elite_cohort") {
    reasons.add("wider_than_elite_format_cohort");
  }
  if (usableDistanceObservationCount < 10) reasons.add("distance_sample_small");
  if (benchmark.benchmarkCoreCount < 50) reasons.add("benchmark_sample_small");
  if (directFormatRaceCount > 0) reasons.add("direct_format_sample_available");

  let assessment: DiscoveryFormatGateTransferAssessment;
  if (centralStrength > 0 && ceilingStrength > 0) {
    assessment = "strong_inferred_fit";
  } else if (ceilingStrength === 2) {
    assessment = "ceiling_inferred_fit";
  } else if (centralStrength === 2) {
    assessment = "central_inferred_fit";
  } else {
    assessment = "mismatch";
  }

  const confidence = confidenceFor(
    usableDistanceObservationCount,
    benchmark.benchmarkCoreCount,
  );
  const recommendedAction =
    directFormatRaceCount >= minimumDirectFormatSample
      ? "prefer_direct_format_evidence"
      : assessment === "strong_inferred_fit" ||
          assessment === "ceiling_inferred_fit" ||
          assessment === "central_inferred_fit"
        ? "targeted_format_probe"
        : "do_not_prioritise_from_transfer_alone";

  return Object.freeze({
    mode: input.mode,
    distanceMetres,
    formatId,
    gateCount,
    directFormatRaceCount,
    assessment,
    centralPaceFit,
    ceilingPaceFit,
    dispersionFit: repeatabilityFit,
    confidence,
    recommendedAction,
    inferenceOnly: true,
    provenFormatSpecialist: false,
    reasons: Object.freeze([...reasons]),
  });
}
