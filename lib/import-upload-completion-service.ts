import {
  importUploadSourceFamilies,
  type ImportUploadSourceFamily,
} from "./import-upload-intake-service";

export type ReservedImportUploadObject = Readonly<{
  uploadFileId: string;
  objectId: string;
  sourceFamily: ImportUploadSourceFamily;
  expectedByteLength: number;
  expectedSha256: string;
  expectedContentType: string;
}>;

export type UploadCompletionClaim =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "already_queued";
      uploadBatchId: string;
      previewDispatchId: string;
      fileCount: number;
    }>
  | Readonly<{
      status: "claimed";
      completionId: string;
      files: readonly ReservedImportUploadObject[];
    }>;

export type VerifiedUploadedObject = Readonly<{
  uploadFileId: string;
  objectId: string;
  objectVersion: string;
  advertisedByteLength: number;
  advertisedContentType: string;
  providerSha256: string | null;
}>;

export type ImportUploadCompletionRepository = Readonly<{
  claimUploadCompletion: (input: {
    ownerId: string;
    uploadBatchId: string;
    idempotencyKey: string;
    claimedAt: string;
  }) => Promise<UploadCompletionClaim>;
  reservePreviewDispatch: (input: {
    ownerId: string;
    uploadBatchId: string;
    completionId: string;
    verifiedAt: string;
    files: readonly VerifiedUploadedObject[];
  }) => Promise<
    Readonly<{
      previewDispatchId: string;
      disposition: "created" | "existing";
      dispatchState: "pending" | "queued";
    }>
  >;
  markPreviewDispatchQueued: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    queuedAt: string;
  }) => Promise<void>;
  markPreviewDispatchFailed: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    failedAt: string;
    reason: "preview_queue_unavailable";
  }) => Promise<void>;
  recordUploadVerificationFailure: (input: {
    ownerId: string;
    uploadBatchId: string;
    completionId: string;
    failedAt: string;
    reason:
      | "object_store_unavailable"
      | "object_metadata_mismatch"
      | "private_scope_violation";
  }) => Promise<void>;
}>;

export type PrivateUploadedObjectInspector = Readonly<{
  inspectObject: (input: { ownerId: string; objectId: string }) => Promise<
    | Readonly<{ status: "missing" }>
    | Readonly<{
        status: "ready";
        private: boolean;
        objectVersion: string;
        advertisedByteLength: number;
        advertisedContentType: string;
        providerSha256: string | null;
      }>
  >;
}>;

export type ImportPreviewQueue = Readonly<{
  enqueue: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
  }) => Promise<void>;
}>;

export type ImportUploadCompletionCapabilities =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: ImportUploadCompletionRepository;
      objectInspector: PrivateUploadedObjectInspector;
      previewQueue: ImportPreviewQueue;
    }>;

export type ImportUploadCompletionResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "uploads_pending";
      uploadBatchId: string;
      missingUploadFileIds: readonly string[];
    }>
  | Readonly<{
      status: "queued_for_preview";
      uploadBatchId: string;
      previewDispatchId: string;
      disposition: "created" | "existing";
      fileCount: number;
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILES_PER_BATCH = 24;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_OBJECT_VERSION_LENGTH = 512;
const sourceFamilySet = new Set<ImportUploadSourceFamily>(
  importUploadSourceFamilies,
);

function normalizedIdentity(value: string | null): string | null {
  const normalized = value?.trim() ?? "";
  return normalized === "" ? null : normalized;
}

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("now must be valid");
  return value.toISOString();
}

function normalizedContentType(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (normalized === "" || /[\u0000-\u001f\u007f]/.test(normalized)) {
    throw new Error("content type is invalid");
  }
  return normalized;
}

function normalizedObjectVersion(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > MAX_OBJECT_VERSION_LENGTH ||
    /[\u0000-\u001f\u007f]/.test(normalized)
  ) {
    throw new Error("object version is invalid");
  }
  return normalized;
}

function assertPositiveSafeInteger(value: number, field: string): void {
  if (!Number.isSafeInteger(value) || value <= 0 || value > MAX_FILE_BYTES) {
    throw new Error(`${field} is invalid`);
  }
}

function validateClaimedFiles(
  files: readonly ReservedImportUploadObject[],
): readonly ReservedImportUploadObject[] {
  if (files.length === 0 || files.length > MAX_FILES_PER_BATCH) {
    throw new Error("reserved upload file count is invalid");
  }
  const uploadFileIds = new Set<string>();
  const objectIds = new Set<string>();
  return files.map((file) => {
    const uploadFileId = requireSafeIdentifier(
      file.uploadFileId,
      "uploadFileId",
    );
    const objectId = requireSafeIdentifier(file.objectId, "objectId");
    if (uploadFileIds.has(uploadFileId) || objectIds.has(objectId)) {
      throw new Error("reserved upload identities must be unique");
    }
    uploadFileIds.add(uploadFileId);
    objectIds.add(objectId);
    if (!sourceFamilySet.has(file.sourceFamily)) {
      throw new Error("sourceFamily is invalid");
    }
    assertPositiveSafeInteger(file.expectedByteLength, "expectedByteLength");
    if (!SHA_256_PATTERN.test(file.expectedSha256)) {
      throw new Error("expectedSha256 is invalid");
    }
    return {
      uploadFileId,
      objectId,
      sourceFamily: file.sourceFamily,
      expectedByteLength: file.expectedByteLength,
      expectedSha256: file.expectedSha256,
      expectedContentType: normalizedContentType(file.expectedContentType),
    };
  });
}

export const unavailableImportUploadCompletionCapabilities: ImportUploadCompletionCapabilities =
  Object.freeze({ status: "not_configured" });

export async function completePrivateImportUpload(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    uploadBatchId: string;
    idempotencyKey: string;
    now: Date;
    capabilities: ImportUploadCompletionCapabilities;
  }>,
): Promise<ImportUploadCompletionResult> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Private import upload completion access denied.");
  }
  if (input.capabilities.status === "not_configured") {
    return { status: "not_configured" };
  }

  const uploadBatchId = requireSafeIdentifier(
    input.uploadBatchId,
    "uploadBatchId",
  );
  const idempotencyKey = requireSafeIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const occurredAt = canonicalTimestamp(input.now);
  const { repository, objectInspector, previewQueue } = input.capabilities;
  const claim = await repository.claimUploadCompletion({
    ownerId: authenticatedOwnerId,
    uploadBatchId,
    idempotencyKey,
    claimedAt: occurredAt,
  });

  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status === "already_queued") {
    requireSafeIdentifier(claim.uploadBatchId, "uploadBatchId");
    const previewDispatchId = requireSafeIdentifier(
      claim.previewDispatchId,
      "previewDispatchId",
    );
    if (
      claim.uploadBatchId !== uploadBatchId ||
      !Number.isSafeInteger(claim.fileCount) ||
      claim.fileCount <= 0 ||
      claim.fileCount > MAX_FILES_PER_BATCH
    ) {
      throw new Error("Stored upload completion is inconsistent.");
    }
    return {
      status: "queued_for_preview",
      uploadBatchId,
      previewDispatchId,
      disposition: "existing",
      fileCount: claim.fileCount,
    };
  }
  if (claim.status !== "claimed") {
    throw new Error("Stored upload completion state is inconsistent.");
  }

  const completionId = requireSafeIdentifier(
    claim.completionId,
    "completionId",
  );
  const files = validateClaimedFiles(claim.files);
  const verified: VerifiedUploadedObject[] = [];
  const missingUploadFileIds: string[] = [];

  for (const file of files) {
    let inspected: Awaited<
      ReturnType<PrivateUploadedObjectInspector["inspectObject"]>
    >;
    try {
      inspected = await objectInspector.inspectObject({
        ownerId: authenticatedOwnerId,
        objectId: file.objectId,
      });
    } catch {
      await repository.recordUploadVerificationFailure({
        ownerId: authenticatedOwnerId,
        uploadBatchId,
        completionId,
        failedAt: occurredAt,
        reason: "object_store_unavailable",
      });
      throw new Error(
        "Private upload verification is temporarily unavailable.",
      );
    }
    if (inspected.status === "missing") {
      missingUploadFileIds.push(file.uploadFileId);
      continue;
    }
    if (inspected.private !== true) {
      await repository.recordUploadVerificationFailure({
        ownerId: authenticatedOwnerId,
        uploadBatchId,
        completionId,
        failedAt: occurredAt,
        reason: "private_scope_violation",
      });
      throw new Error("Private upload verification failed.");
    }

    let advertisedContentType: string;
    let objectVersion: string;
    const providerSha256 = inspected.providerSha256;
    try {
      advertisedContentType = normalizedContentType(
        inspected.advertisedContentType,
      );
      objectVersion = normalizedObjectVersion(inspected.objectVersion);
      if (
        !Number.isSafeInteger(inspected.advertisedByteLength) ||
        inspected.advertisedByteLength !== file.expectedByteLength ||
        advertisedContentType !== file.expectedContentType ||
        (providerSha256 !== null &&
          (!SHA_256_PATTERN.test(providerSha256) ||
            providerSha256 !== file.expectedSha256))
      ) {
        throw new Error("metadata mismatch");
      }
    } catch {
      await repository.recordUploadVerificationFailure({
        ownerId: authenticatedOwnerId,
        uploadBatchId,
        completionId,
        failedAt: occurredAt,
        reason: "object_metadata_mismatch",
      });
      throw new Error("Private upload verification failed.");
    }
    verified.push({
      uploadFileId: file.uploadFileId,
      objectId: file.objectId,
      objectVersion,
      advertisedByteLength: inspected.advertisedByteLength,
      advertisedContentType,
      providerSha256,
    });
  }

  if (missingUploadFileIds.length > 0) {
    return {
      status: "uploads_pending",
      uploadBatchId,
      missingUploadFileIds,
    };
  }

  const dispatch = await repository.reservePreviewDispatch({
    ownerId: authenticatedOwnerId,
    uploadBatchId,
    completionId,
    verifiedAt: occurredAt,
    files: verified,
  });
  const previewDispatchId = requireSafeIdentifier(
    dispatch.previewDispatchId,
    "previewDispatchId",
  );
  if (
    (dispatch.disposition !== "created" &&
      dispatch.disposition !== "existing") ||
    (dispatch.dispatchState !== "pending" &&
      dispatch.dispatchState !== "queued")
  ) {
    throw new Error("Stored preview dispatch state is inconsistent.");
  }
  if (dispatch.dispatchState === "queued") {
    return {
      status: "queued_for_preview",
      uploadBatchId,
      previewDispatchId,
      disposition: dispatch.disposition,
      fileCount: verified.length,
    };
  }

  try {
    await previewQueue.enqueue({
      ownerId: authenticatedOwnerId,
      uploadBatchId,
      previewDispatchId,
    });
  } catch {
    await repository.markPreviewDispatchFailed({
      ownerId: authenticatedOwnerId,
      uploadBatchId,
      previewDispatchId,
      failedAt: occurredAt,
      reason: "preview_queue_unavailable",
    });
    throw new Error("Private import preview dispatch failed.");
  }
  await repository.markPreviewDispatchQueued({
    ownerId: authenticatedOwnerId,
    uploadBatchId,
    previewDispatchId,
    queuedAt: occurredAt,
  });
  return {
    status: "queued_for_preview",
    uploadBatchId,
    previewDispatchId,
    disposition: dispatch.disposition,
    fileCount: verified.length,
  };
}
