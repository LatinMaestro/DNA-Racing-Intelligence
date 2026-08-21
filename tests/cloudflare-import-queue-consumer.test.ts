import { describe, expect, it, vi } from "vitest";

import {
  consumeCloudflareImportQueueBatch,
  type CloudflareQueueMessageDelivery,
} from "../lib/cloudflare-import-queue-consumer";
import {
  unavailableHostedImportQueueWorkerRuntime,
  type HostedImportQueueWorkerRuntime,
} from "../lib/hosted-import-queue-worker-runtime";

const now = new Date("2026-08-21T03:00:00.000Z");

function delivery(body: unknown) {
  const ack = vi.fn();
  const retry = vi.fn();
  return {
    ack,
    retry,
    message: { body, ack, retry } satisfies CloudflareQueueMessageDelivery,
  };
}

function runtime(
  consume: HostedImportQueueWorkerRuntime extends Readonly<{
    status: "ready";
    consume: infer Consumer;
  }>
    ? Consumer
    : never,
): HostedImportQueueWorkerRuntime {
  return Object.freeze({
    status: "ready" as const,
    consume,
  });
}

describe("Cloudflare import queue consumer boundary", () => {
  it("retries the whole batch when the hosted runtime is unavailable", async () => {
    const first = delivery({ kind: "preview" });
    const second = delivery({ kind: "import_activation" });
    const retryAll = vi.fn();

    await expect(
      consumeCloudflareImportQueueBatch({
        batch: {
          messages: [first.message, second.message],
          retryAll,
        },
        runtime: unavailableHostedImportQueueWorkerRuntime,
      }),
    ).resolves.toEqual({ acknowledged: 0, retried: 2 });
    expect(retryAll).toHaveBeenCalledOnce();
    expect(first.ack).not.toHaveBeenCalled();
    expect(first.retry).not.toHaveBeenCalled();
    expect(second.ack).not.toHaveBeenCalled();
    expect(second.retry).not.toHaveBeenCalled();
  });

  it("acknowledges completed work and preserves bounded lease retry timing", async () => {
    const completed = delivery({ dispatchId: "completed" });
    const unavailable = delivery({ dispatchId: "not-configured" });
    const leased = delivery({ dispatchId: "leased" });
    const consume = vi
      .fn()
      .mockResolvedValueOnce({
        disposition: "acknowledge",
        reason: "completed",
      })
      .mockResolvedValueOnce({
        disposition: "retry",
        reason: "not_configured",
      })
      .mockResolvedValueOnce({
        disposition: "retry",
        reason: "leased_elsewhere",
        retryAfter: "2026-08-21T03:04:00.000Z",
      });

    await expect(
      consumeCloudflareImportQueueBatch({
        batch: {
          messages: [completed.message, unavailable.message, leased.message],
          retryAll: vi.fn(),
        },
        runtime: runtime(consume),
        now: () => now,
      }),
    ).resolves.toEqual({ acknowledged: 1, retried: 2 });
    expect(completed.ack).toHaveBeenCalledOnce();
    expect(completed.retry).not.toHaveBeenCalled();
    expect(unavailable.retry).toHaveBeenCalledWith();
    expect(leased.retry).toHaveBeenCalledWith({ delaySeconds: 240 });
  });

  it("retries a failed delivery without poisoning successful messages in its batch", async () => {
    const malformed = delivery({ dispatchId: "malformed" });
    const completed = delivery({ dispatchId: "completed" });
    const consume = vi
      .fn()
      .mockRejectedValueOnce(new Error("invalid queue message"))
      .mockResolvedValueOnce({
        disposition: "acknowledge",
        reason: "not_found",
      });

    await expect(
      consumeCloudflareImportQueueBatch({
        batch: {
          messages: [malformed.message, completed.message],
          retryAll: vi.fn(),
        },
        runtime: runtime(consume),
        now: () => now,
      }),
    ).resolves.toEqual({ acknowledged: 1, retried: 1 });
    expect(malformed.retry).toHaveBeenCalledWith();
    expect(malformed.ack).not.toHaveBeenCalled();
    expect(completed.ack).toHaveBeenCalledOnce();
    expect(completed.retry).not.toHaveBeenCalled();
  });

  it("falls back to the provider retry policy for invalid or unbounded lease delays", async () => {
    const expired = delivery({ dispatchId: "expired" });
    const unbounded = delivery({ dispatchId: "unbounded" });
    const consume = vi
      .fn()
      .mockResolvedValueOnce({
        disposition: "retry",
        reason: "leased_elsewhere",
        retryAfter: "2026-08-21T02:59:00.000Z",
      })
      .mockResolvedValueOnce({
        disposition: "retry",
        reason: "leased_elsewhere",
        retryAfter: "2026-08-21T05:00:00.000Z",
      });

    await consumeCloudflareImportQueueBatch({
      batch: {
        messages: [expired.message, unbounded.message],
        retryAll: vi.fn(),
      },
      runtime: runtime(consume),
      now: () => now,
    });
    expect(expired.retry).toHaveBeenCalledWith();
    expect(unbounded.retry).toHaveBeenCalledWith();
  });
});
