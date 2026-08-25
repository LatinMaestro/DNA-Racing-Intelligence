import { createHash } from "node:crypto";

import type { CoreStarProfile } from "@/domain/star-signals";
import type {
  BoundedAggregateRefresher,
  PreparedAggregateRefresh,
} from "./import-aggregate-refresh-service";
import type { NeonRaceArchiveAggregatePublicationRepository } from "./neon-race-archive-aggregate-publication";
import type { RaceArchiveCoreAnalyticalObservation } from "./race-archive-core-analytical-observations";
import type {
  RaceArchiveAggregateRefreshPlanRepository,
  RaceArchiveAggregateRefreshPlanVersion,
} from "./race-archive-aggregate-refresher";
import type { RaceArchiveExternalSortedRunStore } from "./race-archive-external-sort";
import { publishRaceArchiveAggregates } from "./race-archive-aggregate-publication-service";
import {
  rebuildSpillableRaceArchivePublicationRows,
  type SpillableRaceArchivePublicationRebuildBounds,
} from "./race-archive-spillable-publication-rebuild";
import type { RaceStagedRowRehydrator } from "./race-staged-row-rehydrator";

const CONTROL_CHARACTER_PATTERN = /[\u0000-\u001f\u007f-\u009f]/u;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

export type RaceArchiveSpillableScratchStores = Readonly<{
  observationStore: RaceArchiveExternalSortedRunStore<RaceArchiveCoreAnalyticalObservation>;
  starProfileStore: RaceArchiveExternalSortedRunStore<CoreStarProfile>;
}>;

export type RaceArchiveSpillableScratchStoreFactory = Readonly<{
  create: (input: {
    ownerId: string;
    updateSessionId: string;
    refreshId: string;
    sourceVersionSetSha256: string;
  }) => Promise<RaceArchiveSpillableScratchStores>;
}>;

export type RaceArchiveSpillableAggregateRefresher = BoundedAggregateRefresher;

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
  rows: Awaited<
    ReturnType<typeof rebuildSpillableRaceArchivePublicationRows>
  >["rows"];
  validatedEventCount: number;
  acceptedFormatEntryCount: number;
}): string {
  return createHash("sha256").update(canonicalJson(input)).digest("hex");
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
    throw new Error(
      "Race archive aggregate plan row coverage is inconsistent.",
    );
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
    throw new Error(
      "Race archive aggregate plan version count is outside its bound.",
    );
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
    throw new Error(
      "Race archive aggregate plan does not end at the target version.",
    );
  }
  return Object.freeze(versions);
}

export function createSpillableRaceArchiveAggregateRefresher(input: {
  planRepository: RaceArchiveAggregateRefreshPlanRepository;
  rehydrator: RaceStagedRowRehydrator;
  scratchStoreFactory: RaceArchiveSpillableScratchStoreFactory;
  publicationRepository: NeonRaceArchiveAggregatePublicationRepository;
  finalizer: BoundedAggregateRefresher;
  workerId: string;
  now?: () => Date;
  maximumVersions?: number;
  maximumRowsPerStage?: number;
  bounds: SpillableRaceArchivePublicationRebuildBounds;
}): RaceArchiveSpillableAggregateRefresher {
  const workerId = safeText(input.workerId, "workerId", 128);
  const maximumVersions = positiveBound(
    input.maximumVersions ?? 10_000,
    "maximumVersions",
    10_000,
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
      const stores = await input.scratchStoreFactory.create({
        ownerId,
        updateSessionId,
        refreshId,
        sourceVersionSetSha256,
      });
      const refreshedAt = timestamp(now(), "now");
      const rebuilt = await rebuildSpillableRaceArchivePublicationRows({
        ownerId,
        versions,
        rehydrator: input.rehydrator,
        observationStore: stores.observationStore,
        starProfileStore: stores.starProfileStore,
        runPrefix: `${refreshId}/${updateSessionId}`,
        refreshedAt,
        bounds: input.bounds,
      });
      const digest = payloadSha256({
        rows: rebuilt.rows,
        validatedEventCount: rebuilt.validatedEventCount,
        acceptedFormatEntryCount: rebuilt.acceptedFormatEntryCount,
      });
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
        throw new Error(
          "Race archive aggregate finalizer changed source versions.",
        );
      }
      nonNegativeSafeInteger(
        prepared.materializedRowCount,
        "prepared.materializedRowCount",
      );
      if (prepared.materializedRowCount !== publication.materializedRowCount) {
        throw new Error(
          "Race archive aggregate finalizer changed materialized row count.",
        );
      }
      return prepared;
    },
  });
}
