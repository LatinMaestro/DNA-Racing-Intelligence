import { describe, expect, it, vi } from "vitest";

import {
  consumeImportPreviewQueueMessage,
  parseCloudflareImportQueueMessage,
} from "../lib/import-queue-consumer";
import {
  type ImportPreviewDispatchClaim,
  type ImportPreviewProcessingCapabilities,
  unavailableImportPreviewProcessingCapabilities,
} from "../lib/import-preview-processing-service";

const NOW = new Date("2026-08-14T05:00:00.000Z");
const FINGERPRINT = "a".repeat(64);

function message() {
  return {
    version: 1,
    kind: "preview",
    dispatchId: "preview-dispatch-1",
    uploadRequestFingerprint: FINGERPRINT,
  } as const;
}

function capabilities(claim: ImportPreviewDispatchClaim) {
  const claimPreviewDispatch = vi.fn(async () => claim);
  const preparePreview = vi.fn();
  const value: ImportPreviewProcessingCapabilities = {
    status: "ready",
    repository: {
      claimPreviewDispatch,
      publishPreparedPreview: vi.fn(),
      recordPreviewFailure: vi.fn(),
    },
    processor: { preparePreview },
  };
  return { value, claimPreviewDispatch, preparePreview };
}

const baseInput = {
  body: message(),
  workerId: "preview-worker-1",
  now: NOW,
  leaseDurationMilliseconds: 15 * 60 * 1000,
  maximumBatchBytes: 512 * 1024 * 1024,
} as const;

describe("import queue consumer", () => {
  it("parses the exact versioned preview identity", () => {
    expect(parseCloudflareImportQueueMessage(message())).toEqual(message());
  });

  it.each([
    { ...message(), version: 2 },
    { ...message(), dispatchId: "../unsafe" },
    { ...message(), uploadRequestFingerprint: "not-a-sha" },
    { ...message(), ownerId: "owner-1" },
    { version: 1, kind: "preview", dispatchId: "preview-dispatch-1" },
  ])("rejects malformed or over-privileged message evidence %#", (body) => {
    expect(() => parseCloudflareImportQueueMessage(body)).toThrow(
      "message is invalid",
    );
  });

  it("retries without repository access when processing is unavailable", async () => {
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        capabilities: unavailableImportPreviewProcessingCapabilities,
      }),
    ).resolves.toEqual({ disposition: "retry", reason: "not_configured" });
  });

  it("binds the delivery fingerprint to the durable dispatch claim", async () => {
    const ready = capabilities({ status: "not_found" });
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({ disposition: "acknowledge", reason: "not_found" });
    expect(ready.claimPreviewDispatch).toHaveBeenCalledWith({
      previewDispatchId: "preview-dispatch-1",
      workerId: "preview-worker-1",
      uploadRequestFingerprint: FINGERPRINT,
      claimedAt: NOW.toISOString(),
      leaseExpiresAt: "2026-08-14T05:15:00.000Z",
    });
  });

  it("returns the durable competing-lease retry boundary", async () => {
    const ready = capabilities({
      status: "leased_elsewhere",
      uploadRequestFingerprint: FINGERPRINT,
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    expect(ready.preparePreview).not.toHaveBeenCalled();
  });

  it("rejects other queue kinds before preview repository access", async () => {
    const ready = capabilities({ status: "not_found" });
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        body: {
          version: 1,
          kind: "import_activation",
          dispatchId: "activation-1",
        },
        capabilities: ready.value,
      }),
    ).rejects.toThrow("not available");
    expect(ready.claimPreviewDispatch).not.toHaveBeenCalled();
  });
});
