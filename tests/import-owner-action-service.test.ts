import { describe, expect, it, vi } from "vitest";

import {
  beginOwnerImportUpload,
  completeOwnerImportUpload,
  type ImportOwnerActionDependencies,
} from "../lib/import-owner-action-service";
import type {
  ImportUploadCandidate,
  ImportUploadIntakeCapabilities,
} from "../lib/import-upload-intake-service";
import { unavailableImportUploadIntakeCapabilities } from "../lib/import-upload-intake-service";
import type {
  ImportUploadCompletionCapabilities,
  ReservedImportUploadObject,
} from "../lib/import-upload-completion-service";
import { unavailableImportUploadCompletionCapabilities } from "../lib/import-upload-completion-service";

const NOW = new Date("2026-07-26T01:00:00.000Z");
const SHA_256 = "a".repeat(64);
const UPLOAD_REQUEST_SHA = "b".repeat(64);

const candidate: ImportUploadCandidate = {
  clientFileId: "client-file-1",
  sourceFamily: "race_merge",
  originalFileName: "synthetic-race-export.csv",
  contentType: "text/csv",
  byteLength: 2048,
  sha256: SHA_256,
};

function readyIntakeCapabilities(): {
  capabilities: ImportUploadIntakeCapabilities;
  reserveUploadBatch: ReturnType<typeof vi.fn>;
} {
  const reserveUploadBatch = vi.fn(
    async (input: { requestFingerprint: string }) => ({
      disposition: "created" as const,
      uploadBatchId: "upload-batch-1",
      requestFingerprint: input.requestFingerprint,
      files: [
        {
          clientFileId: "client-file-1",
          uploadFileId: "upload-file-1",
        },
      ],
    }),
  );
  return {
    capabilities: {
      status: "ready",
      repository: {
        reserveUploadBatch,
        markUploadTargetsReady: vi.fn(async () => undefined),
        markUploadReservationFailed: vi.fn(async () => undefined),
      },
      capacityGate: {
        assertWithinApprovedCapacity: vi.fn(async () => undefined),
      },
      privateObjectStore: {
        createDirectUploadTarget: vi.fn(async () => ({
          method: "PUT" as const,
          targetToken: "opaque-upload-target",
        })),
      },
    },
    reserveUploadBatch,
  };
}

function readyCompletionCapabilities(): {
  capabilities: ImportUploadCompletionCapabilities;
  claimUploadCompletion: ReturnType<typeof vi.fn>;
} {
  const file: ReservedImportUploadObject = {
    uploadFileId: "upload-file-1",
    objectId: "private-object-1",
    sourceFamily: "race_merge",
    expectedByteLength: 2048,
    expectedSha256: SHA_256,
    expectedContentType: "text/csv",
  };
  const claimUploadCompletion = vi.fn(async () => ({
    status: "claimed" as const,
    completionId: "completion-1",
    uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
    uploadTargetExpiresAt: "2026-07-26T01:15:00.000Z",
    files: [file],
  }));
  return {
    capabilities: {
      status: "ready",
      repository: {
        claimUploadCompletion,
        reservePreviewDispatch: vi.fn(async () => ({
          previewDispatchId: "preview-dispatch-1",
          disposition: "created" as const,
          dispatchState: "queued" as const,
          uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
        })),
        markPreviewDispatchQueued: vi.fn(async () => undefined),
        markPreviewDispatchFailed: vi.fn(async () => undefined),
        recordUploadVerificationFailure: vi.fn(async () => undefined),
      },
      objectInspector: {
        inspectObject: vi.fn(async () => ({
          status: "ready" as const,
          scope: "private_owner" as const,
          ownerId: "owner-1",
          uploadBatchId: "upload-batch-1",
          uploadFileId: "upload-file-1",
          objectId: "private-object-1",
          objectVersion: "version-1",
          advertisedByteLength: 2048,
          advertisedContentType: "text/csv",
          providerSha256: SHA_256,
        })),
      },
      previewQueue: {
        enqueue: vi.fn(async () => ({
          disposition: "created" as const,
          previewDispatchId: "preview-dispatch-1",
          uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
        })),
      },
    },
    claimUploadCompletion,
  };
}

function dependencies(
  overrides: Partial<ImportOwnerActionDependencies> = {},
): ImportOwnerActionDependencies {
  return {
    resolveAuthenticatedOwnerId: vi.fn(async () => "owner-1"),
    configuredOwnerId: "owner-1",
    now: () => NOW,
    uploadTargetLifetimeMilliseconds: 15 * 60 * 1000,
    uploadIntakeCapabilities: unavailableImportUploadIntakeCapabilities,
    uploadCompletionCapabilities: unavailableImportUploadCompletionCapabilities,
    ...overrides,
  };
}

describe("import owner action service", () => {
  it("resolves identity inside the upload action and never accepts a browser owner ID", async () => {
    const intake = readyIntakeCapabilities();
    const resolveAuthenticatedOwnerId = vi.fn(async () => "owner-1");

    await expect(
      beginOwnerImportUpload(
        { idempotencyKey: "request-1", files: [candidate] },
        dependencies({
          resolveAuthenticatedOwnerId,
          uploadIntakeCapabilities: intake.capabilities,
        }),
      ),
    ).resolves.toMatchObject({
      status: "ready",
      uploadBatchId: "upload-batch-1",
      targets: [{ uploadFileId: "upload-file-1" }],
    });

    expect(resolveAuthenticatedOwnerId).toHaveBeenCalledOnce();
    expect(intake.reserveUploadBatch).toHaveBeenCalledWith(
      expect.objectContaining({ ownerId: "owner-1" }),
    );
  });

  it("fails closed before provider access when the owner session is absent", async () => {
    const intake = readyIntakeCapabilities();

    await expect(
      beginOwnerImportUpload(
        { idempotencyKey: "request-1", files: [candidate] },
        dependencies({
          resolveAuthenticatedOwnerId: vi.fn(async () => null),
          uploadIntakeCapabilities: intake.capabilities,
        }),
      ),
    ).resolves.toEqual({ status: "identity_not_connected" });

    expect(intake.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("sanitizes owner-authentication failure before provider access", async () => {
    const intake = readyIntakeCapabilities();

    await expect(
      beginOwnerImportUpload(
        { idempotencyKey: "request-1", files: [candidate] },
        dependencies({
          resolveAuthenticatedOwnerId: vi.fn(async () => {
            throw new Error("provider token detail");
          }),
          uploadIntakeCapabilities: intake.capabilities,
        }),
      ),
    ).rejects.toThrow("Owner authentication is unavailable.");

    expect(intake.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("denies a non-owner before upload persistence", async () => {
    const intake = readyIntakeCapabilities();

    await expect(
      beginOwnerImportUpload(
        { idempotencyKey: "request-1", files: [candidate] },
        dependencies({
          resolveAuthenticatedOwnerId: vi.fn(async () => "other-owner"),
          uploadIntakeCapabilities: intake.capabilities,
        }),
      ),
    ).rejects.toThrow("access denied");

    expect(intake.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("preserves the explicit provider-not-configured state", async () => {
    await expect(
      beginOwnerImportUpload(
        { idempotencyKey: "request-1", files: [candidate] },
        dependencies(),
      ),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("resolves identity again for upload completion and queues the exact owner batch", async () => {
    const completion = readyCompletionCapabilities();
    const resolveAuthenticatedOwnerId = vi.fn(async () => "owner-1");

    await expect(
      completeOwnerImportUpload(
        {
          uploadBatchId: "upload-batch-1",
          idempotencyKey: "complete-request-1",
          uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
        },
        dependencies({
          resolveAuthenticatedOwnerId,
          uploadCompletionCapabilities: completion.capabilities,
        }),
      ),
    ).resolves.toEqual({
      status: "queued_for_preview",
      uploadBatchId: "upload-batch-1",
      previewDispatchId: "preview-dispatch-1",
      disposition: "created",
      fileCount: 1,
    });

    expect(resolveAuthenticatedOwnerId).toHaveBeenCalledOnce();
    expect(completion.claimUploadCompletion).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "upload-batch-1",
      idempotencyKey: "complete-request-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      claimedAt: NOW.toISOString(),
    });
  });

  it("denies a non-owner before upload-completion persistence", async () => {
    const completion = readyCompletionCapabilities();

    await expect(
      completeOwnerImportUpload(
        {
          uploadBatchId: "upload-batch-1",
          idempotencyKey: "complete-request-1",
          uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
        },
        dependencies({
          resolveAuthenticatedOwnerId: vi.fn(async () => "other-owner"),
          uploadCompletionCapabilities: completion.capabilities,
        }),
      ),
    ).rejects.toThrow("access denied");

    expect(completion.claimUploadCompletion).not.toHaveBeenCalled();
  });
});
