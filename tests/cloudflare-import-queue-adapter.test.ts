import { describe, expect, it, vi } from "vitest";

import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueueForOwner,
  type CloudflareImportQueueEvidence,
  type CloudflareImportQueueMessage,
  type CloudflareImportQueuePort,
} from "../lib/cloudflare-import-queue-adapter";

const OWNER_ID = "owner-1";
const FINGERPRINT = "a".repeat(64);

function readyQueue() {
  const readQueueEvidence = vi.fn(
    async (): Promise<CloudflareImportQueueEvidence> => ({
      paused: false,
      consumerConfigured: true,
      maxRetries: 5,
      deadLetterQueueName: "dna-private-import-dlq",
    }),
  );
  const sendJson = vi.fn(
    async (input: { queueName: string; body: CloudflareImportQueueMessage }) =>
      void input,
  );
  const port: CloudflareImportQueuePort = { readQueueEvidence, sendJson };
  const createPort = vi.fn(async () => port);
  const queue = createCloudflareImportQueueForOwner({
    ownerId: OWNER_ID,
    configuration: {
      queueName: "dna-private-import",
      deadLetterQueueName: "dna-private-import-dlq",
      createPort,
    },
  });
  return { queue, createPort, readQueueEvidence, sendJson };
}

describe("Cloudflare import queue adapter", () => {
  it("initializes lazily and verifies the one queue once", async () => {
    const ready = readyQueue();
    expect(ready.createPort).not.toHaveBeenCalled();
    await ready.queue.enqueue({
      ownerId: OWNER_ID,
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-1",
      uploadRequestFingerprint: FINGERPRINT,
    });
    await ready.queue.enqueue({
      ownerId: OWNER_ID,
      updateSessionId: "session-1",
      dispatchId: "dispatch-1",
    });
    expect(ready.createPort).toHaveBeenCalledOnce();
    expect(ready.readQueueEvidence).toHaveBeenCalledOnce();
  });

  it("denies another owner before provider initialization", async () => {
    const ready = readyQueue();
    await expect(
      ready.queue.enqueue({
        ownerId: "other-owner",
        uploadBatchId: "batch-1",
        previewDispatchId: "preview-1",
        uploadRequestFingerprint: FINGERPRINT,
      }),
    ).rejects.toThrow("access denied");
    expect(ready.createPort).not.toHaveBeenCalled();
  });

  it("sends the compact fingerprint-bound preview identity and current acknowledgement", async () => {
    const ready = readyQueue();
    await expect(
      ready.queue.enqueue({
        ownerId: OWNER_ID,
        uploadBatchId: "batch-1",
        previewDispatchId: "preview-1",
        uploadRequestFingerprint: FINGERPRINT,
      }),
    ).resolves.toEqual({
      disposition: "created",
      previewDispatchId: "preview-1",
      uploadRequestFingerprint: FINGERPRINT,
    });
    expect(ready.sendJson).toHaveBeenCalledWith({
      queueName: "dna-private-import",
      body: {
        version: 1,
        kind: "preview",
        dispatchId: "preview-1",
        uploadRequestFingerprint: FINGERPRINT,
      },
    });
    const serialized = JSON.stringify(ready.sendJson.mock.calls[0]);
    expect(serialized).not.toContain(OWNER_ID);
    expect(serialized).toContain(FINGERPRINT);
    expect(serialized).not.toContain("batch-1");
  });

  it("maps activation and aggregate retry onto the same queue", async () => {
    const ready = readyQueue();
    await ready.queue.enqueue({
      ownerId: OWNER_ID,
      updateSessionId: "session-1",
      dispatchId: "dispatch-1",
    });
    await ready.queue.enqueue({
      ownerId: OWNER_ID,
      refreshId: "refresh-1",
      dispatchId: "dispatch-2",
    });
    expect(ready.sendJson.mock.calls.map(([value]) => value.body.kind)).toEqual(
      ["import_activation", "aggregate_refresh_retry"],
    );
    expect(
      ready.sendJson.mock.calls.every(
        ([value]) => value.queueName === "dna-private-import",
      ),
    ).toBe(true);
  });

  it.each([
    {
      paused: true,
      consumerConfigured: true,
      maxRetries: 5,
      deadLetterQueueName: "dna-private-import-dlq",
    },
    {
      paused: false,
      consumerConfigured: false,
      maxRetries: 5,
      deadLetterQueueName: "dna-private-import-dlq",
    },
    {
      paused: false,
      consumerConfigured: true,
      maxRetries: 0,
      deadLetterQueueName: "dna-private-import-dlq",
    },
    {
      paused: false,
      consumerConfigured: true,
      maxRetries: 11,
      deadLetterQueueName: "dna-private-import-dlq",
    },
    {
      paused: false,
      consumerConfigured: true,
      maxRetries: 5,
      deadLetterQueueName: null,
    },
    {
      paused: false,
      consumerConfigured: true,
      maxRetries: 5,
      deadLetterQueueName: "unexpected-dlq",
    },
  ])("fails closed on unsafe queue evidence %#", async (evidence) => {
    const ready = readyQueue();
    ready.readQueueEvidence.mockResolvedValueOnce(evidence);
    await expect(
      ready.queue.enqueue({
        ownerId: OWNER_ID,
        updateSessionId: "session-1",
        dispatchId: "dispatch-1",
      }),
    ).rejects.toThrow("readiness verification failed");
    expect(ready.sendJson).not.toHaveBeenCalled();
  });

  it("stays unconfigured until the single queue name is supplied", () => {
    const createPort = vi.fn();
    expect(
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: undefined,
        deadLetterQueueName: "dna-private-import-dlq",
        createPort,
      }),
    ).toBeNull();
    expect(
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: "dna-private-import",
        deadLetterQueueName: undefined,
        createPort,
      }),
    ).toBeNull();
    expect(
      cloudflareImportQueueConfigurationFromEnvironment({
        queueName: "dna-private-import",
        deadLetterQueueName: "dna-private-import-dlq",
        createPort,
      }),
    ).toEqual({
      queueName: "dna-private-import",
      deadLetterQueueName: "dna-private-import-dlq",
      createPort,
    });
    expect(createPort).not.toHaveBeenCalled();
  });

  it("rejects using the primary queue as its own dead-letter queue", () => {
    expect(() =>
      createCloudflareImportQueueForOwner({
        ownerId: OWNER_ID,
        configuration: {
          queueName: "dna-private-import",
          deadLetterQueueName: "dna-private-import",
          createPort: vi.fn(),
        },
      }),
    ).toThrow("must differ");
  });
});
