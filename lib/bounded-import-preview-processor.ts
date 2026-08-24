import type {
  BoundedImportPreviewProcessor,
  PreparedImportPreview,
} from "./import-preview-processing-service";
import {
  ImportPreviewProcessingFailure,
  type ImportPreviewProcessingFailureReason,
} from "./import-preview-processing-failure";
import {
  RawImportObjectError,
  streamVerifiedPrivateRawImportObject,
  type PrivateRawImportObjectStore,
  type TransactionalRawImportSink,
} from "./private-raw-import-object-stream";

export type ImportPreviewObjectStorage = Readonly<{
  openObject: (input: { ownerId: string; objectId: string }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        advertisedByteLength: number;
        body: AsyncIterable<Uint8Array>;
      }>
  >;
}>;

export type StagedImportPreviewObject = Readonly<{
  uploadFileId: string;
  objectId: string;
  sourceFamily: "race_merge" | "core_details" | "current_arena";
  byteLength: number;
  sha256: string;
  chunkCount: number;
  stagedResult: unknown;
}>;

export type ImportPreviewStagingSink = TransactionalRawImportSink<unknown> &
  Readonly<{
    completePreview: (input: {
      ownerId: string;
      uploadBatchId: string;
      previewDispatchId: string;
      uploadRequestFingerprint: string;
      uploadManifestFingerprintSha256: string;
      objects: readonly StagedImportPreviewObject[];
    }) => Promise<PreparedImportPreview>;
    abortPreview: (input: {
      ownerId: string;
      uploadBatchId: string;
      previewDispatchId: string;
      reason:
        | "attempt_restart"
        | "object_processing_failed"
        | "preview_finalization_failed";
    }) => Promise<void>;
  }>;

function positiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

async function abortSafely(
  sink: ImportPreviewStagingSink,
  input: Parameters<ImportPreviewStagingSink["abortPreview"]>[0],
): Promise<void> {
  try {
    await sink.abortPreview(input);
  } catch {
    // Preserve the stable processing failure instead of provider detail.
  }
}

function processingFailureReason(
  error: unknown,
): ImportPreviewProcessingFailureReason {
  if (!(error instanceof RawImportObjectError)) {
    return "preview_processor_failed";
  }
  switch (error.code) {
    case "store_failed":
      return "preview_object_store_failed";
    case "sink_begin_failed":
      return "preview_staging_begin_failed";
    case "sink_write_failed":
      return "preview_staging_write_failed";
    case "sink_commit_failed":
      return "preview_staging_commit_failed";
    case "sink_failed":
      return "preview_processor_failed";
    default:
      return "preview_object_integrity_failed";
  }
}

export function createBoundedImportPreviewProcessor(input: {
  objectStorage: ImportPreviewObjectStorage;
  stagingSink: ImportPreviewStagingSink;
  maximumObjectBytes: number;
  maximumChunkBytes: number;
}): BoundedImportPreviewProcessor {
  const maximumObjectBytes = positiveSafeInteger(
    input.maximumObjectBytes,
    "maximumObjectBytes",
  );
  const maximumChunkBytes = positiveSafeInteger(
    input.maximumChunkBytes,
    "maximumChunkBytes",
  );
  if (maximumChunkBytes > maximumObjectBytes) {
    throw new Error("maximumChunkBytes cannot exceed maximumObjectBytes");
  }

  const store: PrivateRawImportObjectStore = {
    async openObject(openInput) {
      const opened = await input.objectStorage.openObject(openInput);
      if (opened.status !== "ready") {
        throw new Error("Private import object is unavailable.");
      }
      return opened;
    },
  };

  return Object.freeze({
    async preparePreview(previewInput) {
      try {
        await input.stagingSink.abortPreview({
          ownerId: previewInput.ownerId,
          uploadBatchId: previewInput.uploadBatchId,
          previewDispatchId: previewInput.previewDispatchId,
          reason: "attempt_restart",
        });
      } catch {
        throw new ImportPreviewProcessingFailure(
          "preview_staging_begin_failed",
        );
      }
      const objects: StagedImportPreviewObject[] = [];
      try {
        for (const file of previewInput.files) {
          const verified = await streamVerifiedPrivateRawImportObject({
            ownerId: previewInput.ownerId,
            updateSessionId: previewInput.previewDispatchId,
            reference: {
              objectId: file.objectId,
              sourceFamily: file.sourceFamily,
              expectedByteLength: file.expectedByteLength,
              expectedSha256: file.expectedSha256,
            },
            maximumObjectBytes: Math.min(
              maximumObjectBytes,
              previewInput.maximumBatchBytes,
            ),
            maximumChunkBytes,
            store,
            sink: input.stagingSink,
          });
          objects.push({
            uploadFileId: file.uploadFileId,
            objectId: file.objectId,
            sourceFamily: file.sourceFamily,
            byteLength: verified.byteLength,
            sha256: verified.sha256,
            chunkCount: verified.chunkCount,
            stagedResult: verified.result,
          });
        }
      } catch (error) {
        await abortSafely(input.stagingSink, {
          ownerId: previewInput.ownerId,
          uploadBatchId: previewInput.uploadBatchId,
          previewDispatchId: previewInput.previewDispatchId,
          reason: "object_processing_failed",
        });
        throw new ImportPreviewProcessingFailure(
          processingFailureReason(error),
        );
      }

      try {
        return await input.stagingSink.completePreview({
          ownerId: previewInput.ownerId,
          uploadBatchId: previewInput.uploadBatchId,
          previewDispatchId: previewInput.previewDispatchId,
          uploadRequestFingerprint: previewInput.uploadRequestFingerprint,
          uploadManifestFingerprintSha256:
            previewInput.uploadManifestFingerprintSha256,
          objects,
        });
      } catch {
        await abortSafely(input.stagingSink, {
          ownerId: previewInput.ownerId,
          uploadBatchId: previewInput.uploadBatchId,
          previewDispatchId: previewInput.previewDispatchId,
          reason: "preview_finalization_failed",
        });
        throw new ImportPreviewProcessingFailure("preview_finalization_failed");
      }
    },
  });
}
