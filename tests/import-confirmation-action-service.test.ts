import { describe, expect, it, vi } from "vitest";

import type {
  BackgroundImportQueue,
  ImportActivationCapabilities,
  ImportActivationRepository,
  ImportCapacityGate,
  PrivateRawUploadStore,
} from "../lib/import-activation-service";
import {
  confirmOwnerDataUpdate,
  type ImportConfirmationActionDependencies,
} from "../lib/import-confirmation-action-service";

const fingerprint = "a".repeat(64);

function readyCapabilities() {
  const reserveConfirmedUpdate = vi.fn<
    ImportActivationRepository["reserveConfirmedUpdate"]
  >(async () => ({
    updateSessionId: "update-session-1",
    dispatchId: "dispatch-1",
    disposition: "created",
    dispatchState: "pending",
  }));
  const markDispatchQueued = vi.fn<
    ImportActivationRepository["markDispatchQueued"]
  >(async () => undefined);
  const markDispatchFailed = vi.fn<
    ImportActivationRepository["markDispatchFailed"]
  >(async () => undefined);
  const assertPreviewUploadsReady = vi.fn<
    PrivateRawUploadStore["assertPreviewUploadsReady"]
  >(async () => undefined);
  const assertWithinApprovedCapacity = vi.fn<
    ImportCapacityGate["assertWithinApprovedCapacity"]
  >(async () => undefined);
  const enqueue = vi.fn<BackgroundImportQueue["enqueue"]>(
    async () => undefined,
  );
  return {
    value: {
      repository: {
        status: "ready",
        service: {
          reserveConfirmedUpdate,
          markDispatchQueued,
          markDispatchFailed,
        },
      },
      rawUploadStore: {
        status: "ready",
        service: { assertPreviewUploadsReady },
      },
      capacityGate: {
        status: "ready",
        service: { assertWithinApprovedCapacity },
      },
      backgroundQueue: {
        status: "ready",
        service: { enqueue },
      },
    } satisfies ImportActivationCapabilities,
    reserveConfirmedUpdate,
    markDispatchQueued,
    markDispatchFailed,
    assertPreviewUploadsReady,
    assertWithinApprovedCapacity,
    enqueue,
  };
}

function dependencies(
  capabilities: ImportActivationCapabilities,
  ownerId: string | null = "owner-1",
): ImportConfirmationActionDependencies {
  return {
    resolveAuthenticatedOwnerId: vi.fn(async () => ownerId),
    configuredOwnerId: "owner-1",
    now: () => new Date("2026-07-26T07:00:00.000Z"),
    activationCapabilities: capabilities,
  };
}

function input(
  overrides: Partial<Parameters<typeof confirmOwnerDataUpdate>[0]> = {},
) {
  return {
    previewId: "preview-1",
    previewFingerprintSha256: fingerprint,
    idempotencyKey: "confirm-1",
    explicitlyConfirmed: true,
    ...overrides,
  };
}

describe("import confirmation owner action", () => {
  it("keeps a signed-out session disconnected before provider access", async () => {
    const capabilities = readyCapabilities();

    await expect(
      confirmOwnerDataUpdate(input(), dependencies(capabilities.value, null)),
    ).resolves.toEqual({ status: "identity_not_connected" });

    expect(capabilities.reserveConfirmedUpdate).not.toHaveBeenCalled();
    expect(capabilities.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a non-owner before provider access", async () => {
    const capabilities = readyCapabilities();

    await expect(
      confirmOwnerDataUpdate(
        input(),
        dependencies(capabilities.value, "other-owner"),
      ),
    ).rejects.toThrow("access denied");

    expect(capabilities.reserveConfirmedUpdate).not.toHaveBeenCalled();
    expect(capabilities.enqueue).not.toHaveBeenCalled();
  });

  it("reports every unavailable activation capability", async () => {
    await expect(
      confirmOwnerDataUpdate(
        input(),
        dependencies({
          repository: { status: "not_configured" },
          rawUploadStore: { status: "not_configured" },
          capacityGate: { status: "not_configured" },
          backgroundQueue: { status: "not_configured" },
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

  it("requires explicit owner confirmation before reservation", async () => {
    const capabilities = readyCapabilities();

    await expect(
      confirmOwnerDataUpdate(
        input({ explicitlyConfirmed: false }),
        dependencies(capabilities.value),
      ),
    ).rejects.toThrow("Explicit owner confirmation");

    expect(capabilities.reserveConfirmedUpdate).not.toHaveBeenCalled();
    expect(capabilities.enqueue).not.toHaveBeenCalled();
  });

  it("forwards authenticated confirmation to the guarded activation service", async () => {
    const capabilities = readyCapabilities();

    await expect(
      confirmOwnerDataUpdate(input(), dependencies(capabilities.value)),
    ).resolves.toEqual({
      status: "queued",
      updateSessionId: "update-session-1",
      dispatchId: "dispatch-1",
      disposition: "created",
    });

    expect(capabilities.assertWithinApprovedCapacity).toHaveBeenCalledWith({
      ownerId: "owner-1",
      previewId: "preview-1",
    });
    expect(capabilities.assertPreviewUploadsReady).toHaveBeenCalledWith({
      ownerId: "owner-1",
      previewId: "preview-1",
      previewFingerprintSha256: fingerprint,
    });
    expect(capabilities.reserveConfirmedUpdate).toHaveBeenCalledWith({
      ownerId: "owner-1",
      previewId: "preview-1",
      previewFingerprintSha256: fingerprint,
      idempotencyKey: "confirm-1",
      confirmedAt: "2026-07-26T07:00:00.000Z",
    });
    expect(capabilities.enqueue).toHaveBeenCalledWith({
      ownerId: "owner-1",
      updateSessionId: "update-session-1",
      dispatchId: "dispatch-1",
    });
    expect(capabilities.markDispatchQueued).toHaveBeenCalledOnce();
  });
});
