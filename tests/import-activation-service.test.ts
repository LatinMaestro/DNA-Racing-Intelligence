import { describe, expect, it, vi } from "vitest";
import {
  activateConfirmedDataUpdate,
  unavailableImportActivationCapabilities,
  type BackgroundImportQueue,
  type ImportActivationCapabilities,
  type ImportActivationRepository,
  type ImportCapacityGate,
  type PrivateRawUploadStore,
} from "@/lib/import-activation-service";

const fingerprint = "a".repeat(64);
const now = new Date("2026-07-24T04:00:00.000Z");

function readyCapabilities(
  overrides: Partial<{
    repository: ImportActivationRepository;
    rawUploadStore: PrivateRawUploadStore;
    capacityGate: ImportCapacityGate;
    backgroundQueue: BackgroundImportQueue;
  }> = {},
): ImportActivationCapabilities {
  return {
    repository: {
      status: "ready",
      service:
        overrides.repository ??
        ({
          reserveConfirmedUpdate: vi.fn(async () => ({
            updateSessionId: "synthetic-session",
            dispatchId: "synthetic-dispatch",
            disposition: "created" as const,
            dispatchState: "pending" as const,
          })),
          markDispatchQueued: vi.fn(async () => undefined),
          markDispatchFailed: vi.fn(async () => undefined),
        } satisfies ImportActivationRepository),
    },
    rawUploadStore: {
      status: "ready",
      service:
        overrides.rawUploadStore ??
        ({
          assertPreviewUploadsReady: vi.fn(async () => undefined),
        } satisfies PrivateRawUploadStore),
    },
    capacityGate: {
      status: "ready",
      service:
        overrides.capacityGate ??
        ({
          assertWithinApprovedCapacity: vi.fn(async () => undefined),
        } satisfies ImportCapacityGate),
    },
    backgroundQueue: {
      status: "ready",
      service:
        overrides.backgroundQueue ??
        ({
          enqueue: vi.fn(async () => undefined),
        } satisfies BackgroundImportQueue),
    },
  };
}

function activationInput(
  overrides: Partial<Parameters<typeof activateConfirmedDataUpdate>[0]> = {},
): Parameters<typeof activateConfirmedDataUpdate>[0] {
  return {
    authenticatedOwnerId: "owner",
    configuredOwnerId: "owner",
    previewId: "synthetic-preview",
    previewFingerprintSha256: fingerprint,
    idempotencyKey: "synthetic-confirmation",
    explicitlyConfirmed: true,
    capabilities: readyCapabilities(),
    now,
    ...overrides,
  };
}

describe("guarded data-update activation", () => {
  it("returns an identity state before inspecting infrastructure", async () => {
    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          authenticatedOwnerId: null,
          capabilities: unavailableImportActivationCapabilities,
        }),
      ),
    ).resolves.toEqual({ status: "identity_not_connected" });
  });

  it("denies a non-owner before calling any capability", async () => {
    const capacityGate = {
      assertWithinApprovedCapacity: vi.fn(async () => undefined),
    };
    const capabilities = readyCapabilities({ capacityGate });

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          authenticatedOwnerId: "other-owner",
          capabilities,
        }),
      ),
    ).rejects.toThrow("access denied");
    expect(capacityGate.assertWithinApprovedCapacity).not.toHaveBeenCalled();
  });

  it("reports every missing capability without attempting activation", async () => {
    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          capabilities: unavailableImportActivationCapabilities,
        }),
      ),
    ).resolves.toEqual({
      status: "not_configured",
      missingCapabilities: [
        "repository",
        "raw_upload_store",
        "capacity_gate",
        "background_queue",
      ],
    });
  });

  it("requires explicit owner confirmation", async () => {
    await expect(
      activateConfirmedDataUpdate(
        activationInput({ explicitlyConfirmed: false }),
      ),
    ).rejects.toThrow("Explicit owner confirmation");
  });

  it("requires a literal Boolean confirmation before any capability call", async () => {
    const capacityGate = {
      assertWithinApprovedCapacity: vi.fn(async () => undefined),
    };
    const capabilities = readyCapabilities({ capacityGate });

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          explicitlyConfirmed: "true" as unknown as boolean,
          capabilities,
        }),
      ),
    ).rejects.toThrow("Explicit owner confirmation");
    expect(capacityGate.assertWithinApprovedCapacity).not.toHaveBeenCalled();
  });

  it("gates capacity and raw objects before reserving and dispatching work", async () => {
    const calls: string[] = [];
    const repository: ImportActivationRepository = {
      reserveConfirmedUpdate: vi.fn(async () => {
        calls.push("reserve");
        return {
          updateSessionId: "synthetic-session",
          dispatchId: "synthetic-dispatch",
          disposition: "created" as const,
          dispatchState: "pending" as const,
        };
      }),
      markDispatchQueued: vi.fn(async () => {
        calls.push("mark-queued");
      }),
      markDispatchFailed: vi.fn(async () => {
        calls.push("mark-failed");
      }),
    };
    const capabilities = readyCapabilities({
      repository,
      capacityGate: {
        assertWithinApprovedCapacity: vi.fn(async () => {
          calls.push("capacity");
        }),
      },
      rawUploadStore: {
        assertPreviewUploadsReady: vi.fn(async () => {
          calls.push("raw-ready");
        }),
      },
      backgroundQueue: {
        enqueue: vi.fn(async () => {
          calls.push("enqueue");
        }),
      },
    });

    await expect(
      activateConfirmedDataUpdate(activationInput({ capabilities })),
    ).resolves.toEqual({
      status: "queued",
      updateSessionId: "synthetic-session",
      dispatchId: "synthetic-dispatch",
      disposition: "created",
    });
    expect(calls).toEqual([
      "capacity",
      "raw-ready",
      "reserve",
      "enqueue",
      "mark-queued",
    ]);
    expect(repository.reserveConfirmedUpdate).toHaveBeenCalledWith({
      ownerId: "owner",
      previewId: "synthetic-preview",
      previewFingerprintSha256: fingerprint,
      idempotencyKey: "synthetic-confirmation",
      confirmedAt: now.toISOString(),
    });
  });

  it("does not dispatch an idempotent reservation that is already queued", async () => {
    const enqueue = vi.fn(async () => undefined);
    const repository: ImportActivationRepository = {
      reserveConfirmedUpdate: vi.fn(async () => ({
        updateSessionId: "existing-session",
        dispatchId: "existing-dispatch",
        disposition: "existing" as const,
        dispatchState: "queued" as const,
      })),
      markDispatchQueued: vi.fn(async () => undefined),
      markDispatchFailed: vi.fn(async () => undefined),
    };

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          capabilities: readyCapabilities({
            repository,
            backgroundQueue: { enqueue },
          }),
        }),
      ),
    ).resolves.toMatchObject({
      status: "queued",
      disposition: "existing",
    });
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.markDispatchQueued).not.toHaveBeenCalled();
  });

  it("records a retryable dispatch failure without activating data", async () => {
    const markDispatchFailed = vi.fn(async () => undefined);
    const repository: ImportActivationRepository = {
      reserveConfirmedUpdate: vi.fn(async () => ({
        updateSessionId: "synthetic-session",
        dispatchId: "synthetic-dispatch",
        disposition: "created" as const,
        dispatchState: "pending" as const,
      })),
      markDispatchQueued: vi.fn(async () => undefined),
      markDispatchFailed,
    };

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          capabilities: readyCapabilities({
            repository,
            backgroundQueue: {
              enqueue: vi.fn(async () => {
                throw new Error("synthetic outage");
              }),
            },
          }),
        }),
      ),
    ).rejects.toThrow("Background import dispatch failed");
    expect(markDispatchFailed).toHaveBeenCalledWith({
      ownerId: "owner",
      updateSessionId: "synthetic-session",
      dispatchId: "synthetic-dispatch",
      failedAt: now.toISOString(),
      reason: "queue_unavailable",
    });
    expect(repository.markDispatchQueued).not.toHaveBeenCalled();
  });

  it("rejects malformed reservation evidence before queue dispatch", async () => {
    const enqueue = vi.fn(async () => undefined);
    const repository: ImportActivationRepository = {
      reserveConfirmedUpdate: vi.fn(async () => ({
        updateSessionId: "",
        dispatchId: "synthetic-dispatch",
        disposition: "created" as const,
        dispatchState: "pending" as const,
      })),
      markDispatchQueued: vi.fn(async () => undefined),
      markDispatchFailed: vi.fn(async () => undefined),
    };

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          capabilities: readyCapabilities({
            repository,
            backgroundQueue: { enqueue },
          }),
        }),
      ),
    ).rejects.toThrow("reservation.updateSessionId is invalid");
    expect(enqueue).not.toHaveBeenCalled();
    expect(repository.markDispatchQueued).not.toHaveBeenCalled();
  });

  it("rejects unbound confirmation inputs before any capability call", async () => {
    const capacityGate = {
      assertWithinApprovedCapacity: vi.fn(async () => undefined),
    };
    const capabilities = readyCapabilities({ capacityGate });

    await expect(
      activateConfirmedDataUpdate(
        activationInput({
          previewFingerprintSha256: "not-a-fingerprint",
          capabilities,
        }),
      ),
    ).rejects.toThrow("previewFingerprintSha256");
    expect(capacityGate.assertWithinApprovedCapacity).not.toHaveBeenCalled();
  });
});
