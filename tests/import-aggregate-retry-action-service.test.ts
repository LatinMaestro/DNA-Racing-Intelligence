import { describe, expect, it, vi } from "vitest";

import {
  retryOwnerAggregateRefresh,
  type AggregateRetryActionDependencies,
  type AggregateRetryCapabilities,
  type AggregateRetryQueue,
  type AggregateRetryRepository,
} from "../lib/import-aggregate-retry-action-service";

function readyCapabilities() {
  const reserveRetry = vi.fn<AggregateRetryRepository["reserveRetry"]>(
    async () => ({
      status: "reserved",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
      disposition: "created",
      dispatchState: "pending",
    }),
  );
  const markDispatchQueued = vi.fn<
    AggregateRetryRepository["markDispatchQueued"]
  >(async () => undefined);
  const markDispatchFailed = vi.fn<
    AggregateRetryRepository["markDispatchFailed"]
  >(async () => undefined);
  const enqueue = vi.fn<AggregateRetryQueue["enqueue"]>(async () => undefined);
  return {
    value: {
      repository: {
        status: "ready",
        service: {
          reserveRetry,
          markDispatchQueued,
          markDispatchFailed,
        },
      },
      backgroundQueue: { status: "ready", service: { enqueue } },
    } satisfies AggregateRetryCapabilities,
    reserveRetry,
    markDispatchQueued,
    markDispatchFailed,
    enqueue,
  };
}

function dependencies(
  capabilities: AggregateRetryCapabilities,
  ownerId: string | null = "owner-1",
): AggregateRetryActionDependencies {
  return {
    resolveAuthenticatedOwnerId: vi.fn(async () => ownerId),
    configuredOwnerId: "owner-1",
    now: () => new Date("2026-07-26T09:00:00.000Z"),
    capabilities,
  };
}

const input = {
  failedRefreshId: "refresh-failed-1",
  retryReason: "Retry the failed aggregate publication.",
  idempotencyKey: "retry-request-1",
  explicitlyConfirmed: true,
} as const;

describe("aggregate refresh retry owner action", () => {
  it("keeps signed-out and non-owner requests away from persistence", async () => {
    const signedOut = readyCapabilities();
    await expect(
      retryOwnerAggregateRefresh(input, dependencies(signedOut.value, null)),
    ).resolves.toEqual({ status: "identity_not_connected" });
    expect(signedOut.reserveRetry).not.toHaveBeenCalled();

    const nonOwner = readyCapabilities();
    await expect(
      retryOwnerAggregateRefresh(
        input,
        dependencies(nonOwner.value, "other-owner"),
      ),
    ).rejects.toThrow("access denied");
    expect(nonOwner.reserveRetry).not.toHaveBeenCalled();
  });

  it("reports unavailable repository and queue capabilities", async () => {
    await expect(
      retryOwnerAggregateRefresh(
        input,
        dependencies({
          repository: { status: "not_configured" },
          backgroundQueue: { status: "not_configured" },
        }),
      ),
    ).resolves.toEqual({
      status: "not_configured",
      missingCapabilities: ["repository", "background_queue"],
    });
  });

  it("requires explicit acknowledgement and a meaningful reason", async () => {
    const capabilities = readyCapabilities();
    await expect(
      retryOwnerAggregateRefresh(
        { ...input, explicitlyConfirmed: false },
        dependencies(capabilities.value),
      ),
    ).rejects.toThrow("Explicit owner confirmation");
    await expect(
      retryOwnerAggregateRefresh(
        { ...input, retryReason: "short" },
        dependencies(capabilities.value),
      ),
    ).rejects.toThrow("retryReason");
    expect(capabilities.reserveRetry).not.toHaveBeenCalled();
  });

  it("preserves missing and non-retryable refresh states", async () => {
    for (const reservation of [
      { status: "not_found" as const },
      {
        status: "not_retryable" as const,
        refreshStatus: "completed" as const,
      },
    ]) {
      const capabilities = readyCapabilities();
      capabilities.reserveRetry.mockResolvedValueOnce(reservation);
      await expect(
        retryOwnerAggregateRefresh(input, dependencies(capabilities.value)),
      ).resolves.toEqual(reservation);
      expect(capabilities.enqueue).not.toHaveBeenCalled();
    }
  });

  it("reserves and queues one owner-scoped aggregate retry", async () => {
    const capabilities = readyCapabilities();
    await expect(
      retryOwnerAggregateRefresh(input, dependencies(capabilities.value)),
    ).resolves.toEqual({
      status: "queued",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
      disposition: "created",
    });
    expect(capabilities.reserveRetry).toHaveBeenCalledWith({
      ownerId: "owner-1",
      failedRefreshId: "refresh-failed-1",
      reason: "Retry the failed aggregate publication.",
      idempotencyKey: "retry-request-1",
      requestedAt: "2026-07-26T09:00:00.000Z",
    });
    expect(capabilities.enqueue).toHaveBeenCalledWith({
      ownerId: "owner-1",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
    });
    expect(capabilities.markDispatchQueued).toHaveBeenCalledOnce();
  });

  it("replays a queued reservation without duplicate queue delivery", async () => {
    const capabilities = readyCapabilities();
    capabilities.reserveRetry.mockResolvedValueOnce({
      status: "reserved",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
      disposition: "existing",
      dispatchState: "queued",
    });
    await expect(
      retryOwnerAggregateRefresh(input, dependencies(capabilities.value)),
    ).resolves.toEqual({
      status: "queued",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
      disposition: "existing",
    });
    expect(capabilities.enqueue).not.toHaveBeenCalled();
  });

  it("records a sanitized queue failure without claiming completion", async () => {
    const capabilities = readyCapabilities();
    capabilities.enqueue.mockRejectedValueOnce(new Error("provider details"));
    await expect(
      retryOwnerAggregateRefresh(input, dependencies(capabilities.value)),
    ).rejects.toThrow("Aggregate refresh retry dispatch failed");
    expect(capabilities.markDispatchFailed).toHaveBeenCalledWith({
      ownerId: "owner-1",
      refreshId: "refresh-retry-1",
      dispatchId: "refresh-dispatch-1",
      failedAt: "2026-07-26T09:00:00.000Z",
      reason: "queue_unavailable",
    });
    expect(capabilities.markDispatchQueued).not.toHaveBeenCalled();
  });

  it("fails closed on malformed reservation evidence", async () => {
    const capabilities = readyCapabilities();
    capabilities.reserveRetry.mockResolvedValueOnce({
      status: "reserved",
      refreshId: "../unsafe",
      dispatchId: "refresh-dispatch-1",
      disposition: "created",
      dispatchState: "pending",
    });
    await expect(
      retryOwnerAggregateRefresh(input, dependencies(capabilities.value)),
    ).rejects.toThrow("refreshId");
    expect(capabilities.enqueue).not.toHaveBeenCalled();
  });
});
