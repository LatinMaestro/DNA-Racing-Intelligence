/// <reference types="@cloudflare/workers-types" />

import { createHostedCloudflareImportQueueConsumer } from "../../lib/hosted-cloudflare-import-queue-consumer";

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const consumer = createHostedCloudflareImportQueueConsumer({
      bindings: env,
    });
    if (consumer.status !== "ready") {
      console.error(
        JSON.stringify({
          event: "dna_import_queue_runtime_not_configured",
          messageCount: batch.messages.length,
        }),
      );
    }
    const result = await consumer.consume(batch);
    if (result.retried > 0) {
      console.error(
        JSON.stringify({
          event: "dna_import_queue_delivery_retried",
          runtimeStatus: consumer.status,
          acknowledged: result.acknowledged,
          retried: result.retried,
        }),
      );
    }
  },
} satisfies ExportedHandler<Env, unknown>;
