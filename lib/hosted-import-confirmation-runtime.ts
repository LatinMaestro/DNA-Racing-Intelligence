import {
  createCloudflareImportQueueForOwner,
  cloudflareImportQueueConfigurationFromEnvironment,
} from "./cloudflare-import-queue-adapter";
import { createCloudflareImportQueuePort } from "./cloudflare-import-queue-port";
import { createCloudflareNeonImportCapacityPort } from "./cloudflare-neon-import-capacity-port";
import {
  createImportProviderCapacityGateForOwner,
  importProviderCapacityConfigurationFromEnvironment,
  type ImportCapacityResource,
} from "./import-provider-capacity-adapter";
import {
  type ImportActivationCapabilities,
  unavailableImportActivationCapabilities,
} from "./import-activation-service";
import {
  neonImportActivationRepositoriesFromEnvironment,
  type ImportActivationDatabaseEnvironment,
} from "./neon-import-activation";
import { createNeonImportStorageBytesReader } from "./neon-import-capacity-reader";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const PROVIDER_ID_PATTERN = /^[a-f0-9]{32}$/;

export type HostedImportConfirmationRuntimeEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  database: ImportActivationDatabaseEnvironment;
  cloudflare: Readonly<{
    accountId: string | undefined;
    apiToken: string | undefined;
    r2BucketName: string | undefined;
    queueId: string | undefined;
    queueName: string | undefined;
    deadLetterQueueName: string | undefined;
  }>;
  capacity: Readonly<{
    approvedLimits: Readonly<
      Partial<Record<ImportCapacityResource, string | undefined>>
    >;
    minimumHeadroomBasisPoints: string | undefined;
    maximumMeasurementAgeMilliseconds: string | undefined;
  }>;
}>;

export type HostedImportConfirmationRuntimeDependencies = Readonly<{
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

function providerId(value: string | undefined): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return PROVIDER_ID_PATTERN.test(normalized) ? normalized : null;
}

export function hostedImportConfirmationRuntime(input: {
  environment: HostedImportConfirmationRuntimeEnvironment;
  dependencies?: HostedImportConfirmationRuntimeDependencies;
}): ImportActivationCapabilities {
  const ownerId = input.environment.authorizedOwnerId?.trim() ?? "";
  const accountId = providerId(input.environment.cloudflare.accountId);
  const queueId = providerId(input.environment.cloudflare.queueId);
  const cloudflareApiToken = secret(input.environment.cloudflare.apiToken);
  if (
    ownerId === "" ||
    accountId === null ||
    queueId === null ||
    cloudflareApiToken === null
  ) {
    return unavailableImportActivationCapabilities;
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const fetcher = input.dependencies?.fetch ?? globalThis.fetch;
  const sessionFactory = input.dependencies?.neonSessionFactory;

  try {
    const repositories = neonImportActivationRepositoriesFromEnvironment(
      input.environment.database,
      sessionFactory,
    );
    const capacityConfiguration =
      importProviderCapacityConfigurationFromEnvironment({
        ...input.environment.capacity,
        now,
        createPort: () =>
          createCloudflareNeonImportCapacityPort({
            authorizedOwnerId: ownerId,
            cloudflareAccountId: accountId,
            cloudflareApiToken,
            r2BucketName: input.environment.cloudflare.r2BucketName ?? "",
            queueId,
            now,
            fetch: fetcher,
            readNeonStorageBytes: createNeonImportStorageBytesReader({
              authorizedOwnerId: ownerId,
              databaseOwnerId:
                input.environment.database.databaseOwnerId ?? "",
              databaseUrl: input.environment.database.databaseUrl ?? "",
              runtimeRole: input.environment.database.runtimeRole ?? "",
              ...(sessionFactory ? { sessionFactory } : {}),
            }),
          }),
      });
    const queueConfiguration =
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: input.environment.cloudflare.queueName,
        deadLetterQueueName:
          input.environment.cloudflare.deadLetterQueueName,
        createPort: () =>
          createCloudflareImportQueuePort({
            accountId,
            queueId,
            queueName: input.environment.cloudflare.queueName ?? "",
            apiToken: cloudflareApiToken,
            fetch: fetcher,
          }),
      });
    if (
      repositories === null ||
      capacityConfiguration === null ||
      queueConfiguration === null
    ) {
      return unavailableImportActivationCapabilities;
    }

    return Object.freeze({
      repository: Object.freeze({
        status: "ready" as const,
        service: repositories.activationRepository,
      }),
      rawUploadStore: Object.freeze({
        status: "ready" as const,
        service: repositories.readinessStore,
      }),
      capacityGate: Object.freeze({
        status: "ready" as const,
        service: createImportProviderCapacityGateForOwner({
          ownerId,
          configuration: capacityConfiguration,
        }),
      }),
      backgroundQueue: Object.freeze({
        status: "ready" as const,
        service: createCloudflareImportQueueForOwner({
          ownerId,
          configuration: queueConfiguration,
        }),
      }),
    });
  } catch {
    return unavailableImportActivationCapabilities;
  }
}
