import { createHash } from "node:crypto";

import type { AdaptedRaceMergeRow } from "@/domain/source-adapters";
import type {
  BoundedAggregateRefresher,
  PreparedAggregateRefresh,
} from "./import-aggregate-refresh-service";
import type { NeonRaceArchiveAggregatePublicationRepository } from "./neon-race-archive-aggregate-publication";
import {
  analyticalObservationsFromRaceArchiveCoreHistory,
  type RaceArchiveCoreAnalyticalObservation,
} from "./race-archive-core-analytical-observations";
import { corePerformanceProfilesFromRaceArchive } from "./race-archive-core-performance-profiles";
import { corePayoutFormatProfilesFromRaceArchive } from "./race-archive-core-payout-format-profiles";
import { discoveryExactDistanceBenchmarksFromRaceArchive } from "./race-archive-discovery-benchmarks";
import type {
  RaceArchiveCoreHistory,
  RaceArchiveCoreHistoryRow,
} from "./race-archive-core-history-service";
import {
  publishRaceArchiveAggregates,
  type RaceArchiveAggregatePublicationRows,
} from "./race-archive-aggregate-publication-service";
import { starProfilesFromRaceArchive } from "./race-archive-star-profiles";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type RaceArchiveAggregateRefreshPlanVersion = Readonly<{
  datasetVersionId: string;
  importBatchId: string;
  versionNumber: number;
  sourceRowCount: number;
  acceptedRowCount: number;
  evidencePartitionCount: number;
  evidenceRowCount: number;
}>;

export type RaceArchiveAggregateRefreshPlanRepository = Readonly<{
  list: (input: {
    ownerId: string;
    refreshId: string;
    updateSessionId: string;
    sourceVersionSetSha256: string;
    maximumVersions: number;
  }) => Promise<readonly RaceArchiveAggregateRefreshPlanVersion[]>;
}>;

export type RaceArchiveAggregateRefresher = BoundedAggregateRefresher;

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

function sha256(value: string, field: string): string {
  const normalized = safeText(value, field, 64);
  if (!SHA_256_PATTERN.test(normalized)) {
    throw new Error(`${field} must be a lowercase SHA-256 digest`);
  }
  return normalized;
}

function positiveBound(value: number, field: string, maximum: number): number {
  if (!Number.isSafeInteger(value) || value < 1 || value > maximum) {
    throw new Error(`${field} is outside its bound`);
  }
  return value;
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function timestamp(value: Date, field: string): string {
  if (Number.isNaN(value.getTime())) throw new Error(`${field} must be valid`);
  return value.toISOString();
}

function canonicalJson(value: unknown): string {
  if (value === null || typeof value !== "object") {
    return JSON.stringify(value) ?? "null";
  }
  if (Array.isArray(value)) {
    return `[${value.map((item) => canonicalJson(item)).join(",")}]`;
  }
  const object = value as Record<string, unknown>;
  return `{${Object.keys(object)
    .sort()
    .map((key) => `${JSON.stringify(key)}:${canonicalJson(object[key])}`)
    .join(",")}}`;
}

function payloadSha256(input: {
  rows: RaceArchiveAggregatePublicationRows;
  validatedEventCount: number;
  acceptedFormatEntryCount: number;
}): string {
  return createHash("sha256")
    .update(canonicalJson(input))
    .digest("hex");
}

function planVersion(
  value: RaceArchiveAggregateRefreshPlanVersion,
  index: number,
): RaceArchiveAggregateRefreshPlanVersion {
  const datasetVersionId = safeText(
    value.datasetVersionId,
    `versions[${index}].datasetVersionId`,
  );
  const importBatchId = safeText(
    value.importBatchId,
    `versions[${index}].importBatchId`,
  );
  const versionNumber = positiveBound(
    value.versionNumber,
    `versions[${index}].versionNumber`,
    1_000_000,
  );
  const sourceRowCount = positiveBound(
    value.sourceRowCount,
    `versions[${index}].sourceRowCount`,
    5_000_000,
  );
  const acceptedRowCount = positiveBound(
    value.acceptedRowCount,
    `versions[${index}].acceptedRowCount`,
    sourceRowCount,
  );
  const evidencePartitionCount = positiveBound(
    value.evidencePartitionCount,
    `versions[${index}].evidencePartitionCount`,
    10_000,
  );
  const evidenceRowCount = positiveBound(
    value.evidenceRowCount,
    `versions[${index}].evidenceRowCount`,
    5_000_000,
  );
  if (evidenceRowCount !== sourceRowCount) {
    throw new Error("Race archive aggregate plan row coverage is inconsistent.");
  }
  return Object.freeze({
    datasetVersionId,
    importBatchId,
    versionNumber,
    sourceRowCount,
    acceptedRowCount,
    evidencePartitionCount,
    evidenceRowCount,
  });
}

function normalizedPlan(input: {
  versions: readonly RaceArchiveAggregateRefreshPlanVersion[];
  maximumVersions: number;
  updateSessionId: string;
}): readonly RaceArchiveAggregateRefreshPlanVersion[] {
  if (
    input.versions.length < 1 ||
    input.versions.length > input.maximumVersions
  ) {
    throw new Error("Race archive aggregate plan version count is outside its bound.");
  }
  const versions = input.versions.map(planVersion);
  let previousVersionNumber: number | undefined;
  const datasetVersionIds = new Set<string>();
  for (const version of versions) {
    if (
      previousVersionNumber !== undefined &&
      version.versionNumber <= previousVersionNumber
    ) {
      throw new Error("Race archive aggregate plan versions are not ordered.");
    }
    if (datasetVersionIds.has(version.datasetVersionId)) {
      throw new Error("Race archive aggregate plan repeats a dataset version.");
    }
    datasetVersionIds.add(version.datasetVersionId);
    previousVersionNumber = version.versionNumber;
  }
  if (versions.at(-1)?.datasetVersionId !== input.updateSessionId) {
    throw new Error("Race archive aggregate plan does not end at the target version.");
  }
  return Object.freeze(versions);
}

function readyRaceRecord(row: RaceArchiveCoreHistoryRow): AdaptedRaceMergeRow {
  if (
    row.row.status !== "ready" ||
    row.row.sourceType !== "race_merge" ||
    row.row.record?.sourceType !== "race_merge"
  ) {
    throw new Error("Race archive aggregate evidence is not a ready Race row.");
  }
  return row.row.record;
}

function publicationRows(input: {
  observations: readonly RaceArchiveCoreAnalyticalObservation[];
  histories: ReadonlyMap<string, RaceArchiveCoreHistory>;
  refreshedAt: string;
  maximumObservations: number;
  maximumCorePerformanceProfiles: number;
  maximumDiscoveryBenchmarks: number;
  maximumPayoutFormatProfiles: number;
  maximumStarEvents: number;
  maximumStarProfiles: number;
}): Readonly<{
  rows: RaceArchiveAggregatePublicationRows;
  validatedEventCount: number;
  acceptedFormatEntryCount: number;
}> {
  const corePerformance = [...input.histories.keys()]
    .sort((left, right) => left.localeCompare(right))
    .flatMap((sourceCoreId) => {
      const history = input.histories.get(sourceCoreId);
      if (history === undefined) {
        throw new Error("Race archive Core history disappeared during rebuild.");
      }
      const observationSet = analyticalObservationsFromRaceArchiveCoreHistory(history);
      return corePerformanceProfilesFromRaceArchive({
        observationSet,
        maximumObservations: input.maximumObservations,
        maximumProfiles: input.maximumCorePerformanceProfiles,
      });
    })
    .map((profile) =>
      Object.freeze({
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
        interquartile_range_milliseconds: profile.interquartileRangeMilliseconds,
        best_metres_per_second: profile.bestMetresPerSecond,
        median_metres_per_second: profile.medianMetresPerSecond,
      }),
    );

  if (corePerformance.length > input.maximumCorePerformanceProfiles) {
    throw new Error("Race archive Core Performance profile bound was exceeded.");
  }

  const discoveryBenchmarks = discoveryExactDistanceBenchmarksFromRaceArchive({
    observations: input.observations,
    refreshedAt: input.refreshedAt,
    maximumObservations: input.maximumObservations,
    maximumBenchmarks: input.maximumDiscoveryBenchmarks,
  }).map((benchmark) =>
    Object.freeze({
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
  );

  const payout = corePayoutFormatProfilesFromRaceArchive({
    observations: input.observations,
    refreshedAt: input.refreshedAt,
    maximumObservations: input.maximumObservations,
    maximumProfiles: input.maximumPayoutFormatProfiles,
  });
  const payoutFormatProfiles = payout.profiles.map((profile) =>
    Object.freeze({
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
  );

  const star = starProfilesFromRaceArchive({
    observations: input.observations,
    maximumObservations: input.maximumObservations,
    maximumEvents: input.maximumStarEvents,
    maximumProfiles: input.maximumStarProfiles,
  });
  const coreStarProfiles = star.profiles.map((profile) =>
    Object.freeze({
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
      gold_assignment_opportunity_count: profile.goldAssignmentOpportunityCount,
      gold_received_count: profile.goldReceivedCount,
      gold_negative_opportunity_count: profile.goldNegativeOpportunityCount,
      gold_eligible_no_assignment_count: profile.goldEligibleNoAssignmentCount,
      gold_ineligible_assignment_count: profile.goldIneligibleAssignmentCount,
      gold_excluded_anomaly_count: profile.goldExcludedAnomalyCount,
      blue_assignment_opportunity_count: profile.blueAssignmentOpportunityCount,
      blue_received_count: profile.blueReceivedCount,
      blue_negative_opportunity_count: profile.blueNegativeOpportunityCount,
      blue_no_assignment_count: profile.blueNoAssignmentCount,
      blue_excluded_anomaly_count: profile.blueExcludedAnomalyCount,
      same_core_received_both_count: profile.sameCoreReceivedBothCount,
    }),
  );

  return Object.freeze({
    rows: Object.freeze({
      corePerformance: Object.freeze(corePerformance),
      discoveryBenchmarks: Object.freeze(discoveryBenchmarks),
      payoutFormatProfiles: Object.freeze(payoutFormatProfiles),
      coreStarProfiles: Object.freeze(coreStarProfiles),
    }),
    validatedEventCount: star.eventValidations.length,
    acceptedFormatEntryCount: payout.acceptedFormatEntryCount,
  });
}

export function createRaceArchiveAggregateRefresher(input: {
  planRepository: RaceArchiveAggregateRefreshPlanRepository;
  rehydrator: RaceStagedRowRehydrator;
  publicationRepository: NeonRaceArchiveAggregatePublicationRepository;
  finalizer: BoundedAggregateRefresher;
  workerId: string;
  now?: () => Date;
  maximumVersions?: number;
  maximumArchivePartitions?: number;
  maximumObservations?: number;
  maximumCorePerformanceProfiles?: number;
  maximumDiscoveryBenchmarks?: number;
  maximumPayoutFormatProfiles?: number;
  maximumStarEvents?: number;
  maximumStarProfiles?: number;
  maximumRowsPerStage?: number;
}): RaceArchiveAggregateRefresher {
  const workerId = safeText(input.workerId, "workerId", 128);
  const maximumVersions = positiveBound(
    input.maximumVersions ?? 24,
    "maximumVersions",
    10_000,
  );
  const maximumArchivePartitions = positiveBound(
    input.maximumArchivePartitions ?? 10_000,
    "maximumArchivePartitions",
    10_000,
  );
  const maximumObservations = positiveBound(
    input.maximumObservations ?? 5_000_000,
    "maximumObservations",
    5_000_000,
  );
  const maximumCorePerformanceProfiles = positiveBound(
    input.maximumCorePerformanceProfiles ?? 500_000,
    "maximumCorePerformanceProfiles",
    500_000,
  );
  const maximumDiscoveryBenchmarks = positiveBound(
    input.maximumDiscoveryBenchmarks ?? 100_000,
    "maximumDiscoveryBenchmarks",
    100_000,
  );
  const maximumPayoutFormatProfiles = positiveBound(
    input.maximumPayoutFormatProfiles ?? 500_000,
    "maximumPayoutFormatProfiles",
    500_000,
  );
  const maximumStarEvents = positiveBound(
    input.maximumStarEvents ?? 1_000_000,
    "maximumStarEvents",
    1_000_000,
  );
  const maximumStarProfiles = positiveBound(
    input.maximumStarProfiles ?? 500_000,
    "maximumStarProfiles",
    500_000,
  );
  const maximumRowsPerStage = positiveBound(
    input.maximumRowsPerStage ?? 2_000,
    "maximumRowsPerStage",
    2_000,
  );
  const now = input.now ?? (() => new Date());

  return Object.freeze({
    async prepare(request): Promise<PreparedAggregateRefresh> {
      const ownerId = safeText(request.ownerId, "ownerId", 128);
      const updateSessionId = safeText(
        request.updateSessionId,
        "updateSessionId",
        128,
      );
      const refreshId = safeText(request.refreshId, "refreshId", 128);
      const sourceVersionSetSha256 = sha256(
        request.sourceVersionSetSha256,
        "sourceVersionSetSha256",
      );
      const versions = normalizedPlan({
        versions: await input.planRepository.list({
          ownerId,
          refreshId,
          updateSessionId,
          sourceVersionSetSha256,
          maximumVersions,
        }),
        maximumVersions,
        updateSessionId,
      });

      const histories = new Map<
        string,
        {
          rows: RaceArchiveCoreHistoryRow[];
          versionNumbers: Set<number>;
          partitionKeys: Set<string>;
        }
      >();
      const fingerprintsByNaturalKey = new Map<string, string>();
      let totalUniqueObservations = 0;

      for (const version of versions) {
        const opened = await input.rehydrator.open({
          ownerId,
          datasetVersionId: version.datasetVersionId,
          maximumPartitions: maximumArchivePartitions,
        });
        if (opened.status === "missing") {
          throw new Error("Race archive aggregate plan points to missing evidence.");
        }
        if (
          opened.manifest.datasetVersionId !== version.datasetVersionId ||
          opened.manifest.importBatchId !== version.importBatchId ||
          opened.manifest.sourceType !== "race_merge" ||
          opened.manifest.evidenceKind !== "staged_rows" ||
          opened.manifest.rowCount !== version.evidenceRowCount ||
          opened.manifest.objects.length !== version.evidencePartitionCount
        ) {
          throw new Error("Race archive aggregate evidence identity or coverage changed.");
        }

        let sourceRowCount = 0;
        let readyRowCount = 0;
        for await (const rehydrated of opened.rows) {
          sourceRowCount += 1;
          if (
            rehydrated.datasetVersionId !== version.datasetVersionId ||
            rehydrated.importBatchId !== version.importBatchId
          ) {
            throw new Error("Race archive aggregate row version identity changed.");
          }
          const staged = rehydrated.stagedRow;
          if (staged.row.status === "quarantined") continue;
          readyRowCount += 1;
          if (
            staged.row.sourceType !== "race_merge" ||
            staged.row.record?.sourceType !== "race_merge" ||
            staged.naturalKey === null ||
            staged.fingerprintSha256 === null
          ) {
            throw new Error("Race archive aggregate ready-row evidence is incomplete.");
          }
          const naturalKey = safeText(staged.naturalKey, "naturalKey");
          const fingerprintSha256 = sha256(
            staged.fingerprintSha256,
            "fingerprintSha256",
          );
          const existingFingerprint = fingerprintsByNaturalKey.get(naturalKey);
          if (existingFingerprint !== undefined) {
            if (existingFingerprint !== fingerprintSha256) {
              throw new Error(
                "Race archive aggregate history contains conflicting replay evidence.",
              );
            }
            continue;
          }
          fingerprintsByNaturalKey.set(naturalKey, fingerprintSha256);
          totalUniqueObservations += 1;
          if (totalUniqueObservations > maximumObservations) {
            throw new Error("Race archive aggregate observation bound was exceeded.");
          }

          const sourceCoreId = safeText(
            staged.row.record.sourceCoreId,
            "sourceCoreId",
            256,
          );
          let history = histories.get(sourceCoreId);
          if (history === undefined) {
            history = {
              rows: [],
              versionNumbers: new Set<number>(),
              partitionKeys: new Set<string>(),
            };
            histories.set(sourceCoreId, history);
          }
          history.versionNumbers.add(version.versionNumber);
          history.partitionKeys.add(
            `${version.datasetVersionId}:${rehydrated.partitionNumber}`,
          );
          history.rows.push(
            Object.freeze({
              datasetVersionId: version.datasetVersionId,
              importBatchId: version.importBatchId,
              versionNumber: version.versionNumber,
              partitionNumber: rehydrated.partitionNumber,
              sourceRowNumber: staged.sourceRowNumber,
              naturalKey,
              fingerprintSha256,
              row: staged.row,
            }),
          );
        }
        if (
          sourceRowCount !== version.sourceRowCount ||
          readyRowCount !== version.acceptedRowCount
        ) {
          throw new Error("Race archive aggregate row accounting changed.");
        }
      }

      const frozenHistories = new Map<string, RaceArchiveCoreHistory>();
      const observations: RaceArchiveCoreAnalyticalObservation[] = [];
      for (const [sourceCoreId, history] of histories) {
        const frozen = Object.freeze({
          sourceCoreId,
          locatorVersionCount: history.versionNumbers.size,
          selectedPartitionCount: history.partitionKeys.size,
          rows: Object.freeze(history.rows),
        });
        frozenHistories.set(sourceCoreId, frozen);
        observations.push(
          ...analyticalObservationsFromRaceArchiveCoreHistory(frozen)
            .observations,
        );
      }
      if (observations.length !== totalUniqueObservations) {
        throw new Error("Race archive aggregate observation coverage changed.");
      }
      observations.sort((left, right) =>
        left.naturalKey.localeCompare(right.naturalKey),
      );

      const refreshedAt = timestamp(now(), "now");
      const rebuilt = publicationRows({
        observations,
        histories: frozenHistories,
        refreshedAt,
        maximumObservations,
        maximumCorePerformanceProfiles,
        maximumDiscoveryBenchmarks,
        maximumPayoutFormatProfiles,
        maximumStarEvents,
        maximumStarProfiles,
      });
      const digest = payloadSha256(rebuilt);
      const publication = await publishRaceArchiveAggregates({
        repository: input.publicationRepository,
        ownerId,
        refreshId,
        raceDatasetVersionId: updateSessionId,
        workerId,
        sourceVersionSetSha256,
        payloadSha256: digest,
        refreshedAt,
        completedAt: refreshedAt,
        validatedEventCount: rebuilt.validatedEventCount,
        acceptedFormatEntryCount: rebuilt.acceptedFormatEntryCount,
        rows: rebuilt.rows,
        maximumRowsPerStage,
      });

      const prepared = await input.finalizer.prepare({
        ownerId,
        updateSessionId,
        refreshId,
        sourceVersionSetSha256,
      });
      if (prepared.sourceVersionSetSha256 !== sourceVersionSetSha256) {
        throw new Error("Race archive aggregate finalizer changed source versions.");
      }
      nonNegativeSafeInteger(
        prepared.materializedRowCount,
        "prepared.materializedRowCount",
      );
      if (prepared.materializedRowCount !== publication.materializedRowCount) {
        throw new Error("Race archive aggregate finalizer changed materialized row count.");
      }
      return prepared;
    },
  });
}
