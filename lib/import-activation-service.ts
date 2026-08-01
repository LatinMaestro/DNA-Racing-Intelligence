export type ImportActivationCapability<T> =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "ready"; service: T }>;

export type ImportActivationRepository = Readonly<{
  reserveConfirmedUpdate: (input: {
    ownerId: string;
    previewId: string;
    previewFingerprintSha256: string;
    idempotencyKey: string;
    confirmedAt: string;
  }) => Promise<
    Readonly<{
      updateSessionId: string;
      dispatchId: string;
      disposition: "created" | "existing";
      dispatchState: "pending" | "queued";
    }>
  >;
  markDispatchQueued: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    queuedAt: string;
  }) => Promise<void>;
  markDispatchFailed: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    failedAt: string;
    reason: "queue_unavailable";
  }) => Promise<void>;
}>;

export type PrivateRawUploadStore = Readonly<{
  assertPreviewUploadsReady: (input: {
    ownerId: string;
    previewId: string;
    previewFingerprintSha256: string;
  }) => Promise<void>;
}>;

export type ImportCapacityGate = Readonly<{
  assertWithinApprovedCapacity: (input: {
    ownerId: string;
    previewId: string;
  }) => Promise<void>;
}>;

export type BackgroundImportQueue = Readonly<{
  enqueue: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
  }) => Promise<void>;
}>;

export type ImportActivationCapabilities = Readonly<{
  repository: ImportActivationCapability<ImportActivationRepository>;
  rawUploadStore: ImportActivationCapability<PrivateRawUploadStore>;
  capacityGate: ImportActivationCapability<ImportCapacityGate>;
  backgroundQueue: ImportActivationCapability<BackgroundImportQueue>;
}>;

export type ImportActivationResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{
      status: "not_configured";
      missingCapabilities: readonly ImportActivationCapabilityName[];
    }>
  | Readonly<{
      status: "queued";
      updateSessionId: string;
      dispatchId: string;
      disposition: "created" | "existing";
    }>;

export const importActivationCapabilityNames = [
  "repository",
  "raw_upload_store",
  "capacity_gate",
  "background_queue",
] as const;
export type ImportActivationCapabilityName =
  (typeof importActivationCapabilityNames)[number];

const SHA_256_PATTERN = /^[a-f0-9]{64}$/;
const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

function normalizedIdentity(value: string | null): string | null {
  const result = value?.trim() ?? "";
  return result === "" ? null : result;
}

function requireSafeIdentifier(value: string, field: string): string {
  const normalized = value.trim();
  if (!SAFE_IDENTIFIER_PATTERN.test(normalized)) {
    throw new Error(`${field} is invalid`);
  }
  return normalized;
}

function canonicalTimestamp(now: Date): string {
  if (Number.isNaN(now.getTime())) throw new Error("now must be valid");
  return now.toISOString();
}

function requireReservationDisposition(
  value: unknown,
): "created" | "existing" {
  if (value !== "created" && value !== "existing") {
    throw new Error("reservation.disposition is invalid");
  }
  return value;
}

function requireDispatchState(value: unknown): "pending" | "queued" {
  if (value !== "pending" && value !== "queued") {
    throw new Error("reservation.dispatchState is invalid");
  }
  return value;
}

function missingCapabilities(
  capabilities: ImportActivationCapabilities,
): ImportActivationCapabilityName[] {
  const missing: ImportActivationCapabilityName[] = [];
  if (capabilities.repository.status === "not_configured") {
    missing.push("repository");
  }
  if (capabilities.rawUploadStore.status === "not_configured") {
    missing.push("raw_upload_store");
  }
  if (capabilities.capacityGate.status === "not_configured") {
    missing.push("capacity_gate");
  }
  if (capabilities.backgroundQueue.status === "not_configured") {
    missing.push("background_queue");
  }
  return missing;
}

export const unavailableImportActivationCapabilities: ImportActivationCapabilities =
  Object.freeze({
    repository: Object.freeze({ status: "not_configured" }),
    rawUploadStore: Object.freeze({ status: "not_configured" }),
    capacityGate: Object.freeze({ status: "not_configured" }),
    backgroundQueue: Object.freeze({ status: "not_configured" }),
  });

export async function activateConfirmedDataUpdate(
  input: Readonly<{
    authenticatedOwnerId: string | null;
    configuredOwnerId: string | null;
    previewId: string;
    previewFingerprintSha256: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
    capabilities: ImportActivationCapabilities;
    now: Date;
  }>,
): Promise<ImportActivationResult> {
  const authenticatedOwnerId = normalizedIdentity(input.authenticatedOwnerId);
  const configuredOwnerId = normalizedIdentity(input.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Data update activation access denied.");
  }

  const missing = missingCapabilities(input.capabilities);
  if (missing.length > 0) {
    return { status: "not_configured", missingCapabilities: missing };
  }
  if (
    input.capabilities.repository.status !== "ready" ||
    input.capabilities.rawUploadStore.status !== "ready" ||
    input.capabilities.capacityGate.status !== "ready" ||
    input.capabilities.backgroundQueue.status !== "ready"
  ) {
    throw new Error("Import activation capability state is inconsistent.");
  }
  if (input.explicitlyConfirmed !== true) {
    throw new Error("Explicit owner confirmation is required.");
  }

  const previewId = requireSafeIdentifier(input.previewId, "previewId");
  const idempotencyKey = requireSafeIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );
  if (!SHA_256_PATTERN.test(input.previewFingerprintSha256)) {
    throw new Error("previewFingerprintSha256 is invalid");
  }
  const occurredAt = canonicalTimestamp(input.now);

  const repository = input.capabilities.repository.service;
  const rawUploadStore = input.capabilities.rawUploadStore.service;
  const capacityGate = input.capabilities.capacityGate.service;
  const backgroundQueue = input.capabilities.backgroundQueue.service;

  await capacityGate.assertWithinApprovedCapacity({
    ownerId: authenticatedOwnerId,
    previewId,
  });
  await rawUploadStore.assertPreviewUploadsReady({
    ownerId: authenticatedOwnerId,
    previewId,
    previewFingerprintSha256: input.previewFingerprintSha256,
  });

  const reservation = await repository.reserveConfirmedUpdate({
    ownerId: authenticatedOwnerId,
    previewId,
    previewFingerprintSha256: input.previewFingerprintSha256,
    idempotencyKey,
    confirmedAt: occurredAt,
  });
  const updateSessionId = requireSafeIdentifier(
    reservation.updateSessionId,
    "reservation.updateSessionId",
  );
  const dispatchId = requireSafeIdentifier(
    reservation.dispatchId,
    "reservation.dispatchId",
  );
  const disposition = requireReservationDisposition(reservation.disposition);
  const dispatchState = requireDispatchState(reservation.dispatchState);

  if (dispatchState === "queued") {
    return {
      status: "queued",
      updateSessionId,
      dispatchId,
      disposition,
    };
  }

  try {
    await backgroundQueue.enqueue({
      ownerId: authenticatedOwnerId,
      updateSessionId,
      dispatchId,
    });
  } catch {
    await repository.markDispatchFailed({
      ownerId: authenticatedOwnerId,
      updateSessionId,
      dispatchId,
      failedAt: occurredAt,
      reason: "queue_unavailable",
    });
    throw new Error("Background import dispatch failed.");
  }

  await repository.markDispatchQueued({
    ownerId: authenticatedOwnerId,
    updateSessionId,
    dispatchId,
    queuedAt: occurredAt,
  });

  return {
    status: "queued",
    updateSessionId,
    dispatchId,
    disposition,
  };
}
