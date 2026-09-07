import {
  buildProLeagueLineupVersion,
  type ProLeagueLineupVersion,
} from "@/domain/pro-league-lineup-version";
import {
  proLeagueMaps,
  type ProLeagueMapAssignmentCommand,
  type ProLeagueMapId,
} from "@/domain/pro-league-maps";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";

type LineEvidenceStatus =
  | "winning_range"
  | "top_three_range"
  | "population_weak_provisional"
  | "hypothesis_only"
  | "stale_unavailable"
  | "no_exact_format_evidence";

export type ProLeagueDraftLineRecommendation = Readonly<{
  mapId: ProLeagueMapId;
  raceNumber: number;
  first16: boolean;
  raceType: string;
  distanceMetres: number;
  coreId: string;
  assignmentScope: "same_type_and_distance";
  sourceRaceNumber: number;
  evidenceStatus: LineEvidenceStatus;
  provisional: boolean;
  evidence: ProLeagueCandidateCellScore | null;
  reason: string;
}>;

export type ProLeagueDraftMapRecommendation = Readonly<{
  mapId: ProLeagueMapId;
  name: string;
  lineCount: 42;
  first16LineCount: 16;
  bulkAssignmentCount: number;
  winningRangeLineCount: number;
  topThreeRangeLineCount: number;
  provisionalLineCount: number;
  noExactEvidenceLineCount: number;
  lines: readonly ProLeagueDraftLineRecommendation[];
}>;

export type ProLeagueDraftLineupRecommendation = Readonly<{
  authority: "active_verified_exact_format_generation_and_rule_valid_roster";
  generationId: string;
  evidenceCutoffAt: string;
  rosterVersionId: string;
  selectionMethod: Readonly<{
    primaryEvidence: "same_bike_race_type_and_exact_distance";
    order: "population_band_then_intrinsic_time_consistency_sample_freshness";
    resultEvidenceRole: "supporting_only_not_ranked";
    missingOppositionQuality: "unknown_never_favourable";
    equalQualityTieBreak: "lower_mapped_line_load_then_core_id";
  }>;
  lineup: ProLeagueLineupVersion;
  assignmentCommands: readonly ProLeagueMapAssignmentCommand[];
  maps: readonly ProLeagueDraftMapRecommendation[];
  totals: Readonly<{
    lineCount: 168;
    first16LineCount: 64;
    bulkAssignmentCount: number;
    winningRangeLineCount: number;
    topThreeRangeLineCount: number;
    provisionalLineCount: number;
    noExactEvidenceLineCount: number;
  }>;
  operationalWarnings: readonly string[];
}>;

type SelectedCandidate = Readonly<{
  candidate: ProLeagueRosterCandidateScore;
  rosterPosition: number;
}>;

type CellChoice = Readonly<{
  selected: SelectedCandidate;
  evidence: ProLeagueCandidateCellScore | null;
}>;

const assessmentPower = Object.freeze({
  winning_range: 3,
  top_three_range: 2,
  outside_top_three_range: 1,
});

function key(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.trim().toLowerCase(), distanceMetres]);
}

function cellFor(
  candidate: ProLeagueRosterCandidateScore,
  raceType: string,
  distanceMetres: number,
): ProLeagueCandidateCellScore | null {
  return (
    candidate.cells.find(
      (cell) =>
        cell.raceType.toLowerCase() === raceType.toLowerCase() &&
        cell.distanceMetres === distanceMetres,
    ) ?? null
  );
}

function compareRankedCells(
  left: CellChoice,
  right: CellChoice,
  lineLoad: ReadonlyMap<string, number>,
): number {
  const a = left.evidence!;
  const b = right.evidence!;
  return (
    assessmentPower[b.benchmarkAssessment] -
      assessmentPower[a.benchmarkAssessment] ||
    b.medianVersusTopThreeBasisPoints - a.medianVersusTopThreeBasisPoints ||
    (a.consistencyVersusTopThreeBasisPoints ?? Number.MAX_SAFE_INTEGER) -
      (b.consistencyVersusTopThreeBasisPoints ?? Number.MAX_SAFE_INTEGER) ||
    a.medianMilliseconds - b.medianMilliseconds ||
    a.trimmedMeanMilliseconds - b.trimmedMeanMilliseconds ||
    a.standardDeviationMilliseconds - b.standardDeviationMilliseconds ||
    b.raceCount - a.raceCount ||
    Number(b.freshness === "current") - Number(a.freshness === "current") ||
    (lineLoad.get(left.selected.candidate.core.coreId) ?? 0) -
      (lineLoad.get(right.selected.candidate.core.coreId) ?? 0) ||
    left.selected.rosterPosition - right.selected.rosterPosition ||
    left.selected.candidate.core.coreId.localeCompare(
      right.selected.candidate.core.coreId,
    )
  );
}

function compareFallback(
  left: CellChoice,
  right: CellChoice,
  lineLoad: ReadonlyMap<string, number>,
): number {
  const evidencePower = (choice: CellChoice) =>
    choice.evidence?.evidenceUse === "hypothesis_only"
      ? 2
      : choice.evidence?.evidenceUse === "stale_unavailable"
        ? 1
        : 0;
  return (
    evidencePower(right) - evidencePower(left) ||
    (lineLoad.get(left.selected.candidate.core.coreId) ?? 0) -
      (lineLoad.get(right.selected.candidate.core.coreId) ?? 0) ||
    left.selected.rosterPosition - right.selected.rosterPosition ||
    left.selected.candidate.core.coreId.localeCompare(
      right.selected.candidate.core.coreId,
    )
  );
}

function chooseCell(
  selected: readonly SelectedCandidate[],
  raceType: string,
  distanceMetres: number,
  lineLoad: ReadonlyMap<string, number>,
): CellChoice {
  const choices = selected.map((value) => ({
    selected: value,
    evidence: cellFor(value.candidate, raceType, distanceMetres),
  }));
  const ranked = choices
    .filter(({ evidence }) => evidence?.evidenceUse === "ranked")
    .sort((left, right) => compareRankedCells(left, right, lineLoad));
  return (
    ranked[0] ??
    choices.sort((left, right) => compareFallback(left, right, lineLoad))[0]!
  );
}

function evidenceStatus(choice: CellChoice): LineEvidenceStatus {
  const cell = choice.evidence;
  if (cell === null) return "no_exact_format_evidence";
  if (cell.evidenceUse === "hypothesis_only") return "hypothesis_only";
  if (cell.evidenceUse === "stale_unavailable") return "stale_unavailable";
  if (cell.benchmarkAssessment === "winning_range") return "winning_range";
  if (cell.benchmarkAssessment === "top_three_range") return "top_three_range";
  return "population_weak_provisional";
}

function reason(choice: CellChoice, status: LineEvidenceStatus): string {
  const cell = choice.evidence;
  if (status === "no_exact_format_evidence") {
    return "No same-type-plus-distance evidence exists for a rostered Core. Structural fallback only; acquire Discovery evidence before lock.";
  }
  if (status === "hypothesis_only") {
    return "Exact-format evidence is below the minimally analytical sample. Hypothesis only; test before lock.";
  }
  if (status === "stale_unavailable") {
    return "Exact-format evidence is stale or unavailable for ranking. Refresh or test before lock.";
  }
  if (status === "population_weak_provisional") {
    return "Best rostered exact-format evidence remains outside the population Top-3 range. Provisional and test before lock.";
  }
  return `${status === "winning_range" ? "Winning-range" : "Top-3-range"} same-type-plus-distance evidence from ${cell!.raceCount} accepted race(s); selection used intrinsic time and consistency, with outcomes supporting only.`;
}

function count(
  lines: readonly ProLeagueDraftLineRecommendation[],
  status: LineEvidenceStatus,
): number {
  return lines.filter(({ evidenceStatus: value }) => value === status).length;
}

export function buildProLeagueDraftLineupRecommendation(
  input: Readonly<{
    roster: ProLeagueDraftRosterRecommendation;
    lineupVersionId: string;
    versionNumber: number;
  }>,
): ProLeagueDraftLineupRecommendation {
  const draftRoster = input.roster.draftRoster;
  if (draftRoster === null || draftRoster.audit.readiness !== "compliant") {
    throw new Error(
      "Pro League lineup recommendation requires a compliant draft roster.",
    );
  }
  if (
    !draftRoster.members.every(
      ({ evidence }) => evidence.generationId === input.roster.generationId,
    ) ||
    input.roster.evidenceCutoffAt !== draftRoster.evidenceCutoffAt
  ) {
    throw new Error("Pro League roster and evidence generation do not align.");
  }
  const rosterPosition = new Map(
    draftRoster.rosteredCoreIds.map((coreId, index) => [coreId, index]),
  );
  const selected = input.roster.candidates
    .filter(({ core }) => rosterPosition.has(core.coreId))
    .map((candidate) => ({
      candidate,
      rosterPosition: rosterPosition.get(candidate.core.coreId)!,
    }));
  if (selected.length !== draftRoster.rosteredCoreIds.length) {
    throw new Error("Pro League roster candidates are incomplete.");
  }

  const lineLoad = new Map<string, number>();
  const assignmentCommands: ProLeagueMapAssignmentCommand[] = [];
  const maps = proLeagueMaps.map((map): ProLeagueDraftMapRecommendation => {
    const choiceByCell = new Map<
      string,
      CellChoice & Readonly<{ sourceRaceNumber: number }>
    >();
    for (const race of map.races) {
      const cellKey = key(race.raceType, race.distanceMetres);
      if (choiceByCell.has(cellKey)) continue;
      const choice = chooseCell(
        selected,
        race.raceType,
        race.distanceMetres,
        lineLoad,
      );
      const repeatedLineCount = map.races.filter(
        (value) =>
          value.raceType === race.raceType &&
          value.distanceMetres === race.distanceMetres,
      ).length;
      lineLoad.set(
        choice.selected.candidate.core.coreId,
        (lineLoad.get(choice.selected.candidate.core.coreId) ?? 0) +
          repeatedLineCount,
      );
      choiceByCell.set(cellKey, {
        ...choice,
        sourceRaceNumber: race.raceNumber,
      });
      assignmentCommands.push({
        mapId: map.mapId,
        raceNumber: race.raceNumber,
        coreId: choice.selected.candidate.core.coreId,
        scope: "same_type_and_distance",
      });
    }
    const lines = map.races.map((race): ProLeagueDraftLineRecommendation => {
      const choice = choiceByCell.get(key(race.raceType, race.distanceMetres))!;
      const status = evidenceStatus(choice);
      return Object.freeze({
        mapId: map.mapId,
        raceNumber: race.raceNumber,
        first16: race.raceNumber <= 16,
        raceType: race.raceType,
        distanceMetres: race.distanceMetres,
        coreId: choice.selected.candidate.core.coreId,
        assignmentScope: "same_type_and_distance",
        sourceRaceNumber: choice.sourceRaceNumber,
        evidenceStatus: status,
        provisional: status !== "winning_range" && status !== "top_three_range",
        evidence: choice.evidence,
        reason: reason(choice, status),
      });
    });
    return Object.freeze({
      mapId: map.mapId,
      name: map.name,
      lineCount: 42,
      first16LineCount: 16,
      bulkAssignmentCount: choiceByCell.size,
      winningRangeLineCount: count(lines, "winning_range"),
      topThreeRangeLineCount: count(lines, "top_three_range"),
      provisionalLineCount: lines.filter(({ provisional }) => provisional)
        .length,
      noExactEvidenceLineCount: count(lines, "no_exact_format_evidence"),
      lines: Object.freeze(lines),
    });
  });
  const allLines = maps.flatMap(({ lines }) => lines);
  const lineup = buildProLeagueLineupVersion({
    lineupVersionId: input.lineupVersionId,
    versionNumber: input.versionNumber,
    rosterVersionId: draftRoster.rosterVersionId,
    rosterCoreIds: draftRoster.rosteredCoreIds,
    rationale:
      "Complete four-map draft from active same-Bike-race-type-plus-exact-distance evidence. Provisional cells require review before lock.",
    assignments: assignmentCommands,
  });
  return Object.freeze({
    authority: "active_verified_exact_format_generation_and_rule_valid_roster",
    generationId: input.roster.generationId,
    evidenceCutoffAt: input.roster.evidenceCutoffAt,
    rosterVersionId: draftRoster.rosterVersionId,
    selectionMethod: Object.freeze({
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      order: "population_band_then_intrinsic_time_consistency_sample_freshness",
      resultEvidenceRole: "supporting_only_not_ranked",
      missingOppositionQuality: "unknown_never_favourable",
      equalQualityTieBreak: "lower_mapped_line_load_then_core_id",
    }),
    lineup,
    assignmentCommands: Object.freeze(assignmentCommands),
    maps: Object.freeze(maps),
    totals: Object.freeze({
      lineCount: 168,
      first16LineCount: 64,
      bulkAssignmentCount: assignmentCommands.length,
      winningRangeLineCount: count(allLines, "winning_range"),
      topThreeRangeLineCount: count(allLines, "top_three_range"),
      provisionalLineCount: allLines.filter(({ provisional }) => provisional)
        .length,
      noExactEvidenceLineCount: count(allLines, "no_exact_format_evidence"),
    }),
    operationalWarnings: Object.freeze([
      "This is a draft only. It does not persist or submit a map assignment and does not create a match lock.",
      "Every repeated race type plus exact distance within a map uses the supported bulk-assignment scope; single-race overrides remain available for owner review.",
      "Population-weak, hypothesis-only, stale and missing exact-format lines are provisional and must be tested or refreshed before lock.",
      "Miracles is fully mapped for contingency coverage; map pick and denial remain match-specific owner decisions.",
      "Current ageing totals and protected Tournament-Core status remain outside this exact-format generation and require review before participation.",
    ]),
  });
}
