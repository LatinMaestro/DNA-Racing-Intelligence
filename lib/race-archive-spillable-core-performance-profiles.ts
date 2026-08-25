import type { RaceMode } from "@/domain/import-contract";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveCorePerformanceProfile } from "./race-archive-core-performance-profiles";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import { spillExactSortedRaceArchiveRecords } from "./race-archive-external-sort";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const RACE_MODES = new Set<RaceMode>(["bike", "car", "horse"]);

export type RaceArchiveCorePerformanceSummary = Readonly<{
  sourceCoreId: string;
  mode: RaceMode;
  distance: number;
  raceCount: number;
  elapsedSum: number;
  dataCurrentThrough: string;
}>;

function safeText(value: string, field: string, maximumLength = 512): string {
  const normalized = value.trim();
  if (
    normalized.length < 1 ||
    normalized.length > maximumLength ||
    CONTROL_CHARACTER_PATTERN.test(normalized)
  ) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

function positiveFinite(value: number, field: string): number {
  if (!Number.isFinite(value) || value <= 0) {
    throw new Error(`${field} must be a positive finite number`);
  }
  return value;
}

function mode(value: RaceMode): RaceMode {
  if (!RACE_MODES.has(value))
    throw new Error("Race archive Core Performance mode is invalid.");
  return value;
}

function timestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime()))
    throw new Error(`${field} must be a valid timestamp`);
  return parsed.toISOString();
}

function groupKey(input: {
  sourceCoreId: string;
  mode: RaceMode;
  distance: number;
}): string {
  return `${input.sourceCoreId}\u0000${input.mode}\u0000${input.distance}`;
}

function normalizedObservation(
  observation: RaceArchiveCoreAnalyticalObservation,
): RaceArchiveCoreAnalyticalObservation {
  const sourceCoreId = safeText(
    observation.sourceCoreId,
    "observation.sourceCoreId",
  );
  const naturalKey = safeText(observation.naturalKey, "observation.naturalKey");
  const raceMode = mode(observation.mode);
  const distance = positiveSafeInteger(
    observation.distance,
    "observation.distance",
  );
  const elapsedMilliseconds = positiveSafeInteger(
    observation.elapsedMilliseconds,
    "observation.elapsedMilliseconds",
  );
  const eventAt = timestamp(observation.eventAt, "observation.eventAt");
  return Object.freeze({
    ...observation,
    sourceCoreId,
    naturalKey,
    mode: raceMode,
    distance,
    elapsedMilliseconds,
    eventAt,
  });
}

function compareObservations(
  left: RaceArchiveCoreAnalyticalObservation,
  right: RaceArchiveCoreAnalyticalObservation,
): number {
  return (
    left.sourceCoreId.localeCompare(right.sourceCoreId) ||
    left.mode.localeCompare(right.mode) ||
    left.distance - right.distance ||
    left.elapsedMilliseconds - right.elapsedMilliseconds ||
    left.naturalKey.localeCompare(right.naturalKey)
  );
}

function compareProfileGroups(
  left: Pick<
    RaceArchiveCorePerformanceSummary,
    "sourceCoreId" | "mode" | "distance"
  >,
  right: Pick<
    RaceArchiveCorePerformanceSummary,
    "sourceCoreId" | "mode" | "distance"
  >,
): number {
  return (
    left.sourceCoreId.localeCompare(right.sourceCoreId) ||
    left.mode.localeCompare(right.mode) ||
    left.distance - right.distance
  );
}

function normalizedSummary(
  value: RaceArchiveCorePerformanceSummary,
): RaceArchiveCorePerformanceSummary {
  return Object.freeze({
    sourceCoreId: safeText(value.sourceCoreId, "summary.sourceCoreId"),
    mode: mode(value.mode),
    distance: positiveSafeInteger(value.distance, "summary.distance"),
    raceCount: positiveSafeInteger(value.raceCount, "summary.raceCount"),
    elapsedSum: positiveFinite(value.elapsedSum, "summary.elapsedSum"),
    dataCurrentThrough: timestamp(
      value.dataCurrentThrough,
      "summary.dataCurrentThrough",
    ),
  });
}

export function encodeRaceArchiveCorePerformanceSummary(
  value: RaceArchiveCorePerformanceSummary,
): Uint8Array {
  const summary = normalizedSummary(value);
  return new TextEncoder().encode(`${JSON.stringify(summary)}\n`);
}

export function decodeRaceArchiveCorePerformanceSummaryLine(
  line: string,
): RaceArchiveCorePerformanceSummary {
  let parsed: unknown;
  try {
    parsed = JSON.parse(line);
  } catch {
    throw new Error("Race archive Core Performance summary JSON is invalid.");
  }
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error("Race archive Core Performance summary is invalid.");
  }
  const value = parsed as Partial<RaceArchiveCorePerformanceSummary>;
  if (
    typeof value.sourceCoreId !== "string" ||
    typeof value.mode !== "string" ||
    typeof value.distance !== "number" ||
    typeof value.raceCount !== "number" ||
    typeof value.elapsedSum !== "number" ||
    typeof value.dataCurrentThrough !== "string"
  ) {
    throw new Error("Race archive Core Performance summary is incomplete.");
  }
  return normalizedSummary(value as RaceArchiveCorePerformanceSummary);
}

function percentilePosition(
  count: number,
  fraction: number,
): Readonly<{
  lowerIndex: number;
  upperIndex: number;
  fractionAboveLower: number;
}> {
  const position = (count - 1) * fraction;
  const lowerIndex = Math.floor(position);
  return Object.freeze({
    lowerIndex,
    upperIndex: Math.ceil(position),
    fractionAboveLower: position - lowerIndex,
  });
}

function percentile(input: {
  position: ReturnType<typeof percentilePosition>;
  captured: ReadonlyMap<number, number>;
}): number {
  const lower = input.captured.get(input.position.lowerIndex);
  const upper = input.captured.get(input.position.upperIndex);
  if (lower === undefined || upper === undefined) {
    throw new Error(
      "Race archive Core Performance percentile evidence is unavailable.",
    );
  }
  if (input.position.lowerIndex === input.position.upperIndex) return lower;
  return lower + (upper - lower) * input.position.fractionAboveLower;
}

function summariesFromSortedObservations(input: {
  read: () => AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  expectedObservationCount: number;
  maximumProfiles: number;
}): AsyncIterable<RaceArchiveCorePerformanceSummary> {
  return (async function* () {
    let current:
      | {
          sourceCoreId: string;
          mode: RaceMode;
          distance: number;
          raceCount: number;
          elapsedSum: number;
          dataCurrentThrough: string;
        }
      | undefined;
    let observationCount = 0;
    let profileCount = 0;

    const emitCurrent = (): RaceArchiveCorePerformanceSummary => {
      if (current === undefined) {
        throw new Error(
          "Race archive Core Performance summary state is unavailable.",
        );
      }
      return normalizedSummary(current);
    };

    for await (const rawObservation of input.read()) {
      observationCount += 1;
      if (observationCount > input.expectedObservationCount) {
        throw new Error(
          "Race archive Core Performance observation coverage increased.",
        );
      }
      const observation = normalizedObservation(rawObservation);
      const key = groupKey(observation);
      const currentKey = current === undefined ? null : groupKey(current);
      if (currentKey !== key) {
        if (current !== undefined) yield emitCurrent();
        profileCount += 1;
        if (profileCount > input.maximumProfiles) {
          throw new Error(
            "Race archive Core Performance profile bound was exceeded.",
          );
        }
        current = {
          sourceCoreId: observation.sourceCoreId,
          mode: observation.mode,
          distance: observation.distance,
          raceCount: 0,
          elapsedSum: 0,
          dataCurrentThrough: observation.eventAt,
        };
      }
      if (current === undefined) {
        throw new Error(
          "Race archive Core Performance summary state is unavailable.",
        );
      }
      current.raceCount += 1;
      current.elapsedSum += observation.elapsedMilliseconds;
      if (!Number.isFinite(current.elapsedSum)) {
        throw new Error(
          "Race archive Core Performance elapsed sum overflowed.",
        );
      }
      if (observation.eventAt > current.dataCurrentThrough) {
        current.dataCurrentThrough = observation.eventAt;
      }
    }

    if (observationCount !== input.expectedObservationCount) {
      throw new Error(
        "Race archive Core Performance observation coverage changed.",
      );
    }
    if (current !== undefined) yield emitCurrent();
  })();
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

export async function spillableCorePerformanceProfilesFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  summaryStore: RaceArchiveExternalSortedRunStore<RaceArchiveCorePerformanceSummary>;
  runPrefix: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumInputObservations: number;
  maximumRunObjects: number;
  maximumProfiles: number;
}): Promise<readonly RaceArchiveCorePerformanceProfile[]> {
  const runPrefix = safeText(input.runPrefix, "runPrefix", 180);
  const maximumInputObservations = positiveBound(
    input.maximumInputObservations,
    "maximumInputObservations",
    100_000_000,
  );
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    100_000,
  );
  const sorted = await spillExactSortedRaceArchiveRecords({
    records: input.observations,
    store: input.observationStore,
    compare: compareObservations,
    runPrefix: `${runPrefix}/core-performance-observations`,
    maximumRecordsInMemory: input.maximumRecordsInMemory,
    mergeFanIn: input.mergeFanIn,
    maximumInputRecords: maximumInputObservations,
    maximumRunObjects: input.maximumRunObjects,
  });
  const summaryRunId = `${runPrefix}/core-performance-summaries`;
  let summaryWritten = false;

  try {
    if (sorted.recordCount < 1) {
      throw new Error("Race archive Core Performance requires observations.");
    }
    await input.summaryStore.writeRun({
      runId: summaryRunId,
      records: summariesFromSortedObservations({
        read: sorted.read,
        expectedObservationCount: sorted.recordCount,
        maximumProfiles,
      }),
    });
    summaryWritten = true;

    const observationIterator = sorted.read()[Symbol.asyncIterator]();
    const summaryIterator = input.summaryStore
      .readRun({ runId: summaryRunId })
      [Symbol.asyncIterator]();
    const profiles: RaceArchiveCorePerformanceProfile[] = [];
    let consumedObservationCount = 0;
    let previousSummary: RaceArchiveCorePerformanceSummary | null = null;

    try {
      while (true) {
        const summaryResult = await summaryIterator.next();
        if (summaryResult.done) break;
        const summary = normalizedSummary(summaryResult.value);
        const summaryKey = groupKey(summary);
        if (
          previousSummary !== null &&
          compareProfileGroups(summary, previousSummary) <= 0
        ) {
          throw new Error(
            "Race archive Core Performance summaries are not ordered.",
          );
        }
        previousSummary = summary;
        if (profiles.length >= maximumProfiles) {
          throw new Error(
            "Race archive Core Performance profile bound was exceeded.",
          );
        }

        const p25Position = percentilePosition(summary.raceCount, 0.25);
        const medianPosition = percentilePosition(summary.raceCount, 0.5);
        const p75Position = percentilePosition(summary.raceCount, 0.75);
        const captureIndices = new Set<number>([
          p25Position.lowerIndex,
          p25Position.upperIndex,
          medianPosition.lowerIndex,
          medianPosition.upperIndex,
          p75Position.lowerIndex,
          p75Position.upperIndex,
        ]);
        const captured = new Map<number, number>();
        const meanMilliseconds = summary.elapsedSum / summary.raceCount;
        const trimCount =
          summary.raceCount < 10 ? 0 : Math.floor(summary.raceCount * 0.1);
        const trimEndIndexExclusive = summary.raceCount - trimCount;
        let trimmedSum = 0;
        let varianceTotal = 0;
        let bestMilliseconds: number | undefined;
        let previousElapsed: number | undefined;
        let replayElapsedSum = 0;
        let replayCurrentThrough: string | null = null;

        for (let index = 0; index < summary.raceCount; index += 1) {
          const observationResult = await observationIterator.next();
          if (observationResult.done) {
            throw new Error(
              "Race archive Core Performance observations ended early.",
            );
          }
          consumedObservationCount += 1;
          const observation = normalizedObservation(observationResult.value);
          if (groupKey(observation) !== summaryKey) {
            throw new Error(
              "Race archive Core Performance summary group changed.",
            );
          }
          const elapsed = observation.elapsedMilliseconds;
          if (previousElapsed !== undefined && elapsed < previousElapsed) {
            throw new Error(
              "Race archive Core Performance elapsed evidence is not sorted.",
            );
          }
          if (bestMilliseconds === undefined) bestMilliseconds = elapsed;
          if (captureIndices.has(index)) captured.set(index, elapsed);
          if (index >= trimCount && index < trimEndIndexExclusive)
            trimmedSum += elapsed;
          varianceTotal += (elapsed - meanMilliseconds) ** 2;
          replayElapsedSum += elapsed;
          previousElapsed = elapsed;
          if (
            replayCurrentThrough === null ||
            observation.eventAt > replayCurrentThrough
          ) {
            replayCurrentThrough = observation.eventAt;
          }
        }

        if (
          bestMilliseconds === undefined ||
          replayCurrentThrough === null ||
          replayElapsedSum !== summary.elapsedSum ||
          replayCurrentThrough !== summary.dataCurrentThrough
        ) {
          throw new Error(
            "Race archive Core Performance summary evidence changed.",
          );
        }
        const p25 = percentile({ position: p25Position, captured });
        const medianMilliseconds = percentile({
          position: medianPosition,
          captured,
        });
        const p75 = percentile({ position: p75Position, captured });
        const trimmedCount = summary.raceCount - trimCount * 2;
        if (trimmedCount < 1) {
          throw new Error(
            "Race archive Core Performance trimmed count is invalid.",
          );
        }
        profiles.push(
          Object.freeze({
            sourceCoreId: summary.sourceCoreId,
            mode: summary.mode,
            distance: summary.distance,
            dataCurrentThrough: summary.dataCurrentThrough,
            raceCount: summary.raceCount,
            bestMilliseconds,
            medianMilliseconds,
            meanMilliseconds,
            trimmedMeanMilliseconds: trimmedSum / trimmedCount,
            standardDeviationMilliseconds: Math.sqrt(
              varianceTotal / summary.raceCount,
            ),
            interquartileRangeMilliseconds: p75 - p25,
            bestMetresPerSecond: summary.distance / (bestMilliseconds / 1000),
            medianMetresPerSecond:
              summary.distance / (medianMilliseconds / 1000),
          }),
        );
      }

      const extraObservation = await observationIterator.next();
      if (
        !extraObservation.done ||
        consumedObservationCount !== sorted.recordCount
      ) {
        throw new Error(
          "Race archive Core Performance observation coverage changed.",
        );
      }
    } finally {
      await Promise.all([
        closeIterator(observationIterator),
        closeIterator(summaryIterator),
      ]);
    }

    if (profiles.length < 1) {
      throw new Error("Race archive Core Performance produced no profiles.");
    }
    return Object.freeze(profiles);
  } finally {
    const cleanupFailures: unknown[] = [];
    if (summaryWritten) {
      try {
        await input.summaryStore.deleteRun({ runId: summaryRunId });
      } catch (error) {
        cleanupFailures.push(error);
      }
    }
    try {
      await sorted.cleanup();
    } catch (error) {
      cleanupFailures.push(error);
    }
    if (cleanupFailures.length > 0) {
      throw new Error("Race archive Core Performance scratch cleanup failed.");
    }
  }
}
