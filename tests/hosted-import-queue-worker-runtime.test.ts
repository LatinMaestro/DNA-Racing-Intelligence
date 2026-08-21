import { describe, expect, it, vi } from "vitest";

import {
  createHostedImportQueueWorkerRuntime,
  unavailableHostedImportQueueWorkerRuntime,
} from "../lib/hosted-import-queue-worker-runtime";
import type { HostedImportActivationWorkerRuntime } from "../lib/hosted-import-activation-worker-runtime";
import type { HostedImportPreviewWorkerRuntime } from "../lib/hosted-import-preview-worker-runtime";
import type { HostedProLeagueAggregateWorkerRuntime } from "../lib/hosted-pro-league-aggregate-worker-runtime";
import type { ImportQueueConsumerDecision } from "../lib/import-queue-consumer";

const now = new Date("2026-08-21T03:00:00.000Z");
const completed: ImportQueueConsumerDecision = {
  disposition: "acknowledge",
  reason: "completed",
};

function readyRuntime() {
  const consume = vi.fn(async () => completed);
  return {
    consume,
    runtime: Object.freeze({
      status: "ready" as const,
      consume,
    }),
  };
}

describe("hosted import queue worker runtime", () => {
  it("fails closed unless all three import runtimes are configured", () => {
    const preview = readyRuntime();
    const activation = readyRuntime();
    const aggregate = readyRuntime();

    expect(
      createHostedImportQueueWorkerRuntime({
        preview:
          unavailableHostedImportQueueWorkerRuntime as HostedImportPreviewWorkerRuntime,
        activation: activation.runtime,
        aggregate: aggregate.runtime,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      createHostedImportQueueWorkerRuntime({
        preview: preview.runtime,
        activation:
          unavailableHostedImportQueueWorkerRuntime as HostedImportActivationWorkerRuntime,
        aggregate: aggregate.runtime,
      }),
    ).toEqual({ status: "not_configured" });
    expect(
      createHostedImportQueueWorkerRuntime({
        preview: preview.runtime,
        activation: activation.runtime,
        aggregate:
          unavailableHostedImportQueueWorkerRuntime as HostedProLeagueAggregateWorkerRuntime,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("routes each exact queue kind to only its matching bounded runtime", async () => {
    const preview = readyRuntime();
    const activation = readyRuntime();
    const aggregate = readyRuntime();
    const runtime = createHostedImportQueueWorkerRuntime({
      preview: preview.runtime,
      activation: activation.runtime,
      aggregate: aggregate.runtime,
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const deliveries = [
      {
        target: preview.consume,
        body: {
          version: 1,
          kind: "preview",
          dispatchId: "preview-dispatch-1",
          uploadRequestFingerprint: "a".repeat(64),
        },
      },
      {
        target: activation.consume,
        body: {
          version: 1,
          kind: "import_activation",
          dispatchId: "activation-dispatch-1",
        },
      },
      {
        target: aggregate.consume,
        body: {
          version: 1,
          kind: "aggregate_refresh_retry",
          dispatchId: "aggregate-dispatch-1",
          refreshId: "aggregate-refresh-1",
        },
      },
    ] as const;

    for (const delivery of deliveries) {
      preview.consume.mockClear();
      activation.consume.mockClear();
      aggregate.consume.mockClear();

      await expect(
        runtime.consume({ body: delivery.body, now }),
      ).resolves.toEqual(completed);
      expect(delivery.target).toHaveBeenCalledOnce();
      expect(delivery.target).toHaveBeenCalledWith({
        body: delivery.body,
        now,
      });
      expect(
        preview.consume.mock.calls.length +
          activation.consume.mock.calls.length +
          aggregate.consume.mock.calls.length,
      ).toBe(1);
    }
  });

  it("rejects malformed or unsupported deliveries before any runtime work", async () => {
    const preview = readyRuntime();
    const activation = readyRuntime();
    const aggregate = readyRuntime();
    const runtime = createHostedImportQueueWorkerRuntime({
      preview: preview.runtime,
      activation: activation.runtime,
      aggregate: aggregate.runtime,
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "preview",
          dispatchId: "preview-dispatch-1",
          uploadRequestFingerprint: "not-a-sha256",
        },
      }),
    ).rejects.toThrow("Import queue message is invalid.");
    await expect(
      runtime.consume({
        body: {
          version: 1,
          kind: "unexpected",
          dispatchId: "unexpected-dispatch-1",
        },
      }),
    ).rejects.toThrow("Import queue message is invalid.");
    expect(preview.consume).not.toHaveBeenCalled();
    expect(activation.consume).not.toHaveBeenCalled();
    expect(aggregate.consume).not.toHaveBeenCalled();
  });
});
