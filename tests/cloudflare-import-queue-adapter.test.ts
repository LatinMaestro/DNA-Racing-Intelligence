import { describe, expect, it, vi } from "vitest";

import {
  cloudflareImportQueueConfigurationFromEnvironment,
  createCloudflareImportQueuesForOwner,
  type CloudflareImportQueueMessage,
  type CloudflareImportQueuePort,
} from "../lib/cloudflare-import-queue-adapter";

const OWNER_ID = "owner-1";

function readyQueues() {
  const readQueueEvidence = vi.fn(async () => ({
    paused: false,
    consumerConfigured: true,
    deadLetterQueueConfigured: true,
    maxRetries: 5,
  }));
  const sendJson = vi.fn(
    async (input: {
      queueName: string;
      body: CloudflareImportQueueMessage;
    }) => {
      void input;
    },
  );
  const port: CloudflareImportQueuePort = {
    readQueueEvidence,
    sendJson,
  };
  const createPort = vi.fn(async () => port);
  const queues = createCloudflareImportQueuesForOwner({
    ownerId: OWNER_ID,
    configuration: {
      previewQueueName: "dna-import-preview",
      backgroundQueueName: "dna-import-background",
      createPort,
    },
  });
  return { queues, createPort, readQueueEvidence, sendJson };
}

describe("Cloudflare import queue adapter", () => {
  it("initializes lazily and verifies each queue once", async () => {
    const ready = readyQueues();
    expect(ready.createPort).not.toHaveBeenCalled();
    await ready.queues.previewQueue.enqueue({
      ownerId: OWNER_ID,
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-1",
    });
    await ready.queues.previewQueue.enqueue({
      ownerId: OWNER_ID,
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-1",
    });
    await ready.queues.backgroundQueue.enqueue({
      ownerId: OWNER_ID,
      updateSessionId: "session-1",
      dispatchId: "dispatch-1",
    });
    expect(ready.createPort).toHaveBeenCalledOnce();
    expect(ready.readQueueEvidence).toHaveBeenCalledTimes(2);
  });

  it("denies another owner before provider initialization", async () => {
    const ready = readyQueues();
    await expect(
      ready.queues.previewQueue.enqueue({
        ownerId: "other-owner",
        uploadBatchId: "batch-1",
        previewDispatchId: "preview-1",
      }),
    ).rejects.toThrow("access denied");
    expect(ready.createPort).not.toHaveBeenCalled();
  });

  it("sends a compact redacted JSON preview dispatch", async () => {
    const ready = readyQueues();
    await ready.queues.previewQueue.enqueue({
      ownerId: OWNER_ID,
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-1",
    });
    expect(ready.sendJson).toHaveBeenCalledWith({
      queueName: "dna-import-preview",
      body: {
        version: 1,
        kind: "preview",
        dispatchId: "preview-1",
        ownerScopeSha256: expect.stringMatching(/^[a-f0-9]{64}$/),
      },
    });
    expect(JSON.stringify(ready.sendJson.mock.calls[0])).not.toContain(
      OWNER_ID,
    );
  });

  it("maps activation and aggregate retry to the background queue", async () => {
    const ready = readyQueues();
    await ready.queues.backgroundQueue.enqueue({
      ownerId: OWNER_ID,
      updateSessionId: "session-1",
      dispatchId: "dispatch-1",
    });
    await ready.queues.backgroundQueue.enqueue({
      ownerId: OWNER_ID,
      refreshId: "refresh-1",
      dispatchId: "dispatch-2",
    });
    expect(ready.sendJson.mock.calls.map(([input]) => input.body.kind)).toEqual(
      ["import_activation", "aggregate_refresh_retry"],
    );
    expect(
      ready.sendJson.mock.calls.every(
        ([input]) => input.queueName === "dna-import-background",
      ),
    ).toBe(true);
  });

  it.each([
    {
      paused: true,
      consumerConfigured: true,
      deadLetterQueueConfigured: true,
      maxRetries: 5,
    },
    {
      paused: false,
      consumerConfigured: false,
      deadLetterQueueConfigured: true,
      maxRetries: 5,
    },
    {
      paused: false,
      consumerConfigured: true,
      deadLetterQueueConfigured: false,
      maxRetries: 5,
    },
    {
      paused: false,
      consumerConfigured: true,
      deadLetterQueueConfigured: true,
      maxRetries: 0,
    },
  ])("fails closed on unsafe queue evidence %#", async (evidence) => {
    const ready = readyQueues();
    ready.readQueueEvidence.mockResolvedValueOnce(evidence);
    await expect(
      ready.queues.previewQueue.enqueue({
        ownerId: OWNER_ID,
        uploadBatchId: "batch-1",
        previewDispatchId: "preview-1",
      }),
    ).rejects.toThrow("readiness verification failed");
    expect(ready.sendJson).not.toHaveBeenCalled();
  });

  it("requires separate preview and background queues", () => {
    expect(() =>
      createCloudflareImportQueuesForOwner({
        ownerId: OWNER_ID,
        configuration: {
          previewQueueName: "same-queue",
          backgroundQueueName: "same-queue",
          createPort: vi.fn(),
        },
      }),
    ).toThrow("must remain separate");
  });

  it("stays unconfigured until both queue names are supplied", () => {
    const createPort = vi.fn();
    expect(
      cloudflareImportQueueConfigurationFromEnvironment({
        previewQueueName: undefined,
        backgroundQueueName: "background",
        createPort,
      }),
    ).toBeNull();
    expect(
      cloudflareImportQueueConfigurationFromEnvironment({
        previewQueueName: "preview",
        backgroundQueueName: undefined,
        createPort,
      }),
    ).toBeNull();
    expect(createPort).not.toHaveBeenCalled();
  });
});
