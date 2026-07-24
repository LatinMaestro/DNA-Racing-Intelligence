export type AggregateRefreshClaim =
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "already_complete";
      updateSessionId: string;
      aggregateSetId: string;
    }>
  | Readonly<{ status: "leased_elsewhere"; retryAfter: string }>
  | Readonly<{
      status: "claimed";
      ownerId: string;
      updateSessionId: string;
      sourceVersionSetSha256: string;
    }>;

export type PreparedAggregateRefresh = Readonly<{
  preparedAggregateSetId: string;
  sourceVersionSetSha256: string;
  aggregateFamilyCount: number;
  materializedRowCount: number;
}>;

export type AggregateRefreshRepository = Readonly<{
  claimRefresh: (input: {
    refreshId: string;
    workerId: string;
    claimedAt: string;
    leaseExpiresAt: string;
  }) => Promise<AggregateRefreshClaim>;
  publishPreparedAggregateSet: (input: {
    ownerId: string;
    updateSessionId: string;
    refreshId: string;
    workerId: string;
    preparedAggregateSetId: string;
    sourceVersionSetSha256: string;
    aggregateFamilyCount: number;
    materializedRowCount: number;
    completedAt: string;
  }) => Promise<
    Readonly<
      { status: "published"; aggregateSetId: string } | { status: "superseded" }
    >
  >;
  recordRefreshFailure: (input: {
    ownerId: string;
    updateSessionId: string;
    refreshId: string;
    workerId: string;
    failedAt: string;
    reason: "refresher_failed" | "publish_failed";
  }) => Promise<void>;
}>;

export type BoundedAggregateRefresher = Readonly<{
  prepare: (input: {
    ownerId: string;
    updateSessionId: string;
    refreshId: string;
    sourceVersionSetSha256: string;
  }) => Promise<PreparedAggregateRefresh>;
}>;

export type AggregateRefreshCapabilities =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{
      status: "ready";
      repository: AggregateRefreshRepository;
      refresher: BoundedAggregateRefresher;
    }>;

export type AggregateRefreshDispatchResult =
  | Readonly<{ status: "not_configured" }>
  | Readonly<{ status: "not_found" }>
  | Readonly<{
      status: "already_complete";
      updateSessionId: string;
      aggregateSetId: string;
    }>
  | Readonly<{ status: "leased_elsewhere"; retryAfter: string }>
  | Readonly<{ status: "superseded"; updateSessionId: string }>
  | Readonly<{
      status: "completed";
      updateSessionId: string;
      aggregateSetId: string;
      aggregateFamilyCount: number;
      materializedRowCount: number;
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

function requireSha256(value: string, field: string): string {
  if (!SHA_256_PATTERN.test(value)) throw new Error(`${field} is invalid`);
  return value;
}

function canonicalTimestamp(value: Date, field: string): string {
  if (Number.isNaN(value.getTime())) throw new Error(`${field} must be valid`);
  return value.toISOString();
}

function nonNegativeSafeInteger(value: number, field: string): number {
  if (!Number.isSafeInteger(value) || value < 0) {
    throw new Error(`${field} must be a non-negative safe integer`);
  }
  return value;
}

function assertClaim(claim: AggregateRefreshClaim): void {
  if (claim.status === "already_complete") {
    requireSafeIdentifier(claim.updateSessionId, "updateSessionId");
    requireSafeIdentifier(claim.aggregateSetId, "aggregateSetId");
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
    requireSha256(claim.sourceVersionSetSha256, "sourceVersionSetSha256");
  }
}

function assertPreparedRefresh(
  result: PreparedAggregateRefresh,
  expectedSourceVersionSetSha256: string,
): void {
  requireSafeIdentifier(
    result.preparedAggregateSetId,
    "preparedAggregateSetId",
  );
  requireSha256(result.sourceVersionSetSha256, "sourceVersionSetSha256");
  if (result.sourceVersionSetSha256 !== expectedSourceVersionSetSha256) {
    throw new Error("Prepared aggregate source versions do not match claim.");
  }
  nonNegativeSafeInteger(result.aggregateFamilyCount, "aggregateFamilyCount");
  if (result.aggregateFamilyCount === 0) {
    throw new Error("aggregateFamilyCount must be positive");
  }
  nonNegativeSafeInteger(result.materializedRowCount, "materializedRowCount");
}

async function recordFailure(
  repository: AggregateRefreshRepository,
  input: {
    ownerId: string;
    updateSessionId: string;
    refreshId: string;
    workerId: string;
    failedAt: string;
    reason: "refresher_failed" | "publish_failed";
  },
): Promise<void> {
  try {
    await repository.recordRefreshFailure(input);
  } catch {
    // Preserve the original refresh or publish failure.
  }
}

export async function runAggregateRefreshDispatch(
  input: Readonly<{
    refreshId: string;
    workerId: string;
    now: Date;
    leaseDurationMilliseconds: number;
    capabilities: AggregateRefreshCapabilities;
  }>,
): Promise<AggregateRefreshDispatchResult> {
  if (input.capabilities.status === "not_configured") {
    return { status: "not_configured" };
  }

  const refreshId = requireSafeIdentifier(input.refreshId, "refreshId");
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

  const { repository, refresher } = input.capabilities;
  const claim = await repository.claimRefresh({
    refreshId,
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
      aggregateSetId: claim.aggregateSetId,
    };
  }
  if (claim.status === "leased_elsewhere") {
    return { status: "leased_elsewhere", retryAfter: claim.retryAfter };
  }

  let prepared: PreparedAggregateRefresh;
  try {
    prepared = await refresher.prepare({
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      refreshId,
      sourceVersionSetSha256: claim.sourceVersionSetSha256,
    });
    assertPreparedRefresh(prepared, claim.sourceVersionSetSha256);
  } catch {
    await recordFailure(repository, {
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      refreshId,
      workerId,
      failedAt: claimedAt,
      reason: "refresher_failed",
    });
    throw new Error("Aggregate refresh processing failed.");
  }

  let publication: Awaited<
    ReturnType<AggregateRefreshRepository["publishPreparedAggregateSet"]>
  >;
  try {
    publication = await repository.publishPreparedAggregateSet({
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      refreshId,
      workerId,
      preparedAggregateSetId: prepared.preparedAggregateSetId,
      sourceVersionSetSha256: prepared.sourceVersionSetSha256,
      aggregateFamilyCount: prepared.aggregateFamilyCount,
      materializedRowCount: prepared.materializedRowCount,
      completedAt: claimedAt,
    });
  } catch {
    await recordFailure(repository, {
      ownerId: claim.ownerId,
      updateSessionId: claim.updateSessionId,
      refreshId,
      workerId,
      failedAt: claimedAt,
      reason: "publish_failed",
    });
    throw new Error("Aggregate refresh publication failed.");
  }

  if (publication.status === "superseded") {
    return { status: "superseded", updateSessionId: claim.updateSessionId };
  }
  const aggregateSetId = requireSafeIdentifier(
    publication.aggregateSetId,
    "aggregateSetId",
  );
  return {
    status: "completed",
    updateSessionId: claim.updateSessionId,
    aggregateSetId,
    aggregateFamilyCount: prepared.aggregateFamilyCount,
    materializedRowCount: prepared.materializedRowCount,
  };
}
