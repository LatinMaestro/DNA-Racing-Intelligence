import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueueForOwner,
  type CloudflareImportQueuePort,
} from "./cloudflare-import-queue-adapter";
import {
  createCloudflareImportQueueBindingPort,
  type CloudflareQueueProducerBinding,
} from "./cloudflare-import-queue-binding-port";
import { createCloudflareImportQueuePort } from "./cloudflare-import-queue-port";
import {
  hostedImportQueueWorkerRuntime,
  type HostedImportQueueWorkerDependencies,
  type HostedImportQueueWorkerRuntime,
} from "./hosted-import-queue-worker-runtime";

export type HostedCloudflareImportQueueWorkerBindings = Readonly<{
  AUTHORIZED_CLERK_USER_ID: string | undefined;
  DATABASE_URL: string | undefined;
  DNA_DATABASE_OWNER_ID: string | undefined;
  DNA_DATABASE_RUNTIME_ROLE: string | undefined;
  CLOUDFLARE_ACCOUNT_ID: string | undefined;
  CLOUDFLARE_API_TOKEN: string | undefined;
  DNA_R2_BUCKET_NAME: string | undefined;
  DNA_R2_ACCESS_KEY_ID: string | undefined;
  DNA_R2_SECRET_ACCESS_KEY: string | undefined;
  DNA_IMPORT_QUEUE_ID: string | undefined;
  DNA_IMPORT_QUEUE_NAME: string | undefined;
  DNA_IMPORT_DEAD_LETTER_QUEUE_NAME: string | undefined;
  DNA_IMPORT_WORKER_ID: string | undefined;
  DNA_IMPORT_LEASE_DURATION_MILLISECONDS: string | undefined;
  DNA_IMPORT_MAXIMUM_BATCH_BYTES: string | undefined;
  DNA_IMPORT_MAXIMUM_OBJECT_BYTES: string | undefined;
  DNA_IMPORT_MAXIMUM_CHUNK_BYTES: string | undefined;
  DNA_IMPORT_MAXIMUM_SOURCE_VERSIONS: string | undefined;
  DNA_IMPORT_MAXIMUM_QUARANTINED_RECORDS: string | undefined;
  DNA_IMPORT_QUEUE: CloudflareQueueProducerBinding | undefined;
}>;

export type HostedCloudflareImportQueueWorkerDependencies = Readonly<{
  runtime?: HostedImportQueueWorkerDependencies;
  queueEvidencePort?: Pick<CloudflareImportQueuePort, "readQueueEvidence">;
}>;

export function hostedCloudflareImportQueueWorkerRuntime(input: {
  bindings: HostedCloudflareImportQueueWorkerBindings;
  dependencies?: HostedCloudflareImportQueueWorkerDependencies;
}): HostedImportQueueWorkerRuntime {
  const bindings = input.bindings;
  if (bindings.DNA_IMPORT_QUEUE === undefined) {
    return { status: "not_configured" };
  }

  try {
    const evidencePort =
      input.dependencies?.queueEvidencePort ??
      createCloudflareImportQueuePort({
        accountId: bindings.CLOUDFLARE_ACCOUNT_ID ?? "",
        queueId: bindings.DNA_IMPORT_QUEUE_ID ?? "",
        queueName: bindings.DNA_IMPORT_QUEUE_NAME ?? "",
        apiToken: bindings.CLOUDFLARE_API_TOKEN ?? "",
        fetch:
          input.dependencies?.runtime?.activation?.fetch ?? globalThis.fetch,
      });
    const bindingPort = createCloudflareImportQueueBindingPort({
      queueName: bindings.DNA_IMPORT_QUEUE_NAME ?? "",
      binding: bindings.DNA_IMPORT_QUEUE,
      evidencePort,
    });
    const queueConfiguration =
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: bindings.DNA_IMPORT_QUEUE_NAME,
        deadLetterQueueName: bindings.DNA_IMPORT_DEAD_LETTER_QUEUE_NAME,
        createPort: () => bindingPort,
      });
    if (queueConfiguration === null) {
      return { status: "not_configured" };
    }
    const aggregateQueue = createCloudflareImportQueueForOwner({
      ownerId: bindings.AUTHORIZED_CLERK_USER_ID ?? "",
      configuration: queueConfiguration,
    });
    const database = {
      databaseUrl: bindings.DATABASE_URL,
      databaseOwnerId: bindings.DNA_DATABASE_OWNER_ID,
      runtimeRole: bindings.DNA_DATABASE_RUNTIME_ROLE,
    };

    return hostedImportQueueWorkerRuntime({
      environment: {
        preview: {
          authorizedOwnerId: bindings.AUTHORIZED_CLERK_USER_ID,
          workerId: bindings.DNA_IMPORT_WORKER_ID,
          database,
          r2: {
            accountId: bindings.CLOUDFLARE_ACCOUNT_ID,
            bucketName: bindings.DNA_R2_BUCKET_NAME,
            accessKeyId: bindings.DNA_R2_ACCESS_KEY_ID,
            secretAccessKey: bindings.DNA_R2_SECRET_ACCESS_KEY,
          },
          cloudflareApiToken: bindings.CLOUDFLARE_API_TOKEN,
          leaseDurationMilliseconds:
            bindings.DNA_IMPORT_LEASE_DURATION_MILLISECONDS,
          maximumBatchBytes: bindings.DNA_IMPORT_MAXIMUM_BATCH_BYTES,
          maximumObjectBytes: bindings.DNA_IMPORT_MAXIMUM_OBJECT_BYTES,
          maximumChunkBytes: bindings.DNA_IMPORT_MAXIMUM_CHUNK_BYTES,
        },
        activation: {
          workerId: bindings.DNA_IMPORT_WORKER_ID,
          authorizedOwnerId: bindings.AUTHORIZED_CLERK_USER_ID,
          database,
          cloudflare: {
            accountId: bindings.CLOUDFLARE_ACCOUNT_ID,
            apiToken: bindings.CLOUDFLARE_API_TOKEN,
            queueId: bindings.DNA_IMPORT_QUEUE_ID,
            queueName: bindings.DNA_IMPORT_QUEUE_NAME,
            deadLetterQueueName: bindings.DNA_IMPORT_DEAD_LETTER_QUEUE_NAME,
          },
          leaseDurationMilliseconds:
            bindings.DNA_IMPORT_LEASE_DURATION_MILLISECONDS,
          maximumSourceVersions: bindings.DNA_IMPORT_MAXIMUM_SOURCE_VERSIONS,
          maximumQuarantinedRecords:
            bindings.DNA_IMPORT_MAXIMUM_QUARANTINED_RECORDS,
        },
        aggregate: {
          workerId: bindings.DNA_IMPORT_WORKER_ID,
          database,
          leaseDurationMilliseconds:
            bindings.DNA_IMPORT_LEASE_DURATION_MILLISECONDS,
          archive: {
            authorizedOwnerId: bindings.AUTHORIZED_CLERK_USER_ID,
            cloudflareAccountId: bindings.CLOUDFLARE_ACCOUNT_ID,
            cloudflareApiToken: bindings.CLOUDFLARE_API_TOKEN,
            bucketName: bindings.DNA_R2_BUCKET_NAME,
            r2AccessKeyId: bindings.DNA_R2_ACCESS_KEY_ID,
            r2SecretAccessKey: bindings.DNA_R2_SECRET_ACCESS_KEY,
          },
        },
      },
      dependencies: {
        ...input.dependencies?.runtime,
        activation: {
          ...input.dependencies?.runtime?.activation,
          aggregateQueue,
        },
      },
    });
  } catch {
    return { status: "not_configured" };
  }
}
