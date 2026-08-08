export type AggregateRetryCapability<T> =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "ready"; service: T }>;

export type AggregateRetryRepository = Readonly<{
  reserveRetry: (input: {
    ownerId: string;
    failedRefreshId: string;
    reason: string;
    idempotencyKey: string;
    requestedAt: string;
  }) => Promise<
    | Readonly<{ status: "not_found" }>
    | Readonly<{
        status: "not_retryable";
        refreshStatus: "pending" | "running" | "completed" | "superseded";
      }>
    | Readonly<{
        status: "reserved";
        refreshId: string;
        dispatchId: string;
        disposition: "created" | "existing";
        dispatchState: "pending" | "queued";
      }>
  >;
  markDispatchQueued: (input: {
    ownerId: string;
    refreshId: string;
    dispatchId: string;
    queuedAt: string;
  }) => Promise<void>;
  markDispatchFailed: (input: {
    ownerId: string;
    refreshId: string;
    dispatchId: string;
    failedAt: string;
    reason: "queue_unavailable";
  }) => Promise<void>;
}>;

export type AggregateRetryQueue = Readonly<{
  enqueue: (input: {
    ownerId: string;
    refreshId: string;
    dispatchId: string;
  }) => Promise<void>;
}>;

export type AggregateRetryCapabilities = Readonly<{
  repository: AggregateRetryCapability<AggregateRetryRepository>;
  backgroundQueue: AggregateRetryCapability<AggregateRetryQueue>;
}>;

export type AggregateRetryActionDependencies = Readonly<{
  resolveAuthenticatedOwnerId: () => Promise<string | null>;
  configuredOwnerId: string | null;
  now: () => Date;
  capabilities: AggregateRetryCapabilities;
}>;

export type AggregateRetryActionResult =
  | Readonly<{ status: "identity_not_connected" }>
  | Readonly<{
      status: "not_configured";
      missingCapabilities: readonly ("repository" | "background_queue")[];
    }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "not_retryable";
      refreshStatus: "pending" | "running" | "completed" | "superseded";
    }>
  | Readonly<{
      status: "queued";
      refreshId: string;
      dispatchId: string;
      disposition: "created" | "existing";
    }>;

export const unavailableAggregateRetryCapabilities: AggregateRetryCapabilities =
  Object.freeze({
    repository: Object.freeze({ status: "not_configured" }),
    backgroundQueue: Object.freeze({ status: "not_configured" }),
  });

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;

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

function requireReason(value: string): string {
  const normalized = value.trim();
  if (normalized.length < 10 || normalized.length > 500) {
    throw new Error("retryReason must be between 10 and 500 characters");
  }
  return normalized;
}

function canonicalTimestamp(value: Date): string {
  if (Number.isNaN(value.getTime())) throw new Error("now must be valid");
  return value.toISOString();
}

function missingCapabilities(
  capabilities: AggregateRetryCapabilities,
): ("repository" | "background_queue")[] {
  const missing: ("repository" | "background_queue")[] = [];
  if (capabilities.repository.status === "not_configured") {
    missing.push("repository");
  }
  if (capabilities.backgroundQueue.status === "not_configured") {
    missing.push("background_queue");
  }
  return missing;
}

function assertReservation(
  reservation: Awaited<ReturnType<AggregateRetryRepository["reserveRetry"]>>,
): void {
  if (reservation.status === "not_retryable") {
    if (
      !["pending", "running", "completed", "superseded"].includes(
        reservation.refreshStatus,
      )
    ) {
      throw new Error("Aggregate retry reservation status is invalid.");
    }
    return;
  }
  if (reservation.status !== "reserved") return;
  requireSafeIdentifier(reservation.refreshId, "refreshId");
  requireSafeIdentifier(reservation.dispatchId, "dispatchId");
  if (!["created", "existing"].includes(reservation.disposition)) {
    throw new Error("Aggregate retry reservation disposition is invalid.");
  }
  if (!["pending", "queued"].includes(reservation.dispatchState)) {
    throw new Error("Aggregate retry dispatch state is invalid.");
  }
}

export async function retryOwnerAggregateRefresh(
  input: Readonly<{
    failedRefreshId: string;
    retryReason: string;
    idempotencyKey: string;
    explicitlyConfirmed: boolean;
  }>,
  dependencies: AggregateRetryActionDependencies,
): Promise<AggregateRetryActionResult> {
  const authenticatedOwnerId = normalizedIdentity(
    await dependencies.resolveAuthenticatedOwnerId(),
  );
  const configuredOwnerId = normalizedIdentity(dependencies.configuredOwnerId);

  if (authenticatedOwnerId === null || configuredOwnerId === null) {
    return { status: "identity_not_connected" };
  }
  if (authenticatedOwnerId !== configuredOwnerId) {
    throw new Error("Aggregate refresh retry access denied.");
  }

  const missing = missingCapabilities(dependencies.capabilities);
  if (missing.length > 0) {
    return { status: "not_configured", missingCapabilities: missing };
  }
  if (
    dependencies.capabilities.repository.status !== "ready" ||
    dependencies.capabilities.backgroundQueue.status !== "ready"
  ) {
    throw new Error("Aggregate retry capability state is inconsistent.");
  }
  if (!input.explicitlyConfirmed) {
    throw new Error("Explicit owner confirmation is required.");
  }

  const failedRefreshId = requireSafeIdentifier(
    input.failedRefreshId,
    "failedRefreshId",
  );
  const reason = requireReason(input.retryReason);
  const idempotencyKey = requireSafeIdentifier(
    input.idempotencyKey,
    "idempotencyKey",
  );
  const occurredAt = canonicalTimestamp(dependencies.now());
  const repository = dependencies.capabilities.repository.service;
  const backgroundQueue = dependencies.capabilities.backgroundQueue.service;

  const reservation = await repository.reserveRetry({
    ownerId: authenticatedOwnerId,
    failedRefreshId,
    reason,
    idempotencyKey,
    requestedAt: occurredAt,
  });
  assertReservation(reservation);

  if (reservation.status === "not_found") return reservation;
  if (reservation.status === "not_retryable") return reservation;

  const refreshId = requireSafeIdentifier(reservation.refreshId, "refreshId");
  const dispatchId = requireSafeIdentifier(
    reservation.dispatchId,
    "dispatchId",
  );
  if (reservation.dispatchState === "queued") {
    return {
      status: "queued",
      refreshId,
      dispatchId,
      disposition: reservation.disposition,
    };
  }

  try {
    await backgroundQueue.enqueue({
      ownerId: authenticatedOwnerId,
      refreshId,
      dispatchId,
    });
  } catch {
    try {
      await repository.markDispatchFailed({
        ownerId: authenticatedOwnerId,
        refreshId,
        dispatchId,
        failedAt: occurredAt,
        reason: "queue_unavailable",
      });
    } catch {
      // Preserve the sanitized queue failure returned to the action caller.
    }
    throw new Error("Aggregate refresh retry dispatch failed.");
  }

  await repository.markDispatchQueued({
    ownerId: authenticatedOwnerId,
    refreshId,
    dispatchId,
    queuedAt: occurredAt,
  });

  return {
    status: "queued",
    refreshId,
    dispatchId,
    disposition: reservation.disposition,
  };
}
