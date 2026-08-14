import { describe, expect, it, vi } from "vitest";

import { createCloudflareImportQueuePort } from "../lib/cloudflare-import-queue-port";

const accountId = "a".repeat(32);
const queueId = "b".repeat(32);
const queueName = "dna-import-preview";

function response(value: unknown, status = 200): Response {
  return new Response(JSON.stringify(value), {
    status,
    headers: { "content-type": "application/json" },
  });
}

function queueResult(overrides: Record<string, unknown> = {}) {
  return {
    success: true,
    result: {
      queue_id: queueId,
      queue_name: queueName,
      consumers_total_count: 1,
      consumers: [
        {
          settings: { max_retries: 3 },
          dead_letter_queue: "dna-import-preview-dlq",
          type: "worker",
        },
      ],
      settings: { delivery_paused: false },
      ...overrides,
    },
  };
}

function create(fetcher: typeof globalThis.fetch) {
  return createCloudflareImportQueuePort({
    accountId,
    queueId,
    queueName,
    apiToken: "private-queue-token",
    fetch: fetcher,
  });
}

describe("Cloudflare import queue port", () => {
  it("reads exact queue and consumer readiness evidence", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      response(queueResult()),
    );

    await expect(
      create(fetcher).readQueueEvidence({ queueName }),
    ).resolves.toEqual({
      paused: false,
      consumerConfigured: true,
      maxRetries: 3,
      deadLetterQueueName: "dna-import-preview-dlq",
    });
    expect(fetcher).toHaveBeenCalledExactlyOnceWith(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}`,
      expect.objectContaining({ method: "GET", cache: "no-store" }),
    );
  });

  it("pushes only the bounded JSON dispatch envelope", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
      response({ success: true, result: { metadata: { metrics: {} } } }),
    );
    const message = {
      version: 1 as const,
      kind: "preview" as const,
      dispatchId: "dispatch-1",
    };

    await create(fetcher).sendJson({ queueName, body: message });

    const request = fetcher.mock.calls[0];
    expect(request?.[0]).toBe(
      `https://api.cloudflare.com/client/v4/accounts/${accountId}/queues/${queueId}/messages`,
    );
    expect(request?.[1]).toMatchObject({ method: "POST", cache: "no-store" });
    expect(JSON.parse(String(request?.[1]?.body))).toEqual({
      body: message,
      content_type: "json",
    });
  });

  it.each([
    ["wrong queue ID", { queue_id: "c".repeat(32) }, null],
    [
      "paused queue",
      { settings: { delivery_paused: true } },
      { paused: true, consumerConfigured: true },
    ],
    [
      "missing consumer",
      { consumers_total_count: 0, consumers: [] },
      {
        paused: false,
        consumerConfigured: false,
        deadLetterQueueName: null,
      },
    ],
    [
      "missing dead-letter queue",
      {
        consumers: [{ settings: { max_retries: 3 }, type: "worker" }],
      },
      {
        paused: false,
        consumerConfigured: true,
        deadLetterQueueName: null,
      },
    ],
  ])(
    "returns evidence that fails closed for %s",
    async (_label, override, expected) => {
      const fetcher = vi.fn<typeof globalThis.fetch>(async () =>
        response(queueResult(override)),
      );
      const port = create(fetcher);

      if (expected === null) {
        await expect(port.readQueueEvidence({ queueName })).rejects.toThrow(
          "readiness check failed",
        );
      } else {
        await expect(
          port.readQueueEvidence({ queueName }),
        ).resolves.toMatchObject({
          ...expected,
        });
      }
    },
  );

  it("rejects cross-queue calls before provider access", async () => {
    const fetcher = vi.fn<typeof globalThis.fetch>();
    const port = create(fetcher);
    await expect(
      port.sendJson({
        queueName: "other-queue",
        body: { version: 1, kind: "preview", dispatchId: "dispatch-1" },
      }),
    ).rejects.toThrow("identity is inconsistent");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("sanitizes provider failures", async () => {
    const port = create(
      vi.fn(async () => {
        throw new Error("private provider detail");
      }),
    );
    await expect(port.readQueueEvidence({ queueName })).rejects.not.toThrow(
      /private provider detail/,
    );
    await expect(
      port.sendJson({
        queueName,
        body: { version: 1, kind: "preview", dispatchId: "dispatch-1" },
      }),
    ).rejects.not.toThrow(/private provider detail/);
  });
});
