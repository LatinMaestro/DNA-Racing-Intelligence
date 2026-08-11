export const tournamentModes = ["bike", "car", "horse"] as const;
export type TournamentMode = (typeof tournamentModes)[number];

export const tournamentRankingMetrics = [
  "fastest_single_time",
  "median_time",
  "average_time",
  "points",
  "wins",
  "top_x_finishes",
  "best_finish",
  "custom",
] as const;
export type TournamentRankingMetric = (typeof tournamentRankingMetrics)[number];

export type TournamentRuleEvidenceStatus = "confirmed" | "uncertain";
export type TournamentQualifyingRaceSemantics = "shared" | "separate";
export type TournamentDiscoveryRelevance = "eligible" | "priority";
export type TournamentJson =
  | null
  | boolean
  | number
  | string
  | readonly TournamentJson[]
  | Readonly<{ [key: string]: TournamentJson }>;

export type TournamentFNumberRange = Readonly<{
  minimum: number;
  maximum: number;
}>;

export type TournamentEligibilityGroup = Readonly<{
  id: string;
  label: string;
  breeds: readonly string[];
  classes: readonly string[];
  elements: readonly string[];
  fNumbers: readonly number[];
  fNumberRanges: readonly TournamentFNumberRange[];
}>;

export type TournamentLeaderboardGroup = Readonly<{
  id: string;
  label: string;
}>;

export type TournamentQualificationTarget =
  | Readonly<{ kind: "count"; value: number }>
  | Readonly<{ kind: "percentage"; value: string }>;

export type TournamentCampaignAction =
  | Readonly<{
      kind: "configured";
      action: string;
      ownerAcknowledgedAt: string;
      evidence: string;
    }>
  | Readonly<{
      kind: "review_only_free_text";
      action: string;
      ownerAcknowledgedAt: string | null;
      evidence: string | null;
    }>
  | null;

export type TournamentRuleConfiguration = Readonly<{
  tournamentId: string;
  tournamentLabel: string;
  seasonLabel: string;
  qualificationStartsAt: string | null;
  qualificationEndsAt: string | null;
  bracketId: string;
  splitLabel: string;
  mode: TournamentMode;
  eligibleDistancesMetres: readonly number[];
  gateCount: number;
  entryFee: Readonly<{ amount: string; asset: string }>;
  raceFormat: string;
  eligibility: Readonly<{
    breeds: readonly string[];
    classes: readonly string[];
    elements: readonly string[];
    fNumbers: readonly number[];
    fNumberRanges: readonly TournamentFNumberRange[];
    groups: readonly TournamentEligibilityGroup[];
  }>;
  leaderboard: Readonly<{
    splitDimension: string;
    groups: readonly TournamentLeaderboardGroup[];
    qualifyingRaceSemantics: TournamentQualifyingRaceSemantics;
  }>;
  qualification: Readonly<{
    minimumRaceCount: number;
    target: TournamentQualificationTarget;
    rankingMetric: TournamentRankingMetric;
    topFinishPosition: number | null;
    pointsTable: Readonly<Record<string, string>>;
    customScoringConfiguration: Readonly<Record<string, TournamentJson>>;
  }>;
  discoveryRelevance: TournamentDiscoveryRelevance;
  evidence: Readonly<{
    status: TournamentRuleEvidenceStatus;
    notes: string;
    sourceEvidence: string;
    provenance: Readonly<Record<string, TournamentJson>>;
  }>;
  campaignAction: TournamentCampaignAction;
  configurationVersion: string;
  candidateSnapshotVersion: string | null;
  updatedAt: string;
}>;

export type TournamentConfigurationReviewReason =
  | "CANDIDATE_SNAPSHOT_UNBOUND"
  | "CUSTOM_SCORING_CONFIGURATION_MISSING"
  | "ENTRY_FEE_RULE_INCOMPLETE"
  | "FREE_TEXT_CAMPAIGN_ACTION"
  | "LEADERBOARD_GROUPS_MISSING"
  | "OWNER_ACKNOWLEDGEMENT_MISSING"
  | "POINTS_TABLE_MISSING"
  | "QUALIFICATION_WINDOW_INCOMPLETE"
  | "RACE_FORMAT_RULE_INCOMPLETE"
  | "RULE_EVIDENCE_UNCERTAIN"
  | "SEASON_RULE_INCOMPLETE"
  | "SOURCE_EVIDENCE_MISSING";

export type TournamentConfigurationAuthority = Readonly<{
  status: "authoritative" | "review_required";
  reasons: readonly TournamentConfigurationReviewReason[];
  actionableRecommendationAllowed: boolean;
}>;

const ID_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,99}$/;
const VERSION_PATTERN = /^[A-Za-z0-9][A-Za-z0-9._:-]{0,127}$/;
const NON_NEGATIVE_DECIMAL = /^(?:0|[1-9]\d*)(?:\.\d+)?$/;

function required(value: string, label: string, maximum = 200): string {
  if (typeof value !== "string") throw new Error(`${label} is required.`);
  const normalized = value.trim();
  if (normalized === "" || normalized.length > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function identifier(value: string, label: string): string {
  const normalized = required(value, label, 100);
  if (!ID_PATTERN.test(normalized)) throw new Error(`${label} is invalid.`);
  return normalized;
}

function version(value: string, label: string): string {
  const normalized = required(value, label, 128);
  if (!VERSION_PATTERN.test(normalized)) {
    throw new Error(`${label} is invalid.`);
  }
  return normalized;
}

function timestamp(value: string | null, label: string): string | null {
  if (value === null) return null;
  if (typeof value !== "string") throw new Error(`${label} is invalid.`);
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`${label} must be a canonical timestamp.`);
  }
  return value;
}

function requiredTimestamp(value: string, label: string): string {
  const normalized = timestamp(value, label);
  if (normalized === null) throw new Error(`${label} is required.`);
  return normalized;
}

function positiveInteger(value: number, label: string, maximum = 100_000) {
  if (!Number.isSafeInteger(value) || value <= 0 || value > maximum) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function uniqueStrings(
  values: readonly string[],
  label: string,
): readonly string[] {
  if (!Array.isArray(values)) throw new Error(`${label} is invalid.`);
  const normalized = values.map((value) => required(value, label, 100));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must be unique.`);
  }
  return [...normalized].sort((left, right) => left.localeCompare(right));
}

function uniquePositiveIntegers(
  values: readonly number[],
  label: string,
): readonly number[] {
  if (!Array.isArray(values)) throw new Error(`${label} is invalid.`);
  const normalized = values.map((value) => positiveInteger(value, label));
  if (new Set(normalized).size !== normalized.length) {
    throw new Error(`${label} must be unique.`);
  }
  return [...normalized].sort((left, right) => left - right);
}

function fNumberRanges(
  values: readonly TournamentFNumberRange[],
  label: string,
): readonly TournamentFNumberRange[] {
  if (!Array.isArray(values)) throw new Error(`${label} is invalid.`);
  const normalized = values
    .map((range) => {
      const minimum = positiveInteger(range.minimum, `${label} minimum`);
      const maximum = positiveInteger(range.maximum, `${label} maximum`);
      if (minimum > maximum) throw new Error(`${label} is reversed.`);
      return { minimum, maximum };
    })
    .sort(
      (left, right) =>
        left.minimum - right.minimum || left.maximum - right.maximum,
    );
  normalized.forEach((range, index) => {
    const previous = normalized[index - 1];
    if (previous && range.minimum <= previous.maximum) {
      throw new Error(`${label} must not overlap.`);
    }
  });
  return normalized;
}

function decimal(value: string, label: string): string {
  const normalized = required(value, label, 120);
  if (!NON_NEGATIVE_DECIMAL.test(normalized)) {
    throw new Error(`${label} must be an exact non-negative decimal.`);
  }
  const [integer, fraction] = normalized.split(".");
  const trimmedFraction = fraction?.replace(/0+$/, "") ?? "";
  return trimmedFraction === "" ? integer! : `${integer}.${trimmedFraction}`;
}

function percentage(value: string): string {
  const normalized = decimal(value, "Qualification percentage");
  if (normalized === "0") {
    throw new Error("Qualification percentage must be greater than zero.");
  }
  const [integer, fraction] = normalized.split(".");
  const whole = BigInt(integer!);
  if (whole > 100n || (whole === 100n && fraction !== undefined)) {
    throw new Error("Qualification percentage cannot exceed 100.");
  }
  return normalized;
}

function normalizePointsTable(
  table: Readonly<Record<string, string>>,
): Readonly<Record<string, string>> {
  if (typeof table !== "object" || table === null || Array.isArray(table)) {
    throw new Error("Tournament points table is invalid.");
  }
  return Object.fromEntries(
    Object.entries(table)
      .map(([position, points]) => {
        if (!/^[1-9]\d*$/.test(position)) {
          throw new Error("Tournament points-table position is invalid.");
        }
        return [position, decimal(points, "Tournament points")] as const;
      })
      .sort(([left], [right]) => Number(left) - Number(right)),
  );
}

function jsonRecord(
  value: Readonly<Record<string, TournamentJson>>,
  label: string,
): Readonly<Record<string, TournamentJson>> {
  if (typeof value !== "object" || value === null || Array.isArray(value)) {
    throw new Error(`${label} is invalid.`);
  }
  JSON.stringify(value);
  return Object.fromEntries(
    Object.entries(value).sort(([left], [right]) => left.localeCompare(right)),
  );
}

function normalizeLeaderboardGroups(
  groups: readonly TournamentLeaderboardGroup[],
): readonly TournamentLeaderboardGroup[] {
  if (!Array.isArray(groups)) {
    throw new Error("Tournament leaderboard groups are invalid.");
  }
  const normalized = groups.map((group) => ({
    id: identifier(group.id, "Tournament leaderboard group ID"),
    label: required(group.label, "Tournament leaderboard group label"),
  }));
  if (
    new Set(normalized.map(({ id }) => id)).size !== normalized.length ||
    new Set(normalized.map(({ label }) => label)).size !== normalized.length
  ) {
    throw new Error("Tournament leaderboard groups must be unambiguous.");
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

function normalizeEligibilityGroups(
  groups: readonly TournamentEligibilityGroup[],
): readonly TournamentEligibilityGroup[] {
  if (!Array.isArray(groups)) {
    throw new Error("Tournament eligibility groups are invalid.");
  }
  const normalized = groups.map((group) => ({
    id: identifier(group.id, "Tournament eligibility group ID"),
    label: required(group.label, "Tournament eligibility group label"),
    breeds: uniqueStrings(group.breeds, "Tournament group breeds"),
    classes: uniqueStrings(group.classes, "Tournament group classes"),
    elements: uniqueStrings(group.elements, "Tournament group elements"),
    fNumbers: uniquePositiveIntegers(
      group.fNumbers,
      "Tournament group F-numbers",
    ),
    fNumberRanges: fNumberRanges(
      group.fNumberRanges,
      "Tournament group F-number ranges",
    ),
  }));
  if (
    new Set(normalized.map(({ id }) => id)).size !== normalized.length ||
    new Set(normalized.map(({ label }) => label)).size !== normalized.length
  ) {
    throw new Error("Tournament eligibility groups must be unambiguous.");
  }
  return normalized.sort((left, right) => left.id.localeCompare(right.id));
}

export function normalizeTournamentRuleConfiguration(
  input: TournamentRuleConfiguration,
): TournamentRuleConfiguration {
  const qualificationStartsAt = timestamp(
    input.qualificationStartsAt,
    "Qualification start",
  );
  const qualificationEndsAt = timestamp(
    input.qualificationEndsAt,
    "Qualification end",
  );
  if (
    qualificationStartsAt !== null &&
    qualificationEndsAt !== null &&
    Date.parse(qualificationStartsAt) > Date.parse(qualificationEndsAt)
  ) {
    throw new Error("Tournament qualification window is reversed.");
  }
  if (!tournamentModes.includes(input.mode)) {
    throw new Error("Tournament mode is invalid.");
  }
  if (!["eligible", "priority"].includes(input.discoveryRelevance)) {
    throw new Error("Tournament Discovery relevance is invalid.");
  }
  if (
    !["shared", "separate"].includes(input.leaderboard.qualifyingRaceSemantics)
  ) {
    throw new Error("Tournament qualifying-race semantics are invalid.");
  }
  if (!["confirmed", "uncertain"].includes(input.evidence.status)) {
    throw new Error("Tournament rule evidence status is invalid.");
  }
  if (!tournamentRankingMetrics.includes(input.qualification.rankingMetric)) {
    throw new Error("Tournament ranking metric is invalid.");
  }

  const target: TournamentQualificationTarget =
    input.qualification.target.kind === "count"
      ? {
          kind: "count",
          value: positiveInteger(
            input.qualification.target.value,
            "Tournament qualification count",
          ),
        }
      : input.qualification.target.kind === "percentage"
        ? {
            kind: "percentage",
            value: percentage(input.qualification.target.value),
          }
        : (() => {
            throw new Error("Tournament qualification target is invalid.");
          })();

  const topFinishPosition =
    input.qualification.topFinishPosition === null
      ? null
      : positiveInteger(
          input.qualification.topFinishPosition,
          "Tournament top-X position",
        );
  if (
    (input.qualification.rankingMetric === "top_x_finishes") !==
    (topFinishPosition !== null)
  ) {
    throw new Error("Tournament top-X metric requires exactly one X position.");
  }

  const campaignAction =
    input.campaignAction === null
      ? null
      : input.campaignAction.kind === "configured"
        ? {
            kind: "configured" as const,
            action: required(input.campaignAction.action, "Campaign action"),
            ownerAcknowledgedAt: requiredTimestamp(
              input.campaignAction.ownerAcknowledgedAt,
              "Campaign action owner acknowledgement",
            ),
            evidence: required(
              input.campaignAction.evidence,
              "Campaign action evidence",
              2_000,
            ),
          }
        : input.campaignAction.kind === "review_only_free_text"
          ? {
              kind: "review_only_free_text" as const,
              action: required(input.campaignAction.action, "Campaign action"),
              ownerAcknowledgedAt: timestamp(
                input.campaignAction.ownerAcknowledgedAt,
                "Campaign action owner acknowledgement",
              ),
              evidence:
                input.campaignAction.evidence === null
                  ? null
                  : required(
                      input.campaignAction.evidence,
                      "Campaign action evidence",
                      2_000,
                    ),
            }
          : (() => {
              throw new Error("Tournament campaign action is invalid.");
            })();

  return {
    tournamentId: identifier(input.tournamentId, "Tournament ID"),
    tournamentLabel: required(input.tournamentLabel, "Tournament label"),
    seasonLabel: required(input.seasonLabel, "Tournament season"),
    qualificationStartsAt,
    qualificationEndsAt,
    bracketId: identifier(input.bracketId, "Tournament bracket ID"),
    splitLabel: required(input.splitLabel, "Tournament split label"),
    mode: input.mode,
    eligibleDistancesMetres: uniquePositiveIntegers(
      input.eligibleDistancesMetres,
      "Tournament eligible distances",
    ),
    gateCount: positiveInteger(input.gateCount, "Tournament gate count", 100),
    entryFee: {
      amount: decimal(input.entryFee.amount, "Tournament entry fee"),
      asset: required(input.entryFee.asset, "Tournament entry-fee asset", 40),
    },
    raceFormat: required(input.raceFormat, "Tournament race format"),
    eligibility: {
      breeds: uniqueStrings(
        input.eligibility.breeds,
        "Tournament eligible breeds",
      ),
      classes: uniqueStrings(
        input.eligibility.classes,
        "Tournament eligible classes",
      ),
      elements: uniqueStrings(
        input.eligibility.elements,
        "Tournament eligible elements",
      ),
      fNumbers: uniquePositiveIntegers(
        input.eligibility.fNumbers,
        "Tournament eligible F-numbers",
      ),
      fNumberRanges: fNumberRanges(
        input.eligibility.fNumberRanges,
        "Tournament eligible F-number ranges",
      ),
      groups: normalizeEligibilityGroups(input.eligibility.groups),
    },
    leaderboard: {
      splitDimension: required(
        input.leaderboard.splitDimension,
        "Tournament leaderboard split dimension",
        100,
      ),
      groups: normalizeLeaderboardGroups(input.leaderboard.groups),
      qualifyingRaceSemantics: input.leaderboard.qualifyingRaceSemantics,
    },
    qualification: {
      minimumRaceCount: positiveInteger(
        input.qualification.minimumRaceCount,
        "Tournament minimum race count",
      ),
      target,
      rankingMetric: input.qualification.rankingMetric,
      topFinishPosition,
      pointsTable: normalizePointsTable(input.qualification.pointsTable),
      customScoringConfiguration: jsonRecord(
        input.qualification.customScoringConfiguration,
        "Tournament custom scoring configuration",
      ),
    },
    discoveryRelevance: input.discoveryRelevance,
    evidence: {
      status: input.evidence.status,
      notes: input.evidence.notes.trim(),
      sourceEvidence: input.evidence.sourceEvidence.trim(),
      provenance: jsonRecord(
        input.evidence.provenance,
        "Tournament provenance",
      ),
    },
    campaignAction,
    configurationVersion: version(
      input.configurationVersion,
      "Tournament configuration version",
    ),
    candidateSnapshotVersion:
      input.candidateSnapshotVersion === null
        ? null
        : version(
            input.candidateSnapshotVersion,
            "Tournament candidate snapshot version",
          ),
    updatedAt: requiredTimestamp(
      input.updatedAt,
      "Tournament update timestamp",
    ),
  };
}

export function assessTournamentConfigurationAuthority(
  input: TournamentRuleConfiguration,
): TournamentConfigurationAuthority {
  const configuration = normalizeTournamentRuleConfiguration(input);
  const reasons = new Set<TournamentConfigurationReviewReason>();
  if (
    configuration.qualificationStartsAt === null ||
    configuration.qualificationEndsAt === null
  ) {
    reasons.add("QUALIFICATION_WINDOW_INCOMPLETE");
  }
  if (configuration.seasonLabel.toLowerCase() === "unspecified") {
    reasons.add("SEASON_RULE_INCOMPLETE");
  }
  if (configuration.entryFee.asset.toLowerCase() === "unspecified") {
    reasons.add("ENTRY_FEE_RULE_INCOMPLETE");
  }
  if (configuration.raceFormat.toLowerCase() === "unspecified") {
    reasons.add("RACE_FORMAT_RULE_INCOMPLETE");
  }
  if (configuration.evidence.status === "uncertain") {
    reasons.add("RULE_EVIDENCE_UNCERTAIN");
  }
  if (configuration.evidence.sourceEvidence === "") {
    reasons.add("SOURCE_EVIDENCE_MISSING");
  }
  if (
    configuration.leaderboard.splitDimension !== "none" &&
    configuration.leaderboard.groups.length === 0
  ) {
    reasons.add("LEADERBOARD_GROUPS_MISSING");
  }
  if (
    configuration.qualification.rankingMetric === "points" &&
    Object.keys(configuration.qualification.pointsTable).length === 0
  ) {
    reasons.add("POINTS_TABLE_MISSING");
  }
  if (
    configuration.qualification.rankingMetric === "custom" &&
    Object.keys(configuration.qualification.customScoringConfiguration)
      .length === 0
  ) {
    reasons.add("CUSTOM_SCORING_CONFIGURATION_MISSING");
  }
  if (
    configuration.candidateSnapshotVersion === null ||
    configuration.candidateSnapshotVersion === "snapshot-unbound"
  ) {
    reasons.add("CANDIDATE_SNAPSHOT_UNBOUND");
  }
  if (configuration.campaignAction?.kind === "review_only_free_text") {
    reasons.add("FREE_TEXT_CAMPAIGN_ACTION");
    if (
      configuration.campaignAction.ownerAcknowledgedAt === null ||
      configuration.campaignAction.evidence === null
    ) {
      reasons.add("OWNER_ACKNOWLEDGEMENT_MISSING");
    }
  }
  const ordered = [...reasons].sort();
  return {
    status: ordered.length === 0 ? "authoritative" : "review_required",
    reasons: ordered,
    actionableRecommendationAllowed: ordered.length === 0,
  };
}
