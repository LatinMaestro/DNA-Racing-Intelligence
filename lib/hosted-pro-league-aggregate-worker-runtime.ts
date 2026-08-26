import { createAggregateRefreshSourceRouter } from "./aggregate-refresh-source-router";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import {
  consumeAggregateRefreshQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import type { BoundedAggregateRefresher } from "./import-aggregate-refresh-service";
import {
  createNeonAggregateRefreshTargetSourceReader,
  type AggregateRefreshTargetSourceReader,
} from "./neon-aggregate-refresh-target-source";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  createNeonProLeagueAggregateRefreshCapabilities,
  type ProLeagueAggregateRefreshEnvironment,
} from "./neon-pro-league-aggregate-refresh";
import {
  createNeonRaceArchiveAggregatePublicationRepository,
  type NeonRaceArchiveAggregatePublicationRepository,
} from "./neon-race-archive-aggregate-publication";
import { createNeonRaceArchiveAggregateRefreshPlanRepository } from "./neon-race-archive-aggregate-refresh-plan";
import {
  createNeonRaceArchiveCoreLocatorRepository,
  type NeonRaceArchiveCoreLocatorRepository,
} from "./neon-race-archive-core-locator-repository";
import {
  createNeonSealedRaceArchiveManifestRepository,
  type SealedRaceArchiveManifestRepository,
} from "./neon-sealed-race-archive-manifest-repository";
import {
  createPrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReadableStoragePort,
  type PrivateDatasetEvidenceObjectReader,
} from "./private-dataset-evidence-object-reader";
import type { PrivateR2ExternalSortedRunStoragePort } from "./private-r2-external-sorted-run-store";
import { createPrivateR2RaceArchiveSpillableScratchStoreFactory } from "./private-r2-race-archive-spillable-scratch-store-factory";
import type { RaceArchiveAggregateRefreshPlanRepository } from "./race-archive-aggregate-refresher";
import {
  createSpillableRaceArchiveAggregateRefresher,
  type RaceArchiveSpillableScratchStoreFactory,
} from "./race-archive-spillable-aggregate-refresher";
import type { SpillableRaceArchivePublicationRebuildBounds } from "./race-archive-spillable-publication-rebuild";
import {
  createRaceStagedRowRehydrator,
  type RaceStagedRowRehydrator,
} from "./race-staged-row-rehydrator";
import { createRaceStagedRowLocatorSealingRehydrator } from "./race-staged-row-locator-sealing-rehydrator";
import { createSealedRaceArchiveReader } from "./sealed-race-archive-reader";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const OWNER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,511}$/;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const MAXIMUM_ARCHIVE_VERSIONS = 10_000;
const MAXIMUM_ARCHIVE_PARTITIONS = 10_000;
const MAXIMUM_ROWS_PER_PARTITION = 500;
const MAXIMUM_CORE_LOCATORS = 50_000;
const MAXIMUM_SCRATCH_PARTS_PER_RUN = 10_000;

// These are explicit fail-closed operational bounds, not a claim that the real
// owner archive has passed Worker-time/cost acceptance. The critical difference
// from the retired resident path is that only a bounded sort window stays in
// memory while exact intermediate state spills to private R2.
export const HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS: SpillableRaceArchivePublicationRebuildBounds =
  Object.freeze({
    maximumArchivePartitions: MAXIMUM_ARCHIVE_PARTITIONS,
    maximumRecordsInMemory: 5_000,
    mergeFanIn: 8,
    maximumInputObservations: 5_000_000,
    maximumRunObjects: 100_000,
    maximumCorePerformanceProfiles: 500_000,
    maximumDiscoveryBenchmarks: 100_000,
    maximumPayoutFormatProfiles: 500_000,
    maximumStarEvents: 1_000_000,
    maximumStarEntriesPerEvent: 100_000,
    maximumStarContributions: 5_000_000,
    maximumStarProfiles: 500_000,
  });

export type HostedProLeagueAggregateWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  database: ProLeagueAggregateRefreshEnvironment;
  leaseDurationMilliseconds: string | undefined;
  authorizedOwnerId?: string | undefined;
  cloudflareAccountId?: string | undefined;
  cloudflareApiToken?: string | undefined;
  bucketName?: string | undefined;
  r2AccessKeyId?: string | undefined;
  r2SecretAccessKey?: string | undefined;
  maximumObjectBytes?: string | undefined;
  maximumChunkBytes?: string | undefined;
}>;

export type HostedProLeagueAggregateWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  targetSourceReader?: AggregateRefreshTargetSourceReader;
  raceRefresher?: BoundedAggregateRefresher;
  planRepository?: RaceArchiveAggregateRefreshPlanRepository;
  publicationRepository?: NeonRaceArchiveAggregatePublicationRepository;
  coreLocatorRepository?: NeonRaceArchiveCoreLocatorRepository;
  manifestRepository?: SealedRaceArchiveManifestRepository;
  objectReader?: PrivateDatasetEvidenceObjectReader;
  evidencePort?: PrivateDatasetEvidenceObjectReadableStoragePort;
  scratchStoragePort?: PrivateR2ExternalSortedRunStoragePort;
  scratchStoreFactory?: RaceArchiveSpillableScratchStoreFactory;
  rehydrator?: RaceStagedRowRehydrator;
  fetch?: typeof globalThis.fetch;
}>;

export type HostedProLeagueAggregateWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (input: {
        body: unknown;
        now?: Date;
      }) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedProLeagueAggregateWorkerRuntime: HostedProLeagueAggregateWorkerRuntime =
  Object.freeze({ status: "not_configured" });

function identifier(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

function owner(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return OWNER_PATTERN.test(normalized) ? normalized : null;
}

function secret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized.length < 1 ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/u.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function positiveInteger(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

function leaseDuration(value: string | undefined): number | null {
  const parsed = positiveInteger(value);
  if (parsed === null || parsed < 1_000 || parsed > 60 * 60 * 1_000) {
    return null;
  }
  return parsed;
}

function archiveConfiguration(
  environment: HostedProLeagueAggregateWorkerEnvironment,
): null | Readonly<{
  ownerId: string;
  accountId: string;
  apiToken: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
  maximumObjectBytes: number;
  maximumChunkBytes: number;
}> {
  const ownerId = owner(environment.authorizedOwnerId);
  const accountId = environment.cloudflareAccountId?.trim().toLowerCase() ?? "";
  const apiToken = secret(environment.cloudflareApiToken);
  const bucketName = environment.bucketName?.trim() ?? "";
  const accessKeyId = secret(environment.r2AccessKeyId);
  const secretAccessKey = secret(environment.r2SecretAccessKey);
  const maximumObjectBytes = positiveInteger(environment.maximumObjectBytes);
  const maximumChunkBytes = positiveInteger(environment.maximumChunkBytes);
  if (
    ownerId === null ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    apiToken === null ||
    !BUCKET_NAME_PATTERN.test(bucketName) ||
    accessKeyId === null ||
    secretAccessKey === null ||
    maximumObjectBytes === null ||
    maximumChunkBytes === null ||
    maximumChunkBytes > maximumObjectBytes
  ) {
    return null;
  }
  return Object.freeze({
    ownerId,
    accountId,
    apiToken,
    bucketName,
    accessKeyId,
    secretAccessKey,
    maximumObjectBytes,
    maximumChunkBytes,
  });
}

export function hostedProLeagueAggregateWorkerRuntime(input: {
  environment: HostedProLeagueAggregateWorkerEnvironment;
  dependencies?: HostedProLeagueAggregateWorkerDependencies;
}): HostedProLeagueAggregateWorkerRuntime {
  const workerId = identifier(input.environment.workerId);
  const leaseDurationMilliseconds = leaseDuration(
    input.environment.leaseDurationMilliseconds,
  );
  const archive = archiveConfiguration(input.environment);
  const databaseUrl = input.environment.database.databaseUrl?.trim();
  const databaseOwnerId = input.environment.database.databaseOwnerId?.trim();
  const runtimeRole = input.environment.database.runtimeRole?.trim();
  if (
    workerId === null ||
    leaseDurationMilliseconds === null ||
    archive === null ||
    !databaseUrl ||
    !databaseOwnerId ||
    !runtimeRole
  ) {
    return unavailableHostedProLeagueAggregateWorkerRuntime;
  }

  try {
    const standardCapabilities =
      createNeonProLeagueAggregateRefreshCapabilities({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });
    if (standardCapabilities.status !== "ready") {
      return unavailableHostedProLeagueAggregateWorkerRuntime;
    }

    const targetSourceReader =
      input.dependencies?.targetSourceReader ??
      createNeonAggregateRefreshTargetSourceReader({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });

    const raceRefresher =
      input.dependencies?.raceRefresher ??
      (() => {
        const archiveStorage =
          input.dependencies?.scratchStoragePort ??
          createCloudflareR2DatasetEvidencePort({
            accountId: archive.accountId,
            accessKeyId: archive.accessKeyId,
            secretAccessKey: archive.secretAccessKey,
            apiToken: archive.apiToken,
            maximumBufferedPutBytes: archive.maximumChunkBytes,
            fetch: input.dependencies?.fetch ?? globalThis.fetch,
          });
        const rehydrator = createRaceStagedRowLocatorSealingRehydrator({
          rehydrator:
            input.dependencies?.rehydrator ??
            createRaceStagedRowRehydrator({
              archiveReader: createSealedRaceArchiveReader({
                manifestRepository:
                  input.dependencies?.manifestRepository ??
                  createNeonSealedRaceArchiveManifestRepository({
                    databaseUrl,
                    databaseOwnerId,
                    runtimeRole,
                    ...(input.dependencies?.neonSessionFactory
                      ? {
                          sessionFactory: input.dependencies.neonSessionFactory,
                        }
                      : {}),
                  }),
                objectReader:
                  input.dependencies?.objectReader ??
                  createPrivateDatasetEvidenceObjectReader({
                    ownerId: archive.ownerId,
                    bucketName: archive.bucketName,
                    maximumObjectBytes: archive.maximumChunkBytes,
                    createPort: () =>
                      input.dependencies?.evidencePort ?? archiveStorage,
                  }),
                maximumUncompressedBytesPerPartition: Math.max(
                  1,
                  Math.floor(archive.maximumChunkBytes / 2),
                ),
                maximumRowsPerPartition: MAXIMUM_ROWS_PER_PARTITION,
                maximumSelectedPartitions: MAXIMUM_ARCHIVE_PARTITIONS,
              }),
            }),
          coreLocatorRepository:
            input.dependencies?.coreLocatorRepository ??
            createNeonRaceArchiveCoreLocatorRepository({
              databaseUrl,
              databaseOwnerId,
              runtimeRole,
              ...(input.dependencies?.neonSessionFactory
                ? { sessionFactory: input.dependencies.neonSessionFactory }
                : {}),
            }),
          maximumCoreLocators: MAXIMUM_CORE_LOCATORS,
          maximumPartitionsPerCore: MAXIMUM_ARCHIVE_PARTITIONS,
          ...(input.dependencies?.now ? { now: input.dependencies.now } : {}),
        });

        return createSpillableRaceArchiveAggregateRefresher({
          planRepository:
            input.dependencies?.planRepository ??
            createNeonRaceArchiveAggregateRefreshPlanRepository({
              databaseUrl,
              databaseOwnerId,
              runtimeRole,
              ...(input.dependencies?.neonSessionFactory
                ? { sessionFactory: input.dependencies.neonSessionFactory }
                : {}),
            }),
          rehydrator,
          scratchStoreFactory:
            input.dependencies?.scratchStoreFactory ??
            createPrivateR2RaceArchiveSpillableScratchStoreFactory({
              bucketName: archive.bucketName,
              storage: archiveStorage,
              maximumPartBytes: archive.maximumChunkBytes,
              maximumPartsPerRun: MAXIMUM_SCRATCH_PARTS_PER_RUN,
              maximumManifestBytes: archive.maximumChunkBytes,
            }),
          publicationRepository:
            input.dependencies?.publicationRepository ??
            createNeonRaceArchiveAggregatePublicationRepository({
              databaseUrl,
              databaseOwnerId,
              runtimeRole,
              ...(input.dependencies?.neonSessionFactory
                ? { sessionFactory: input.dependencies.neonSessionFactory }
                : {}),
            }),
          finalizer: standardCapabilities.refresher,
          workerId,
          maximumVersions: MAXIMUM_ARCHIVE_VERSIONS,
          bounds: HOSTED_RACE_ARCHIVE_SPILLABLE_BOUNDS,
          ...(input.dependencies?.now ? { now: input.dependencies.now } : {}),
        });
      })();

    const capabilities = Object.freeze({
      status: "ready" as const,
      repository: standardCapabilities.repository,
      refresher: createAggregateRefreshSourceRouter({
        targetSourceReader,
        raceRefresher,
        currentStateRefresher: standardCapabilities.refresher,
      }),
    });
    const now = input.dependencies?.now ?? (() => new Date());
    return Object.freeze({
      status: "ready" as const,
      consume(consumeInput: { body: unknown; now?: Date }) {
        return consumeAggregateRefreshQueueMessage({
          body: consumeInput.body,
          workerId,
          now: consumeInput.now ?? now(),
          leaseDurationMilliseconds,
          capabilities,
        });
      },
    });
  } catch {
    return unavailableHostedProLeagueAggregateWorkerRuntime;
  }
}
