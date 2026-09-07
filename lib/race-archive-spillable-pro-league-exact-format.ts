import { deriveFreshness } from "@/domain/freshness";
import { coreEsportsResultRule } from "@/domain/core-esports-performance";
import type { ProLeagueExactFormatPopulationBenchmark } from "@/domain/pro-league-matchup";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import {
  spillExactSortedRaceArchiveRecords,
  type RaceArchiveExternalSortedResult,
  type RaceArchiveExternalSortedRunStore,
} from "./race-archive-external-sort";
import { exactSortedRaceArchiveStatistics } from "./race-archive-exact-sorted-statistics";
import {
  proLeagueExactFormatBenchmarkAssessment,
  publishedProLeagueRaceTypeFromArchive,
  roundedProLeagueExactFormatMetric,
  unavailableProLeagueExactFormatSupportingEvidence,
  type RaceArchiveProLeagueExactFormatBenchmark,
  type RaceArchiveProLeagueExactFormatProfile,
} from "./race-archive-pro-league-exact-format";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type AcceptedProLeagueExactFormatObservation = Readonly<{
  observation: RaceArchiveCoreAnalyticalObservation;
  raceType: string;
  distanceMetres: number;
  mapIds: RaceArchiveProLeagueExactFormatBenchmark["mapIds"];
}>;

type AcceptedObservation = AcceptedProLeagueExactFormatObservation;

type CoreMetadata = Readonly<{
  sourceCoreId: string;
  raceCount: number;
  winCount: number;
  topThreeCount: number;
  dataCurrentThrough: string;
}>;

export type SpillableProLeagueExactFormatRow =
  | Readonly<{
      kind: "benchmark";
      value: RaceArchiveProLeagueExactFormatBenchmark;
    }>
  | Readonly<{
      kind: "profile";
      value: RaceArchiveProLeagueExactFormatProfile;
    }>;

export type SpillableProLeagueExactFormatSource = Readonly<{
  inputObservationCount: number;
  acceptedPublishedCellEntryCount: number;
  nonBikeEntryCount: number;
  missingFormatEntryCount: number;
  unsupportedFormatEntryCount: number;
  unpublishedCellEntryCount: number;
  preparationInitialRunCount: number;
  unbenchmarkedPublishedCellEntryCount: () => number;
  readRows: () => AsyncIterable<SpillableProLeagueExactFormatRow>;
  cleanup: () => Promise<void>;
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

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function normalizedTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) {
    throw new Error(`${field} must be a valid timestamp`);
  }
  return parsed.toISOString();
}

function naturalKey(value: RaceArchiveCoreAnalyticalObservation): string {
  return safeText(value.naturalKey, "observation.naturalKey");
}

function naturalKeyOrder(
  left: RaceArchiveCoreAnalyticalObservation,
  right: RaceArchiveCoreAnalyticalObservation,
): number {
  return naturalKey(left).localeCompare(naturalKey(right));
}

function acceptedCellKey(value: AcceptedObservation): string {
  return JSON.stringify([value.raceType.toLowerCase(), value.distanceMetres]);
}

function acceptedCellOrder(
  left: AcceptedObservation,
  right: AcceptedObservation,
): number {
  return (
    left.raceType.localeCompare(right.raceType) ||
    left.distanceMetres - right.distanceMetres ||
    left.observation.elapsedMilliseconds -
      right.observation.elapsedMilliseconds ||
    left.observation.sourceCoreId.localeCompare(
      right.observation.sourceCoreId,
    ) ||
    left.observation.eventAt.localeCompare(right.observation.eventAt) ||
    left.observation.naturalKey.localeCompare(right.observation.naturalKey)
  );
}

function acceptedCoreOrder(
  left: AcceptedObservation,
  right: AcceptedObservation,
): number {
  return (
    left.observation.sourceCoreId.localeCompare(
      right.observation.sourceCoreId,
    ) ||
    left.observation.elapsedMilliseconds -
      right.observation.elapsedMilliseconds ||
    left.observation.eventAt.localeCompare(right.observation.eventAt) ||
    left.observation.naturalKey.localeCompare(right.observation.naturalKey)
  );
}

async function closeIterator<T>(iterator: AsyncIterator<T>): Promise<void> {
  if (iterator.return !== undefined) await iterator.return();
}

function qualifyingElapsedValues(input: {
  store: RaceArchiveExternalSortedRunStore<AcceptedObservation>;
  runId: string;
  maximumFinishPosition: number;
}): AsyncIterable<number> {
  return (async function* () {
    for await (const value of input.store.readRun({ runId: input.runId })) {
      if (value.observation.finishPosition <= input.maximumFinishPosition) {
        yield value.observation.elapsedMilliseconds;
      }
    }
  })();
}

function percentilePosition(count: number, fraction: number) {
  const position = (count - 1) * fraction;
  return Object.freeze({
    lowerIndex: Math.floor(position),
    upperIndex: Math.ceil(position),
    fractionAboveLower: position - Math.floor(position),
  });
}

function capturedPercentile(input: {
  position: ReturnType<typeof percentilePosition>;
  captured: ReadonlyMap<number, number>;
}): number {
  const lower = input.captured.get(input.position.lowerIndex);
  const upper = input.captured.get(input.position.upperIndex);
  if (lower === undefined || upper === undefined) {
    throw new Error("Pro League exact-format percentile is unavailable");
  }
  return lower + (upper - lower) * input.position.fractionAboveLower;
}

async function profileStatistics(input: {
  iterator: AsyncIterator<AcceptedObservation>;
  first: IteratorResult<AcceptedObservation>;
  metadata: CoreMetadata;
}): Promise<
  Readonly<{
    elapsedTime: RaceArchiveProLeagueExactFormatProfile["elapsedTime"];
    carry: IteratorResult<AcceptedObservation>;
  }>
> {
  const p25 = percentilePosition(input.metadata.raceCount, 0.25);
  const median = percentilePosition(input.metadata.raceCount, 0.5);
  const p75 = percentilePosition(input.metadata.raceCount, 0.75);
  const captureIndices = new Set([
    p25.lowerIndex,
    p25.upperIndex,
    median.lowerIndex,
    median.upperIndex,
    p75.lowerIndex,
    p75.upperIndex,
  ]);
  const trimCount =
    input.metadata.raceCount < 10
      ? 0
      : Math.floor(input.metadata.raceCount * 0.1);
  let index = 0;
  let runningMean = 0;
  let varianceAccumulator = 0;
  let trimmedSum = 0;
  let best: number | null = null;
  let previous: number | null = null;
  const captured = new Map<number, number>();
  let current = input.first;

  while (!current.done) {
    const value = current.value;
    const sourceCoreId = safeText(
      value.observation.sourceCoreId,
      "observation.sourceCoreId",
      256,
    );
    if (sourceCoreId !== input.metadata.sourceCoreId) break;
    const elapsed = positiveSafeInteger(
      value.observation.elapsedMilliseconds,
      "observation.elapsedMilliseconds",
    );
    if (previous !== null && elapsed < previous) {
      throw new Error("Pro League exact-format Core values are not sorted");
    }
    if (best === null) best = elapsed;
    if (captureIndices.has(index)) captured.set(index, elapsed);
    if (index >= trimCount && index < input.metadata.raceCount - trimCount) {
      trimmedSum += elapsed;
    }
    const difference = elapsed - runningMean;
    runningMean += difference / (index + 1);
    varianceAccumulator += difference * (elapsed - runningMean);
    previous = elapsed;
    index += 1;
    if (index > input.metadata.raceCount) {
      throw new Error("Pro League exact-format Core count was exceeded");
    }
    current = await input.iterator.next();
  }
  if (index !== input.metadata.raceCount || best === null) {
    throw new Error("Pro League exact-format Core count changed");
  }
  const p25Value = capturedPercentile({ position: p25, captured });
  const p75Value = capturedPercentile({ position: p75, captured });
  const trimmedCount = index - trimCount * 2;
  return Object.freeze({
    elapsedTime: Object.freeze({
      bestMilliseconds: best,
      medianMilliseconds: roundedProLeagueExactFormatMetric(
        capturedPercentile({ position: median, captured }),
      ),
      trimmedMeanMilliseconds: roundedProLeagueExactFormatMetric(
        trimmedSum / trimmedCount,
      ),
      standardDeviationMilliseconds: roundedProLeagueExactFormatMetric(
        Math.sqrt(Math.max(0, varianceAccumulator / index)),
      ),
      interquartileRangeMilliseconds: roundedProLeagueExactFormatMetric(
        p75Value - p25Value,
      ),
    }),
    carry: current,
  });
}

async function coreMetadata(input: {
  sorted: RaceArchiveExternalSortedResult<AcceptedObservation>;
  maximumProfilesRemaining: number;
}): Promise<readonly CoreMetadata[]> {
  const values: CoreMetadata[] = [];
  let active:
    | {
        sourceCoreId: string;
        raceCount: number;
        winCount: number;
        topThreeCount: number;
        dataCurrentThrough: string;
      }
    | undefined;
  for await (const value of input.sorted.read()) {
    const sourceCoreId = safeText(
      value.observation.sourceCoreId,
      "observation.sourceCoreId",
      256,
    );
    const eventAt = normalizedTimestamp(
      value.observation.eventAt,
      "observation.eventAt",
    );
    if (active?.sourceCoreId !== sourceCoreId) {
      if (active !== undefined) values.push(Object.freeze(active));
      if (values.length >= input.maximumProfilesRemaining) {
        throw new Error("Pro League exact-format profile bound was exceeded");
      }
      active = {
        sourceCoreId,
        raceCount: 0,
        winCount: 0,
        topThreeCount: 0,
        dataCurrentThrough: eventAt,
      };
    }
    active.raceCount += 1;
    if (value.observation.finishPosition === 1) active.winCount += 1;
    if (value.observation.finishPosition <= 3) active.topThreeCount += 1;
    if (eventAt > active.dataCurrentThrough)
      active.dataCurrentThrough = eventAt;
  }
  if (active !== undefined) values.push(Object.freeze(active));
  if (values.length > input.maximumProfilesRemaining) {
    throw new Error("Pro League exact-format profile bound was exceeded");
  }
  return Object.freeze(values);
}

function rowsFromSorted(input: {
  sorted: RaceArchiveExternalSortedResult<AcceptedObservation>;
  store: RaceArchiveExternalSortedRunStore<AcceptedObservation>;
  runPrefix: string;
  refreshedAt: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumBenchmarks: number;
  maximumProfiles: number;
  onUnbenchmarkedPublishedCellEntries: (count: number) => void;
}): AsyncIterable<SpillableProLeagueExactFormatRow> {
  return (async function* () {
    const iterator = input.sorted.read()[Symbol.asyncIterator]();
    let carry: IteratorResult<AcceptedObservation> | null = null;
    let activeCellRunId: string | null = null;
    let activeCoreSorted: RaceArchiveExternalSortedResult<AcceptedObservation> | null =
      null;
    let benchmarkCount = 0;
    let profileCount = 0;

    try {
      while (true) {
        const firstResult = carry ?? (await iterator.next());
        carry = null;
        if (firstResult.done) return;
        const first = firstResult.value;
        const expectedCellKey = acceptedCellKey(first);
        benchmarkCount += 1;
        if (benchmarkCount > input.maximumBenchmarks) {
          throw new Error(
            "Pro League exact-format benchmark bound was exceeded",
          );
        }
        const cellRunId = `${input.runPrefix}/cell-${String(benchmarkCount).padStart(8, "0")}`;
        activeCellRunId = cellRunId;
        let raceEntryCount = 0;
        let winningEntryCount = 0;
        let topThreeEntryCount = 0;
        let dataCurrentThrough: string | null = null;

        const group = (async function* () {
          let current: IteratorResult<AcceptedObservation> = firstResult;
          while (!current.done) {
            const value = current.value;
            if (acceptedCellKey(value) !== expectedCellKey) {
              carry = current;
              return;
            }
            raceEntryCount += 1;
            if (value.observation.finishPosition === 1) winningEntryCount += 1;
            if (value.observation.finishPosition <= 3) topThreeEntryCount += 1;
            const eventAt = normalizedTimestamp(
              value.observation.eventAt,
              "observation.eventAt",
            );
            if (dataCurrentThrough === null || eventAt > dataCurrentThrough) {
              dataCurrentThrough = eventAt;
            }
            yield value;
            current = await iterator.next();
          }
          carry = current;
        })();
        await input.store.writeRun({ runId: cellRunId, records: group });
        if (raceEntryCount < 1 || dataCurrentThrough === null) {
          throw new Error("Pro League exact-format cell coverage changed");
        }
        if (winningEntryCount === 0 || topThreeEntryCount === 0) {
          input.onUnbenchmarkedPublishedCellEntries(raceEntryCount);
          await input.store.deleteRun({ runId: cellRunId });
          activeCellRunId = null;
          continue;
        }

        const winning = await exactSortedRaceArchiveStatistics({
          readValues: () =>
            qualifyingElapsedValues({
              store: input.store,
              runId: cellRunId,
              maximumFinishPosition: 1,
            }),
          expectedCount: winningEntryCount,
          maximumValues: input.maximumObservations,
        });
        const topThree = await exactSortedRaceArchiveStatistics({
          readValues: () =>
            qualifyingElapsedValues({
              store: input.store,
              runId: cellRunId,
              maximumFinishPosition: 3,
            }),
          expectedCount: topThreeEntryCount,
          maximumValues: input.maximumObservations,
        });
        activeCoreSorted = await spillExactSortedRaceArchiveRecords({
          records: input.store.readRun({ runId: cellRunId }),
          store: input.store,
          compare: acceptedCoreOrder,
          runPrefix: `${input.runPrefix}/core-${String(benchmarkCount).padStart(8, "0")}`,
          maximumRecordsInMemory: input.maximumRecordsInMemory,
          mergeFanIn: input.mergeFanIn,
          maximumInputRecords: input.maximumObservations,
          maximumRunObjects: input.maximumRunObjects,
        });
        const metadata = await coreMetadata({
          sorted: activeCoreSorted,
          maximumProfilesRemaining: input.maximumProfiles - profileCount,
        });
        const populationBenchmark: ProLeagueExactFormatPopulationBenchmark =
          Object.freeze({
            dataCurrentThrough,
            raceEntryCount,
            coreCount: metadata.length,
            winningEntryCount,
            topThreeEntryCount,
            winningP25Milliseconds: roundedProLeagueExactFormatMetric(
              winning.p25,
            ),
            winningMedianMilliseconds: roundedProLeagueExactFormatMetric(
              winning.median,
            ),
            winningP75Milliseconds: roundedProLeagueExactFormatMetric(
              winning.p75,
            ),
            winningStandardDeviationMilliseconds:
              roundedProLeagueExactFormatMetric(
                winning.populationStandardDeviation,
              ),
            winningInterquartileRangeMilliseconds:
              roundedProLeagueExactFormatMetric(winning.interquartileRange),
            topThreeP25Milliseconds: roundedProLeagueExactFormatMetric(
              topThree.p25,
            ),
            topThreeMedianMilliseconds: roundedProLeagueExactFormatMetric(
              topThree.median,
            ),
            topThreeP75Milliseconds: roundedProLeagueExactFormatMetric(
              topThree.p75,
            ),
            topThreeStandardDeviationMilliseconds:
              roundedProLeagueExactFormatMetric(
                topThree.populationStandardDeviation,
              ),
            topThreeInterquartileRangeMilliseconds:
              roundedProLeagueExactFormatMetric(topThree.interquartileRange),
          });
        const benchmark = Object.freeze({
          raceType: first.raceType,
          distanceMetres: first.distanceMetres,
          resultRule: coreEsportsResultRule(first.raceType),
          mapIds: first.mapIds,
          ...populationBenchmark,
          refreshedAt: input.refreshedAt,
        }) satisfies RaceArchiveProLeagueExactFormatBenchmark;
        yield Object.freeze({ kind: "benchmark", value: benchmark });

        const coreIterator = activeCoreSorted.read()[Symbol.asyncIterator]();
        let current = await coreIterator.next();
        try {
          for (const core of metadata) {
            if (current.done) {
              throw new Error(
                "Pro League exact-format profile coverage changed",
              );
            }
            const result = await profileStatistics({
              iterator: coreIterator,
              first: current,
              metadata: core,
            });
            current = result.carry;
            profileCount += 1;
            const elapsedTime = result.elapsedTime;
            yield Object.freeze({
              kind: "profile",
              value: Object.freeze({
                sourceCoreId: core.sourceCoreId,
                raceType: first.raceType,
                distanceMetres: first.distanceMetres,
                raceCount: core.raceCount,
                sampleStatus:
                  core.raceCount >= 10
                    ? ("minimally_analytical" as const)
                    : ("hypothesis_only" as const),
                freshness: deriveFreshness(
                  new Date(core.dataCurrentThrough),
                  new Date(input.refreshedAt),
                ),
                dataCurrentThrough: core.dataCurrentThrough,
                benchmarkAssessment: proLeagueExactFormatBenchmarkAssessment({
                  elapsedTime,
                  benchmark: populationBenchmark,
                }),
                elapsedTime,
                speed: Object.freeze({
                  bestMetresPerSecond: roundedProLeagueExactFormatMetric(
                    first.distanceMetres /
                      (elapsedTime.bestMilliseconds / 1_000),
                  ),
                  medianMetresPerSecond: roundedProLeagueExactFormatMetric(
                    first.distanceMetres /
                      (elapsedTime.medianMilliseconds / 1_000),
                  ),
                }),
                populationBenchmark,
                supportingEvidence:
                  unavailableProLeagueExactFormatSupportingEvidence({
                    winCount: core.winCount,
                    topThreeCount: core.topThreeCount,
                  }),
              }),
            });
          }
          if (!current.done) {
            throw new Error("Pro League exact-format profile coverage changed");
          }
        } finally {
          await closeIterator(coreIterator);
        }
        await activeCoreSorted.cleanup();
        activeCoreSorted = null;
        await input.store.deleteRun({ runId: cellRunId });
        activeCellRunId = null;
      }
    } finally {
      await closeIterator(iterator);
      if (activeCoreSorted !== null) await activeCoreSorted.cleanup();
      if (activeCellRunId !== null) {
        await input.store.deleteRun({ runId: activeCellRunId });
      }
      await input.sorted.cleanup();
    }
  })();
}

export async function spillableProLeagueExactFormatEvidenceFromRaceArchive(input: {
  observations: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  acceptedStore: RaceArchiveExternalSortedRunStore<AcceptedObservation>;
  runPrefix: string;
  refreshedAt: string;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumObservations: number;
  maximumRunObjects: number;
  maximumBenchmarks: number;
  maximumProfiles: number;
}): Promise<SpillableProLeagueExactFormatSource> {
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
  const refreshedAt = normalizedTimestamp(input.refreshedAt, "refreshedAt");
  const refreshedAtMs = Date.parse(refreshedAt);
  const maximumRecordsInMemory = positiveBound(
    input.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
  const maximumObservations = positiveBound(
    input.maximumObservations,
    "maximumObservations",
    5_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );
  const maximumBenchmarks = positiveBound(
    input.maximumBenchmarks,
    "maximumBenchmarks",
    100_000,
  );
  const maximumProfiles = positiveBound(
    input.maximumProfiles,
    "maximumProfiles",
    500_000,
  );
  let inputObservationCount = 0;
  let nonBikeEntryCount = 0;
  let missingFormatEntryCount = 0;
  let unsupportedFormatEntryCount = 0;
  let unpublishedCellEntryCount = 0;
  let unbenchmarkedPublishedCellEntryCount = 0;

  const naturalSorted = await spillExactSortedRaceArchiveRecords({
    records: (async function* () {
      for await (const value of input.observations) {
        inputObservationCount += 1;
        if (inputObservationCount > maximumObservations) {
          throw new Error(
            "Pro League exact-format observation bound was exceeded",
          );
        }
        naturalKey(value);
        normalizedTimestamp(value.eventAt, "observation.eventAt");
        positiveSafeInteger(value.versionNumber, "observation.versionNumber");
        nonNegativeSafeInteger(
          value.partitionNumber,
          "observation.partitionNumber",
        );
        positiveSafeInteger(
          value.sourceRowNumber,
          "observation.sourceRowNumber",
        );
        yield value;
      }
    })(),
    store: input.observationStore,
    compare: naturalKeyOrder,
    runPrefix: `${runPrefix}/natural-key-sort`,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputRecords: maximumObservations,
    maximumRunObjects,
  });

  let acceptedSorted:
    RaceArchiveExternalSortedResult<AcceptedObservation> | undefined;
  try {
    acceptedSorted = await spillExactSortedRaceArchiveRecords({
      records: (async function* () {
        let previousNaturalKey: string | null = null;
        for await (const observation of naturalSorted.read()) {
          const key = naturalKey(observation);
          if (key === previousNaturalKey) {
            throw new Error(
              "Pro League exact-format evidence contains a duplicate race entry",
            );
          }
          previousNaturalKey = key;
          const eventAt = normalizedTimestamp(
            observation.eventAt,
            "observation.eventAt",
          );
          if (Date.parse(eventAt) > refreshedAtMs) {
            throw new Error(
              "Pro League exact-format evidence exceeds its point-in-time cutoff",
            );
          }
          if (observation.mode !== "bike") {
            nonBikeEntryCount += 1;
            continue;
          }
          const finishPosition = positiveSafeInteger(
            observation.finishPosition,
            "observation.finishPosition",
          );
          if (finishPosition > observation.gateCount) {
            throw new Error(
              "observation.finishPosition cannot exceed observation.gateCount",
            );
          }
          positiveSafeInteger(
            observation.elapsedMilliseconds,
            "observation.elapsedMilliseconds",
          );
          const authority = publishedProLeagueRaceTypeFromArchive({
            payoutMechanismSourceValue: observation.payoutMechanismSourceValue,
            gateCount: observation.gateCount,
            distanceMetres: observation.distance,
          });
          if (authority.status !== "accepted") {
            if (authority.status === "missing_format") {
              missingFormatEntryCount += 1;
            }
            if (authority.status === "unsupported_format") {
              unsupportedFormatEntryCount += 1;
            }
            if (authority.status === "unpublished_cell") {
              unpublishedCellEntryCount += 1;
            }
            continue;
          }
          safeText(observation.sourceCoreId, "observation.sourceCoreId", 256);
          yield Object.freeze({
            observation,
            raceType: authority.cell.raceType,
            distanceMetres: authority.cell.distanceMetres,
            mapIds: authority.cell.mapIds,
          });
        }
      })(),
      store: input.acceptedStore,
      compare: acceptedCellOrder,
      runPrefix: `${runPrefix}/published-cell-sort`,
      maximumRecordsInMemory,
      mergeFanIn,
      maximumInputRecords: maximumObservations,
      maximumRunObjects,
    });
    await naturalSorted.cleanup();
  } catch (error) {
    await naturalSorted.cleanup().catch(() => undefined);
    if (acceptedSorted !== undefined) {
      await acceptedSorted.cleanup().catch(() => undefined);
    }
    throw error;
  }

  const preparedAcceptedSorted = acceptedSorted;
  if (preparedAcceptedSorted === undefined) {
    throw new Error("Pro League exact-format preparation did not complete");
  }

  let readStarted = false;
  let cleaned = false;
  return Object.freeze({
    inputObservationCount,
    acceptedPublishedCellEntryCount: preparedAcceptedSorted.recordCount,
    nonBikeEntryCount,
    missingFormatEntryCount,
    unsupportedFormatEntryCount,
    unpublishedCellEntryCount,
    preparationInitialRunCount:
      naturalSorted.initialRunCount + preparedAcceptedSorted.initialRunCount,
    unbenchmarkedPublishedCellEntryCount() {
      return unbenchmarkedPublishedCellEntryCount;
    },
    readRows() {
      if (cleaned) {
        throw new Error("Pro League exact-format source has been cleaned");
      }
      if (readStarted) {
        throw new Error("Pro League exact-format rows are single-use");
      }
      readStarted = true;
      return rowsFromSorted({
        sorted: preparedAcceptedSorted,
        store: input.acceptedStore,
        runPrefix,
        refreshedAt,
        maximumRecordsInMemory,
        mergeFanIn,
        maximumObservations,
        maximumRunObjects,
        maximumBenchmarks,
        maximumProfiles,
        onUnbenchmarkedPublishedCellEntries(count) {
          unbenchmarkedPublishedCellEntryCount += count;
        },
      });
    },
    async cleanup() {
      if (cleaned) return;
      if (readStarted) {
        throw new Error("Pro League exact-format read owns scratch cleanup");
      }
      await preparedAcceptedSorted.cleanup();
      cleaned = true;
    },
  });
}
