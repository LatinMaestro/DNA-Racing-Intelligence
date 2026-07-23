import {
  isNegativeExactDecimal,
  normalizeExactDecimal,
} from "@/domain/exact-decimal";

export const tournamentModes = ["bike", "car", "horse"] as const;
export type TournamentMode = (typeof tournamentModes)[number];

export const tournamentCoreClasses = [
  "Genesis",
  "Morphed",
  "Freak",
  "X-Class",
] as const;
export type TournamentCoreClass = (typeof tournamentCoreClasses)[number];

export const tournamentElements = ["Metal", "Fire", "Earth", "Water"] as const;
export type TournamentElement = (typeof tournamentElements)[number];

export type TournamentRankingMetricInput =
  | Readonly<{ kind: "fastest_single_time" }>
  | Readonly<{ kind: "median_time" }>
  | Readonly<{ kind: "average_time" }>
  | Readonly<{ kind: "wins" }>
  | Readonly<{ kind: "best_finish" }>
  | Readonly<{ kind: "top_x_finishes"; topX: number }>
  | Readonly<{ kind: "points"; pointsByFinish: readonly string[] }>
  | Readonly<{ kind: "custom"; description: string }>;

export type TournamentQualificationThresholdInput =
  | Readonly<{ kind: "percentage"; value: number }>
  | Readonly<{ kind: "count"; value: number }>;

export type TournamentFNumberRangeInput = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type TournamentBracketInput = Readonly<{
  bracketId: string;
  name: string;
  qualificationOpensAt: string;
  qualificationClosesAt: string;
  mode: TournamentMode;
  exactDistancesMetres: readonly number[];
  gateCount: number;
  entryFeeAmount: string;
  entryFeeAsset: string;
  raceFormat: string;
  eligibleClasses: readonly TournamentCoreClass[];
  eligibleElements: readonly TournamentElement[];
  eligibleFNumbers: readonly TournamentFNumberRangeInput[];
  leaderboardSplit: "none" | "element" | "class" | "f_number" | "custom";
  leaderboardSplitDescription: string | null;
  minimumRaceCount: number;
  rankingMetric: TournamentRankingMetricInput;
  qualificationThreshold: TournamentQualificationThresholdInput;
  qualificationRacePool: "shared" | "separate" | "unknown";
  sharedRacePoolId: string | null;
  ruleStatus: "confirmed" | "uncertain";
  ruleEvidence: string | null;
}>;

export type TournamentConfigurationInput = Readonly<{
  tournamentId: string;
  name: string;
  season: string;
  brackets: readonly TournamentBracketInput[];
}>;

export type TournamentConfigurationWarning =
  "UNCERTAIN_RULE" | "RACE_POOL_UNKNOWN" | "CUSTOM_LEADERBOARD_REQUIRES_REVIEW";

export type TournamentBracket = Omit<
  TournamentBracketInput,
  | "qualificationOpensAt"
  | "qualificationClosesAt"
  | "exactDistancesMetres"
  | "entryFeeAmount"
  | "entryFeeAsset"
  | "eligibleClasses"
  | "eligibleElements"
  | "eligibleFNumbers"
  | "rankingMetric"
  | "qualificationThreshold"
  | "sharedRacePoolId"
  | "ruleEvidence"
  | "leaderboardSplitDescription"
> &
  Readonly<{
    qualificationOpensAt: string;
    qualificationClosesAt: string;
    exactDistancesMetres: readonly number[];
    entryFeeAmount: string;
    entryFeeAsset: string;
    eligibleClasses: readonly TournamentCoreClass[];
    eligibleElements: readonly TournamentElement[];
    eligibleFNumbers: readonly TournamentFNumberRangeInput[];
    rankingMetric: TournamentRankingMetricInput;
    qualificationThreshold: TournamentQualificationThresholdInput;
    sharedRacePoolId: string | null;
    ruleEvidence: string | null;
    leaderboardSplitDescription: string | null;
    warnings: readonly TournamentConfigurationWarning[];
    readyForQualificationEvaluation: boolean;
  }>;

export type TournamentConfiguration = Readonly<{
  tournamentId: string;
  name: string;
  season: string;
  brackets: readonly TournamentBracket[];
  warnings: readonly TournamentConfigurationWarning[];
  status: "confirmed" | "review_required";
  readyForQualificationEvaluation: boolean;
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

function positiveInteger(value: number, label: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive safe integer.`);
  }
  return value;
}

function uniqueSortedNumbers(
  values: readonly number[],
  label: string,
): readonly number[] {
  if (values.length === 0) throw new Error(`${label} is required.`);
  const normalized = values.map((value) => positiveInteger(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return [...normalized].sort((left, right) => left - right);
}

function uniqueSortedEnum<T extends string>(
  values: readonly T[],
  allowed: readonly T[],
  label: string,
): readonly T[] {
  for (const value of values) {
    if (!allowed.includes(value)) throw new Error(`${label} is invalid.`);
  }
  if (new Set(values).size !== values.length) {
    throw new Error(`${label} must not contain duplicates.`);
  }
  return [...values].sort((left, right) => left.localeCompare(right));
}

function normalizeFNumberRanges(
  values: readonly TournamentFNumberRangeInput[],
): readonly TournamentFNumberRangeInput[] {
  const normalized = values
    .map((range) => ({
      minimum: positiveInteger(range.minimum, "F-number minimum"),
      maximum: positiveInteger(range.maximum, "F-number maximum"),
    }))
    .sort(
      (left, right) =>
        left.minimum - right.minimum || left.maximum - right.maximum,
    );
  for (const [index, range] of normalized.entries()) {
    if (range.minimum > range.maximum) {
      throw new Error("F-number minimum cannot exceed maximum.");
    }
    const previous = normalized[index - 1];
    if (previous && range.minimum <= previous.maximum) {
      throw new Error("F-number ranges must not overlap.");
    }
  }
  return normalized;
}

function normalizeRankingMetric(
  metric: TournamentRankingMetricInput,
): TournamentRankingMetricInput {
  switch (metric.kind) {
    case "fastest_single_time":
    case "median_time":
    case "average_time":
    case "wins":
    case "best_finish":
      return { kind: metric.kind };
    case "top_x_finishes":
      return {
        kind: metric.kind,
        topX: positiveInteger(metric.topX, "Top-X finish position"),
      };
    case "points": {
      if (metric.pointsByFinish.length === 0) {
        throw new Error("Points ranking requires a points table.");
      }
      return {
        kind: metric.kind,
        pointsByFinish: metric.pointsByFinish.map((value) => {
          const normalized = normalizeExactDecimal(value);
          if (isNegativeExactDecimal(normalized)) {
            throw new Error("Points cannot be negative.");
          }
          return normalized;
        }),
      };
    }
    case "custom":
      return {
        kind: metric.kind,
        description: required(metric.description, "Custom ranking description"),
      };
    default:
      throw new Error("Tournament ranking metric is invalid.");
  }
}

function normalizeThreshold(
  threshold: TournamentQualificationThresholdInput,
): TournamentQualificationThresholdInput {
  if (threshold.kind === "percentage") {
    if (
      !Number.isFinite(threshold.value) ||
      threshold.value <= 0 ||
      threshold.value > 100
    ) {
      throw new Error(
        "Qualification percentage must be greater than zero and at most 100.",
      );
    }
    return { kind: threshold.kind, value: threshold.value };
  }
  if (threshold.kind === "count") {
    return {
      kind: threshold.kind,
      value: positiveInteger(threshold.value, "Qualification count"),
    };
  }
  throw new Error("Qualification threshold is invalid.");
}

function normalizeBracket(input: TournamentBracketInput): TournamentBracket {
  const qualificationOpensAt = timestamp(
    input.qualificationOpensAt,
    "Qualification opening time",
  );
  const qualificationClosesAt = timestamp(
    input.qualificationClosesAt,
    "Qualification closing time",
  );
  if (Date.parse(qualificationClosesAt) <= Date.parse(qualificationOpensAt)) {
    throw new Error("Qualification must close after it opens.");
  }
  if (!tournamentModes.includes(input.mode)) {
    throw new Error("Tournament mode is invalid.");
  }
  if (!["confirmed", "uncertain"].includes(input.ruleStatus)) {
    throw new Error("Tournament rule status is invalid.");
  }
  if (
    !["shared", "separate", "unknown"].includes(input.qualificationRacePool)
  ) {
    throw new Error("Qualification race-pool status is invalid.");
  }
  if (
    !["none", "element", "class", "f_number", "custom"].includes(
      input.leaderboardSplit,
    )
  ) {
    throw new Error("Leaderboard split is invalid.");
  }

  const sharedRacePoolId = optional(input.sharedRacePoolId);
  if (
    (input.qualificationRacePool === "shared") !==
    (sharedRacePoolId !== null)
  ) {
    throw new Error(
      "A shared race-pool ID is required only for shared qualification races.",
    );
  }

  const leaderboardSplitDescription = optional(
    input.leaderboardSplitDescription,
  );
  if (
    (input.leaderboardSplit === "custom") !==
    (leaderboardSplitDescription !== null)
  ) {
    throw new Error(
      "A custom leaderboard split requires one description, and standard splits require none.",
    );
  }

  const entryFeeAmount = normalizeExactDecimal(input.entryFeeAmount);
  if (isNegativeExactDecimal(entryFeeAmount)) {
    throw new Error("Tournament entry fee cannot be negative.");
  }
  const entryFeeAsset = required(
    input.entryFeeAsset,
    "Tournament entry-fee asset",
  ).toUpperCase();
  if (!/^[A-Z][A-Z0-9_-]{1,15}$/.test(entryFeeAsset)) {
    throw new Error("Tournament entry-fee asset is invalid.");
  }

  const warnings = new Set<TournamentConfigurationWarning>();
  if (input.ruleStatus === "uncertain") warnings.add("UNCERTAIN_RULE");
  if (input.qualificationRacePool === "unknown") {
    warnings.add("RACE_POOL_UNKNOWN");
  }
  if (
    input.leaderboardSplit === "custom" ||
    input.rankingMetric.kind === "custom"
  ) {
    warnings.add("CUSTOM_LEADERBOARD_REQUIRES_REVIEW");
  }

  const gateCount = positiveInteger(input.gateCount, "Tournament gate count");
  const rankingMetric = normalizeRankingMetric(input.rankingMetric);
  if (
    rankingMetric.kind === "top_x_finishes" &&
    rankingMetric.topX > gateCount
  ) {
    throw new Error("Top-X finish position cannot exceed gate count.");
  }
  if (
    rankingMetric.kind === "points" &&
    rankingMetric.pointsByFinish.length !== gateCount
  ) {
    throw new Error("Points table must contain one value per gate.");
  }

  return {
    bracketId: required(input.bracketId, "Bracket ID"),
    name: required(input.name, "Bracket name"),
    qualificationOpensAt,
    qualificationClosesAt,
    mode: input.mode,
    exactDistancesMetres: uniqueSortedNumbers(
      input.exactDistancesMetres,
      "Exact tournament distance",
    ),
    gateCount,
    entryFeeAmount,
    entryFeeAsset,
    raceFormat: required(input.raceFormat, "Tournament race format"),
    eligibleClasses: uniqueSortedEnum(
      input.eligibleClasses,
      tournamentCoreClasses,
      "Eligible class",
    ),
    eligibleElements: uniqueSortedEnum(
      input.eligibleElements,
      tournamentElements,
      "Eligible element",
    ),
    eligibleFNumbers: normalizeFNumberRanges(input.eligibleFNumbers),
    leaderboardSplit: input.leaderboardSplit,
    leaderboardSplitDescription,
    minimumRaceCount: positiveInteger(
      input.minimumRaceCount,
      "Minimum race count",
    ),
    rankingMetric,
    qualificationThreshold: normalizeThreshold(input.qualificationThreshold),
    qualificationRacePool: input.qualificationRacePool,
    sharedRacePoolId,
    ruleStatus: input.ruleStatus,
    ruleEvidence: optional(input.ruleEvidence),
    warnings: [...warnings].sort(),
    readyForQualificationEvaluation: warnings.size === 0,
  };
}

export function buildTournamentConfiguration(
  input: TournamentConfigurationInput,
): TournamentConfiguration {
  if (input.brackets.length === 0) {
    throw new Error("A tournament requires at least one bracket.");
  }
  const brackets = input.brackets
    .map(normalizeBracket)
    .sort((left, right) => left.bracketId.localeCompare(right.bracketId));
  if (
    new Set(brackets.map((bracket) => bracket.bracketId)).size !==
    brackets.length
  ) {
    throw new Error("Tournament bracket IDs must be unique.");
  }
  for (const poolId of new Set(
    brackets
      .map((bracket) => bracket.sharedRacePoolId)
      .filter((value): value is string => value !== null),
  )) {
    const pooledBrackets = brackets.filter(
      (bracket) => bracket.sharedRacePoolId === poolId,
    );
    if (pooledBrackets.length < 2) {
      throw new Error("A shared race pool must contain at least two brackets.");
    }
    const [first, ...rest] = pooledBrackets;
    const sharedRaceIdentity = (bracket: TournamentBracket) =>
      JSON.stringify([
        bracket.qualificationOpensAt,
        bracket.qualificationClosesAt,
        bracket.mode,
        bracket.exactDistancesMetres,
        bracket.gateCount,
        bracket.entryFeeAmount,
        bracket.entryFeeAsset,
        bracket.raceFormat,
        bracket.eligibleClasses,
        bracket.eligibleElements,
        bracket.eligibleFNumbers,
      ]);
    if (
      first === undefined ||
      rest.some(
        (bracket) => sharedRaceIdentity(bracket) !== sharedRaceIdentity(first),
      )
    ) {
      throw new Error(
        "Brackets in a shared race pool must use the same qualification race conditions.",
      );
    }
  }

  const warnings = [
    ...new Set(brackets.flatMap((bracket) => bracket.warnings)),
  ].sort();
  return {
    tournamentId: required(input.tournamentId, "Tournament ID"),
    name: required(input.name, "Tournament name"),
    season: required(input.season, "Tournament season"),
    brackets,
    warnings,
    status: warnings.length === 0 ? "confirmed" : "review_required",
    readyForQualificationEvaluation: brackets.every(
      (bracket) => bracket.readyForQualificationEvaluation,
    ),
  };
}
