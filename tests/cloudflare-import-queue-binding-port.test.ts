import { describe, expect, it, vi } from "vitest";

import {
  createCloudflareImportQueueForOwner,
  type CloudflareImportQueueEvidence,
  type CloudflareImportQueueMessage,
} from "../lib/cloudflare-import-queue-adapter";
import {
  createCloudflareImportQueueBindingPort,
  type CloudflareQueueProducerBinding,
} from "../lib/cloudflare-import-queue-binding-port";

const queueName = "dna-import-preview";
const deadLetterQueueName = "dna-import-preview-dlq";
const ownerId = "owner-1";
const message: CloudflareImportQueueMessage = {
  version: 1,
  kind: "aggregate_refresh_retry",
  dispatchId: "aggregate-dispatch-1",
  refreshId: "aggregate-refresh-1",
};
const evidence: CloudflareImportQueueEvidence = {
  paused: false,
  consumerConfigured: true,
  maxRetries: 3,
  deadLetterQueueName,
};

function harness() {
  const readQueueEvidence = vi.fn(async () => evidence);
  const send = vi.fn(async () => undefined);
  const port = createCloudflareImportQueueBindingPort({
    queueName,
    binding: { send } satisfies CloudflareQueueProducerBinding,
    evidencePort: { readQueueEvidence },
  });
  return { port, readQueueEvidence, send };
}

describe("Cloudflare import queue binding port", () => {
  it("uses provider evidence reads and the native JSON producer binding", async () => {
    const { port, readQueueEvidence, send } = harness();

    await expect(port.readQueueEvidence({ queueName })).resolves.toEqual(
      evidence,
    );
    await expect(port.sendJson({ queueName, body: message })).resolves.toBe(
      undefined,
    );
    expect(readQueueEvidence).toHaveBeenCalledWith({ queueName });
    expect(send).toHaveBeenCalledWith(message, { contentType: "json" });
  });

  it("rejects queue-name drift before provider access", async () => {
    const { port, readQueueEvidence, send } = harness();

    await expect(
      port.readQueueEvidence({ queueName: "different-queue" }),
    ).rejects.toThrow("binding mismatch");
    await expect(
      port.sendJson({ queueName: "different-queue", body: message }),
    ).rejects.toThrow("binding mismatch");
    expect(readQueueEvidence).not.toHaveBeenCalled();
    expect(send).not.toHaveBeenCalled();
  });

  it("preserves owner and consumer/DLQ checks before native publication", async () => {
    const { port, readQueueEvidence, send } = harness();
    const ownerQueue = createCloudflareImportQueueForOwner({
      ownerId,
      configuration: {
        queueName,
        deadLetterQueueName,
        createPort: () => port,
      },
    });

    await expect(
      ownerQueue.enqueue({
        ownerId,
        refreshId: "aggregate-refresh-1",
        dispatchId: "aggregate-dispatch-1",
      }),
    ).resolves.toBeUndefined();
    expect(readQueueEvidence).toHaveBeenCalledOnce();
    expect(send).toHaveBeenCalledWith(message, { contentType: "json" });
  });
});
