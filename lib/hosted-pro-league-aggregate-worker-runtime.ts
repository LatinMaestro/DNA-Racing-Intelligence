import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import {
  consumeAggregateRefreshQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import type { BoundedAggregateRefresher } from "./import-aggregate-refresh-service";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  createNeonProLeagueAggregateRefreshCapabilities,
  type ProLeagueAggregateRefreshEnvironment,
} from "./neon-pro-league-aggregate-refresh";
import {
  createNeonRaceArchiveAggregatePublicationRepository,
  type NeonRaceArchiveAggregatePublicationRepository,
} from "./neon-race-archive-aggregate-publication";
import {
  createNeonRaceArchiveAggregateRefreshPlanRepository,
  type NeonRaceArchiveAggregateRefreshPlanRepository,
} from "./neon-race-archive-aggregate-refresh-plan";
import {
  createNeonSealedRaceArchiveManifestRepository,
  type SealedRaceArchiveManifestRepository,
} from "./neon-sealed-race-archive-manifest-repository";
import {
  createPrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReadableStoragePort,
} from "./private-dataset-evidence-object-reader";
import { createRaceArchiveAggregateRefresher } from "./race-archive-aggregate-refresher";
import {
  createRaceStagedRowRehydrator,
  type RaceStagedRowRehydrator,
} from "./race-staged-row-rehydrator";
import { createSealedRaceArchiveReader } from "./sealed-race-archive-reader";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;
const MAXIMUM_ARCHIVE_VERSIONS = 10_000;
const MAXIMUM_ARCHIVE_PARTITIONS = 10_000;
const MAXIMUM_OBJECT_BYTES = 1_048_576;
const MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION = 524_288;
const MAXIMUM_ROWS_PER_PARTITION = 500;

export type HostedProLeagueAggregateWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  authorizedOwnerId: string | undefined;
  database: ProLeagueAggregateRefreshEnvironment;
  leaseDurationMilliseconds: string | undefined;
  cloudflareAccountId: string | undefined;
  cloudflareApiToken: string | undefined;
  bucketName: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
}>;

export type HostedProLeagueAggregateWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  planRepository?: NeonRaceArchiveAggregateRefreshPlanRepository;
  publicationRepository?: NeonRaceArchiveAggregatePublicationRepository;
  manifestRepository?: SealedRaceArchiveManifestRepository;
  objectReader?: PrivateDatasetEvidenceObjectReader;
  evidencePort?: PrivateDatasetEvidenceObjectReadableStoragePort;
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

function leaseDuration(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (
    !Number.isSafeInteger(parsed) ||
    parsed < 1_000 ||
    parsed > 60 * 60 * 1_000
  ) {
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
}> {
  const ownerId = environment.authorizedOwnerId?.trim() ?? "";
  const accountId = environment.cloudflareAccountId?.trim().toLowerCase() ?? "";
  const apiToken = secret(environment.cloudflareApiToken);
  const bucketName = environment.bucketName?.trim() ?? "";
  const accessKeyId = secret(environment.r2AccessKeyId);
  const secretAccessKey = secret(environment.r2SecretAccessKey);
  if (
    !SAFE_IDENTIFIER_PATTERN.test(ownerId) ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    apiToken === null ||
    !BUCKET_NAME_PATTERN.test(bucketName) ||
    accessKeyId === null ||
    secretAccessKey === null
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
    const standardCapabilities = createNeonProLeagueAggregateRefreshCapabilities({
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

    const planRepository =
      input.dependencies?.planRepository ??
      createNeonRaceArchiveAggregateRefreshPlanRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });
    const publicationRepository =
      input.dependencies?.publicationRepository ??
      createNeonRaceArchiveAggregatePublicationRepository({
        databaseUrl,
        databaseOwnerId,
        runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });
    const rehydrator =
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
                ? { sessionFactory: input.dependencies.neonSessionFactory }
                : {}),
            }),
          objectReader:
            input.dependencies?.objectReader ??
            createPrivateDatasetEvidenceObjectReader({
              ownerId: archive.ownerId,
              bucketName: archive.bucketName,
              maximumObjectBytes: MAXIMUM_OBJECT_BYTES,
              createPort: () =>
                input.dependencies?.evidencePort ??
                createCloudflareR2DatasetEvidencePort({
                  accountId: archive.accountId,
                  accessKeyId: archive.accessKeyId,
                  secretAccessKey: archive.secretAccessKey,
                  apiToken: archive.apiToken,
                  fetch: input.dependencies?.fetch ?? globalThis.fetch,
                }),
            }),
          maximumUncompressedBytesPerPartition:
            MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION,
          maximumRowsPerPartition: MAXIMUM_ROWS_PER_PARTITION,
          maximumSelectedPartitions: MAXIMUM_ARCHIVE_PARTITIONS,
        }),
      });
    const raceRefresher = createRaceArchiveAggregateRefresher({
      planRepository,
      rehydrator,
      publicationRepository,
      finalizer: standardCapabilities.refresher,
      workerId,
      maximumVersions: MAXIMUM_ARCHIVE_VERSIONS,
      maximumArchivePartitions: MAXIMUM_ARCHIVE_PARTITIONS,
      ...(input.dependencies?.now ? { now: input.dependencies.now } : {}),
    });
    const refresher: BoundedAggregateRefresher = Object.freeze({
      async prepare(request) {
        const sourceType = await planRepository.targetSourceType(request);
        if (sourceType === "race_merge") {
          return raceRefresher.prepare(request);
        }
        return standardCapabilities.refresher.prepare(request);
      },
    });
    const capabilities = Object.freeze({
      status: "ready" as const,
      repository: standardCapabilities.repository,
      refresher,
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
