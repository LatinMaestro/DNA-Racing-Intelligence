import type { RaceMode } from "@/domain/core-performance";

export type InTheMoneyStatus = "yes" | "no" | "unknown";
export type BenchmarkEventDataStatus = "complete" | "partial";

export type BenchmarkObservation = Readonly<{
  eventId: string;
  eventAt: string;
  coreId: string;
  mode: RaceMode;
  distance: number;
  gateCount: number;
  historicalFormatLabel: string | null;
  eventDataStatus: BenchmarkEventDataStatus;
  elapsedTimeMilliseconds: number;
  finishingPosition: number;
  inTheMoneyStatus: InTheMoneyStatus;
}>;

export type ElapsedDistribution = Readonly<{
  sampleCount: number;
  fastestMilliseconds: number;
  percentile10Milliseconds: number;
  percentile25Milliseconds: number;
  medianMilliseconds: number;
  percentile75Milliseconds: number;
  percentile90Milliseconds: number;
  slowestMilliseconds: number;
}>;

export type PerformanceBenchmark = Readonly<{
  mode: RaceMode;
  distance: number;
  gateCount: number;
  historicalFormatLabel: string | null;
  dataCurrentThrough: string;
  entryCount: number;
  eventCount: number;
  overallElapsed: ElapsedDistribution;
  winnerElapsed: ElapsedDistribution | null;
  inTheMoneyElapsed: ElapsedDistribution | null;
  inTheMoneyCoverage: Readonly<{
    knownCount: number;
    unknownCount: number;
    positiveCount: number;
  }>;
  outcomeCoverage: Readonly<{
    completeEventCount: number;
    partialEventCount: number;
  }>;
  analyticalStatus: "experimental";
}>;

export type BenchmarkPercentile = Readonly<{
  fasterThanOrEqualPercentage: number;
  sampleCount: number;
  direction: "higher_is_better";
}>;

const modes: readonly RaceMode[] = ["bike", "car", "horse"];
const inTheMoneyStatuses: readonly InTheMoneyStatus[] = [
  "yes",
  "no",
  "unknown",
];
const eventDataStatuses: readonly BenchmarkEventDataStatus[] = [
  "complete",
  "partial",
];

function assertObservation(observation: BenchmarkObservation): void {
  if (
    observation.eventId.trim() === "" ||
    observation.coreId.trim() === "" ||
    Number.isNaN(Date.parse(observation.eventAt)) ||
    !modes.includes(observation.mode) ||
    !Number.isSafeInteger(observation.distance) ||
    observation.distance <= 0 ||
    !Number.isSafeInteger(observation.gateCount) ||
    observation.gateCount <= 0 ||
    !Number.isSafeInteger(observation.elapsedTimeMilliseconds) ||
    observation.elapsedTimeMilliseconds <= 0 ||
    !Number.isSafeInteger(observation.finishingPosition) ||
    observation.finishingPosition <= 0 ||
    observation.finishingPosition > observation.gateCount ||
    !inTheMoneyStatuses.includes(observation.inTheMoneyStatus) ||
    !eventDataStatuses.includes(observation.eventDataStatus)
  ) {
    throw new Error(
      `Invalid benchmark observation: ${observation.eventId}|${observation.coreId}`,
    );
  }
}

function normalizedFormat(value: string | null): string | null {
  if (value === null) return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function contextKey(
  observation: Pick<
    BenchmarkObservation,
    "mode" | "distance" | "gateCount" | "historicalFormatLabel"
  >,
): string {
  return JSON.stringify([
    observation.mode,
    observation.distance,
    observation.gateCount,
    normalizedFormat(observation.historicalFormatLabel),
  ]);
}

function quantile(
  sortedValues: readonly number[],
  probability: number,
): number {
  const index = (sortedValues.length - 1) * probability;
  const lowerIndex = Math.floor(index);
  const upperIndex = Math.ceil(index);
  const lower = sortedValues[lowerIndex]!;
  const upper = sortedValues[upperIndex]!;
  return lower + (upper - lower) * (index - lowerIndex);
}

function rounded(value: number): number {
  return Math.round(value * 1_000) / 1_000;
}

function distribution(values: readonly number[]): ElapsedDistribution | null {
  if (values.length === 0) return null;
  const sorted = [...values].sort((left, right) => left - right);

  return {
    sampleCount: sorted.length,
    fastestMilliseconds: sorted[0]!,
    percentile10Milliseconds: rounded(quantile(sorted, 0.1)),
    percentile25Milliseconds: rounded(quantile(sorted, 0.25)),
    medianMilliseconds: rounded(quantile(sorted, 0.5)),
    percentile75Milliseconds: rounded(quantile(sorted, 0.75)),
    percentile90Milliseconds: rounded(quantile(sorted, 0.9)),
    slowestMilliseconds: sorted.at(-1)!,
  };
}

function summarize(
  observations: readonly BenchmarkObservation[],
): PerformanceBenchmark {
  const first = observations[0]!;
  const events = new Map<string, BenchmarkObservation[]>();
  for (const observation of observations) {
    const event = events.get(observation.eventId) ?? [];
    event.push(observation);
    events.set(observation.eventId, event);
  }

  const completeEvents: BenchmarkObservation[][] = [];
  let partialEventCount = 0;
  for (const [eventId, event] of events) {
    const statuses = new Set(
      event.map(({ eventDataStatus }) => eventDataStatus),
    );
    if (statuses.size !== 1) {
      throw new Error(`Conflicting benchmark event completeness: ${eventId}`);
    }

    if (event[0]!.eventDataStatus === "partial") {
      partialEventCount += 1;
      continue;
    }

    if (
      event.length !== event[0]!.gateCount ||
      event.filter(({ finishingPosition }) => finishingPosition === 1)
        .length !== 1
    ) {
      throw new Error(`Invalid complete benchmark event: ${eventId}`);
    }
    completeEvents.push(event);
  }
  const completeOutcomeEntries = completeEvents.flat();
  const overallElapsed = distribution(
    observations.map((observation) => observation.elapsedTimeMilliseconds),
  )!;
  const winners = completeOutcomeEntries.filter(
    (observation) => observation.finishingPosition === 1,
  );
  const knownInTheMoney = completeOutcomeEntries.filter(
    (observation) => observation.inTheMoneyStatus !== "unknown",
  );
  const inTheMoney = knownInTheMoney.filter(
    (observation) => observation.inTheMoneyStatus === "yes",
  );
  const dataCurrentThrough = observations.reduce(
    (latest, observation) =>
      Date.parse(observation.eventAt) > Date.parse(latest)
        ? observation.eventAt
        : latest,
    first.eventAt,
  );

  return {
    mode: first.mode,
    distance: first.distance,
    gateCount: first.gateCount,
    historicalFormatLabel: normalizedFormat(first.historicalFormatLabel),
    dataCurrentThrough,
    entryCount: observations.length,
    eventCount: new Set(observations.map(({ eventId }) => eventId)).size,
    overallElapsed,
    winnerElapsed: distribution(
      winners.map((observation) => observation.elapsedTimeMilliseconds),
    ),
    inTheMoneyElapsed: distribution(
      inTheMoney.map((observation) => observation.elapsedTimeMilliseconds),
    ),
    inTheMoneyCoverage: {
      knownCount: knownInTheMoney.length,
      unknownCount: completeOutcomeEntries.length - knownInTheMoney.length,
      positiveCount: inTheMoney.length,
    },
    outcomeCoverage: {
      completeEventCount: completeEvents.length,
      partialEventCount,
    },
    analyticalStatus: "experimental",
  };
}

export function buildPerformanceBenchmarks(
  observations: readonly BenchmarkObservation[],
): readonly PerformanceBenchmark[] {
  const seenEntries = new Set<string>();
  const eventContexts = new Map<string, string>();
  const grouped = new Map<string, BenchmarkObservation[]>();

  for (const sourceObservation of observations) {
    const observation = {
      ...sourceObservation,
      historicalFormatLabel: normalizedFormat(
        sourceObservation.historicalFormatLabel,
      ),
    };
    assertObservation(observation);

    const entryKey = JSON.stringify([observation.eventId, observation.coreId]);
    if (seenEntries.has(entryKey)) {
      throw new Error(
        `Duplicate benchmark observation: ${observation.eventId}|${observation.coreId}`,
      );
    }
    seenEntries.add(entryKey);

    const key = contextKey(observation);
    const priorContext = eventContexts.get(observation.eventId);
    if (priorContext !== undefined && priorContext !== key) {
      throw new Error(
        `Conflicting benchmark event context: ${observation.eventId}`,
      );
    }
    eventContexts.set(observation.eventId, key);

    const group = grouped.get(key) ?? [];
    group.push(observation);
    grouped.set(key, group);
  }

  return [...grouped.values()]
    .map(summarize)
    .sort(
      (left, right) =>
        left.mode.localeCompare(right.mode) ||
        left.distance - right.distance ||
        left.gateCount - right.gateCount ||
        (left.historicalFormatLabel ?? "").localeCompare(
          right.historicalFormatLabel ?? "",
        ),
    );
}

export function elapsedBenchmarkPercentile(
  elapsedTimeMilliseconds: number,
  benchmarkElapsedValues: readonly number[],
): BenchmarkPercentile {
  if (
    !Number.isSafeInteger(elapsedTimeMilliseconds) ||
    elapsedTimeMilliseconds <= 0 ||
    benchmarkElapsedValues.length === 0 ||
    benchmarkElapsedValues.some(
      (value) => !Number.isSafeInteger(value) || value <= 0,
    )
  ) {
    throw new Error("A benchmark percentile requires positive integer times.");
  }

  const fasterThanOrEqualCount = benchmarkElapsedValues.filter(
    (value) => value >= elapsedTimeMilliseconds,
  ).length;

  return {
    fasterThanOrEqualPercentage: rounded(
      (fasterThanOrEqualCount / benchmarkElapsedValues.length) * 100,
    ),
    sampleCount: benchmarkElapsedValues.length,
    direction: "higher_is_better",
  };
}
