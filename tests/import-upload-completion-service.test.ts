import { describe, expect, it, vi } from "vitest";

import {
  completePrivateImportUpload,
  type ImportUploadCompletionCapabilities,
  type ImportPreviewQueue,
  type PrivateUploadedObjectInspector,
  type UploadCompletionClaim,
  unavailableImportUploadCompletionCapabilities,
} from "../lib/import-upload-completion-service";

const NOW = new Date("2026-07-26T01:00:00.000Z");
const SHA = "a".repeat(64);
const UPLOAD_FINGERPRINT = "c".repeat(64);
const UPLOAD_EXPIRES_AT = "2026-07-26T01:30:00.000Z";
const PRIVATE_OBJECT_IDENTITY = {
  scope: "private_owner" as const,
  ownerId: "owner-1",
  uploadBatchId: "batch-1",
  uploadFileId: "file-1",
  objectId: "object-1",
};

function readyCapabilities() {
  const claimUploadCompletion = vi.fn(
    async (): Promise<UploadCompletionClaim> => ({
      status: "claimed",
      completionId: "completion-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
      uploadTargetExpiresAt: UPLOAD_EXPIRES_AT,
      files: [
        {
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "race_merge",
          expectedByteLength: 1024,
          expectedSha256: SHA,
          expectedContentType: "text/csv",
        },
      ],
    }),
  );
  const inspectObject = vi.fn(
    async (): Promise<
      Awaited<ReturnType<PrivateUploadedObjectInspector["inspectObject"]>>
    > => ({
      status: "ready",
      ...PRIVATE_OBJECT_IDENTITY,
      objectVersion: "version-1",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv; charset=utf-8",
      providerSha256: SHA,
    }),
  );
  const reservePreviewDispatch = vi.fn(async () => ({
    previewDispatchId: "preview-dispatch-1",
    disposition: "created" as const,
    dispatchState: "pending" as const,
    uploadRequestFingerprint: UPLOAD_FINGERPRINT,
  }));
  const enqueue = vi.fn(
    async (): Promise<Awaited<ReturnType<ImportPreviewQueue["enqueue"]>>> => ({
      disposition: "created",
      previewDispatchId: "preview-dispatch-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
    }),
  );
  const markPreviewDispatchQueued = vi.fn(async () => undefined);
  const markPreviewDispatchFailed = vi.fn(async () => undefined);
  const recordUploadVerificationFailure = vi.fn(async () => undefined);
  const capabilities: ImportUploadCompletionCapabilities = {
    status: "ready",
    repository: {
      claimUploadCompletion,
      reservePreviewDispatch,
      markPreviewDispatchQueued,
      markPreviewDispatchFailed,
      recordUploadVerificationFailure,
    },
    objectInspector: { inspectObject },
    previewQueue: { enqueue },
  };
  return {
    capabilities,
    claimUploadCompletion,
    inspectObject,
    reservePreviewDispatch,
    enqueue,
    markPreviewDispatchQueued,
    markPreviewDispatchFailed,
    recordUploadVerificationFailure,
  };
}

const baseInput = {
  authenticatedOwnerId: "owner-1",
  configuredOwnerId: "owner-1",
  uploadBatchId: "batch-1",
  idempotencyKey: "complete-1",
  uploadRequestFingerprint: UPLOAD_FINGERPRINT,
  now: NOW,
} as const;

describe("completePrivateImportUpload", () => {
  it("fails closed without configured capabilities", async () => {
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: unavailableImportUploadCompletionCapabilities,
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("requires the exact owner before persistence or object inspection", async () => {
    const ready = readyCapabilities();
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        authenticatedOwnerId: "other-owner",
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("access denied");
    expect(ready.claimUploadCompletion).not.toHaveBeenCalled();
    expect(ready.inspectObject).not.toHaveBeenCalled();
  });

  it("queues preview after private object metadata agrees", async () => {
    const ready = readyCapabilities();
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "queued_for_preview",
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-dispatch-1",
      disposition: "created",
      fileCount: 1,
    });
    expect(ready.reservePreviewDispatch).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      completionId: "completion-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
      verifiedAt: NOW.toISOString(),
      files: [
        {
          objectVersion: "version-1",
          advertisedByteLength: 1024,
          advertisedContentType: "text/csv",
          providerSha256: SHA,
          ...PRIVATE_OBJECT_IDENTITY,
        },
      ],
    });
    expect(ready.enqueue).toHaveBeenCalledOnce();
    expect(ready.markPreviewDispatchQueued).toHaveBeenCalledOnce();
  });

  it("keeps a partially uploaded batch pending without scheduling preview", async () => {
    const ready = readyCapabilities();
    ready.inspectObject.mockResolvedValueOnce({ status: "missing" });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "uploads_pending",
      uploadBatchId: "batch-1",
      missingUploadFileIds: ["file-1"],
    });
    expect(ready.reservePreviewDispatch).not.toHaveBeenCalled();
    expect(ready.enqueue).not.toHaveBeenCalled();
    expect(ready.recordUploadVerificationFailure).not.toHaveBeenCalled();
  });

  it.each([
    [
      {
        status: "ready" as const,
        ...PRIVATE_OBJECT_IDENTITY,
        scope: "public" as const,
        objectVersion: "version-1",
        advertisedByteLength: 1024,
        advertisedContentType: "text/csv",
        providerSha256: SHA,
      },
      "private_scope_violation",
    ],
    [
      {
        status: "ready" as const,
        ...PRIVATE_OBJECT_IDENTITY,
        objectVersion: "version-1",
        advertisedByteLength: 1025,
        advertisedContentType: "text/csv",
        providerSha256: SHA,
      },
      "object_metadata_mismatch",
    ],
    [
      {
        status: "ready" as const,
        ...PRIVATE_OBJECT_IDENTITY,
        objectVersion: "version-1",
        advertisedByteLength: 1024,
        advertisedContentType: "text/csv",
        providerSha256: "b".repeat(64),
      },
      "object_metadata_mismatch",
    ],
  ])(
    "blocks unsafe or inconsistent object evidence %#",
    async (inspection, reason) => {
      const ready = readyCapabilities();
      ready.inspectObject.mockResolvedValueOnce(inspection);
      await expect(
        completePrivateImportUpload({
          ...baseInput,
          capabilities: ready.capabilities,
        }),
      ).rejects.toThrow("verification failed");
      expect(ready.recordUploadVerificationFailure).toHaveBeenCalledWith({
        ownerId: "owner-1",
        uploadBatchId: "batch-1",
        completionId: "completion-1",
        failedAt: NOW.toISOString(),
        reason,
      });
      expect(ready.reservePreviewDispatch).not.toHaveBeenCalled();
    },
  );

  it("allows provider checksum metadata to be absent for later stream verification", async () => {
    const ready = readyCapabilities();
    ready.inspectObject.mockResolvedValueOnce({
      status: "ready",
      ...PRIVATE_OBJECT_IDENTITY,
      objectVersion: "version-1",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv",
      providerSha256: null,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toMatchObject({ status: "queued_for_preview" });
    expect(ready.reservePreviewDispatch).toHaveBeenCalledWith(
      expect.objectContaining({
        files: [
          expect.objectContaining({
            providerSha256: null,
          }),
        ],
      }),
    );
  });

  it("replays an already queued completion without provider access", async () => {
    const ready = readyCapabilities();
    ready.claimUploadCompletion.mockResolvedValueOnce({
      status: "already_queued",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
      previewDispatchId: "preview-dispatch-existing",
      fileCount: 2,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "queued_for_preview",
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-dispatch-existing",
      disposition: "existing",
      fileCount: 2,
    });
    expect(ready.inspectObject).not.toHaveBeenCalled();
    expect(ready.enqueue).not.toHaveBeenCalled();
  });

  it("rejects a stored completion bound to a different upload request", async () => {
    const ready = readyCapabilities();
    ready.claimUploadCompletion.mockResolvedValueOnce({
      status: "already_queued",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: "d".repeat(64),
      previewDispatchId: "preview-dispatch-existing",
      fileCount: 1,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("inconsistent");
    expect(ready.inspectObject).not.toHaveBeenCalled();
    expect(ready.enqueue).not.toHaveBeenCalled();
  });

  it("holds an expired upload reservation before object access", async () => {
    const ready = readyCapabilities();
    ready.claimUploadCompletion.mockResolvedValueOnce({
      status: "claimed",
      completionId: "completion-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
      uploadTargetExpiresAt: NOW.toISOString(),
      files: [],
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "upload_expired",
      uploadBatchId: "batch-1",
    });
    expect(ready.inspectObject).not.toHaveBeenCalled();
    expect(ready.recordUploadVerificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "upload_target_expired" }),
    );
  });

  it("rejects cross-owner object identity even when metadata agrees", async () => {
    const ready = readyCapabilities();
    ready.inspectObject.mockResolvedValueOnce({
      status: "ready",
      ...PRIVATE_OBJECT_IDENTITY,
      ownerId: "other-owner",
      objectVersion: "version-1",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv",
      providerSha256: SHA,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("verification failed");
    expect(ready.recordUploadVerificationFailure).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "private_scope_violation" }),
    );
    expect(ready.reservePreviewDispatch).not.toHaveBeenCalled();
  });

  it("rejects a queue acknowledgement for another durable dispatch", async () => {
    const ready = readyCapabilities();
    ready.enqueue.mockResolvedValueOnce({
      disposition: "existing",
      previewDispatchId: "preview-dispatch-other",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("preview dispatch failed");
    expect(ready.markPreviewDispatchFailed).toHaveBeenCalledOnce();
    expect(ready.markPreviewDispatchQueued).not.toHaveBeenCalled();
  });

  it("records a retryable queue failure without claiming preview readiness", async () => {
    const ready = readyCapabilities();
    ready.enqueue.mockRejectedValueOnce(new Error("queue unavailable"));
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("preview dispatch failed");
    expect(ready.markPreviewDispatchFailed).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      previewDispatchId: "preview-dispatch-1",
      failedAt: NOW.toISOString(),
      reason: "preview_queue_unavailable",
    });
    expect(ready.markPreviewDispatchQueued).not.toHaveBeenCalled();
  });

  it("records object-store unavailability without exposing provider details", async () => {
    const ready = readyCapabilities();
    ready.inspectObject.mockRejectedValueOnce(
      new Error("private provider detail"),
    );
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("temporarily unavailable");
    expect(ready.recordUploadVerificationFailure).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      completionId: "completion-1",
      failedAt: NOW.toISOString(),
      reason: "object_store_unavailable",
    });
  });

  it("fails closed on malformed durable source or object metadata", async () => {
    const malformedSource = readyCapabilities();
    malformedSource.claimUploadCompletion.mockResolvedValueOnce({
      status: "claimed",
      completionId: "completion-1",
      uploadRequestFingerprint: UPLOAD_FINGERPRINT,
      uploadTargetExpiresAt: UPLOAD_EXPIRES_AT,
      files: [
        {
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "unsupported" as "race_merge",
          expectedByteLength: 1024,
          expectedSha256: SHA,
          expectedContentType: "text/csv",
        },
      ],
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: malformedSource.capabilities,
      }),
    ).rejects.toThrow("sourceFamily");
    expect(malformedSource.inspectObject).not.toHaveBeenCalled();

    const malformedObject = readyCapabilities();
    malformedObject.inspectObject.mockResolvedValueOnce({
      status: "ready",
      ...PRIVATE_OBJECT_IDENTITY,
      objectVersion: "version-\nprivate-provider-value",
      advertisedByteLength: 1024,
      advertisedContentType: "text/csv",
      providerSha256: SHA,
    });
    await expect(
      completePrivateImportUpload({
        ...baseInput,
        capabilities: malformedObject.capabilities,
      }),
    ).rejects.toThrow("verification failed");
    expect(
      malformedObject.recordUploadVerificationFailure,
    ).toHaveBeenCalledWith(
      expect.objectContaining({ reason: "object_metadata_mismatch" }),
    );
  });
});
