import { describe, expect, it, vi } from "vitest";

import {
  uploadReservedImportFiles,
  type DirectImportUploadCompletion,
  type DirectImportUploadFile,
  type DirectImportUploadTransport,
} from "../lib/import-direct-upload-client";
import type { ImportUploadCompletionResult } from "../lib/import-upload-completion-service";
import type { ImportUploadCandidate } from "../lib/import-upload-intake-service";

const candidates: readonly ImportUploadCandidate[] = [
  {
    clientFileId: "client-race-1",
    sourceFamily: "race_merge",
    originalFileName: "synthetic-race-1.csv",
    contentType: "text/csv",
    byteLength: 3,
    sha256: "a".repeat(64),
  },
  {
    clientFileId: "client-race-2",
    sourceFamily: "race_merge",
    originalFileName: "synthetic-race-2.csv",
    contentType: "text/csv",
    byteLength: 4,
    sha256: "b".repeat(64),
  },
];

const files: readonly DirectImportUploadFile[] = [
  { clientFileId: "client-race-1", body: new Blob(["abc"]) },
  { clientFileId: "client-race-2", body: new Blob(["defg"]) },
];

const reservation = {
  status: "ready" as const,
  disposition: "created" as const,
  uploadBatchId: "upload-batch-1",
  expiresAt: "2026-07-26T01:00:00.000Z",
  requestFingerprint: "c".repeat(64),
  targets: [
    {
      clientFileId: "client-race-1",
      uploadFileId: "upload-file-1",
      method: "PUT" as const,
      targetToken: "opaque-target-1",
    },
    {
      clientFileId: "client-race-2",
      uploadFileId: "upload-file-2",
      method: "PUT" as const,
      targetToken: "opaque-target-2",
    },
  ],
};

function dependencies() {
  const putPrivateObject = vi.fn<
    DirectImportUploadTransport["putPrivateObject"]
  >(async () => undefined);
  const completeUpload = vi.fn<DirectImportUploadCompletion["completeUpload"]>(
    async (): Promise<ImportUploadCompletionResult> => ({
      status: "queued_for_preview",
      disposition: "created",
      uploadBatchId: "upload-batch-1",
      previewDispatchId: "preview-dispatch-1",
      fileCount: 2,
    }),
  );
  return {
    transport: {
      putPrivateObject,
    },
    completion: {
      completeUpload,
    },
  };
}

describe("direct import upload client", () => {
  it("streams every Blob in target order and requests completion afterward", async () => {
    const { transport, completion } = dependencies();

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files,
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).resolves.toEqual({
      status: "completed",
      completion: {
        status: "queued_for_preview",
        disposition: "created",
        uploadBatchId: "upload-batch-1",
        previewDispatchId: "preview-dispatch-1",
        fileCount: 2,
      },
    });

    expect(transport.putPrivateObject).toHaveBeenCalledTimes(2);
    expect(transport.putPrivateObject.mock.calls[0]?.[0]).toMatchObject({
      targetToken: "opaque-target-1",
      method: "PUT",
      contentType: "text/csv",
      byteLength: 3,
      sha256: "a".repeat(64),
      body: files[0]?.body,
    });
    expect(transport.putPrivateObject.mock.invocationCallOrder[0]).toBeLessThan(
      transport.putPrivateObject.mock.invocationCallOrder[1] ?? Infinity,
    );
    expect(transport.putPrivateObject.mock.invocationCallOrder[1]).toBeLessThan(
      completion.completeUpload.mock.invocationCallOrder[0] ?? Infinity,
    );
    expect(completion.completeUpload).toHaveBeenCalledWith({
      uploadBatchId: "upload-batch-1",
      idempotencyKey: "complete-request-1",
      uploadRequestFingerprint: "c".repeat(64),
    });
  });

  it("rejects expired targets before uploading", async () => {
    const { transport, completion } = dependencies();

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files,
        completionIdempotencyKey: "complete-request-1",
        now: new Date(reservation.expiresAt),
        transport,
        completion,
      }),
    ).rejects.toThrow("expired");

    expect(transport.putPrivateObject).not.toHaveBeenCalled();
    expect(completion.completeUpload).not.toHaveBeenCalled();
  });

  it("requires candidates, files and targets to have the same identities", async () => {
    const { transport, completion } = dependencies();

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files: files.slice(0, 1),
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).rejects.toThrow("counts must agree");

    expect(transport.putPrivateObject).not.toHaveBeenCalled();
  });

  it("rejects a selected Blob that changed after metadata preparation", async () => {
    const { transport, completion } = dependencies();

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files: [
          files[0] as DirectImportUploadFile,
          { clientFileId: "client-race-2", body: new Blob(["short"]) },
        ],
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).rejects.toThrow("byte length");

    expect(transport.putPrivateObject).not.toHaveBeenCalled();
  });

  it("rejects duplicate target or selected-file identities", async () => {
    const { transport, completion } = dependencies();

    await expect(
      uploadReservedImportFiles({
        reservation: {
          ...reservation,
          targets: [
            reservation.targets[0]!,
            {
              ...reservation.targets[1]!,
              uploadFileId: "upload-file-1",
            },
          ],
        },
        candidates,
        files,
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).rejects.toThrow("target set is inconsistent");

    expect(transport.putPrivateObject).not.toHaveBeenCalled();
  });

  it("does not request completion after a private-object transfer failure", async () => {
    const { transport, completion } = dependencies();
    transport.putPrivateObject
      .mockResolvedValueOnce(undefined)
      .mockRejectedValueOnce(new Error("sensitive provider detail"));

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files,
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).resolves.toEqual({
      status: "upload_failed",
      clientFileId: "client-race-2",
    });

    expect(completion.completeUpload).not.toHaveBeenCalled();
  });

  it("forwards idempotent completion states without changing active data", async () => {
    const { transport, completion } = dependencies();
    completion.completeUpload.mockResolvedValueOnce({
      status: "not_configured",
    });

    await expect(
      uploadReservedImportFiles({
        reservation,
        candidates,
        files,
        completionIdempotencyKey: "complete-request-1",
        now: new Date("2026-07-26T00:30:00.000Z"),
        transport,
        completion,
      }),
    ).resolves.toEqual({
      status: "completed",
      completion: { status: "not_configured" },
    });
  });
});
