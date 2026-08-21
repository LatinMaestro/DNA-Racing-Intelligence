import { describe, expect, it, vi } from "vitest";

import type { CloudflareQueueMessageDelivery } from "../lib/cloudflare-import-queue-consumer";
import { createHostedCloudflareImportQueueConsumer } from "../lib/hosted-cloudflare-import-queue-consumer";
import type { HostedCloudflareImportQueueWorkerBindings } from "../lib/hosted-cloudflare-import-queue-worker-runtime";

function bindings(
  overrides: Partial<HostedCloudflareImportQueueWorkerBindings> = {},
): HostedCloudflareImportQueueWorkerBindings {
  return {
    AUTHORIZED_CLERK_USER_ID: "owner-1",
    DATABASE_URL: "postgresql://private.example/dna",
    DNA_DATABASE_OWNER_ID: "11111111-1111-4111-8111-111111111111",
    DNA_DATABASE_RUNTIME_ROLE: "dna_app_runtime",
    CLOUDFLARE_ACCOUNT_ID: "a".repeat(32),
    CLOUDFLARE_API_TOKEN: "least-privilege-provider-token",
    DNA_R2_BUCKET_NAME: "dna-private-imports",
    DNA_R2_ACCESS_KEY_ID: "r2-access",
    DNA_R2_SECRET_ACCESS_KEY: "r2-secret",
    DNA_IMPORT_QUEUE_ID: "b".repeat(32),
    DNA_IMPORT_QUEUE_NAME: "dna-import-preview",
    DNA_IMPORT_DEAD_LETTER_QUEUE_NAME: "dna-import-preview-dlq",
    DNA_IMPORT_WORKER_ID: "import-worker-1",
    DNA_IMPORT_LEASE_DURATION_MILLISECONDS: "300000",
    DNA_IMPORT_MAXIMUM_BATCH_BYTES: "1073741824",
    DNA_IMPORT_MAXIMUM_OBJECT_BYTES: "536870912",
    DNA_IMPORT_MAXIMUM_CHUNK_BYTES: "1048576",
    DNA_IMPORT_MAXIMUM_SOURCE_VERSIONS: "24",
    DNA_IMPORT_MAXIMUM_QUARANTINED_RECORDS: "1000000",
    DNA_IMPORT_QUEUE: {
      send: vi.fn(async () => undefined),
    },
    ...overrides,
  };
}

function dependencies() {
  return {
    queueEvidencePort: {
      readQueueEvidence: vi.fn(async () => ({
        paused: false,
        consumerConfigured: true,
        maxRetries: 3,
        deadLetterQueueName: "dna-import-preview-dlq",
      })),
    },
  };
}

function delivery(body: unknown) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    message: { body, ack, retry } satisfies CloudflareQueueMessageDelivery,
  };
}

describe("hosted Cloudflare import queue consumer", () => {
  it("retries every delivery when provider composition is unavailable", async () => {
    const first = delivery({ kind: "preview" });
    const second = delivery({ kind: "import_activation" });
    const retryAll = vi.fn();
    const consumer = createHostedCloudflareImportQueueConsumer({
      bindings: bindings({ DNA_IMPORT_QUEUE: undefined }),
      dependencies: dependencies(),
    });

    expect(consumer.status).toBe("not_configured");
    await expect(
      consumer.consume({
        messages: [first.message, second.message],
        retryAll,
      }),
    ).resolves.toEqual({ acknowledged: 0, retried: 2 });
    expect(retryAll).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).not.toHaveBeenCalled();
    expect(second.ack).not.toHaveBeenCalled();
    expect(second.retry).not.toHaveBeenCalled();
  });

  it("routes a delivered batch into the configured runtime boundary", async () => {
    const malformed = delivery({
      version: 1,
      kind: "preview",
      dispatchId: "preview-dispatch-1",
      uploadRequestFingerprint: "not-a-sha256",
    });
    const retryAll = vi.fn();
    const consumer = createHostedCloudflareImportQueueConsumer({
      bindings: bindings(),
      dependencies: dependencies(),
      now: () => new Date("2026-08-21T03:00:00.000Z"),
    });

    expect(consumer.status).toBe("ready");
    await expect(
      consumer.consume({
        messages: [malformed.message],
        retryAll,
      }),
    ).resolves.toEqual({ acknowledged: 0, retried: 1 });
    expect(malformed.retry).toHaveBeenCalledWith();
    expect(malformed.ack).not.toHaveBeenCalled();
    expect(retryAll).not.toHaveBeenCalled();
  });
});
