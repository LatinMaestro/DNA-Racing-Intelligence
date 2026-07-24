import { normalizeExactDecimal } from "@/domain/exact-decimal";

export const tournamentRaceSegments = [
  "open_racing",
  "qualification",
  "round",
  "final",
] as const;
export type TournamentRaceSegment = (typeof tournamentRaceSegments)[number];

export type TournamentStageRuleInput = Readonly<{
  ruleId: string;
  tournamentId: string;
  bracketId?: string | null;
  segment: Exclude<TournamentRaceSegment, "open_racing">;
  startsAt: string;
  endsAt: string;
  mode: "bike" | "car" | "horse";
  exactDistancesMetres: readonly number[];
  gateCounts: readonly number[];
  entryFeeAsset?: string | null;
  entryFeeAmount?: string | null;
  ruleStatus: "confirmed" | "uncertain";
}>;

export type HistoricalRaceClassificationInput = Readonly<{
  raceId: string;
  occurredAt: string;
  mode: "bike" | "car" | "horse";
  distanceMetres: number;
  gateCount: number;
  entryFeeAsset?: string | null;
  entryFeeAmount?: string | null;
  sourceSegment?: TournamentRaceSegment | null;
  sourceTournamentId?: string | null;
  sourceBracketId?: string | null;
  sourceEvidence: "authoritative" | "non_authoritative" | "absent";
}>;

export type TournamentRaceClassificationWarning =
  | "AMBIGUOUS_CONFIGURED_MATCH"
  | "CONFIGURED_RULE_UNCERTAIN"
  | "SOURCE_CONFIGURATION_CONFLICT"
  | "SOURCE_TOURNAMENT_ID_MISSING"
  | "UNCLASSIFIED_HISTORICAL_RACE";

export type TournamentRaceClassification = Readonly<{
  raceId: string;
  segment: TournamentRaceSegment | null;
  tournamentId: string | null;
  bracketId: string | null;
  status:
    "confirmed" | "review_proposed" | "unclassified" | "ambiguous" | "conflict";
  confidence: "confirmed" | "inferred" | "none";
  matchedRuleIds: readonly string[];
  warnings: readonly TournamentRaceClassificationWarning[];
  aggregateEligible: boolean;
  requiresReview: boolean;
  historicalSnapshotOnly: true;
  liveTournamentStateClaimAllowed: false;
}>;

type StageRule = Omit<
  TournamentStageRuleInput,
  | "ruleId"
  | "tournamentId"
  | "bracketId"
  | "startsAt"
  | "endsAt"
  | "exactDistancesMetres"
  | "gateCounts"
  | "entryFeeAsset"
  | "entryFeeAmount"
> &
  Readonly<{
    ruleId: string;
    tournamentId: string;
    bracketId: string | null;
    startsAt: string;
    endsAt: string;
    exactDistancesMetres: readonly number[];
    gateCounts: readonly number[];
    entryFeeAsset: string | null;
    entryFeeAmount: string | null;
  }>;

function required(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized === "") throw new Error(`${label} is required.`);
  return normalized;
}

function optional(value: string | null | undefined): string | null {
  const normalized = value?.trim() ?? "";
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

function uniquePositiveIntegers(
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

function normalizeAsset(value: string | null | undefined): string | null {
  const normalized = optional(value)?.toUpperCase() ?? null;
  if (normalized !== null && !/^[A-Z][A-Z0-9_]{1,15}$/.test(normalized)) {
    throw new Error("Entry-fee asset identity is invalid.");
  }
  return normalized;
}

function normalizeRule(input: TournamentStageRuleInput): StageRule {
  if (!["qualification", "round", "final"].includes(input.segment)) {
    throw new Error("Tournament stage rule segment is invalid.");
  }
  if (!["confirmed", "uncertain"].includes(input.ruleStatus)) {
    throw new Error("Tournament stage rule status is invalid.");
  }
  const startsAt = timestamp(input.startsAt, "Stage opening time");
  const endsAt = timestamp(input.endsAt, "Stage closing time");
  if (Date.parse(startsAt) > Date.parse(endsAt)) {
    throw new Error("Stage opening time cannot follow stage closing time.");
  }
  const entryFeeAsset = normalizeAsset(input.entryFeeAsset);
  const entryFeeAmount =
    input.entryFeeAmount === null || input.entryFeeAmount === undefined
      ? null
      : normalizeExactDecimal(input.entryFeeAmount);
  if ((entryFeeAsset === null) !== (entryFeeAmount === null)) {
    throw new Error("Entry-fee asset and amount must be supplied together.");
  }
  if (entryFeeAmount?.startsWith("-")) {
    throw new Error("Entry-fee amount cannot be negative.");
  }
  return {
    ...input,
    ruleId: required(input.ruleId, "Stage rule ID"),
    tournamentId: required(input.tournamentId, "Tournament ID"),
    bracketId: optional(input.bracketId),
    startsAt,
    endsAt,
    exactDistancesMetres: uniquePositiveIntegers(
      input.exactDistancesMetres,
      "Exact distance",
    ),
    gateCounts: uniquePositiveIntegers(input.gateCounts, "Gate count"),
    entryFeeAsset,
    entryFeeAmount,
  };
}

function matchesRule(
  race: HistoricalRaceClassificationInput,
  occurredAt: string,
  entryFeeAsset: string | null,
  entryFeeAmount: string | null,
  rule: StageRule,
): boolean {
  const time = Date.parse(occurredAt);
  return (
    time >= Date.parse(rule.startsAt) &&
    time <= Date.parse(rule.endsAt) &&
    race.mode === rule.mode &&
    rule.exactDistancesMetres.includes(race.distanceMetres) &&
    rule.gateCounts.includes(race.gateCount) &&
    (rule.entryFeeAsset === null ||
      (rule.entryFeeAsset === entryFeeAsset &&
        rule.entryFeeAmount === entryFeeAmount))
  );
}

function sameSourceIdentity(
  race: HistoricalRaceClassificationInput,
  rule: StageRule,
): boolean {
  return (
    race.sourceSegment === rule.segment &&
    optional(race.sourceTournamentId) === rule.tournamentId &&
    (optional(race.sourceBracketId) === null ||
      optional(race.sourceBracketId) === rule.bracketId)
  );
}

export function classifyHistoricalTournamentRace(
  race: HistoricalRaceClassificationInput,
  rules: readonly TournamentStageRuleInput[],
): TournamentRaceClassification {
  const raceId = required(race.raceId, "Race ID");
  const occurredAt = timestamp(race.occurredAt, "Race timestamp");
  positiveInteger(race.distanceMetres, "Race distance");
  positiveInteger(race.gateCount, "Race gate count");
  if (
    !["authoritative", "non_authoritative", "absent"].includes(
      race.sourceEvidence,
    )
  ) {
    throw new Error("Source evidence status is invalid.");
  }
  if (
    race.sourceSegment !== null &&
    race.sourceSegment !== undefined &&
    !tournamentRaceSegments.includes(race.sourceSegment)
  ) {
    throw new Error("Source race segment is invalid.");
  }
  const sourceTournamentId = optional(race.sourceTournamentId);
  const sourceBracketId = optional(race.sourceBracketId);
  if (
    race.sourceEvidence === "absent" &&
    ((race.sourceSegment !== null && race.sourceSegment !== undefined) ||
      sourceTournamentId !== null ||
      sourceBracketId !== null)
  ) {
    throw new Error(
      "Absent source evidence cannot carry source classification.",
    );
  }
  if (
    race.sourceEvidence === "authoritative" &&
    race.sourceSegment &&
    race.sourceSegment !== "open_racing" &&
    sourceTournamentId === null
  ) {
    throw new Error(
      "Authoritative tournament-stage evidence requires a tournament ID.",
    );
  }
  if (
    race.sourceEvidence === "authoritative" &&
    race.sourceSegment === "open_racing" &&
    (sourceTournamentId !== null || sourceBracketId !== null)
  ) {
    throw new Error(
      "Authoritative open-racing evidence cannot carry tournament identity.",
    );
  }

  const entryFeeAsset = normalizeAsset(race.entryFeeAsset);
  const entryFeeAmount =
    race.entryFeeAmount === null || race.entryFeeAmount === undefined
      ? null
      : normalizeExactDecimal(race.entryFeeAmount);
  if ((entryFeeAsset === null) !== (entryFeeAmount === null)) {
    throw new Error(
      "Race entry-fee asset and amount must be supplied together.",
    );
  }
  if (entryFeeAmount?.startsWith("-")) {
    throw new Error("Race entry-fee amount cannot be negative.");
  }

  const normalizedRules = rules.map(normalizeRule);
  if (
    new Set(normalizedRules.map((rule) => rule.ruleId)).size !==
    normalizedRules.length
  ) {
    throw new Error("Tournament stage rule IDs must be unique.");
  }

  if (
    race.sourceEvidence === "authoritative" &&
    race.sourceSegment === "open_racing"
  ) {
    return {
      raceId,
      segment: "open_racing",
      tournamentId: null,
      bracketId: null,
      status: "confirmed",
      confidence: "confirmed",
      matchedRuleIds: [],
      warnings: [],
      aggregateEligible: true,
      requiresReview: false,
      historicalSnapshotOnly: true,
      liveTournamentStateClaimAllowed: false,
    };
  }

  const matches = normalizedRules.filter((rule) =>
    matchesRule(race, occurredAt, entryFeeAsset, entryFeeAmount, rule),
  );
  const matchedRuleIds = matches
    .map((rule) => rule.ruleId)
    .sort((left, right) => left.localeCompare(right));

  if (race.sourceEvidence === "authoritative" && race.sourceSegment) {
    const sourceMatches = matches.filter((rule) =>
      sameSourceIdentity(race, rule),
    );
    if (sourceMatches.length === 1) {
      const [match] = sourceMatches;
      if (!match) throw new Error("Matched stage rule is unavailable.");
      if (match.ruleStatus === "uncertain") {
        return {
          raceId,
          segment: match.segment,
          tournamentId: match.tournamentId,
          bracketId: match.bracketId,
          status: "review_proposed",
          confidence: "inferred",
          matchedRuleIds,
          warnings: ["CONFIGURED_RULE_UNCERTAIN"],
          aggregateEligible: false,
          requiresReview: true,
          historicalSnapshotOnly: true,
          liveTournamentStateClaimAllowed: false,
        };
      }
      return {
        raceId,
        segment: match.segment,
        tournamentId: match.tournamentId,
        bracketId: match.bracketId,
        status: "confirmed",
        confidence: "confirmed",
        matchedRuleIds,
        warnings: [],
        aggregateEligible: true,
        requiresReview: false,
        historicalSnapshotOnly: true,
        liveTournamentStateClaimAllowed: false,
      };
    }
    return {
      raceId,
      segment: null,
      tournamentId: null,
      bracketId: null,
      status: "conflict",
      confidence: "none",
      matchedRuleIds,
      warnings: ["SOURCE_CONFIGURATION_CONFLICT"],
      aggregateEligible: false,
      requiresReview: true,
      historicalSnapshotOnly: true,
      liveTournamentStateClaimAllowed: false,
    };
  }

  if (matches.length > 1) {
    return {
      raceId,
      segment: null,
      tournamentId: null,
      bracketId: null,
      status: "ambiguous",
      confidence: "none",
      matchedRuleIds,
      warnings: ["AMBIGUOUS_CONFIGURED_MATCH"],
      aggregateEligible: false,
      requiresReview: true,
      historicalSnapshotOnly: true,
      liveTournamentStateClaimAllowed: false,
    };
  }

  const [match] = matches;
  if (match) {
    const warnings: TournamentRaceClassificationWarning[] = [];
    if (match.ruleStatus === "uncertain") {
      warnings.push("CONFIGURED_RULE_UNCERTAIN");
    }
    if (sourceTournamentId === null) {
      warnings.push("SOURCE_TOURNAMENT_ID_MISSING");
    }
    return {
      raceId,
      segment: match.segment,
      tournamentId: match.tournamentId,
      bracketId: match.bracketId,
      status: "review_proposed",
      confidence: "inferred",
      matchedRuleIds,
      warnings,
      aggregateEligible: false,
      requiresReview: true,
      historicalSnapshotOnly: true,
      liveTournamentStateClaimAllowed: false,
    };
  }

  return {
    raceId,
    segment: null,
    tournamentId: null,
    bracketId: null,
    status: "unclassified",
    confidence: "none",
    matchedRuleIds: [],
    warnings: ["UNCLASSIFIED_HISTORICAL_RACE"],
    aggregateEligible: false,
    requiresReview: true,
    historicalSnapshotOnly: true,
    liveTournamentStateClaimAllowed: false,
  };
}
