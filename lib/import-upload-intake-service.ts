import { createHash } from "node:crypto";

export const importUploadSourceFamilies = [
  "race_merge",
  "core_details",
  "current_arena",
] as const;

export const maxImportUploadFilesPerBatch = 24;

export type ImportUploadSourceFamily =
  (typeof importUploadSourceFamilies)[number];

export type ImportUploadCandidate = Readonly<{
  clientFileId: string;
  sourceFamily: ImportUploadSourceFamily;
  originalFileName: string;
  contentType: string;
  byteLength: number;
  sha256: string;
}>;

export type ReservedImportUpload = Readonly<{
  clientFileId: string;
  uploadFileId: string;
}>;

export type ImportUploadIntakeRepository = Readonly<{
  reserveUploadBatch: (input: {
    ownerId: string;
    idempotencyKey: string;
    requestedAt: string;
    requestFingerprint: string;
    files: readonly ImportUploadCandidate[];
  }) => Promise<
    Readonly<{
      disposition: "created" | "existing";
      uploadBatchId: string;
      requestFingerprint: string;
      files: readonly ReservedImportUpload[];
    }>
  >;
  markUploadTargetsReady: (input: {
    ownerId: string;
    uploadBatchId: string;
    uploadFileIds: readonly string[];
    requestFingerprint: string;
    expiresAt: string;
  }) => Promise<void>;
  markUploadReservationFailed: (input: {
    ownerId: string;
    uploadBatchId: string;
    failedAt: string;
    requestFingerprint: string;
    reason: "private_object_target_unavailable";
  }) => Promise<void>;
}>;

export type ImportUploadCapacityGate = Readonly<{
  assertWithinApprovedCapacity: (input: {
    ownerId: string;
    fileCount: number;
    totalByteLength: number;
    sourceFamilies: readonly ImportUploadSourceFamily[];
  }) => Promise<void>;
}>;

export type PrivateImportUploadTargetStore = Readonly<{
  createDirectUploadTarget: (input: {
    ownerId: string;
    uploadBatchId: string;
    uploadFileId: string;
    byteLength: number;
    sha256: string;
    contentType: string;
    expiresAt: string;
  }) => Promise<
    Readonly<{
      method: "PUT";
      targetToken: string;
    }>
  >;
}>;

export type ImportUploadIntakeCapabilities =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: ImportUploadIntakeRepository;
      capacityGate: ImportUploadCapacityGate;
      privateObjectStore: PrivateImportUploadTargetStore;
    }>;

export type ImportUploadTarget = Readonly<{
  clientFileId: string;
  uploadFileId: string;
  method: "PUT";
  targetToken: string;
}>;

export type ImportUploadIntakeResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      disposition: "created" | "existing";
      uploadBatchId: string;
      requestFingerprint: string;
      expiresAt: string;
      targets: readonly ImportUploadTarget[];
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const MAX_FILE_BYTES = 5 * 1024 * 1024 * 1024;
const MAX_FILE_NAME_LENGTH = 255;
const MAX_TARGET_TOKEN_LENGTH = 8192;
const ALLOWED_CONTENT_TYPES = new Set([
  "application/csv",
  "application/octet-stream",
  "application/vnd.ms-excel",
  "text/csv",
  "text/plain",
]);

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

function canonicalTimestamp(value: Date, field: string): string {
  if (Number.isNaN(value.getTime())) throw new Error(`${field} must be valid`);
  return value.toISOString();
}

function normalizeFileName(value: string): string {
  const normalized = value.trim();
  if (
    normalized === "" ||
    normalized.length > MAX_FILE_NAME_LENGTH ||
    /[/\\\u0000-\u001f\u007f]/.test(normalized) ||
    !normalized.toLowerCase().endsWith(".csv")
  ) {
    throw new Error("originalFileName is invalid");
  }
  return normalized;
}

function normalizeContentType(value: string): string {
  const normalized = value.trim().toLowerCase().split(";", 1)[0] ?? "";
  if (!ALLOWED_CONTENT_TYPES.has(normalized)) {
    throw new Error("contentType is unsupported");
  }
  return normalized;
}

function validateCandidate(
  candidate: ImportUploadCandidate,
): ImportUploadCandidate {
  const clientFileId = requireSafeIdentifier(
    candidate.clientFileId,
    "clientFileId",
  );
  if (!importUploadSourceFamilies.includes(candidate.sourceFamily)) {
    throw new Error("sourceFamily is invalid");
  }
  if (
    !Number.isSafeInteger(candidate.byteLength) ||
    candidate.byteLength <= 0 ||
    candidate.byteLength > MAX_FILE_BYTES
  ) {
    throw new Error("byteLength is outside the supported boundary");
  }
  if (!SHA_256_PATTERN.test(candidate.sha256)) {
    throw new Error("sha256 is invalid");
  }
  return {
    clientFileId,
    sourceFamily: candidate.sourceFamily,
    originalFileName: normalizeFileName(candidate.originalFileName),
    contentType: normalizeContentType(candidate.contentType),
    byteLength: candidate.byteLength,
    sha256: candidate.sha256,
  };
}

function validateCandidates(
  candidates: readonly ImportUploadCandidate[],
): readonly ImportUploadCandidate[] {
  if (
    candidates.length === 0 ||
    candidates.length > maxImportUploadFilesPerBatch
  ) {
    throw new Error(
      `files must contain between 1 and ${maxImportUploadFilesPerBatch} candidates`,
    );
  }
  const validated = candidates.map(validateCandidate);
  const clientFileIds = new Set<string>();
  const replacementFamilies = new Set<ImportUploadSourceFamily>();
  for (const candidate of validated) {
    if (clientFileIds.has(candidate.clientFileId)) {
      throw new Error("clientFileId must be unique within the batch");
    }
    clientFileIds.add(candidate.clientFileId);
    if (candidate.sourceFamily !== "race_merge") {
      if (replacementFamilies.has(candidate.sourceFamily)) {
        throw new Error(
          `${candidate.sourceFamily} accepts one replacement candidate per batch`,
        );
      }
      replacementFamilies.add(candidate.sourceFamily);
    }
  }
  return validated;
}

function validateReservation(
  reservation: Awaited<
    ReturnType<ImportUploadIntakeRepository["reserveUploadBatch"]>
  >,
  candidates: readonly ImportUploadCandidate[],
  requestFingerprint: string,
): Readonly<{
  disposition: "created" | "existing";
  uploadBatchId: string;
  requestFingerprint: string;
  files: readonly ReservedImportUpload[];
}> {
  const uploadBatchId = requireSafeIdentifier(
    reservation.uploadBatchId,
    "uploadBatchId",
  );
  if (!["created", "existing"].includes(reservation.disposition)) {
    throw new Error("Reserved upload disposition is invalid");
  }
  if (
    !SHA_256_PATTERN.test(reservation.requestFingerprint) ||
    reservation.requestFingerprint !== requestFingerprint
  ) {
    throw new Error("Reserved upload fingerprint does not match request");
  }
  if (reservation.files.length !== candidates.length) {
    throw new Error("Reserved upload file count does not match request");
  }
  const expectedClientIds = new Set(
    candidates.map((candidate) => candidate.clientFileId),
  );
  const observedClientIds = new Set<string>();
  const observedUploadIds = new Set<string>();
  const files = reservation.files.map((file) => {
    const clientFileId = requireSafeIdentifier(
      file.clientFileId,
      "clientFileId",
    );
    const uploadFileId = requireSafeIdentifier(
      file.uploadFileId,
      "uploadFileId",
    );
    if (
      !expectedClientIds.has(clientFileId) ||
      observedClientIds.has(clientFileId) ||
      observedUploadIds.has(uploadFileId)
    ) {
      throw new Error("Reserved upload identity set is inconsistent");
    }
    observedClientIds.add(clientFileId);
    observedUploadIds.add(uploadFileId);
    return { clientFileId, uploadFileId };
  });
  return {
    disposition: reservation.disposition,
    uploadBatchId,
    requestFingerprint,
    files,
  };
}

function requestFingerprint(input: {
  idempotencyKey: string;
  files: readonly ImportUploadCandidate[];
}): string {
  return createHash("sha256").update(JSON.stringify(input)).digest("hex");
}

export const unavailableImportUploadIntakeCapabilities: ImportUploadIntakeCapabilities =
  Object.freeze({ status: "not_configured" });

export async function beginPrivateImportUpload(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    idempotencyKey: string;
    files: readonly ImportUploadCandidate[];
    now: Date;
    targetLifetimeMilliseconds: number;
    capabilities: ImportUploadIntakeCapabilities;
  }>,
): Promise<ImportUploadIntakeResult> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);
  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Private import upload access denied.");
  }
  if (input.capabilities.status === "not_configured") {
    return { status: "not_configured" };
  }

  const idempotencyKey = requireSafeIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const requestedAt = canonicalTimestamp(input.now, "now");
  if (
    !Number.isSafeInteger(input.targetLifetimeMilliseconds) ||
    input.targetLifetimeMilliseconds < 60_000 ||
    input.targetLifetimeMilliseconds > 60 * 60 * 1000
  ) {
    throw new Error(
      "targetLifetimeMilliseconds must be between 60000 and 3600000",
    );
  }
  const expiresAt = new Date(
    input.now.getTime() + input.targetLifetimeMilliseconds,
  ).toISOString();
  const files = validateCandidates(input.files);
  const fingerprint = requestFingerprint({ idempotencyKey, files });
  const totalByteLength = files.reduce(
    (total, file) => total + file.byteLength,
    0,
  );
  if (!Number.isSafeInteger(totalByteLength)) {
    throw new Error("totalByteLength exceeds the safe integer boundary");
  }

  const { repository, capacityGate, privateObjectStore } = input.capabilities;
  await capacityGate.assertWithinApprovedCapacity({
    ownerId: authenticatedOwnerId,
    fileCount: files.length,
    totalByteLength,
    sourceFamilies: files.map((file) => file.sourceFamily),
  });

  const rawReservation = await repository.reserveUploadBatch({
    ownerId: authenticatedOwnerId,
    idempotencyKey,
    requestedAt,
    requestFingerprint: fingerprint,
    files,
  });
  let reservation: ReturnType<typeof validateReservation>;
  try {
    reservation = validateReservation(rawReservation, files, fingerprint);
  } catch {
    const uploadBatchId = rawReservation.uploadBatchId.trim();
    if (SAFE_IDENTIFIER_PATTERN.test(uploadBatchId)) {
      try {
        await repository.markUploadReservationFailed({
          ownerId: authenticatedOwnerId,
          uploadBatchId,
          failedAt: requestedAt,
          requestFingerprint: fingerprint,
          reason: "private_object_target_unavailable",
        });
      } catch {
        // Preserve the reservation-integrity failure.
      }
    }
    throw new Error("Reserved private upload identity set is inconsistent.");
  }
  const filesByClientId = new Map(
    files.map((file) => [file.clientFileId, file]),
  );

  try {
    const targets: ImportUploadTarget[] = [];
    for (const reserved of reservation.files) {
      const file = filesByClientId.get(reserved.clientFileId);
      if (file === undefined) {
        throw new Error("Reserved upload candidate is unavailable");
      }
      const target = await privateObjectStore.createDirectUploadTarget({
        ownerId: authenticatedOwnerId,
        uploadBatchId: reservation.uploadBatchId,
        uploadFileId: reserved.uploadFileId,
        byteLength: file.byteLength,
        sha256: file.sha256,
        contentType: file.contentType,
        expiresAt,
      });
      const targetToken = target.targetToken.trim();
      if (
        target.method !== "PUT" ||
        targetToken === "" ||
        targetToken.length > MAX_TARGET_TOKEN_LENGTH ||
        /[\u0000-\u001f\u007f]/.test(targetToken)
      ) {
        throw new Error("Private upload target is invalid");
      }
      targets.push({
        clientFileId: reserved.clientFileId,
        uploadFileId: reserved.uploadFileId,
        method: "PUT",
        targetToken,
      });
    }
    await repository.markUploadTargetsReady({
      ownerId: authenticatedOwnerId,
      uploadBatchId: reservation.uploadBatchId,
      uploadFileIds: reservation.files.map((file) => file.uploadFileId),
      requestFingerprint: fingerprint,
      expiresAt,
    });
    return {
      status: "ready",
      disposition: reservation.disposition,
      uploadBatchId: reservation.uploadBatchId,
      requestFingerprint: reservation.requestFingerprint,
      expiresAt,
      targets,
    };
  } catch {
    try {
      await repository.markUploadReservationFailed({
        ownerId: authenticatedOwnerId,
        uploadBatchId: reservation.uploadBatchId,
        failedAt: requestedAt,
        requestFingerprint: fingerprint,
        reason: "private_object_target_unavailable",
      });
    } catch {
      // Preserve the original private-object target failure.
    }
    throw new Error("Private import upload target creation failed.");
  }
}
