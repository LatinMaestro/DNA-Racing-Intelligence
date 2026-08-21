/// <reference types="@cloudflare/workers-types" />

import { createHostedCloudflareImportQueueConsumer } from "../../lib/hosted-cloudflare-import-queue-consumer";

export default {
  async queue(batch: MessageBatch<unknown>, env: Env): Promise<void> {
    const consumer = createHostedCloudflareImportQueueConsumer({
      bindings: env,
    });
    await consumer.consume(batch);
  },
} satisfies ExportedHandler<Env, unknown>;
