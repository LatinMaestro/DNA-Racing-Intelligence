import { describe, expect, it, vi } from "vitest";
import {
  runAggregateRefreshDispatch,
  type AggregateRefreshCapabilities,
  type AggregateRefreshClaim,
  type AggregateRefreshRepository,
  type BoundedAggregateRefresher,
} from "@/lib/import-aggregate-refresh-service";

const now = new Date("2026-07-24T06:00:00.000Z");
const sourceVersionSetSha256 = "c".repeat(64);

function capabilities(
  claim: AggregateRefreshClaim = {
    status: "claimed",
    ownerId: "synthetic-owner",
    updateSessionId: "synthetic-session",
    sourceVersionSetSha256,
  },
  refresherOverrides: Partial<BoundedAggregateRefresher> = {},
  publication:
    | { status: "published"; aggregateSetId: string }
    | { status: "superseded" } = {
    status: "published",
    aggregateSetId: "synthetic-aggregate-set",
  },
) {
  const repository: AggregateRefreshRepository = {
    claimRefresh: vi.fn(async () => claim),
    publishPreparedAggregateSet: vi.fn(async () => publication),
    recordRefreshFailure: vi.fn(async () => undefined),
  };
  const refresher: BoundedAggregateRefresher = {
    prepare:
      refresherOverrides.prepare ??
      vi.fn(async () => ({
        preparedAggregateSetId: "synthetic-prepared-aggregates",
        sourceVersionSetSha256,
        aggregateFamilyCount: 4,
        materializedRowCount: 250,
      })),
  };
  const value: AggregateRefreshCapabilities = {
    status: "ready",
    repository,
    refresher,
  };
  return { value, repository, refresher };
}

function input(
  overrides: Partial<Parameters<typeof runAggregateRefreshDispatch>[0]> = {},
): Parameters<typeof runAggregateRefreshDispatch>[0] {
  return {
    refreshId: "synthetic-refresh",
    workerId: "synthetic-worker",
    now,
    leaseDurationMilliseconds: 300_000,
    capabilities: capabilities().value,
    ...overrides,
  };
}

describe("aggregate refresh dispatch", () => {
  it("remains unavailable without configured background capabilities", async () => {
    await expect(
      runAggregateRefreshDispatch(
        input({ capabilities: { status: "not_configured" } }),
      ),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("claims a bounded lease and publishes one verified aggregate set", async () => {
    const service = capabilities();

    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).resolves.toEqual({
      status: "completed",
      updateSessionId: "synthetic-session",
      aggregateSetId: "synthetic-aggregate-set",
      aggregateFamilyCount: 4,
      materializedRowCount: 250,
    });
    expect(service.repository.claimRefresh).toHaveBeenCalledWith({
      refreshId: "synthetic-refresh",
      workerId: "synthetic-worker",
      claimedAt: now.toISOString(),
      leaseExpiresAt: "2026-07-24T06:05:00.000Z",
    });
    expect(service.refresher.prepare).toHaveBeenCalledWith({
      ownerId: "synthetic-owner",
      updateSessionId: "synthetic-session",
      refreshId: "synthetic-refresh",
      sourceVersionSetSha256,
    });
    expect(service.repository.publishPreparedAggregateSet).toHaveBeenCalledWith(
      {
        ownerId: "synthetic-owner",
        updateSessionId: "synthetic-session",
        refreshId: "synthetic-refresh",
        workerId: "synthetic-worker",
        preparedAggregateSetId: "synthetic-prepared-aggregates",
        sourceVersionSetSha256,
        aggregateFamilyCount: 4,
        materializedRowCount: 250,
        completedAt: now.toISOString(),
      },
    );
  });

  it("does not recompute missing, completed or concurrently leased work", async () => {
    for (const claim of [
      { status: "not_found" as const },
      {
        status: "already_complete" as const,
        updateSessionId: "existing-session",
        aggregateSetId: "existing-aggregate-set",
      },
      {
        status: "leased_elsewhere" as const,
        retryAfter: "2026-07-24T06:05:00.000Z",
      },
    ]) {
      const service = capabilities(claim);
      const result = await runAggregateRefreshDispatch(
        input({ capabilities: service.value }),
      );

      expect(result.status).toBe(claim.status);
      expect(service.refresher.prepare).not.toHaveBeenCalled();
      expect(
        service.repository.publishPreparedAggregateSet,
      ).not.toHaveBeenCalled();
    }
  });

  it("does not publish a prepared set for superseded source versions", async () => {
    const service = capabilities(undefined, {}, { status: "superseded" });

    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).resolves.toEqual({
      status: "superseded",
      updateSessionId: "synthetic-session",
    });
    expect(service.repository.recordRefreshFailure).not.toHaveBeenCalled();
  });

  it("rejects a prepared result bound to another source-version set", async () => {
    const service = capabilities(undefined, {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: "synthetic-prepared-aggregates",
        sourceVersionSetSha256: "d".repeat(64),
        aggregateFamilyCount: 4,
        materializedRowCount: 250,
      })),
    });

    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).rejects.toThrow("Aggregate refresh processing failed");
    expect(service.repository.recordRefreshFailure).toHaveBeenCalledWith({
      ownerId: "synthetic-owner",
      updateSessionId: "synthetic-session",
      refreshId: "synthetic-refresh",
      workerId: "synthetic-worker",
      failedAt: now.toISOString(),
      reason: "refresher_failed",
    });
    expect(
      service.repository.publishPreparedAggregateSet,
    ).not.toHaveBeenCalled();
  });

  it("records computation failure without publishing stale recommendations", async () => {
    const service = capabilities(undefined, {
      prepare: vi.fn(async () => {
        throw new Error("synthetic computation failure");
      }),
    });

    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).rejects.toThrow("Aggregate refresh processing failed");
    expect(service.repository.recordRefreshFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "refresher_failed" }),
    );
    expect(
      service.repository.publishPreparedAggregateSet,
    ).not.toHaveBeenCalled();
  });

  it("records atomic publication failure without claiming completion", async () => {
    const service = capabilities();
    vi.mocked(
      service.repository.publishPreparedAggregateSet,
    ).mockRejectedValueOnce(new Error("synthetic transaction failure"));

    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).rejects.toThrow("Aggregate refresh publication failed");
    expect(service.repository.recordRefreshFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "publish_failed" }),
    );
  });

  it("canonicalizes claim and prepared identifiers before publication", async () => {
    const service = capabilities(
      {
        status: "claimed",
        ownerId: " synthetic-owner ",
        updateSessionId: " synthetic-session ",
        sourceVersionSetSha256,
      },
      {
        prepare: vi.fn(async () => ({
          preparedAggregateSetId: " synthetic-prepared-aggregates ",
          sourceVersionSetSha256,
          aggregateFamilyCount: 4,
          materializedRowCount: 250,
        })),
      },
    );

    await runAggregateRefreshDispatch(input({ capabilities: service.value }));

    expect(service.refresher.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "synthetic-owner",
        updateSessionId: "synthetic-session",
      }),
    );
    expect(service.repository.publishPreparedAggregateSet).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "synthetic-owner",
        updateSessionId: "synthetic-session",
        preparedAggregateSetId: "synthetic-prepared-aggregates",
      }),
    );
  });

  it("rejects stale or unbounded concurrent-lease retry evidence", async () => {
    for (const retryAfter of [now.toISOString(), "2026-07-24T07:00:00.001Z"]) {
      const service = capabilities({
        status: "leased_elsewhere",
        retryAfter,
      });

      await expect(
        runAggregateRefreshDispatch(input({ capabilities: service.value })),
      ).rejects.toThrow("retryAfter must be a canonical future timestamp");
      expect(service.refresher.prepare).not.toHaveBeenCalled();
    }
  });

  it("rejects malformed claim and publication states", async () => {
    const malformedClaim = capabilities();
    vi.mocked(malformedClaim.repository.claimRefresh).mockResolvedValueOnce({
      status: "unexpected",
    } as never);
    await expect(
      runAggregateRefreshDispatch(
        input({ capabilities: malformedClaim.value }),
      ),
    ).rejects.toThrow("aggregate refresh claim status is invalid");
    expect(malformedClaim.refresher.prepare).not.toHaveBeenCalled();

    const malformedPublication = capabilities();
    vi.mocked(
      malformedPublication.repository.publishPreparedAggregateSet,
    ).mockResolvedValueOnce({ status: "unexpected" } as never);
    await expect(
      runAggregateRefreshDispatch(
        input({ capabilities: malformedPublication.value }),
      ),
    ).rejects.toThrow("Aggregate refresh publication failed");
    expect(
      malformedPublication.repository.recordRefreshFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "publish_failed" }),
    );
  });
  it("fails closed on invalid identities, leases and prepared counts", async () => {
    await expect(
      runAggregateRefreshDispatch(input({ refreshId: "../unsafe" })),
    ).rejects.toThrow("refreshId");
    await expect(
      runAggregateRefreshDispatch(
        input({ leaseDurationMilliseconds: 60 * 60 * 1000 + 1 }),
      ),
    ).rejects.toThrow("leaseDurationMilliseconds");

    const service = capabilities(undefined, {
      prepare: vi.fn(async () => ({
        preparedAggregateSetId: "synthetic-prepared-aggregates",
        sourceVersionSetSha256,
        aggregateFamilyCount: 0,
        materializedRowCount: 0,
      })),
    });
    await expect(
      runAggregateRefreshDispatch(input({ capabilities: service.value })),
    ).rejects.toThrow("Aggregate refresh processing failed");
    expect(service.repository.recordRefreshFailure).toHaveBeenCalledOnce();
  });
});
