import {
  coreEsportsResultRule,
  type CoreEsportsRaceObservation,
} from "@/domain/core-esports-performance";
import type { ProLeagueOwnerCommissioningPlan } from "@/domain/pro-league-owner-commissioning-plan";
import type {
  ProLeagueCandidateCellScore,
  ProLeagueDraftRosterRecommendation,
  ProLeagueRosterCandidateScore,
} from "@/domain/pro-league-roster-recommendation";
import type { ProLeagueSubstitutionWatch } from "@/domain/pro-league-substitution-watch";

const WEEK_MILLISECONDS = 7 * 24 * 60 * 60 * 1_000;
const MINIMUM_WEEKLY_RESULTS = 3;
const SUBSTITUTION_REVIEW_RESULTS = 4;
const SLOWER_THRESHOLD_BASIS_POINTS = 300;
const FASTER_THRESHOLD_BASIS_POINTS = -300;

type TimingTrend = "faster" | "stable" | "slower" | "unknown";

export type ProLeagueWeeklyRosterAction =
  | "keep"
  | "monitor"
  | "remap_review"
  | "substitution_review";

export type ProLeagueWeeklyRosterPerformanceRow = Readonly<{
  coreId: string;
  displayName: string;
  mappedEntryCount: number;
  first16MappedEntryCount: number;
  mappedCellCount: number;
  rankedMappedCellCount: number;
  mappedEvidenceCoveragePercent: number;
  weakMappedCells: readonly string[];
  strongerSupportedCells: readonly string[];
  weeklyRaceCount: number | null;
  weeklyKnownResultCount: number | null;
  weeklySuccessCount: number | null;
  weeklySuccessRatePercent: number | null;
  weeklyTimedRaceCount: number | null;
  timingTrend: TimingTrend;
  timingDeltaBasisPoints: number | null;
  replacementCandidateName: string | null;
  replacementNetFirst16Direction: number | null;
  action: ProLeagueWeeklyRosterAction;
  reasons: readonly string[];
}>;

export type ProLeagueWeeklyRosterPerformance = Readonly<{
  sourceStatus: "esports_connected" | "intrinsic_only";
  weekStart: string;
  weekEnd: string;
  minimumWeeklyResults: typeof MINIMUM_WEEKLY_RESULTS;
  rows: readonly ProLeagueWeeklyRosterPerformanceRow[];
  summary: Readonly<{
    keepCount: number;
    monitorCount: number;
    remapReviewCount: number;
    substitutionReviewCount: number;
  }>;
  guidance: string;
}>;

function key(raceType: string, distanceMetres: number): string {
  return JSON.stringify([raceType.trim().toLowerCase(), distanceMetres]);
}

function label(raceType: string, distanceMetres: number): string {
  return `${distanceMetres}m ${raceType}`;
}

function ranked(cell: ProLeagueCandidateCellScore): boolean {
  return cell.evidenceUse === "ranked";
}

function candidateById(
  roster: ProLeagueDraftRosterRecommendation,
): ReadonlyMap<string, ProLeagueRosterCandidateScore> {
  return new Map(roster.candidates.map((candidate) => [candidate.core.coreId, candidate]));
}

function observationsForWeek(input: {
  observations: readonly CoreEsportsRaceObservation[];
  coreId: string;
  weekStartMs: number;
  weekEndMs: number;
}): readonly CoreEsportsRaceObservation[] {
  return input.observations.filter((observation) => {
    if (
      observation.sourceCoreId !== input.coreId ||
      observation.status !== "completed" ||
      observation.completedAt === null
    ) {
      return false;
    }
    const completedAt = Date.parse(observation.completedAt);
    return completedAt >= input.weekStartMs && completedAt <= input.weekEndMs;
  });
}

function timingTrend(input: {
  observations: readonly CoreEsportsRaceObservation[];
  candidate: ProLeagueRosterCandidateScore;
}): Readonly<{
  trend: TimingTrend;
  deltaBasisPoints: number | null;
  timedCount: number;
}> {
  const deltas = input.observations.flatMap((observation) => {
    if (observation.elapsedTimeMilliseconds === null) return [];
    const cell = input.candidate.cells.find(
      (value) =>
        value.raceType.toLowerCase() === observation.raceType.toLowerCase() &&
        value.distanceMetres === observation.distanceMetres &&
        ranked(value),
    );
    if (cell === undefined || cell.medianMilliseconds <= 0) return [];
    return [
      Math.round(
        ((observation.elapsedTimeMilliseconds - cell.medianMilliseconds) /
          cell.medianMilliseconds) *
          10_000,
      ),
    ];
  });
  if (deltas.length === 0) {
    return Object.freeze({
      trend: "unknown" as const,
      deltaBasisPoints: null,
      timedCount: 0,
    });
  }
  const average = Math.round(
    deltas.reduce((sum, value) => sum + value, 0) / deltas.length,
  );
  return Object.freeze({
    trend:
      average >= SLOWER_THRESHOLD_BASIS_POINTS
        ? ("slower" as const)
        : average <= FASTER_THRESHOLD_BASIS_POINTS
          ? ("faster" as const)
          : ("stable" as const),
    deltaBasisPoints: average,
    timedCount: deltas.length,
  });
}

function weeklyResults(
  observations: readonly CoreEsportsRaceObservation[],
): Readonly<{
  knownResultCount: number;
  successCount: number;
  successRatePercent: number | null;
}> {
  let knownResultCount = 0;
  let successCount = 0;
  for (const observation of observations) {
    const rule = coreEsportsResultRule(observation.raceType);
    if (observation.finishPosition === null || rule === "unknown") continue;
    knownResultCount += 1;
    if (
      (rule === "first_place" && observation.finishPosition === 1) ||
      (rule === "top_three" && observation.finishPosition <= 3)
    ) {
      successCount += 1;
    }
  }
  return Object.freeze({
    knownResultCount,
    successCount,
    successRatePercent:
      knownResultCount === 0
        ? null
        : Math.round((successCount / knownResultCount) * 100),
  });
}

function mappedCells(input: {
  plan: ProLeagueOwnerCommissioningPlan;
  displayName: string;
}): Readonly<{
  entryCount: number;
  first16EntryCount: number;
  cellKeys: readonly string[];
  labels: ReadonlyMap<string, string>;
}> {
  let entryCount = 0;
  let first16EntryCount = 0;
  const cellKeys = new Set<string>();
  const labels = new Map<string, string>();
  for (const map of input.plan.maps) {
    for (const line of map.lines) {
      if (!line.coreNames.includes(input.displayName)) continue;
      entryCount += 1;
      if (line.first16) first16EntryCount += 1;
      const cellKey = key(line.raceType, line.distanceMetres);
      cellKeys.add(cellKey);
      labels.set(cellKey, label(line.raceType, line.distanceMetres));
    }
  }
  return Object.freeze({
    entryCount,
    first16EntryCount,
    cellKeys: Object.freeze([...cellKeys]),
    labels,
  });
}

function replacementFor(
  watch: ProLeagueSubstitutionWatch | undefined,
  coreId: string,
): Readonly<{
  name: string;
  netFirst16Direction: number;
  weakerFirst16LineCount: number;
}> | null {
  if (watch === undefined) return null;
  const values = watch.candidates
    .filter(
      ({ recommendedScenario }) =>
        recommendedScenario.outgoingCoreId === coreId,
    )
    .sort(
      (left, right) =>
        right.recommendedScenario.netFirst16Direction -
          left.recommendedScenario.netFirst16Direction ||
        left.recommendedScenario.weakerFirst16LineCount -
          right.recommendedScenario.weakerFirst16LineCount,
    );
  const value = values[0];
  return value === undefined
    ? null
    : Object.freeze({
        name: value.displayName,
        netFirst16Direction:
          value.recommendedScenario.netFirst16Direction,
        weakerFirst16LineCount:
          value.recommendedScenario.weakerFirst16LineCount,
      });
}

function actionFor(input: {
  sourceConnected: boolean;
  mappedCellCount: number;
  mappedCoveragePercent: number;
  weeklyKnownResultCount: number;
  weeklySuccessRatePercent: number | null;
  timingTrend: TimingTrend;
  replacement: ReturnType<typeof replacementFor>;
}): Readonly<{
  action: ProLeagueWeeklyRosterAction;
  reasons: readonly string[];
}> {
  const reasons: string[] = [];
  if (!input.sourceConnected) {
    reasons.push(
      "Completed Esports result monitoring is not connected yet; do not infer league wins/losses from normal Bike history.",
    );
    if (input.mappedCellCount > 0 && input.mappedCoveragePercent < 50) {
      reasons.push(
        "Less than half of the Core's mapped exact-format cells have ranked direct evidence. Keep this visible as a mapping evidence gap, but do not call it weekly underperformance without completed Esports results.",
      );
    }
    return Object.freeze({
      action: "monitor" as const,
      reasons: Object.freeze(reasons),
    });
  }

  if (input.weeklyKnownResultCount < MINIMUM_WEEKLY_RESULTS) {
    reasons.push(
      `Only ${input.weeklyKnownResultCount} completed league result(s) are available this week; at least ${MINIMUM_WEEKLY_RESULTS} are required before judging contribution.`,
    );
    if (input.mappedCellCount > 0 && input.mappedCoveragePercent < 50) {
      reasons.push(
        "Mapped exact-format evidence is thin, so review assignments while more league results accumulate.",
      );
      return Object.freeze({
        action: "remap_review" as const,
        reasons: Object.freeze(reasons),
      });
    }
    return Object.freeze({
      action: "monitor" as const,
      reasons: Object.freeze(reasons),
    });
  }

  const successRate = input.weeklySuccessRatePercent ?? 0;
  if (successRate >= 50 && input.timingTrend !== "slower") {
    reasons.push(
      `Weekly league success rate is ${successRate}% with no material timing deterioration.`,
    );
    return Object.freeze({
      action: "keep" as const,
      reasons: Object.freeze(reasons),
    });
  }

  if (
    input.weeklyKnownResultCount >= SUBSTITUTION_REVIEW_RESULTS &&
    successRate <= 25 &&
    input.timingTrend === "slower" &&
    input.replacement !== null &&
    input.replacement.netFirst16Direction > 0 &&
    input.replacement.weakerFirst16LineCount === 0
  ) {
    reasons.push(
      `Weekly league success rate is only ${successRate}% across ${input.weeklyKnownResultCount} known result(s), and matching exact-format timing is materially slower than the Core's established median.`,
    );
    reasons.push(
      `${input.replacement.name} has a legal full-remap scenario with positive first-16 impact and no weaker first-16 lines.`,
    );
    return Object.freeze({
      action: "substitution_review" as const,
      reasons: Object.freeze(reasons),
    });
  }

  reasons.push(
    `Weekly league success rate is ${successRate}% across ${input.weeklyKnownResultCount} known result(s); review map placement before spending a substitution.`,
  );
  if (input.timingTrend === "faster" || input.timingTrend === "stable") {
    reasons.push(
      "Timing remains stable or better, which suggests the issue may be assignment/opposition rather than Core deterioration.",
    );
  } else if (input.timingTrend === "slower") {
    reasons.push(
      "Matching exact-format timing is also slower, so keep the Core on substitution watch if the pattern persists.",
    );
  }
  return Object.freeze({
    action: "remap_review" as const,
    reasons: Object.freeze(reasons),
  });
}

export function buildProLeagueWeeklyRosterPerformance(input: Readonly<{
  roster: ProLeagueDraftRosterRecommendation;
  ownerPlan: ProLeagueOwnerCommissioningPlan;
  substitutionWatch?: ProLeagueSubstitutionWatch;
  esportsObservations?: readonly CoreEsportsRaceObservation[];
  esportsSourceConnected: boolean;
  now: Date;
}>): ProLeagueWeeklyRosterPerformance {
  if (
    input.roster.draftRoster === null ||
    input.roster.draftRoster.audit.readiness !== "compliant"
  ) {
    throw new Error(
      "Pro League weekly monitoring requires a compliant current roster.",
    );
  }
  if (Number.isNaN(input.now.getTime())) {
    throw new Error("Pro League weekly monitoring time is invalid.");
  }
  const weekEndMs = input.now.getTime();
  const weekStartMs = weekEndMs - WEEK_MILLISECONDS;
  const observations = input.esportsObservations ?? [];
  const candidates = candidateById(input.roster);

  const rows = input.roster.draftRoster.members
    .filter(({ disposition }) => disposition === "rostered")
    .map((member): ProLeagueWeeklyRosterPerformanceRow => {
      const candidate = candidates.get(member.core.coreId);
      if (candidate === undefined) {
        throw new Error(
          `Pro League weekly monitoring cannot find roster candidate ${member.core.displayName}.`,
        );
      }
      const mapped = mappedCells({
        plan: input.ownerPlan,
        displayName: member.core.displayName,
      });
      const rankedCellKeys = new Set(
        candidate.cells.filter(ranked).map((cell) => key(cell.raceType, cell.distanceMetres)),
      );
      const rankedMappedCellCount = mapped.cellKeys.filter((cellKey) =>
        rankedCellKeys.has(cellKey),
      ).length;
      const mappedEvidenceCoveragePercent =
        mapped.cellKeys.length === 0
          ? 0
          : Math.round((rankedMappedCellCount / mapped.cellKeys.length) * 100);
      const weakMappedCells = mapped.cellKeys
        .filter((cellKey) => !rankedCellKeys.has(cellKey))
        .map((cellKey) => mapped.labels.get(cellKey) ?? cellKey)
        .slice(0, 4);
      const strongerSupportedCells = candidate.cells
        .filter((cell) => ranked(cell) && !mapped.cellKeys.includes(key(cell.raceType, cell.distanceMetres)))
        .sort(
          (left, right) =>
            right.first16RaceLineCount - left.first16RaceLineCount ||
            right.raceLineCount - left.raceLineCount ||
            right.raceCount - left.raceCount,
        )
        .slice(0, 4)
        .map((cell) => label(cell.raceType, cell.distanceMetres));

      const weekly = observationsForWeek({
        observations,
        coreId: member.core.coreId,
        weekStartMs,
        weekEndMs,
      });
      const results = weeklyResults(weekly);
      const timing = timingTrend({ observations: weekly, candidate });
      const replacement = replacementFor(
        input.substitutionWatch,
        member.core.coreId,
      );
      const decision = actionFor({
        sourceConnected: input.esportsSourceConnected,
        mappedCellCount: mapped.cellKeys.length,
        mappedCoveragePercent: mappedEvidenceCoveragePercent,
        weeklyKnownResultCount: results.knownResultCount,
        weeklySuccessRatePercent: results.successRatePercent,
        timingTrend: timing.trend,
        replacement,
      });

      return Object.freeze({
        coreId: member.core.coreId,
        displayName: member.core.displayName,
        mappedEntryCount: mapped.entryCount,
        first16MappedEntryCount: mapped.first16EntryCount,
        mappedCellCount: mapped.cellKeys.length,
        rankedMappedCellCount,
        mappedEvidenceCoveragePercent,
        weakMappedCells: Object.freeze(weakMappedCells),
        strongerSupportedCells: Object.freeze(strongerSupportedCells),
        weeklyRaceCount: input.esportsSourceConnected ? weekly.length : null,
        weeklyKnownResultCount: input.esportsSourceConnected
          ? results.knownResultCount
          : null,
        weeklySuccessCount: input.esportsSourceConnected
          ? results.successCount
          : null,
        weeklySuccessRatePercent: input.esportsSourceConnected
          ? results.successRatePercent
          : null,
        weeklyTimedRaceCount: input.esportsSourceConnected
          ? timing.timedCount
          : null,
        timingTrend: input.esportsSourceConnected
          ? timing.trend
          : ("unknown" as const),
        timingDeltaBasisPoints: input.esportsSourceConnected
          ? timing.deltaBasisPoints
          : null,
        replacementCandidateName: replacement?.name ?? null,
        replacementNetFirst16Direction:
          replacement?.netFirst16Direction ?? null,
        action: decision.action,
        reasons: decision.reasons,
      });
    })
    .sort(
      (left, right) =>
        (left.action === right.action
          ? 0
          : left.action === "substitution_review"
            ? -1
            : right.action === "substitution_review"
              ? 1
              : left.action === "remap_review"
                ? -1
                : right.action === "remap_review"
                  ? 1
                  : left.action === "monitor"
                    ? -1
                    : 1) ||
        right.first16MappedEntryCount - left.first16MappedEntryCount ||
        left.displayName.localeCompare(right.displayName),
    );

  const summary = Object.freeze({
    keepCount: rows.filter(({ action }) => action === "keep").length,
    monitorCount: rows.filter(({ action }) => action === "monitor").length,
    remapReviewCount: rows.filter(({ action }) => action === "remap_review")
      .length,
    substitutionReviewCount: rows.filter(
      ({ action }) => action === "substitution_review",
    ).length,
  });

  return Object.freeze({
    sourceStatus: input.esportsSourceConnected
      ? ("esports_connected" as const)
      : ("intrinsic_only" as const),
    weekStart: new Date(weekStartMs).toISOString(),
    weekEnd: new Date(weekEndMs).toISOString(),
    minimumWeeklyResults: MINIMUM_WEEKLY_RESULTS,
    rows: Object.freeze(rows),
    summary,
    guidance: input.esportsSourceConnected
      ? "Completed Pro League/Esports results drive weekly contribution checks. Poor weekly results trigger mapping review first; substitution review requires a larger poor sample, slower matching-format timing and a demonstrably better legal replacement."
      : "Completed Pro League/Esports result persistence is not connected yet. The monitor still audits mapped load and exact-format evidence, but it does not label normal Bike results as league wins/losses.",
  });
}
