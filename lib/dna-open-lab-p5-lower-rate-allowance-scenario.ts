import { createHash } from "node:crypto";

import {
  createDnaOpenLabClientPool,
  type DnaOpenLabClientPool,
} from "./dna-open-lab-client-pool";
import type { DnaOpenLabP5ComponentRecoveryEvidence } from "./dna-open-lab-p5-component-recovery-executor";
import type { DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot } from "./dna-open-lab-p5-private-preview-recovery";
import {
  createDnaOpenLabP5RecoveryTemporaryEvidenceReader,
  createDnaOpenLabP5RecoveryTemporaryEvidenceSink,
  DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
  type DnaOpenLabR2CurrentStateEvidenceReaderConfiguration,
  type DnaOpenLabR2CurrentStateEvidenceStoragePort,
} from "./dna-open-lab-r2-current-state-evidence";
import { DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE } from "./dna-open-lab-request-budget";
import type {
  DnaOpenLabClient,
  DnaOpenLabRateLimit,
  DnaOpenLabResponse,
} from "./dna-open-lab-v1-client";

type LowerRateAllowanceEvidence = Extract<
  DnaOpenLabP5ComponentRecoveryEvidence,
  { caseId: "lower_rate_allowance" }
>;

export type DnaOpenLabP5LowerRateAllowanceScenarioConfiguration = Readonly<{
  ownerId: string;
  bucketName: string;
  cycleId: string;
  observedAt: string;
  observedAllowance: number;
  storage: DnaOpenLabR2CurrentStateEvidenceStoragePort &
    DnaOpenLabR2CurrentStateEvidenceReaderConfiguration["storage"];
  inspectProviderSafety: () => Promise<DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot>;
  cleanupSyntheticCase: () => Promise<void>;
}>;

function scenarioError(): never {
  throw new Error("DNA Open Lab P5 lower-rate-allowance scenario failed.");
}

function timestamp(value: string): string {
  const normalized = value.trim();
  if (
    !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d+)?(?:Z|[+-]\d{2}:\d{2})$/u.test(
      normalized,
    ) ||
    Number.isNaN(Date.parse(normalized))
  ) {
    scenarioError();
  }
  return new Date(normalized).toISOString();
}

function lowerAllowance(value: number): number {
  if (
    !Number.isSafeInteger(value) ||
    value < 1 ||
    value >= DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
  ) {
    scenarioError();
  }
  return value;
}

function sha256(value: unknown): string {
  return createHash("sha256")
    .update(JSON.stringify(value), "utf8")
    .digest("hex");
}

function rateLimit(limit: number, remaining: number): DnaOpenLabRateLimit {
  return Object.freeze({
    limit,
    remaining,
    resetSeconds: 60,
    rateClass: "api_key",
    retryAfterSeconds: null,
  });
}

function response(
  limit: number,
  remaining: number,
): DnaOpenLabResponse<unknown> {
  return Object.freeze({
    result: Object.freeze({ recoveryProbe: true }),
    httpStatus: 200,
    rateLimit: rateLimit(limit, remaining),
  });
}

function syntheticClient(): DnaOpenLabClient {
  return Object.freeze({}) as unknown as DnaOpenLabClient;
}

function assertUnchangedProviderState(
  before: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
  after: DnaOpenLabP5PrivatePreviewRecoverySafetySnapshot,
): void {
  if (
    after.syntheticResidueObjectCount !== 0 ||
    before.ownerDataSha256 !== after.ownerDataSha256 ||
    before.checkpointStateSha256 !== after.checkpointStateSha256 ||
    before.servingStateSha256 !== after.servingStateSha256 ||
    before.retainedEvidenceSha256 !== after.retainedEvidenceSha256 ||
    before.persistentOwnerDataRowCount !== after.persistentOwnerDataRowCount
  ) {
    scenarioError();
  }
}

/**
 * Exercises lower response rate metadata through the production client pool.
 * An advertised allowance above policy cannot raise the fixed aggregate gate;
 * a later lower allowance reduces both the lane and aggregate gates. A bounded
 * synthetic burst then proves that request 13 waits for the next minute when
 * the observed allowance is 12. Temporary R2 evidence is read back and removed
 * while all persistent and last-good provider fingerprints remain unchanged.
 */
export function createDnaOpenLabP5LowerRateAllowanceScenario(
  configuration: DnaOpenLabP5LowerRateAllowanceScenarioConfiguration,
): () => Promise<LowerRateAllowanceEvidence> {
  return async () => {
    const observedAt = timestamp(configuration.observedAt);
    const observedAllowance = lowerAllowance(configuration.observedAllowance);
    const before = await configuration.inspectProviderSafety();
    if (before.syntheticResidueObjectCount !== 0) scenarioError();

    let now = Date.parse(observedAt);
    const sleeps: number[] = [];
    const pool: DnaOpenLabClientPool = createDnaOpenLabClientPool({
      lanes: [
        Object.freeze({
          id: "key-1",
          client: syntheticClient(),
          scopes: Object.freeze(["tokens"] as const),
        }),
      ],
      nowMilliseconds: () => now,
      sleep: async (milliseconds) => {
        sleeps.push(milliseconds);
        now += milliseconds;
      },
      aggregateRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      maximumLaneRequestsPerMinute: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      allowIndependentRateBuckets: false,
    });

    let syntheticRequests = 0;
    const execute = async (limit: number, remaining: number) =>
      pool.execute({
        scope: "tokens",
        request: async () => {
          syntheticRequests += 1;
          return response(limit, remaining);
        },
      });

    await execute(80, 79);
    const initial = pool.snapshot();
    if (
      initial.independentRateBucketsEnabled ||
      initial.aggregateBudget?.effectiveRequestsPerMinute !==
        DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE ||
      initial.lanes[0]?.budget.effectiveRequestsPerMinute !==
        DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE
    ) {
      scenarioError();
    }

    await execute(observedAllowance, observedAllowance - 1);
    const reduced = pool.snapshot();
    if (
      reduced.aggregateBudget?.effectiveRequestsPerMinute !==
        observedAllowance ||
      reduced.lanes[0]?.budget.effectiveRequestsPerMinute !== observedAllowance
    ) {
      scenarioError();
    }

    for (let index = 2; index < observedAllowance; index += 1) {
      await execute(observedAllowance, Math.max(0, observedAllowance - index));
    }
    await execute(observedAllowance, observedAllowance - 1);
    const applied = pool.snapshot();
    if (
      syntheticRequests !== observedAllowance + 1 ||
      sleeps.length !== 1 ||
      sleeps[0] !== 60_000 ||
      applied.aggregateBudget?.effectiveRequestsPerMinute !==
        observedAllowance ||
      applied.lanes[0]?.budget.effectiveRequestsPerMinute !== observedAllowance
    ) {
      scenarioError();
    }

    const sink = createDnaOpenLabP5RecoveryTemporaryEvidenceSink({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const reader = createDnaOpenLabP5RecoveryTemporaryEvidenceReader({
      authority: DNA_OPEN_LAB_P5_RECOVERY_TEMPORARY_EVIDENCE_AUTHORITY,
      ownerId: configuration.ownerId,
      bucketName: configuration.bucketName,
      storage: configuration.storage,
    });
    const request = Object.freeze({
      scope: "tokens" as const,
      endpoint: "tokens.prices" as const,
      payload: Object.freeze({}),
    });
    const requestKey = sha256({
      caseId: "lower_rate_allowance",
      cycleId: configuration.cycleId,
      request,
    });
    const receipt = await sink({
      cycleId: configuration.cycleId,
      group: "token_prices",
      requestKey,
      request,
      response: response(observedAllowance, observedAllowance - 1),
      observedAt,
    });
    const readBack = await reader({
      cycleId: configuration.cycleId,
      receipt,
    });
    if (
      readBack.requestKey !== requestKey ||
      readBack.response.rateLimit.limit !== observedAllowance ||
      (await configuration.inspectProviderSafety())
        .syntheticResidueObjectCount !== 1
    ) {
      scenarioError();
    }

    const checkpointSha256 = sha256({
      cycleId: configuration.cycleId,
      configuredAggregateCeiling: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      observedAllowance,
      appliedAllowance: applied.aggregateBudget.effectiveRequestsPerMinute,
    });
    await configuration.cleanupSyntheticCase();
    const cleaned = await configuration.inspectProviderSafety();
    assertUnchangedProviderState(before, cleaned);

    return Object.freeze({
      caseId: "lower_rate_allowance",
      apiRequestCount: 0,
      syntheticProviderWriteCount: 1,
      persistentOwnerDataWriteCount: 0,
      residueObjectCount: 0,
      rawPayloadIncluded: false,
      secretMaterialIncluded: false,
      lastGoodGenerationBefore: before.servingStateSha256,
      lastGoodGenerationAfter: cleaned.servingStateSha256,
      expectedCheckpointSha256: checkpointSha256,
      recoveredCheckpointSha256: checkpointSha256,
      expectedEvidenceSha256: receipt.contentSha256,
      readBackEvidenceSha256: receipt.contentSha256,
      retryBoundaryAt: observedAt,
      firstRetryAt: new Date(now).toISOString(),
      catchUpStarted: true,
      catchUpCompleted: true,
      summary:
        "Lower response rate metadata reduced the production lane and aggregate gates; the bounded synthetic burst waited without changing last-good serving.",
      configuredAggregateCeiling: DNA_OPEN_LAB_BASE_REQUESTS_PER_MINUTE,
      observedAllowance,
      appliedAllowance: applied.aggregateBudget.effectiveRequestsPerMinute,
    });
  };
}
