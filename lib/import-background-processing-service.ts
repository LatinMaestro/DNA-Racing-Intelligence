export type BackgroundDispatchClaim =
  | Readonly<{ status: "not_found" }>
  | Readonly<{ status: "already_complete"; updateSessionId: string }>
  | Readonly<{ status: "leased_elsewhere"; retryAfter: string }>
  | Readonly<{
      status: "claimed";
      ownerId: string;
      updateSessionId: string;
      previewFingerprintSha256: string;
    }>;

export type PreparedImportResult = Readonly<{
  preparedResultId: string;
  sourceVersionCount: number;
  quarantinedRecordCount: number;
  aggregateRefreshRequired: boolean;
}>;

export type BackgroundImportProcessingRepository = Readonly<{
  claimDispatch: (input: {
    dispatchId: string;
    workerId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) => Promise<BackgroundDispatchClaim>;
  activatePreparedResult: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    preparedResultId: string;
    completedAt: string;
    sourceVersionCount: number;
    quarantinedRecordCount: number;
    aggregateRefreshRequired: boolean;
  }) => Promise<void>;
  recordProcessingFailure: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    workerId: string;
    failedAt: string;
    reason: "processor_failed";
  }) => Promise<void>;
}>;

export type BoundedImportProcessor = Readonly<{
  prepare: (input: {
    ownerId: string;
    updateSessionId: string;
    dispatchId: string;
    previewFingerprintSha256: string;
  }) => Promise<PreparedImportResult>;
}>;

export type BackgroundProcessingCapabilities =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: BackgroundImportProcessingRepository;
      processor: BoundedImportProcessor;
    }>;

export type BackgroundDispatchResult =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "already_complete";
      updateSessionId: string;
    }>
  | Readonly<{
      status: "leased_elsewhere";
      retryAfter: string;
    }>
  | Readonly<{
      status: "completed";
      updateSessionId: string;
      preparedResultId: string;
      aggregateRefreshRequired: boolean;
    }>;

const SAFE_IDENTIFIER_PATTERN = /^[a-zA-Z0-9][a-zA-Z0-9._:-]{0,127}$/;
const SHA_256_PATTERN = /^[a-f0-9]{64}$/;

function requireSafeIdentifier(value: unknown, field: string): string {
  if (typeof value !== "string") throw new Error(`${field} is invalid`);
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

function normalizePreparedResult(
  result: PreparedImportResult,
): PreparedImportResult {
  const preparedResultId = requireSafeIdentifier(
    result.preparedResultId,
    "preparedResultId",
  );
  for (const field of [
    "sourceVersionCount",
    "quarantinedRecordCount",
  ] as const) {
    if (!Number.isSafeInteger(result[field]) || result[field] < 0) {
      throw new Error(`${field} must be a non-negative safe integer`);
    }
  }
  if (result.sourceVersionCount === 0) {
    throw new Error("sourceVersionCount must be positive");
  }
  if (
    result.aggregateRefreshRequired !== true &&
    result.aggregateRefreshRequired !== false
  ) {
    throw new Error("aggregateRefreshRequired must be a Boolean");
  }
  return { ...result, preparedResultId };
}

function normalizeClaim(
  value: unknown,
  claimedAt: string,
  maximumRetryAt: string,
): BackgroundDispatchClaim {
  if (typeof value !== "object" || value === null || !("status" in value)) {
    throw new Error("dispatch claim is invalid");
  }
  const claim = value as Record<string, unknown>;
  switch (claim.status) {
    case "not_found":
      return { status: "not_found" };
    case "already_complete":
      return {
        status: "already_complete",
        updateSessionId: requireSafeIdentifier(
          claim.updateSessionId,
          "updateSessionId",
        ),
      };
    case "leased_elsewhere": {
      if (typeof claim.retryAfter !== "string") {
        throw new Error("retryAfter must be a canonical future timestamp");
      }
      const retryAfter = new Date(claim.retryAfter);
      if (
        Number.isNaN(retryAfter.getTime()) ||
        retryAfter.toISOString() !== claim.retryAfter ||
        claim.retryAfter <= claimedAt ||
        claim.retryAfter > maximumRetryAt
      ) {
        throw new Error("retryAfter must be a canonical future timestamp");
      }
      return { status: "leased_elsewhere", retryAfter: claim.retryAfter };
    }
    case "claimed": {
      if (
        typeof claim.previewFingerprintSha256 !== "string" ||
        !SHA_256_PATTERN.test(claim.previewFingerprintSha256)
      ) {
        throw new Error("previewFingerprintSha256 is invalid");
      }
      return {
        status: "claimed",
        ownerId: requireSafeIdentifier(claim.ownerId, "ownerId"),
        updateSessionId: requireSafeIdentifier(
          claim.updateSessionId,
          "updateSessionId",
        ),
        previewFingerprintSha256: claim.previewFingerprintSha256,
      };
    }
    default:
      throw new Error("dispatch claim status is invalid");
  }
}

export async function runBackgroundImportDispatch(
  input: Readonly<{
    dispatchId: string;
    workerId: string;
    now: Date;
    leaseDurationMilliseconds: number;
    capabilities: BackgroundProcessingCapabilities;
  }>,
): Promise<BackgroundDispatchResult> {
  if (input.capabilities.status === "not_configured") {
    return { status: "not_configured" };
  }

  const dispatchId = requireSafeIdentifier(input.dispatchId, "dispatchId");
  const workerId = requireSafeIdentifier(input.workerId, "workerId");
  const claimedAt = canonicalTimestamp(input.now, "now");
  if (
    !Number.isSafeInteger(input.leaseDurationMilliseconds) ||
    input.leaseDurationMilliseconds <= 0 ||
    input.leaseDurationMilliseconds > 60 * 60 * 1000
  ) {
    throw new Error("leaseDurationMilliseconds must be between 1 and 3600000");
  }
  const leaseExpiresAt = canonicalTimestamp(
    new Date(input.now.getTime() + input.leaseDurationMilliseconds),
    "leaseExpiresAt",
  );
  const maximumRetryAt = canonicalTimestamp(
    new Date(input.now.getTime() + 60 * 60 * 1000),
    "maximumRetryAt",
  );

  const { repository, processor } = input.capabilities;
  const claim = normalizeClaim(
    await repository.claimDispatch({
      dispatchId,
      workerId,
      claimedAt,
      leaseExpiresAt,
    }),
    claimedAt,
    maximumRetryAt,
  );

  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status === "already_complete") {
    return {
      status: "already_complete",
      updateSessionId: claim.updateSessionId,
    };
  }
  if (claim.status === "leased_elsewhere") {
    return {
      status: "leased_elsewhere",
      retryAfter: claim.retryAfter,
    };
  }

  let prepared: PreparedImportResult;
  try {
    prepared = normalizePreparedResult(
      await processor.prepare({
        ownerId: claim.ownerId,
        updateSessionId: claim.updateSessionId,
        dispatchId,
        previewFingerprintSha256: claim.previewFingerprintSha256,
      }),
    );
  } catch {
    await repository.recordProcessingFailure({
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      dispatchId,
      workerId,
      failedAt: claimedAt,
      reason: "processor_failed",
    });
    throw new Error("Background import processing failed.");
  }

  await repository.activatePreparedResult({
    ownerId: claim.ownerId,
    updateSessionId: claim.updateSessionId,
    dispatchId,
    preparedResultId: prepared.preparedResultId,
    completedAt: claimedAt,
    sourceVersionCount: prepared.sourceVersionCount,
    quarantinedRecordCount: prepared.quarantinedRecordCount,
    aggregateRefreshRequired: prepared.aggregateRefreshRequired,
  });

  return {
    status: "completed",
    updateSessionId: claim.updateSessionId,
    preparedResultId: prepared.preparedResultId,
    aggregateRefreshRequired: prepared.aggregateRefreshRequired,
  };
}
