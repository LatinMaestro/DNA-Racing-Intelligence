import type { CoreStarProfile } from "@/domain/star-signals";
import type { RaceArchiveAggregatePublicationRows } from "./race-archive-aggregate-publication-service";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import type { RaceArchiveAggregateRefreshPlanVersion } from "./race-archive-aggregate-refresher";
import { spillableCorePerformanceProfilesFromRaceArchive } from "./race-archive-spillable-core-performance";
import { spillableDiscoveryExactDistanceBenchmarksFromRaceArchive } from "./race-archive-spillable-discovery-benchmarks";
import { prepareSpillableRaceArchiveObservations } from "./race-archive-spillable-observation-source";
import { spillableCorePayoutFormatProfilesFromRaceArchive } from "./race-archive-spillable-payout-format-profiles";
import { spillableStarProfilesFromRaceArchive } from "./race-archive-spillable-star-family";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;

export type SpillableRaceArchivePublicationRebuild = Readonly<{
  rows: RaceArchiveAggregatePublicationRows;
  uniqueObservationCount: number;
  validatedEventCount: number;
  acceptedFormatEntryCount: number;
}>;

export type SpillableRaceArchivePublicationRebuildBounds = Readonly<{
  maximumArchivePartitions: number;
  maximumRecordsInMemory: number;
  mergeFanIn: number;
  maximumInputObservations: number;
  maximumRunObjects: number;
  maximumCorePerformanceProfiles: number;
  maximumDiscoveryBenchmarks: number;
  maximumPayoutFormatProfiles: number;
  maximumStarEvents: number;
  maximumStarEntriesPerEvent: number;
  maximumStarContributions: number;
  maximumStarProfiles: number;
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

async function collectRows<T>(input: {
  values: AsyncIterable<T>;
  maximumRows: number;
  field: string;
  map: (value: T) => Readonly<Record<string, unknown>>;
}): Promise<readonly Readonly<Record<string, unknown>>[]> {
  const rows: Readonly<Record<string, unknown>>[] = [];
  for await (const value of input.values) {
    if (rows.length >= input.maximumRows) {
      throw new Error(`${input.field} row bound was exceeded.`);
    }
    rows.push(Object.freeze(input.map(value)));
  }
  return Object.freeze(rows);
}

async function writeReplayableObservationRun(input: {
  source: AsyncIterable<RaceArchiveCoreAnalyticalObservation>;
  store: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  runId: string;
  maximumObservations: number;
}): Promise<number> {
  let uniqueObservationCount = 0;
  const records = (async function* () {
    for await (const observation of input.source) {
      uniqueObservationCount += 1;
      if (uniqueObservationCount > input.maximumObservations) {
        throw new Error(
          "Race archive unique observation bound was exceeded during replay preparation.",
        );
      }
      yield observation;
    }
  })();
  await input.store.writeRun({ runId: input.runId, records });
  if (uniqueObservationCount < 1) {
    await input.store.deleteRun({ runId: input.runId });
    throw new Error(
      "Race archive spillable rebuild has no unique observations.",
    );
  }
  return uniqueObservationCount;
}

async function assertObservationCoverage(input: {
  actual: number;
  expected: number;
  family: string;
  cleanup: () => Promise<void>;
}): Promise<void> {
  if (input.actual === input.expected) return;
  try {
    await input.cleanup();
  } catch (error) {
    throw new Error(
      `${input.family} observation coverage changed and scratch cleanup was incomplete.`,
      { cause: error },
    );
  }
  throw new Error(`${input.family} observation coverage changed.`);
}

export async function rebuildSpillableRaceArchivePublicationRows(input: {
  ownerId: string;
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[];
  rehydrator: RaceStagedRowRehydrator;
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  starProfileStore: RaceArchiveExternalSortedRunStore<CoreStarProfile>;
  runPrefix: string;
  refreshedAt: string;
  bounds: SpillableRaceArchivePublicationRebuildBounds;
}): Promise<SpillableRaceArchivePublicationRebuild> {
  const ownerId = safeText(input.ownerId, "ownerId", 128);
  const runPrefix = safeText(input.runPrefix, "runPrefix", 256);
  const refreshedAtDate = new Date(input.refreshedAt);
  if (Number.isNaN(refreshedAtDate.getTime())) {
    throw new Error("refreshedAt must be a valid timestamp");
  }
  const refreshedAt = refreshedAtDate.toISOString();
  const maximumArchivePartitions = positiveBound(
    input.bounds.maximumArchivePartitions,
    "maximumArchivePartitions",
    10_000,
  );
  const maximumRecordsInMemory = positiveBound(
    input.bounds.maximumRecordsInMemory,
    "maximumRecordsInMemory",
    1_000_000,
  );
  const mergeFanIn = positiveBound(input.bounds.mergeFanIn, "mergeFanIn", 256);
  if (mergeFanIn < 2) throw new Error("mergeFanIn must be at least 2");
  const maximumInputObservations = positiveBound(
    input.bounds.maximumInputObservations,
    "maximumInputObservations",
    100_000_000,
  );
  const maximumRunObjects = positiveBound(
    input.bounds.maximumRunObjects,
    "maximumRunObjects",
    1_000_000,
  );
  const maximumCorePerformanceProfiles = positiveBound(
    input.bounds.maximumCorePerformanceProfiles,
    "maximumCorePerformanceProfiles",
    500_000,
  );
  const maximumDiscoveryBenchmarks = positiveBound(
    input.bounds.maximumDiscoveryBenchmarks,
    "maximumDiscoveryBenchmarks",
    100_000,
  );
  const maximumPayoutFormatProfiles = positiveBound(
    input.bounds.maximumPayoutFormatProfiles,
    "maximumPayoutFormatProfiles",
    500_000,
  );
  const maximumStarEvents = positiveBound(
    input.bounds.maximumStarEvents,
    "maximumStarEvents",
    1_000_000,
  );
  const maximumStarEntriesPerEvent = positiveBound(
    input.bounds.maximumStarEntriesPerEvent,
    "maximumStarEntriesPerEvent",
    100_000,
  );
  const maximumStarContributions = positiveBound(
    input.bounds.maximumStarContributions,
    "maximumStarContributions",
    5_000_000,
  );
  const maximumStarProfiles = positiveBound(
    input.bounds.maximumStarProfiles,
    "maximumStarProfiles",
    500_000,
  );

  const preparedObservations = await prepareSpillableRaceArchiveObservations({
    ownerId,
    versions: input.versions,
    rehydrator: input.rehydrator,
    store: input.observationStore,
    runPrefix: `${runPrefix}/deduplicate`,
    maximumArchivePartitions,
    maximumRecordsInMemory,
    mergeFanIn,
    maximumInputObservations,
    maximumRunObjects,
  });

  const replayRunId = `${runPrefix}/unique-observations`;
  let replayRunWritten = false;
  try {
    const uniqueObservationCount = await writeReplayableObservationRun({
      source: preparedObservations.readUnique(),
      store: input.observationStore,
      runId: replayRunId,
      maximumObservations: maximumInputObservations,
    });
    replayRunWritten = true;

    const corePerformanceSource =
      await spillableCorePerformanceProfilesFromRaceArchive({
        observations: input.observationStore.readRun({ runId: replayRunId }),
        store: input.observationStore,
        runPrefix: `${runPrefix}/core-performance`,
        maximumRecordsInMemory,
        mergeFanIn,
        maximumObservations: maximumInputObservations,
        maximumRunObjects,
        maximumProfiles: maximumCorePerformanceProfiles,
      });
    await assertObservationCoverage({
      actual: corePerformanceSource.inputObservationCount,
      expected: uniqueObservationCount,
      family: "Race archive Core Performance",
      cleanup: corePerformanceSource.cleanup,
    });
    const corePerformance = await collectRows({
      values: corePerformanceSource.readProfiles(),
      maximumRows: maximumCorePerformanceProfiles,
      field: "Race archive Core Performance",
      map: (profile) => ({
        source_core_id: profile.sourceCoreId,
        mode: profile.mode,
        distance: profile.distance,
        data_current_through: profile.dataCurrentThrough,
        race_count: profile.raceCount,
        best_milliseconds: profile.bestMilliseconds,
        median_milliseconds: profile.medianMilliseconds,
        mean_milliseconds: profile.meanMilliseconds,
        trimmed_mean_milliseconds: profile.trimmedMeanMilliseconds,
        standard_deviation_milliseconds: profile.standardDeviationMilliseconds,
        interquartile_range_milliseconds:
          profile.interquartileRangeMilliseconds,
        best_metres_per_second: profile.bestMetresPerSecond,
        median_metres_per_second: profile.medianMetresPerSecond,
      }),
    });

    const discoverySource =
      await spillableDiscoveryExactDistanceBenchmarksFromRaceArchive({
        observations: input.observationStore.readRun({ runId: replayRunId }),
        store: input.observationStore,
        runPrefix: `${runPrefix}/discovery`,
        refreshedAt,
        maximumRecordsInMemory,
        mergeFanIn,
        maximumObservations: maximumInputObservations,
        maximumRunObjects,
        maximumBenchmarks: maximumDiscoveryBenchmarks,
      });
    await assertObservationCoverage({
      actual: discoverySource.inputObservationCount,
      expected: uniqueObservationCount,
      family: "Race archive Discovery",
      cleanup: discoverySource.cleanup,
    });
    const discoveryBenchmarks = await collectRows({
      values: discoverySource.readBenchmarks(),
      maximumRows: maximumDiscoveryBenchmarks,
      field: "Race archive Discovery",
      map: (benchmark) => ({
        mode: benchmark.mode,
        distance_metres: benchmark.distanceMetres,
        data_current_through: benchmark.dataCurrentThrough,
        race_entry_count: benchmark.raceEntryCount,
        winning_entry_count: benchmark.winningEntryCount,
        top_three_entry_count: benchmark.topThreeEntryCount,
        winning_p25_milliseconds: benchmark.winningP25Milliseconds,
        winning_median_milliseconds: benchmark.winningMedianMilliseconds,
        winning_p75_milliseconds: benchmark.winningP75Milliseconds,
        top_three_p25_milliseconds: benchmark.topThreeP25Milliseconds,
        top_three_median_milliseconds: benchmark.topThreeMedianMilliseconds,
        top_three_p75_milliseconds: benchmark.topThreeP75Milliseconds,
      }),
    });

    const payoutSource = await spillableCorePayoutFormatProfilesFromRaceArchive(
      {
        observations: input.observationStore.readRun({ runId: replayRunId }),
        store: input.observationStore,
        runPrefix: `${runPrefix}/payout-format`,
        refreshedAt,
        maximumRecordsInMemory,
        mergeFanIn,
        maximumObservations: maximumInputObservations,
        maximumRunObjects,
        maximumProfiles: maximumPayoutFormatProfiles,
      },
    );
    await assertObservationCoverage({
      actual: payoutSource.inputObservationCount,
      expected: uniqueObservationCount,
      family: "Race archive payout-format",
      cleanup: payoutSource.cleanup,
    });
    const acceptedFormatEntryCount = payoutSource.acceptedFormatEntryCount;
    const payoutFormatProfiles = await collectRows({
      values: payoutSource.readProfiles(),
      maximumRows: maximumPayoutFormatProfiles,
      field: "Race archive payout-format",
      map: (profile) => ({
        source_core_id: profile.sourceCoreId,
        mode: profile.mode,
        payout_format_key: profile.payoutFormatKey,
        payout_format_label: profile.payoutFormatLabel,
        data_current_through: profile.dataCurrentThrough,
        first_event_at: profile.firstEventAt,
        race_count: profile.raceCount,
        win_count: profile.winCount,
        top_three_count: profile.topThreeCount,
        exact_distance_count: profile.exactDistanceCount,
        timed_race_count: profile.timedRaceCount,
      }),
    });

    const starProfileSource = await spillableStarProfilesFromRaceArchive({
      observations: input.observationStore.readRun({ runId: replayRunId }),
      observationStore: input.observationStore,
      contributionStore: input.starProfileStore,
      runPrefix: `${runPrefix}/star`,
      maximumRecordsInMemory,
      mergeFanIn,
      maximumObservations: maximumInputObservations,
      maximumRunObjects,
      maximumEvents: maximumStarEvents,
      maximumEntriesPerEvent: maximumStarEntriesPerEvent,
      maximumContributions: maximumStarContributions,
      maximumProfiles: maximumStarProfiles,
    });
    await assertObservationCoverage({
      actual: starProfileSource.inputObservationCount,
      expected: uniqueObservationCount,
      family: "Race archive star",
      cleanup: starProfileSource.cleanup,
    });
    const validatedEventCount = starProfileSource.validatedEventCount;
    const coreStarProfiles = await collectRows({
      values: starProfileSource.readProfiles(),
      maximumRows: maximumStarProfiles,
      field: "Race archive Core star profile",
      map: (profile) => ({
        source_core_id: profile.coreId,
        mode: profile.mode,
        distance: profile.distance,
        data_current_through: profile.dataCurrentThrough,
        race_count: profile.raceCount,
        complete_star_data_race_count: profile.completeStarDataRaceCount,
        partial_star_data_race_count: profile.partialStarDataRaceCount,
        missing_star_data_race_count: profile.missingStarDataRaceCount,
        invalid_star_data_race_count: profile.invalidStarDataRaceCount,
        gold_eligible_race_count: profile.goldEligibleRaceCount,
        gold_assignment_opportunity_count:
          profile.goldAssignmentOpportunityCount,
        gold_received_count: profile.goldReceivedCount,
        gold_negative_opportunity_count: profile.goldNegativeOpportunityCount,
        gold_eligible_no_assignment_count:
          profile.goldEligibleNoAssignmentCount,
        gold_ineligible_assignment_count: profile.goldIneligibleAssignmentCount,
        gold_excluded_anomaly_count: profile.goldExcludedAnomalyCount,
        blue_assignment_opportunity_count:
          profile.blueAssignmentOpportunityCount,
        blue_received_count: profile.blueReceivedCount,
        blue_negative_opportunity_count: profile.blueNegativeOpportunityCount,
        blue_no_assignment_count: profile.blueNoAssignmentCount,
        blue_excluded_anomaly_count: profile.blueExcludedAnomalyCount,
        same_core_received_both_count: profile.sameCoreReceivedBothCount,
      }),
    });

    return Object.freeze({
      rows: Object.freeze({
        corePerformance,
        discoveryBenchmarks,
        payoutFormatProfiles,
        coreStarProfiles,
      }),
      uniqueObservationCount,
      validatedEventCount,
      acceptedFormatEntryCount,
    });
  } finally {
    if (replayRunWritten) {
      await input.observationStore.deleteRun({ runId: replayRunId });
    }
  }
}
