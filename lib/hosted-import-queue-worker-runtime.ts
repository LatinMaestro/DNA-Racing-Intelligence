import {
  hostedImportActivationWorkerRuntime,
  type HostedImportActivationWorkerDependencies,
  type HostedImportActivationWorkerEnvironment,
  type HostedImportActivationWorkerRuntime,
} from "./hosted-import-activation-worker-runtime";
import {
  hostedImportPreviewWorkerRuntime,
  type HostedImportPreviewWorkerDependencies,
  type HostedImportPreviewWorkerEnvironment,
  type HostedImportPreviewWorkerRuntime,
} from "./hosted-import-preview-worker-runtime";
import {
  hostedProLeagueAggregateWorkerRuntime,
  type HostedProLeagueAggregateWorkerDependencies,
  type HostedProLeagueAggregateWorkerEnvironment,
  type HostedProLeagueAggregateWorkerRuntime,
} from "./hosted-pro-league-aggregate-worker-runtime";
import {
  parseCloudflareImportQueueMessage,
  type ImportQueueConsumerDecision,
} from "./import-queue-consumer";

export type HostedImportQueueWorkerEnvironment = Readonly<{
  preview: HostedImportPreviewWorkerEnvironment;
  activation: HostedImportActivationWorkerEnvironment;
  aggregate: HostedProLeagueAggregateWorkerEnvironment;
}>;

export type HostedImportQueueWorkerDependencies = Readonly<{
  preview?: HostedImportPreviewWorkerDependencies;
  activation?: HostedImportActivationWorkerDependencies;
  aggregate?: HostedProLeagueAggregateWorkerDependencies;
}>;

type QueueDelivery = Readonly<{
  body: unknown;
  now?: Date;
}>;

export type HostedImportQueueWorkerRuntime =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      consume: (
        input: QueueDelivery,
      ) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedImportQueueWorkerRuntime: HostedImportQueueWorkerRuntime =
  Object.freeze({ status: "not_configured" });

export function createHostedImportQueueWorkerRuntime(input: {
  preview: HostedImportPreviewWorkerRuntime;
  activation: HostedImportActivationWorkerRuntime;
  aggregate: HostedProLeagueAggregateWorkerRuntime;
}): HostedImportQueueWorkerRuntime {
  if (
    input.preview.status !== "ready" ||
    input.activation.status !== "ready" ||
    input.aggregate.status !== "ready"
  ) {
    return unavailableHostedImportQueueWorkerRuntime;
  }

  return Object.freeze({
    status: "ready" as const,
    consume(delivery: QueueDelivery) {
      const message = parseCloudflareImportQueueMessage(delivery.body);
      if (message.kind === "preview") {
        return input.preview.consume(delivery);
      }
      if (message.kind === "import_activation") {
        return input.activation.consume(delivery);
      }
      return input.aggregate.consume(delivery);
    },
  });
}

export function hostedImportQueueWorkerRuntime(input: {
  environment: HostedImportQueueWorkerEnvironment;
  dependencies?: HostedImportQueueWorkerDependencies;
}): HostedImportQueueWorkerRuntime {
  return createHostedImportQueueWorkerRuntime({
    preview: hostedImportPreviewWorkerRuntime({
      environment: input.environment.preview,
      dependencies: input.dependencies?.preview,
    }),
    activation: hostedImportActivationWorkerRuntime({
      environment: input.environment.activation,
      dependencies: input.dependencies?.activation,
    }),
    aggregate: hostedProLeagueAggregateWorkerRuntime({
      environment: input.environment.aggregate,
      dependencies: input.dependencies?.aggregate,
    }),
  });
}
