import type { RaceMode } from "@/domain/core-performance";

export type ValidatedAssignmentState = "assigned" | "not_assigned" | "excluded";

export type StarTrendObservation = Readonly<{
  eventId: string;
  eventAt: string;
  mode: RaceMode;
  distance: number;
  goldEligible: boolean;
  goldAssignmentState: ValidatedAssignmentState;
  blueAssignmentState: ValidatedAssignmentState;
}>;

export type StarTrendPeriod = Readonly<{
  periodId: string;
  startsAt: string;
  endsAt: string;
}>;

export type AssignmentFrequency = Readonly<{
  assignedCount: number;
  noAssignmentCount: number;
  excludedCount: number;
  opportunityCount: number;
  assignmentRate: number | null;
}>;

export type StarTrendSummary = Readonly<{
  periodId: string;
  startsAt: string;
  endsAt: string;
  mode: RaceMode;
  distance: number;
  eventCount: number;
  goldEligibleEventCount: number;
  goldIneligibleEventCount: number;
  gold: AssignmentFrequency;
  blue: AssignmentFrequency;
  analyticalStatus: "descriptive_experimental";
}>;

export type StarChangeCandidate = Readonly<{
  mode: RaceMode;
  distance: number;
  signal: "gold" | "blue";
  priorPeriodId: string;
  currentPeriodId: string;
  priorOpportunityCount: number;
  currentOpportunityCount: number;
  priorAssignmentRate: number | null;
  currentAssignmentRate: number | null;
  absoluteRateChange: number | null;
  status:
    "insufficient_evidence" | "stable_within_threshold" | "change_candidate";
  interpretation: "descriptive_only";
}>;

export type StarTrendResult = Readonly<{
  summaries: readonly StarTrendSummary[];
  changeCandidates: readonly StarChangeCandidate[];
  outsideConfiguredPeriodsCount: number;
}>;

export type StarTrendDetectionOptions = Readonly<{
  minimumOpportunityCount: number;
  absoluteRateChangeThreshold: number;
}>;

const modes: readonly RaceMode[] = ["bike", "car", "horse"];
const assignmentStates: readonly ValidatedAssignmentState[] = [
  "assigned",
  "not_assigned",
  "excluded",
];

function assertPeriods(periods: readonly StarTrendPeriod[]): void {
  const periodIds = new Set<string>();
  let priorEnd = Number.NEGATIVE_INFINITY;

  for (const period of periods) {
    const start = Date.parse(period.startsAt);
    const end = Date.parse(period.endsAt);
    if (
      period.periodId.trim() === "" ||
      periodIds.has(period.periodId) ||
      Number.isNaN(start) ||
      Number.isNaN(end) ||
      start >= end ||
      start < priorEnd
    ) {
      throw new Error(`Invalid star trend period: ${period.periodId}`);
    }
    periodIds.add(period.periodId);
    priorEnd = end;
  }
}

function assertObservation(observation: StarTrendObservation): void {
  if (
    observation.eventId.trim() === "" ||
    Number.isNaN(Date.parse(observation.eventAt)) ||
    !modes.includes(observation.mode) ||
    !Number.isSafeInteger(observation.distance) ||
    observation.distance <= 0 ||
    !assignmentStates.includes(observation.goldAssignmentState) ||
    !assignmentStates.includes(observation.blueAssignmentState) ||
    (!observation.goldEligible &&
      observation.goldAssignmentState !== "excluded")
  ) {
    throw new Error(`Invalid star trend observation: ${observation.eventId}`);
  }
}

function roundedRate(value: number): number {
  return Math.round(value * 1_000_000) / 1_000_000;
}

function assignmentFrequency(
  states: readonly ValidatedAssignmentState[],
): AssignmentFrequency {
  const assignedCount = states.filter((state) => state === "assigned").length;
  const noAssignmentCount = states.filter(
    (state) => state === "not_assigned",
  ).length;
  const excludedCount = states.filter((state) => state === "excluded").length;
  const opportunityCount = assignedCount + noAssignmentCount;

  return {
    assignedCount,
    noAssignmentCount,
    excludedCount,
    opportunityCount,
    assignmentRate:
      opportunityCount === 0
        ? null
        : roundedRate(assignedCount / opportunityCount),
  };
}

function summaryKey(
  periodId: string,
  mode: RaceMode,
  distance: number,
): string {
  return JSON.stringify([periodId, mode, distance]);
}

function profileKey(
  value: Pick<StarTrendSummary, "mode" | "distance">,
): string {
  return JSON.stringify([value.mode, value.distance]);
}

function changeCandidate(
  signal: "gold" | "blue",
  prior: StarTrendSummary,
  current: StarTrendSummary,
  options: StarTrendDetectionOptions,
): StarChangeCandidate {
  const priorFrequency = prior[signal];
  const currentFrequency = current[signal];
  const sufficient =
    priorFrequency.opportunityCount >= options.minimumOpportunityCount &&
    currentFrequency.opportunityCount >= options.minimumOpportunityCount &&
    priorFrequency.assignmentRate !== null &&
    currentFrequency.assignmentRate !== null;
  const absoluteRateChange = sufficient
    ? roundedRate(
        Math.abs(
          currentFrequency.assignmentRate! - priorFrequency.assignmentRate!,
        ),
      )
    : null;

  return {
    mode: current.mode,
    distance: current.distance,
    signal,
    priorPeriodId: prior.periodId,
    currentPeriodId: current.periodId,
    priorOpportunityCount: priorFrequency.opportunityCount,
    currentOpportunityCount: currentFrequency.opportunityCount,
    priorAssignmentRate: priorFrequency.assignmentRate,
    currentAssignmentRate: currentFrequency.assignmentRate,
    absoluteRateChange,
    status: !sufficient
      ? "insufficient_evidence"
      : absoluteRateChange! >= options.absoluteRateChangeThreshold
        ? "change_candidate"
        : "stable_within_threshold",
    interpretation: "descriptive_only",
  };
}

export function buildStarTrendResult(
  observations: readonly StarTrendObservation[],
  periods: readonly StarTrendPeriod[],
  options: StarTrendDetectionOptions,
): StarTrendResult {
  assertPeriods(periods);
  if (
    !Number.isSafeInteger(options.minimumOpportunityCount) ||
    options.minimumOpportunityCount <= 0 ||
    !Number.isFinite(options.absoluteRateChangeThreshold) ||
    options.absoluteRateChangeThreshold < 0 ||
    options.absoluteRateChangeThreshold > 1
  ) {
    throw new Error("Invalid star trend detection options.");
  }

  const seenEventIds = new Set<string>();
  const grouped = new Map<string, StarTrendObservation[]>();
  let outsideConfiguredPeriodsCount = 0;

  for (const observation of observations) {
    assertObservation(observation);
    if (seenEventIds.has(observation.eventId)) {
      throw new Error(`Duplicate star trend event: ${observation.eventId}`);
    }
    seenEventIds.add(observation.eventId);

    const eventTime = Date.parse(observation.eventAt);
    const period = periods.find(
      (candidate) =>
        eventTime >= Date.parse(candidate.startsAt) &&
        eventTime < Date.parse(candidate.endsAt),
    );
    if (!period) {
      outsideConfiguredPeriodsCount += 1;
      continue;
    }

    const key = summaryKey(
      period.periodId,
      observation.mode,
      observation.distance,
    );
    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }

  const periodOrder = new Map(
    periods.map((period, index) => [period.periodId, index]),
  );
  const summaries = [...grouped.entries()]
    .map(([key, group]): StarTrendSummary => {
      const [periodId, mode, distance] = JSON.parse(key) as [
        string,
        RaceMode,
        number,
      ];
      const period = periods[periodOrder.get(periodId)!]!;
      return {
        periodId,
        startsAt: period.startsAt,
        endsAt: period.endsAt,
        mode,
        distance,
        eventCount: group.length,
        goldEligibleEventCount: group.filter(({ goldEligible }) => goldEligible)
          .length,
        goldIneligibleEventCount: group.filter(
          ({ goldEligible }) => !goldEligible,
        ).length,
        gold: assignmentFrequency(
          group.map(({ goldAssignmentState }) => goldAssignmentState),
        ),
        blue: assignmentFrequency(
          group.map(({ blueAssignmentState }) => blueAssignmentState),
        ),
        analyticalStatus: "descriptive_experimental",
      };
    })
    .sort(
      (left, right) =>
        left.mode.localeCompare(right.mode) ||
        left.distance - right.distance ||
        periodOrder.get(left.periodId)! - periodOrder.get(right.periodId)!,
    );

  const summariesByProfile = new Map<string, StarTrendSummary[]>();
  for (const summary of summaries) {
    const key = profileKey(summary);
    const profile = summariesByProfile.get(key) ?? [];
    profile.push(summary);
    summariesByProfile.set(key, profile);
  }

  const changeCandidates: StarChangeCandidate[] = [];
  for (const profile of summariesByProfile.values()) {
    for (let index = 1; index < profile.length; index += 1) {
      const prior = profile[index - 1]!;
      const current = profile[index]!;
      if (
        periodOrder.get(current.periodId)! -
          periodOrder.get(prior.periodId)! !==
        1
      ) {
        continue;
      }
      changeCandidates.push(changeCandidate("gold", prior, current, options));
      changeCandidates.push(changeCandidate("blue", prior, current, options));
    }
  }

  return {
    summaries,
    changeCandidates,
    outsideConfiguredPeriodsCount,
  };
}
