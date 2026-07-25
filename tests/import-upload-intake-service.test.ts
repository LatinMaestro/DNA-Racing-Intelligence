import { describe, expect, it, vi } from "vitest";

import {
  beginPrivateImportUpload,
  type ImportUploadCandidate,
  type ImportUploadIntakeCapabilities,
  unavailableImportUploadIntakeCapabilities,
} from "../lib/import-upload-intake-service";

const SHA_A = "a".repeat(64);
const SHA_B = "b".repeat(64);
const NOW = new Date("2026-07-26T00:00:00.000Z");

function candidate(
  overrides: Partial<ImportUploadCandidate> = {},
): ImportUploadCandidate {
  return {
    clientFileId: "file-1",
    sourceFamily: "race_merge",
    originalFileName: "race-export.csv",
    contentType: "text/csv; charset=windows-1252",
    byteLength: 1024,
    sha256: SHA_A,
    ...overrides,
  };
}

function readyCapabilities(): {
  capabilities: ImportUploadIntakeCapabilities;
  reserveUploadBatch: ReturnType<typeof vi.fn>;
  assertWithinApprovedCapacity: ReturnType<typeof vi.fn>;
  createDirectUploadTarget: ReturnType<typeof vi.fn>;
  markUploadTargetsReady: ReturnType<typeof vi.fn>;
  markUploadReservationFailed: ReturnType<typeof vi.fn>;
} {
  const reserveUploadBatch = vi.fn(async ({ files }) => ({
    disposition: "created" as const,
    uploadBatchId: "batch-1",
    files: files.map((file: ImportUploadCandidate, index: number) => ({
      clientFileId: file.clientFileId,
      uploadFileId: `upload-${index + 1}`,
    })),
  }));
  const assertWithinApprovedCapacity = vi.fn(async () => undefined);
  const createDirectUploadTarget = vi.fn(async ({ uploadFileId }) => ({
    method: "PUT" as const,
    targetToken: `opaque:${String(uploadFileId)}`,
  }));
  const markUploadTargetsReady = vi.fn(async () => undefined);
  const markUploadReservationFailed = vi.fn(async () => undefined);
  return {
    capabilities: {
      status: "ready",
      repository: {
        reserveUploadBatch,
        markUploadTargetsReady,
        markUploadReservationFailed,
      },
      capacityGate: { assertWithinApprovedCapacity },
      privateObjectStore: { createDirectUploadTarget },
    },
    reserveUploadBatch,
    assertWithinApprovedCapacity,
    createDirectUploadTarget,
    markUploadTargetsReady,
    markUploadReservationFailed,
  };
}

const baseInput = {
  authenticatedOwnerId: "owner-1",
  configuredOwnerId: "owner-1",
  idempotencyKey: "request-1",
  files: [candidate()],
  now: NOW,
  targetLifetimeMilliseconds: 15 * 60 * 1000,
} as const;

describe("beginPrivateImportUpload", () => {
  it("fails closed before any provider is configured", async () => {
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: unavailableImportUploadIntakeCapabilities,
      }),
    ).resolves.toEqual({ status: "not_configured" });
  });

  it("requires an exact authenticated owner before provider access", async () => {
    const ready = readyCapabilities();
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        authenticatedOwnerId: "other-owner",
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("access denied");
    expect(ready.assertWithinApprovedCapacity).not.toHaveBeenCalled();
    expect(ready.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("permits grouped sequential Race Merge candidates", async () => {
    const ready = readyCapabilities();
    const result = await beginPrivateImportUpload({
      ...baseInput,
      files: [
        candidate(),
        candidate({
          clientFileId: "file-2",
          originalFileName: "next-race-export.CSV",
          byteLength: 2048,
          sha256: SHA_B,
        }),
      ],
      capabilities: ready.capabilities,
    });
    expect(result).toMatchObject({
      status: "ready",
      uploadBatchId: "batch-1",
      targets: [
        { clientFileId: "file-1", uploadFileId: "upload-1" },
        { clientFileId: "file-2", uploadFileId: "upload-2" },
      ],
    });
    expect(ready.assertWithinApprovedCapacity).toHaveBeenCalledWith({
      ownerId: "owner-1",
      fileCount: 2,
      totalByteLength: 3072,
      sourceFamilies: ["race_merge", "race_merge"],
    });
  });

  it("rejects competing replacement snapshots before capacity or persistence", async () => {
    const ready = readyCapabilities();
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files: [
          candidate({
            clientFileId: "vault-1",
            sourceFamily: "current_vault",
            originalFileName: "vault-a.csv",
          }),
          candidate({
            clientFileId: "vault-2",
            sourceFamily: "current_vault",
            originalFileName: "vault-b.csv",
            sha256: SHA_B,
          }),
        ],
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("one replacement candidate");
    expect(ready.assertWithinApprovedCapacity).not.toHaveBeenCalled();
    expect(ready.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it.each([
    [{ originalFileName: "../private.csv" }, "originalFileName"],
    [{ contentType: "application/pdf" }, "contentType"],
    [{ byteLength: 0 }, "byteLength"],
    [{ sha256: "ABC" }, "sha256"],
  ])("rejects malformed candidate metadata %#", async (change, message) => {
    const ready = readyCapabilities();
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files: [candidate(change)],
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow(message);
    expect(ready.assertWithinApprovedCapacity).not.toHaveBeenCalled();
  });

  it("applies the capacity gate before reserving durable state", async () => {
    const ready = readyCapabilities();
    ready.assertWithinApprovedCapacity.mockRejectedValueOnce(
      new Error("capacity unavailable"),
    );
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("capacity unavailable");
    expect(ready.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("preserves durable idempotent replay disposition", async () => {
    const ready = readyCapabilities();
    ready.reserveUploadBatch.mockResolvedValueOnce({
      disposition: "existing",
      uploadBatchId: "batch-existing",
      files: [{ clientFileId: "file-1", uploadFileId: "upload-existing" }],
    });
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).resolves.toMatchObject({
      status: "ready",
      disposition: "existing",
      uploadBatchId: "batch-existing",
      targets: [{ uploadFileId: "upload-existing" }],
    });
  });

  it("marks the reservation failed when any private target is unavailable", async () => {
    const ready = readyCapabilities();
    ready.createDirectUploadTarget.mockRejectedValueOnce(
      new Error("provider unavailable"),
    );
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("target creation failed");
    expect(ready.markUploadTargetsReady).not.toHaveBeenCalled();
    expect(ready.markUploadReservationFailed).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      failedAt: NOW.toISOString(),
      reason: "private_object_target_unavailable",
    });
  });

  it("rejects an inconsistent reservation identity set", async () => {
    const ready = readyCapabilities();
    ready.reserveUploadBatch.mockResolvedValueOnce({
      disposition: "created",
      uploadBatchId: "batch-1",
      files: [{ clientFileId: "unknown-file", uploadFileId: "upload-1" }],
    });
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("identity set is inconsistent");
    expect(ready.createDirectUploadTarget).not.toHaveBeenCalled();
    expect(ready.markUploadReservationFailed).toHaveBeenCalledWith({
      ownerId: "owner-1",
      uploadBatchId: "batch-1",
      failedAt: NOW.toISOString(),
      reason: "private_object_target_unavailable",
    });
  });
});
