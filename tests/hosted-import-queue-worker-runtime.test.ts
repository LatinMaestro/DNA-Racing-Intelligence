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

const unavailablePreview =
  unavailableHostedImportQueueWorkerRuntime as HostedImportPreviewWorkerRuntime;
const unavailableActivation =
  unavailableHostedImportQueueWorkerRuntime as HostedImportActivationWorkerRuntime;
const unavailableAggregate =
  unavailableHostedImportQueueWorkerRuntime as HostedProLeagueAggregateWorkerRuntime;

describe("hosted import queue worker runtime", () => {
  it("fails closed only when every import runtime is unavailable", () => {
    expect(
      createHostedImportQueueWorkerRuntime({
        preview: unavailablePreview,
        activation: unavailableActivation,
        aggregate: unavailableAggregate,
      }),
    ).toEqual({ status: "not_configured" });
  });

  it("keeps a configured message family available when an unrelated runtime is unavailable", async () => {
    const preview = readyRuntime();
    const activation = readyRuntime();
    const runtime = createHostedImportQueueWorkerRuntime({
      preview: preview.runtime,
      activation: activation.runtime,
      aggregate: unavailableAggregate,
    });
    expect(runtime.status).toBe("ready");
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    const previewBody = {
      version: 1 as const,
      kind: "preview" as const,
      dispatchId: "preview-dispatch-1",
      uploadRequestFingerprint: "a".repeat(64),
    };
    await expect(runtime.consume({ body: previewBody, now })).resolves.toEqual(
      completed,
    );
    expect(preview.consume).toHaveBeenCalledWith({ body: previewBody, now });
    expect(activation.consume).not.toHaveBeenCalled();

    expect(() =>
      runtime.consume({
        body: {
          version: 1,
          kind: "aggregate_refresh_retry",
          dispatchId: "aggregate-dispatch-1",
          refreshId: "aggregate-refresh-1",
        },
        now,
      }),
    ).toThrow("Aggregate refresh import queue runtime is not configured.");
  });

  it("fails closed for an unavailable message family without blocking the others", async () => {
    const activation = readyRuntime();
    const aggregate = readyRuntime();
    const runtime = createHostedImportQueueWorkerRuntime({
      preview: unavailablePreview,
      activation: activation.runtime,
      aggregate: aggregate.runtime,
    });
    if (runtime.status !== "ready") throw new Error("expected ready runtime");

    expect(() =>
      runtime.consume({
        body: {
          version: 1,
          kind: "preview",
          dispatchId: "preview-dispatch-1",
          uploadRequestFingerprint: "a".repeat(64),
        },
        now,
      }),
    ).toThrow("Preview import queue runtime is not configured.");

    const activationBody = {
      version: 1 as const,
      kind: "import_activation" as const,
      dispatchId: "activation-dispatch-1",
    };
    await expect(
      runtime.consume({ body: activationBody, now }),
    ).resolves.toEqual(completed);
    expect(activation.consume).toHaveBeenCalledWith({
      body: activationBody,
      now,
    });
    expect(aggregate.consume).not.toHaveBeenCalled();
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

    expect(() =>
      runtime.consume({
        body: {
          version: 1,
          kind: "preview",
          dispatchId: "preview-dispatch-1",
          uploadRequestFingerprint: "not-a-sha256",
        },
      }),
    ).toThrow("Import queue message is invalid.");
    expect(() =>
      runtime.consume({
        body: {
          version: 1,
          kind: "unexpected",
          dispatchId: "unexpected-dispatch-1",
        },
      }),
    ).toThrow("Import queue message is invalid.");
    expect(preview.consume).not.toHaveBeenCalled();
    expect(activation.consume).not.toHaveBeenCalled();
    expect(aggregate.consume).not.toHaveBeenCalled();
  });
});
