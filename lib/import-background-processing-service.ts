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

function assertPreparedResult(result: PreparedImportResult): void {
  requireSafeIdentifier(result.preparedResultId, "preparedResultId");
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
}

function assertClaim(claim: BackgroundDispatchClaim): void {
  if (claim.status === "already_complete") {
    requireSafeIdentifier(claim.updateSessionId, "updateSessionId");
  }
  if (claim.status === "leased_elsewhere") {
    const retryAfter = new Date(claim.retryAfter);
    if (
      Number.isNaN(retryAfter.getTime()) ||
      retryAfter.toISOString() !== claim.retryAfter
    ) {
      throw new Error("retryAfter must be a canonical timestamp");
    }
  }
  if (claim.status === "claimed") {
    requireSafeIdentifier(claim.ownerId, "ownerId");
    requireSafeIdentifier(claim.updateSessionId, "updateSessionId");
    if (!SHA_256_PATTERN.test(claim.previewFingerprintSha256)) {
      throw new Error("previewFingerprintSha256 is invalid");
    }
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
  const leaseExpiresAt = new Date(
    input.now.getTime() + input.leaseDurationMilliseconds,
  ).toISOString();

  const { repository, processor } = input.capabilities;
  const claim = await repository.claimDispatch({
    dispatchId,
    workerId,
    claimedAt,
    leaseExpiresAt,
  });
  assertClaim(claim);

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
    prepared = await processor.prepare({
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      dispatchId,
      previewFingerprintSha256: claim.previewFingerprintSha256,
    });
    assertPreparedResult(prepared);
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
