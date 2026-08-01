import { describe, expect, it, vi } from "vitest";
import {
  runBackgroundImportDispatch,
  type BackgroundImportProcessingRepository,
  type BackgroundProcessingCapabilities,
  type BoundedImportProcessor,
} from "@/lib/import-background-processing-service";

const now = new Date("2026-07-24T05:00:00.000Z");
const fingerprint = "b".repeat(64);

function capabilities(
  claim: Awaited<
    ReturnType<BackgroundImportProcessingRepository["claimDispatch"]>
  > = {
    status: "claimed",
    ownerId: "owner",
    updateSessionId: "synthetic-session",
    previewFingerprintSha256: fingerprint,
  },
  processorOverrides: Partial<BoundedImportProcessor> = {},
): {
  value: BackgroundProcessingCapabilities;
  repository: BackgroundImportProcessingRepository;
  processor: BoundedImportProcessor;
} {
  const repository: BackgroundImportProcessingRepository = {
    claimDispatch: vi.fn(async () => claim),
    activatePreparedResult: vi.fn(async () => undefined),
    recordProcessingFailure: vi.fn(async () => undefined),
  };
  const processor: BoundedImportProcessor = {
    prepare:
      processorOverrides.prepare ??
      vi.fn(async () => ({
        preparedResultId: "synthetic-prepared-result",
        sourceVersionCount: 2,
        quarantinedRecordCount: 1,
        aggregateRefreshRequired: true,
      })),
  };
  return {
    value: { status: "ready", repository, processor },
    repository,
    processor,
  };
}

function input(
  overrides: Partial<Parameters<typeof runBackgroundImportDispatch>[0]> = {},
): Parameters<typeof runBackgroundImportDispatch>[0] {
  return {
    dispatchId: "synthetic-dispatch",
    workerId: "synthetic-worker",
    now,
    leaseDurationMilliseconds: 300_000,
    capabilities: capabilities().value,
    ...overrides,
  };
}

describe("background import dispatch processing", () => {
  it("remains unavailable without worker capabilities", async () => {
    await expect(
      runBackgroundImportDispatch(
        input({ capabilities: { status: "not_configured" } }),
      ),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("claims one bounded lease before processing", async () => {
    const services = capabilities();

    await expect(
      runBackgroundImportDispatch(input({ capabilities: services.value })),
    ).resolves.toEqual({
      status: "completed",
      updateSessionId: "synthetic-session",
      preparedResultId: "synthetic-prepared-result",
      aggregateRefreshRequired: true,
    });
    expect(services.repository.claimDispatch).toHaveBeenCalledWith({
      dispatchId: "synthetic-dispatch",
      workerId: "synthetic-worker",
      claimedAt: now.toISOString(),
      leaseExpiresAt: "2026-07-24T05:05:00.000Z",
    });
    expect(services.processor.prepare).toHaveBeenCalledWith({
      ownerId: "owner",
      updateSessionId: "synthetic-session",
      dispatchId: "synthetic-dispatch",
      previewFingerprintSha256: fingerprint,
    });
    expect(services.repository.activatePreparedResult).toHaveBeenCalledWith({
      ownerId: "owner",
      updateSessionId: "synthetic-session",
      dispatchId: "synthetic-dispatch",
      preparedResultId: "synthetic-prepared-result",
      completedAt: now.toISOString(),
      sourceVersionCount: 2,
      quarantinedRecordCount: 1,
      aggregateRefreshRequired: true,
    });
  });

  it("does not process a missing, completed or concurrently leased dispatch", async () => {
    for (const claim of [
      { status: "not_found" as const },
      {
        status: "already_complete" as const,
        updateSessionId: "existing-session",
      },
      {
        status: "leased_elsewhere" as const,
        retryAfter: "2026-07-24T05:05:00.000Z",
      },
    ]) {
      const services = capabilities(claim);
      const result = await runBackgroundImportDispatch(
        input({ capabilities: services.value }),
      );

      expect(result.status).toBe(claim.status);
      expect(services.processor.prepare).not.toHaveBeenCalled();
      expect(services.repository.activatePreparedResult).not.toHaveBeenCalled();
    }
  });

  it("records a retryable failure without activating prepared data", async () => {
    const services = capabilities(undefined, {
      prepare: vi.fn(async () => {
        throw new Error("synthetic processor failure");
      }),
    });

    await expect(
      runBackgroundImportDispatch(input({ capabilities: services.value })),
    ).rejects.toThrow("Background import processing failed");
    expect(services.repository.recordProcessingFailure).toHaveBeenCalledWith({
      ownerId: "owner",
      updateSessionId: "synthetic-session",
      dispatchId: "synthetic-dispatch",
      workerId: "synthetic-worker",
      failedAt: now.toISOString(),
      reason: "processor_failed",
    });
    expect(services.repository.activatePreparedResult).not.toHaveBeenCalled();
  });

  it("fails closed on an invalid prepared result", async () => {
    const services = capabilities(undefined, {
      prepare: vi.fn(async () => ({
        preparedResultId: "synthetic-result",
        sourceVersionCount: 0,
        quarantinedRecordCount: 0,
        aggregateRefreshRequired: false,
      })),
    });

    await expect(
      runBackgroundImportDispatch(input({ capabilities: services.value })),
    ).rejects.toThrow("Background import processing failed");
    expect(services.repository.recordProcessingFailure).toHaveBeenCalledOnce();
    expect(services.repository.activatePreparedResult).not.toHaveBeenCalled();
  });

  it("canonicalizes repository identifiers before processing and activation", async () => {
    const services = capabilities({
      status: "claimed",
      ownerId: " owner ",
      updateSessionId: " synthetic-session ",
      previewFingerprintSha256: fingerprint,
    });

    await runBackgroundImportDispatch(input({ capabilities: services.value }));

    expect(services.processor.prepare).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner",
        updateSessionId: "synthetic-session",
      }),
    );
    expect(services.repository.activatePreparedResult).toHaveBeenCalledWith(
      expect.objectContaining({
        ownerId: "owner",
        updateSessionId: "synthetic-session",
      }),
    );
  });

  it("rejects malformed claim states before invoking the processor", async () => {
    const services = capabilities({
      status: "claimed",
      ownerId: "owner",
      updateSessionId: "synthetic-session",
      previewFingerprintSha256: fingerprint,
    });
    vi.mocked(services.repository.claimDispatch).mockResolvedValue({
      status: "unexpected",
    } as never);

    await expect(
      runBackgroundImportDispatch(input({ capabilities: services.value })),
    ).rejects.toThrow("dispatch claim status is invalid");
    expect(services.processor.prepare).not.toHaveBeenCalled();
    expect(services.repository.activatePreparedResult).not.toHaveBeenCalled();
  });

  it("rejects stale or unbounded concurrent-lease retry evidence", async () => {
    for (const retryAfter of [now.toISOString(), "2026-07-24T06:00:00.001Z"]) {
      const services = capabilities({
        status: "leased_elsewhere",
        retryAfter,
      });

      await expect(
        runBackgroundImportDispatch(input({ capabilities: services.value })),
      ).rejects.toThrow("retryAfter must be a canonical future timestamp");
      expect(services.processor.prepare).not.toHaveBeenCalled();
    }
  });

  it("rejects a non-Boolean aggregate refresh decision before activation", async () => {
    const services = capabilities(undefined, {
      prepare: vi.fn(async () => ({
        preparedResultId: "synthetic-result",
        sourceVersionCount: 1,
        quarantinedRecordCount: 0,
        aggregateRefreshRequired: "false" as unknown as boolean,
      })),
    });

    await expect(
      runBackgroundImportDispatch(input({ capabilities: services.value })),
    ).rejects.toThrow("Background import processing failed");
    expect(services.repository.recordProcessingFailure).toHaveBeenCalledOnce();
    expect(services.repository.activatePreparedResult).not.toHaveBeenCalled();
  });
  it("bounds leases and rejects invalid dispatch identities", async () => {
    await expect(
      runBackgroundImportDispatch(
        input({ leaseDurationMilliseconds: 60 * 60 * 1000 + 1 }),
      ),
    ).rejects.toThrow("leaseDurationMilliseconds");
    await expect(
      runBackgroundImportDispatch(input({ dispatchId: "../unsafe" })),
    ).rejects.toThrow("dispatchId");
  });
});
