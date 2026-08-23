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
  const reserveUploadBatch = vi.fn(async ({ files, requestFingerprint }) => ({
    disposition: "created" as const,
    uploadBatchId: "batch-1",
    requestFingerprint,
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
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
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

  it("accepts the complete current nine-file game-data layout", async () => {
    const ready = readyCapabilities();
    const files: ImportUploadCandidate[] = Array.from(
      { length: 7 },
      (_, index) =>
        candidate({
          clientFileId: `race-${index + 1}`,
          originalFileName: `race-${index + 1}.csv`,
        }),
    );
    files.push(
      candidate({
        clientFileId: "core-1",
        sourceFamily: "core_details",
        originalFileName: "core-details.csv",
      }),
      candidate({
        clientFileId: "arena-1",
        sourceFamily: "current_arena",
        originalFileName: "current-arena.csv",
      }),
    );

    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files,
        capabilities: ready.capabilities,
      }),
    ).resolves.toMatchObject({ status: "ready", targets: { length: 9 } });
  });

  it("rejects competing replacement snapshots before capacity or persistence", async () => {
    const ready = readyCapabilities();
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files: [
          candidate({
            clientFileId: "arena-1",
            sourceFamily: "current_arena",
            originalFileName: "arena-a.csv",
          }),
          candidate({
            clientFileId: "arena-2",
            sourceFamily: "current_arena",
            originalFileName: "arena-b.csv",
            sha256: SHA_B,
          }),
        ],
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("one replacement candidate");
    expect(ready.assertWithinApprovedCapacity).not.toHaveBeenCalled();
    expect(ready.reserveUploadBatch).not.toHaveBeenCalled();
  });

  it("accepts exactly the bounded 24-file maximum", async () => {
    const ready = readyCapabilities();
    const files = Array.from({ length: 24 }, (_, index) =>
      candidate({
        clientFileId: `race-${index + 1}`,
        originalFileName: `race-${index + 1}.csv`,
      }),
    );

    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files,
        capabilities: ready.capabilities,
      }),
    ).resolves.toMatchObject({ status: "ready", targets: { length: 24 } });
    expect(ready.assertWithinApprovedCapacity).toHaveBeenCalledWith(
      expect.objectContaining({ fileCount: 24 }),
    );
    expect(ready.reserveUploadBatch).toHaveBeenCalledOnce();
    expect(ready.createDirectUploadTarget).toHaveBeenCalledTimes(24);
  });

  it("rejects the retired Current Vault source and batches above the bounded maximum", async () => {
    const ready = readyCapabilities();
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files: [
          candidate({
            sourceFamily: "current_vault" as never,
            originalFileName: "retired-vault.csv",
          }),
        ],
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("sourceFamily is invalid");

    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        files: Array.from({ length: 25 }, (_, index) =>
          candidate({
            clientFileId: `race-${index + 1}`,
            originalFileName: `race-${index + 1}.csv`,
          }),
        ),
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("between 1 and 24 candidates");
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
    ready.reserveUploadBatch.mockImplementationOnce(
      async ({ requestFingerprint }) => ({
        disposition: "existing",
        uploadBatchId: "batch-existing",
        requestFingerprint,
        files: [{ clientFileId: "file-1", uploadFileId: "upload-existing" }],
      }),
    );
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
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      reason: "private_object_target_unavailable",
    });
  });

  it("rejects an inconsistent reservation identity set", async () => {
    const ready = readyCapabilities();
    ready.reserveUploadBatch.mockImplementationOnce(
      async ({ requestFingerprint }) => ({
        disposition: "created",
        uploadBatchId: "batch-1",
        requestFingerprint,
        files: [{ clientFileId: "unknown-file", uploadFileId: "upload-1" }],
      }),
    );
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
      requestFingerprint: expect.stringMatching(/^[a-f0-9]{64}$/),
      reason: "private_object_target_unavailable",
    });
  });

  it("rejects idempotency collisions before issuing a target", async () => {
    const ready = readyCapabilities();
    ready.reserveUploadBatch.mockImplementationOnce(
      async ({ files }: { files: readonly ImportUploadCandidate[] }) => ({
        disposition: "existing",
        uploadBatchId: "batch-existing",
        requestFingerprint: "f".repeat(64),
        files: files.map((file, index) => ({
          clientFileId: file.clientFileId,
          uploadFileId: `upload-${index + 1}`,
        })),
      }),
    );
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("identity set is inconsistent");
    expect(ready.createDirectUploadTarget).not.toHaveBeenCalled();
  });

  it("rejects malformed provider targets and fails the reservation", async () => {
    const ready = readyCapabilities();
    ready.createDirectUploadTarget.mockResolvedValueOnce({
      method: "PUT",
      targetToken: "opaque:\nprivate",
    });
    await expect(
      beginPrivateImportUpload({
        ...baseInput,
        capabilities: ready.capabilities,
      }),
    ).rejects.toThrow("target creation failed");
    expect(ready.markUploadTargetsReady).not.toHaveBeenCalled();
    expect(ready.markUploadReservationFailed).toHaveBeenCalledOnce();
  });
});
