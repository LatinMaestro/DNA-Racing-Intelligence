import type {
  DiscoveryProbeCandidate,
  ProbeMode,
} from "./discovery-probe-plan";

export type DiscoveryExactDistanceBenchmarkEvidence = Readonly<{
  mode: ProbeMode;
  distanceMetres: number;
  dataCurrentThrough: string;
  raceEntryCount: number;
  winningEntryCount: number;
  topThreeEntryCount: number;
  winningP25Milliseconds: number;
  winningMedianMilliseconds: number;
  winningP75Milliseconds: number;
  topThreeP25Milliseconds: number;
  topThreeMedianMilliseconds: number;
  topThreeP75Milliseconds: number;
  refreshedAt: string;
}>;

export type DiscoveryBenchmarkAssessment =
  | "not_available"
  | "winning_range"
  | "top_three_range"
  | "outside_top_three_range";

export type DiscoveryBenchmarkedCandidate = DiscoveryProbeCandidate &
  Readonly<{
    benchmarkEvidence: DiscoveryExactDistanceBenchmarkEvidence | null;
    benchmarkAssessment: DiscoveryBenchmarkAssessment;
  }>;

function key(mode: ProbeMode, distanceMetres: number): string {
  return JSON.stringify([mode, distanceMetres]);
}

function canonicalTimestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function positiveFinite(value: number, label: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be positive and finite.`);
  }
  return value;
}

function normalizeBenchmark(
  value: DiscoveryExactDistanceBenchmarkEvidence,
): DiscoveryExactDistanceBenchmarkEvidence {
  if (!["bike", "car", "horse"].includes(value.mode)) {
    throw new Error("Discovery benchmark mode is invalid.");
  }
  const normalized: DiscoveryExactDistanceBenchmarkEvidence = {
    mode: value.mode,
    distanceMetres: positiveInteger(value.distanceMetres, "Benchmark distance"),
    dataCurrentThrough: canonicalTimestamp(
      value.dataCurrentThrough,
      "Benchmark data current through",
    ),
    raceEntryCount: positiveInteger(
      value.raceEntryCount,
      "Benchmark race entries",
    ),
    winningEntryCount: positiveInteger(
      value.winningEntryCount,
      "Benchmark winning entries",
    ),
    topThreeEntryCount: positiveInteger(
      value.topThreeEntryCount,
      "Benchmark top-three entries",
    ),
    winningP25Milliseconds: positiveFinite(
      value.winningP25Milliseconds,
      "Benchmark winning p25",
    ),
    winningMedianMilliseconds: positiveFinite(
      value.winningMedianMilliseconds,
      "Benchmark winning median",
    ),
    winningP75Milliseconds: positiveFinite(
      value.winningP75Milliseconds,
      "Benchmark winning p75",
    ),
    topThreeP25Milliseconds: positiveFinite(
      value.topThreeP25Milliseconds,
      "Benchmark top-three p25",
    ),
    topThreeMedianMilliseconds: positiveFinite(
      value.topThreeMedianMilliseconds,
      "Benchmark top-three median",
    ),
    topThreeP75Milliseconds: positiveFinite(
      value.topThreeP75Milliseconds,
      "Benchmark top-three p75",
    ),
    refreshedAt: canonicalTimestamp(
      value.refreshedAt,
      "Benchmark refreshed at",
    ),
  };

  if (
    normalized.winningEntryCount > normalized.topThreeEntryCount ||
    normalized.topThreeEntryCount > normalized.raceEntryCount ||
    normalized.winningP25Milliseconds > normalized.winningMedianMilliseconds ||
    normalized.winningMedianMilliseconds > normalized.winningP75Milliseconds ||
    normalized.topThreeP25Milliseconds >
      normalized.topThreeMedianMilliseconds ||
    normalized.topThreeMedianMilliseconds > normalized.topThreeP75Milliseconds
  ) {
    throw new Error("Discovery benchmark evidence is inconsistent.");
  }
  return normalized;
}

function assess(
  candidate: DiscoveryProbeCandidate,
  benchmark: DiscoveryExactDistanceBenchmarkEvidence | null,
): DiscoveryBenchmarkAssessment {
  if (benchmark === null || candidate.directTimeEvidence === null) {
    return "not_available";
  }

  const direct = candidate.directTimeEvidence;
  if (
    direct.bestMilliseconds <= benchmark.winningP75Milliseconds ||
    direct.medianMilliseconds <= benchmark.winningMedianMilliseconds
  ) {
    return "winning_range";
  }
  if (
    direct.bestMilliseconds <= benchmark.topThreeP75Milliseconds ||
    direct.medianMilliseconds <= benchmark.topThreeMedianMilliseconds
  ) {
    return "top_three_range";
  }
  return "outside_top_three_range";
}

export function attachDiscoveryBenchmarks(
  candidates: readonly DiscoveryProbeCandidate[],
  benchmarkInputs: readonly DiscoveryExactDistanceBenchmarkEvidence[],
): readonly DiscoveryBenchmarkedCandidate[] {
  const benchmarks = new Map<string, DiscoveryExactDistanceBenchmarkEvidence>();
  for (const input of benchmarkInputs) {
    const benchmark = normalizeBenchmark(input);
    const benchmarkKey = key(benchmark.mode, benchmark.distanceMetres);
    if (benchmarks.has(benchmarkKey)) {
      throw new Error("Duplicate Discovery exact-distance benchmark.");
    }
    benchmarks.set(benchmarkKey, benchmark);
  }

  return candidates.map((candidate) => {
    const benchmark =
      benchmarks.get(key(candidate.mode, candidate.distanceMetres)) ?? null;
    return {
      ...candidate,
      benchmarkEvidence: benchmark,
      benchmarkAssessment: assess(candidate, benchmark),
    };
  });
}
