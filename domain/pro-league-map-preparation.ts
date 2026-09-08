import type {
  ProLeagueDraftLineRecommendation,
  ProLeagueDraftLineupRecommendation,
  ProLeagueDraftMapRecommendation,
} from "@/domain/pro-league-lineup-recommendation";
import type { ProLeagueMapId } from "@/domain/pro-league-maps";

type MapReadiness = "supported" | "provisional" | "evidence_gap";

export type ProLeagueMapPreparationAssessment = Readonly<{
  mapId: ProLeagueMapId;
  name: string;
  readiness: MapReadiness;
  first16: Readonly<{
    winningRangeLineCount: number;
    topThreeRangeLineCount: number;
    provisionalLineCount: number;
    noExactEvidenceLineCount: number;
  }>;
  fullMap: Readonly<{
    winningRangeLineCount: number;
    topThreeRangeLineCount: number;
    provisionalLineCount: number;
    noExactEvidenceLineCount: number;
  }>;
}>;

export type ProLeagueMapPreparationPlan = Readonly<{
  authority: "verified_owned_exact_format_lineup_only";
  generationId: string;
  evidenceCutoffAt: string;
  homePreferenceOrder: readonly ProLeagueMapId[];
  defensivePreparationOrder: readonly ProLeagueMapId[];
  assessments: readonly ProLeagueMapPreparationAssessment[];
  opponentDenialStatus: "held_without_opponent_exact_format_evidence";
  headToHeadStatus: "unavailable";
  matchActionAllowed: false;
  selectionMethod: Readonly<{
    primaryWindow: "first_16_race_points";
    secondaryWindow: "complete_42_line_map";
    order: "fewest_evidence_gaps_then_fewest_provisional_then_most_population_supported";
    resultEvidenceRole: "not_used";
    missingOppositionQuality: "unknown_never_favourable";
  }>;
  warnings: readonly string[];
}>;

const expectedMapIds: readonly ProLeagueMapId[] = Object.freeze([
  "map-1",
  "map-2",
  "map-3",
  "map-4",
]);

function count(
  lines: readonly ProLeagueDraftLineRecommendation[],
  status: "winning_range" | "top_three_range" | "no_exact_format_evidence",
): number {
  return lines.filter(({ evidenceStatus }) => evidenceStatus === status).length;
}

function window(
  lines: readonly ProLeagueDraftLineRecommendation[],
): ProLeagueMapPreparationAssessment["first16"] {
  return Object.freeze({
    winningRangeLineCount: count(lines, "winning_range"),
    topThreeRangeLineCount: count(lines, "top_three_range"),
    provisionalLineCount: lines.filter(({ provisional }) => provisional).length,
    noExactEvidenceLineCount: count(lines, "no_exact_format_evidence"),
  });
}

function validateMap(map: ProLeagueDraftMapRecommendation): void {
  if (
    map.lineCount !== 42 ||
    map.first16LineCount !== 16 ||
    map.lines.length !== 42 ||
    map.lines.some(
      (line, index) =>
        line.mapId !== map.mapId ||
        line.raceNumber !== index + 1 ||
        line.first16 !== line.raceNumber <= 16,
    )
  ) {
    throw new Error("Pro League map preparation requires a complete map.");
  }
}

function assess(
  map: ProLeagueDraftMapRecommendation,
): ProLeagueMapPreparationAssessment {
  validateMap(map);
  const first16 = window(map.lines.slice(0, 16));
  const fullMap = window(map.lines);
  const readiness: MapReadiness =
    fullMap.noExactEvidenceLineCount > 0
      ? "evidence_gap"
      : fullMap.provisionalLineCount > 0
        ? "provisional"
        : "supported";
  return Object.freeze({
    mapId: map.mapId,
    name: map.name,
    readiness,
    first16,
    fullMap,
  });
}

function compareStrongest(
  left: ProLeagueMapPreparationAssessment,
  right: ProLeagueMapPreparationAssessment,
): number {
  return (
    left.first16.noExactEvidenceLineCount -
      right.first16.noExactEvidenceLineCount ||
    left.first16.provisionalLineCount - right.first16.provisionalLineCount ||
    right.first16.winningRangeLineCount - left.first16.winningRangeLineCount ||
    right.first16.topThreeRangeLineCount -
      left.first16.topThreeRangeLineCount ||
    left.fullMap.noExactEvidenceLineCount -
      right.fullMap.noExactEvidenceLineCount ||
    left.fullMap.provisionalLineCount - right.fullMap.provisionalLineCount ||
    right.fullMap.winningRangeLineCount - left.fullMap.winningRangeLineCount ||
    right.fullMap.topThreeRangeLineCount -
      left.fullMap.topThreeRangeLineCount ||
    left.mapId.localeCompare(right.mapId)
  );
}

function compareWeakest(
  left: ProLeagueMapPreparationAssessment,
  right: ProLeagueMapPreparationAssessment,
): number {
  const strongest = compareStrongest(left, right);
  return strongest === 0 ? left.mapId.localeCompare(right.mapId) : -strongest;
}

export function buildProLeagueMapPreparationPlan(
  lineup: ProLeagueDraftLineupRecommendation,
): ProLeagueMapPreparationPlan {
  if (
    lineup.authority !==
      "active_verified_exact_format_generation_and_rule_valid_roster" ||
    lineup.maps.length !== expectedMapIds.length ||
    !expectedMapIds.every((mapId) =>
      lineup.maps.some((map) => map.mapId === mapId),
    ) ||
    new Set(lineup.maps.map(({ mapId }) => mapId)).size !==
      expectedMapIds.length ||
    lineup.totals.lineCount !== 168 ||
    lineup.totals.first16LineCount !== 64
  ) {
    throw new Error(
      "Pro League map preparation requires one complete verified four-map lineup.",
    );
  }
  const assessments = Object.freeze(lineup.maps.map(assess));
  return Object.freeze({
    authority: "verified_owned_exact_format_lineup_only",
    generationId: lineup.generationId,
    evidenceCutoffAt: lineup.evidenceCutoffAt,
    homePreferenceOrder: Object.freeze(
      [...assessments].sort(compareStrongest).map(({ mapId }) => mapId),
    ),
    defensivePreparationOrder: Object.freeze(
      [...assessments].sort(compareWeakest).map(({ mapId }) => mapId),
    ),
    assessments,
    opponentDenialStatus: "held_without_opponent_exact_format_evidence",
    headToHeadStatus: "unavailable",
    matchActionAllowed: false,
    selectionMethod: Object.freeze({
      primaryWindow: "first_16_race_points",
      secondaryWindow: "complete_42_line_map",
      order:
        "fewest_evidence_gaps_then_fewest_provisional_then_most_population_supported",
      resultEvidenceRole: "not_used",
      missingOppositionQuality: "unknown_never_favourable",
    }),
    warnings: Object.freeze([
      "Home preference compares owned population-relative exact-format coverage only; it is not an opponent-specific prediction.",
      "Defensive preparation starts with the weakest owned-evidence map because an opponent may target that gap.",
      "Map denial and head-to-head recommendations remain held until authoritative opponent identities and exact-format evidence are available.",
      "This plan cannot lock, submit or change a lineup or match selection.",
    ]),
  });
}
