import { afterEach, describe, expect, it, vi } from "vitest";

const dependencies = vi.hoisted(() => ({
  ownerId: vi.fn(async (): Promise<string | null> => "owner-1"),
  revalidatePath: vi.fn(),
  reserveRetry: vi.fn(async () => ({
    status: "reserved" as const,
    refreshId: "refresh-failed-1",
    dispatchId: "dispatch-1",
    disposition: "created" as const,
    dispatchState: "pending" as const,
  })),
  markDispatchQueued: vi.fn(async () => undefined),
  markDispatchFailed: vi.fn(async () => undefined),
  enqueue: vi.fn(async () => undefined),
  hostedRuntime: vi.fn(),
}));

vi.mock("next/cache", () => ({
  revalidatePath: dependencies.revalidatePath,
}));
vi.mock("../lib/clerk-owner-session", () => ({
  authenticatedClerkOwnerId: dependencies.ownerId,
}));
vi.mock("../lib/hosted-import-aggregate-retry-runtime", () => ({
  hostedImportAggregateRetryRuntime: dependencies.hostedRuntime,
}));

import { submitImportAggregateRetryFormAction } from "../app/(private)/imports/actions";

afterEach(() => {
  vi.clearAllMocks();
  vi.unstubAllEnvs();
});

describe("import aggregate retry form action", () => {
  it("connects the owner-scoped repository and queue then refreshes the workspace", async () => {
    vi.stubEnv("AUTHORIZED_CLERK_USER_ID", "owner-1");
    dependencies.hostedRuntime.mockReturnValue({
      repository: {
        status: "ready",
        service: {
          reserveRetry: dependencies.reserveRetry,
          markDispatchQueued: dependencies.markDispatchQueued,
          markDispatchFailed: dependencies.markDispatchFailed,
        },
      },
      backgroundQueue: {
        status: "ready",
        service: { enqueue: dependencies.enqueue },
      },
    });
    const formData = new FormData();
    formData.set("failedRefreshId", "refresh-failed-1");
    formData.set(
      "retryReason",
      "Retry after reviewing the accepted source correction.",
    );
    formData.set("explicitlyConfirmed", "yes");

    await expect(
      submitImportAggregateRetryFormAction(null, formData),
    ).resolves.toEqual({
      status: "success",
      title: "Aggregate retry queued",
      detail:
        "The failed accepted-data aggregate refresh will be processed in the background. Readiness remains unavailable until publication completes.",
    });
    expect(dependencies.reserveRetry).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner-1",
        failedRefreshId: "refresh-failed-1",
        reason: "Retry after reviewing the accepted source correction.",
      }),
    );
    expect(dependencies.enqueue).toHaveBeenCalledWith({
      ownerId: "owner-1",
      refreshId: "refresh-failed-1",
      dispatchId: "dispatch-1",
    });
    expect(dependencies.revalidatePath).toHaveBeenCalledExactlyOnceWith(
      "/imports",
    );
  });
});
