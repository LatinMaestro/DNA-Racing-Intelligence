import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueueForOwner,
} from "./cloudflare-import-queue-adapter";
import { createCloudflareImportQueuePort } from "./cloudflare-import-queue-port";
import { createBoundedAcceptedDatasetProcessor } from "./bounded-accepted-dataset-processor";
import {
  consumeImportActivationQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";
import {
  neonImportActivationRepositoriesFromEnvironment,
  type ImportActivationDatabaseEnvironment,
} from "./neon-import-activation";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const PROVIDER_ID_PATTERN = /^[a-f0-9]{32}$/;

export type HostedImportActivationWorkerEnvironment = Readonly<{
  workerId: string | undefined;
  authorizedOwnerId: string | undefined;
  database: ImportActivationDatabaseEnvironment;
  cloudflare: Readonly<{
    accountId: string | undefined;
    apiToken: string | undefined;
    queueId: string | undefined;
    queueName: string | undefined;
    deadLetterQueueName: string | undefined;
  }>;
  leaseDurationMilliseconds: string | undefined;
  maximumSourceVersions: string | undefined;
  maximumQuarantinedRecords: string | undefined;
}>;

export type HostedImportActivationWorkerDependencies = Readonly<{
  now?: () => Date;
  neonSessionFactory?: NeonImportPersistenceSessionFactory;
  fetch?: typeof globalThis.fetch;
}>;

export type HostedImportActivationWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (input: {
        body: unknown;
        now?: Date;
      }) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedImportActivationWorkerRuntime: HostedImportActivationWorkerRuntime =
  Object.freeze({ status: "not_configured" });

function identifier(value: string | undefined): string | null {
  const normalized = value?.trim() ?? "";
  return SAFE_IDENTIFIER_PATTERN.test(normalized) ? normalized : null;
}

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

function boundedInteger(
  value: string | undefined,
  minimum: number,
  maximum: number,
): number | null {
  const normalized = value?.trim() ?? "";
  if (!/^[1-9][0-9]*$/.test(normalized)) return null;
  const parsed = Number(normalized);
  if (!Number.isSafeInteger(parsed) || parsed < minimum || parsed > maximum) {
    return null;
  }
  return parsed;
}

export function hostedImportActivationWorkerRuntime(input: {
  environment: HostedImportActivationWorkerEnvironment;
  dependencies?: HostedImportActivationWorkerDependencies;
}): HostedImportActivationWorkerRuntime {
  const workerId = identifier(input.environment.workerId);
  const ownerId = identifier(input.environment.authorizedOwnerId);
  const accountId = providerId(input.environment.cloudflare.accountId);
  const queueId = providerId(input.environment.cloudflare.queueId);
  const apiToken = secret(input.environment.cloudflare.apiToken);
  const leaseDurationMilliseconds = boundedInteger(
    input.environment.leaseDurationMilliseconds,
    1_000,
    60 * 60 * 1_000,
  );
  const maximumSourceVersions = boundedInteger(
    input.environment.maximumSourceVersions,
    1,
    24,
  );
  const maximumQuarantinedRecords = boundedInteger(
    input.environment.maximumQuarantinedRecords,
    1,
    10_000_000,
  );
  if (
    workerId === null ||
    ownerId === null ||
    accountId === null ||
    queueId === null ||
    apiToken === null ||
    leaseDurationMilliseconds === null ||
    maximumSourceVersions === null ||
    maximumQuarantinedRecords === null
  ) {
    return unavailableHostedImportActivationWorkerRuntime;
  }

  try {
    const repositories = neonImportActivationRepositoriesFromEnvironment(
      input.environment.database,
      input.dependencies?.neonSessionFactory,
    );
    const queueConfiguration =
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: input.environment.cloudflare.queueName,
        deadLetterQueueName: input.environment.cloudflare.deadLetterQueueName,
        createPort: () =>
          createCloudflareImportQueuePort({
            accountId,
            queueId,
            queueName: input.environment.cloudflare.queueName ?? "",
            apiToken,
            fetch: input.dependencies?.fetch ?? globalThis.fetch,
          }),
      });
    if (repositories === null || queueConfiguration === null) {
      return unavailableHostedImportActivationWorkerRuntime;
    }
    const aggregateQueue = createCloudflareImportQueueForOwner({
      ownerId,
      configuration: queueConfiguration,
    });
    const processor = createBoundedAcceptedDatasetProcessor({
      repository: repositories.preparationRepository,
      maximumSourceVersions,
      maximumQuarantinedRecords,
    });
    const capabilities = Object.freeze({
      status: "ready" as const,
      repository: repositories.processingRepository,
      processor,
      aggregateQueue,
      maximumAggregateRefreshes: maximumSourceVersions,
    });
    const now = input.dependencies?.now ?? (() => new Date());
    return Object.freeze({
      status: "ready" as const,
      consume(consumeInput: { body: unknown; now?: Date }) {
        return consumeImportActivationQueueMessage({
          body: consumeInput.body,
          workerId,
          now: consumeInput.now ?? now(),
          leaseDurationMilliseconds,
          capabilities,
        });
      },
    });
  } catch {
    return unavailableHostedImportActivationWorkerRuntime;
  }
}
