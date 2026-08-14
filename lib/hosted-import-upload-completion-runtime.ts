import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueueForOwner,
} from "./cloudflare-import-queue-adapter";
import { createCloudflareImportQueuePort } from "./cloudflare-import-queue-port";
import {
  cloudflareR2ImportObjectStorageConfigurationFromEnvironment,
  createCloudflareR2ImportObjectStorageForOwner,
} from "./cloudflare-r2-import-object-storage";
import { createCloudflareR2S3Port } from "./cloudflare-r2-s3-port";
import {
  type ImportUploadCompletionCapabilities,
  unavailableImportUploadCompletionCapabilities,
} from "./import-upload-completion-service";
import {
  neonImportUploadCompletionRepositoryFromEnvironment,
  type ImportUploadCompletionRepositoryEnvironment,
} from "./neon-import-upload-completion-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const ACCOUNT_ID_PATTERN = /^[a-f0-9]{32}$/;
const QUEUE_ID_PATTERN = /^[a-f0-9]{32}$/;

export type HostedImportUploadCompletionRuntimeEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  database: ImportUploadCompletionRepositoryEnvironment;
  r2: Readonly<{
    accountId: string | undefined;
    bucketName: string | undefined;
    accessKeyId: string | undefined;
    secretAccessKey: string | undefined;
  }>;
  cloudflareApiToken: string | undefined;
  queueId: string | undefined;
  queueName: string | undefined;
  deadLetterQueueName: string | undefined;
}>;

export type HostedImportUploadCompletionRuntimeDependencies = Readonly<{
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

function providerId(value: string | undefined, pattern: RegExp): string | null {
  const normalized = value?.trim().toLowerCase() ?? "";
  return pattern.test(normalized) ? normalized : null;
}

export function hostedImportUploadCompletionRuntime(input: {
  environment: HostedImportUploadCompletionRuntimeEnvironment;
  dependencies?: HostedImportUploadCompletionRuntimeDependencies;
}): ImportUploadCompletionCapabilities {
  const ownerId = input.environment.authorizedOwnerId?.trim() ?? "";
  const cloudflareApiToken = secret(input.environment.cloudflareApiToken);
  const r2AccessKeyId = secret(input.environment.r2.accessKeyId);
  const r2SecretAccessKey = secret(input.environment.r2.secretAccessKey);
  const accountId = providerId(
    input.environment.r2.accountId,
    ACCOUNT_ID_PATTERN,
  );
  const queueId = providerId(input.environment.queueId, QUEUE_ID_PATTERN);

  if (
    ownerId === "" ||
    cloudflareApiToken === null ||
    r2AccessKeyId === null ||
    r2SecretAccessKey === null ||
    accountId === null ||
    queueId === null
  ) {
    return unavailableImportUploadCompletionCapabilities;
  }

  const now = input.dependencies?.now ?? (() => new Date());
  const fetcher = input.dependencies?.fetch ?? globalThis.fetch;
  const neonSessionFactory = input.dependencies?.neonSessionFactory;

  try {
    const repository = neonImportUploadCompletionRepositoryFromEnvironment(
      input.environment.database,
      neonSessionFactory,
    );
    const r2Configuration =
      cloudflareR2ImportObjectStorageConfigurationFromEnvironment({
        accountId,
        bucketName: input.environment.r2.bucketName,
        createPort: () =>
          createCloudflareR2S3Port({
            accountId,
            accessKeyId: r2AccessKeyId,
            secretAccessKey: r2SecretAccessKey,
            apiToken: cloudflareApiToken,
            now,
            fetch: fetcher,
          }),
      });
    const queueConfiguration =
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: input.environment.queueName,
        deadLetterQueueName: input.environment.deadLetterQueueName,
        createPort: () =>
          createCloudflareImportQueuePort({
            accountId,
            queueId,
            queueName: input.environment.queueName ?? "",
            apiToken: cloudflareApiToken,
            fetch: fetcher,
          }),
      });
    if (
      repository === null ||
      r2Configuration === null ||
      queueConfiguration === null
    ) {
      return unavailableImportUploadCompletionCapabilities;
    }

    return Object.freeze({
      status: "ready",
      repository,
      objectInspector: createCloudflareR2ImportObjectStorageForOwner({
        ownerId,
        configuration: r2Configuration,
      }),
      previewQueue: createCloudflareImportQueueForOwner({
        ownerId,
        configuration: queueConfiguration,
      }),
    });
  } catch {
    return unavailableImportUploadCompletionCapabilities;
  }
}
