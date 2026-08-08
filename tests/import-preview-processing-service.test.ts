import { describe, expect, it, vi } from "vitest";

import {
  runImportPreviewDispatch,
  type ImportPreviewDispatchClaim,
  type ImportPreviewProcessingCapabilities,
  type ImportPreviewProcessingRepository,
  type PreparedImportPreview,
  unavailableImportPreviewProcessingCapabilities,
} from "../lib/import-preview-processing-service";

const NOW = new Date("2026-07-26T02:00:00.000Z");
const MANIFEST_SHA = "a".repeat(64);
const PREVIEW_SHA = "b".repeat(64);
const FILE_SHA = "c".repeat(64);
const UPLOAD_REQUEST_SHA = "d".repeat(64);

function readyCapabilities() {
  const claimPreviewDispatch = vi.fn(
    async (): Promise<ImportPreviewDispatchClaim> => ({
      status: "claimed",
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      files: [
        {
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "race_merge",
          expectedByteLength: 1024,
          expectedSha256: FILE_SHA,
        },
      ],
    }),
  );
  const preparePreview = vi.fn(async (): Promise<PreparedImportPreview> => ({
    previewId: "preview-1",
    previewFingerprintSha256: PREVIEW_SHA,
    uploadManifestFingerprintSha256: MANIFEST_SHA,
    fileCount: 1,
    sourceFamilyCount: 1,
    blockingIssueCount: 0,
    confirmable: true,
  }));
  const publishPreparedPreview = vi.fn(
    async (): Promise<
      Awaited<
        ReturnType<ImportPreviewProcessingRepository["publishPreparedPreview"]>
      >
    > => ({
      disposition: "created",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      previewId: "preview-1",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: true,
    }),
  );
  const recordPreviewFailure = vi.fn(async () => undefined);
  const capabilities: ImportPreviewProcessingCapabilities = {
    status: "ready",
    repository: {
      claimPreviewDispatch,
      publishPreparedPreview,
      recordPreviewFailure,
    },
    processor: { preparePreview },
  };
  return {
    capabilities,
    claimPreviewDispatch,
    preparePreview,
    publishPreparedPreview,
    recordPreviewFailure,
  };
}

const baseInput = {
  previewDispatchId: "preview-dispatch-1",
  workerId: "worker-1",
  uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
  now: NOW,
  leaseDurationMilliseconds: 15 * 60 * 1000,
  maximumBatchBytes: 10 * 1024,
} as const;

describe("runImportPreviewDispatch", () => {
  it("fails closed before preview processing is configured", async () => {
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: unavailableImportPreviewProcessingCapabilities,
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("leases and publishes one manifest-bound deterministic preview", async () => {
    const ready = readyCapabilities();
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "completed",
      uploadBatchId: "batch-1",
      previewId: "preview-1",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: true,
      disposition: "created",
    });
    expect(ready.claimPreviewDispatch).toHaveBeenCalledWith({
      previewDispatchId: "preview-dispatch-1",
      workerId: "worker-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      claimedAt: NOW.toISOString(),
      leaseExpiresAt: "2026-07-26T02:15:00.000Z",
    });
    expect(ready.publishPreparedPreview).toHaveBeenCalledWith(
      expect.objectContaining({
        uploadManifestFingerprintSha256: MANIFEST_SHA,
        previewFingerprintSha256: PREVIEW_SHA,
        confirmable: true,
        blockingIssueCount: 0,
      }),
    );
  });

  it("returns not-found and competing-lease states without processing", async () => {
    const missing = readyCapabilities();
    missing.claimPreviewDispatch.mockResolvedValueOnce({
      status: "not_found",
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: missing.capabilities,
      }),
    ).resolves.toEqual({ status: "not_found" });
    expect(missing.preparePreview).not.toHaveBeenCalled();

    const leased = readyCapabilities();
    leased.claimPreviewDispatch.mockResolvedValueOnce({
      status: "leased_elsewhere",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      retryAfter: "2026-07-26T02:15:00.000Z",
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: leased.capabilities,
      }),
    ).resolves.toEqual({
      status: "leased_elsewhere",
      retryAfter: "2026-07-26T02:15:00.000Z",
    });
    expect(leased.preparePreview).not.toHaveBeenCalled();
  });

  it("replays an already published preview without processor access", async () => {
    const ready = readyCapabilities();
    ready.claimPreviewDispatch.mockResolvedValueOnce({
      status: "already_complete",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      previewId: "preview-existing",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: true,
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toEqual({
      status: "completed",
      uploadBatchId: "batch-1",
      previewId: "preview-existing",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: true,
      disposition: "existing",
    });
    expect(ready.preparePreview).not.toHaveBeenCalled();
    expect(ready.publishPreparedPreview).not.toHaveBeenCalled();
  });

  it("rejects a dispatch claimed for a different upload request", async () => {
    const ready = readyCapabilities();
    ready.claimPreviewDispatch.mockResolvedValueOnce({
      status: "claimed",
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: "e".repeat(64),
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      files: [
        {
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "race_merge",
          expectedByteLength: 1024,
          expectedSha256: FILE_SHA,
        },
      ],
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("fingerprint");
    expect(ready.preparePreview).not.toHaveBeenCalled();
  });

  it("enforces the approved batch byte boundary before processing", async () => {
    const ready = readyCapabilities();
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        maximumBatchBytes: 1023,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("capacity");
    expect(ready.preparePreview).not.toHaveBeenCalled();
  });

  it("records processor failure without publishing partial preview evidence", async () => {
    const ready = readyCapabilities();
    ready.preparePreview.mockRejectedValueOnce(new Error("private row detail"));
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("preview processing failed");
    expect(ready.recordPreviewFailure).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      previewDispatchId: "preview-dispatch-1",
      workerId: "worker-1",
      failedAt: NOW.toISOString(),
      reason: "preview_processor_failed",
    });
    expect(ready.publishPreparedPreview).not.toHaveBeenCalled();
  });

  it.each([
    {
      uploadManifestFingerprintSha256: "d".repeat(64),
    },
    {
      fileCount: 2,
    },
    {
      sourceFamilyCount: 2,
    },
    {
      blockingIssueCount: 1,
      confirmable: true,
    },
  ])("rejects inconsistent prepared preview evidence %#", async (change) => {
    const ready = readyCapabilities();
    ready.preparePreview.mockResolvedValueOnce({
      previewId: "preview-1",
      previewFingerprintSha256: PREVIEW_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      fileCount: 1,
      sourceFamilyCount: 1,
      blockingIssueCount: 0,
      confirmable: true,
      ...change,
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("preview processing failed");
    expect(ready.recordPreviewFailure).toHaveBeenCalledOnce();
    expect(ready.publishPreparedPreview).not.toHaveBeenCalled();
  });

  it("publishes a blocked preview without promoting it to confirmable", async () => {
    const ready = readyCapabilities();
    ready.preparePreview.mockResolvedValueOnce({
      previewId: "preview-blocked",
      previewFingerprintSha256: PREVIEW_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      fileCount: 1,
      sourceFamilyCount: 1,
      blockingIssueCount: 2,
      confirmable: false,
    });
    ready.publishPreparedPreview.mockResolvedValueOnce({
      disposition: "created",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      previewId: "preview-blocked",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: false,
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toMatchObject({
      status: "completed",
      previewId: "preview-blocked",
      confirmable: false,
    });
  });

  it("rejects publication acknowledgement drift", async () => {
    const ready = readyCapabilities();
    ready.publishPreparedPreview.mockResolvedValueOnce({
      disposition: "existing",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      previewId: "preview-other",
      previewFingerprintSha256: PREVIEW_SHA,
      confirmable: true,
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("publication state");
  });

  it("fails closed on unsafe durable manifest evidence before processing", async () => {
    const ready = readyCapabilities();
    ready.claimPreviewDispatch.mockResolvedValueOnce({
      status: "claimed",
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      uploadRequestFingerprint: UPLOAD_REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      files: [
        {
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "unsupported" as "race_merge",
          expectedByteLength: 1024,
          expectedSha256: FILE_SHA,
        },
      ],
    });
    await expect(
      runImportPreviewDispatch({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("sourceFamily");
    expect(ready.preparePreview).not.toHaveBeenCalled();
  });
});
