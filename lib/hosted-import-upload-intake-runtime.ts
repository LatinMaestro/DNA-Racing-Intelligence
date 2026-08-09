import { createCloudflareNeonImportCapacityPort } from "./cloudflare-neon-import-capacity-port";
import {
  hostedImportUploadIntakeCapabilities,
  type HostedImportUploadIntakeEnvironment,
} from "./hosted-import-upload-intake-capabilities";
import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import { createNeonImportStorageBytesReader } from "./neon-import-capacity-reader";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  type ImportUploadIntakeCapabilities,
  unavailableImportUploadIntakeCapabilities,
} from "./import-upload-intake-service";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type HostedImportUploadIntakeRuntimeEnvironment =
  HostedImportUploadIntakeEnvironment &
    Readonly<{
      r2: HostedImportUploadIntakeEnvironment["r2"] &
        Readonly<{
          accessKeyId: string | undefined;
          secretAccessKey: string | undefined;
        }>;
      cloudflareApiToken: string | undefined;
      queueId: string | undefined;
    }>;

export type HostedImportUploadIntakeRuntimeDependencies = Readonly<{
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
}>;

function secret(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  if (
    normalized === "" ||
    normalized.length > 4096 ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    return null;
  }
  return normalized;
}

function identifier(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

export function hostedImportUploadIntakeRuntime(input: {
  environment: HostedImportUploadIntakeRuntimeEnvironment;
  dependencies?: HostedImportUploadIntakeRuntimeDependencies;
}): ImportUploadIntakeCapabilities {
  const ownerId = input.environment.authorizedOwnerId?.trim() ?? "";
  const databaseUrl = input.environment.database.databaseUrl?.trim() ?? "";
  const databaseOwnerId =
    input.environment.database.databaseOwnerId?.trim() ?? "";
  const runtimeRole = input.environment.database.runtimeRole?.trim() ?? "";
  const cloudflareApiToken = secret(input.environment.cloudflareApiToken);
  const r2AccessKeyId = secret(input.environment.r2.accessKeyId);
  const r2SecretAccessKey = secret(input.environment.r2.secretAccessKey);
  const queueId = identifier(input.environment.queueId);

  if (
    ownerId === "" ||
    databaseUrl === "" ||
    databaseOwnerId === "" ||
    runtimeRole === "" ||
    cloudflareApiToken === null ||
    r2AccessKeyId === null ||
    r2SecretAccessKey === null ||
    queueId === null
  ) {
    return unavailableImportUploadIntakeCapabilities;
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const fetcher = input.dependencies?.fetch ?? globalThis.fetch;
  const neonSessionFactory = input.dependencies?.neonSessionFactory;

  return hostedImportUploadIntakeCapabilities({
    environment: input.environment,
    dependencies: {
      now,
      createR2Port: () =>
        createCloudflareR2S3Port({
          accountId: input.environment.r2.accountId ?? "",
          accessKeyId: r2AccessKeyId,
          secretAccessKey: r2SecretAccessKey,
          apiToken: cloudflareApiToken,
          now,
          fetch: fetcher,
        }),
      createCapacityPort: () =>
        createCloudflareNeonImportCapacityPort({
          authorizedOwnerId: ownerId,
          cloudflareAccountId: input.environment.r2.accountId ?? "",
          cloudflareApiToken,
          r2BucketName: input.environment.r2.bucketName ?? "",
          queueId,
          now,
          fetch: fetcher,
          readNeonStorageBytes: createNeonImportStorageBytesReader({
            authorizedOwnerId: ownerId,
            databaseOwnerId,
            databaseUrl,
            runtimeRole,
            ...(neonSessionFactory
              ? { sessionFactory: neonSessionFactory }
              : {}),
          }),
        }),
      ...(neonSessionFactory ? { neonSessionFactory } : {}),
    },
  });
}
