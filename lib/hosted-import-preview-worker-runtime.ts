import {
  createBoundedImportPreviewProcessor,
  type ImportPreviewStagingSink,
} from "./bounded-import-preview-processor";
import { createCloudflareR2DatasetEvidencePort } from "./cloudflare-r2-dataset-evidence-port";
import {
  cloudflareR2ImportObjectStorageConfigurationFromEnvironment,
  createCloudflareR2ImportObjectStorageForOwner,
  type CloudflareR2ImportObjectStoragePort,
} from "./cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import { createDurableImportPreviewEvidenceLifecycle } from "./durable-import-preview-evidence-lifecycle";
import { createDurableImportPreviewStagingSink } from "./durable-import-preview-staging-sink";
import {
  consumeImportPreviewQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import { createNeonDatasetEvidenceObjectRepository } from "./neon-dataset-evidence-object-repository";
import {
  neonImportPreviewProcessingRepositoryFromEnvironment,
  type ImportPreviewProcessingRepositoryEnvironment,
} from "./neon-import-preview-processing-repository";
import { neonDurableImportPreviewStagingRepositoryFromEnvironment } from "./neon-durable-import-preview-staging-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";
import {
  createPrivateDatasetEvidenceObjectRecovery,
  createPrivateDatasetEvidenceObjectStorageWriter,
  type PrivateDatasetEvidenceObjectDeletionPort,
} from "./private-dataset-evidence-object-writer";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

export type HostedImportPreviewWorkerEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  workerId: string | undefined;
  database: ImportPreviewProcessingRepositoryEnvironment;
  r2: Readonly<{
    accountId: string | undefined;
    bucketName: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  }>;
  cloudflareApiToken: string | undefined;
  leaseDurationMilliseconds: string | undefined;
  maximumBatchBytes: string | undefined;
  maximumObjectBytes: string | undefined;
  maximumChunkBytes: string | undefined;
}>;

export type HostedImportPreviewWorkerDependencies = Readonly<{
  now?: () => Date;
  fetch?: typeof globalThis.fetch;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  r2Port?: CloudflareR2ImportObjectStoragePort;
  evidenceR2Port?: PrivateDatasetEvidenceObjectDeletionPort;
  stagingSink?: ImportPreviewStagingSink;
}>;

export type HostedImportPreviewWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (input: {
        body: unknown;
        now?: Date;
      }) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedImportPreviewWorkerRuntime: HostedImportPreviewWorkerRuntime =
  Object.freeze({ status: "not_configured" });

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

function positiveInteger(value: string | undefined): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  return Number.isSafeInteger(parsed) ? parsed : null;
}

export function hostedImportPreviewWorkerRuntime(input: {
  environment: HostedImportPreviewWorkerEnvironment;
  dependencies?: HostedImportPreviewWorkerDependencies;
}): HostedImportPreviewWorkerRuntime {
  const ownerId = identifier(input.environment.authorizedOwnerId);
  const workerId = identifier(input.environment.workerId);
  const accountId = input.environment.r2.accountId?.trim().toLowerCase() ?? "";
  const accessKeyId = secret(input.environment.r2.accessKeyId);
  const secretAccessKey = secret(input.environment.r2.secretAccessKey);
  const apiToken = secret(input.environment.cloudflareApiToken);
  const leaseDurationMilliseconds = positiveInteger(
    input.environment.leaseDurationMilliseconds,
  );
  const maximumBatchBytes = positiveInteger(
    input.environment.maximumBatchBytes,
  );
  const maximumObjectBytes = positiveInteger(
    input.environment.maximumObjectBytes,
  );
  const maximumChunkBytes = positiveInteger(
    input.environment.maximumChunkBytes,
  );
  if (
    ownerId === null ||
    workerId === null ||
    !ACCOUNT_ID_PATTERN.test(accountId) ||
    accessKeyId === null ||
    secretAccessKey === null ||
    apiToken === null ||
    leaseDurationMilliseconds === null ||
    leaseDurationMilliseconds < 1_000 ||
    leaseDurationMilliseconds > 60 * 60 * 1_000 ||
    maximumBatchBytes === null ||
    maximumObjectBytes === null ||
    maximumChunkBytes === null ||
    maximumChunkBytes > maximumObjectBytes ||
    maximumObjectBytes > maximumBatchBytes
  ) {
    return unavailableHostedImportPreviewWorkerRuntime;
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const fetcher = input.dependencies?.fetch ?? globalThis.fetch;

  try {
    const repository = neonImportPreviewProcessingRepositoryFromEnvironment(
      input.environment.database,
      input.dependencies?.neonSessionFactory,
    );
    const r2Configuration =
      cloudflareR2ImportObjectStorageConfigurationFromEnvironment({
        accountId,
        bucketName: input.environment.r2.bucketName,
        createPort: () =>
          input.dependencies?.r2Port ??
          createCloudflareR2S3Port({
            accountId,
            accessKeyId,
            secretAccessKey,
            apiToken,
            now,
            fetch: fetcher,
          }),
      });
    if (repository === null || r2Configuration === null) {
      return unavailableHostedImportPreviewWorkerRuntime;
    }
    const stagingRepository =
      input.dependencies?.stagingSink === undefined
        ? neonDurableImportPreviewStagingRepositoryFromEnvironment(
            input.environment.database,
            input.dependencies?.neonSessionFactory,
          )
        : null;
    const evidenceRepository =
      stagingRepository === null
        ? null
        : createNeonDatasetEvidenceObjectRepository({
            databaseUrl: input.environment.database.databaseUrl ?? "",
            databaseOwnerId: input.environment.database.databaseOwnerId ?? "",
            runtimeRole: input.environment.database.runtimeRole ?? "",
            ...(input.dependencies?.neonSessionFactory
              ? {
                  sessionFactory: input.dependencies.neonSessionFactory,
                }
              : {}),
          });
    const evidencePort =
      evidenceRepository === null
        ? null
        : (input.dependencies?.evidenceR2Port ??
          createCloudflareR2DatasetEvidencePort({
            accountId,
            accessKeyId,
            secretAccessKey,
            apiToken,
            maximumBufferedPutBytes: maximumChunkBytes,
            fetch: fetcher,
          }));
    const evidenceLifecycle =
      evidenceRepository === null || evidencePort === null
        ? null
        : createDurableImportPreviewEvidenceLifecycle({
            ownerId,
            storageWriter: createPrivateDatasetEvidenceObjectStorageWriter({
              ownerId,
              bucketName: r2Configuration.bucketName,
              maximumObjectBytes,
              createPort: () => evidencePort,
            }),
            recovery: createPrivateDatasetEvidenceObjectRecovery({
              ownerId,
              bucketName: r2Configuration.bucketName,
              maximumObjectBytes,
              createPort: () => evidencePort,
              inspectionRepository: evidenceRepository,
            }),
            maximumUncompressedBytes: Math.max(
              1,
              Math.floor(maximumChunkBytes / 2),
            ),
            maximumRowsPerPartition: 500,
            now,
          });
    const stagingSink =
      input.dependencies?.stagingSink ??
      (stagingRepository === null || evidenceLifecycle === null
        ? null
        : createDurableImportPreviewStagingSink({
            repository: stagingRepository,
            evidenceLifecycle,
          }));
    if (stagingSink === null) {
      return unavailableHostedImportPreviewWorkerRuntime;
    }

    const objectStorage = createCloudflareR2ImportObjectStorageForOwner({
      ownerId,
      configuration: r2Configuration,
    });
    const processor = createBoundedImportPreviewProcessor({
      objectStorage,
      stagingSink,
      maximumObjectBytes,
      maximumChunkBytes,
    });
    const capabilities = Object.freeze({
      status: "ready" as const,
      repository,
      processor,
    });

    return Object.freeze({
      status: "ready" as const,
      consume(consumeInput: { body: unknown; now?: Date }) {
        return consumeImportPreviewQueueMessage({
          body: consumeInput.body,
          workerId,
          now: consumeInput.now ?? now(),
          leaseDurationMilliseconds,
          maximumBatchBytes,
          capabilities,
        });
      },
    });
  } catch {
    return unavailableHostedImportPreviewWorkerRuntime;
  }
}
