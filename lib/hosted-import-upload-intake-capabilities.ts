import {
  cloudflareR2ImportObjectStorageConfigurationFromEnvironment,
  createCloudflareR2ImportObjectStorageForOwner,
  type CloudflareR2ImportObjectStoragePort,
} from "./cloudflare-r2-import-object-storage";
import {
  createImportProviderCapacityGateForOwner,
  importProviderCapacityConfigurationFromEnvironment,
  type ImportCapacityResource,
  type ImportProviderCapacityPort,
} from "./import-provider-capacity-adapter";
import {
  type ImportUploadIntakeCapabilities,
  unavailableImportUploadIntakeCapabilities,
} from "./import-upload-intake-service";
import {
  neonImportUploadIntakeRepositoryFromEnvironment,
  type ImportUploadRepositoryEnvironment,
} from "./neon-import-upload-intake-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

export type HostedImportUploadIntakeEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  database: ImportUploadRepositoryEnvironment;
  r2: Readonly<{
    accountId: string | undefined;
    bucketName: string | undefined;
  }>;
  capacity: Readonly<{
    approvedLimits: Readonly<
      Partial<Record<ImportCapacityResource, string | undefined>>
    >;
    minimumHeadroomBasisPoints: string | undefined;
    maximumMeasurementAgeMilliseconds: string | undefined;
  }>;
}>;

export type HostedImportUploadIntakeDependencies = Readonly<{
  now: () => Date;
  createR2Port: () =>
    | CloudflareR2ImportObjectStoragePort
    | Promise<CloudflareR2ImportObjectStoragePort>;
  createCapacityPort: () =>
    ImportProviderCapacityPort | Promise<ImportProviderCapacityPort>;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
}>;

export function hostedImportUploadIntakeCapabilities(input: {
  environment: HostedImportUploadIntakeEnvironment;
  dependencies: HostedImportUploadIntakeDependencies;
}): ImportUploadIntakeCapabilities {
  const ownerId = input.environment.authorizedOwnerId?.trim() ?? "";
  if (ownerId === "") return unavailableImportUploadIntakeCapabilities;

  try {
    const repository = neonImportUploadIntakeRepositoryFromEnvironment(
      input.environment.database,
      input.dependencies.neonSessionFactory,
    );
    const r2Configuration =
      cloudflareR2ImportObjectStorageConfigurationFromEnvironment({
        ...input.environment.r2,
        createPort: input.dependencies.createR2Port,
      });
    const capacityConfiguration =
      importProviderCapacityConfigurationFromEnvironment({
        ...input.environment.capacity,
        now: input.dependencies.now,
        createPort: input.dependencies.createCapacityPort,
      });
    if (
      repository === null ||
      r2Configuration === null ||
      capacityConfiguration === null
    ) {
      return unavailableImportUploadIntakeCapabilities;
    }

    return Object.freeze({
      status: "ready",
      repository,
      capacityGate: createImportProviderCapacityGateForOwner({
        ownerId,
        configuration: capacityConfiguration,
      }),
      privateObjectStore: createCloudflareR2ImportObjectStorageForOwner({
        ownerId,
        configuration: r2Configuration,
      }),
    });
  } catch {
    return unavailableImportUploadIntakeCapabilities;
  }
}
