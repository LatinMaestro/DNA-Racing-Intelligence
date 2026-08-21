import type { HostedImportQueueWorkerRuntime } from "./hosted-import-queue-worker-runtime";

const MAXIMUM_LEASE_RETRY_DELAY_SECONDS = 60 * 60;

export type CloudflareQueueMessageDelivery = Readonly<{
  body: unknown;
  ack: () => void;
  retry: (options?: Readonly<{ delaySeconds: number }>) => void;
}>;

export type CloudflareQueueBatchDelivery = Readonly<{
  messages: readonly CloudflareQueueMessageDelivery[];
  retryAll: () => void;
}>;

export type CloudflareQueueBatchResult = Readonly<{
  acknowledged: number;
  retried: number;
}>;

function retryDelaySeconds(retryAfter: string, now: Date): number | null {
  const retryAt = Date.parse(retryAfter);
  if (Number.isNaN(retryAt)) return null;
  const delaySeconds = Math.ceil((retryAt - now.getTime()) / 1_000);
  if (
    delaySeconds < 1 ||
    delaySeconds > MAXIMUM_LEASE_RETRY_DELAY_SECONDS
  ) {
    return null;
  }
  return delaySeconds;
}

export async function consumeCloudflareImportQueueBatch(input: {
  batch: CloudflareQueueBatchDelivery;
  runtime: HostedImportQueueWorkerRuntime;
  now?: () => Date;
}): Promise<CloudflareQueueBatchResult> {
  if (input.runtime.status !== "ready") {
    input.batch.retryAll();
    return {
      acknowledged: 0,
      retried: input.batch.messages.length,
    };
  }

  const now = input.now ?? (() => new Date());
  let acknowledged = 0;
  let retried = 0;

  for (const message of input.batch.messages) {
    const deliveredAt = now();
    try {
      const decision = await input.runtime.consume({
        body: message.body,
        now: deliveredAt,
      });
      if (decision.disposition === "acknowledge") {
        message.ack();
        acknowledged += 1;
        continue;
      }

      const delaySeconds =
        decision.reason === "leased_elsewhere"
          ? retryDelaySeconds(decision.retryAfter, deliveredAt)
          : null;
      if (delaySeconds === null) {
        message.retry();
      } else {
        message.retry({ delaySeconds });
      }
      retried += 1;
    } catch {
      message.retry();
      retried += 1;
    }
  }

  return { acknowledged, retried };
}
