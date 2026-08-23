import {
  importUploadSourceFamilies,
  type ImportUploadSourceFamily,
} from "./import-upload-intake-service";
import {
  ImportPreviewProcessingFailure,
  type ImportPreviewProcessingFailureReason,
} from "./import-preview-processing-failure";

export type PreviewObjectReference = Readonly<{
  uploadFileId: string;
  objectId: string;
  sourceFamily: ImportUploadSourceFamily;
  expectedByteLength: number;
  expectedSha256: string;
}>;

export type ImportPreviewDispatchClaim =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "already_complete";
      uploadBatchId: string;
      uploadRequestFingerprint: string;
      previewId: string;
      previewFingerprintSha256: string;
      confirmable: boolean;
    }>
  | Readonly<{
      status: "leased_elsewhere";
      uploadRequestFingerprint: string;
      retryAfter: string;
    }>
  | Readonly<{
      status: "claimed";
      ownerId: string;
      uploadBatchId: string;
      uploadRequestFingerprint: string;
      uploadManifestFingerprintSha256: string;
      files: readonly PreviewObjectReference[];
    }>;

export type PreparedImportPreview = Readonly<{
  previewId: string;
  previewFingerprintSha256: string;
  uploadManifestFingerprintSha256: string;
  fileCount: number;
  sourceFamilyCount: number;
  blockingIssueCount: number;
  confirmable: boolean;
}>;

export type ImportPreviewProcessingRepository = Readonly<{
  claimPreviewDispatch: (input: {
    previewDispatchId: string;
    workerId: string;
    uploadRequestFingerprint: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) => Promise<ImportPreviewDispatchClaim>;
  publishPreparedPreview: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    uploadRequestFingerprint: string;
    uploadManifestFingerprintSha256: string;
    previewId: string;
    previewFingerprintSha256: string;
    fileCount: number;
    sourceFamilyCount: number;
    blockingIssueCount: number;
    confirmable: boolean;
    completedAt: string;
  }) => Promise<
    Readonly<{
      disposition: "created" | "existing";
      uploadRequestFingerprint: string;
      uploadManifestFingerprintSha256: string;
      previewId: string;
      previewFingerprintSha256: string;
      confirmable: boolean;
    }>
  >;
  recordPreviewFailure: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    workerId: string;
    uploadRequestFingerprint: string;
    failedAt: string;
    reason: ImportPreviewProcessingFailureReason;
  }) => Promise<void>;
}>;

export type BoundedImportPreviewProcessor = Readonly<{
  preparePreview: (input: {
    ownerId: string;
    uploadBatchId: string;
    previewDispatchId: string;
    uploadRequestFingerprint: string;
    uploadManifestFingerprintSha256: string;
    files: readonly PreviewObjectReference[];
    maximumBatchBytes: number;
  }) => Promise<PreparedImportPreview>;
}>;

export type ImportPreviewProcessingCapabilities =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: ImportPreviewProcessingRepository;
      processor: BoundedImportPreviewProcessor;
    }>;

export type ImportPreviewProcessingResult =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "leased_elsewhere"; retryAfter: string }>
  | Readonly<{
      status: "completed";
      uploadBatchId: string;
      previewId: string;
      previewFingerprintSha256: string;
      confirmable: boolean;
      disposition: "created" | "existing";
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILES_PER_BATCH = 24;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const sourceFamilySet = new Set<ImportUploadSourceFamily>(
  importUploadSourceFamilies,
);

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function requireSha256(value: string, field: string): string {
  if (!SHA_256_PATTERN.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function canonicalTimestamp(value: Date, field: string): string {
  if (Number.isNaN(value.getTime())) throw new Error(`${field} must be valid`);
  return value.toISOString();
}

function canonicalStoredTimestamp(value: string, field: string): string {
  const parsed = new Date(value);
  if (
    Number.isNaN(parsed.getTime()) ||
    parsed.toISOString() !== value ||
    parsed.getTime() <= 0
  ) {
    throw new Error(`${field} must be a canonical timestamp`);
  }
  return value;
}

function validateFiles(
  files: readonly PreviewObjectReference[],
): readonly PreviewObjectReference[] {
  if (files.length === 0 || files.length > MAX_FILES_PER_BATCH) {
    throw new Error("preview file count is invalid");
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
      throw new Error("preview file identities must be unique");
    }
    uploadFileIds.add(uploadFileId);
    objectIds.add(objectId);
    if (!sourceFamilySet.has(file.sourceFamily)) {
      throw new Error("sourceFamily is invalid");
    }
    if (
      !Number.isSafeInteger(file.expectedByteLength) ||
      file.expectedByteLength <= 0 ||
      file.expectedByteLength > MAX_FILE_BYTES
    ) {
      throw new Error("expectedByteLength is invalid");
    }
    return {
      uploadFileId,
      objectId,
      sourceFamily: file.sourceFamily,
      expectedByteLength: file.expectedByteLength,
      expectedSha256: requireSha256(file.expectedSha256, "expectedSha256"),
    };
  });
}

function requirePositiveSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value <= 0) {
    throw new Error(`${field} must be a positive safe integer`);
  }
  return value;
}

async function recordPreviewFailureSafely(
  repository: ImportPreviewProcessingRepository,
  input: Parameters<
    ImportPreviewProcessingRepository["recordPreviewFailure"]
  >[0],
): Promise<void> {
  try {
    await repository.recordPreviewFailure(input);
  } catch {
    // Preserve the sanitized worker failure without exposing provider detail.
  }
}

function validatePreparedPreview(
  prepared: PreparedImportPreview,
  claim: Extract<ImportPreviewDispatchClaim, { status: "claimed" }>,
): PreparedImportPreview {
  const previewId = requireSafeIdentifier(prepared.previewId, "previewId");
  const previewFingerprintSha256 = requireSha256(
    prepared.previewFingerprintSha256,
    "previewFingerprintSha256",
  );
  if (
    prepared.uploadManifestFingerprintSha256 !==
    claim.uploadManifestFingerprintSha256
  ) {
    throw new Error("prepared preview manifest does not match the claim");
  }
  for (const field of [
    "fileCount",
    "sourceFamilyCount",
    "blockingIssueCount",
  ] as const) {
    if (!Number.isSafeInteger(prepared[field]) || prepared[field] < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  const expectedSourceFamilyCount = new Set(
    claim.files.map((file) => file.sourceFamily),
  ).size;
  if (
    prepared.fileCount !== claim.files.length ||
    prepared.sourceFamilyCount !== expectedSourceFamilyCount ||
    prepared.sourceFamilyCount === 0 ||
    prepared.confirmable !== (prepared.blockingIssueCount === 0)
  ) {
    throw new Error("prepared preview summary is inconsistent");
  }
  return {
    ...prepared,
    previewId,
    previewFingerprintSha256,
  };
}

export const unavailableImportPreviewProcessingCapabilities: ImportPreviewProcessingCapabilities =
  Object.freeze({ status: "not_configured" });

export async function runImportPreviewDispatch(
  input: Readonly<{
    previewDispatchId: string;
    workerId: string;
    uploadRequestFingerprint: string;
    now: Date;
    leaseDurationMilliseconds: number;
    maximumBatchBytes: number;
    capabilities: ImportPreviewProcessingCapabilities;
  }>,
): Promise<ImportPreviewProcessingResult> {
  if (input.capabilities.status === "not_configured") {
    return { status: "not_configured" };
  }
  const previewDispatchId = requireSafeIdentifier(
    input.previewDispatchId,
    "previewDispatchId",
  );
  const workerId = requireSafeIdentifier(input.workerId, "workerId");
  const uploadRequestFingerprint = requireSha256(
    input.uploadRequestFingerprint,
    "uploadRequestFingerprint",
  );
  const claimedAt = canonicalTimestamp(input.now, "now");
  if (
    !Number.isSafeInteger(input.leaseDurationMilliseconds) ||
    input.leaseDurationMilliseconds < 1_000 ||
    input.leaseDurationMilliseconds > 60 * 60 * 1000
  ) {
    throw new Error(
      "leaseDurationMilliseconds must be between 1000 and 3600000",
    );
  }
  const maximumBatchBytes = requirePositiveSafeInteger(
    input.maximumBatchBytes,
    "maximumBatchBytes",
  );
  const leaseExpiresAt = new Date(
    input.now.getTime() + input.leaseDurationMilliseconds,
  ).toISOString();
  const { repository, processor } = input.capabilities;
  let claim: ImportPreviewDispatchClaim;
  try {
    claim = await repository.claimPreviewDispatch({
      previewDispatchId,
      workerId,
      uploadRequestFingerprint,
      claimedAt,
      leaseExpiresAt,
    });
  } catch {
    throw new Error("Private import preview claim is unavailable.");
  }

  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status === "leased_elsewhere") {
    const retryAfter = canonicalStoredTimestamp(claim.retryAfter, "retryAfter");
    if (
      claim.uploadRequestFingerprint !== uploadRequestFingerprint ||
      new Date(retryAfter).getTime() <= input.now.getTime()
    ) {
      throw new Error("Stored preview lease state is inconsistent.");
    }
    return {
      status: "leased_elsewhere",
      retryAfter,
    };
  }
  if (claim.status === "already_complete") {
    if (
      typeof claim.confirmable !== "boolean" ||
      claim.uploadRequestFingerprint !== uploadRequestFingerprint
    ) {
      throw new Error("Stored preview confirmation state is inconsistent.");
    }
    return {
      status: "completed",
      uploadBatchId: requireSafeIdentifier(
        claim.uploadBatchId,
        "uploadBatchId",
      ),
      previewId: requireSafeIdentifier(claim.previewId, "previewId"),
      previewFingerprintSha256: requireSha256(
        claim.previewFingerprintSha256,
        "previewFingerprintSha256",
      ),
      confirmable: claim.confirmable,
      disposition: "existing",
    };
  }
  if (claim.status !== "claimed") {
    throw new Error("Stored preview dispatch state is inconsistent.");
  }

  const normalizedClaim = {
    ...claim,
    ownerId: requireSafeIdentifier(claim.ownerId, "ownerId"),
    uploadBatchId: requireSafeIdentifier(claim.uploadBatchId, "uploadBatchId"),
    uploadRequestFingerprint: requireSha256(
      claim.uploadRequestFingerprint,
      "uploadRequestFingerprint",
    ),
    uploadManifestFingerprintSha256: requireSha256(
      claim.uploadManifestFingerprintSha256,
      "uploadManifestFingerprintSha256",
    ),
    files: validateFiles(claim.files),
  };
  if (normalizedClaim.uploadRequestFingerprint !== uploadRequestFingerprint) {
    throw new Error("Stored preview upload fingerprint is inconsistent.");
  }
  const totalExpectedBytes = normalizedClaim.files.reduce(
    (total, file) => total + file.expectedByteLength,
    0,
  );
  if (
    !Number.isSafeInteger(totalExpectedBytes) ||
    totalExpectedBytes > maximumBatchBytes
  ) {
    throw new Error("Preview manifest exceeds the approved batch capacity.");
  }

  let prepared: PreparedImportPreview;
  try {
    prepared = validatePreparedPreview(
      await processor.preparePreview({
        ownerId: normalizedClaim.ownerId,
        uploadBatchId: normalizedClaim.uploadBatchId,
        previewDispatchId,
        uploadRequestFingerprint,
        uploadManifestFingerprintSha256:
          normalizedClaim.uploadManifestFingerprintSha256,
        files: normalizedClaim.files,
        maximumBatchBytes,
      }),
      normalizedClaim,
    );
  } catch (error) {
    const reason =
      error instanceof ImportPreviewProcessingFailure
        ? error.reason
        : "preview_processor_failed";
    await recordPreviewFailureSafely(repository, {
      ownerId: normalizedClaim.ownerId,
      uploadBatchId: normalizedClaim.uploadBatchId,
      previewDispatchId,
      workerId,
      uploadRequestFingerprint,
      failedAt: claimedAt,
      reason,
    });
    throw new Error("Private import preview processing failed.");
  }

  let publication: Awaited<
    ReturnType<ImportPreviewProcessingRepository["publishPreparedPreview"]>
  >;
  try {
    publication = await repository.publishPreparedPreview({
      ownerId: normalizedClaim.ownerId,
      uploadBatchId: normalizedClaim.uploadBatchId,
      previewDispatchId,
      uploadRequestFingerprint,
      uploadManifestFingerprintSha256:
        normalizedClaim.uploadManifestFingerprintSha256,
      previewId: prepared.previewId,
      previewFingerprintSha256: prepared.previewFingerprintSha256,
      fileCount: prepared.fileCount,
      sourceFamilyCount: prepared.sourceFamilyCount,
      blockingIssueCount: prepared.blockingIssueCount,
      confirmable: prepared.confirmable,
      completedAt: claimedAt,
    });
  } catch {
    throw new Error("Private import preview publication is unavailable.");
  }
  if (
    (publication.disposition !== "created" &&
      publication.disposition !== "existing") ||
    publication.uploadRequestFingerprint !== uploadRequestFingerprint ||
    publication.uploadManifestFingerprintSha256 !==
      normalizedClaim.uploadManifestFingerprintSha256 ||
    publication.previewId !== prepared.previewId ||
    publication.previewFingerprintSha256 !==
      prepared.previewFingerprintSha256 ||
    publication.confirmable !== prepared.confirmable
  ) {
    throw new Error("Stored preview publication state is inconsistent.");
  }
  return {
    status: "completed",
    uploadBatchId: normalizedClaim.uploadBatchId,
    previewId: prepared.previewId,
    previewFingerprintSha256: prepared.previewFingerprintSha256,
    confirmable: prepared.confirmable,
    disposition: publication.disposition,
  };
}
