import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueueForOwner,
} from "./cloudflare-import-queue-adapter";
import { createCloudflareImportQueuePort } from "./cloudflare-import-queue-port";
import {
  type AggregateRetryCapabilities,
  unavailableAggregateRetryCapabilities,
} from "./import-aggregate-retry-action-service";
import {
  neonImportAggregateRetryRepositoryFromEnvironment,
  type AggregateRetryDatabaseEnvironment,
} from "./neon-import-aggregate-retry-repository";
import type { NeonImportPersistenceSessionFactory } from "./neon-import-persistence-driver";

const PROVIDER_ID_PATTERN = /^[a-f0-9]{32}$/;

export type HostedImportAggregateRetryEnvironment = Readonly<{
  authorizedOwnerId: string | undefined;
  database: AggregateRetryDatabaseEnvironment;
  cloudflare: Readonly<{
    accountId: string | undefined;
    apiToken: string | undefined;
    queueId: string | undefined;
    queueName: string | undefined;
    deadLetterQueueName: string | undefined;
  }>;
}>;

export function hostedImportAggregateRetryRuntime(input: {
  environment: HostedImportAggregateRetryEnvironment;
  dependencies?: Readonly<{
    fetch?: typeof globalThis.fetch;
    neonSessionFactory?: NeonImportPersistenceSessionFactory;
  }>;
}): AggregateRetryCapabilities {
  const ownerId = input.environment.authorizedOwnerId?.trim() ?? "";
  const accountId = input.environment.cloudflare.accountId?.trim() ?? "";
  const queueId = input.environment.cloudflare.queueId?.trim() ?? "";
  const apiToken = input.environment.cloudflare.apiToken?.trim() ?? "";
  if (
    ownerId === "" ||
    !PROVIDER_ID_PATTERN.test(accountId) ||
    !PROVIDER_ID_PATTERN.test(queueId) ||
    apiToken === "" ||
    /[\u0000-\u001f\u007f]/.test(apiToken)
  ) {
    return unavailableAggregateRetryCapabilities;
  }

  try {
    const repository = neonImportAggregateRetryRepositoryFromEnvironment(
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
    if (repository === null || queueConfiguration === null) {
      return unavailableAggregateRetryCapabilities;
    }
    return Object.freeze({
      repository: Object.freeze({ status: "ready", service: repository }),
      backgroundQueue: Object.freeze({
        status: "ready",
        service: createCloudflareImportQueueForOwner({
          ownerId,
          configuration: queueConfiguration,
        }),
      }),
    });
  } catch {
    return unavailableAggregateRetryCapabilities;
  }
}
