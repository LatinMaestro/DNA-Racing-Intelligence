import { createHash } from "node:crypto";
import { describe, expect, it, vi } from "vitest";

import {
  createBoundedImportPreviewProcessor,
  type ImportPreviewObjectStorage,
  type ImportPreviewStagingSink,
} from "../lib/bounded-import-preview-processor";

const encoder = new TextEncoder();
const OWNER_ID = "owner-1";
const DISPATCH_ID = "dispatch-1";
const BATCH_ID = "batch-1";
const REQUEST_SHA = "a".repeat(64);
const MANIFEST_SHA = "b".repeat(64);
const PREVIEW_SHA = "c".repeat(64);

function sha256(value: Uint8Array): string {
  return createHash("sha256").update(value).digest("hex");
}

async function* body(value: Uint8Array): AsyncIterable<Uint8Array> {
  yield value;
}

function harness() {
  const values = new Map([
    ["object-1", encoder.encode("event_id,core_id\nevent-1,core-1\n")],
    ["object-2", encoder.encode("core_id,name\ncore-1,Synthetic\n")],
  ]);
  const openOrder: string[] = [];
  const objectStorage: ImportPreviewObjectStorage = {
    openObject: vi.fn(async ({ objectId }) => {
      openOrder.push(`open:${objectId}`);
      const value = values.get(objectId);
      if (value === undefined) return { status: "missing" as const };
      return {
        status: "ready" as const,
        advertisedByteLength: value.byteLength,
        body: body(value),
      };
    }),
  };
  const beginObject = vi.fn(async ({ objectId }: { objectId: string }) => ({
    write: vi.fn(async () => undefined),
    commitVerified: vi.fn(async () => {
      openOrder.push(`commit:${objectId}`);
      return `staged:${objectId}`;
    }),
    abort: vi.fn(async () => undefined),
  }));
  const completePreview = vi.fn(async () => ({
    previewId: "preview-1",
    previewFingerprintSha256: PREVIEW_SHA,
    uploadManifestFingerprintSha256: MANIFEST_SHA,
    fileCount: 2,
    sourceFamilyCount: 2,
    blockingIssueCount: 0,
    confirmable: true,
  }));
  const abortPreview = vi.fn(async () => undefined);
  const stagingSink: ImportPreviewStagingSink = {
    beginObject,
    completePreview,
    abortPreview,
  };
  const processor = createBoundedImportPreviewProcessor({
    objectStorage,
    stagingSink,
    maximumObjectBytes: 1024,
    maximumChunkBytes: 256,
  });
  const files = [
    {
      uploadFileId: "file-1",
      objectId: "object-1",
      sourceFamily: "race_merge" as const,
      expectedByteLength: values.get("object-1")!.byteLength,
      expectedSha256: sha256(values.get("object-1")!),
    },
    {
      uploadFileId: "file-2",
      objectId: "object-2",
      sourceFamily: "core_details" as const,
      expectedByteLength: values.get("object-2")!.byteLength,
      expectedSha256: sha256(values.get("object-2")!),
    },
  ];
  return {
    processor,
    files,
    values,
    openOrder,
    objectStorage,
    beginObject,
    completePreview,
    abortPreview,
  };
}

function input(test: ReturnType<typeof harness>) {
  return {
    ownerId: OWNER_ID,
    uploadBatchId: BATCH_ID,
    previewDispatchId: DISPATCH_ID,
    uploadRequestFingerprint: REQUEST_SHA,
    uploadManifestFingerprintSha256: MANIFEST_SHA,
    files: test.files,
    maximumBatchBytes: 2048,
  };
}

describe("bounded import preview processor", () => {
  it("streams and verifies objects sequentially before finalization", async () => {
    const test = harness();
    await expect(test.processor.preparePreview(input(test))).resolves.toEqual({
      previewId: "preview-1",
      previewFingerprintSha256: PREVIEW_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      fileCount: 2,
      sourceFamilyCount: 2,
      blockingIssueCount: 0,
      confirmable: true,
    });
    expect(test.openOrder).toEqual([
      "open:object-1",
      "commit:object-1",
      "open:object-2",
      "commit:object-2",
    ]);
    expect(test.completePreview).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      uploadBatchId: BATCH_ID,
      previewDispatchId: DISPATCH_ID,
      uploadRequestFingerprint: REQUEST_SHA,
      uploadManifestFingerprintSha256: MANIFEST_SHA,
      objects: [
        expect.objectContaining({
          uploadFileId: "file-1",
          objectId: "object-1",
          sourceFamily: "race_merge",
          byteLength: test.values.get("object-1")!.byteLength,
          sha256: sha256(test.values.get("object-1")!),
          chunkCount: 1,
          stagedResult: "staged:object-1",
        }),
        expect.objectContaining({
          uploadFileId: "file-2",
          stagedResult: "staged:object-2",
        }),
      ],
    });
    expect(test.abortPreview).toHaveBeenCalledTimes(1);
    expect(test.abortPreview).toHaveBeenNthCalledWith(1, {
      ownerId: OWNER_ID,
      uploadBatchId: BATCH_ID,
      previewDispatchId: DISPATCH_ID,
      reason: "attempt_restart",
    });
  });

  it("fails closed before object access when stale staging cannot be reset", async () => {
    const test = harness();
    test.abortPreview.mockRejectedValueOnce(
      new Error("private cleanup detail"),
    );
    await expect(
      test.processor.preparePreview(input(test)),
    ).rejects.toMatchObject({ reason: "preview_staging_begin_failed" });
    expect(test.objectStorage.openObject).not.toHaveBeenCalled();
    expect(test.beginObject).not.toHaveBeenCalled();
    expect(test.completePreview).not.toHaveBeenCalled();
  });

  it("records a sanitized object-store stage when an object is missing", async () => {
    const test = harness();
    const secondFile = test.files[1];
    if (secondFile === undefined) throw new Error("fixture is incomplete");
    test.files[1] = { ...secondFile, objectId: "object-missing" };
    await expect(
      test.processor.preparePreview(input(test)),
    ).rejects.toMatchObject({ reason: "preview_object_store_failed" });
    expect(test.abortPreview).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      uploadBatchId: BATCH_ID,
      previewDispatchId: DISPATCH_ID,
      reason: "object_processing_failed",
    });
    expect(test.completePreview).not.toHaveBeenCalled();
  });

  it("records a sanitized finalization stage", async () => {
    const test = harness();
    test.completePreview.mockRejectedValueOnce(new Error("private detail"));
    await expect(
      test.processor.preparePreview(input(test)),
    ).rejects.toMatchObject({ reason: "preview_finalization_failed" });
    expect(test.abortPreview).toHaveBeenCalledWith({
      ownerId: OWNER_ID,
      uploadBatchId: BATCH_ID,
      previewDispatchId: DISPATCH_ID,
      reason: "preview_finalization_failed",
    });
  });

  it("enforces configured object and chunk limits", () => {
    const test = harness();
    expect(() =>
      createBoundedImportPreviewProcessor({
        objectStorage: test.objectStorage,
        stagingSink: {
          beginObject: test.beginObject,
          completePreview: test.completePreview,
          abortPreview: test.abortPreview,
        },
        maximumObjectBytes: 128,
        maximumChunkBytes: 256,
      }),
    ).toThrow("cannot exceed");
  });
});
