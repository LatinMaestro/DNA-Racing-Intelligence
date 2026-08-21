import {
  consumeCloudflareImportQueueBatch,
  type CloudflareQueueBatchDelivery,
  type CloudflareQueueBatchResult,
} from "./cloudflare-import-queue-consumer";
import {
  hostedCloudflareImportQueueWorkerRuntime,
  type HostedCloudflareImportQueueWorkerBindings,
  type HostedCloudflareImportQueueWorkerDependencies,
} from "./hosted-cloudflare-import-queue-worker-runtime";

export type HostedCloudflareImportQueueConsumer = Readonly<{
  status: "ready" | "not_configured";
  consume: (
    batch: CloudflareQueueBatchDelivery,
  ) => Promise<CloudflareQueueBatchResult>;
}>;

export function createHostedCloudflareImportQueueConsumer(input: {
  bindings: HostedCloudflareImportQueueWorkerBindings;
  dependencies?: HostedCloudflareImportQueueWorkerDependencies;
  now?: () => Date;
}): HostedCloudflareImportQueueConsumer {
  const runtime = hostedCloudflareImportQueueWorkerRuntime({
    bindings: input.bindings,
    ...(input.dependencies ? { dependencies: input.dependencies } : {}),
  });

  return Object.freeze({
    status: runtime.status,
    consume(batch: CloudflareQueueBatchDelivery) {
      return consumeCloudflareImportQueueBatch({
        batch,
        runtime,
        ...(input.now ? { now: input.now } : {}),
      });
    },
  });
}
