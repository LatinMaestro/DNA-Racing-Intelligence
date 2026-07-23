import {
  isNegativeExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export const qualificationModes = ["bike", "car", "horse"] as const;
export type QualificationMode = (typeof qualificationModes)[number];

export type QualificationMetric =
  | Readonly<{ kind: "fastest_single_time" }>
  | Readonly<{ kind: "median_time" }>
  | Readonly<{ kind: "average_time" }>
  | Readonly<{ kind: "wins" }>
  | Readonly<{ kind: "best_finish" }>
  | Readonly<{ kind: "top_x_finishes"; topX: number }>
  | Readonly<{ kind: "points"; pointsByFinish: readonly string[] }>
  | Readonly<{ kind: "custom"; description: string }>;

export type QualificationObservationInput = Readonly<{
  eventId: string;
  eventAt: string;
  mode: QualificationMode;
  distanceMetres: number;
  gateCount: number;
  elapsedTimeMs: number | null;
  finishPosition: number | null;
}>;

export type QualificationCandidateEvidenceInput = Readonly<{
  coreId: string;
  leaderboardGroupId: string;
  observations: readonly QualificationObservationInput[];
  historicalStarRationale: string | null;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: "current" | "ageing" | "stale" | "unknown";
}>;

export type QualificationMetricEvidenceInput = Readonly<{
  bracketId: string;
  mode: QualificationMode;
  exactDistancesMetres: readonly number[];
  gateCount: number;
  minimumRaceCount: number;
  metric: QualificationMetric;
  candidates: readonly QualificationCandidateEvidenceInput[];
}>;

export type QualificationMetricValue =
  | Readonly<{
      kind: "time_rational_ms";
      numerator: string;
      denominator: number;
      direction: "lower_is_better";
    }>
  | Readonly<{
      kind: "count";
      value: number;
      direction: "higher_is_better";
    }>
  | Readonly<{
      kind: "finish_position";
      value: number;
      direction: "lower_is_better";
    }>
  | Readonly<{
      kind: "points";
      exactValue: string;
      direction: "higher_is_better";
    }>;

export type QualificationMetricWarning =
  | "BELOW_MINIMUM_RACE_COUNT"
  | "TIME_EVIDENCE_INCOMPLETE"
  | "FINISH_EVIDENCE_INCOMPLETE"
  | "CUSTOM_METRIC_UNAVAILABLE"
  | "DATA_CUTOFF_UNKNOWN"
  | "LAST_IMPORTED_UNKNOWN"
  | "IMPORTED_DATA_AGEING"
  | "IMPORTED_DATA_STALE"
  | "CURRENT_FIELD_UNAVAILABLE"
  | "GATE_C_NOT_PASSED";

export type QualificationCandidateEvidence = Readonly<{
  coreId: string;
  bracketId: string;
  leaderboardGroupId: string;
  acceptedRaceCount: number;
  requiredRaceCount: number;
  metricStatus: "complete" | "partial" | "unavailable";
  metricValue: QualificationMetricValue | null;
  experimentalRank: number | null;
  historicalStarRationale: string | null;
  dataCurrentThrough: string | null;
  lastImported: string | null;
  freshness: QualificationCandidateEvidenceInput["freshness"];
  warnings: readonly QualificationMetricWarning[];
  importedHistoricalSnapshot: true;
  currentQualifyingFieldAvailable: false;
  actionableRecommendationAllowed: false;
  automaticEntryAllowed: false;
}>;

export type QualificationMetricEvidence = Readonly<{
  bracketId: string;
  mode: QualificationMode;
  exactDistancesMetres: readonly number[];
  gateCount: number;
  minimumRaceCount: number;
  metric: QualificationMetric;
  candidates: readonly QualificationCandidateEvidence[];
  gateCRequired: true;
  actionableRecommendationAllowed: false;
  currentQualifyingFieldAvailable: false;
}>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null): string | null {
  if (value === null) return null;
  const normalized = value.trim();
  return normalized === "" ? null : normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = Date.parse(required(value, label));
  if (Number.isNaN(parsed)) throw new Error(`${label} must be valid.`);
  return new Date(parsed).toISOString();
}

function optionalTimestamp(value: string | null, label: string): string | null {
  return value === null ? null : timestamp(value, label);
}

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function normalizeDistances(values: readonly number[]): readonly number[] {
  if (values.length === 0) {
    throw new Error("At least one exact qualification distance is required.");
  }
  const normalized = values.map((value) =>
    positiveInteger(value, "Qualification distance"),
  );
  if (new Set(normalized).size !== normalized.length) {
    throw new Error("Qualification distances must not contain duplicates.");
  }
  return [...normalized].sort((left, right) => left - right);
}

function normalizeMetric(
  input: QualificationMetric,
  maximumGateCount: number,
): QualificationMetric {
  switch (input.kind) {
    case "fastest_single_time":
    case "median_time":
    case "average_time":
    case "wins":
    case "best_finish":
      return { kind: input.kind };
    case "top_x_finishes":
      if (
        positiveInteger(input.topX, "Top-X finish position") > maximumGateCount
      ) {
        throw new Error("Top-X finish position cannot exceed gate count.");
      }
      return { kind: input.kind, topX: input.topX };
    case "points": {
      if (input.pointsByFinish.length !== maximumGateCount) {
        throw new Error("Points table must contain one value per gate.");
      }
      return {
        kind: input.kind,
        pointsByFinish: input.pointsByFinish.map((value) => {
          const normalized = normalizeExactDecimal(value);
          if (isNegativeExactDecimal(normalized)) {
            throw new Error("Qualification points cannot be negative.");
          }
          return normalized;
        }),
      };
    }
    case "custom":
      return {
        kind: input.kind,
        description: required(input.description, "Custom metric description"),
      };
    default:
      throw new Error("Qualification metric is invalid.");
  }
}

function addExactDecimals(values: readonly string[]): string {
  if (values.length === 0) return "0";
  const normalized = values.map(normalizeExactDecimal);
  const scale = Math.max(
    ...normalized.map((value) => value.split(".")[1]?.length ?? 0),
  );
  const sum = normalized.reduce((total, value) => {
    const [whole = "0", fraction = ""] = value.split(".");
    return total + BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
  }, 0n);
  if (scale === 0) return sum.toString();
  const raw = sum.toString().padStart(scale + 1, "0");
  return normalizeExactDecimal(
    `${raw.slice(0, raw.length - scale)}.${raw.slice(raw.length - scale)}`,
  );
}

function compareRational(
  leftNumerator: string,
  leftDenominator: number,
  rightNumerator: string,
  rightDenominator: number,
): number {
  const left = BigInt(leftNumerator) * BigInt(rightDenominator);
  const right = BigInt(rightNumerator) * BigInt(leftDenominator);
  return left < right ? -1 : left > right ? 1 : 0;
}

function decimalToScaled(value: string, scale: number): bigint {
  const normalized = normalizeExactDecimal(value);
  const [whole = "0", fraction = ""] = normalized.split(".");
  return BigInt(`${whole}${fraction.padEnd(scale, "0")}`);
}

function compareMetricValues(
  left: QualificationMetricValue,
  right: QualificationMetricValue,
): number {
  if (left.kind !== right.kind) {
    throw new Error("Qualification metric values are not comparable.");
  }
  switch (left.kind) {
    case "time_rational_ms": {
      const typedRight = right as Extract<
        QualificationMetricValue,
        { kind: "time_rational_ms" }
      >;
      return compareRational(
        left.numerator,
        left.denominator,
        typedRight.numerator,
        typedRight.denominator,
      );
    }
    case "count": {
      const typedRight = right as Extract<
        QualificationMetricValue,
        { kind: "count" }
      >;
      return typedRight.value - left.value;
    }
    case "finish_position": {
      const typedRight = right as Extract<
        QualificationMetricValue,
        { kind: "finish_position" }
      >;
      return left.value - typedRight.value;
    }
    case "points": {
      const typedRight = right as Extract<
        QualificationMetricValue,
        { kind: "points" }
      >;
      const scale = Math.max(
        left.exactValue.split(".")[1]?.length ?? 0,
        typedRight.exactValue.split(".")[1]?.length ?? 0,
      );
      const leftValue = decimalToScaled(left.exactValue, scale);
      const rightValue = decimalToScaled(typedRight.exactValue, scale);
      return leftValue > rightValue ? -1 : leftValue < rightValue ? 1 : 0;
    }
  }
}

function metricValue(
  metric: QualificationMetric,
  observations: readonly QualificationObservationInput[],
): {
  value: QualificationMetricValue | null;
  missingCount: number;
} {
  if (metric.kind === "custom") {
    return { value: null, missingCount: observations.length };
  }
  if (
    metric.kind === "fastest_single_time" ||
    metric.kind === "median_time" ||
    metric.kind === "average_time"
  ) {
    const times = observations
      .map((observation) => observation.elapsedTimeMs)
      .filter((value): value is number => value !== null)
      .sort((left, right) => left - right);
    if (times.length === 0) {
      return { value: null, missingCount: observations.length };
    }
    let numerator: bigint;
    let denominator: number;
    if (metric.kind === "fastest_single_time") {
      numerator = BigInt(times[0]!);
      denominator = 1;
    } else if (metric.kind === "average_time") {
      numerator = times.reduce((sum, value) => sum + BigInt(value), 0n);
      denominator = times.length;
    } else {
      const middle = Math.floor(times.length / 2);
      if (times.length % 2 === 1) {
        numerator = BigInt(times[middle]!);
        denominator = 1;
      } else {
        numerator = BigInt(times[middle - 1]!) + BigInt(times[middle]!);
        denominator = 2;
      }
    }
    return {
      value: {
        kind: "time_rational_ms",
        numerator: numerator.toString(),
        denominator,
        direction: "lower_is_better",
      },
      missingCount: observations.length - times.length,
    };
  }

  const finishes = observations
    .map((observation) => observation.finishPosition)
    .filter((value): value is number => value !== null);
  if (finishes.length === 0) {
    return { value: null, missingCount: observations.length };
  }
  if (metric.kind === "wins") {
    return {
      value: {
        kind: "count",
        value: finishes.filter((finish) => finish === 1).length,
        direction: "higher_is_better",
      },
      missingCount: observations.length - finishes.length,
    };
  }
  if (metric.kind === "top_x_finishes") {
    return {
      value: {
        kind: "count",
        value: finishes.filter((finish) => finish <= metric.topX).length,
        direction: "higher_is_better",
      },
      missingCount: observations.length - finishes.length,
    };
  }
  if (metric.kind === "best_finish") {
    return {
      value: {
        kind: "finish_position",
        value: Math.min(...finishes),
        direction: "lower_is_better",
      },
      missingCount: observations.length - finishes.length,
    };
  }
  return {
    value: {
      kind: "points",
      exactValue: addExactDecimals(
        finishes.map((finish) => metric.pointsByFinish[finish - 1]!),
      ),
      direction: "higher_is_better",
    },
    missingCount: observations.length - finishes.length,
  };
}

export function buildQualificationMetricEvidence(
  input: QualificationMetricEvidenceInput,
): QualificationMetricEvidence {
  const bracketId = required(input.bracketId, "Bracket ID");
  if (!qualificationModes.includes(input.mode)) {
    throw new Error("Qualification mode is invalid.");
  }
  const exactDistancesMetres = normalizeDistances(input.exactDistancesMetres);
  const minimumRaceCount = positiveInteger(
    input.minimumRaceCount,
    "Minimum race count",
  );
  const gateCount = positiveInteger(
    input.gateCount,
    "Qualification gate count",
  );
  const metric = normalizeMetric(input.metric, gateCount);

  const normalizedCandidates = input.candidates.map((candidate) => {
    const coreId = required(candidate.coreId, "Core ID");
    const leaderboardGroupId = required(
      candidate.leaderboardGroupId,
      "Leaderboard group ID",
    );
    if (
      !["current", "ageing", "stale", "unknown"].includes(candidate.freshness)
    ) {
      throw new Error("Qualification freshness is invalid.");
    }
    const dataCurrentThrough = optionalTimestamp(
      candidate.dataCurrentThrough,
      "Data current through",
    );
    const lastImported = optionalTimestamp(
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

    const observations = candidate.observations.map((observation) => {
      const eventId = required(observation.eventId, "Event ID");
      const eventAt = timestamp(observation.eventAt, "Event time");
      if (observation.mode !== input.mode) {
        throw new Error("Qualification observation mode does not match.");
      }
      if (!exactDistancesMetres.includes(observation.distanceMetres)) {
        throw new Error(
          "Qualification observation distance is not configured.",
        );
      }
      const observationGateCount = positiveInteger(
        observation.gateCount,
        "Observation gate count",
      );
      if (observationGateCount !== gateCount) {
        throw new Error("Qualification observation gate count does not match.");
      }
      const elapsedTimeMs =
        observation.elapsedTimeMs === null
          ? null
          : positiveInteger(
              observation.elapsedTimeMs,
              "Observation elapsed time",
            );
      const finishPosition =
        observation.finishPosition === null
          ? null
          : positiveInteger(
              observation.finishPosition,
              "Observation finish position",
            );
      if (finishPosition !== null && finishPosition > observationGateCount) {
        throw new Error("Finish position cannot exceed gate count.");
      }
      if (
        dataCurrentThrough !== null &&
        Date.parse(eventAt) > Date.parse(dataCurrentThrough)
      ) {
        throw new Error(
          "Qualification observation cannot exceed the data cutoff.",
        );
      }
      return {
        eventId,
        eventAt,
        mode: observation.mode,
        distanceMetres: positiveInteger(
          observation.distanceMetres,
          "Observation distance",
        ),
        gateCount: observationGateCount,
        elapsedTimeMs,
        finishPosition,
      };
    });
    if (
      new Set(observations.map((observation) => observation.eventId)).size !==
      observations.length
    ) {
      throw new Error("Qualification event IDs must be unique per core.");
    }
    return {
      coreId,
      leaderboardGroupId,
      observations,
      historicalStarRationale: optional(candidate.historicalStarRationale),
      dataCurrentThrough,
      lastImported,
      freshness: candidate.freshness,
    };
  });
  const candidateCoreIds = normalizedCandidates.map(
    (candidate) => candidate.coreId,
  );
  if (new Set(candidateCoreIds).size !== candidateCoreIds.length) {
    throw new Error(
      "A qualification core must appear in exactly one leaderboard group.",
    );
  }

  const candidates: QualificationCandidateEvidence[] = normalizedCandidates.map(
    (candidate) => {
      const result = metricValue(metric, candidate.observations);
      const warnings = new Set<QualificationMetricWarning>([
        "CURRENT_FIELD_UNAVAILABLE",
        "GATE_C_NOT_PASSED",
      ]);
      if (candidate.observations.length < minimumRaceCount) {
        warnings.add("BELOW_MINIMUM_RACE_COUNT");
      }
      if (
        result.missingCount > 0 &&
        ["fastest_single_time", "median_time", "average_time"].includes(
          metric.kind,
        )
      ) {
        warnings.add("TIME_EVIDENCE_INCOMPLETE");
      }
      if (
        result.missingCount > 0 &&
        ["wins", "best_finish", "top_x_finishes", "points"].includes(
          metric.kind,
        )
      ) {
        warnings.add("FINISH_EVIDENCE_INCOMPLETE");
      }
      if (metric.kind === "custom") {
        warnings.add("CUSTOM_METRIC_UNAVAILABLE");
      }
      if (
        candidate.dataCurrentThrough === null ||
        candidate.freshness === "unknown"
      ) {
        warnings.add("DATA_CUTOFF_UNKNOWN");
      }
      if (candidate.lastImported === null) {
        warnings.add("LAST_IMPORTED_UNKNOWN");
      }
      if (candidate.freshness === "ageing") {
        warnings.add("IMPORTED_DATA_AGEING");
      }
      if (candidate.freshness === "stale") {
        warnings.add("IMPORTED_DATA_STALE");
      }
      return {
        coreId: candidate.coreId,
        bracketId,
        leaderboardGroupId: candidate.leaderboardGroupId,
        acceptedRaceCount: candidate.observations.length,
        requiredRaceCount: minimumRaceCount,
        metricStatus:
          result.value === null
            ? "unavailable"
            : result.missingCount > 0 ||
                candidate.observations.length < minimumRaceCount
              ? "partial"
              : "complete",
        metricValue: result.value,
        experimentalRank: null,
        historicalStarRationale: candidate.historicalStarRationale,
        dataCurrentThrough: candidate.dataCurrentThrough,
        lastImported: candidate.lastImported,
        freshness: candidate.freshness,
        warnings: [...warnings].sort(),
        importedHistoricalSnapshot: true,
        currentQualifyingFieldAvailable: false,
        actionableRecommendationAllowed: false,
        automaticEntryAllowed: false,
      };
    },
  );

  const grouped = new Map<string, QualificationCandidateEvidence[]>();
  for (const candidate of candidates) {
    const group = grouped.get(candidate.leaderboardGroupId) ?? [];
    group.push(candidate);
    grouped.set(candidate.leaderboardGroupId, group);
  }
  const ranked = [...grouped.values()].flatMap((group) => {
    const comparable = group
      .filter(
        (
          candidate,
        ): candidate is QualificationCandidateEvidence & {
          metricValue: QualificationMetricValue;
        } => candidate.metricValue !== null,
      )
      .sort(
        (left, right) =>
          compareMetricValues(left.metricValue, right.metricValue) ||
          left.coreId.localeCompare(right.coreId),
      );
    const rankByCore = new Map<string, number>();
    let currentRank = 0;
    let previous: QualificationMetricValue | null = null;
    comparable.forEach((candidate, index) => {
      if (
        previous === null ||
        compareMetricValues(previous, candidate.metricValue) !== 0
      ) {
        currentRank = index + 1;
      }
      rankByCore.set(candidate.coreId, currentRank);
      previous = candidate.metricValue;
    });
    return group.map((candidate) => ({
      ...candidate,
      experimentalRank: rankByCore.get(candidate.coreId) ?? null,
    }));
  });

  return {
    bracketId,
    mode: input.mode,
    exactDistancesMetres,
    gateCount,
    minimumRaceCount,
    metric,
    candidates: ranked.sort(
      (left, right) =>
        left.leaderboardGroupId.localeCompare(right.leaderboardGroupId) ||
        (left.experimentalRank ?? Number.MAX_SAFE_INTEGER) -
          (right.experimentalRank ?? Number.MAX_SAFE_INTEGER) ||
        left.coreId.localeCompare(right.coreId),
    ),
    gateCRequired: true,
    actionableRecommendationAllowed: false,
    currentQualifyingFieldAvailable: false,
  };
}
