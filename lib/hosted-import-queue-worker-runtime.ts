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
      consume: (input: QueueDelivery) => Promise<ImportQueueConsumerDecision>;
    }>;

export const unavailableHostedImportQueueWorkerRuntime: HostedImportQueueWorkerRuntime =
  Object.freeze({ status: "not_configured" });

function unavailableRuntime(family: string): never {
  throw new Error(`${family} import queue runtime is not configured.`);
}

export function createHostedImportQueueWorkerRuntime(input: {
  preview: HostedImportPreviewWorkerRuntime;
  activation: HostedImportActivationWorkerRuntime;
  aggregate: HostedProLeagueAggregateWorkerRuntime;
}): HostedImportQueueWorkerRuntime {
  const preview = input.preview;
  const activation = input.activation;
  const aggregate = input.aggregate;
  if (
    preview.status !== "ready" &&
    activation.status !== "ready" &&
    aggregate.status !== "ready"
  ) {
    return unavailableHostedImportQueueWorkerRuntime;
  }

  return Object.freeze({
    status: "ready" as const,
    consume(delivery: QueueDelivery) {
      const message = parseCloudflareImportQueueMessage(delivery.body);
      if (message.kind === "preview") {
        if (preview.status !== "ready") {
          return unavailableRuntime("Preview");
        }
        return preview.consume(delivery);
      }
      if (message.kind === "import_activation") {
        if (activation.status !== "ready") {
          return unavailableRuntime("Activation");
        }
        return activation.consume(delivery);
      }
      if (aggregate.status !== "ready") {
        return unavailableRuntime("Aggregate refresh");
      }
      return aggregate.consume(delivery);
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
      ...(input.dependencies?.preview
        ? { dependencies: input.dependencies.preview }
        : {}),
    }),
    activation: hostedImportActivationWorkerRuntime({
      environment: input.environment.activation,
      ...(input.dependencies?.activation
        ? { dependencies: input.dependencies.activation }
        : {}),
    }),
    aggregate: hostedProLeagueAggregateWorkerRuntime({
      environment: input.environment.aggregate,
      ...(input.dependencies?.aggregate
        ? { dependencies: input.dependencies.aggregate }
        : {}),
    }),
  });
}
