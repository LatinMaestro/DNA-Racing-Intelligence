import type { BoundedAggregateRefresher } from "./import-aggregate-refresh-service";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import {
  createNeonRaceArchiveAggregatePublicationRepository,
  type NeonRaceArchiveAggregatePublicationRepository,
} from "./neon-race-archive-aggregate-publication";
import {
  createNeonRaceArchiveAggregateRefreshControl,
  type RaceArchiveAggregateRefreshControl,
} from "./neon-race-archive-aggregate-refresh-control";
import {
  createNeonSealedRaceArchiveManifestRepository,
  type SealedRaceArchiveManifestRepository,
} from "./neon-sealed-race-archive-manifest-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  createPrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReadableStoragePort,
} from "./private-dataset-evidence-object-reader";
import { createRaceArchiveAggregateRefresher } from "./race-archive-aggregate-refresher";
import { createRaceStagedRowRehydrator } from "./race-staged-row-rehydrator";
import { createSealedRaceArchiveReader } from "./sealed-race-archive-reader";
import { createSourceAwareProLeagueAggregateRefresher } from "./source-aware-pro-league-aggregate-refresher";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const OWNER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;

const MAXIMUM_OBJECT_BYTES = 1_048_576;
const MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION = 524_288;
const MAXIMUM_ROWS_PER_PARTITION = 500;
const MAXIMUM_SELECTED_PARTITIONS = 10_000;

export type HostedRaceArchiveAggregateRefresherEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
  workerId: string | undefined;
  cloudflareAccountId: string | undefined;
  cloudflareApiToken: string | undefined;
  bucketName: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
}>;

export type HostedRaceArchiveAggregateRefresherDependencies = Readonly<{
  control?: RaceArchiveAggregateRefreshControl;
  manifestRepository?: SealedRaceArchiveManifestRepository;
  objectReader?: PrivateDatasetEvidenceObjectReader;
  evidencePort?: PrivateDatasetEvidenceObjectReadableStoragePort;
  publicationRepository?: NeonRaceArchiveAggregatePublicationRepository;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  fetch?: typeof globalThis.fetch;
  now?: () => Date;
}>;

export type HostedRaceArchiveAggregateRefresherRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "ready"; refresher: BoundedAggregateRefresher }>;

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

function configured(environment: HostedRaceArchiveAggregateRefresherEnvironment) {
  const ownerId = environment.authorizedOwnerId?.trim() ?? "";
  const databaseUrl = secret(environment.databaseUrl);
  const databaseOwnerId = environment.databaseOwnerId?.trim() ?? "";
  const runtimeRole = environment.runtimeRole?.trim() ?? "";
  const workerId = environment.workerId?.trim() ?? "";
  const accountId = environment.cloudflareAccountId?.trim().toLowerCase() ?? "";
  const apiToken = secret(environment.cloudflareApiToken);
  const bucketName = environment.bucketName?.trim() ?? "";
  const accessKeyId = secret(environment.r2AccessKeyId);
  const secretAccessKey = secret(environment.r2SecretAccessKey);
  if (
    !OWNER_ID_PATTERN.test(ownerId) ||
    databaseUrl === null ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !ROLE_PATTERN.test(runtimeRole) ||
    !OWNER_ID_PATTERN.test(workerId) ||
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
    databaseUrl,
    databaseOwnerId: databaseOwnerId.toLowerCase(),
    runtimeRole,
    workerId,
    accountId,
    apiToken,
    bucketName,
    accessKeyId,
    secretAccessKey,
  });
}

export function hostedRaceArchiveAggregateRefresherRuntime(input: {
  environment: HostedRaceArchiveAggregateRefresherEnvironment;
  currentStateRefresher: BoundedAggregateRefresher;
  dependencies?: HostedRaceArchiveAggregateRefresherDependencies;
}): HostedRaceArchiveAggregateRefresherRuntime {
  const config = configured(input.environment);
  if (config === null) return Object.freeze({ status: "not_configured" as const });

  try {
    const control =
      input.dependencies?.control ??
      createNeonRaceArchiveAggregateRefreshControl({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        runtimeRole: config.runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });
    const manifestRepository =
      input.dependencies?.manifestRepository ??
      createNeonSealedRaceArchiveManifestRepository({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        runtimeRole: config.runtimeRole,
      });
    const objectReader =
      input.dependencies?.objectReader ??
      createPrivateDatasetEvidenceObjectReader({
        ownerId: config.ownerId,
        bucketName: config.bucketName,
        maximumObjectBytes: MAXIMUM_OBJECT_BYTES,
        createPort: () =>
          input.dependencies?.evidencePort ??
          createCloudflareR2DatasetEvidencePort({
            accountId: config.accountId,
            accessKeyId: config.accessKeyId,
            secretAccessKey: config.secretAccessKey,
            apiToken: config.apiToken,
            fetch: input.dependencies?.fetch ?? globalThis.fetch,
          }),
      });
    const archiveReader = createSealedRaceArchiveReader({
      manifestRepository,
      objectReader,
      maximumUncompressedBytesPerPartition:
        MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION,
      maximumRowsPerPartition: MAXIMUM_ROWS_PER_PARTITION,
      maximumSelectedPartitions: MAXIMUM_SELECTED_PARTITIONS,
    });
    const publicationRepository =
      input.dependencies?.publicationRepository ??
      createNeonRaceArchiveAggregatePublicationRepository({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        runtimeRole: config.runtimeRole,
        ...(input.dependencies?.neonSessionFactory
          ? { sessionFactory: input.dependencies.neonSessionFactory }
          : {}),
      });
    const raceArchiveRefresher = createRaceArchiveAggregateRefresher({
      planRepository: control.planRepository,
      rehydrator: createRaceStagedRowRehydrator({ archiveReader }),
      publicationRepository,
      finalizer: input.currentStateRefresher,
      workerId: config.workerId,
      ...(input.dependencies?.now ? { now: input.dependencies.now } : {}),
    });
    return Object.freeze({
      status: "ready" as const,
      refresher: createSourceAwareProLeagueAggregateRefresher({
        targetSourceReader: control,
        raceArchiveRefresher,
        currentStateRefresher: input.currentStateRefresher,
      }),
    });
  } catch {
    return Object.freeze({ status: "not_configured" as const });
  }
}
