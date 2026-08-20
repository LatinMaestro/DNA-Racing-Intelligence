import { describe, expect, it, vi } from "vitest";

import {
  type AggregateRefreshCapabilities,
  type AggregateRefreshClaim,
} from "../lib/import-aggregate-refresh-service";
import {
  type BackgroundDispatchClaim,
  type BackgroundProcessingCapabilities,
} from "../lib/import-background-processing-service";
import {
  consumeAggregateRefreshQueueMessage,
  consumeImportActivationQueueMessage,
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
const SOURCE_VERSION_SET = "b".repeat(64);

function message() {
  return {
    version: 1,
    kind: "preview",
    dispatchId: "preview-dispatch-1",
    uploadRequestFingerprint: FINGERPRINT,
  } as const;
}

function aggregateMessage() {
  return {
    version: 1,
    kind: "aggregate_refresh_retry",
    dispatchId: "refresh-dispatch-1",
    refreshId: "refresh-1",
  } as const;
}

function activationMessage() {
  return {
    version: 1,
    kind: "import_activation",
    dispatchId: "activation-dispatch-1",
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

function activationCapabilities(claim: BackgroundDispatchClaim) {
  const claimDispatch = vi.fn(async () => claim);
  const prepare = vi.fn(async () => ({
    preparedResultId: "prepared-result-1",
    sourceVersionCount: 3,
    quarantinedRecordCount: 0,
    aggregateRefreshRequired: true,
  }));
  const value: BackgroundProcessingCapabilities = {
    status: "ready",
    repository: {
      claimDispatch,
      activatePreparedResult: vi.fn(async () => undefined),
      recordProcessingFailure: vi.fn(async () => undefined),
    },
    processor: { prepare },
  };
  return { value, claimDispatch, prepare };
}

function aggregateCapabilities(claim: AggregateRefreshClaim) {
  const claimRefresh = vi.fn(async () => claim);
  const prepare = vi.fn(async () => ({
    preparedAggregateSetId: "prepared-set-1",
    sourceVersionSetSha256: SOURCE_VERSION_SET,
    aggregateFamilyCount: 4,
    materializedRowCount: 25,
  }));
  const value: AggregateRefreshCapabilities = {
    status: "ready",
    repository: {
      claimRefresh,
      publishPreparedAggregateSet: vi.fn(async () => ({
        status: "published" as const,
        aggregateSetId: "aggregate-set-1",
      })),
      recordRefreshFailure: vi.fn(async () => undefined),
    },
    refresher: { prepare },
  };
  return { value, claimRefresh, prepare };
}

const baseInput = {
  body: message(),
  workerId: "preview-worker-1",
  now: NOW,
  leaseDurationMilliseconds: 15 * 60 * 1000,
  maximumBatchBytes: 512 * 1024 * 1024,
} as const;

const activationInput = {
  body: activationMessage(),
  workerId: "activation-worker-1",
  now: NOW,
  leaseDurationMilliseconds: 15 * 60 * 1000,
} as const;

const aggregateInput = {
  body: aggregateMessage(),
  workerId: "aggregate-worker-1",
  now: NOW,
  leaseDurationMilliseconds: 15 * 60 * 1000,
} as const;

describe("import queue consumer", () => {
  it("parses the exact versioned queue identities", () => {
    expect(parseCloudflareImportQueueMessage(message())).toEqual(message());
    expect(parseCloudflareImportQueueMessage(activationMessage())).toEqual(
      activationMessage(),
    );
    expect(parseCloudflareImportQueueMessage(aggregateMessage())).toEqual(
      aggregateMessage(),
    );
  });

  it.each([
    { ...message(), version: 2 },
    { ...message(), dispatchId: "../unsafe" },
    { ...message(), uploadRequestFingerprint: "not-a-sha" },
    { ...message(), ownerId: "owner-1" },
    { version: 1, kind: "preview", dispatchId: "preview-dispatch-1" },
    {
      version: 1,
      kind: "aggregate_refresh_retry",
      dispatchId: "refresh-dispatch-1",
    },
    { ...aggregateMessage(), refreshId: "../unsafe" },
    { ...aggregateMessage(), ownerId: "owner-1" },
  ])("rejects malformed or over-privileged message evidence %#", (body) => {
    expect(() => parseCloudflareImportQueueMessage(body)).toThrow(
      "message is invalid",
    );
  });

  it("retries without repository access when preview processing is unavailable", async () => {
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        capabilities: unavailableImportPreviewProcessingCapabilities,
      }),
    ).resolves.toEqual({ disposition: "retry", reason: "not_configured" });
  });

  it("binds the delivery fingerprint to the durable preview dispatch claim", async () => {
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

  it("returns the durable competing preview lease boundary", async () => {
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

  it("binds activation deliveries to the durable import dispatch", async () => {
    const ready = activationCapabilities({ status: "not_found" });
    await expect(
      consumeImportActivationQueueMessage({
        ...activationInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({ disposition: "acknowledge", reason: "not_found" });
    expect(ready.claimDispatch).toHaveBeenCalledWith({
      dispatchId: "activation-dispatch-1",
      workerId: "activation-worker-1",
      claimedAt: NOW.toISOString(),
      leaseExpiresAt: "2026-08-14T05:15:00.000Z",
    });
  });

  it("maps unavailable and competing activation work to queue retries", async () => {
    await expect(
      consumeImportActivationQueueMessage({
        ...activationInput,
        capabilities: { status: "not_configured" },
      }),
    ).resolves.toEqual({ disposition: "retry", reason: "not_configured" });

    const ready = activationCapabilities({
      status: "leased_elsewhere",
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    await expect(
      consumeImportActivationQueueMessage({
        ...activationInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    expect(ready.prepare).not.toHaveBeenCalled();
  });

  it("binds an aggregate retry delivery to its durable refresh, not its queue dispatch", async () => {
    const ready = aggregateCapabilities({ status: "not_found" });
    await expect(
      consumeAggregateRefreshQueueMessage({
        ...aggregateInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({ disposition: "acknowledge", reason: "not_found" });
    expect(ready.claimRefresh).toHaveBeenCalledWith({
      refreshId: "refresh-1",
      workerId: "aggregate-worker-1",
      claimedAt: NOW.toISOString(),
      leaseExpiresAt: "2026-08-14T05:15:00.000Z",
    });
    expect(ready.claimRefresh).not.toHaveBeenCalledWith(
      expect.objectContaining({ refreshId: "refresh-dispatch-1" }),
    );
  });

  it("maps unavailable and competing aggregate work to queue retries", async () => {
    await expect(
      consumeAggregateRefreshQueueMessage({
        ...aggregateInput,
        capabilities: { status: "not_configured" },
      }),
    ).resolves.toEqual({ disposition: "retry", reason: "not_configured" });

    const ready = aggregateCapabilities({
      status: "leased_elsewhere",
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    await expect(
      consumeAggregateRefreshQueueMessage({
        ...aggregateInput,
        capabilities: ready.value,
      }),
    ).resolves.toEqual({
      disposition: "retry",
      reason: "leased_elsewhere",
      retryAfter: "2026-08-14T05:15:00.000Z",
    });
    expect(ready.prepare).not.toHaveBeenCalled();
  });

  it("acknowledges completed and missing aggregate work without replay loops", async () => {
    for (const claim of [
      {
        status: "already_complete" as const,
        updateSessionId: "session-1",
        aggregateSetId: "aggregate-set-1",
      },
      { status: "not_found" as const },
    ]) {
      const ready = aggregateCapabilities(claim);
      const result = await consumeAggregateRefreshQueueMessage({
        ...aggregateInput,
        capabilities: ready.value,
      });
      expect(result.disposition).toBe("acknowledge");
      expect(ready.prepare).not.toHaveBeenCalled();
    }
  });

  it("rejects queue kinds before the wrong repository is accessed", async () => {
    const preview = capabilities({ status: "not_found" });
    await expect(
      consumeImportPreviewQueueMessage({
        ...baseInput,
        body: aggregateMessage(),
        capabilities: preview.value,
      }),
    ).rejects.toThrow("not available");
    expect(preview.claimPreviewDispatch).not.toHaveBeenCalled();

    const activation = activationCapabilities({ status: "not_found" });
    await expect(
      consumeImportActivationQueueMessage({
        ...activationInput,
        body: aggregateMessage(),
        capabilities: activation.value,
      }),
    ).rejects.toThrow("not available");
    expect(activation.claimDispatch).not.toHaveBeenCalled();

    const aggregate = aggregateCapabilities({ status: "not_found" });
    await expect(
      consumeAggregateRefreshQueueMessage({
        ...aggregateInput,
        body: message(),
        capabilities: aggregate.value,
      }),
    ).rejects.toThrow("not available");
    expect(aggregate.claimRefresh).not.toHaveBeenCalled();
  });
});
