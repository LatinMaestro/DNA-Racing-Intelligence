import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
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
  type PrivateDatasetEvidenceObjectReader,
  type PrivateDatasetEvidenceObjectReadableStoragePort,
} from "./private-dataset-evidence-object-reader";
import {
  createRaceArchiveCoreHistoryService,
  type RaceArchiveCoreHistoryService,
} from "./race-archive-core-history-service";
import { createSealedRaceArchiveReader } from "./sealed-race-archive-reader";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const OWNER_ID_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const ROLE_PATTERN = /^[a-z_][a-z0-9_]{0,62}$/;
const BUCKET_NAME_PATTERN =
  /^(?!.*\.\.)(?!.*--)[a-z0-9](?:[a-z0-9.-]{1,61}[a-z0-9])?$/;

const MAXIMUM_VERSIONS = 24;
const MAXIMUM_ARCHIVE_PARTITIONS = 10_000;
const MAXIMUM_SELECTED_PARTITIONS = 10_000;
const MAXIMUM_OBJECT_BYTES = 1_048_576;
const MAXIMUM_UNCOMPRESSED_BYTES_PER_PARTITION = 524_288;
const MAXIMUM_ROWS_PER_PARTITION = 500;
const MAXIMUM_HISTORY_ROWS = 100_000;

export type HostedRaceArchiveCoreHistoryEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  databaseUrl: string | undefined;
  databaseOwnerId: string | undefined;
  runtimeRole: string | undefined;
  cloudflareAccountId: string | undefined;
  cloudflareApiToken: string | undefined;
  bucketName: string | undefined;
  r2AccessKeyId: string | undefined;
  r2SecretAccessKey: string | undefined;
}>;

export type HostedRaceArchiveCoreHistoryDependencies = Readonly<{
  locatorRepository?: NeonRaceArchiveCoreLocatorRepository;
  manifestRepository?: SealedRaceArchiveManifestRepository;
  objectReader?: PrivateDatasetEvidenceObjectReader;
  evidencePort?: PrivateDatasetEvidenceObjectReadableStoragePort;
  fetch?: typeof globalThis.fetch;
}>;

export type HostedRaceArchiveCoreHistoryRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "ready"; service: RaceArchiveCoreHistoryService }>;

export const unavailableHostedRaceArchiveCoreHistoryRuntime: HostedRaceArchiveCoreHistoryRuntime =
  Object.freeze({ status: "not_configured" });

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

function configured(input: HostedRaceArchiveCoreHistoryEnvironment): null | Readonly<{
  ownerId: string;
  databaseUrl: string;
  databaseOwnerId: string;
  runtimeRole: string;
  accountId: string;
  apiToken: string;
  bucketName: string;
  accessKeyId: string;
  secretAccessKey: string;
}> {
  const ownerId = input.authorizedOwnerId?.trim() ?? "";
  const databaseUrl = secret(input.databaseUrl);
  const databaseOwnerId = input.databaseOwnerId?.trim() ?? "";
  const runtimeRole = input.runtimeRole?.trim() ?? "";
  const accountId = input.cloudflareAccountId?.trim().toLowerCase() ?? "";
  const apiToken = secret(input.cloudflareApiToken);
  const bucketName = input.bucketName?.trim() ?? "";
  const accessKeyId = secret(input.r2AccessKeyId);
  const secretAccessKey = secret(input.r2SecretAccessKey);
  if (
    !OWNER_ID_PATTERN.test(ownerId) ||
    databaseUrl === null ||
    !UUID_PATTERN.test(databaseOwnerId) ||
    !ROLE_PATTERN.test(runtimeRole) ||
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
    accountId,
    apiToken,
    bucketName,
    accessKeyId,
    secretAccessKey,
  });
}

export function hostedRaceArchiveCoreHistoryRuntime(input: {
  environment: HostedRaceArchiveCoreHistoryEnvironment;
  dependencies?: HostedRaceArchiveCoreHistoryDependencies;
}): HostedRaceArchiveCoreHistoryRuntime {
  const config = configured(input.environment);
  if (config === null) return unavailableHostedRaceArchiveCoreHistoryRuntime;

  try {
    const locatorRepository =
      input.dependencies?.locatorRepository ??
      createNeonRaceArchiveCoreLocatorRepository({
        databaseUrl: config.databaseUrl,
        databaseOwnerId: config.databaseOwnerId,
        runtimeRole: config.runtimeRole,
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
    return Object.freeze({
      status: "ready" as const,
      service: createRaceArchiveCoreHistoryService({
        locatorRepository,
        archiveReader,
        maximumVersions: MAXIMUM_VERSIONS,
        maximumArchivePartitions: MAXIMUM_ARCHIVE_PARTITIONS,
        maximumHistoryRows: MAXIMUM_HISTORY_ROWS,
      }),
    });
  } catch {
    return unavailableHostedRaceArchiveCoreHistoryRuntime;
  }
}
