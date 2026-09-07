import {
  assertValidProLeagueExactFormatEvidence,
  buildProLeagueCoverageGaps,
  type ProLeagueCoverageGap,
  type ProLeagueExactFormatEvidence,
  type ProLeagueMatchupCore,
  type ProLeagueMatchupVault,
} from "@/domain/pro-league-matchup";
import { proLeagueMaps, type ProLeagueMapId } from "@/domain/pro-league-maps";
import {
  auditProLeagueRoster,
  proLeagueCurrentRules,
  proLeagueOwnerRosterStrategy,
  requiredProLeagueFemaleCount,
  type ProLeagueRosterCore,
} from "@/domain/pro-league-roster";
import {
  buildProLeagueRosterVersion,
  type ProLeagueRosterRole,
  type ProLeagueRosterVersion,
} from "@/domain/pro-league-roster-version";
import type { ActiveProLeagueEvidenceGeneration } from "@/lib/neon-pro-league-evidence-generation-repository";

const SAFE_ID_PATTERN = /^[a-z0-9][a-z0-9._:/-]{0,127}$/iu;
// The selector is intentionally fail-closed. A private owner vault should stay
// far below this, and the bound prevents an unexpectedly broad read from
// turning a website request into an unbounded combinatorial search.
const MAXIMUM_CANDIDATES = 500;

type Assessment = ProLeagueExactFormatEvidence["benchmarkAssessment"];

export type ProLeagueCandidateCellScore = Readonly<{
  raceType: string;
  distanceMetres: number;
  mapIds: readonly ProLeagueMapId[];
  raceLineCount: number;
  first16RaceLineCount: number;
  evidenceUse: "ranked" | "hypothesis_only" | "stale_unavailable";
  benchmarkAssessment: Assessment;
  raceCount: number;
  freshness: ProLeagueExactFormatEvidence["freshness"];
  dataCurrentThrough: string;
  medianMilliseconds: number;
  trimmedMeanMilliseconds: number;
  standardDeviationMilliseconds: number;
  medianVersusTopThreeBasisPoints: number;
  consistencyVersusTopThreeBasisPoints: number | null;
  supportingOutcomes: ProLeagueExactFormatEvidence["supportingEvidence"]["outcomes"];
  supportingOpposition: ProLeagueExactFormatEvidence["supportingEvidence"]["strongOpposition"];
  supportingStars: ProLeagueExactFormatEvidence["supportingEvidence"]["oppositionAdjustedStars"];
}>;

export type ProLeagueCandidateQualityVector = Readonly<{
  first16WinningLines: number;
  first16TopThreeOrBetterLines: number;
  winningLines: number;
  topThreeOrBetterLines: number;
  exactFormatCells: number;
  weightedMedianMarginBasisPoints: number;
  weightedConsistencyBasisPoints: number | null;
  acceptedRaceCount: number;
  currentCellCount: number;
}>;

export type ProLeagueRosterCandidateScore = Readonly<{
  core: ProLeagueRosterCore;
  selectionStatus:
    | "winning_range"
    | "top_three_range"
    | "population_weak_provisional"
    | "unproven";
  qualityVector: ProLeagueCandidateQualityVector;
  cells: readonly ProLeagueCandidateCellScore[];
  supportingWinCount: number;
  supportingTopThreeCount: number;
  provisional: boolean;
  reasons: readonly string[];
}>;

export type ProLeagueDraftRosterRecommendation = Readonly<{
  authority: "active_verified_exact_format_generation";
  selectionMethod: Readonly<{
    order: "lexicographic_quality_first";
    primaryEvidence: "same_bike_race_type_and_exact_distance";
    intrinsicMetrics: "time_speed_consistency_sample_freshness";
    resultEvidenceRole: "supporting_only_not_ranked";
    missingOppositionQuality: "unknown_never_favourable";
    rosterTarget: "largest_rule_valid_up_to_25";
  }>;
  generationId: string;
  evidenceCutoffAt: string;
  candidates: readonly ProLeagueRosterCandidateScore[];
  draftRoster: ProLeagueRosterVersion | null;
  coverageGaps: readonly ProLeagueCoverageGap[];
  search: Readonly<{
    targetSize: number;
    visitedNodeCount: number;
    maximumNodeCount: number;
    status:
      | "constructed"
      | "insufficient_owned_pool"
      | "no_rule_valid_roster"
      | "search_bound_reached";
  }>;
  operationalWarnings: readonly string[];
}>;

type Demand = Readonly<{
  raceType: string;
  distanceMetres: number;
  mapIds: readonly ProLeagueMapId[];
  raceLineCount: number;
  first16RaceLineCount: number;
}>;

type SearchState = {
  selected: number[];
  element: Record<"Metal" | "Fire" | "Earth" | "Water", number>;
  genesis: Record<"Metal" | "Fire" | "Earth" | "Water", number>;
  female: number;
  f5OrBelow: number;
  f10OrBelow: number;
  aboveF15: number;
};

function identity(value: string, label: string): string {
  const normalized = value.trim();
  if (normalized !== value || !SAFE_ID_PATTERN.test(normalized)) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return normalized;
}

function timestamp(value: string, label: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString() !== value) {
    throw new Error(`Pro League ${label} is invalid.`);
  }
  return value;
}

function boundedInteger(
  value: number,
  label: string,
  minimum: number,
  maximum: number,
): number {
  if (!Number.isSafeInteger(value) || value < minimum || value > maximum) {
    throw new Error(`Pro League ${label} is outside its bound.`);
  }
  return value;
}

function cellKey(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.trim().toLowerCase(), distanceMetres]);
}

const demands: ReadonlyMap<string, Demand> = (() => {
  const values = new Map<
    string,
    {
      raceType: string;
      distanceMetres: number;
      mapIds: Set<ProLeagueMapId>;
      raceLineCount: number;
      first16RaceLineCount: number;
    }
  >();
  for (const map of proLeagueMaps) {
    for (const race of map.races) {
      const key = cellKey(race.raceType, race.distanceMetres);
      const value = values.get(key) ?? {
        raceType: race.raceType,
        distanceMetres: race.distanceMetres,
        mapIds: new Set<ProLeagueMapId>(),
        raceLineCount: 0,
        first16RaceLineCount: 0,
      };
      value.mapIds.add(map.mapId);
      value.raceLineCount += 1;
      if (race.raceNumber <= 16) value.first16RaceLineCount += 1;
      values.set(key, value);
    }
  }
  return new Map(
    [...values.entries()].map(([key, value]) => [
      key,
      Object.freeze({
        ...value,
        mapIds: Object.freeze([...value.mapIds].sort()),
      }),
    ]),
  );
})();

function ranked(profile: ProLeagueExactFormatEvidence): boolean {
  return (
    profile.sampleStatus === "minimally_analytical" &&
    (profile.freshness === "current" || profile.freshness === "ageing")
  );
}

function basisPoints(numerator: number, denominator: number): number {
  return Math.round((numerator / denominator) * 10_000);
}

function scoreCell(
  profile: ProLeagueExactFormatEvidence,
  demand: Demand,
): ProLeagueCandidateCellScore {
  const use = ranked(profile)
    ? "ranked"
    : profile.sampleStatus === "hypothesis_only" &&
        (profile.freshness === "current" || profile.freshness === "ageing")
      ? "hypothesis_only"
      : "stale_unavailable";
  return Object.freeze({
    ...demand,
    evidenceUse: use,
    benchmarkAssessment: profile.benchmarkAssessment,
    raceCount: profile.raceCount,
    freshness: profile.freshness,
    dataCurrentThrough: profile.dataCurrentThrough,
    medianMilliseconds: profile.elapsedTime.medianMilliseconds,
    trimmedMeanMilliseconds: profile.elapsedTime.trimmedMeanMilliseconds,
    standardDeviationMilliseconds:
      profile.elapsedTime.standardDeviationMilliseconds,
    medianVersusTopThreeBasisPoints: basisPoints(
      profile.populationBenchmark.topThreeMedianMilliseconds -
        profile.elapsedTime.medianMilliseconds,
      profile.populationBenchmark.topThreeMedianMilliseconds,
    ),
    consistencyVersusTopThreeBasisPoints:
      profile.populationBenchmark.topThreeStandardDeviationMilliseconds === 0
        ? null
        : basisPoints(
            profile.elapsedTime.standardDeviationMilliseconds,
            profile.populationBenchmark.topThreeStandardDeviationMilliseconds,
          ),
    supportingOutcomes: profile.supportingEvidence.outcomes,
    supportingOpposition: profile.supportingEvidence.strongOpposition,
    supportingStars: profile.supportingEvidence.oppositionAdjustedStars,
  });
}

function weightedAverage(
  values: readonly Readonly<{ value: number; weight: number }>[],
): number {
  const totalWeight = values.reduce((sum, value) => sum + value.weight, 0);
  if (totalWeight === 0) return 0;
  return Math.round(
    values.reduce((sum, value) => sum + value.value * value.weight, 0) /
      totalWeight,
  );
}

function candidate(core: ProLeagueMatchupCore): ProLeagueRosterCandidateScore {
  if (core.displayName.trim() === "") {
    throw new Error(`Pro League Core ${core.coreId} must be named.`);
  }
  const seen = new Set<string>();
  const cells = core.exactFormatEvidence.map((profile) => {
    assertValidProLeagueExactFormatEvidence(profile);
    const key = cellKey(profile.raceType, profile.distanceMetres);
    if (seen.has(key)) {
      throw new Error(`Pro League Core ${core.coreId} repeats an exact cell.`);
    }
    seen.add(key);
    const demand = demands.get(key);
    if (demand === undefined) {
      throw new Error(
        `Pro League Core ${core.coreId} has evidence outside the published maps.`,
      );
    }
    return scoreCell(profile, demand);
  });
  const usable = cells.filter(({ evidenceUse }) => evidenceUse === "ranked");
  const winning = usable.filter(
    ({ benchmarkAssessment }) => benchmarkAssessment === "winning_range",
  );
  const competitive = usable.filter(({ benchmarkAssessment }) =>
    ["winning_range", "top_three_range"].includes(benchmarkAssessment),
  );
  const weightedConsistency = usable
    .filter(
      (
        value,
      ): value is typeof value & {
        consistencyVersusTopThreeBasisPoints: number;
      } => value.consistencyVersusTopThreeBasisPoints !== null,
    )
    .map((value) => ({
      value: value.consistencyVersusTopThreeBasisPoints,
      weight: value.raceLineCount,
    }));
  const qualityVector: ProLeagueCandidateQualityVector = Object.freeze({
    first16WinningLines: winning.reduce(
      (sum, value) => sum + value.first16RaceLineCount,
      0,
    ),
    first16TopThreeOrBetterLines: competitive.reduce(
      (sum, value) => sum + value.first16RaceLineCount,
      0,
    ),
    winningLines: winning.reduce((sum, value) => sum + value.raceLineCount, 0),
    topThreeOrBetterLines: competitive.reduce(
      (sum, value) => sum + value.raceLineCount,
      0,
    ),
    exactFormatCells: usable.length,
    weightedMedianMarginBasisPoints: weightedAverage(
      usable.map((value) => ({
        value: value.medianVersusTopThreeBasisPoints,
        weight: value.raceLineCount,
      })),
    ),
    weightedConsistencyBasisPoints:
      weightedConsistency.length === 0
        ? null
        : weightedAverage(weightedConsistency),
    acceptedRaceCount: usable.reduce((sum, value) => sum + value.raceCount, 0),
    currentCellCount: usable.filter(({ freshness }) => freshness === "current")
      .length,
  });
  const selectionStatus =
    winning.length > 0
      ? ("winning_range" as const)
      : competitive.length > 0
        ? ("top_three_range" as const)
        : usable.length > 0
          ? ("population_weak_provisional" as const)
          : ("unproven" as const);
  const reasons = [
    `${qualityVector.winningLines} published race line(s) have minimally analytical winning-range evidence; ${qualityVector.topThreeOrBetterLines} are top-three-or-better.`,
    `${qualityVector.exactFormatCells} exact race-type-plus-distance cell(s) are fresh enough for ranking from ${qualityVector.acceptedRaceCount} accepted race result(s).`,
    selectionStatus === "population_weak_provisional"
      ? "Best evidence remains outside the population Top-3 range; provisional only and test before lock."
      : selectionStatus === "unproven"
        ? "No minimally analytical current or ageing exact-format evidence is available; use only if structural rules require it and test before lock."
        : "Ranking uses intrinsic time and consistency against the same-format population; outcomes remain supporting context only.",
  ];
  return Object.freeze({
    core: Object.freeze({
      coreId: identity(core.coreId, "candidate Core ID"),
      displayName: core.displayName.trim(),
      element: core.element,
      coreClass: core.coreClass,
      sex: core.sex,
      fNumber: core.fNumber,
      inMyVault: true,
    }),
    selectionStatus,
    qualityVector,
    cells: Object.freeze(
      [...cells].sort(
        (left, right) =>
          left.raceType.localeCompare(right.raceType) ||
          left.distanceMetres - right.distanceMetres,
      ),
    ),
    supportingWinCount: cells.reduce(
      (sum, value) => sum + value.supportingOutcomes.winCount,
      0,
    ),
    supportingTopThreeCount: cells.reduce(
      (sum, value) => sum + value.supportingOutcomes.topThreeCount,
      0,
    ),
    provisional:
      selectionStatus === "population_weak_provisional" ||
      selectionStatus === "unproven",
    reasons: Object.freeze(reasons),
  });
}

function compareCandidates(
  left: ProLeagueRosterCandidateScore,
  right: ProLeagueRosterCandidateScore,
): number {
  const a = left.qualityVector;
  const b = right.qualityVector;
  return (
    b.first16WinningLines - a.first16WinningLines ||
    b.first16TopThreeOrBetterLines - a.first16TopThreeOrBetterLines ||
    b.winningLines - a.winningLines ||
    b.topThreeOrBetterLines - a.topThreeOrBetterLines ||
    b.exactFormatCells - a.exactFormatCells ||
    b.weightedMedianMarginBasisPoints - a.weightedMedianMarginBasisPoints ||
    (a.weightedConsistencyBasisPoints ?? Number.MAX_SAFE_INTEGER) -
      (b.weightedConsistencyBasisPoints ?? Number.MAX_SAFE_INTEGER) ||
    b.acceptedRaceCount - a.acceptedRaceCount ||
    b.currentCellCount - a.currentCellCount ||
    left.core.coreId.localeCompare(right.core.coreId)
  );
}

function emptyState(): SearchState {
  return {
    selected: [],
    element: { Metal: 0, Fire: 0, Earth: 0, Water: 0 },
    genesis: { Metal: 0, Fire: 0, Earth: 0, Water: 0 },
    female: 0,
    f5OrBelow: 0,
    f10OrBelow: 0,
    aboveF15: 0,
  };
}

function canAdd(state: SearchState, core: ProLeagueRosterCore): boolean {
  const elementMaximum = proLeagueCurrentRules.maximumPerElement[core.element];
  return !(
    (elementMaximum !== null &&
      state.element[core.element] >= elementMaximum) ||
    (core.coreClass === "Genesis" &&
      state.genesis[core.element] >=
        proLeagueCurrentRules.maximumGenesisPerElement) ||
    (core.fNumber <= 5 &&
      state.f5OrBelow >= proLeagueCurrentRules.maximumF5OrBelow) ||
    (core.fNumber <= 10 &&
      state.f10OrBelow >= proLeagueCurrentRules.maximumF10OrBelow)
  );
}

function add(state: SearchState, index: number, core: ProLeagueRosterCore) {
  state.selected.push(index);
  state.element[core.element] += 1;
  if (core.coreClass === "Genesis") state.genesis[core.element] += 1;
  if (core.sex === "female") state.female += 1;
  if (core.fNumber <= 5) state.f5OrBelow += 1;
  if (core.fNumber <= 10) state.f10OrBelow += 1;
  if (core.fNumber > 15) state.aboveF15 += 1;
}

function remove(state: SearchState, core: ProLeagueRosterCore) {
  state.selected.pop();
  state.element[core.element] -= 1;
  if (core.coreClass === "Genesis") state.genesis[core.element] -= 1;
  if (core.sex === "female") state.female -= 1;
  if (core.fNumber <= 5) state.f5OrBelow -= 1;
  if (core.fNumber <= 10) state.f10OrBelow -= 1;
  if (core.fNumber > 15) state.aboveF15 -= 1;
}

function searchKey(index: number, state: SearchState): string {
  return [
    index,
    state.selected.length,
    state.element.Metal,
    state.element.Fire,
    state.element.Earth,
    state.genesis.Metal,
    state.genesis.Fire,
    state.genesis.Earth,
    state.genesis.Water,
    state.female,
    state.f5OrBelow,
    state.f10OrBelow,
    Math.min(state.aboveF15, proLeagueCurrentRules.minimumAboveF15),
  ].join(":");
}

function selectRoster(
  candidates: readonly ProLeagueRosterCandidateScore[],
  targetSize: number,
  maximumNodeCount: number,
): Readonly<{
  selected: readonly ProLeagueRosterCandidateScore[] | null;
  visitedNodeCount: number;
  boundReached: boolean;
}> {
  const requiredFemale = requiredProLeagueFemaleCount(targetSize);
  const state = emptyState();
  const failed = new Set<string>();
  const remainingFemale = new Array<number>(candidates.length + 1).fill(0);
  const remainingAboveF15 = new Array<number>(candidates.length + 1).fill(0);
  for (let index = candidates.length - 1; index >= 0; index -= 1) {
    const core = candidates[index]!.core;
    remainingFemale[index] =
      remainingFemale[index + 1]! + (core.sex === "female" ? 1 : 0);
    remainingAboveF15[index] =
      remainingAboveF15[index + 1]! + (core.fNumber > 15 ? 1 : 0);
  }
  let visitedNodeCount = 0;
  let boundReached = false;

  function visit(index: number): readonly number[] | null {
    visitedNodeCount += 1;
    if (visitedNodeCount > maximumNodeCount) {
      boundReached = true;
      return null;
    }
    const selectedCount = state.selected.length;
    const slots = targetSize - selectedCount;
    const remaining = candidates.length - index;
    if (slots === 0) {
      return state.female >= requiredFemale &&
        state.aboveF15 >= proLeagueCurrentRules.minimumAboveF15
        ? [...state.selected]
        : null;
    }
    if (remaining < slots) return null;
    if (
      state.female + remainingFemale[index]! < requiredFemale ||
      state.aboveF15 + remainingAboveF15[index]! <
        proLeagueCurrentRules.minimumAboveF15
    ) {
      return null;
    }
    const key = searchKey(index, state);
    if (failed.has(key)) return null;
    const next = candidates[index]!;
    if (canAdd(state, next.core)) {
      add(state, index, next.core);
      const included = visit(index + 1);
      remove(state, next.core);
      if (included !== null) return included;
    }
    const excluded = visit(index + 1);
    if (excluded !== null) return excluded;
    failed.add(key);
    return null;
  }

  const selectedIndices = visit(0);
  return {
    selected:
      selectedIndices === null
        ? null
        : selectedIndices.map((index) => candidates[index]!),
    visitedNodeCount,
    boundReached,
  };
}

function confidence(
  candidate: ProLeagueRosterCandidateScore,
): "strong" | "moderate" | "limited" | "unavailable" {
  if (candidate.selectionStatus === "winning_range") return "strong";
  if (candidate.selectionStatus === "top_three_range") return "moderate";
  if (candidate.selectionStatus === "population_weak_provisional")
    return "limited";
  return "unavailable";
}

function role(candidate: ProLeagueRosterCandidateScore): ProLeagueRosterRole {
  if (candidate.selectionStatus === "winning_range") return "nucleus";
  if (candidate.selectionStatus === "top_three_range") return "optional";
  return "structural_coverage";
}

function reason(candidate: ProLeagueRosterCandidateScore): string {
  const vector = candidate.qualityVector;
  const prefix = candidate.provisional ? "PROVISIONAL — " : "";
  return `${prefix}${vector.winningLines} winning-range and ${vector.topThreeOrBetterLines} top-three-or-better published line(s) across ${vector.exactFormatCells} ranked exact-format cell(s). Intrinsic time/consistency controlled selection; outcomes were supporting only.`;
}

function selectedVault(
  vault: ProLeagueMatchupVault,
  selected: readonly ProLeagueRosterCandidateScore[],
): ProLeagueMatchupVault {
  const selectedIds = new Set(selected.map(({ core }) => core.coreId));
  return {
    ...vault,
    cores: vault.cores.map((core) => ({
      ...core,
      rosterStatus: selectedIds.has(core.coreId) ? "rostered" : "not_rostered",
    })),
  };
}

export function buildProLeagueDraftRosterRecommendation(
  input: Readonly<{
    vault: ProLeagueMatchupVault;
    generation: ActiveProLeagueEvidenceGeneration;
    rosterVersionId: string;
    versionNumber: number;
    maximumSearchNodes?: number;
  }>,
): ProLeagueDraftRosterRecommendation {
  identity(input.vault.vaultId, "Vault ID");
  identity(input.generation.generationId, "evidence generation ID");
  timestamp(input.generation.evidenceCutoffAt, "evidence cutoff");
  if (
    !Array.isArray(input.vault.cores) ||
    input.vault.cores.length > MAXIMUM_CANDIDATES
  ) {
    throw new Error("Pro League candidate pool is outside its bound.");
  }
  const maximumNodeCount = boundedInteger(
    input.maximumSearchNodes ?? 1_000_000,
    "roster search node limit",
    1,
    5_000_000,
  );
  const ids = new Set<string>();
  const candidates = input.vault.cores
    .map((core) => {
      const coreId = identity(core.coreId, "candidate Core ID");
      if (ids.has(coreId)) {
        throw new Error("Pro League candidate pool repeats a Core.");
      }
      ids.add(coreId);
      for (const profile of core.exactFormatEvidence) {
        if (profile.dataCurrentThrough > input.generation.evidenceCutoffAt) {
          throw new Error(
            `Pro League Core ${coreId} evidence exceeds the active generation cutoff.`,
          );
        }
      }
      return candidate(core);
    })
    .sort(compareCandidates);

  let selected: readonly ProLeagueRosterCandidateScore[] | null = null;
  let targetSize = Math.min(
    proLeagueOwnerRosterStrategy.targetRosterSize,
    candidates.length,
  );
  let visitedNodeCount = 0;
  let boundReached = false;
  while (
    targetSize >= proLeagueCurrentRules.minimumRosterSize &&
    selected === null &&
    !boundReached
  ) {
    const found = selectRoster(
      candidates,
      targetSize,
      maximumNodeCount - visitedNodeCount,
    );
    visitedNodeCount += found.visitedNodeCount;
    selected = found.selected;
    boundReached = found.boundReached;
    if (selected === null) targetSize -= 1;
  }

  const draftRoster =
    selected === null
      ? null
      : buildProLeagueRosterVersion({
          rosterVersionId: input.rosterVersionId,
          versionNumber: input.versionNumber,
          initialRosterCountingPolicy:
            proLeagueCurrentRules.initialRosterCountsAsSubstitutions,
          evidenceCutoffAt: input.generation.evidenceCutoffAt,
          rationale:
            "Quality-first draft from the active verified same-Bike-race-type-plus-exact-distance generation. Review current ageing and protected Tournament status before lock.",
          members: selected.map((value) => ({
            core: value.core,
            disposition: "rostered" as const,
            role: role(value),
            reason: reason(value),
            evidence: {
              asOf:
                value.cells
                  .map(({ dataCurrentThrough }) => dataCurrentThrough)
                  .sort()
                  .at(-1) ?? input.generation.evidenceCutoffAt,
              generationId: input.generation.generationId,
              sha256: input.generation.payloadSha256,
              confidence: confidence(value),
            },
          })),
        });
  if (
    draftRoster !== null &&
    auditProLeagueRoster(
      draftRoster.members
        .filter(({ disposition }) => disposition === "rostered")
        .map(({ core }) => core),
    ).readiness !== "compliant"
  ) {
    throw new Error("Pro League draft roster failed its final rule audit.");
  }
  const coverageGaps = buildProLeagueCoverageGaps(
    selectedVault(input.vault, selected ?? []),
  );
  return Object.freeze({
    authority: "active_verified_exact_format_generation",
    selectionMethod: Object.freeze({
      order: "lexicographic_quality_first",
      primaryEvidence: "same_bike_race_type_and_exact_distance",
      intrinsicMetrics: "time_speed_consistency_sample_freshness",
      resultEvidenceRole: "supporting_only_not_ranked",
      missingOppositionQuality: "unknown_never_favourable",
      rosterTarget: "largest_rule_valid_up_to_25",
    }),
    generationId: input.generation.generationId,
    evidenceCutoffAt: input.generation.evidenceCutoffAt,
    candidates: Object.freeze(candidates),
    draftRoster,
    coverageGaps: Object.freeze(coverageGaps),
    search: Object.freeze({
      targetSize: draftRoster?.audit.selectedCoreCount ?? 0,
      visitedNodeCount,
      maximumNodeCount,
      status: draftRoster
        ? ("constructed" as const)
        : boundReached
          ? ("search_bound_reached" as const)
          : candidates.length < proLeagueCurrentRules.minimumRosterSize
            ? ("insufficient_owned_pool" as const)
            : ("no_rule_valid_roster" as const),
    }),
    operationalWarnings: Object.freeze([
      "This is a draft only. It does not submit a roster or consume a substitution.",
      "Current ageing totals and protected Tournament-Core status are not present in the exact-format evidence generation; review them before lock.",
      "Initial-roster counting against the annual 10-substitution budget remains unresolved.",
      "Population-weak or unproven structural selections are provisional and should be tested before lock.",
    ]),
  });
}
